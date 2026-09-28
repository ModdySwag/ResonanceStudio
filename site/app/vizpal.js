/* Gnaural Web — palette + generative maths kernel (pure, DOM-free, testable under Node).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Why this file exists: every colour and every random wobble the visualizer
 * paints must be (a) reproducible from a seed and (b) safe to look at.
 *
 *  - DETERMINISTIC NOISE. mulberry32 gives a caller-owned RNG stream, and
 *    hash2 / valueNoise / fbm give lattice noise from it, so the same seed
 *    draws the same picture on every reload and every machine. This kernel
 *    contains no unseeded randomness of any kind (the test suite checks).
 *
 *  - PERCEPTUAL COLOUR. Palettes are authored in OKLCh (perceptually uniform
 *    lightness and chroma, so a ramp of stops reads as an even gradient) and
 *    converted here with Ottosson's exact OKLab <-> linear-sRGB matrices.
 *    Colour maths is done in linear light; only the final step applies the
 *    sRGB transfer function, and out-of-gamut results are clamped.
 *
 *  - PHOTOSENSITIVITY GUARD (hard requirement; WCAG / ISO photosensitivity
 *    guidance). Saturated red light is the known seizure-triggering stimulus,
 *    so EVERY css string this module produces passes through redGuard(), which
 *    holds R / (R + G + B) below the 0.72 ceiling — the rose palette and the
 *    accent paths included. The guard desaturates (lifts the non-red channels,
 *    never darkens below the ramp) rather than simply deleting red, so the
 *    picture stays readable and the palette stays monotone in luminance.
 *
 * Runs in browser and Node (no DOM, no imports; globalThis.GnauralVizPal).
 */
(function () {
  "use strict";

  var DEG = Math.PI / 180;
  var RED_MAX_RATIO = 0.70;   /* internal cap; the hard ceiling is 0.72      */
  var FBM_MAX_OCT = 8;

  /* =================================================================== *
   * Deterministic RNG + lattice noise
   * =================================================================== */

  /* mulberry32: 32-bit seeded stream, uniform [0,1). Same seed -> same
   * sequence, in every engine, forever. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Integer hash of a lattice point, mixed across all 32 bits, returned as
   * [0,1). Integer maths (Math.imul) keeps it bit-exact — a float hash of the
   * sin()*43758 family loses low bits and would not be reproducible.
   *
   * The combine is an ADD of two odd-multiple linear maps followed by full
   * avalanches, NOT an xor of them: xor-combining two arithmetic progressions
   * leaves the lattice values colliding (272 duplicate pairs on a 41x41 grid,
   * measured), which is visible structure in a noise field. This version has
   * no collisions at all on that grid nor on 300x300, and its neighbour delta
   * matches an ideal white field (0.332 vs 1/3). */
  function hash2(i, j) {
    var h = (Math.imul(i | 0, 0x8da6b343) + Math.imul(j | 0, 0xd8163841)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);       /* murmur3 fmix32 ...    */
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* Lattice value noise: hash the corners, fade the interpolation with
   * smoothstep so the field has no first-derivative kink at the lattice. */
  function valueNoise1(x) {
    var xi = Math.floor(x), t = smoothstep(x - xi);
    return lerp(hash2(xi, 17), hash2(xi + 1, 17), t);
  }

  function valueNoise2(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var tx = smoothstep(x - xi), ty = smoothstep(y - yi);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  function octCount(oct) {
    var n = Math.floor(oct);
    if (!(n >= 1)) n = 1;
    if (n > FBM_MAX_OCT) n = FBM_MAX_OCT;
    return n;
  }

  /* Fractal sums: octaves at double frequency, half amplitude, each offset by
   * an irrational-ish constant so the octaves do not correlate. Normalised by
   * the amplitude sum, so the result stays inside [0,1). */
  function fbm1(x, oct) {
    var n = octCount(oct), sum = 0, norm = 0, amp = 1, freq = 1, i;
    for (i = 0; i < n; i++) {
      sum += amp * valueNoise1(x * freq + i * 19.19);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  function fbm2(x, y, oct) {
    var n = octCount(oct), sum = 0, norm = 0, amp = 1, freq = 1, i;
    for (i = 0; i < n; i++) {
      sum += amp * valueNoise2(x * freq + i * 17.31, y * freq + i * 11.73);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  /* =================================================================== *
   * Scalars
   * =================================================================== */

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* GLSL-style smoothstep on the unit interval (3t^2 - 2t^3). */
  function smoothstep(t) {
    var x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  /* Classic cubic ease-in-out, symmetric about t = 0.5. */
  function easeInOut(t) {
    var x = clamp(t, 0, 1);
    return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
  }

  function pick(rng, arr) {
    if (!arr || !arr.length) return undefined;
    return arr[clamp(Math.floor(rng() * arr.length), 0, arr.length - 1)];
  }

  /* Weighted choice; weights are treated as non-negative and normalised.
   * Zero total weight -> the first item (deterministic, never NaN). */
  function weightedPick(rng, items, weights) {
    if (!items || !items.length) return undefined;
    var i, w, total = 0;
    for (i = 0; i < items.length; i++) {
      w = (weights && weights[i]) || 0;
      if (w > 0) total += w;
    }
    if (!(total > 0)) return items[0];
    var r = rng() * total, acc = 0;
    for (i = 0; i < items.length; i++) {
      w = (weights && weights[i]) || 0;
      if (w > 0) acc += w;
      if (r < acc) return items[i];
    }
    return items[items.length - 1];
  }

  /* Fisher-Yates on a copy: the caller's array is never mutated. */
  function shuffle(rng, arr) {
    var out = (arr || []).slice(), i, j, tmp;
    for (i = out.length - 1; i > 0; i--) {
      j = clamp(Math.floor(rng() * (i + 1)), 0, i);
      tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  /* =================================================================== *
   * sRGB <-> linear light (the transfer function used by BOTH the OKLab
   * conversions and the WCAG luminance, so the two agree).
   * =================================================================== */

  function srgbToLinear(c) {
    var x = clamp(c, 0, 255) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(x) {
    if (!(x > 0)) return 0;
    if (x > 1) x = 1;
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }

  /* WCAG relative luminance, 0..1. */
  function relLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  /* =================================================================== *
   * OKLCh <-> sRGB (Björn Ottosson's OKLab matrices)
   * =================================================================== */

  function to8bit(x) {
    if (!(x > 0)) return 0;                       /* also catches NaN       */
    return Math.round(clamp(linearToSrgb(x > 1 ? 1 : x), 0, 1) * 255);
  }

  /* oklch(L, C, h in degrees) -> 8-bit sRGB, out-of-gamut clamped. */
  function oklchToRgb(L, C, hDeg) {
    var h = (isFinite(hDeg) ? hDeg : 0) * DEG;
    var a = C * Math.cos(h), b = C * Math.sin(h);
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    var rl = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return [to8bit(rl), to8bit(gl), to8bit(bl)];
  }

  /* 8-bit sRGB -> { L, C, h } (h in [0,360)). */
  function rgbToOklch(r, g, b) {
    var lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var h = Math.atan2(B, A) / DEG;
    if (h < 0) h += 360;
    return { L: L, C: Math.sqrt(A * A + B * B), h: h };
  }

  /* =================================================================== *
   * Photosensitivity guard
   * =================================================================== */

  /* Hold R / (R + G + B) at or under RED_MAX_RATIO by lifting the non-red
   * channels (a desaturation, so the frame never gets darker and never loses
   * the red channel entirely). Pure integer arithmetic: the constraint
   *   R / (R + G + B) <= cap   <=>   G + B >= R * (1 - cap) / cap
   * is solved exactly, and the maximal lift it can ask for (0.4286 * 255 = 110
   * units spread over two channels with 510 units of headroom) always fits
   * under 255, so the lift alone always satisfies the cap; the closing test is
   * a belt-and-braces assertion of the invariant rather than a live branch.
   * Never returns NaN. */
  function redGuard(r, g, b) {
    var R = clamp(Math.round(isFinite(r) ? r : 0), 0, 255);
    var G = clamp(Math.round(isFinite(g) ? g : 0), 0, 255);
    var B = clamp(Math.round(isFinite(b) ? b : 0), 0, 255);
    if (!(R + G + B > 0)) return [0, 0, 0];
    if (R / (R + G + B) <= RED_MAX_RATIO) return [R, G, B];

    var need = Math.ceil(R * (1 - RED_MAX_RATIO) / RED_MAX_RATIO) - (G + B);
    var gAdd = Math.min(255 - G, Math.ceil(need / 2));
    var bAdd = Math.min(255 - B, need - gAdd);
    var short = need - gAdd - bAdd;
    if (short > 0) gAdd += Math.min(255 - G - gAdd, short);
    G += gAdd; B += bAdd;

    if (R / (R + G + B) > RED_MAX_RATIO) {   /* unreachable with 8-bit input: */
      R = Math.floor(RED_MAX_RATIO * (G + B) / (1 - RED_MAX_RATIO));
    }
    return [clamp(R, 0, 255), clamp(G, 0, 255), clamp(B, 0, 255)];
  }

  /* =================================================================== *
   * CSS output — the single funnel: every string leaves through here, so
   * the guard cannot be bypassed.
   * =================================================================== */

  function alphaStr(alpha) {
    var a = +alpha;
    if (!isFinite(a)) a = 1;
    return String(Math.round(clamp(a, 0, 1) * 1000) / 1000);
  }

  function oklchToCss(L, C, hDeg, alpha) {
    var raw = oklchToRgb(L, C, hDeg);
    var rgb = redGuard(raw[0], raw[1], raw[2]);
    return "rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", " + alphaStr(alpha) + ")";
  }

  /* =================================================================== *
   * Palettes — authored in OKLCh so lightness is perceptually even.
   * Most stops sit inside the sRGB gamut at their hue; the handful that sit
   * marginally outside (auto's darkest, ember's brightest, rose's saturated
   * stop, where the gamut's corner channel saturates) get clamped with a
   * measured hue error of at most ~6 degrees — well inside the band each
   * palette declares, which is exactly what the test suite asserts. Clamping
   * is a safety net here, not something the ramps are built on.
   * band <= 60 keeps a palette's hue spread narrow enough to read as one
   * family; hOff is the stop's offset from the palette's base hue h0.
   * =================================================================== */

  var PALETTES = [
    { id: "auto", name: "Auto", h0: 210, band: 60, stops: [
      { t: 0.00, L: 0.22, C: 0.020, hOff: -8 },
      { t: 0.20, L: 0.34, C: 0.035, hOff: -5 },
      { t: 0.40, L: 0.48, C: 0.045, hOff: -2 },
      { t: 0.60, L: 0.62, C: 0.055, hOff: 1 },
      { t: 0.80, L: 0.76, C: 0.055, hOff: 4 },
      { t: 1.00, L: 0.90, C: 0.035, hOff: 7 }] },
    { id: "ember", name: "Ember", h0: 40, band: 40, stops: [
      { t: 0.00, L: 0.24, C: 0.045, hOff: -10 },
      { t: 0.20, L: 0.36, C: 0.075, hOff: -6 },
      { t: 0.40, L: 0.50, C: 0.100, hOff: -2 },
      { t: 0.60, L: 0.64, C: 0.115, hOff: 2 },
      { t: 0.80, L: 0.78, C: 0.105, hOff: 6 },
      { t: 1.00, L: 0.92, C: 0.065, hOff: 10 }] },
    { id: "moss", name: "Moss", h0: 135, band: 50, stops: [
      { t: 0.00, L: 0.22, C: 0.040, hOff: -12 },
      { t: 0.20, L: 0.34, C: 0.070, hOff: -7 },
      { t: 0.40, L: 0.47, C: 0.095, hOff: -2 },
      { t: 0.60, L: 0.60, C: 0.105, hOff: 4 },
      { t: 0.80, L: 0.74, C: 0.090, hOff: 9 },
      { t: 1.00, L: 0.90, C: 0.055, hOff: 13 }] },
    { id: "ice", name: "Ice", h0: 245, band: 40, stops: [
      { t: 0.00, L: 0.20, C: 0.035, hOff: -8 },
      { t: 0.20, L: 0.32, C: 0.060, hOff: -5 },
      { t: 0.40, L: 0.45, C: 0.080, hOff: -2 },
      { t: 0.60, L: 0.58, C: 0.085, hOff: 2 },
      { t: 0.80, L: 0.73, C: 0.065, hOff: 5 },
      { t: 1.00, L: 0.90, C: 0.035, hOff: 8 }] },
    { id: "dusk", name: "Dusk", h0: 305, band: 45, stops: [
      { t: 0.00, L: 0.22, C: 0.045, hOff: -10 },
      { t: 0.20, L: 0.34, C: 0.080, hOff: -6 },
      { t: 0.40, L: 0.47, C: 0.105, hOff: -2 },
      { t: 0.60, L: 0.60, C: 0.110, hOff: 3 },
      { t: 0.80, L: 0.75, C: 0.085, hOff: 7 },
      { t: 1.00, L: 0.90, C: 0.050, hOff: 10 }] },
    /* rose is the palette that would breach the red ratio on its own: the
     * 0.60 stop is deliberately saturated enough that its RAW colour sits at
     * R/(R+G+B) = 0.78, so redGuard has to pull it back to 0.70 — which is
     * what proves the guard is wired into the css paths. */
    { id: "rose", name: "Rose", h0: 18, band: 40, stops: [
      { t: 0.00, L: 0.22, C: 0.045, hOff: -10 },
      { t: 0.20, L: 0.35, C: 0.090, hOff: -6 },
      { t: 0.40, L: 0.48, C: 0.150, hOff: -2 },
      { t: 0.60, L: 0.60, C: 0.240, hOff: 2 },
      { t: 0.80, L: 0.76, C: 0.120, hOff: 7 },
      { t: 1.00, L: 0.91, C: 0.070, hOff: 10 }] },
    /* mono is exempt from the hue check by construction: its stops are exact
     * greys (C = 0 -> chroma under 0.005), so the hue is undefined and the
     * test asserts the exemption instead. */
    { id: "mono", name: "Mono", h0: 210, band: 20, stops: [
      { t: 0.00, L: 0.18, C: 0, hOff: 0 },
      { t: 0.20, L: 0.32, C: 0, hOff: 0 },
      { t: 0.40, L: 0.48, C: 0, hOff: 0 },
      { t: 0.60, L: 0.64, C: 0, hOff: 0 },
      { t: 0.80, L: 0.78, C: 0, hOff: 0 },
      { t: 1.00, L: 0.92, C: 0, hOff: 0 }] }
  ];

  var BG_L = 0.145;      /* the dark field: comfortably under the 0.18 limit */
  var ACCENT_L = 0.66;
  var TINT_L = 0.42;

  /* Resolve a palette id to a drawable palette. 'auto' takes its base hue
   * from opts.accentHue (fallback 210); every returned method produces css
   * through oklchToCss, i.e. through the red guard. */
  function paletteById(id, opts) {
    var want = null, i, j;
    for (i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) want = PALETTES[i];
    if (!want) for (i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === "auto") want = PALETTES[i];

    var o = opts || {};
    var h0 = want.h0;
    if (want.id === "auto") {
      var a = +o.accentHue;
      if (isFinite(a)) h0 = ((a % 360) + 360) % 360;
    }

    var stops = [], maxC = 0, maxJ = 0, minC = Infinity;
    for (j = 0; j < want.stops.length; j++) {
      var s = want.stops[j];
      stops.push({ t: s.t, L: s.L, C: s.C, hOff: s.hOff });
      if (s.C > maxC) { maxC = s.C; maxJ = j; }
      if (s.C < minC) minC = s.C;
    }

    function sampleAt(t) {
      var x = clamp(t, 0, 1);
      var a = stops[0], b = stops[stops.length - 1], k;
      for (k = 0; k < stops.length - 1; k++) {
        if (x >= stops[k].t && x <= stops[k + 1].t) { a = stops[k]; b = stops[k + 1]; break; }
      }
      var d = b.t - a.t;
      var u = d > 1e-9 ? (x - a.t) / d : 0;
      return { L: lerp(a.L, b.L, u), C: lerp(a.C, b.C, u), h: h0 + lerp(a.hOff, b.hOff, u) };
    }

    var bgC = Math.min(0.030, minC * 0.6);
    var bgH = h0 + stops[0].hOff * 0.5;
    var accC = maxC > 0 ? Math.min(maxC * 1.15, 0.15) : 0;
    var accH = h0 + stops[maxJ].hOff;
    var tintC = maxC * 0.5;

    return {
      id: want.id,
      name: want.name,
      h0: h0,
      band: want.band,
      stops: stops,
      bg: function (alpha) { return oklchToCss(BG_L, bgC, bgH, alpha); },
      ink: function (t, alpha) { var s2 = sampleAt(t); return oklchToCss(s2.L, s2.C, s2.h, alpha); },
      accent: function (alpha) { return oklchToCss(ACCENT_L, accC, accH, alpha); },
      tint: function (alpha) { return oklchToCss(TINT_L, tintC, h0, alpha); }
    };
  }

  var api = {
    RED_MAX_RATIO: RED_MAX_RATIO,
    mulberry32: mulberry32,
    hash2: hash2,
    valueNoise1: valueNoise1,
    valueNoise2: valueNoise2,
    fbm1: fbm1,
    fbm2: fbm2,
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    easeInOut: easeInOut,
    pick: pick,
    weightedPick: weightedPick,
    shuffle: shuffle,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    relLuminance: relLuminance,
    oklchToRgb: oklchToRgb,
    rgbToOklch: rgbToOklch,
    redGuard: redGuard,
    oklchToCss: oklchToCss,
    PALETTES: PALETTES,
    paletteById: paletteById
  };

  if (typeof globalThis !== "undefined") globalThis.GnauralVizPal = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
