/* Gnaural Web — Resonance Studio: visualizer renderers (pure canvas2d, no DOM coupling).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * THIRTEEN VISUALIZERS, one contract. Every mode draws from the SAME frame
 * object F supplied by viz.js, which is built from the phase-exact mirrors in
 * vizmath.js (Cursor / GateMirror / EnvPhase / PhaseMirror) plus the measured
 * AnalyserNode features. The rendering rules follow the research briefs that
 * ship beside this build (see cache/resonance/visualizers-design.md):
 *
 *   - f0 (carrier) maps to SPATIAL scale; beat rate maps to TEMPORAL scale,
 *     divided by N so visible motion never exceeds 2 Hz
 *     (f_vis = cappedRate(rate); label shows "xN").
 *   - beat PHASE maps to displacement/geometry, never to luminance.
 *   - luminance excursions are small and slow (attack >= 0.3 s, release
 *     >= 0.45 s, amplitude scaled by prefs.intensity and the LUM budget);
 *     no shadowBlur, no ctx.filter, no per-frame gradient creation,
 *     no full-panel putImageData, <= 1 additive composite per mode.
 *   - every structural random decision comes from the instance seed
 *     (mulberry32); per-frame jitter uses a separate stream.
 *
 * Frame object F (built by viz.js):
 *   { ctx, W, H, dt, t, playing, dpr, prefs, pal, rng (frame stream),
 *     lum (0..0.08 luminance budget),            audio:
 *     feat: { rms, rmsAtt, rmsSlow, bands:{sub,low,carrier,mid,air},
 *             bandsAtt, bandsSlow, centroid, centroidSlow, flux, sync },
 *     voices: [ { i, kind, type, base, rate, volL, volR, vol,
 *                 u, att,
 *                 gate: { open, phase, vis, pulse, N, visRate, cycleTotal },
 *                 env:  { phase, vis, level, N, visRate, cycleTotal },
 *                 sinL, sinR, fL, fR } ],
 *     field: { W, x0 } | null }
 *
 * Mode contract: create(id, ctxSeed) -> instance { id, reset(F), draw(F) }.
 * Instances are re-created on resize and on scramble (deterministic from seed).
 */
(function () {
  "use strict";

  var VP = globalThis.GnauralVizPal;     /* palette/noise/random utilities     */
  var VM = globalThis.GnauralVizMath;    /* verified sync kernel               */
  var clamp = VP ? VP.clamp : function (x, a, b) { return x < a ? a : (x > b ? b : x); };
  var lerp = VP ? VP.lerp : function (a, b, t) { return a + (b - a) * t; };
  var smoothstep = VP ? VP.smoothstep : function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  var TAU = Math.PI * 2;

  /* Palette accessor with fallbacks so a cache-mixed deploy can never crash. */
  function ink(F, t, a) { return F.pal ? F.pal.ink(t, a) : "rgba(242,230,216," + a + ")"; }
  function accent(F, a) { return F.pal ? F.pal.accent(a) : "rgba(255,158,79," + a + ")"; }
  function veil(F, a) { return F.pal ? F.pal.bg(a) : "rgba(14,11,9," + a + ")"; }

  /* ==================================================================== *
   * helpers shared by modes
   * ==================================================================== */

  function mkLayer(w, h) {
    var c = (typeof document !== "undefined") ? document.createElement("canvas") : null;
    if (!c) return null;
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function fitLayer(layer, W, H, dpr) {
    var w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; }
    var c2 = layer.getContext("2d");
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c2;
  }

  /* The primary rate voice for pulse-like modes: prefer iso (explicit pulse),
   * else binaural (envelope), else null. */
  function pulseVoice(F) {
    var iso = null, bin = null, idle = null;
    for (var i = 0; i < F.voices.length; i++) {
      var v = F.voices[i];
      if (v.kind === "iso" || v.kind === "isoalt") { if (!iso || v.att > iso.att) iso = v; }
      else if (v.kind === "binaural") { if (!bin || v.att > bin.att) bin = v; }
      else if (v.kind === "idle") idle = v;
    }
    return iso || bin || idle;      /* idle: the paused-state drift pseudo-voice */
  }

  /* envelope level of a voice in 0..1 (binaural: slowed cos^2; iso: pulse) */
  function levelOf(v) {
    if (v.kind === "binaural") return v.env.level;
    if (v.kind === "iso" || v.kind === "isoalt") return v.gate.pulse;
    if (v.kind === "idle") return v.env.level;
    return 0;
  }

  function rateLabel(v, out) {
    if (!v || !v.gate && !v.env) return "";
    var N = (v.kind === "binaural") ? v.env.N : v.gate.N;
    if (N > 1) return "x" + N + " slowed";
    return "";
  }

  /* ==================================================================== *
   * BACKDROPS
   * ==================================================================== */

  /* ---------------------------------------------------------------- Tide *
   * One slow luminance swell filling both strips: a wide water-line drawn in
   * FIELD coordinates so the two flanks are windows onto one surface. The
   * phase is the session's slowest rate (the breath of the session); the
   * beat phase pushes the line (displacement, never luminance).            */
  function Tide(seed) {
    var r = VP.mulberry32(seed);
    this.s = {
      humps: 2 + Math.floor(r() * 4),
      drift: 0.6 + r() * 1.4,
      phase: r() * TAU,
      glintY: 0.24 + r() * 0.5
    };
    this.r0 = r;
  }
  Tide.prototype.reset = function () {};
  Tide.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, W = F.W, H = F.H;
    var fw = F.field ? F.field.W : W;
    var v = pulseVoice(F);
    /* slow phase: the voice's slowed cycle position, else an idle 45 s breath */
    var ph = v ? (v.kind === "binaural" ? mod1(v.env.cycleTotal / Math.max(1, v.env.N)) : mod1(v.gate.cycleTotal / Math.max(1, v.gate.N)))
             : mod1(F.t / 45);
    var lvl = v ? levelOf(v) : 0.5 + 0.5 * Math.sin(F.t / 45 * TAU);
    var amp = H * (0.010 + 0.030 * F.pre.intensity) * (0.6 + 0.7 * lvl);
    /* the swell displaces the line's vertical centre (motion channel)      */
    var yc = H * s.glintY + amp * (1.4 + 0.8 * Math.sin(ph * TAU));
    var k = (TAU * s.humps) / fw;
    var PH = 62, i, x, y;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, yc);
    for (i = 0; i <= PH; i++) {
      x = (i / PH) * fw;
      y = yc
        + amp * 1.6 * Math.sin(k * x + ph * TAU * 0.5 + s.phase)
        + amp * 0.8 * Math.sin(2.1 * k * x - ph * TAU * 0.7 + s.phase * 1.7);
      ctx.lineTo(x, y);
    }
    for (i = PH; i >= 0; i--) {
      x = (i / PH) * fw;
      ctx.lineTo(x, H);
    }
    ctx.closePath();
    ctx.fillStyle = veil(F, 0.55 + 0.25 * F.pre.intensity);
    ctx.fill();
    /* the surface line: one soft stroke + one brighter core */
    ctx.beginPath();
    for (i = 0; i <= PH; i++) {
      x = (i / PH) * fw;
      y = yc
        + amp * 1.6 * Math.sin(k * x + ph * TAU * 0.5 + s.phase)
        + amp * 0.8 * Math.sin(2.1 * k * x - ph * TAU * 0.7 + s.phase * 1.7);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = accent(F, 0.10 + 0.16 * F.pre.intensity + F.lum * 2.2 * lvl);
    ctx.globalCompositeOperation = "lighter";
    ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = ink(F, 0.9, 0.16 + 0.20 * F.pre.intensity);
    ctx.stroke();
    ctx.restore();
  };

  /* --------------------------------------------------------------- Drift *
   * Parallax dust across the whole field. Drift speed is the spectral
   * centroid (slowly followed); twinkle is the band energies; positions are
   * seeded. In field coordinates, so dust crosses behind the page.         */
  function Drift(seed) {
    var r = VP.mulberry32(seed);
    this.s = { layers: [], P: 0 };
    for (var L = 0; L < 3; L++) {
      var n = 40 + Math.floor(r() * 40);
      var pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({ x: r(), y: r(), z: 0.25 + 0.75 * ((L + r()) / 3), ph: r() * TAU, tw: 0.4 + r() * 1.8 });
      }
      this.s.layers.push({ pts: pts, vz: 0.020 + 0.05 * (L / 2) + r() * 0.02 });
      this.s.P += n;
    }
  }
  Drift.prototype.reset = function () {};
  Drift.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx;
    var fw = F.field ? F.field.W : F.W, H = F.H;
    var bands = F.feat.bandsAtt || {};
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var L = 0; L < s.layers.length; L++) {
      var lay = s.layers[L], pts = lay.pts, a = 0.05 + 0.05 * L + 0.16 * F.pre.intensity * 0.5;
      ctx.fillStyle = ink(F, 0.55 + 0.25 * L, Math.min(0.5, a));
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var twk = 0.55 + 0.45 * Math.sin(F.t * p.tw + p.ph);
        var bright = twk * (0.35 + 0.9 * (bands.mid || 0) + 0.5 * (bands.air || 0));
        if (bright < 0.06) continue;
        var x = p.x * fw, y = p.y * H;
        var sz = 1 + 1.6 * p.z * (0.6 + bright);
        ctx.globalAlpha = clamp(bright * (0.5 + 0.5 * p.z), 0, 0.85);
        ctx.fillRect(x, y, sz, sz);
      }
    }
    ctx.restore();
  };
  /* drift advance is time-based; done in a separate helper so draw stays flat */
  Drift.prototype.step = function (F) {
    var s = this.s;
    var c = F.feat.centroidSlow || F.feat.centroid || 300;
    var u = clamp(Math.log(Math.max(40, c) / 40) / Math.log(12.5), 0, 1);
    var px = (4 + 30 * u) * (0.4 + F.pre.intensity) * F.dt;
    var fw = F.field ? F.field.W : F.W;
    var side = (F.voices[0] && F.voices[0].kind === "binaural") ? (F.voices[0].env.level - 0.5) : 0;
    for (var L = 0; L < s.layers.length; L++) {
      var lay = s.layers[L], pts = lay.pts;
      var vx = px * (0.35 + 0.65 * L / 2) * (1 + 0.2 * side);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        p.x += vx / fw;
        if (p.x > 1.02) { p.x -= 1.04; p.y = (p.y + 0.37) % 1; }
      }
    }
  };

  /* ------------------------------------------------------------ Rainfall *
   * The (long-planned) sleep visual: drops keyed to the hiss band, with
   * beads that stick and slide. Panel-local; seeded; pool-based.            */
  function Rainfall(seed) {
    var r = VP.mulberry32(seed);
    this.r = r;
    this.s = { drops: [], pool: 130, acc: 0, beads: [] };
  }
  Rainfall.prototype.reset = function () {};
  Rainfall.prototype.step = function (F) {
    var s = this.s, H = F.H, W = F.W;
    var air = (F.feat.bandsAtt && F.feat.bandsAtt.air) || 0;
    var sub = (F.feat.bandsAtt && F.feat.bandsAtt.sub) || 0;
    var rate = 3 + 120 * clamp(F.pre.intensity * air * 1.8, 0, 1);
    s.acc += rate * F.dt;
    while (s.acc >= 1 && s.drops.length < s.pool) {
      s.acc -= 1;
      var bead = this.r() < 0.10;
      s.drops.push({
        x: this.r() * W,
        y: -12 - this.r() * 30,
        v: 90 + this.r() * 190 * (0.5 + F.pre.intensity),
        len: 6 + this.r() * 16,
        a: 0.05 + this.r() * 0.13,
        bead: bead, stuck: 0, slide: 0
      });
    }
    for (var i = s.drops.length - 1; i >= 0; i--) {
      var d = s.drops[i];
      if (d.stuck > 0) { d.stuck -= F.dt; continue; }
      var vv = d.v * (1 - 0.55 * this.r() * 0.02);
      d.y += vv * F.dt;
      if (d.bead && d.slide > 0) { d.x += 14 * F.dt * d.slide; d.slide -= F.dt; }
      if (d.y > H + 24) s.drops.splice(i, 1);
    }
    /* heavy drops on low-band hits */
    if (sub > 0.55 && this.r() < 0.02) {
      s.drops.push({ x: this.r() * W, y: -18, v: 60 + 60 * this.r(), len: 28 + 20 * this.r(), a: 0.10, bead: false });
    }
  };
  Rainfall.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx;
    var slow = s.drops.length > 60 ? 2 : 1;      /* style-grouping pass        */
    ctx.save();
    ctx.lineWidth = 1;
    /* one mixed-alpha stroke pass keeps this to ~2 style changes */
    for (var pass = 0; pass < 3; pass++) {
      var a = [0.10, 0.05, 0.16][pass];
      ctx.strokeStyle = ink(F, pass === 2 ? 0.9 : 0.6, a);
      ctx.beginPath();
      for (var i = 0; i < s.drops.length; i += slow) {
        var d = s.drops[i];
        if ((i % 3) !== pass) continue;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, d.y + d.len + (d.bead ? 2 : 0));
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  /* --------------------------------------------------------------- Score *
   * Slit-scan spectrum waterfall. Measured log bands when a bed is present;
   * otherwise the exact harmonic series of the active carrier (k*f0, 1/k) —
   * never a dead flat analyser. Newest column on the right.                */
  function Score(seed) {
    this.seed = seed;
    this.layer = null;
    this.c2 = null;
    this.s = { x: 0 };
  }
  Score.prototype.reset = function () { if (this.c2) { this.c2.setTransform(1, 0, 0, 1, 0, 0); this.c2.clearRect(0, 0, this.layer.width, this.layer.height); } this.s.x = 0; };
  Score.prototype.ensure = function (F) {
    if (!this.layer) { this.layer = mkLayer(F.W * F.dpr, F.H * F.dpr); this.c2 = this.layer.getContext("2d", { willReadFrequently: false }); }
    var dpr = F.dpr;
    if (this.layer.width !== Math.round(F.W * dpr) || this.layer.height !== Math.round(F.H * dpr)) {
      this.layer.width = Math.round(F.W * dpr); this.layer.height = Math.round(F.H * dpr);
      this.s.x = 0;
    }
    this.c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this.c2;
  };
  Score.prototype.draw = function (F) {
    var c2 = this.ensure(F), W = F.W, H = F.H, s = this.s;
    var B = 72, dB = Math.log(8000 / 30), colW = 2;
    /* scroll left by colW (the drawImage self-blit — 170x cheaper than ImageData) */
    c2.save();
    c2.globalCompositeOperation = "copy";
    c2.drawImage(this.layer, Math.round(colW * F.dpr), 0, this.layer.width - Math.round(colW * F.dpr), this.layer.height, 0, 0, W - colW, H);
    c2.restore();
    /* synthesise or read the spectrum */
    var spec = F.spectrum ? F.spectrum : null;
    var voices = F.voices, tone = null;
    for (var i = 0; i < voices.length; i++) { if (voices[i].kind === "binaural" || voices[i].kind === "iso" || voices[i].kind === "isoalt") { if (!tone || voices[i].vol > tone.vol) tone = voices[i]; } }
    for (var b = 0; b < B; b++) {
      var f = 30 * Math.exp(dB * (b + 0.5) / B);
      var lvl = 0;
      if (spec && spec.length) {
        var bi = clamp(Math.round(f / (F.sampleRate / F.fftSize)), 1, spec.length - 1);
        lvl = spec[bi];
      } else if (tone) {
        /* exact harmonic series of the carrier: k*f0 with 1/k amplitude      */
        for (var k = 1; k <= 8; k++) {
          var fh = tone.base * k;
          var dw = Math.abs(Math.log(f / fh));
          lvl = Math.max(lvl, (tone.att / k) * Math.exp(-dw * dw / (2 * 0.014 * 0.014)));
        }
        lvl *= (tone.kind === "iso" || tone.kind === "isoalt") ? (0.55 + 0.45 * tone.gate.pulse) : (0.45 + 0.55 * levelOf(tone));
      }
      var y = H - H * Math.log(f / 30) / dB;
      var hb = H / B + 0.5;
      var v = clamp(lvl * (0.5 + 0.6 * F.pre.intensity), 0, 1);
      if (v < 0.02) continue;
      c2.fillStyle = ink(F, clamp(0.25 + 0.7 * v, 0, 1), 0.85 * v + 0.05);
      c2.fillRect(W - colW, y - hb, colW, hb);
    }
    s.x = (s.x + colW) % W;
    /* composite onto the panel, then a soft "now" echo at the right edge     */
    F.ctx.save();
    F.ctx.globalAlpha = 0.9;
    F.ctx.drawImage(this.layer, 0, 0, this.layer.width, this.layer.height, 0, 0, W, H);
    F.ctx.restore();
  };

  /* -------------------------------------------------------------- Aurora *
   * Layered light curtains in field coordinates. Curtain phase drifts with
   * the (divided) beat; thickness follows band energy; colours stay in one
   * narrow hue family (the palette).                                       */
  function Aurora(seed) {
    var r = VP.mulberry32(seed);
    this.s = { curtains: [] };
    var n = 3 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) {
      this.s.curtains.push({
        y0: 0.10 + 0.16 * i + r() * 0.06,
        amp: 0.05 + r() * 0.10,
        s: 0.8 + r() * 2.2,
        ph: r() * TAU,
        w: 26 + r() * 46,
        hue: (i % 2) ? 0.25 : 0.6,
        drift: (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.9)
      });
    }
  }
  Aurora.prototype.reset = function () {};
  Aurora.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, H = F.H;
    var fw = F.field ? F.field.W : F.W;
    var v = pulseVoice(F);
    var ph = v ? mod1((v.kind === "binaural" ? v.env.cycleTotal : v.gate.cycleTotal) / Math.max(1, (v.kind === "binaural" ? v.env.N : v.gate.N))) : mod1(F.t / 30);
    var mid = (F.feat.bandsAtt && F.feat.bandsAtt.mid) || 0;
    var air = (F.feat.bandsAtt && F.feat.bandsAtt.air) || 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < s.curtains.length; i++) {
      var cu = s.curtains[i];
      var thick = cu.w * (0.5 + 0.9 * (cu.hue ? mid : air)) * (0.6 + 0.7 * F.pre.intensity);
      var base = H * cu.y0 + H * 0.02 * Math.sin(ph * TAU + cu.ph);
      var P = 46;
      for (var pass = 2; pass >= 0; pass--) {
        var lw = thick * (1 + pass * 1.1);
        ctx.beginPath();
        for (var k = 0; k <= P; k++) {
          var x = (k / P) * fw;
          var yy = base
            + H * cu.amp * (VP.fbm1(x * cu.s * 0.004 + cu.ph + F.t * 0.013 * cu.drift, 3) - 0.5) * 2
            + H * 0.012 * Math.sin(k * 0.4 + ph * TAU);
          if (k === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.lineWidth = lw;
        ctx.strokeStyle = ink(F, 0.45 + 0.25 * cu.hue, [0.05, 0.035, 0.025][pass] * (0.5 + F.pre.intensity));
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /* ==================================================================== *
   * OVERLAYS
   * ==================================================================== */

  /* --------------------------------------------------------------- Pulse *
   * The centrepiece: a soft flare and a slow ring, driven by the gate's
   * own phase (openings counted, every Nth shown for fast sessions).       */
  function Pulse(seed) {
    var r = VP.mulberry32(seed);
    this.s = { cx: 0.5, cy: 0.40 + (r() - 0.5) * 0.10, rings: [] };
  }
  Pulse.prototype.reset = function () {};
  Pulse.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, W = F.W, H = F.H;
    var v = pulseVoice(F);
    if (!v) return;
    var lvl = levelOf(v);
    var cx = W * s.cx, cy = H * s.cy;
    var R = Math.min(W * 0.62, H * 0.18) * (0.85 + 0.3 * lvl);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    /* core flare (luminance budget) */
    var a = F.lum * (0.5 + 1.6 * lvl) * (v.att > 0.02 ? 1 : 0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.72, 0, TAU);
    ctx.fillStyle = accent(F, clamp(a, 0, 0.20));
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.34, 0, TAU);
    ctx.fillStyle = ink(F, 0.95, clamp(a * 0.9, 0, 0.16));
    ctx.fill();
    /* slow ring: position = gate cycle (motion channel, not luminance) */
    var cyc = mod1((v.kind === "binaural" ? v.env.cycleTotal : v.gate.cycleTotal) / Math.max(1, (v.kind === "binaural" ? v.env.N : v.gate.N)));
    var rr = R * (1.05 + 0.75 * cyc);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = accent(F, 0.10 + 0.20 * F.pre.intensity * (1 - cyc));
    ctx.stroke();
    ctx.restore();
  };

  /* ------------------------------------------------------------- Phasors *
   * Slow clock faces: one turn per (divided) cycle; binaural voices get two
   * opposed tips whose lengths trade with the slowed envelope; iso voices
   * highlight the open half.                                                */
  function Phasors(seed) {
    var r = VP.mulberry32(seed);
    this.s = { ySpread: 0.2 + r() * 0.1 };
  }
  Phasors.prototype.reset = function () {};
  Phasors.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, W = F.W, H = F.H;
    var list = [];
    for (var i = 0; i < F.voices.length; i++) {
      var v = F.voices[i];
      if (v.kind === "binaural" || v.kind === "iso" || v.kind === "isoalt") list.push(v);
    }
    if (!list.length) return;
    var R = Math.min(W * 0.34, 96);
    ctx.save();
    for (var j = 0; j < list.length; j++) {
      var vv = list[j];
      var cy = H * (0.22 + 0.56 * (list.length === 1 ? 0.5 : j / (list.length - 1)));
      var cx = W * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink(F, 0.5, 0.10 + 0.10 * F.pre.intensity);
      ctx.stroke();
      var ang, lvl;
      if (vv.kind === "binaural") {
        ang = mod1(vv.env.cycleTotal / Math.max(1, vv.env.N)) * TAU;
        lvl = vv.env.level;
      } else {
        ang = mod1(vv.gate.cycleTotal / Math.max(1, vv.gate.N)) * TAU;
        lvl = vv.gate.pulse;
      }
      /* open-half highlight for iso voices */
      if (vv.kind !== "binaural") {
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.86, ang, ang + Math.PI / 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent(F, 0.06 + 0.16 * lvl);
        ctx.stroke();
      }
      var a1 = ang, a2 = ang + Math.PI;
      var l1 = R * (0.30 + 0.62 * lvl), l2 = R * (0.30 + 0.62 * (1 - lvl));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a1) * l1, cy + Math.sin(a1) * l1);
      ctx.strokeStyle = accent(F, 0.25 + 0.35 * lvl);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a2) * l2, cy + Math.sin(a2) * l2);
      ctx.strokeStyle = ink(F, 0.7, 0.10 + 0.20 * (1 - lvl));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, TAU);
      ctx.fillStyle = ink(F, 0.9, 0.5);
      ctx.fill();
    }
    ctx.restore();
  };

  /* -------------------------------------------------------------- Traces *
   * Triggered dual-trace scope drawn from the PHASE MIRROR (analytic), not
   * from sampled amplitude: the window backs up from the current sample
   * using the known instantaneous frequency, so the trace is rock-steady
   * and honestly phase-locked (warp during large carrier glides is
   * bounded by the window cap of 1.2 s).                                   */
  function Traces(seed) { this.s = {}; }
  Traces.prototype.reset = function () {};
  Traces.prototype.draw = function (F) {
    var ctx = F.ctx, W = F.W, H = F.H;
    var list = [];
    for (var i = 0; i < F.voices.length; i++) { var v = F.voices[i]; if (v.kind === "binaural" || v.kind === "iso" || v.kind === "isoalt") list.push(v); }
    if (!list.length) return;
    var laneH = H * 0.9 / list.length;
    ctx.save();
    for (var j = 0; j < list.length; j++) {
      var v = list[j];
      var cy = H * 0.05 + laneH * (j + 0.5);
      var amp = laneH * 0.30 * (0.35 + 0.65 * v.att) * (0.5 + F.pre.intensity);
      var win = clamp(1.4 / Math.max(0.05, (v.kind === "binaural" ? v.env.visRate : v.gate.visRate)), 0.25, 1.2);
      var P = 150, k2;
      /* faint axis */
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.strokeStyle = ink(F, 0.5, 0.06); ctx.lineWidth = 1; ctx.stroke();
      for (var ch = 0; ch < 2; ch++) {
        var f = (ch === 0 ? v.fL : v.fR);
        if (!(f > 0)) continue;
        var phiNow = (ch === 0 ? v.phiL : v.phiR);
        ctx.beginPath();
        for (k2 = 0; k2 <= P; k2++) {
          var back = (k2 / P) * win * 44100;                 /* samples back     */
          var ph = phiNow - back * f * VM.SF;
          var yv = Math.sin(ph) * VM.SC * Math.min(1, v.vol * 2);
          var x = W - (k2 / P) * W;
          var y = cy + yv * amp * 2;
          if (k2 === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = ch === 0 ? 1.4 : 1.1;
        ctx.strokeStyle = ch === 0 ? accent(F, 0.30 + 0.25 * v.att) : ink(F, 0.72, 0.22 + 0.20 * v.att);
        ctx.stroke();
      }
      /* cursor: the modelled cycle position (motion, not luminance) */
      if (v.kind === "iso" || v.kind === "isoalt") {
        var N = Math.max(1, v.gate.N), cyc = mod1(v.gate.cycleTotal / N);
        ctx.fillStyle = accent(F, 0.10 + 0.18 * v.gate.pulse);
        ctx.fillRect(W * (1 - cyc) - 1, cy - amp * 2.4, 2, amp * 4.8);
      }
      ctx.fillStyle = ink(F, 0.6, 0.5);
      ctx.fillRect(2, cy - amp * 2.4, 3, 3);
    }
    ctx.restore();
  };

  /* -------------------------------------------------------------- Orbits *
   * One orbit per voice; radius follows the attended level; the dot's angle
   * is the divided cycle position, trail = eight remembered positions.     */
  function Orbits(seed) { this.s = { trails: [] }; }
  Orbits.prototype.reset = function () { this.s.trails = []; };
  Orbits.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, W = F.W, H = F.H;
    var list = F.voices;
    var R = Math.min(W * 0.30, 84);
    ctx.save();
    for (var i = 0; i < list.length && i < 4; i++) {
      var v = list[i];
      var cy = H * (0.18 + 0.62 * (list.length === 1 ? 0.5 : i / Math.max(1, list.length - 1)));
      var cx = W * 0.5;
      if (!s.trails[i]) s.trails[i] = [];
      var ang = 0, lvl = 0;
      if (v.kind === "binaural") { ang = mod1(v.env.cycleTotal / Math.max(1, v.env.N)) * TAU; lvl = v.env.level; }
      else if (v.kind === "iso" || v.kind === "isoalt") { ang = mod1(v.gate.cycleTotal / Math.max(1, v.gate.N)) * TAU; lvl = v.gate.pulse; }
      else { ang = mod1(F.t * 0.05 + i * 0.7) * TAU; lvl = F.feat.rmsAtt; }       /* beds: slow survey */
      var rr = R * (0.45 + 0.5 * clamp(lvl, 0, 1));
      var x = cx + Math.cos(ang - Math.PI / 2) * rr;
      var y = cy + Math.sin(ang - Math.PI / 2) * rr;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, TAU);
      ctx.lineWidth = 1; ctx.strokeStyle = ink(F, 0.5, 0.07); ctx.stroke();
      var tr = s.trails[i];
      tr.push([x, y]); if (tr.length > 9) tr.shift();
      for (var k = 0; k < tr.length - 1; k++) {
        var a2 = (k / tr.length) * 0.28 * (0.4 + F.pre.intensity);
        ctx.beginPath(); ctx.arc(tr[k][0], tr[k][1], 1.4 + k * 0.12, 0, TAU);
        ctx.fillStyle = accent(F, a2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fillStyle = ink(F, 0.95, 0.35 + 0.4 * lvl); ctx.fill();
      if (v.att < 0.02) { ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, TAU); ctx.strokeStyle = ink(F, 0.5, 0.05); ctx.stroke(); }
    }
    ctx.restore();
  };

  /* ------------------------------------------------------------- Ripples *
   * Rings emitted at slowed pulse events (iso openings / envelope wraps),
   * expanding for 3-6 s; spawn-rate limited; luminance left alone.          */
  function Ripples(seed) {
    var r = VP.mulberry32(seed);
    this.s = { rings: [], lastOpen: 0, lastWrap: 0, jx: r(), jy: r() };
  }
  Ripples.prototype.reset = function () { this.s.rings = []; };
  Ripples.prototype.draw = function (F) {
    var s = this.s, ctx = F.ctx, W = F.W, H = F.H;
    var v = pulseVoice(F);
    if (v) {
      var events = (v.kind === "binaural") ? v.env.wraps : v.gate.openings;
      var n = (v.kind === "binaural") ? Math.max(1, v.env.N) : Math.max(1, v.gate.N);
      if (events - s.lastOpen >= n && s.rings.length < 7) {
        s.lastOpen = events - (events - s.lastOpen) % n;
        s.rings.push({
          t0: F.t,
          x: W * (0.30 + 0.40 * ((s.jx + s.rings.length * 0.37) % 1)),
          y: H * (0.24 + 0.5 * ((s.jy + s.rings.length * 0.61) % 1)),
          s: 0.045 + 0.10 * ((s.jx * 7 + s.rings.length) % 1),
          a: 0.10 + 0.14 * clamp(v.att, 0, 1)
        });
      }
    }
    ctx.save();
    for (var i = s.rings.length - 1; i >= 0; i--) {
      var r0 = s.rings[i];
      var age = F.t - r0.t0;
      var life = 4.5;
      if (age > life) { s.rings.splice(i, 1); continue; }
      var rr = age * Math.min(W, H) * r0.s;
      var aa = r0.a * (1 - age / life) * (1 - age / life);
      ctx.beginPath();
      ctx.arc(r0.x, r0.y, rr, 0, TAU);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = accent(F, aa * (0.5 + 0.5 * F.pre.intensity));
      ctx.stroke();
    }
    ctx.restore();
  };

  /* --------------------------------------------------------- Harmonograph *
   * Damped two-pendulum figure drawn CONTINUOUSLY into its own fading
   * layer (decay ~0.02/frame = MilkDrop's 0.98). Frequencies are small
   * integer ratios scaled by the divided beat; amplitude follows the
   * attended level; the figure re-seeds on its own slow clock.             */
  function Harmonograph(seed) {
    var r = VP.mulberry32(seed);
    this.layer = null; this.c2 = null;
    var ratios = [[1, 2], [2, 3], [3, 4], [3, 5], [1, 3]][Math.floor(r() * 5)];
    this.s = {
      fx: ratios[0], fy: ratios[1],
      px: r() * TAU, py: r() * TAU,
      dx: 0.010 + r() * 0.05, dy: 0.008 + r() * 0.05,
      T: 40 + r() * 70, t0: 0, prev: null, seeded: false
    };
  }
  Harmonograph.prototype.reset = function () { this.s.seeded = false; this.s.prev = null; };
  Harmonograph.prototype.draw = function (F) {
    var s = this.s;
    if (!this.layer) { this.layer = mkLayer(F.W * F.dpr, F.H * F.dpr); this.c2 = this.layer.getContext("2d"); }
    var dpr = F.dpr;
    if (this.layer.width !== Math.round(F.W * dpr)) {
      this.layer.width = Math.round(F.W * dpr); this.layer.height = Math.round(F.H * dpr);
      this.c2 = this.layer.getContext("2d");
    }
    var c2 = this.c2;
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!s.seeded) { s.t0 = F.t; s.seeded = true; s.prev = null; }
    var tt = F.t - s.t0;
    if (tt > s.T) {   /* re-seed: new figure (seeded stream) */
      var r = VP.mulberry32(F.seed ^ (Math.floor(F.t)));
      s.px = r() * TAU; s.py = r() * TAU; s.dx = 0.01 + r() * 0.05; s.dy = 0.008 + r() * 0.05;
      var ratios = [[1, 2], [2, 3], [3, 4], [3, 5], [1, 3]][Math.floor(r() * 5)];
      s.fx = ratios[0]; s.fy = ratios[1];
      s.t0 = F.t; s.prev = null; tt = 0;
    }
    /* slow fade of the layer (half-life ~0.57 s at 60 fps, dt-corrected) */
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.globalCompositeOperation = "destination-out";
    c2.fillStyle = "rgba(0,0,0," + String(clamp(0.02 * F.dt * 60, 0, 1)) + ")";
    c2.fillRect(0, 0, this.layer.width, this.layer.height);
    c2.globalCompositeOperation = "source-over";
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    var v = pulseVoice(F);
    var lvl = v ? levelOf(v) : F.feat.rmsAtt;
    var speed = Math.max(0.08, (v ? (v.kind === "binaural" ? v.env.visRate : v.gate.visRate) : 0.1));
    var omega = TAU * speed;
    var A = (0.30 + 0.12 * clamp(lvl, 0, 1)) * F.pre.intensity;
    var cx = F.W * 0.5, cy = F.H * 0.5;
    var Rx = F.W * 0.44 * A, Ry = F.H * 0.40 * A;
    var STEP = 0.028;                                  /* seconds / segment     */
    var t1 = tt, t0 = (s.prev === null) ? tt - STEP : s.prev;
    var K = 26;
    c2.beginPath();
    for (var k = 0; k <= K; k++) {
      var tq = t0 + (t1 - t0) * (k / K);
      var ex = Math.exp(-s.dx * tq), ey = Math.exp(-s.dy * tq);
      var x = cx + Rx * Math.sin(omega * s.fx * tq + s.px) * ex;
      var y = cy + Ry * Math.sin(omega * s.fy * tq + s.py) * ey;
      if (k === 0) c2.moveTo(x, y); else c2.lineTo(x, y);
    }
    c2.lineWidth = 1.1;
    c2.strokeStyle = accent(F, 0.16 + 0.20 * lvl);
    c2.stroke();
    s.prev = tt;
    F.ctx.save();
    F.ctx.globalCompositeOperation = "lighter";
    F.ctx.drawImage(this.layer, 0, 0, this.layer.width, this.layer.height, 0, 0, F.W, F.H);
    F.ctx.restore();
  };

  /* --------------------------------------------------------------- Weave *
   * Persistent flow-field particles, one new segment each per frame, drawn
   * into a fading layer (never a full redraw). Field direction = fbm, biased
   * vertical for tall panels; speed follows the attended level.             */
  function Weave(seed) {
    var r = VP.mulberry32(seed);
    this.layer = null; this.c2 = null; this.s = { pts: [] };
    for (var i = 0; i < 190; i++) {
      this.s.pts.push({ x: r(), y: r(), life: r() * 900 });
    }
    this.r = r;
  }
  Weave.prototype.reset = function () {};
  Weave.prototype.draw = function (F) {
    var s = this.s;
    if (!this.layer) { this.layer = mkLayer(F.W * F.dpr, F.H * F.dpr); this.c2 = this.layer.getContext("2d"); }
    var dpr = F.dpr, W = F.W, H = F.H;
    if (this.layer.width !== Math.round(W * dpr)) {
      this.layer.width = Math.round(W * dpr); this.layer.height = Math.round(H * dpr);
      this.c2 = this.layer.getContext("2d");
    }
    var c2 = this.c2;
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.globalCompositeOperation = "destination-out";
    c2.fillStyle = "rgba(0,0,0," + String(clamp(0.012 * F.dt * 60, 0, 1)) + ")";
    c2.fillRect(0, 0, this.layer.width, this.layer.height);
    c2.globalCompositeOperation = "source-over";
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    var v = pulseVoice(F);
    var lvl = v ? levelOf(v) : F.feat.rmsAtt;
    var L = (0.0022 + 0.004 * clamp(lvl, 0, 1)) * Math.min(W, H) * 0.5;
    var tq = F.t * 0.05;
    var sc = 0.006;
    c2.strokeStyle = ink(F, 0.78, 0.10 + 0.14 * F.pre.intensity);
    c2.lineWidth = 1;
    c2.beginPath();
    for (var i = 0; i < s.pts.length; i++) {
      var p = s.pts[i];
      var ang = TAU * VP.fbm2(p.x * W * sc, p.y * H * sc, tq, 3) + Math.PI / 2;
      var nx = p.x + Math.cos(ang) * L / W;
      var ny = p.y + Math.sin(ang) * L / H;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {          /* recycle           */
        p.x = this.r(); p.y = this.r();
        continue;
      }
      c2.moveTo(p.x * W, p.y * H);
      c2.lineTo(nx * W, ny * H);
      p.x = nx; p.y = ny;
    }
    c2.stroke();
    F.ctx.save();
    F.ctx.drawImage(this.layer, 0, 0, this.layer.width, this.layer.height, 0, 0, W, H);
    F.ctx.restore();
  };

  /* -------------------------------------------------------------- Meters *
   * The honest readout: master level, the five bands with this session's
   * carrier marked, per-voice rates, sync score. Text, not poetry.          */
  function Meters(seed) { this.s = {}; }
  Meters.prototype.reset = function () {};
  Meters.prototype.draw = function (F) {
    var ctx = F.ctx, W = F.W, H = F.H;
    var pad = 10, x = pad, y = H - pad;
    ctx.save();
    ctx.font = "10px ui-monospace, Consolas, monospace";
    ctx.textBaseline = "bottom";
    var f = F.feat;
    ctx.fillStyle = ink(F, 0.8, 0.55);
    ctx.fillText("level " + (f.rms > 0.0005 ? (20 * Math.log10(f.rms)).toFixed(1) + " dB" : "—"), x, y);
    y -= 14;
    var bands = ["air", "mid", "carrier", "low", "sub"], i;
    for (i = 0; i < bands.length; i++) {
      var val = (f.bandsAtt && f.bandsAtt[bands[i]]) || 0;
      var bw = (W - pad * 2 - 46);
      ctx.fillStyle = ink(F, 0.6, 0.20);
      ctx.fillRect(x + 40, y - 7, bw, 5);
      ctx.fillStyle = accent(F, 0.35 + 0.4 * clamp(val, 0, 1));
      ctx.fillRect(x + 40, y - 7, bw * clamp(val * 1.6, 0, 1), 5);
      ctx.fillStyle = ink(F, 0.65, 0.6);
      ctx.fillText(bands[i], x, y);
      y -= 12;
    }
    y -= 4;
    for (i = 0; i < F.voices.length && i < 4; i++) {
      var v = F.voices[i];
      var rr = (v.kind === "binaural") ? v.rate : (v.rate > 0 ? v.rate : 0);
      var txt = v.kind + (rr ? " " + (rr >= 10 ? rr.toFixed(1) : rr.toFixed(2)) + " Hz" : "") + (v.base ? " @" + Math.round(v.base) + " Hz" : "");
      ctx.fillStyle = ink(F, 0.6, 0.5);
      ctx.fillText(txt, x, y);
      y -= 12;
    }
    var syncTxt = f.syncText || "";
    if (syncTxt) {
      ctx.fillStyle = ink(F, 0.85, 0.6);
      ctx.fillText(syncTxt, x, y);
    }
    ctx.restore();
  };

  /* ==================================================================== *
   * registry
   * ==================================================================== */

  var FACTORY = {
    tide: Tide, drift: Drift, rainfall: Rainfall, score: Score, aurora: Aurora,
    pulse: Pulse, phasors: Phasors, traces: Traces, orbits: Orbits,
    ripples: Ripples, harmonograph: Harmonograph, weave: Weave, meters: Meters
  };

  var META = {
    tide:         { name: "Tide",         space: "field", role: "backdrop" },
    drift:        { name: "Drift",        space: "field", role: "backdrop" },
    rainfall:     { name: "Rainfall",     space: "panel", role: "backdrop" },
    score:        { name: "Score",        space: "panel", role: "backdrop" },
    aurora:       { name: "Aurora",       space: "field", role: "backdrop" },
    pulse:        { name: "Pulse",        space: "panel", role: "overlay" },
    phasors:      { name: "Phasors",      space: "panel", role: "overlay" },
    traces:       { name: "Traces",       space: "panel", role: "overlay" },
    orbits:       { name: "Orbits",       space: "panel", role: "overlay" },
    ripples:      { name: "Ripples",      space: "panel", role: "overlay" },
    harmonograph: { name: "Harmonograph", space: "panel", role: "overlay" },
    weave:        { name: "Weave",        space: "panel", role: "overlay" },
    meters:       { name: "Meters",       space: "panel", role: "overlay" }
  };

  function mod1(x) { x = x % 1; return x < 0 ? x + 1 : x; }

  var api = {
    BACKDROPS: ["off", "tide", "drift", "rainfall", "score", "aurora"],
    OVERLAYS: ["pulse", "phasors", "traces", "orbits", "ripples", "harmonograph", "weave", "meters"],
    META: META,
    create: function (id, seed) {
      var F = FACTORY[id];
      if (!F) return null;
      return new F(seed >>> 0);
    },
    step: function (inst, F) { if (inst && inst.step) inst.step(F); },
    draw: function (inst, F) { if (inst && inst.draw) inst.draw(F); },
    reset: function (inst, F) { if (inst && inst.reset) inst.reset(F); }
  };

  if (typeof globalThis !== "undefined") globalThis.GnauralVizModes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
