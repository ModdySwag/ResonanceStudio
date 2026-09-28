/* Node tests for the palette + generative maths kernel (vizpal.js).
 * Run:  node vizpal.test.js      (from site/resonance/app/)
 *
 * The load-bearing claims under test:
 *   1. every random stream is reproducible from its seed — the kernel holds no
 *      unseeded randomness, and the lattice hash it uses must have no
 *      collisions over the small grids the visualizer actually walks (a
 *      colliding lattice value is visible structure in a noise field);
 *   2. the colour maths is the real OKLab <-> sRGB one (white is white, red is
 *      red, and the round trip returns the hue);
 *   3. every palette is a monotone luminance ramp whose sampled hues stay
 *      inside its own band (mono exempt: it is achromatic by construction);
 *   4. NO css string this module can produce has R / (R + G + B) above 0.72.
 *      That is the photosensitivity ceiling (WCAG/ISO guidance on saturated
 *      red light) and it holds for the rose palette's deliberately saturated
 *      stop, which breaches the ratio before the guard and does not after.
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "vizpal.js"), "utf8"));
const VP = globalThis.GnauralVizPal;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function close(a, b, tol) { return Math.abs(a - b) <= tol; }
function parseCss(css) {
  const m = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(css);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}
function redShare(rgb) { const s = rgb[0] + rgb[1] + rgb[2]; return s ? rgb[0] / s : 0; }
function hueDelta(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function lumOf(rgb) { return VP.relLuminance(rgb[0], rgb[1], rgb[2]); }
const CSS_RX = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;

/* ---------- 1. Seeded RNG: same seed, same picture, forever ---------- */
{
  const a = VP.mulberry32(1234), b = VP.mulberry32(1234), c = VP.mulberry32(1235);
  let same = true, differ = false;
  for (let i = 0; i < 10; i++) {
    const x = a(), y = b(), z = c();
    if (x !== y) same = false;
    if (x !== z) differ = true;
  }
  check("mulberry32: the same seed reproduces the stream bit-for-bit", same);
  check("mulberry32: a different seed moves the stream", differ);

  const r = VP.mulberry32(7);
  const n = 5000;
  let lo = 1, hi = 0, sum = 0;
  for (let i = 0; i < n; i++) { const v = r(); if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  check("mulberry32: 5000 draws all inside [0,1)", lo >= 0 && hi < 1, { lo, hi });
  check("mulberry32: mean is uniform (~0.5)", close(sum / n, 0.5, 0.03), sum / n);
}

/* ---------- 2. Lattice hash + value noise ---------- */
{
  const s1 = new Set();
  let lo = 1, hi = 0;
  for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
    const v = VP.hash2(i, j);
    s1.add(v);
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  check("hash2: deterministic, inside [0,1), collision-free on a 41x41 lattice",
    lo >= 0 && hi < 1 && s1.size === 1681 && VP.hash2(3, 4) === VP.hash2(3, 4),
    { lo, hi, distinct: s1.size, twice: [VP.hash2(3, 4), VP.hash2(3, 4)] });

  const s2 = new Set();
  for (let i = 0; i < 300; i++) for (let j = 0; j < 300; j++) s2.add(VP.hash2(i, j));
  check("hash2: 90000 distinct values on a 300x300 lattice (no repeats)", s2.size === 90000, s2.size);

  let delta = 0, n = 0;
  for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
    delta += Math.abs(VP.hash2(i + 1, j) - VP.hash2(i, j)) + Math.abs(VP.hash2(i, j + 1) - VP.hash2(i, j));
    n += 2;
  }
  check("hash2: neighbours look like a white field (mean delta ~1/3)", close(delta / n, 1 / 3, 0.02), delta / n);

  let vlo = 1, vhi = 0, jump = 0, prev = VP.valueNoise1(0);
  for (let x = 0; x < 20; x += 0.001) {
    const v = VP.valueNoise1(x);
    if (v < vlo) vlo = v; if (v > vhi) vhi = v;
    if (Math.abs(v - prev) > jump) jump = Math.abs(v - prev);
    prev = v;
  }
  check("valueNoise1: in [0,1) and continuous (no jump over 0.02 per 0.001)", vlo >= 0 && vhi < 1 && jump < 0.02, { vlo, vhi, jump });

  let wlo = 1, whi = 0, wjump = 0, wprev = VP.valueNoise2(0, 3.7);
  for (let x = 0; x < 20; x += 0.001) {
    const v = VP.valueNoise2(x, 3.7);
    if (v < wlo) wlo = v; if (v > whi) whi = v;
    if (Math.abs(v - wprev) > wjump) wjump = Math.abs(v - wprev);
    wprev = v;
  }
  check("valueNoise2: in [0,1) and continuous (no jump over 0.02 per 0.001)", wlo >= 0 && whi < 1 && wjump < 0.02, { wlo, whi, wjump });

  let flo = 1, fhi = 0, samples = 0;
  for (let x = -3; x < 6; x += 0.071) for (let y = -3; y < 6; y += 0.093) {
    const v = VP.fbm2(x, y, 5); samples++;
    if (v < flo) flo = v; if (v > fhi) fhi = v;
  }
  check("fbm2: all " + samples + " grid samples inside [0,1]", flo >= 0 && fhi <= 1, { flo, fhi });
  check("fbm2: actually varies across the field", fhi - flo > 0.2, fhi - flo);
  check("fbm2: pure function (same input, same value)", VP.fbm2(2.25, -1.5, 4) === VP.fbm2(2.25, -1.5, 4));

  let olo = 1, ohi = 0;
  for (let x = -5; x < 15; x += 0.037) { const v = VP.fbm1(x, 4); if (v < olo) olo = v; if (v > ohi) ohi = v; }
  check("fbm1: sweep inside [0,1]", olo >= 0 && ohi <= 1, { olo, ohi });
  check("fbm: the octave count is clamped (0, NaN, 99, -4 all finite and in range)",
    [VP.fbm2(1.3, 2.7, 0), VP.fbm2(1.3, 2.7, NaN), VP.fbm2(1.3, 2.7, 99), VP.fbm1(1.3, -4), VP.fbm2(1.3, 2.7, 3.9)]
      .every(v => v >= 0 && v <= 1));
}

/* ---------- 3. Scalars, picking and shuffling ---------- */
{
  check("clamp: pins to [lo,hi] and passes through", VP.clamp(5, 0, 1) === 1 && VP.clamp(-5, 0, 1) === 0 && VP.clamp(0.5, 0, 1) === 0.5);
  check("lerp: linear between the endpoints", VP.lerp(0, 10, 0.25) === 2.5 && VP.lerp(-1, 1, 0) === -1 && VP.lerp(-1, 1, 1) === 1);

  check("smoothstep: 0 -> 0, 1 -> 1, 0.5 -> 0.5, clamped outside the unit interval",
    VP.smoothstep(0) === 0 && VP.smoothstep(1) === 1 && VP.smoothstep(0.5) === 0.5 && VP.smoothstep(-2) === 0 && VP.smoothstep(3) === 1);
  let sMono = true, sPrev = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) { const v = VP.smoothstep(t); if (v < sPrev - 1e-12) sMono = false; sPrev = v; }
  check("smoothstep: monotonically rising", sMono);

  check("easeInOut: 0 -> 0, 0.5 -> 0.5, 1 -> 1", VP.easeInOut(0) === 0 && VP.easeInOut(0.5) === 0.5 && VP.easeInOut(1) === 1);
  let eSym = true;
  for (let t = 0; t <= 1.0001; t += 0.05) if (!close(VP.easeInOut(t) + VP.easeInOut(1 - t), 1, 1e-12)) eSym = false;
  check("easeInOut: symmetric about the midpoint (and clamped outside)", eSym && VP.easeInOut(-1) === 0 && VP.easeInOut(2) === 1);

  const rng = VP.mulberry32(9), arr = ["r", "g", "b", "a"];
  let member = true;
  for (let i = 0; i < 300; i++) if (arr.indexOf(VP.pick(rng, arr)) < 0) member = false;
  check("pick: 300 draws are always members of the array", member);
  check("pick: an empty array is undefined, not a crash", VP.pick(rng, []) === undefined && VP.pick(rng, null) === undefined);

  const items = ["a", "b", "c", "d"], weights = [1, 2, 3, 4], N = 2000;
  const counts = { a: 0, b: 0, c: 0, d: 0 }, rw = VP.mulberry32(99);
  for (let i = 0; i < N; i++) counts[VP.weightedPick(rw, items, weights)]++;
  const shares = items.map(it => counts[it] / N), expect = weights.map(w => w / 10);
  let worst = 0;
  for (let i = 0; i < items.length; i++) worst = Math.max(worst, Math.abs(shares[i] - expect[i]));
  check("weightedPick: 2000 draws put every share within +/-0.15 of its weight",
    worst <= 0.15, { shares: shares.map(s => +s.toFixed(3)), expect });
  check("weightedPick: zero weights / empty list degrade gracefully",
    VP.weightedPick(VP.mulberry32(1), ["x", "y"], [0, 0]) === "x" && VP.weightedPick(VP.mulberry32(1), []) === undefined);

  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffled = VP.shuffle(VP.mulberry32(5), src);
  check("shuffle: preserves the multiset and the length",
    shuffled.length === src.length && shuffled.slice().sort((x, y) => x - y).join() === src.slice().sort((x, y) => x - y).join(),
    shuffled);
  check("shuffle: actually reorders, and leaves the caller's array alone",
    shuffled.join() !== src.join() && src.join() === "1,2,3,4,5,6,7,8,9,10", shuffled);
}

/* ---------- 4. OKLab colour maths + the red guard ---------- */
{
  const white = VP.oklchToRgb(1, 0, 0), black = VP.oklchToRgb(0, 0, 0), red = VP.oklchToRgb(0.628, 0.2577, 29.23);
  check("oklchToRgb: L=1, C=0 -> white (+/-3)", white.every(c => close(c, 255, 3)), white);
  check("oklchToRgb: L=0, C=0 -> black (-/+3)", black.every(c => close(c, 0, 3)), black);
  check("oklchToRgb: oklch(0.628 0.2577 29.23) -> red (255,0,0) +/-6",
    close(red[0], 255, 6) && close(red[1], 0, 6) && close(red[2], 0, 6), red);

  const back = VP.rgbToOklch(255, 0, 0);
  check("rgbToOklch: red round trip (L 0.628, C 0.258, h 29.23)",
    close(back.L, 0.628, 0.005) && close(back.C, 0.2577, 0.005) && close(back.h, 29.23, 0.5), back);
  const grey = VP.rgbToOklch(128, 128, 128);
  check("rgbToOklch: a neutral grey has (almost) no chroma", grey.C < 0.002 && close(grey.L, 0.60, 0.01), grey);

  check("relLuminance: white 1, black 0", close(VP.relLuminance(255, 255, 255), 1, 1e-9) && VP.relLuminance(0, 0, 0) === 0);
  check("relLuminance: channel weights ordered G > R > B",
    VP.relLuminance(0, 255, 0) > VP.relLuminance(255, 0, 0) && VP.relLuminance(255, 0, 0) > VP.relLuminance(0, 0, 255));
  let lMono = true, lPrev = -1;
  for (let v = 0; v <= 255; v += 5) { const lum = VP.relLuminance(v, v, v); if (lum < lPrev) lMono = false; lPrev = lum; }
  check("relLuminance: monotone along a grey ramp", lMono);

  check("redGuard: pure red is pulled under the ceiling", redShare(VP.redGuard(255, 0, 0)) <= 0.72, VP.redGuard(255, 0, 0));
  check("redGuard: colours already under the ceiling are untouched",
    VP.redGuard(0, 0, 0).join() === "0,0,0" && VP.redGuard(128, 128, 128).join() === "128,128,128" && VP.redGuard(60, 120, 200).join() === "60,120,200");

  const grng = VP.mulberry32(4242);
  let bad = 0, nan = 0, worstShare = 0;
  for (let i = 0; i < 400; i++) {
    const g = VP.redGuard(Math.round(grng() * 255), Math.round(grng() * 255), Math.round(grng() * 255));
    if (!isFinite(g[0]) || !isFinite(g[1]) || !isFinite(g[2]) || g.some(c => c < 0 || c > 255 || c !== Math.round(c))) nan++;
    const share = redShare(g);
    if (share > 0.72) bad++;
    if (share > worstShare) worstShare = share;
  }
  check("redGuard: 400 random colours stay under 0.72 — integer, in range, never NaN",
    bad === 0 && nan === 0, { overCeiling: bad, badValues: nan, worstShare });

  const cssSamples = [
    VP.oklchToCss(0.6, 0.24, 18, 0.55), VP.oklchToCss(0.6, 0.24, 18),
    VP.oklchToCss(0.2, 0.02, 210, 0.001), VP.oklchToCss(0.9, 0.05, 90, 0),
    VP.oklchToCss(0.5, 0.9, 29, 1), VP.oklchToCss(0.145, 0.02, 210, 0.42)
  ];
  check("oklchToCss: rgba(r, g, b, a) format on every shape of call", cssSamples.every(s => CSS_RX.test(s)), cssSamples);
  check("oklchToCss: alpha defaults to 1 and is clamped to [0,1]",
    /, 1\)$/.test(VP.oklchToCss(0.5, 0.1, 200)) && /, 0\)$/.test(VP.oklchToCss(0.5, 0.1, 200, -2)) && /, 1\)$/.test(VP.oklchToCss(0.5, 0.1, 200, 9)));
  check("oklchToCss: an out-of-gamut saturated red still leaves through the guard",
    redShare(parseCss(VP.oklchToCss(0.52, 0.34, 29, 1))) <= 0.72, VP.oklchToCss(0.52, 0.34, 29, 1));

  const srcText = fs.readFileSync(path.join(__dirname, "vizpal.js"), "utf8");
  check("vizpal.js: pure kernel — no unseeded randomness, no DOM globals",
    !/Math\.random/.test(srcText) && !/\b(document|window|localStorage|navigator)\b/.test(srcText));
  const mod = require(path.join(__dirname, "vizpal.js"));
  check("vizpal.js: the Node export carries the whole documented API",
    ["mulberry32", "hash2", "valueNoise1", "valueNoise2", "fbm1", "fbm2", "clamp", "lerp", "smoothstep",
      "easeInOut", "pick", "weightedPick", "shuffle", "oklchToRgb", "oklchToCss", "rgbToOklch",
      "relLuminance", "redGuard", "PALETTES", "paletteById"].every(k => typeof mod[k] !== "undefined"));
}

/* ---------- 5. Palettes: structure, ramps, hue bands, guard ---------- */
{
  const ids = VP.PALETTES.map(p => p.id).join();
  check("palettes: the seven ids, in order", ids === "auto,ember,moss,ice,dusk,rose,mono", ids);
  check("palettes: every band is a real band (0 < band <= 60 degrees)",
    VP.PALETTES.every(p => p.band > 0 && p.band <= 60 && isFinite(p.h0) && typeof p.name === "string" && p.name.length > 0));
  check("palettes: >= 5 stops each, ascending t from 0 to 1, all fields finite",
    VP.PALETTES.every(p => p.stops.length >= 5 && p.stops[0].t === 0 && p.stops[p.stops.length - 1].t === 1 &&
      p.stops.every((s, i) => s.t >= 0 && s.t <= 1 && isFinite(s.L) && isFinite(s.C) && isFinite(s.hOff) &&
        (i === 0 || s.t > p.stops[i - 1].t))));

  for (const def of VP.PALETTES) {
    const pal = VP.paletteById(def.id);

    /* luminance ramp: non-decreasing along the stops (tolerance 0.01) */
    const lums = [];
    let rampOk = true, prevLum = -1;
    for (const s of pal.stops) {
      const px = parseCss(pal.ink(s.t, 1));
      if (!px) { rampOk = false; continue; }
      const lum = lumOf(px);
      if (lum < prevLum - 0.01) rampOk = false;
      prevLum = lum;
      lums.push(+lum.toFixed(4));
    }
    check("palette " + def.id + ": >= 5 stops, non-decreasing relLuminance (tol 0.01)",
      rampOk && lums.length >= 5 && lums.every(l => l >= 0 && l <= 1), lums);

    /* hue band: sampled stop hues inside [h0 - band/2, h0 + band/2] modulo 360;
     * mono is exempt — instead |h - h0| <= band whenever C > 0.005. */
    let hueOk = true, monoOk = true, worstHue = 0;
    for (const s of pal.stops) {
      const px = parseCss(pal.ink(s.t, 1));
      const hb = VP.rgbToOklch(px[0], px[1], px[2]);
      const h = pal.h0 + s.hOff;
      if (def.id === "mono") {
        if (hb.C > 0.005 && hueDelta(hb.h, h) > pal.band) monoOk = false;
      } else {
        const d = hueDelta(hb.h, h);
        if (d > worstHue) worstHue = d;
        if (d > pal.band / 2) hueOk = false;
      }
    }
    if (def.id === "mono") check("palette mono: exempt from the hue band (achromatic stops, C <= 0.005)", monoOk);
    else check("palette " + def.id + ": stop hues inside [h0-band/2, h0+band/2] (worst " + worstHue.toFixed(1) + " of " + (pal.band / 2) + " deg)", hueOk, worstHue);

    /* every css-producing path: correct format, and under the red ceiling */
    const paths = [pal.bg(1), pal.accent(1), pal.tint(1), pal.ink(0, 1), pal.ink(0.35, 0.9), pal.ink(0.5, 0.8), pal.ink(0.85, 0.6), pal.ink(1, 0.25)];
    let fmtOk = true, guardOk = true, pathWorst = 0;
    for (const css of paths) {
      const px = parseCss(css);
      if (!px) { fmtOk = false; continue; }
      const share = redShare(px);
      if (share > pathWorst) pathWorst = share;
      if (share > 0.72) guardOk = false;
    }
    check("palette " + def.id + ": every css path is rgba-formatted and guarded (worst R-share " + pathWorst.toFixed(3) + ")",
      fmtOk && guardOk, paths);

    /* the dark field */
    const bgPx = parseCss(pal.bg(1));
    const bgL = VP.rgbToOklch(bgPx[0], bgPx[1], bgPx[2]).L;
    check("palette " + def.id + ": bg is a dark field (OKLab L <= 0.18)", bgL <= 0.18, bgL);
  }
}

/* ---------- 6. The guard is load-bearing for rose, and for 'auto' ---------- */
{
  const rose = VP.paletteById("rose");
  const sat = rose.stops[3];                              /* t = 0.60, the saturated stop */
  const raw = VP.oklchToRgb(sat.L, sat.C, rose.h0 + sat.hOff);
  const rawShare = redShare(raw);
  const cssPx = parseCss(rose.ink(sat.t, 1));
  check("rose: the raw stop colour genuinely breaches the ceiling (R-share " + rawShare.toFixed(3) + " > 0.72)",
    rawShare > 0.72, raw);
  check("rose: the emitted css for that same stop is inside the ceiling (R-share " + redShare(cssPx).toFixed(3) + ")",
    redShare(cssPx) <= 0.72, cssPx);

  check("paletteById: 'auto' falls back to hue 210",
    VP.paletteById("auto").h0 === 210 && VP.paletteById("auto", {}).h0 === 210 &&
    VP.paletteById("auto", { accentHue: NaN }).h0 === 210 && VP.paletteById("auto", { accentHue: undefined }).h0 === 210);
  check("paletteById: 'auto' takes opts.accentHue, wrapped into [0,360)",
    VP.paletteById("auto", { accentHue: 29 }).h0 === 29 && VP.paletteById("auto", { accentHue: 390 }).h0 === 30 &&
    VP.paletteById("auto", { accentHue: -75 }).h0 === 285);
  check("paletteById: an unknown or missing id resolves to 'auto'",
    VP.paletteById("nope").id === "auto" && VP.paletteById(undefined).id === "auto" && VP.paletteById("auto").name.length > 0);

  let autoOk = true, autoWorst = 0;
  for (const ah of [29, 135, 264, 330]) {
    const pal = VP.paletteById("auto", { accentHue: ah });
    for (const s of pal.stops) {
      const px = parseCss(pal.ink(s.t, 1));
      if (!px) { autoOk = false; continue; }
      if (redShare(px) > 0.72) autoOk = false;
      const d = hueDelta(VP.rgbToOklch(px[0], px[1], px[2]).h, pal.h0 + s.hOff);
      if (d > autoWorst) autoWorst = d;
      if (d > pal.band / 2) autoOk = false;
    }
  }
  check("auto: accent-driven hue 29/135/264/330 keeps the ramp in band and guarded (worst " + autoWorst.toFixed(1) + " deg)", autoOk, autoWorst);

  const dusk = VP.paletteById("dusk");
  const ink0 = lumOf(parseCss(dusk.ink(0, 1))), ink7 = lumOf(parseCss(dusk.ink(0.7, 1))), ink1 = lumOf(parseCss(dusk.ink(1, 1)));
  check("ink: ramps dark -> light, and clamps t outside [0,1]",
    ink0 < ink7 && ink7 < ink1 && dusk.ink(-3, 1) === dusk.ink(0, 1) && dusk.ink(5, 1) === dusk.ink(1, 1), { ink0, ink7, ink1 });
  check("palette objects: id/name/h0/band/stops plus bg/ink/accent/tint",
    dusk.id === "dusk" && typeof dusk.name === "string" && dusk.h0 === 305 && dusk.band === 45 &&
    dusk.stops.length >= 5 && ["bg", "ink", "accent", "tint"].every(f => typeof dusk[f] === "function"));
  check("paletteById: hands out copies, so a caller cannot corrupt the master list",
    (function () {
      const a = VP.paletteById("ice"), b = VP.paletteById("ice");
      a.stops[0].L = -99;
      return b.stops[0].L !== -99 && VP.PALETTES[3].stops[0].L !== -99;
    })());
  check("palette methods: default alpha is 1",
    [dusk.bg(), dusk.accent(), dusk.tint(), dusk.ink(0.5)].every(c => CSS_RX.test(c) && /, 1\)$/.test(c)));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
