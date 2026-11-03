/* Resonance Studio — CYMATIC CHAMBER (the dedicated visualiser module).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * A full-screen instrument, separate from the ambient Visualizers: it takes
 * the tone the studio is playing (or a manual tone), solves the driven plate
 * response, and renders the resulting Chladni/Faraday field with sand, nodal
 * lines and (optionally) bubble acoustics.
 *
 * Public: window.ResonanceCymatics = { open, close, toggle, debugState, api }
 */
(function () {
  "use strict";

  var C = globalThis.GnauralCymatics;
  var F = globalThis.GnauralCymField;
  var R = globalThis.GnauralCymRender;
  if (!C || !F || !R) { console.warn("[cym] engine missing (cymatics/cymfield/cymrender)"); return; }

  var KEY = "resonance.cym.v2";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function store() {
    var d = {
      v: 1, medium: "plate", material: "steel", size: 300, thickness: 1, q: 90,
      palette: "champagne", sand: true, lines: true, bubbles: true, src: "session",
      hz: 220, drive: 0.75, speed: 0.5, freeze: false, sandN: 9000
    };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); for (var k in d) if (p[k] !== undefined) d[k] = p[k]; }
    } catch (e) { /* defaults */ }
    return d;
  }
  var P = store();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} }

  var root = null, canvas = null, renderer = null, field = null, medium = null;
  var sand = null, bubbles = null, opened = false, raf = 0;
  var cam = { yaw: 0.52, pitch: 0.66, dist: 3.30 };
  var t = 0, lastT = 0, lastFieldT = 0, phase = 0, fps = 60, frames = 0, fpsT = 0;
  var audioState = { f0: 0, rate: 0, drive: 0, playing: false, label: "", n: 0 };
  var lastF0 = 0;
  var ana = { nearest: 0, detune: 0, peak: 0 };   /* persists between weight updates */
  var cursors = [], cursorVoices = null, beatPh = [];
  var dirtyField = true, resizeT = 0, lastMediumKey = "", lastWaterBuild = 0, lastResizeT = 0;

  /* ==================================================================== *
   * medium construction
   * ==================================================================== */

  function mediumKey() {
    return [P.medium, P.material, P.size, P.thickness, Math.round(P.q)].join("|");
  }

  function buildMedium() {
    var size = P.size / 1000, th = P.thickness / 1000;
    if (P.medium === "bolted") medium = C.boltedPlateModes({ material: P.material, size: size, thickness: th });
    else if (P.medium === "disc") medium = C.discModes({ material: P.material, size: size / 2, thickness: th });
    else if (P.medium === "drum") medium = C.membraneModes({ size: size / 2 });
    else if (P.medium === "plate") medium = C.squarePlateModes({ material: P.material, size: size, thickness: th, keep: 30 });
    else medium = C.squarePlateModes({ material: P.material, size: size, thickness: th, keep: 24 });

    /* Water is its own medium: plane waves at the Faraday wavenumber.
     * Bubbles ride on a small clamped disc's pressure field. */
    if (P.medium === "water") {
      var wf = (P.src === "manual" ? P.hz : (lastF0 > 20 ? lastF0 : P.hz));
      medium = F.waterMedium({ f: wf, size: P.size / 1000 });
    } else if (P.medium === "bubbles") {
      medium = C.discModes({ material: "steel", size: 0.15, thickness: 0.0008 });
    }
    if (!medium || !medium.modes.length) {
      medium = C.squarePlateModes({ material: "steel", size: 0.3, thickness: 0.001, keep: 20 });
    }
    field = new F.Field(medium, 256);
    dirtyField = true;
    refreshLadder();
    refreshPhysics();
  }

  /* ==================================================================== *
   * audio -> partials
   * ==================================================================== */

  function engineState() { return (window.__gnauralAPI && window.__gnauralAPI.state) || null; }

  function syncCursors(S) {
    var vs = (S && S.engine && S.engine.voices) || [];
    if (vs === cursorVoices) return;
    cursorVoices = vs;
    cursors = [];
    beatPh = [];
    var VM = globalThis.GnauralVizMath;
    for (var i = 0; i < vs.length; i++) {
      cursors.push(VM && VM.Cursor ? new VM.Cursor(vs[i]) : null);
      beatPh.push(Math.random() * 6.283);
    }
  }

  function readAudio(dt) {
    var S = engineState();
    var out = { partials: [], drive: 0, f0: 0, rate: 0, playing: false, label: "", noise: 0 };
    /* While the studio is idle or paused the chamber still needs a tone: it
     * uses the last good carrier (or the manual one) so the plate is never
     * a dead black rectangle. */
    if (P.src !== "session" || !S || !S.engine || !S.playing) {
      var f = (P.src === "session" && lastF0 > 20) ? lastF0 : P.hz;
      f = f > 20 ? f : 220;
      if (P.src === "session" && medium && medium.modes.length) {
        var bi = 0, bd = Infinity;
        for (var mi = 0; mi < medium.modes.length; mi++) {
          var dd2 = Math.abs(medium.modes[mi].f - f);
          if (dd2 < bd) { bd = dd2; bi = mi; }
        }
        if (bd / f < 0.2) f = medium.modes[bi].f;   /* park the demo on a mode */
      }
      out.f0 = f;
      out.partials.push({ f: f, amp: 1, phase: 0 });
      out.drive = P.drive * 0.9;
      out.playing = !!(S && S.playing);
      out.label = (P.src === "manual") ? ("manual " + f.toFixed(1) + " Hz")
                 : (S && S.engine && !S.playing ? "paused · demo " : "demo ") + f.toFixed(1) + " Hz";
      return out;
    }
    syncCursors(S);
    var vs = (S.engine && S.engine.voices) || [];
    var aud = (S.live && typeof S.live.sample === "number") ? S.live.sample : 0;
    var total = 0, best = null, bestVol = 0, noise = 0;
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i], s = null;
      try { s = cursors[i] ? cursors[i].sampleAt(aud) : null; } catch (e) { s = null; }
      if (!s) {
        var e0 = (v.entries && v.entries[0]) || {};
        s = { baseHz: e0.basefreq || 200, beatHz: e0.beat || 0, volL: e0.volL || 0.2, volR: e0.volR || 0.2 };
      }
      var vol = (s.volL + s.volR) / 2;
      if (v.mute) vol = 0;
      total += vol;
      var kind = v.type;
      if (kind === 1 || kind === 7 || kind === 8) { noise += vol; continue; }
      if (kind !== 0 && kind !== 3 && kind !== 4) continue;
      if (vol > bestVol) { bestVol = vol; best = { s: s, kind: kind, i: i }; }
      if (kind === 0) {
        var half = (s.beatHz || 0) / 2;
        beatPh[i] += dt * 2 * Math.PI * Math.min(s.beatHz || 0, 1);
        out.partials.push({ f: s.baseHz + half, amp: vol, phase: 0 });
        out.partials.push({ f: Math.max(20, s.baseHz - half), amp: vol, phase: beatPh[i] });
      } else {
        out.partials.push({ f: s.baseHz, amp: vol, phase: 0 });
      }
      if (!out.rate && s.beatHz) out.rate = s.beatHz;
    }
    if (best) { out.f0 = best.s.baseHz; out.rate = best.s.beatHz || 0; }
    if (out.f0 > 20) lastF0 = out.f0;
    if (!(out.f0 > 20)) out.f0 = lastF0 > 20 ? lastF0 : P.hz;
    var gain = (S.master && S.master.gain) ? S.master.gain.value : 0.7;
    out.drive = clamp(total * 1.8 * (0.4 + gain), 0, 1);
    out.playing = !!S.playing;
    out.noise = noise;
    out.label = out.partials.length ? (out.f0.toFixed(1) + " Hz carrier" + (out.rate ? " · " + out.rate.toFixed(2) + " Hz beat" : "")) : (noise > 0 ? "noise bed" : "silent");
    if (!out.partials.length) out.partials.push({ f: out.f0 || P.hz, amp: 0.05, phase: 0 });
    return out;
  }

  /* ==================================================================== *
   * per-frame
   * ==================================================================== */

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!opened) return;
    var dt = lastT ? (ts - lastT) / 1000 : 1 / 60;
    lastT = ts;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    t += dt;
    frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }

    var a = readAudio(dt);
    audioState = a;

    /* field weights: 20 Hz is plenty, the phase is animated separately */
    if (dirtyField || t - lastFieldT > 0.05) {
      lastFieldT = t;
      dirtyField = false;
      if (medium.kind === "water") {
        var ww = F.waterWeights(medium, clamp(a.drive, 0, 1), t);
        field.setWeights(ww.re, ww.im);
        field._fam = ww.family;
        ana.nearest = -1; ana.detune = 0; ana.peak = 0;
      } else {
        var res = C.modalResponse(medium.modes, a.partials, { q: P.q });
        field.setWeights(res.re, res.im);
        ana.nearest = res.nearest; ana.detune = res.detuneCents; ana.peak = res.peakIndex;
      }
    }

    if (medium.kind === "water" && a.f0 > 20 && medium.fDrive > 0 &&
        Math.abs(a.f0 - medium.fDrive) / medium.fDrive > 0.04 && t - lastWaterBuild > 0.9) {
      lastWaterBuild = t;
      medium = F.waterMedium({ f: a.f0, size: P.size / 1000 });
      field = new F.Field(medium, 256);
      dirtyField = true;
      refreshPhysics();
    }

    /* The overlay is built while hidden, so its canvas can be sized 1x1 and
     * never recover (the Android WebView does exactly this). Re-check the box. */
    if (t - lastResizeT > 0.5 && Math.abs((renderer.W || 0) - root.clientWidth) > 1) {
      lastResizeT = t;
      resize(false);
    }

    var rate = a.rate > 0 ? Math.min(a.rate, 1) : 0.12;      /* visible modulation cap */
    if (!P.freeze) phase += dt * (0.35 + rate * 0.9) * P.speed;

    var h = field.heightAt(phase);
    renderer.upload(h, field.env, field.N);

    if (P.sand) {
      var drive = Math.max(0.04, a.drive);
      sand.step(field, dt, drive, { strength: 7 + 9 * drive, damp: 0.14 + 0.1 * (1 - drive), jitter: 0.5 });
    }
    if (P.medium === "bubbles" && P.bubbles) {
      bubbles.step(field, dt, a.f0 || 220, Math.max(0.1, a.drive), { trap: 2.0, rise: 0.08 });
    }

    var amp = P.medium === "water" ? 0.022 : (P.medium === "bubbles" ? 0.055 : 0.095);
    amp *= (0.75 + 0.35 * Math.max(0.15, a.drive));
    renderer.draw({
      yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, amp: amp, palette: P.palette,
      showSand: P.sand && P.medium !== "water", showLines: P.lines,
      lineW: P.medium === "water" ? 0.010 : 0.016, glow: P.medium === "water" ? 0.35 : 0.55,
      water: P.medium === "water", circle: medium.geometry === "circle",
      showBubbles: P.bubbles, sand: P.sand ? sand : null, bubbles: P.medium === "bubbles" ? bubbles : null,
      medium: medium.geometry, phase: phase, re: field.re, im: field.im
    });

    updateHUD(a);
  }

  /* ==================================================================== *
   * HUD
   * ==================================================================== */

  var hudT = 0, physF = 0;
  function updateHUD(a) {
    if (t - hudT < 0.12) return;
    hudT = t;
    /* the physics panel quotes numbers that depend on the TONE (Minnaert
     * radius, Q, water wavelength): refresh it when the tone moves */
    if (a.f0 > 20 && Math.abs(a.f0 - physF) / a.f0 > 0.02) { physF = a.f0; refreshPhysics(); }
    var mode = medium.kind === "water" ? null : medium.modes[ana.nearest || 0];
    if ($("cymTone")) $("cymTone").textContent = a.label || "—";
    if (medium.kind === "water") {
      if ($("cymModeName")) $("cymModeName").textContent = "Faraday waves";
      if ($("cymModeF")) $("cymModeF").textContent = (medium.lambda * 1000).toFixed(2) + " mm";
      if ($("cymDetune")) {
        $("cymDetune").textContent = "surface at " + (medium.fDrive / 2).toFixed(1) + " Hz · " +
          medium.wavelengths.toFixed(1) + " λ across";
        $("cymDetune").className = "cym-detune ok";
      }
    } else {
      if ($("cymModeName")) $("cymModeName").textContent = mode ? mode.label : "—";
      if ($("cymModeF")) $("cymModeF").textContent = mode ? mode.f.toFixed(1) + " Hz" : "—";
      if ($("cymDetune")) {
        var d = ana.detune || 0;
        $("cymDetune").textContent = Math.abs(d) < 3 ? "on resonance" : (d > 0 ? "+" : "") + d.toFixed(0) + " cents";
        $("cymDetune").className = "cym-detune" + (Math.abs(d) < 12 ? " ok" : "");
      }
    }
    if (medium.kind === "water") {
      var fam = field._fam || null;
      var txt = fam ? [["stripes", fam.stripe], ["hexagons", fam.hex], ["squares", fam.square], ["quasi-crystal", fam.quasi]]
        .filter(function (x) { return x[1] > 0.08; })
        .map(function (x) { return x[0] + " " + Math.round(x[1] * 100) + "%"; }).join(" · ") : "—";
      if ($("cymBars")) $("cymBars").innerHTML = "<p class='cym-note' style='margin:0'>" + txt + "</p>";
    } else if ($("cymBars")) {
      var n = medium.modes.length, rows = "", seen = 0;
      var mags = [];
      for (var i = 0; i < n; i++) {
        if (!field.weights) break;
        var wr = field.weights.re[i] || 0, wi = field.weights.im[i] || 0;
        mags.push({ i: i, m: Math.sqrt(wr * wr + wi * wi) });
      }
      mags.sort(function (x, y) { return y.m - x.m; });
      for (var k = 0; k < Math.min(5, mags.length); k++) {
        var q = mags[k];
        if (q.m < 0.02 && k > 0) break;
        seen++;
        rows += "<div class='cym-bar'><span>" + (medium.modes[q.i].label || ("mode " + (q.i + 1))) +
          "</span><i style='width:" + Math.round(Math.min(1, q.m) * 100) + "%'></i><b>" + q.m.toFixed(2) + "</b></div>";
      }
      $("cymBars").innerHTML = rows || "<p class='hint'>no mode excited</p>";
    }
    if ($("cymStats")) {
      $("cymStats").textContent = Math.round(fps) + " fps · " + renderer.kind + " · " + field.active.length + " modes";
    }
    if ($("cymHzV")) $("cymHzV").textContent = Math.round(P.hz) + " Hz";
    if ($("cymDriveV")) $("cymDriveV").textContent = Math.round(P.drive * 100) + "%";
    if ($("cymMarker")) {
      var lo = Math.log(medium.fMin || 40), hi = Math.log(medium.fMax || 1200);
      var x = clamp((Math.log(Math.max(1, a.f0)) - lo) / Math.max(1e-6, hi - lo), 0, 1);
      $("cymMarker").style.left = (x * 100) + "%";
    }
  }

  /* ==================================================================== *
   * mode ladder
   * ==================================================================== */

  function refreshLadder() {
    var host = $("cymLadder");
    if (!host) return;
    var lo = Math.log(medium.fMin || 40), hi = Math.log(medium.fMax || 1200);
    var html = "";
    for (var i = 0; i < medium.modes.length; i++) {
      var m = medium.modes[i];
      var x = clamp((Math.log(m.f) - lo) / Math.max(1e-6, hi - lo), 0, 1);
      html += "<span class='cym-tick' data-i='" + i + "' style='left:" + (x * 100).toFixed(2) + "%' title='" +
        m.label + " · " + m.f.toFixed(1) + " Hz'></span>";
    }
    host.innerHTML = html;
    var ticks = host.querySelectorAll(".cym-tick");
    for (var k = 0; k < ticks.length; k++) {
      ticks[k].onclick = function () {
        var m = medium.modes[+this.getAttribute("data-i")];
        if (!m) return;
        P.src = "manual"; P.hz = Math.round(m.f * 10) / 10;
        syncControls(); save(); dirtyField = true;
        toast(m.label + " · " + m.f.toFixed(1) + " Hz");
      };
    }
    var lo2 = $("cymLo"), hi2 = $("cymHi");
    if (lo2) lo2.textContent = Math.round(medium.fMin) + " Hz";
    if (hi2) hi2.textContent = Math.round(medium.fMax) + " Hz";
  }

  /* ==================================================================== *
   * physics panel
   * ==================================================================== */

  function refreshPhysics() {
    var host = $("cymPhysics");
    if (!host) return;
    var rows = [];
    if (medium.kind === "plate" || medium.kind === "bolted" || medium.kind === "disc") {
      rows.push(["material", medium.material.name + " · " + (medium.thickness * 1000).toFixed(2) + " mm"]);
      rows.push(["plate", (medium.geometry === "circle" ? "Ø" : "") + (medium.size * 1000).toFixed(0) + " mm"]);
      rows.push(["D", medium.D.toFixed(2) + " N·m"]);
      rows.push(["√(D/ρh)", medium.c.toFixed(3) + " m²/s"]);
      rows.push(["modes", medium.modes.length + " · " + Math.round(medium.fMin) + "–" + Math.round(medium.fMax) + " Hz"]);
    } else if (medium.kind === "drum") {
      rows.push(["radius", (medium.size * 1000).toFixed(0) + " mm"]);
      rows.push(["tension", medium.tension + " N/m"]);
      rows.push(["wave speed", medium.c.toFixed(1) + " m/s"]);
      rows.push(["modes", medium.modes.length + " · " + Math.round(medium.fMin) + "–" + Math.round(medium.fMax) + " Hz"]);
    } else if (medium.kind === "water") {
      rows.push(["drive", medium.fDrive.toFixed(1) + " Hz"]);
      rows.push(["response", (medium.fDrive / 2).toFixed(1) + " Hz (subharmonic)"]);
      rows.push(["wavelength", (medium.lambda * 1000).toFixed(2) + " mm"]);
      rows.push(["tank", (medium.size * 1000).toFixed(0) + " mm · " + medium.wavelengths.toFixed(1) + " λ"]);
      rows.push(["display", medium.displayWaves.toFixed(0) + " λ across (scaled)"]);
    }
    if (P.medium === "bubbles") {
      var Rb = F.Bubbles.resonantRadius(audioState.f0 || P.hz);
      rows.push(["Minnaert", "R = " + (Rb * 1000).toFixed(2) + " mm at " + Math.round(audioState.f0 || P.hz) + " Hz"]);
      rows.push(["Bjerknes", "small bubbles → nodal lines"]);
      rows.push(["Q at " + Math.round(audioState.f0 || P.hz) + " Hz", F.Bubbles.bubbleQ ? F.Bubbles.bubbleQ(audioState.f0 || P.hz).toFixed(0) : "—"]);
      rows.push(["note", "model forces; real trapping needs ~95 kPa at 440 Hz"]);
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) html += "<dt>" + rows[i][0] + "</dt><dd>" + rows[i][1] + "</dd>";
    host.innerHTML = html;
  }

  /* ==================================================================== *
   * DOM
   * ==================================================================== */

  function build() {
    root = el("div", "cym", document.body);
    root.id = "cymRoot";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Cymatic Chamber");
    root.hidden = true;

    canvas = el("canvas", "cym-canvas", root);
    var scrim = el("div", "cym-scrim", root);
    scrim.id = "cymScrim";
    canvas.width = 2; canvas.height = 2;
    el("div", "cym-vignette", root);

    var top = el("header", "cym-top", root);
    el("div", "cym-brand", top,
      "<span class='cym-kicker'>Resonance Studio</span>" +
      "<h1>Cymatic Chamber</h1>" +
      "<p class='cym-tone'><b id='cymTone'>—</b></p>");
    var act = el("div", "cym-actions", top);
    el("span", "cym-live", act, "<i></i> live");
    var ctl = el("button", "cym-ctl", act, "Controls");
    ctl.id = "cymCtl"; ctl.title = "show the controls";
    var pb = el("button", "cym-play", act, "&#9654;");
    pb.id = "cymPlay"; pb.title = "play / pause the session";
    var cb = el("button", "cym-close", act, "Close");
    cb.id = "cymClose"; cb.title = "leave the chamber (Esc)";

    /* left rail */
    var left = el("aside", "cym-panel cym-left", root);
    left.innerHTML =
      "<div class='cym-sec'><h4>Medium</h4><div class='cym-btns' id='cymMedia'>" +
      "<button data-m='plate'>Free plate</button>" +
      "<button data-m='bolted'>Bolted plate</button>" +
      "<button data-m='disc'>Disc</button>" +
      "<button data-m='drum'>Drum</button>" +
      "<button data-m='water'>Water</button>" +
      "<button data-m='bubbles'>Bubbles</button></div>" +
      "<p class='cym-note' id='cymMediumNote'></p></div>" +
      "<div class='cym-sec'><h4>Plate</h4>" +
      "<label class='cym-row'>Material <select id='cymMat'>" +
      "<option value='steel'>Steel</option><option value='brass'>Brass</option>" +
      "<option value='aluminium'>Aluminium</option><option value='glass'>Glass</option>" +
      "<option value='copper'>Copper</option><option value='acrylic'>Acrylic</option></select></label>" +
      "<label class='cym-row'>Size <input id='cymSize' type='range' min='80' max='600' step='5'><b id='cymSizeV'></b></label>" +
      "<label class='cym-row'>Thickness <input id='cymThick' type='range' min='0.3' max='3' step='0.05'><b id='cymThickV'></b></label>" +
      "<label class='cym-row'>Selectivity <input id='cymQ' type='range' min='8' max='140' step='1'><b id='cymQV'></b></label>" +
      "</div>" +
      "<div class='cym-sec'><h4>Tone</h4>" +
      "<div class='cym-btns' id='cymSrc'><button data-s='session'>Session</button><button data-s='manual'>Manual</button></div>" +
      "<label class='cym-row'>Frequency <input id='cymHz' type='range' min='40' max='1200' step='0.5'><b id='cymHzV'></b></label>" +
      "<label class='cym-row'>Drive <input id='cymDrive' type='range' min='0' max='1' step='0.01'><b id='cymDriveV'></b></label>" +
      "<p class='cym-note'>Session mode follows the carrier, beat and pulse of whatever the studio is playing.</p></div>" +
      "<div class='cym-sec'><h4>Display</h4>" +
      "<div class='cym-chips' id='cymPal'></div>" +
      "<label class='cym-check'><input id='cymSand' type='checkbox'> Sand grains</label>" +
      "<label class='cym-check'><input id='cymLines' type='checkbox'> Nodal glow</label>" +
      "<label class='cym-check'><input id='cymBub' type='checkbox'> Bubbles</label>" +
      "<label class='cym-check'><input id='cymFreeze' type='checkbox'> Freeze motion</label>" +
      "</div>" +
      "<div class='cym-sec'><h4>Actions</h4>" +
      "<div class='cym-btns'><button id='cymReset'>Reset camera</button>" +
      "<button id='cymScatter'>Scatter sand</button>" +
      "<button id='cymPng'>Save PNG</button></div>" +
      "<p class='cym-note'>Drag to orbit · wheel to zoom · double-click to reset · click the plate to disturb the sand.</p></div>";

    /* right rail */
    var right = el("aside", "cym-panel cym-right", root);
    right.innerHTML =
      "<div class='cym-readout'><div class='cym-mode' id='cymModeName'>—</div>" +
      "<div class='cym-modef' id='cymModeF'>—</div><div class='cym-detune' id='cymDetune'>—</div></div>" +
      "<div class='cym-sec'><h4>Contributing modes</h4><div id='cymBars'></div></div>" +
      "<div class='cym-sec'><h4>Physics</h4><dl id='cymPhysics'></dl></div>" +
      "<p class='cym-stats' id='cymStats'></p>";

    /* dock */
    var dock = el("footer", "cym-dock", root);
    dock.innerHTML = "<span class='cym-dock-lo' id='cymLo'></span><div class='cym-ladder' id='cymLadder'><i class='cym-marker' id='cymMarker'></i></div><span class='cym-dock-hi' id='cymHi'></span>" +
      "<p class='cym-hint'>Mode ladder — click a tick to drive that mode exactly. <span id='cymScale'></span></p>";

    wire();
    renderer = R.create(canvas);
    sand = new F.Sand(P.sandN || 6000);
    bubbles = new F.Bubbles(900);
    buildMedium();
    syncControls();
    resize(true);
  }

  function wire() {
    $("cymClose").onclick = close;
    $("cymCtl").onclick = function () {
      var openNow = !$("cymRoot").querySelector(".cym-left").classList.contains("open");
      $("cymRoot").querySelector(".cym-left").classList.toggle("open", openNow);
      $("cymScrim").classList.toggle("on", openNow);
    };
    $("cymScrim").onclick = function () {
      $("cymRoot").querySelector(".cym-left").classList.remove("open");
      $("cymScrim").classList.remove("on");
    };
    $("cymPlay").onclick = function () {
      var api = window.__gnauralAPI;
      if (api && api.togglePlay) api.togglePlay();
    };
    var media = $("cymMedia").querySelectorAll("button");
    for (var i = 0; i < media.length; i++) {
      media[i].onclick = function () { P.medium = this.getAttribute("data-m"); save(); buildMedium(); syncControls(); dirtyField = true; };
    }
    var src = $("cymSrc").querySelectorAll("button");
    for (i = 0; i < src.length; i++) {
      src[i].onclick = function () { P.src = this.getAttribute("data-s"); save(); syncControls(); dirtyField = true; };
    }
    $("cymMat").onchange = function () { P.material = this.value; save(); buildMedium(); dirtyField = true; };
    $("cymSize").oninput = function () { P.size = +this.value; save(); buildMedium(); dirtyField = true; };
    $("cymThick").oninput = function () { P.thickness = +this.value; save(); buildMedium(); dirtyField = true; };
    $("cymQ").oninput = function () { P.q = +this.value; save(); dirtyField = true; syncControls(); };
    $("cymHz").oninput = function () { P.hz = +this.value; dirtyField = true; syncControls(); };
    $("cymDrive").oninput = function () { P.drive = +this.value; syncControls(); };
    $("cymSand").onchange = function () { P.sand = this.checked; save(); };
    $("cymLines").onchange = function () { P.lines = this.checked; save(); };
    $("cymBub").onchange = function () { P.bubbles = this.checked; save(); };
    $("cymFreeze").onchange = function () { P.freeze = this.checked; save(); };
    $("cymReset").onclick = resetCam;
    $("cymScatter").onclick = function () { sand.reset(); bubbles.reset(); toast("scattered"); };
    $("cymPng").onclick = savePng;

    var pal = $("cymPal");
    for (i = 0; i < R.PALETTE_IDS.length; i++) {
      var id = R.PALETTE_IDS[i];
      var c = el("span", "cym-chip", pal, id);
      c.setAttribute("data-id", id); c.setAttribute("role", "button"); c.tabIndex = 0;
      c.onclick = (function (x) { return function () { P.palette = x; save(); syncControls(); }; })(id);
    }

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", resetCam);
    canvas.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      cam.dist = clamp(cam.dist * (1 + Math.sign(ev.deltaY) * 0.08), 1.35, 6);
    }, { passive: false });
    window.addEventListener("resize", function () {
      clearTimeout(resizeT); resizeT = setTimeout(function () { resize(false); }, 120);
    });
    document.addEventListener("keydown", function (ev) {
      if (!opened) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|SELECT|TEXTAREA/.test(tag) && ev.key !== "Escape") return;
      if (ev.key === "Escape") { close(); ev.preventDefault(); }
      else if (ev.key === " ") { var api = window.__gnauralAPI; if (api && api.togglePlay) api.togglePlay(); ev.preventDefault(); }
      else if (ev.key === "r" || ev.key === "R") resetCam();
      else if (ev.key === "c" || ev.key === "C") { P.sand = !P.sand; save(); syncControls(); }
      else if (ev.key === "l" || ev.key === "L") { P.lines = !P.lines; save(); syncControls(); }
      else if (ev.key === "f" || ev.key === "F") { P.freeze = !P.freeze; save(); syncControls(); }
    });
  }

  /* drag-orbit + click-to-disturb */
  var drag = null;
  function onDown(ev) {
    drag = { x: ev.clientX, y: ev.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: 0, t: performance.now() };
    canvas.setPointerCapture(ev.pointerId);
  }
  function onMove(ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    cam.yaw = drag.yaw - dx * 0.006;
    cam.pitch = clamp(drag.pitch + dy * 0.005, 0.12, 1.45);
  }
  function onUp(ev) {
    if (!drag) return;
    var wasClick = drag.moved < 5 && performance.now() - drag.t < 400;
    drag = null;
    if (wasClick) disturb(ev.clientX, ev.clientY);
  }
  function disturb(cx, cy) {
    var r = canvas.getBoundingClientRect();
    var nx = (cx - r.left) / r.width * 2 - 1, ny = -((cy - r.top) / r.height * 2 - 1);
    /* ray from the camera through the screen point, intersect y = 0 */
    var eye = camPos();
    var dir = [0, 0, 0];
    var yaw = cam.yaw, pitch = cam.pitch, fov = 0.8, aspect = r.width / r.height;
    var tx = nx * Math.tan(fov / 2) * aspect, ty = ny * Math.tan(fov / 2);
    /* camera basis */
    var fwd = norm([-eye[0], -eye[1], -eye[2]]);
    var right = norm(cross(fwd, [0, 1, 0]));
    var up = cross(right, fwd);
    dir = norm([fwd[0] + right[0] * tx + up[0] * ty, fwd[1] + right[1] * tx + up[1] * ty, fwd[2] + right[2] * tx + up[2] * ty]);
    if (Math.abs(dir[1]) < 1e-5) return;
    var tt = -eye[1] / dir[1];
    var px = eye[0] + dir[0] * tt, pz = eye[2] + dir[2] * tt;
    for (var i = 0; i < sand.n; i++) {
      var dx = sand.x[i] - px, dy = sand.y[i] - pz, d2 = dx * dx + dy * dy;
      if (d2 < 0.09) {
        var f = (0.09 - d2) * 26;
        sand.vx[i] += dx * f; sand.vy[i] += dy * f;
      }
    }
  }
  function camPos() {
    var yaw = cam.yaw, pitch = cam.pitch, dist = cam.dist;
    return [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.15, Math.cos(yaw) * Math.cos(pitch) * dist];
  }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function resetCam() { cam = { yaw: 0.52, pitch: 0.66, dist: 3.30 }; }

  /* ==================================================================== *
   * controls sync
   * ==================================================================== */

  function syncControls() {
    if (!root) return;
    var media = $("cymMedia").querySelectorAll("button");
    for (var i = 0; i < media.length; i++) media[i].classList.toggle("on", media[i].getAttribute("data-m") === P.medium);
    var src = $("cymSrc").querySelectorAll("button");
    for (i = 0; i < src.length; i++) src[i].classList.toggle("on", src[i].getAttribute("data-s") === P.src);
    $("cymMat").value = P.material;
    $("cymSize").value = P.size; $("cymSizeV").textContent = P.size + " mm";
    $("cymThick").value = P.thickness; $("cymThickV").textContent = (+P.thickness).toFixed(2) + " mm";
    $("cymQ").value = P.q; $("cymQV").textContent = P.q;
    $("cymHz").value = P.hz; $("cymHzV").textContent = Math.round(P.hz) + " Hz";
    $("cymDrive").value = P.drive; $("cymDriveV").textContent = Math.round(P.drive * 100) + "%";
    $("cymSand").checked = !!P.sand;
    $("cymLines").checked = !!P.lines;
    $("cymBub").checked = !!P.bubbles;
    $("cymFreeze").checked = !!P.freeze;
    var pal = $("cymPal").querySelectorAll(".cym-chip");
    for (i = 0; i < pal.length; i++) pal[i].classList.toggle("on", pal[i].getAttribute("data-id") === P.palette);
    var note = $("cymMediumNote");
    if (note) {
      note.textContent = {
        plate: "A real free-edge plate: modes solved from the plate equation (Rayleigh–Ritz), not a canned pattern.",
        bolted: "The classical centre-bolted demo plate. A node at the centre by construction; frequencies follow the (m²+n²) law.",
        disc: "Clamped circular plate — Bessel modes, λ² from the exact free-edge eigenvalue equation.",
        drum: "Ideal circular membrane — Bessel zeros; no octave in the spectrum, unlike a plate.",
        water: "Faraday waves: the surface answers at half the drive frequency, with the true gravity–capillary wavelength.",
        bubbles: "Minnaert resonance and Bjerknes forces: small bubbles collect on nodal lines, large ones in the lobes."
      }[P.medium] || "";
    }
    var scale = $("cymScale");
    if (scale) scale.textContent = P.medium === "water" ? "Pattern scale is compressed to stay visible; the true wavelength is in Physics." : "";
  }

  /* ==================================================================== *
   * open / close
   * ==================================================================== */

  function resize(force) {
    if (!root) return;
    var w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.resize(w, h, dpr);
  }

  function open() {
    if (!root) build();
    root.hidden = false;
    document.documentElement.classList.add("cym-open");
    opened = true;
    lastT = 0;
    resize(true);
    if (!raf) raf = requestAnimationFrame(frame);
    if (P.src === "session") {
      var api = window.__gnauralAPI;
      if (api && api.state && !api.state.playing && api.play) { /* leave transport alone */ }
    }
    var L = root.querySelector(".cym-left");
    if (L) L.classList.remove("open");
    if ($("cymScrim")) $("cymScrim").classList.remove("on");
    if ($("cymClose")) $("cymClose").focus();
    try { history.replaceState(null, "", "#cymatics"); } catch (e) {}
  }
  function close() {
    if (!root) return;
    opened = false;
    root.hidden = true;
    document.documentElement.classList.remove("cym-open");
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  function toggle() { opened ? close() : open(); }

  function toast(text) {
    var tt = document.getElementById("toast");
    if (!tt) return;
    tt.textContent = text; tt.classList.add("show");
    clearTimeout(tt._cymT);
    tt._cymT = setTimeout(function () { tt.classList.remove("show"); }, 2200);
  }

  function savePng() {
    try {
      var a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "cymatic-" + P.medium + "-" + Math.round(audioState.f0) + "hz.png";
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 3000);
      toast("saved PNG");
    } catch (e) { toast("could not save: " + e.message); }
  }

  /* ==================================================================== *
   * entry points + QA surface
   * ==================================================================== */

  function addEntryButtons() {
    var prefs = document.querySelector("header.studio .prefs");
    if (prefs && !document.getElementById("cymBtn")) {
      var b = el("button", "ghost", null, "&#9670; Cymatics");
      b.id = "cymBtn"; b.title = "open the Cymatic Chamber (C)";
      b.onclick = open;
      var sel = prefs.querySelector("#skin");
      if (sel) prefs.insertBefore(b, sel); else prefs.appendChild(b);
    }
    var card = document.getElementById("vizCard");
    if (card && !document.getElementById("cymCardBtn")) {
      var row = card.querySelector(".row");
      if (row) {
        var cb = el("button", "ghost", row, "&#9670; Cymatic Chamber");
        cb.id = "cymCardBtn"; cb.title = "the full-screen cymatic instrument";
        cb.onclick = open;
      }
    }
    document.addEventListener("keydown", function (ev) {
      if (opened) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      if (ev.key === "c" || ev.key === "C") { if (!ev.shiftKey) open(); }
    });
    /* #cymatics is a real route: entering it (from a link or the address bar)
     * opens the chamber, leaving it closes. */
    window.addEventListener("hashchange", function () {
      if (location.hash === "#cymatics" && !opened) open();
      else if (location.hash !== "#cymatics" && opened) close();
    });
  }

  function debugState() {
    return {
      open: opened, medium: P.medium, material: P.material, size: P.size, thickness: P.thickness,
      q: P.q, palette: P.palette, src: P.src, hz: P.hz, sand: !!P.sand, lines: !!P.lines,
      renderer: renderer ? renderer.kind : null, fps: Math.round(fps),
      field: field ? { N: field.N, active: field.active.length, scale: field.scale } : null,
      modeCount: medium ? medium.modes.length : 0,
      fRange: medium ? [medium.fMin, medium.fMax] : null,
      nearest: ana.nearest, detune: ana.detune, drive: audioState.drive,
      nearestLabel: medium ? (medium.modes[ana.nearest] || {}).label : null,
      nearestF: medium ? (medium.modes[ana.nearest] || {}).f : null,
      firstModes: medium ? medium.modes.slice(0, 3).map(function (m) { return [m.label, Math.round(m.f * 10) / 10]; }) : null,
      tone: audioState.label, partials: audioState.partials ? audioState.partials.length : 0,
      bubbles: bubbles ? bubbles.n : 0, sandN: sand ? sand.n : 0
    };
  }

  var api = {
    version: 1, open: open, close: close, toggle: toggle, debugState: debugState,
    setMedium: function (m) { P.medium = m; save(); buildMedium(); syncControls(); dirtyField = true; },
    setTone: function (hz) { P.src = "manual"; P.hz = hz; dirtyField = true; syncControls(); },
    setPrefs: function (o) {
      for (var k in o) if (P[k] !== undefined) P[k] = o[k];
      save(); if (o.medium || o.material || o.size || o.thickness) buildMedium();
      syncControls(); dirtyField = true;
    },
    getPrefs: function () { return JSON.parse(JSON.stringify(P)); }
  };

  function boot() {
    addEntryButtons();
    if (location.hash === "#cymatics") open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);

  window.ResonanceCymatics = { version: 1, api: api, open: open, close: close, toggle: toggle, debugState: debugState };
})();
