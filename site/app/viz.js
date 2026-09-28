/* Gnaural Web — Resonance Studio: the visualizer SYSTEM.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * What this is
 * ------------
 * A toggleable, multi-option visualizer system for the two ambient panels
 * (the page flanks at wide viewports; cards inside the columns at narrow
 * ones). It synchronises to the sound the player generates using two layers:
 *
 *   EXACT  — because this app SYNTHESISES its voices, the isochronic gate
 *            phase, the binaural beat envelope phase and every carrier's
 *            phase are recomputed from the schedule by vizmath.js mirrors
 *            that are arithmetic-identical to engine.js (verified: zero
 *            divergence). No FFT guessing for tone layers.
 *   MEASURED — noise beds and overall level come from an AnalyserNode feed
 *            (float spectrum, smoothing off), with a rolling coherence score
 *            ("sync") comparing the predicted gate envelope with the
 *            measured signal envelope. Honest by construction.
 *
 * What this is NOT
 * ----------------
 * Not biofeedback: nothing about the listener is measured. No microphone,
 * no sensors. The visuals react to the audio the page plays, nothing else.
 *
 * Motion safety (verified against WCAG 2.2 SC 2.3.1 and the Epilepsy
 * Foundation's stricter <2 Hz strobe advice; see design note):
 *   - visible luminance modulation is capped at 2 Hz by dividing the
 *     source rate (label: "xN slowed"); beat PHASE drives displacement,
 *     never luminance;
 *   - every flash-like envelope has >= 0.32 s attack and >= 0.45 s release
 *     applied BEFORE per-frame sampling (no aliasing of 40 Hz pulses into
 *     the 15-25 Hz risk band);
 *   - luminance excursions are small (amp scaled by intensity; hard clamps
 *     in the modes); no saturated-red flicker (palette red-guard);
 *   - master toggle stops everything; prefers-reduced-motion users get the
 *     system OFF by default.
 *
 * Public API:  window.ResonanceViz  (see api object at the bottom)
 */
(function () {
  "use strict";

  var VM = globalThis.GnauralVizMath;
  var VP = globalThis.GnauralVizPal;
  var MODES = globalThis.GnauralVizModes;
  if (!VM || !MODES || !VP) {
    console.warn("[viz] kernel missing (vizmath/vizpal/vizmodes) — visualizers not started");
    return;
  }

  var SR = 44100;
  var PREFS_KEY = "resonance.viz.v1";
  var DPR_CAP = 1.5;
  var FLANK_MIN = 1880;                 /* keep in sync with studio.css        */

  /* ==================================================================== *
   * preferences
   * ==================================================================== */

  function defaults() {
    return {
      v: 1, on: true, backdrop: "tide", overlays: ["pulse"], palette: "auto",
      intensity: 0.7, calm: 1, auto: false, seed: (Math.random() * 0xFFFFFFFF) >>> 0
    };
  }
  function loadPrefs() {
    var p = defaults();
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && typeof d === "object") {
          if (typeof d.on === "boolean") p.on = d.on;
          if (typeof d.backdrop === "string" && MODES.BACKDROPS.indexOf(d.backdrop) >= 0) p.backdrop = d.backdrop;
          if (Object.prototype.toString.call(d.overlays) === "[object Array]") {
            /* unknown ids (a renamed mode in a later build) must not go dark a
             * panel silently: keep only ids this build can draw */
            p.overlays = d.overlays.filter(function (id) {
              return MODES.OVERLAYS.indexOf(id) >= 0;
            }).slice(0, 4);
          }
          if (typeof d.palette === "string") p.palette = d.palette;
          if (typeof d.intensity === "number") p.intensity = clamp01(d.intensity);
          if (typeof d.calm === "number") p.calm = clamp01(d.calm);
          if (typeof d.auto === "boolean") p.auto = d.auto;
          if (typeof d.seed === "number") p.seed = d.seed >>> 0;
        }
      } else if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        p.on = false;                 /* WCAG 2.3.3: honour the preference first run */
      }
    } catch (e) { /* storage unavailable: defaults stand */ }
    return p;
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
  }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  var prefs = loadPrefs();

  /* ==================================================================== *
   * DOM building (self-contained; index.html only adds the script tags)
   * ==================================================================== */

  var els = { flanks: [], inline: [], card: null, chips: {}, sliders: {}, badge: [], pill: null, sync: null };

  function el(tag, cls, parent, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* inline panel: canvas + badge inside the card section */
  function buildPanel(host, mount, side) {
    var cv = el("canvas", "viz-canvas", host);
    cv.setAttribute("aria-hidden", "true");   /* decorative: the sound is the content */
    var badge = el("span", "viz-badge", host, "");
    var p = { host: host, canvas: cv, ctx: cv.getContext("2d"), mount: mount, side: side,
              W: 0, H: 0, dpr: 1, frames: 0, avgMs: 0, lastMs: 0, visible: false, badge: badge };
    host.setAttribute("data-viz-host", side);
    host.setAttribute("data-mount", mount);
    els.badge.push(badge);
    return p;
  }

  /* flank panel: the CANVAS itself is the fixed strip, so [data-viz-panel]
   * canvases are position:fixed at wide viewports (QA contract); the badge is
   * a separate fixed label. data-viz-panel is owned by updateMount — only the
   * mounted pair carries it, so the attribute always selects the live panels. */
  function buildFlank(side, id, badgeId) {
    var cv = el("canvas", "viz-canvas viz-flank", document.body);
    cv.id = id;
    cv.setAttribute("aria-hidden", "true");   /* decorative: the sound is the content */
    var badge = el("span", "viz-badge-flank", document.body, "");
    badge.id = badgeId;
    els.badge.push(badge);
    return { host: cv, canvas: cv, ctx: cv.getContext("2d"), mount: "flank", side: side,
             W: 0, H: 0, dpr: 1, frames: 0, avgMs: 0, lastMs: 0, visible: false, badge: badge };
  }

  function buildDom() {
    var main = document.querySelector("main.grid");
    var rightCol = main && main.querySelector(".col.right");
    var leftCol = null;
    var cols = main ? main.querySelectorAll(".col") : [];
    for (var i = 0; i < cols.length; i++) if (!cols[i].classList.contains("centre") && !cols[i].classList.contains("right")) { leftCol = cols[i]; break; }

    /* flank strips (fixed, outside the content band) */
    els.flanks.push(buildFlank("left", "vizFlankL", "vizFlankBadgeL"));
    els.flanks.push(buildFlank("right", "vizFlankR", "vizFlankBadgeR"));

    /* inline cards (narrow screens): the left card follows the first section
     * of the left column; the right card is placed directly under the menu
     * card (see below) so the keyboard card stays the LAST card of the right
     * column — studio.js scrolls .col.right .card:last-child on '?' */
    if (leftCol) {
      var cl = el("section", "card viz-inline", null);
      el("h3", null, cl, "Visualizer &mdash; left");
      var lfirst = leftCol.querySelector("section.card");
      if (lfirst && lfirst.nextSibling) leftCol.insertBefore(cl, lfirst.nextSibling);
      else leftCol.insertBefore(cl, leftCol.firstChild);
      els.inline.push(buildPanel(cl, "inline", "left"));
    }

    /* the menu card, right column after Live */
    var card = null;
    if (rightCol) {
      card = el("section", "card", null);
      card.id = "vizCard";
      var liveCard = rightCol.querySelector("section.card");
      if (liveCard && liveCard.nextSibling) rightCol.insertBefore(card, liveCard.nextSibling);
      else rightCol.insertBefore(card, rightCol.firstChild);
      els.card = card;

      /* the right inline card sits directly under the menu card, keeping the
       * keyboard card the last card of the column ('?' scrolls to it) */
      var cr = el("section", "card viz-inline", null);
      el("h3", null, cr, "Visualizer &mdash; right");
      if (card.nextSibling) rightCol.insertBefore(cr, card.nextSibling);
      else rightCol.appendChild(cr);
      els.inline.push(buildPanel(cr, "inline", "right"));
      card.innerHTML =
        "<h3>Visualizers <span class=\"pill\" id=\"vizPill\">on</span></h3>" +
        "<p class=\"hint\">Ambient panels on the page flanks (or as cards on narrow screens). The isochronic gate, the " +
        "binaural beat and each carrier are recomputed from the session itself &mdash; not guessed from the sound. " +
        "No microphone, no sensors: the panels follow the audio we play, nothing else.</p>" +
        "<div class=\"row\" style=\"gap:8px\">" +
        "  <button id=\"vizToggle\">Turn off</button>" +
        "  <button id=\"vizScramble\" class=\"ghost\" title=\"new backdrop, overlays and palette\">&#127922; Scramble</button>" +
        "  <span class=\"readout\" id=\"vizSync\">&mdash;</span>" +
        "</div>" +
        "<div class=\"sep\"></div>" +
        "<div class=\"row between\"><span class=\"readout\">Backdrop</span><span class=\"hint\" style=\"margin:0\">one at a time</span></div>" +
        "<div class=\"chips\" id=\"vizBackdrops\"></div>" +
        "<div class=\"row between\"><span class=\"readout\">Overlays</span><span class=\"hint\" style=\"margin:0\">toggle any</span></div>" +
        "<div class=\"chips\" id=\"vizOverlays\"></div>" +
        "<div class=\"row between\"><span class=\"readout\">Palette</span></div>" +
        "<div class=\"chips\" id=\"vizPalettes\"></div>" +
        "<label class=\"row between\" style=\"margin-top:6px\">Intensity <input id=\"vizIntensity\" type=\"range\" min=\"0\" max=\"100\"></label>" +
        "<label class=\"row between\">Calm <input id=\"vizCalm\" type=\"range\" min=\"60\" max=\"140\"></label>" +
        "<label class=\"chk\" style=\"margin-top:8px\"><input id=\"vizAuto\" type=\"checkbox\"> Auto-scramble every 45&ndash;75 s</label>" +
        "<p class=\"hint\" id=\"vizNote\" style=\"margin-top:8px\">Motion is capped by construction: at most one visible pulse " +
        "per second (WCAG&nbsp;2.3.1 allows 3), soft edges (&ge;0.3&nbsp;s), small luminance steps, no saturated-red flicker. " +
        "Skip these if flashing images affect you. Faster sessions show as slowed motion with an &ldquo;&times;N slowed&rdquo; tag.</p>";

      /* chips */
      var bd = card.querySelector("#vizBackdrops");
      var ids = MODES.BACKDROPS;
      els.chips.bd = {};
      for (i = 0; i < ids.length; i++) {
        var id = ids[i];
        var ch = el("span", "chip", bd, id === "off" ? "Off" : MODES.META[id].name);
        ch.setAttribute("data-id", id);
        ch.setAttribute("role", "button");
        ch.tabIndex = 0;
        els.chips.bd[id] = ch;
        ch.onclick = (function (bid) { return function () { setBackdrop(bid); }; })(id);
      }
      var ov = card.querySelector("#vizOverlays");
      els.chips.ov = {};
      for (i = 0; i < MODES.OVERLAYS.length; i++) {
        var oid = MODES.OVERLAYS[i];
        var oc = el("span", "chip", ov, MODES.META[oid].name);
        oc.setAttribute("data-id", oid);
        oc.setAttribute("role", "button");
        oc.tabIndex = 0;
        els.chips.ov[oid] = oc;
        oc.onclick = (function (x) { return function () { toggleOverlay(x); }; })(oid);
      }
      var pl = card.querySelector("#vizPalettes");
      els.chips.pl = {};
      for (i = 0; i < VP.PALETTES.length; i++) {
        var pid = VP.PALETTES[i].id;
        var pc = el("span", "chip", pl, pid === "auto" ? "Auto" : VP.PALETTES[i].name);
        pc.setAttribute("data-id", pid);
        pc.setAttribute("role", "button");
        pc.tabIndex = 0;
        els.chips.pl[pid] = pc;
        pc.onclick = (function (x) { return function () { setPalette(x); }; })(pid);
      }
      els.sliders.intensity = card.querySelector("#vizIntensity");
      els.sliders.calm = card.querySelector("#vizCalm");
      els.sliders.auto = card.querySelector("#vizAuto");
      els.pill = card.querySelector("#vizPill");
      els.sync = card.querySelector("#vizSync");
      card.querySelector("#vizToggle").onclick = function () { enable(!state.enabled); };
      card.querySelector("#vizScramble").onclick = function () { scramble(); };
      els.sliders.intensity.oninput = function () { prefs.intensity = this.value / 100; savePrefs(); };
      els.sliders.calm.oninput = function () { prefs.calm = this.value / 100; savePrefs(); };
      els.sliders.auto.onchange = function () { prefs.auto = this.checked; savePrefs(); nextAuto = 0; };
    }

    /* Surprise me integration: plain click = session + new scene;
     * shift-click = new scene only (capture phase, stops the session roll). */
    document.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("#randomBtn") : null;
      if (!t) return;
      if (ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); scramble(); }
      else scramble();
    }, true);

    /* keyboard: V toggles, Shift+V scrambles */
    document.addEventListener("keydown", function (ev) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      if (ev.key === "v" || ev.key === "V") {
        if (ev.shiftKey) scramble(); else enable(!state.enabled);
      }
    });

    refreshCard();
    updateMount();
  }

  function refreshCard() {
    if (!els.card) return;
    if (els.pill) { els.pill.textContent = state.enabled ? "on" : "off"; els.pill.className = "pill" + (state.enabled ? " ok" : ""); }
    var tb = document.getElementById("vizToggle");
    if (tb) tb.textContent = state.enabled ? "Turn off" : "Turn on";
    for (var id in els.chips.bd) els.chips.bd[id].classList.toggle("on", prefs.backdrop === id);
    for (var oid in els.chips.ov) els.chips.ov[oid].classList.toggle("on", prefs.overlays.indexOf(oid) >= 0);
    for (var pid in els.chips.pl) els.chips.pl[pid].classList.toggle("on", prefs.palette === pid);
    if (els.sliders.intensity) els.sliders.intensity.value = Math.round(prefs.intensity * 100);
    if (els.sliders.calm) els.sliders.calm.value = Math.round(prefs.calm * 100);
    if (els.sliders.auto) els.sliders.auto.checked = !!prefs.auto;
  }

  /* ==================================================================== *
   * panels: fit + mounts
   * ==================================================================== */

  var mqFlank = window.matchMedia ? window.matchMedia("(min-width: " + FLANK_MIN + "px)") : null;

  function activePanels() {
    return (mqFlank && mqFlank.matches) ? els.flanks : els.inline;
  }

  function updateMount() {
    var use = activePanels(), other = (use === els.flanks) ? els.inline : els.flanks;
    for (var i = 0; i < other.length; i++) {
      other[i].visible = false;
      other[i].canvas.removeAttribute("data-viz-panel");
    }
    for (var j = 0; j < use.length; j++) {
      use[j].visible = true;
      use[j].canvas.setAttribute("data-viz-panel", use[j].side);
    }
    if (document.documentElement) document.documentElement.setAttribute("data-viz-mount", (mqFlank && mqFlank.matches) ? "flank" : "inline");
    state.panels = use;
    rebuildScenes();               /* canvases changed: fresh instances       */
    fitAll(true);
  }

  function fit(p, force) {
    if (!p.visible && !force) return;
    if (force) { p.canvas.style.width = ""; p.canvas.style.height = ""; }  /* re-read CSS box */
    var host = p.host;
    var r = host.getBoundingClientRect();
    var W = Math.round(r.width), H = Math.round(r.height);
    if (W <= 0 || H <= 0) return;                    /* zero-size guard (pitfall) */
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP) * govScale;
    if (!force && p.W === W && p.H === H && Math.abs(p.dpr - dpr) < 0.01) return;
    p.W = W; p.H = H; p.dpr = dpr;
    p.canvas.width = Math.max(1, Math.round(W * dpr));
    p.canvas.height = Math.max(1, Math.round(H * dpr));
    p.canvas.style.width = W + "px";
    p.canvas.style.height = H + "px";
    p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildScenes();
  }
  function fitAll(force) {
    for (var i = 0; i < state.panels.length; i++) fit(state.panels[i], force);
  }

  var resizeT = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { updateMount(); }, 220);
  });
  if (mqFlank && mqFlank.addEventListener) mqFlank.addEventListener("change", updateMount);

  /* ==================================================================== *
   * scenes (mode instances) + palette
   * ==================================================================== */

  function skinInfo() {
    var cs = getComputedStyle(document.documentElement);
    function hex(h) {
      h = (h || "").trim();
      if (h.charAt(0) === "#") {
        if (h.length === 7) return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
        if (h.length === 4) return [parseInt(h.charAt(1) + h.charAt(1), 16), parseInt(h.charAt(2) + h.charAt(2), 16), parseInt(h.charAt(3) + h.charAt(3), 16)];
      }
      return null;
    }
    var acc = hex(cs.getPropertyValue("--acc")) || [255, 158, 79];
    var bg = hex(cs.getPropertyValue("--bg")) || [14, 11, 9];
    var o = VP.rgbToOklch(acc[0], acc[1], acc[2]);
    return { accentHue: o.h, isDark: VP.relLuminance(bg[0], bg[1], bg[2]) < 0.35 };
  }

  function palette() {
    try { return VP.paletteById(prefs.palette, skinInfo()); }
    catch (e) { return null; }
  }

  /* instances per panel: { bd: inst|null, ov: [inst] } */
  var scenes = [];

  function rebuildScenes() {
    scenes = [];
    var pal = palette();
    /* All palettes are dark-field, so every panel canvas carries an opaque
     * dark field of its own: on light skins this reads as a deliberate dark
     * window (matching the app's own graph canvas) instead of light-on-light. */
    if (pal) {
      var all = els.flanks.concat(els.inline);
      for (var ci = 0; ci < all.length; ci++) all[ci].canvas.style.background = pal.bg(1);
      for (var di = 0; di < els.badge.length; di++) els.badge[di].style.color = pal.ink(0.55, 0.85);
    }
    for (var i = 0; i < state.panels.length; i++) {
      var sc = { bd: null, ov: [], pal: pal };
      if (prefs.backdrop && prefs.backdrop !== "off") {
        sc.bd = MODES.create(prefs.backdrop, (prefs.seed + i * 0x9E3779B1) >>> 0);
      }
      for (var j = 0; j < prefs.overlays.length; j++) {
        var inst = MODES.create(prefs.overlays[j], (prefs.seed + 0x51AB7C3 + i * 977 + j) >>> 0);
        if (inst) sc.ov.push(inst);
      }
      scenes.push(sc);
    }
  }

  /* ==================================================================== *
   * the live frame: anchoring, mirrors, features
   * ==================================================================== */

  var lastEngine = null;
  var cursors = [], gates = [], envs = [], phases = [], voiceMeta = [];
  var anchorSample = 0, anchorCtxTime = 0, prevPosSample = -1;
  var simSample = 0, prevAud = 0;
  var feat = {
    rms: 0, rmsAtt: 0, rmsSlow: 0, bands: {}, bandsAtt: {}, bandsSlow: {},
    centroid: 0, centroidSlow: 0, flux: 0, sync: null, syncText: ""
  };
  var syncBuf = { pred: new Float32Array(30), meas: new Float32Array(30), i: 0, n: 0, tick: 0 };
  var analyser = null, freqDb = null, timeBytes = null, specNorm = null, synthBytes = null, sampleRate = SR, fftSize = 2048;
  var analyserNode = null, ctxWaitSince = 0;
  var lastFrameT = 0, frameRng = VP.mulberry32(12345), frameCount = 0;
  var govScale = 1, frameMs = 6, govStepT = 0;
  var nextAuto = 0;
  var crossfade = null;

  function seedMirrors(S) {
    cursors = []; gates = []; envs = []; phases = []; voiceMeta = [];
    var vs = (S.engine && S.engine.voices) || [];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      cursors.push(new VM.Cursor(v));
      gates.push(new VM.GateMirror());
      envs.push(new VM.EnvPhase());
      phases.push(new VM.PhaseMirror(cursors[i]));
      voiceMeta.push({
        type: v.type,
        kind: v.type === 0 ? "binaural" : (v.type === 3 ? "iso" : (v.type === 4 ? "isoalt" : (v.type === 1 || v.type === 7 || v.type === 8 ? "noise" : (v.type === 2 ? "pcm" : "other")))),
        mute: !!v.mute,
        prevOpen: false, openings: 0, cycleTotal: 0, prevFrac: -1,
        envCycleTotal: 0, envPrevFrac: -1, wraps: 0,
        att: 0, lastBase: 0, lastRate: 0
      });
    }
    prevAud = 0; simSample = 0; anchorSample = 0; prevPosSample = -1;
  }

  function ensureAnalyser(S) {
    if (analyser || !S.ctx || !S.node) return analyser;
    if (!ctxWaitSince) { ctxWaitSince = performance.now(); return null; }
    if (performance.now() - ctxWaitSince < 900) return null;   /* let studio wire first */
    try {
      analyser = S.ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0;      /* we do our own smoothing      */
      analyser.minDecibels = -120;
      analyser.maxDecibels = 0;
      var sink = S.ctx.createGain();
      sink.gain.value = 0;                     /* silent sink: keeps the tap pulled */
      S.node.connect(analyser);
      analyser.connect(sink);
      sink.connect(S.ctx.destination);
      freqDb = new Float32Array(analyser.frequencyBinCount);
      timeBytes = new Uint8Array(analyser.fftSize);
      specNorm = new Float32Array(analyser.frequencyBinCount);
      synthBytes = new Uint8Array(analyser.frequencyBinCount);
      sampleRate = S.ctx.sampleRate || SR;
      analyserNode = S.node;
    } catch (e) {
      console.warn("[viz] analyser tap failed:", e && e.message);
      analyser = null;
    }
    return analyser;
  }

  function mod1(x) { x = x % 1; return x < 0 ? x + 1 : x; }

  function tick(nowMs) {
    var dt = clamp01((nowMs - lastFrameT) / 1000);
    lastFrameT = nowMs;
    if (dt <= 0) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;
    frameCount++;
    F.t += dt;
    F.dt = dt;
    F.pre = prefs;
    F.prefs = prefs;
    F.pal = (scenes[0] && scenes[0].pal) || palette();
    F.seed = prefs.seed;
    F.lum = 0.055 * prefs.intensity * (2 - prefs.calm);

    var S = (window.__gnauralAPI && window.__gnauralAPI.state) || null;
    F.playing = !!(S && S.playing);

    /* ---- engine identity / reseed ---- */
    if (S && S.engine !== lastEngine) {
      lastEngine = S.engine;
      seedMirrors(S);
      for (var i = 0; i < scenes.length; i++) {
        if (scenes[i].bd) MODES.reset(scenes[i].bd, F);
        for (var j = 0; j < scenes[i].ov.length; j++) MODES.reset(scenes[i].ov[j], F);
      }
    }

    /* ---- anchor from the worklet position message ---- */
    var aud = 0, fresh = false;
    if (S && S.ctx && S.live && typeof S.live.sample === "number") {
      if (S.live.sample !== prevPosSample) {
        var newSample = S.live.sample;
        var rewound = newSample < anchorSample - SR / 2 || (newSample === 0 && prevPosSample > 0 && !S.playing);
        prevPosSample = newSample;
        if (rewound) {                                         /* stop / seek    */
          seedMirrors(S);
          simSample = newSample; anchorSample = newSample; fresh = true;
        } else {
          anchorSample = newSample;
        }
        anchorCtxTime = S.ctx.currentTime;
      }
      if (S.playing) {
        var lat = ((S.ctx.baseLatency || 0) + (S.ctx.outputLatency || 0)) * SR;
        var target = anchorSample + (S.ctx.currentTime - anchorCtxTime) * SR - lat;
        if (target < 0) target = 0;
        if (Math.abs(target - simSample) > SR / 2) simSample = target;      /* jump   */
        else simSample += (target - simSample) * 0.25;                     /* slew   */
        if (simSample < prevAud - 32) simSample = target;                  /* no backslide */
        aud = Math.floor(simSample);
        if (aud < prevAud) aud = prevAud;
      } else {
        aud = prevAud;                                        /* paused: frozen  */
        fresh = false;
      }
    }

    /* ---- advance mirrors (only forward, only while playing) ---- */
    var voices = [];
    if (S && S.engine && S.engine.voices) {
      var adv = F.playing && aud > prevAud;
      for (var vi = 0; vi < S.engine.voices.length; vi++) {
        var v = S.engine.voices[vi];
        var m = voiceMeta[vi];
        if (!m) continue;
        var s = null;
        try { s = cursors[vi].sampleAt(aud); } catch (e) { s = null; }
        if (!s) continue;
        if (adv) {
          try {
            if (m.kind === "iso" || m.kind === "isoalt") gates[vi].advance(cursors[vi], prevAud, aud);
            if (m.kind === "binaural") envs[vi].advance(cursors[vi], prevAud, aud);
            if (m.kind === "binaural" || m.kind === "iso" || m.kind === "isoalt") phases[vi].advanceTo(aud);
          } catch (e) { /* keep drawing */ }
        }
        var rate = s.beatHz > 0 ? s.beatHz : 0;
        var N = VM.strobeFactor(rate), visRate = VM.cappedRate(rate);
        var kind = m.kind;
        var vol = (s.volL + s.volR) / 2;
        m.att = VM.follow(m.att, vol, dt, 0.15, 0.35);
        var vo = {
          i: vi, kind: kind, type: m.type, base: s.baseHz, rate: rate, vol: vol,
          volL: s.volL, volR: s.volR, att: m.att,
          u: clamp01(Math.log(Math.max(40, s.baseHz) / 40) / Math.log(12.5)),
          gate: { open: true, phase: 0, vis: 0, pulse: 0, N: N, visRate: visRate, cycleTotal: 0, openings: 0 },
          env: { phase: 0, vis: 0, level: 0, N: N, visRate: visRate, cycleTotal: 0, wraps: 0 },
          sinL: 0, sinR: 0, fL: 0, fR: 0
        };
        if (kind === "iso" || kind === "isoalt") {
          var g = gates[vi];
          var ph = g.phase();
          var d = ph - m.prevFrac;
          if (m.prevFrac >= 0) { if (d < -0.5) d += 1; else if (d > 0.5) d -= 1; m.cycleTotal += d; }
          m.prevFrac = ph;
          var open = g.open();
          if (open && !m.prevOpen) m.openings++;
          m.prevOpen = open;
          var N2 = Math.max(1, N);
          var idx = Math.floor(m.cycleTotal);
          var slowedOpen = ((idx % N2) === 0) && (mod1(m.cycleTotal) < 0.5);
          vo.gate.open = open;
          vo.gate.phase = ph;
          vo.gate.vis = VM.follow(vo.gate.vis, open ? 1 : 0, dt, 0.32, 0.5);
          vo.gate.pulse = VM.follow(m._pulse === undefined ? 0 : m._pulse, slowedOpen ? 1 : 0, dt, 0.32, 0.5);
          m._pulse = vo.gate.pulse;
          vo.gate.cycleTotal = m.cycleTotal;
          vo.gate.openings = m.openings;
        }
        if (kind === "binaural") {
          var ep = envs[vi];
          var eph = ep.phi;
          var de = eph - m.envPrevFrac;
          if (m.envPrevFrac >= 0) { if (de < -0.5) { de += 1; m.wraps++; } else if (de > 0.5) de -= 1; m.envCycleTotal += de; }
          m.envPrevFrac = eph;
          var Ne = Math.max(1, N);
          var cvis = mod1(m.envCycleTotal / Ne);
          var target = 0.5 + 0.5 * Math.cos(2 * Math.PI * cvis);
          m._env = VM.follow(m._env === undefined ? 0.5 : m._env, target, dt, 0.25, 0.45);
          vo.env.phase = eph;
          vo.env.level = m._env;
          vo.env.N = Ne; vo.env.cycleTotal = m.envCycleTotal; vo.env.wraps = m.wraps;
          vo.env.vis = target;
        }
        if (kind === "binaural" || kind === "iso" || kind === "isoalt") {
          var pm = phases[vi];
          vo.phiL = pm.phiL; vo.phiR = pm.phiR;
          vo.sinL = pm.sinL(); vo.sinR = pm.sinR();
          var half = (kind === "binaural") ? rate / 2 : 0;
          vo.fL = s.baseHz + half; vo.fR = s.baseHz - half;
        } else {
          vo.gate.pulse = VM.follow(m._pulse === undefined ? 0 : m._pulse, feat.rmsAtt, dt, 0.2, 0.4);
          m._pulse = vo.gate.pulse;
        }
        voices.push(vo);
      }
    }
    if (!F.playing) {
      /* Paused: the mirrors are frozen, and a frozen mirror is a still
       * picture. Swap in one idle drift voice so the ambience keeps breathing
       * on its own clock; real sync only exists while audio is playing. */
      voices = [idleVoice()];
    }
    F.voices = voices;
    if (adv) prevAud = aud;
    F.sample = aud;

    /* ---- measured features ---- */
    if (S && ensureAnalyser(S)) {
      try {
        analyser.getFloatFrequencyData(freqDb);
        analyser.getByteTimeDomainData(timeBytes);
      } catch (e) { /* keep last */ }
      var beds = 0;
      for (var bi = 0; bi < voices.length; bi++) if (voices[bi].kind === "noise" && voices[bi].att > 0.01) beds++;
      F.hasBeds = beds > 0;
      for (var k = 0; k < freqDb.length; k++) {
        var db = freqDb[k];
        if (db < -110 || db !== db) db = -110;
        var b = Math.round(((db + 100) / 80) * 255);
        synthBytes[k] = b < 0 ? 0 : (b > 255 ? 255 : b);
        specNorm[k] = clamp01((db + 78) / 66);
      }
      var gain = (S.master && S.master.gain) ? S.master.gain.value : 1;
      var rms = VM.rmsFromBytes(timeBytes) * gain;
      feat.rms = rms;
      feat.rmsAtt = VM.follow(feat.rmsAtt, rms, dt, 0.12, 0.25);
      feat.rmsSlow = VM.follow(feat.rmsSlow, rms, dt, 5, 5);
      var bins = VM.bandBins(analyser.fftSize, sampleRate);
      var bands = VM.bandEnergies(synthBytes, bins);
      for (var id in bands) {
        if (feat.bands[id] === undefined) { feat.bands[id] = 0; feat.bandsAtt[id] = 0; feat.bandsSlow[id] = 0; }
        feat.bands[id] = bands[id];
        feat.bandsAtt[id] = VM.follow(feat.bandsAtt[id], bands[id], dt, 0.20, 0.20);
        feat.bandsSlow[id] = VM.follow(feat.bandsSlow[id], bands[id], dt, 5, 5);
      }
      var cen = VM.spectralCentroid(synthBytes, analyser.fftSize, sampleRate);
      if (cen > 0) { feat.centroid = cen; feat.centroidSlow = VM.follow(feat.centroidSlow, cen, dt, 5, 5); }
      if (feat._prevBytes) feat.flux = VM.spectralFlux(feat._prevBytes, synthBytes);
      feat._prevBytes = (feat._prevBytes && feat._prevBytes.length === synthBytes.length) ? feat._prevBytes : new Uint8Array(synthBytes.length);
      feat._prevBytes.set(synthBytes);
    }

    /* ---- coherence score at 10 Hz ---- */
    if (F.playing && voices.length) {
      syncBuf.tick += dt;
      if (syncBuf.tick >= 0.1) {
        syncBuf.tick = 0;
        var pv = null;
        for (var si = 0; si < voices.length; si++) {
          var vv = voices[si];
          if (vv.kind === "binaural" || vv.kind === "iso" || vv.kind === "isoalt") {
            var pp = (vv.kind === "binaural") ? vv.env.level : vv.gate.pulse;
            if (pv === null || vv.att > pv.att) pv = { att: vv.att, p: pp };
          }
        }
        if (pv && pv.att > 0.02) {
          syncBuf.pred[syncBuf.i] = pv.p;
          syncBuf.meas[syncBuf.i] = clamp01(feat.rmsAtt * 3);
          syncBuf.i = (syncBuf.i + 1) % 30;
          if (syncBuf.n < 30) syncBuf.n++;
        }
      }
      if (syncBuf.n >= 12) {
        var p30 = [], m30 = [];
        for (var q = 0; q < syncBuf.n; q++) { p30.push(syncBuf.pred[q]); m30.push(syncBuf.meas[q]); }
        var r = VM.pearson(p30, m30);
        feat.sync = isFinite(r) ? r : null;
      }
      feat.syncText = feat.sync !== null ? "sync " + feat.sync.toFixed(2) : (F.hasBeds ? "bed (no pulse to lock)" : "warming up");
    } else {
      feat.sync = null;
      feat.syncText = F.playing ? (F.hasBeds ? "bed (no pulse to lock)" : "no pulse layer") : "paused";
    }
    F.feat = feat;
    F.spectrum = F.hasBeds ? specNorm : null;
    F.sampleRate = sampleRate;
    F.fftSize = analyser ? analyser.fftSize : fftSize;

    /* ---- auto-scramble (anti-metronome timing, off by default) ---- */
    if (prefs.auto) {
      if (!nextAuto) nextAuto = F.t + 45 + frameRng() * 30;
      if (F.t >= nextAuto) { nextAuto = 0; scramble({ auto: true }); }
    }

    /* ---- render ---- */
    var t1 = performance.now();
    for (var pi = 0; pi < state.panels.length; pi++) {
      var p = state.panels[pi];
      if (!p.visible) continue;
      if (p.canvas.width === 0) { fit(p, true); if (p.canvas.width === 0) continue; }
      var ctx = p.ctx, sc = scenes[pi];
      ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
      ctx.clearRect(0, 0, p.W, p.H);
      F.ctx = ctx; F.W = p.W; F.H = p.H; F.dpr = p.dpr;
      /* field geometry: both flanks are windows onto one page-wide surface   */
      if (p.mount === "flank") {
        var vw = Math.max(p.W, document.documentElement.clientWidth || p.W);
        var x0 = (p.side === "left") ? 0 : vw - p.W;
        F.field = { W: vw, x0: x0 };
      } else {
        F.field = { W: p.W, x0: 0 };
      }
      if (sc) {
        if (sc.bd) { stepMode(sc.bd, F); drawMode(sc.bd, F); }
        for (var oi = 0; oi < sc.ov.length; oi++) {
          stepMode(sc.ov[oi], F);
          drawMode(sc.ov[oi], F);
        }
      }
      /* crossfade veil (auto-scramble blend) */
      if (crossfade && crossfade.snap[pi]) {
        var age = F.t - crossfade.t0;
        var a = 1 - clamp01(age / crossfade.dur);
        ctx.save();
        ctx.globalAlpha = a < 0.4 ? 0 : (a - 0.4) / 0.6;      /* trough then out */
        ctx.drawImage(crossfade.snap[pi], 0, 0, crossfade.snap[pi].width, crossfade.snap[pi].height, 0, 0, p.W, p.H);
        ctx.restore();
        if (pi === state.panels.length - 1 && age >= crossfade.dur) crossfade = null;
      }
      p.frames++;
    }
    var ms = performance.now() - t1;
    frameMs = frameMs * 0.9 + ms * 0.1;
    /* governor: step down resolution, then budgets, if frames hurt */
    govStepT += dt;
    if (govStepT > 3) {
      govStepT = 0;
      if (frameMs > 22 && govScale > 1.01) { govScale = 1; fitAll(true); }
      else if (frameMs > 22 && p0Avg() > 26) { /* already at dpr 1: budget cut */ }
    }

    /* ---- badges + card sync text at ~4 Hz ---- */
    F.badgeT = (F.badgeT || 0) + dt;
    if (F.badgeT >= 0.25) {
      F.badgeT = 0;
      var v0 = pulseVoiceLocal(voices);
      var lab = "";
      if (v0) {
        var n0 = (v0.kind === "binaural") ? v0.env.N : v0.gate.N;
        if (n0 > 1) lab = "\u00d7" + n0 + " slowed";
      }
      var txt = (feat.syncText || "") + (lab ? "  \u00b7  " + lab : "");
      for (var b2 = 0; b2 < els.badge.length; b2++) els.badge[b2].textContent = state.enabled ? txt : "";
      if (els.sync) els.sync.textContent = txt || "\u2014";
    }
  }

  function pulseVoiceLocal(voices) {
    var iso = null, bin = null;
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (v.kind === "iso" || v.kind === "isoalt") { if (!iso || v.att > iso.att) iso = v; }
      else if (v.kind === "binaural") { if (!bin || v.att > bin.att) bin = v; }
    }
    return iso || bin;
  }

  /* The paused-state pseudo-voice: a 45 s ambient breath on the wall clock,
   * shaped exactly like a real voice so every mode works unchanged. The
   * panels label themselves "paused" while it runs, and debugState() leaves
   * it out of the voices list (it is not audio data). */
  function idleVoice() {
    var ph = mod1(F.t / 45);
    var lvl = 0.5 + 0.5 * Math.sin(ph * 2 * Math.PI);
    return {
      i: -1, kind: "idle", type: -1, base: 0, rate: 0, vol: 0, volL: 0, volR: 0, att: 0, u: 0.5,
      gate: { open: false, phase: ph, vis: lvl * 0.5, pulse: lvl, N: 1, visRate: 1, cycleTotal: F.t / 45, openings: 0 },
      env: { phase: ph, vis: lvl, level: lvl, N: 1, visRate: 1, cycleTotal: F.t / 45, wraps: 0 },
      sinL: 0, sinR: 0, fL: 0, fR: 0
    };
  }
  function p0Avg() { var a = 0, n = 0; for (var i = 0; i < state.panels.length; i++) { a += state.panels[i].avgMs; n++; } return n ? a / n : 0; }

  function stepMode(inst, F) {
    try { MODES.step(inst, F); } catch (e) {
      if (!stepMode._warned) stepMode._warned = {};
      if (!stepMode._warned[inst.id]) {
        stepMode._warned[inst.id] = 1;
        console.warn("[viz] step failed:", inst.id, e && e.message);
      }
    }
  }

  function drawMode(inst, F) {
    var meta = MODES.META[inst.id];
    var field = meta && meta.space === "field" && F.field;
    if (field) {
      F.ctx.save();
      F.ctx.beginPath();
      F.ctx.rect(0, 0, F.W, F.H);
      F.ctx.clip();
      F.ctx.translate(-F.field.x0, 0);
    }
    try { MODES.draw(inst, F); } catch (e) {
      if (!drawMode._warned) drawMode._warned = {};
      if (!drawMode._warned[inst.id]) {
        drawMode._warned[inst.id] = 1;
        console.warn("[viz] mode failed:", inst.id, e && e.message);
      }
    }
    if (field) F.ctx.restore();
  }

  /* the frame object shared by all modes */
  var F = {
    ctx: null, W: 0, H: 0, dt: 1 / 60, t: 0, playing: false, dpr: 1,
    pre: prefs, prefs: prefs, pal: null, seed: 0, lum: 0, field: null,
    feat: feat, voices: [], spectrum: null, hasBeds: false,
    sampleRate: SR, fftSize: 2048, sample: 0,
    rng: function () { return frameRng(); }
  };

  /* ==================================================================== *
   * the loop
   * ==================================================================== */

  var raf = 0;
  var state = { enabled: false, panels: [] };

  function loop(ts) {
    if (!state.enabled) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;                 /* hidden tab: no work           */
    tick(ts);
  }

  function enable(on) {
    on = !!on;
    if (on === state.enabled) { refreshCard(); return; }
    state.enabled = on;
    prefs.on = on;                 /* persist the master switch: the card button and V last */

    if (on) {
      lastFrameT = performance.now();
      raf = requestAnimationFrame(loop);
      if (els.card) els.card.classList.add("viz-live");
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (var bi = 0; bi < els.badge.length; bi++) els.badge[bi].textContent = "";
      if (els.sync) els.sync.textContent = "\u2014";
    }
    refreshCard();
    savePrefs();
  }

  function setBackdrop(id) {
    if (MODES.BACKDROPS.indexOf(id) < 0) return;
    prefs.backdrop = id;
    savePrefs(); rebuildScenes(); refreshCard();
  }
  function setOverlays(ids) {
    var out = [];
    for (var i = 0; i < ids.length && i < 4; i++) if (MODES.OVERLAYS.indexOf(ids[i]) >= 0 && out.indexOf(ids[i]) < 0) out.push(ids[i]);
    prefs.overlays = out;
    savePrefs(); rebuildScenes(); refreshCard();
  }
  function toggleOverlay(id) {
    var at = prefs.overlays.indexOf(id);
    if (at >= 0) { prefs.overlays.splice(at, 1); }
    else { if (prefs.overlays.length >= 4) prefs.overlays.shift(); prefs.overlays.push(id); }
    savePrefs(); rebuildScenes(); refreshCard();
  }
  function setPalette(id) {
    for (var i = 0; i < VP.PALETTES.length; i++) if (VP.PALETTES[i].id === id) { prefs.palette = id; savePrefs(); rebuildScenes(); refreshCard(); return; }
  }

  /* ---- scramble: pool curation + constrained draw (design rules R1-R13) -- */
  var recent = [];
  function sessionCharacter(S) {
    var hasBed = false, hasRate = false, slowest = 99, fastest = 0, voices = 0;
    var vs = (S && S.engine && S.engine.voices) || [];
    for (var i = 0; i < vs.length; i++) {
      var t = vs[i].type;
      if (t === 1 || t === 7 || t === 8) hasBed = true;
      if (t === 0 || t === 3 || t === 4) {
        hasRate = true; voices++;
        var e = vs[i].entries && vs[i].entries[0];
        var r = e ? (e.beat || 0) : 0;
        if (r > 0) { slowest = Math.min(slowest, r); fastest = Math.max(fastest, r); }
      }
    }
    return { hasBed: hasBed, hasRate: hasRate, slowest: slowest, fastest: fastest, voices: voices };
  }

  function scramble(opts) {
    opts = opts || {};
    var S = (window.__gnauralAPI && window.__gnauralAPI.state) || null;
    var ch = sessionCharacter(S);
    var r = VP.mulberry32((Date.now() ^ frameCount) >>> 0);
    var attempt = 0, picked = null;
    while (attempt < 8 && !picked) {
      attempt++;
      /* backdrop weights (curated pool, session-fit) */
      var bw = { tide: 5, drift: 4, aurora: 4, rainfall: 2.6, score: 2.2 };
      if (ch.hasBed) { bw.rainfall += 2.5; bw.score += 3; }
      if (ch.hasRate && ch.slowest <= 2) { bw.tide += 2; bw.aurora += 1.5; }
      if (ch.hasRate && ch.fastest >= 10) { bw.aurora += 1; bw.score += 0.8; }
      var backend = VP.weightedPick(r, ["tide", "drift", "aurora", "rainfall", "score"], [bw.tide, bw.drift, bw.aurora, bw.rainfall, bw.score]);
      /* overlays: 2-3 (+meters rarely) with taste constraints */
      var ow = { pulse: ch.hasRate ? 6 : 1.2, ripples: 3, phasors: 3, traces: 2.2, orbits: 2.6, harmonograph: 3, weave: 3.6, meters: 1.1 };
      var pool = [];
      for (var k in ow) pool.push(k);
      var weights = pool.map(function (id) { return ow[id] * recencyPenalty(id); });
      var nOv = 2 + Math.floor(r() * 2);                 /* 2..3 */
      var ovs = [];
      for (var s2 = 0; s2 < nOv; s2++) {
        var idp = VP.weightedPick(r, pool, weights);
        var at = pool.indexOf(idp);
        if (at >= 0) { pool.splice(at, 1); weights.splice(at, 1); }
        if (ovs.indexOf(idp) < 0) ovs.push(idp);
      }
      /* constraints (R4/R6-ish within our overlay vocabulary) */
      if (ovs.indexOf("weave") >= 0 && ovs.indexOf("harmonograph") >= 0) {
        ovs.splice(ovs.indexOf(r() < 0.5 ? "weave" : "harmonograph"), 1);
      }
      if (ch.hasRate && ovs.indexOf("pulse") < 0 && !ovs.length) ovs.push("pulse");
      if (ch.hasRate && nOv >= 2 && ovs.indexOf("pulse") < 0 && r() < 0.45) { ovs[0] = "pulse"; }
      var palId = r() < 0.3 ? "auto" : VP.PALETTES[Math.floor(r() * VP.PALETTES.length)].id;
      var sig = backend + "|" + ovs.slice().sort().join(",");
      var hero = backend + "+" + (ovs[0] || "");
      if (recent.indexOf(hero) >= 0 && attempt < 8) continue;         /* R12 */
      picked = { backdrop: backend, overlays: ovs.slice(0, 4), palette: palId, hero: hero,
                 intensity: Math.round((55 + r() * 30)) / 100, calm: Math.round((75 + r() * 50)) / 100 };
    }
    picked = picked || { backdrop: "tide", overlays: ["pulse"], palette: "auto", hero: "safe", intensity: 0.7, calm: 1 };

    /* snapshots for the blend when auto-switching */
    if (opts.auto) {
      var snaps = [];
      for (var pi = 0; pi < state.panels.length; pi++) {
        var p = state.panels[pi];
        if (p.visible && p.canvas.width) snaps.push(snapshot(p));
        else snaps.push(null);
      }
      crossfade = { t0: F.t, dur: 4.5, snap: snaps };
    }

    prefs.backdrop = picked.backdrop;
    prefs.overlays = picked.overlays;
    prefs.palette = picked.palette;
    prefs.intensity = picked.intensity;
    prefs.calm = picked.calm;
    prefs.seed = ((r() * 0xFFFFFFFF) >>> 0);
    recent.push(picked.hero);
    if (recent.length > 10) recent.shift();
    savePrefs();
    rebuildScenes();
    refreshCard();
    toastViz("Scrambled: " + MODES.META[picked.backdrop].name + " + " +
      picked.overlays.map(function (x) { return MODES.META[x].name; }).join(" \u00b7 "));
    return { seed: prefs.seed, backdrop: prefs.backdrop, overlays: prefs.overlays.slice(),
             palette: prefs.palette, intensity: prefs.intensity, calm: prefs.calm };
  }
  function recencyPenalty(id) {
    for (var i = 0; i < recent.length; i++) if (recent[i].indexOf(id) >= 0) return (recent.length - i <= 3) ? 0.25 : 0.7;
    return 1;
  }
  function snapshot(p) {
    var c = document.createElement("canvas");
    c.width = p.canvas.width; c.height = p.canvas.height;
    c.getContext("2d").drawImage(p.canvas, 0, 0);
    return c;
  }
  function toastViz(text) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(t._vizT);
    t._vizT = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ==================================================================== *
   * debug / QA surface
   * ==================================================================== */

  function debugState() {
    var S = (window.__gnauralAPI && window.__gnauralAPI.state) || null;
    var pv = pulseVoiceLocal(F.voices);
    return {
      enabled: state.enabled,
      backdrop: prefs.backdrop, overlays: prefs.overlays.slice(), palette: prefs.palette,
      seed: prefs.seed,
      N: pv ? ((pv.kind === "binaural") ? pv.env.N : pv.gate.N) : 1,
      fVis: pv ? ((pv.kind === "binaural") ? pv.env.visRate : pv.gate.visRate) : 0,
      panels: state.panels.map(function (p) {
        return { mount: p.mount, w: p.W, h: p.H, dpr: p.dpr, visible: p.visible, frames: p.frames, avgFrameMs: Math.round(frameMs * 100) / 100 };
      }),
      audio: {
        ctx: (S && S.ctx) ? S.ctx.state : "none",
        analyser: !!analyser,
        rms: Math.round(feat.rms * 10000) / 10000,
        bands: { sub: feat.bandsAtt.sub || 0, low: feat.bandsAtt.low || 0, carrier: feat.bandsAtt.carrier || 0, mid: feat.bandsAtt.mid || 0, air: feat.bandsAtt.air || 0 },
        centroid: Math.round(feat.centroidSlow || 0), flux: Math.round(feat.flux * 1000) / 1000, corr: null
      },
      voices: F.voices.filter(function (v) { return v.kind !== "idle"; }).map(function (v) {
        /* Beds and PCM layers carry no carrier and the engine ignores their
         * basefreq; report the characteristic frequency of what actually
         * plays (measured noise corners: pink 222.85 Hz, brown 138.99 Hz;
         * white / unknown: flat to Nyquist) rather than a bare 0. */
        var f0 = v.base;
        if (!(f0 > 0)) {
          if (v.kind === "noise") f0 = (v.type === 1 ? 222.85 : (v.type === 8 ? 138.99 : 22050));
          else f0 = 22050;
        }
        return { type: v.kind, rate: v.rate, f0: f0, volL: v.volL, volR: v.volR,
                 gatePhase: v.kind === "iso" || v.kind === "isoalt" ? v.gate.phase : (v.kind === "binaural" ? v.env.phase : 0) };
      }),
      sync: { r: feat.sync, text: feat.syncText || "" },
      safety: { flashCapHz: VM.FLASH_CAP_HZ, lumRateHz: pv ? ((pv.kind === "binaural") ? pv.env.visRate : pv.gate.visRate) : 0,
                modDepth: Math.round(F.lum * 1000) / 1000, divisorN: pv ? ((pv.kind === "binaural") ? pv.env.N : pv.gate.N) : 1,
                slowLabel: pv && ((pv.kind === "binaural") ? pv.env.N : pv.gate.N) > 1 ? "\u00d7" + ((pv.kind === "binaural") ? pv.env.N : pv.gate.N) + " slowed" : "" },
      sample: F.sample, playing: F.playing, frameMs: Math.round(frameMs * 100) / 100
    };
  }

  var api = {
    version: 1,
    enable: enable,
    toggle: function () { enable(!state.enabled); },
    setPrefs: function (obj) {
      if (!obj) return;
      if (typeof obj.on === "boolean") prefs.on = obj.on;
      if (typeof obj.backdrop === "string") prefs.backdrop = obj.backdrop;
      if (obj.overlays) prefs.overlays = obj.overlays.slice(0, 4);
      if (typeof obj.palette === "string") prefs.palette = obj.palette;
      if (typeof obj.intensity === "number") prefs.intensity = clamp01(obj.intensity);
      if (typeof obj.calm === "number") prefs.calm = clamp01(obj.calm);
      if (typeof obj.auto === "boolean") prefs.auto = obj.auto;
      if (typeof obj.seed === "number") prefs.seed = obj.seed >>> 0;
      savePrefs(); rebuildScenes(); refreshCard();
      if (typeof obj.on === "boolean") enable(obj.on);
    },
    getPrefs: function () { return JSON.parse(JSON.stringify(prefs)); },
    setBackdrop: setBackdrop,
    setOverlays: setOverlays,
    toggleOverlay: toggleOverlay,
    setPalette: setPalette,
    scramble: scramble,
    debugState: debugState,
    _testTick: function (n, dt) { n = n || 1; dt = dt || 1 / 60; for (var i = 0; i < n; i++) tick(performance.now() + i * dt * 1000); }
  };

  /* ==================================================================== *
   * boot
   * ==================================================================== */

  function boot() {
    try { buildDom(); } catch (e) { console.warn("[viz] DOM build failed:", e && e.message); return; }
    F.pal = palette();
    state.panels = activePanels();
    rebuildScenes();
    fitAll(true);
    enable(prefs.on);
    window.ResonanceViz = { version: api.version, api: api };
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else setTimeout(boot, 0);
  }
})();
