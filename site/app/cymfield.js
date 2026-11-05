/* Resonance Studio — CYMATIC FIELD LAYER.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Turns the physics in cymatics.js into per-pixel fields the renderer can
 * upload, plus the two particle populations (sand grains and bubbles).
 *
 * Conventions
 * -----------
 * The plate is the unit square / unit disc in (u,v) in [-1,1]^2, whatever its
 * physical size. Every mode grid is normalised so max|value| = 1 before it is
 * cached, so mode weights are comparable across media.
 *
 * A driven field is COMPLEX: re + i*im, where the imaginary part carries the
 * modal phase (~90 deg through resonance). The surface shown at any instant is
 * Re{(re + i*im) * e^{i*theta}} = re*cos(theta) - im*sin(theta), which is the
 * slow-motion snapshot; the sand and the nodal lines follow |field|, which is
 * the envelope the grains actually see over thousands of cycles.
 */
(function () {
  "use strict";

  var C = globalThis.GnauralCymatics;
  if (!C) { console.warn("[cymfield] cymatics.js missing"); return; }

  /* ==================================================================== *
   * Mode grids
   * ==================================================================== */

  function legendreTable(P, n) {
    /* L[i*P+p] = L_p(u_i) */
    var t = new Float64Array(n * P);
    for (var i = 0; i < n; i++) {
      var u = -1 + 2 * i / Math.max(1, n - 1);
      var L0 = 1, L1 = u;
      if (P > 0) t[i * P] = L0;
      if (P > 1) t[i * P + 1] = L1;
      for (var p = 2; p < P; p++) {
        var Lp = ((2 * p - 1) * u * L1 - (p - 1) * L0) / p;
        t[i * P + p] = Lp; L0 = L1; L1 = Lp;
      }
    }
    return t;
  }

  function ritzGrid(mode, N) {
    var P = mode.p, coeff = mode.coeff;
    var L = legendreTable(P, N);
    var tmp = new Float64Array(N * P), out = new Float32Array(N * N);
    var i, j, p, q, s;
    for (i = 0; i < N; i++) {
      for (q = 0; q < P; q++) {
        s = 0;
        for (p = 0; p < P; p++) s += coeff[p * P + q] * L[i * P + p];
        tmp[i * P + q] = s;
      }
    }
    for (j = 0; j < N; j++) {
      for (i = 0; i < N; i++) {
        s = 0;
        for (q = 0; q < P; q++) s += tmp[i * P + q] * L[j * P + q];
        out[i * N + j] = s;
      }
    }
    return out;
  }

  function boltedGrid(mode, N) {
    var out = new Float32Array(N * N);
    var m = mode.m, n = mode.n;
    for (var i = 0; i < N; i++) {
      var u = i / (N - 1), cu_m = Math.cos(m * Math.PI * u), cu_n = Math.cos(n * Math.PI * u);
      for (var j = 0; j < N; j++) {
        var v = j / (N - 1), cv_m = Math.cos(m * Math.PI * v), cv_n = Math.cos(n * Math.PI * v);
        out[i * N + j] = cu_n * cv_m - cu_m * cv_n;
      }
    }
    return out;
  }

  /* Circular modes, separable: radial LUT x cos(m*theta). */
  function circularGrid(mode, N, disc) {
    var out = new Float32Array(N * N);
    var R = new Float64Array(N), m = mode.m | 0, i, j;
    if (disc) {
      var lam = mode.lambda, jm = C.besselJ(m, lam), im = C.besselI(m, lam);
      var ratio = im !== 0 ? jm / im : 0;
      for (i = 0; i < N; i++) {
        var r = i / (N - 1);
        R[i] = C.besselJ(m, lam * r) - ratio * C.besselI(m, lam * r);
      }
    } else {
      var z = mode.j;
      for (i = 0; i < N; i++) R[i] = C.besselJ(m, z * (i / (N - 1)));
    }
    for (i = 0; i < N; i++) {
      var u = -1 + 2 * i / (N - 1);
      for (j = 0; j < N; j++) {
        var v = -1 + 2 * j / (N - 1);
        var rr = Math.sqrt(u * u + v * v);
        if (rr > 1) { out[i * N + j] = 0; continue; }
        var th = Math.atan2(v, u);
        var rad = R[Math.min(N - 1, Math.round(rr * (N - 1)))];
        out[i * N + j] = rad * (m === 0 ? 1 : Math.cos(m * th));
      }
    }
    return out;
  }

  function planeGrid(kx, ky, phase, N) {
    var out = new Float32Array(N * N);
    for (var i = 0; i < N; i++) {
      var u = -1 + 2 * i / (N - 1);
      for (var j = 0; j < N; j++) {
        var v = -1 + 2 * j / (N - 1);
        out[i * N + j] = Math.cos(kx * u + ky * v + phase);
      }
    }
    return out;
  }

  /* ==================================================================== *
   * Field: complex modal sum on a grid
   * ==================================================================== */

  function Field(medium, N) {
    this.medium = medium;
    this.N = N || 256;
    this.cache = {};                 /* mode index -> Float32Array grid */
    this.cacheOrder = [];
    this.re = new Float32Array(this.N * this.N);
    this.im = new Float32Array(this.N * this.N);
    this.env = new Float32Array(this.N * this.N);
    this.height = new Float32Array(this.N * this.N);
    this.weights = null;
    this.scale = 1;
    this.maxModes = 48;
    this.active = [];
  }

  Field.prototype.modeGrid = function (i) {
    var key = String(i);
    if (this.cache[key]) return this.cache[key];
    var med = this.medium, m = med.modes[i];
    var N = this.N, grid;
    if (!m) return null;
    if (med.kind === "plate") grid = ritzGrid(m, N);
    else if (med.kind === "bolted") grid = boltedGrid(m, N);
    else if (med.kind === "disc") grid = circularGrid(m, N, true);
    else if (med.kind === "drum") grid = circularGrid(m, N, false);
    else if (med.kind === "water") grid = planeGrid(m.kx, m.ky, m.phase, N);
    else return null;

    /* normalise to max |value| = 1 */
    var mx = 0;
    for (var k = 0; k < grid.length; k++) { var a = grid[k] < 0 ? -grid[k] : grid[k]; if (a > mx) mx = a; }
    if (mx > 0) for (k = 0; k < grid.length; k++) grid[k] /= mx;

    this.cache[key] = grid;
    this.cacheOrder.push(key);
    if (this.cacheOrder.length > this.maxModes) delete this.cache[this.cacheOrder.shift()];
    return grid;
  };

  /* weights: {re: Float64Array, im: Float64Array} indexed by mode */
  Field.prototype.setWeights = function (re, im) {
    this.weights = { re: re, im: im };
    this.update();
  };

  Field.prototype.update = function () {
    var N = this.N, n2 = N * N, med = this.medium;
    this.re.fill(0); this.im.fill(0);
    var active = [], i, k;
    if (this.weights) {
      for (i = 0; i < med.modes.length; i++) {
        var wr = this.weights.re[i] || 0, wi = this.weights.im[i] || 0;
        if (wr * wr + wi * wi < 1e-6) continue;
        var g = this.modeGrid(i);
        if (!g) continue;
        active.push({ g: g, wr: wr, wi: wi });
        for (k = 0; k < n2; k++) { this.re[k] += g[k] * wr; this.im[k] += g[k] * wi; }
      }
    }
    this.active = active;
    var mx = 0;
    for (k = 0; k < n2; k++) {
      var v = Math.sqrt(this.re[k] * this.re[k] + this.im[k] * this.im[k]);
      this.env[k] = v;
      if (v > mx) mx = v;
    }
    this.scale = mx > 1e-9 ? 1 / mx : 1;
    for (k = 0; k < n2; k++) { this.re[k] *= this.scale; this.im[k] *= this.scale; this.env[k] *= this.scale; }
    return this;
  };

  /* Height at a slow-motion phase (theta = 0 is the real snapshot). */
  Field.prototype.heightAt = function (theta) {
    var c = Math.cos(theta), s = Math.sin(theta), n2 = this.N * this.N, k;
    for (k = 0; k < n2; k++) this.height[k] = this.re[k] * c - this.im[k] * s;
    return this.height;
  };

  /* Bilinear sample of the envelope, u,v in [-1,1]. Returns 0 outside. */
  Field.prototype.envAt = function (u, v) {
    var N = this.N;
    var x = (u + 1) * 0.5 * (N - 1), y = (v + 1) * 0.5 * (N - 1);
    if (x < 0 || y < 0 || x > N - 1 || y > N - 1) return 0;
    var i = x | 0, j = y | 0, fx = x - i, fy = y - j;
    var i1 = i < N - 1 ? i + 1 : i, j1 = j < N - 1 ? j + 1 : j;
    var a = this.env[i * N + j], b = this.env[i1 * N + j], c = this.env[i * N + j1], d = this.env[i1 * N + j1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  /* Gradient of env^2 (what sand responds to), by central differences. */
  Field.prototype.gradEnv2 = function (u, v, out) {
    var h = 2 / (this.N - 1) * 1.5;
    var e0 = this.envAt(u, v);
    var gx = (this.envAt(u + h, v) - this.envAt(u - h, v)) / (2 * h);
    var gy = (this.envAt(u, v + h) - this.envAt(u, v - h)) / (2 * h);
    out[0] = 2 * e0 * gx; out[1] = 2 * e0 * gy;
  };

  /* ==================================================================== *
   * Sand grains
   * ==================================================================== */

  function Sand(count, seed) {
    this.n = count || 3600;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.size = new Float32Array(this.n);
    this.rng = mulberry32(seed === undefined ? 1234567 : seed);
    this.reset();
  }
  Sand.prototype.reset = function () {
    for (var i = 0; i < this.n; i++) {
      this.x[i] = this.rng() * 2 - 1;
      this.y[i] = this.rng() * 2 - 1;
      this.vx[i] = 0; this.vy[i] = 0;
      this.size[i] = 0.35 + this.rng() * 0.9;
    }
  };
  Sand.prototype.step = function (field, dt, drive, opts) {
    opts = opts || {};
    var circle = field.medium.geometry === "circle";
    var g = [0, 0];
    var strength = opts.strength === undefined ? 9 : opts.strength;
    var damp = opts.damp === undefined ? 0.16 : opts.damp;
    var jitter = (opts.jitter === undefined ? 0.55 : opts.jitter) * (0.25 + drive);
    var dtc = Math.min(dt, 1 / 30);
    for (var i = 0; i < this.n; i++) {
      var u = this.x[i], v = this.y[i];
      field.gradEnv2(u, v, g);
      /* drift downhill on the envelope (towards nodal lines) */
      var ax = -g[0] * strength, ay = -g[1] * strength;
      /* pinch toward the disc when near the rim */
      if (circle) {
        var rr = Math.sqrt(u * u + v * v);
        if (rr > 0.97) { ax -= u / rr * 4; ay -= v / rr * 4; }
      }
      this.vx[i] += (ax - this.vx[i] / damp) * dtc;
      this.vy[i] += (ay - this.vy[i] / damp) * dtc;
      var n1 = (this.rng() - 0.5), n2 = (this.rng() - 0.5);
      this.x[i] += this.vx[i] * dtc + n1 * jitter * Math.sqrt(dtc) * 0.05;
      this.y[i] += this.vy[i] * dtc + n2 * jitter * Math.sqrt(dtc) * 0.05;
      if (this.x[i] > 1) { this.x[i] = 1; this.vx[i] *= -0.2; }
      if (this.x[i] < -1) { this.x[i] = -1; this.vx[i] *= -0.2; }
      if (this.y[i] > 1) { this.y[i] = 1; this.vy[i] *= -0.2; }
      if (this.y[i] < -1) { this.y[i] = -1; this.vy[i] *= -0.2; }
      if (circle && this.x[i] * this.x[i] + this.y[i] * this.y[i] > 1) {
        var r2 = Math.sqrt(this.x[i] * this.x[i] + this.y[i] * this.y[i]) || 1;
        this.x[i] /= r2; this.y[i] /= r2;
      }
    }
  };

  /* ==================================================================== *
   * Bubbles
   * ==================================================================== */

  var MINNAERT_K = 3.287;            /* f_M * R = 3.287 m/s for air in water */

  /* Measured total damping Q of a free air bubble in water (thermal + viscous
   * + radiation): 58, 53, 49, 42, 35 at 50/100/200/440/1000 Hz. Interpolated in
   * log-frequency. The resonance half-width is 1/Q, and that is what sets how
   * narrow the "matched radius" band really is. */
  var Q_TABLE = [[50, 58], [100, 53], [200, 49], [440, 42], [1000, 35]];
  function bubbleQ(f) {
    f = Math.max(10, f);
    if (f <= Q_TABLE[0][0]) return Q_TABLE[0][1];
    for (var i = 1; i < Q_TABLE.length; i++) {
      if (f <= Q_TABLE[i][0]) {
        var a = Q_TABLE[i - 1], b = Q_TABLE[i];
        var u = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return Q_TABLE[Q_TABLE.length - 1][1];
  }

  function Bubbles(count, seed) {
    this.n = count || 900;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.r = new Float32Array(this.n);       /* display radius, unit-disc units */
    this.rad = new Float32Array(this.n);     /* physical radius, metres          */
    this.glow = new Float32Array(this.n);
    this.z = new Float32Array(this.n);      /* log-radius, kept for retuning */
    this.rng = mulberry32(seed === undefined ? 987654 : seed);
    this.reset();
  }
  Bubbles.prototype.reset = function () {
    for (var i = 0; i < this.n; i++) {
      this.x[i] = this.rng() * 2 - 1;
      this.y[i] = this.rng() * 2 - 1;
      var rr = Math.sqrt(this.x[i] * this.x[i] + this.y[i] * this.y[i]);
      if (rr > 1) { this.x[i] /= rr; this.y[i] /= rr; }
      this.vx[i] = 0; this.vy[i] = 0;
      /* log-normal-ish distribution, retuned to the tone later */
      this.z[i] = (this.rng() + this.rng() + this.rng() - 1.5) * 0.9;
      this.r[i] = Math.max(0.004, 0.018 * Math.exp(this.z[i]));
      this.rad[i] = this.r[i] * 0.02;
    }
  };
  /* f -> the bubble radius that resonates with it (Minnaert). */
  Bubbles.resonantRadius = function (f) { return MINNAERT_K / Math.max(1, f); };
  Bubbles.bubbleQ = bubbleQ;

  /* A real bubble field spans sizes around whatever the tone can drive. If the
   * population stayed at one fixed size, EVERY bubble would be far below
   * resonance at audio frequencies and the Bjerknes sign flip would never be
   * seen. So the log-radius sample is re-centred on R_res when the tone moves
   * by more than 8%. */
  Bubbles.prototype.retune = function (fDrive) {
    var Rres = Bubbles.resonantRadius(fDrive);
    if (!this._Rres) {
      for (var i = 0; i < this.n; i++) this.rad[i] = Rres * Math.exp(this.z[i] * 0.85);
    } else {
      var k = Rres / this._Rres;
      for (i = 0; i < this.n; i++) this.rad[i] *= k;
    }
    this._Rres = Rres;
    for (i = 0; i < this.n; i++) {
      this.r[i] = clamp(this.rad[i] * 2.2, 0.004, 0.055);
    }
  };
  Bubbles.prototype.step = function (field, dt, fDrive, drive, opts) {
    opts = opts || {};
    var Rres = Bubbles.resonantRadius(fDrive);
    if (!this._Rres || Math.abs(Rres - this._Rres) / this._Rres > 0.08) this.retune(fDrive);
    var g = [0, 0], dtc = Math.min(dt, 1 / 30);
    var trap = opts.trap === undefined ? 1.6 : opts.trap;
    var rise = opts.rise === undefined ? 0.10 : opts.rise;
    for (var i = 0; i < this.n; i++) {
      field.gradEnv2(this.x[i], this.y[i], g);
      /* Bjerknes: below resonance the bubble is stiffness-controlled and moves
       * to pressure ANTIODES, which are displacement NODES on this surface;
       * above resonance it is mass-controlled and moves to the lobes. */
      var sign = (this.rad[i] < Rres) ? -1 : 1;
      var coupling = trap * sign * Math.min(1, 3 * Math.abs(fDrive * this.rad[i] / MINNAERT_K - 1));
      var ax = g[0] * coupling, ay = g[1] * coupling;
      /* buoyancy: bigger bubbles rise faster (Stokes, v ~ R^2) */
      ay += rise * (this.rad[i] / Rres) * (this.rad[i] / Rres);
      /* a little swirl so the field never freezes */
      ax += Math.sin(this.y[i] * 3.1 + performance.now() * 0.0002) * 0.02;
      this.vx[i] += (ax - this.vx[i] * 1.8) * dtc;
      this.vy[i] += (ay - this.vy[i] * 1.8) * dtc;
      this.x[i] += this.vx[i] * dtc;
      this.y[i] += this.vy[i] * dtc;
      var rr = Math.sqrt(this.x[i] * this.x[i] + this.y[i] * this.y[i]);
      if (rr > 1) { this.x[i] /= rr; this.y[i] /= rr; this.vx[i] *= 0.5; this.vy[i] *= 0.5; }
      /* resonance glow: only bubbles within a couple of line-widths of the
       * Minnaert radius respond at all (half-width = 1/Q). */
      var d = Math.abs(this.rad[i] - Rres) / Rres;
      this.glow[i] = Math.max(0, 1 - d * bubbleQ(fDrive) * 0.35) * (0.4 + 0.6 * drive);
    }
  };

  /* ==================================================================== *
   * Water: plane-wave Faraday field
   * ==================================================================== */

  /* Build a water "medium" whose modes are plane waves at the Faraday
   * wavenumber for the drive. Pattern family is selected by drive level.
   * Returns a medium object compatible with Field. */
  function waterMedium(opts) {
    opts = opts || {};
    var fDrive = Math.max(20, opts.f || 100);
    var size = opts.size || 0.2;               /* tank, metres */
    var lambda = C.faradayWavelength(fDrive);  /* true wavelength, metres */
    var nAcross = size / lambda;
    /* A real tank at 100 Hz holds ~35 wavelengths; on screen that is a moire.
     * Compress to a legible count and SAY SO in the physics panel. */
    var displayed = Math.min(12, Math.max(4, nAcross));
    var k = Math.PI * displayed;               /* u spans 2 units -> 2*pi*N/2 */
    var modes = [];
    /* Opposite k-vectors are the SAME standing wave: they must share a phase,
     * or the lattice turns into a travelling moire. */
    function add(angle, family, amp, pair) {
      modes.push({
        i: modes.length, kx: k * Math.cos(angle), ky: k * Math.sin(angle),
        /* phase 0 keeps each opposite pair a pure standing wave: a phase
         * offset would turn half of it into a travelling component and
         * collapse the lattice into stripes. */
        phase: 0, f: fDrive, kind: "water",
        family: family, amp: amp, pair: pair
      });
    }
    var i;
    for (i = 0; i < 2; i++) add(Math.PI * i, "stripe", 1, 0);
    for (i = 0; i < 6; i++) add(Math.PI / 3 * i, "hex", 1 / Math.sqrt(3), i % 3);
    for (i = 0; i < 4; i++) add(Math.PI / 2 * i, "square", 1 / Math.sqrt(2), i % 2);
    for (i = 0; i < 12; i++) add(Math.PI / 6 * i, "quasi", 1 / Math.sqrt(6), i % 6);
    return {
      kind: "water", geometry: "square", modes: modes, size: size,
      fDrive: fDrive, lambda: lambda, wavelengths: nAcross, displayWaves: displayed,
      fMin: fDrive, fMax: fDrive
    };
  }

  /* Weights for the water pattern family. amp: 0..1 drive level.
   * Pattern selection is a model (stripes -> hexagons -> squares ->
   * quasi-crystal with rising drive), matching the documented sequence. */
  function waterWeights(medium, amp, t) {
    var n = medium.modes.length;
    var re = new Float64Array(n), im = new Float64Array(n);
    function bump(x, a, b) {
      var mid = (a + b) / 2, half = Math.max(1e-6, (b - a) / 2);
      return clamp(1 - Math.abs(x - mid) / half, 0, 1);
    }
    var fam = {
      stripe: bump(amp, -0.05, 0.30),
      hex: bump(amp, 0.18, 0.55),
      square: bump(amp, 0.48, 0.80),
      quasi: bump(amp, 0.74, 1.05)
    };
    /* The panel should read "squares 100%", not a raw bump value: normalise
     * the family strengths against the strongest one. */
    var famMax = Math.max(fam.stripe, fam.hex, fam.square, fam.quasi);
    if (famMax > 1e-6) {
      for (var fk in fam) fam[fk] = fam[fk] / famMax;
    }
    var total = 0;
    for (var i = 0; i < n; i++) total += fam[medium.modes[i].family] * medium.modes[i].amp;
    if (total < 1e-6) { fam.stripe = 1; total = 1; }
    for (i = 0; i < n; i++) {
      var m = medium.modes[i];
      var w = fam[m.family] * m.amp / total;
      var ph = t * (0.10 + m.pair * 0.019) + m.phase;
      re[i] = w * Math.cos(ph);
      im[i] = w * Math.sin(ph);
    }
    return { re: re, im: im, family: fam };
  }

  /* ==================================================================== *
   * Airborne dust
   * ==================================================================== */

  /* The site-effect vocabulary (emitter, turbulence, decay, gravity, settle,
   * sparkle) mapped onto the driven plate. Dust is a MODEL of aerosol
   * transport, not a solved acoustic force: grains are lifted where the plate
   * moves most, blown along the envelope gradient toward the nodal set, and
   * settle there when the drive falls. The numbers below are the whole mapping
   * - nothing else carries a magic constant.
   *
   * grav is +down. Bubbles float (negative), water sprays and falls hard. */
  var DUST_MAP = {
    lift: 1.35,          /* upward throw, x drive x local envelope */
    drift: 4.2,          /* accel along -grad(env^2) x drive (toward nodes) */
    turb: 0.22,          /* random accel, scaled up in nodal regions */
    dragPlate: 0.85,
    dragWater: 0.42,
    gravPlate: 0.45,     /* a quiet plate has to beat lift so grains commit */
    gravWater: 1.10,
    gravBubbles: -0.30,
    maxSpeed: 2.4,
    launch: 0.36,        /* upward kick at respawn (x drive is added by lift) */
    launchWater: 0.95,
    settleRate: 1.6,
    releaseRate: 2.2,
    setAt: 0.55,
    decayMin: 0.06,      /* a grain lives 2.8-16 s, so it can actually travel */
    decaySpan: 0.30,
    ceiling: 2.20,
    rim: 1.15            /* grains may drift past the plate edge and fade out */
  };

  function Dust(count, seed) {
    this.n = count || 4000;
    this.x = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    this.vx = new Float32Array(this.n);
    this.vy = new Float32Array(this.n);
    this.vz = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.size = new Float32Array(this.n);
    this.set = new Float32Array(this.n);
    this.dwell = new Float32Array(this.n);
    this.rng = mulberry32(seed === undefined ? 7654321 : seed);
    this.maxY = DUST_MAP.ceiling;
    this.reset();
  }

  /* Lift a grain at an antinode: a few candidates, keep the busiest. This is
   * the emitter-position idea, chosen by the field instead of by a pointer. */
  Dust.prototype.emit = function (field, i) {
    var bu = this.rng() * 2 - 1, bv = this.rng() * 2 - 1, best = field.envAt(bu, bv);
    if (this.rng() > 0.30) {
      for (var k = 0; k < 4; k++) {
        var u = this.rng() * 2 - 1, v = this.rng() * 2 - 1, e = field.envAt(u, v);
        if (e > best) { best = e; bu = u; bv = v; }
      }
    }
    if (field.medium.geometry === "circle") {
      var r = Math.hypot(bu, bv) || 1;
      if (r > 0.97) { bu *= 0.97 / r; bv *= 0.97 / r; }
    }
    this.x[i] = bu; this.y[i] = bv;
    /* bias the column high: grains that spawn on the surface merge into a fog
     * patch, so most start already airborne. 30 % skip the antinode search so
     * the whole plate gets some dust, not just the loud lobe. */
    this.z[i] = 0.05 + Math.pow(this.rng(), 0.7) * 0.8;
    this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0.02 + this.rng() * 0.05;
    this.life[i] = this.rng() * 0.55;
    this.size[i] = 0.5 + this.rng() * 1.3;
    this.set[i] = 0;
    this.dwell[i] = 0;
  };

  /* reset() seeds from the live field when it has one, so the first frame is
   * already biased to the antinodes rather than uniform noise */
  Dust.prototype.reset = function (field) {
    var stub = { envAt: function () { return 0.5; }, medium: { geometry: "square" } };
    var src = field || stub;
    for (var i = 0; i < this.n; i++) {
      this.emit(src, i);
      if (field) this.z[i] = this.rng() * this.maxY;
      this.life[i] = this.rng();
    }
  };

  Dust.prototype.step = function (field, dt, drive, opts) {
    opts = opts || {};
    var circle = field.medium.geometry === "circle";
    var grav = opts.grav === undefined ? DUST_MAP.gravPlate : opts.grav;
    var drag = opts.drag === undefined ? DUST_MAP.dragPlate : opts.drag;
    var lift = (opts.lift === undefined ? DUST_MAP.lift : opts.lift) * drive;
    var decay = DUST_MAP.decayMin + DUST_MAP.decaySpan * drive;
    var g = [0, 0];
    var dtc = Math.min(dt, 1 / 30);

    for (var i = 0; i < this.n; i++) {
      this.life[i] += decay * dtc;
      if (this.life[i] >= 1) {
        this.emit(field, i);
        this.vz[i] = (opts.launch === undefined ? DUST_MAP.launch : opts.launch) * (0.5 + this.rng());
        continue;
      }

      var u = this.x[i], v = this.y[i];
      var env = field.envAt(u, v);
      /* Release a settled grain only when the plate really moves here. */
      if (this.set[i] > 0) {
        this.set[i] -= DUST_MAP.releaseRate * drive * (0.35 + env) * dtc;
        if (this.set[i] <= 0) { this.set[i] = 0; this.dwell[i] = 0; this.vz[i] = 0.05; }
      }

      field.gradEnv2(u, v, g);
      /* turbulence is strongest over the nodal set (env ~ 0), where the plate
       * is still; over an antinode the air is comparatively calm */
      var turb = DUST_MAP.turb * (0.35 + (1 - env)) * (0.3 + drive);
      var ax = (-g[0] * DUST_MAP.drift * drive + (this.rng() - 0.5) * turb) * dtc;
      var ay = (-g[1] * DUST_MAP.drift * drive + (this.rng() - 0.5) * turb) * dtc;
      var az = (-grav * (1 - drive * 0.55) +
        lift * (env * 1.6 + 0.2) + (this.rng() - 0.5) * turb) * dtc;

      if (this.set[i] > DUST_MAP.setAt) {
        /* settled: hold position, only a little shiver */
        this.x[i] += Math.sin(this.life[i] * 40 + i) * 0.0006;
        this.y[i] += Math.cos(this.life[i] * 37 + i) * 0.0006;
        continue;
      }

      this.vx[i] = (this.vx[i] + ax) * (1 - Math.min(0.9, drag * dtc));
      this.vy[i] = (this.vy[i] + ay) * (1 - Math.min(0.9, drag * dtc));
      this.vz[i] = (this.vz[i] + az) * (1 - Math.min(0.9, drag * dtc));
      var sp = Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
      if (sp > DUST_MAP.maxSpeed) {
        var k = DUST_MAP.maxSpeed / sp;
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.x[i] += this.vx[i] * dtc;
      this.y[i] += this.vy[i] * dtc;
      this.z[i] += this.vz[i] * dtc;

      /* the plate is the floor. A grain that rests here for a moment SETS: the
       * dwell timer is what stops turbulence (which never goes to zero) from
       * re-throwing every grain forever, and the speed term only decides how
       * fast a resting grain sticks. The band is 0.02 because a settling grain
       * lifts a hair off the surface on every bounce - testing the exact floor
       * height zeroed the timer each frame and nothing ever settled. */
      if (this.z[i] <= 0.02) {
        if (this.z[i] <= 0.006) {
          this.z[i] = 0.006;
          this.vz[i] = Math.abs(this.vz[i]) * 0.12;
          this.vx[i] *= 0.7; this.vy[i] *= 0.7;
        }
        this.dwell[i] += dtc;
        if (this.dwell[i] > 0.35) {
          this.set[i] += DUST_MAP.settleRate * dtc * (1 - Math.min(1, sp / DUST_MAP.maxSpeed));
        }
      } else {
        this.dwell[i] = Math.max(0, this.dwell[i] - dtc * 2);
      }
      if (this.z[i] > this.maxY) { this.z[i] = this.maxY; this.vz[i] = -Math.abs(this.vz[i]) * 0.3; }

      if (this.x[i] > DUST_MAP.rim) { this.x[i] = DUST_MAP.rim; this.vx[i] *= -0.3; }
      if (this.x[i] < -DUST_MAP.rim) { this.x[i] = -DUST_MAP.rim; this.vx[i] *= -0.3; }
      if (this.y[i] > DUST_MAP.rim) { this.y[i] = DUST_MAP.rim; this.vy[i] *= -0.3; }
      if (this.y[i] < -DUST_MAP.rim) { this.y[i] = -DUST_MAP.rim; this.vy[i] *= -0.3; }
      if (circle && this.x[i] * this.x[i] + this.y[i] * this.y[i] > DUST_MAP.rim * DUST_MAP.rim) {
        var r2 = Math.hypot(this.x[i], this.y[i]) || 1;
        this.x[i] *= DUST_MAP.rim / r2; this.y[i] *= DUST_MAP.rim / r2;
      }
    }
  };

  /* ==================================================================== *
   * utilities
   * ==================================================================== */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  globalThis.GnauralCymField = {
    version: 1,
    Field: Field, Sand: Sand, Bubbles: Bubbles, Dust: Dust, DUST_MAP: DUST_MAP,
    waterMedium: waterMedium, waterWeights: waterWeights,
    ritzGrid: ritzGrid, boltedGrid: boltedGrid, circularGrid: circularGrid, planeGrid: planeGrid,
    MINNAERT_K: MINNAERT_K, bubbleQ: bubbleQ,
  };
})();
