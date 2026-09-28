/* Gnaural Web — Resonance Studio panel layer.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Drives the core (app.js + engine.js + gnm.js + packs.js + rates.js) from the
 * standalone site's UI: session browser with search/favourites, quick-pick rate
 * chips, live meters and spectrum, phase wheel, band readout, breathing pacer,
 * session timer, .gnaural export, share links, skins and focus mode.
 *
 * Design rules this file follows:
 *  - the core stays in charge of audio; everything here goes through
 *    window.__gnauralAPI (loadPreset / addVoice / ...) rather than reaching in;
 *  - no claim anywhere: rate chips carry the same statuses as rates.js;
 *  - nothing depends on the network: no uploads, no fetches, no analytics.
 */
(function () {
  "use strict";

  /* The core (app.js) publishes window.__gnauralAPI from its own boot, which runs
   * on DOMContentLoaded — after this file is parsed. So nothing here may touch
   * the API at load time; it is captured in boot() below. */
  var API = null, S = null;
  var R = window.GnauralRates;
  var GE = window.GnauralEngine;
  var GNM = window.GnauralGNM;
  var $ = function (id) { return document.getElementById(id); };

  var ENGINE_TYPE = { binaural: GE.VOICE_BINAURAL, pink: GE.VOICE_PINK, iso: GE.VOICE_ISOPULSE,
                      isoalt: GE.VOICE_ISOPULSE_ALT, white: GE.VOICE_WHITE, brown: GE.VOICE_BROWN };
  var TYPE_LABEL = { 0: "binaural pair", 1: "pink noise", 3: "isochronic pulses", 4: "alt pulses",
                     7: "white noise", 8: "brown noise" };
  var FAV_KEY = "resonance.favourites.v1";
  var PREF_KEY = "resonance.prefs.v1";

  function toast(t) { API.toast(t); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function store(key, val) {
    try {
      if (val === undefined) { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* private mode: preferences just do not stick */ }
    return val;
  }
  function minutes(sec) { return Math.round(sec / 60); }

  /* ================================================================ browser */

  var prefs = store(PREF_KEY) || {};
  var favs = store(FAV_KEY) || [];
  var filter = "all";
  var query = "";

  function presetList() { return S.presetList || []; }
  function packNames() {
    var seen = [], order = [];
    presetList().forEach(function (it) {
      if (order.indexOf(it.packName) === -1) { order.push(it.packName); seen.push(it.packName); }
    });
    return seen;
  }
  function isFav(name) { return favs.indexOf(name) !== -1; }
  function toggleFav(name) {
    var i = favs.indexOf(name);
    if (i === -1) favs.push(name); else favs.splice(i, 1);
    store(FAV_KEY, favs);
    renderBrowser();
  }
  function visibleItems() {
    var q = query.trim().toLowerCase();
    return presetList().map(function (it, i) { return { it: it, i: i }; }).filter(function (rec) {
      var it = rec.it;
      if (filter === "favs" && !isFav(it.name)) return false;
      if (filter !== "all" && filter !== "favs" && it.packName !== filter) return false;
      if (!q) return true;
      return (it.name + " " + (it.blurb || "") + " " + it.packName).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderFilters() {
    var box = $("filters");
    box.innerHTML = "";
    var mk = function (id, label, count) {
      var b = el("button", "chip" + (filter === id ? " on" : ""), label + (count !== undefined ? " (" + count + ")" : ""));
      b.type = "button";
      b.onclick = function () { filter = id; renderBrowser(); };
      return b;
    };
    var all = presetList().length;
    var fcount = presetList().filter(function (it) { return isFav(it.name); }).length;
    box.appendChild(mk("all", "All sessions", all));
    box.appendChild(mk("favs", "★ Favourites", fcount));
    packNames().forEach(function (p) {
      var n = presetList().filter(function (it) { return it.packName === p; }).length;
      box.appendChild(mk(p, p.replace(/ —.*$/, ""), n));
    });
  }

  function renderBrowser() {
    renderFilters();
    var list = $("plist");
    list.innerHTML = "";
    var items = visibleItems();
    var lastPack = null;
    items.forEach(function (rec) {
      var it = rec.it;
      if (it.packName !== lastPack) {
        lastPack = it.packName;
        list.appendChild(el("div", "grp", it.packName));
      }
      var row = el("div", "item" + (it.name === S.title ? " sel" : ""));
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-selected", it.name === S.title ? "true" : "false");
      var star = el("button", "star" + (isFav(it.name) ? " on" : ""), isFav(it.name) ? "★" : "☆");
      star.type = "button";
      star.title = "favourite";
      star.setAttribute("aria-label", "toggle favourite for " + it.name);
      star.onclick = function (ev) { ev.stopPropagation(); toggleFav(it.name); };
      var nm = el("div", "nm");
      nm.appendChild(el("b", null, it.name));
      var sub = el("span", null, (it.blurb || "").replace(/\s*\d+ minutes\.\s*$/, ""));
      nm.appendChild(sub);
      row.appendChild(star);
      row.appendChild(nm);
      var load = function () { API.loadPreset(rec.i); $("presets").value = String(rec.i); renderBrowser(); };
      row.onclick = load;
      row.onkeydown = function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); load(); } };
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(el("div", "hint", "Nothing matches that filter."));
    $("count").textContent = items.length + " of " + presetList().length + " shown";
  }

  /* ============================================================ quick picks */

  function addIso(hz, carrier, opts) {
    opts = opts || {};
    var i = API.addVoice(GE.VOICE_ISOPULSE, [{ duration: opts.seconds || 600, volL: opts.vol || 0.12,
      volR: opts.vol || 0.12, basefreq: carrier || 300, beat: hz }]);
    toast("Added isochronic pulse · " + hz + " Hz on " + (carrier || 300) + " Hz · speaker-safe");
    return i;
  }
  function addPair(hz, carrier, opts) {
    opts = opts || {};
    var i = API.addVoice(GE.VOICE_BINAURAL, [{ duration: opts.seconds || 600, volL: opts.vol || 0.12,
      volR: opts.vol || 0.12, basefreq: carrier || 200, beat: hz }]);
    toast("Added binaural pair · " + hz + " Hz around " + (carrier || 200) + " Hz · headphones");
    return i;
  }
  function addTone(hz, opts) {
    opts = opts || {};
    var i = API.addVoice(GE.VOICE_BINAURAL, [{ duration: opts.seconds || 600, volL: opts.vol || 0.14,
      volR: opts.vol || 0.14, basefreq: hz, beat: 0 }], { mono: true });
    toast("Added a steady " + hz + " Hz tone (both channels)");
    return i;
  }
  function addMonaural(sep, carrier, opts) {
    opts = opts || {};
    var vol = opts.vol || 0.1, secs = opts.seconds || 600;
    API.addVoice(GE.VOICE_BINAURAL, [{ duration: secs, volL: vol, volR: vol, basefreq: carrier || 100, beat: 0 }], { mono: true });
    API.addVoice(GE.VOICE_BINAURAL, [{ duration: secs, volL: vol, volR: vol, basefreq: (carrier || 100) + sep, beat: 0 }], { mono: true });
    toast("Added " + (carrier || 100) + " + " + ((carrier || 100) + sep) + " Hz · beats at " + sep + " Hz in the room");
  }
  function addBed(kind, opts) {
    opts = opts || {};
    var type = kind === "pink" ? GE.VOICE_PINK : (kind === "white" ? GE.VOICE_WHITE : GE.VOICE_BROWN);
    API.addVoice(type, [{ duration: opts.seconds || 600, volL: opts.vol || 0.05, volR: opts.vol || 0.05 }]);
    toast("Added a " + kind + " noise bed at low level");
  }

  function renderQuickPicks() {
    var box = $("quickpick");
    box.innerHTML = "";
    R.GROUPS.forEach(function (g) {
      var d = document.createElement("details");
      d.className = "tool";
      var sm = document.createElement("summary");
      sm.textContent = g.name;
      d.appendChild(sm);
      var body = el("div", "body");
      body.appendChild(el("p", "hint", g.blurb));
      var rowEl = el("div", "chips");
      g.items.forEach(function (it) {
        var b = el("button", "chip", it.name);
        b.type = "button";
        b.title = it.note || "";
        b.onclick = function () {
          var secs = quickSeconds;
          if (it.kind === "iso") addIso(it.hz, 300, { seconds: secs });
          else if (it.kind === "binaural") addPair(it.hz, 200, { seconds: secs });
          else if (it.kind === "monaural") addMonaural(it.hz, 100, { seconds: secs });
          else if (it.kind === "tone") addTone(it.hz, { seconds: secs });
          else addBed(it.kind, { seconds: secs });
          refreshHearing();
        };
        rowEl.appendChild(b);
        if (it.note) {
          var n = el("div", "hint", it.name + " — " + it.note);
          n.style.margin = "2px 0 6px";
          body.appendChild(n);
        }
      });
      body.appendChild(rowEl);
      d.appendChild(body);
      box.appendChild(d);
    });
  }

  /* ======================================================== hearing readout */

  function voiceSummary(v) {
    var rates = [], carriers = [];
    v.entries.forEach(function (e) {
      var beat = e.beatfreq_start_HALF !== undefined ? e.beatfreq_start_HALF * 2 : e.beat;
      var base = e.basefreq_start !== undefined ? e.basefreq_start : 0;
      var endBeat = (e.beatfreq_start_HALF !== undefined ? e.beatfreq_start_HALF * 2 : e.beat) +
                    (e.beatfreq_spread_HALF ? e.beatfreq_spread_HALF * 2 : 0);
      rates.push(beat);
      if (endBeat !== beat) rates.push(endBeat);
      carriers.push(base);
    });
    return { rates: rates, carriers: carriers,
             rateFrom: rates.length ? Math.min.apply(null, rates) : 0,
             rateTo: rates.length ? Math.max.apply(null, rates) : 0,
             baseFrom: carriers.length ? Math.min.apply(null, carriers) : 0,
             baseTo: carriers.length ? Math.max.apply(null, carriers) : 0 };
  }

  function liveVoices() {
    /* the engine holds the CALIBRATED voices (each entry carries basefreq_start,
     * beatfreq_start_HALF and the spreads); state.schedule holds the spec. The
     * readouts want the calibrated ones, because that is what is playing. */
    return (S.engine && S.engine.voices) ? S.engine.voices : ((S.schedule && S.schedule.voices) || []);
  }

  function refreshHearing() {
    var info = $("hearinfo"), chips = $("hearvoices");
    chips.innerHTML = "";
    var voices = liveVoices();
    if (!voices.length) { info.textContent = "No session loaded."; return; }
    var dur = S.engine ? S.engine.duration() : 0;
    var iso = 0, pairs = 0, beds = 0;
    var lines = [];
    voices.forEach(function (v, i) {
      var s = voiceSummary(v);
      var label = TYPE_LABEL[v.type] || ("type " + v.type);
      if (v.type === GE.VOICE_ISOPULSE || v.type === GE.VOICE_ISOPULSE_ALT) iso++;
      else if (v.type === GE.VOICE_BINAURAL) pairs++;
      else beds++;
      var chip = el("span", "vchip " + (v.type === 0 ? "pair" : (v.type === 3 ? "iso" : "")));
      chip.innerHTML = "<b>#%d</b> %s".replace("%d", i + 1).replace("%s", label) +
        (v.mute ? " (muted)" : "");
      chips.appendChild(chip);
      var band = R.bandOf(s.rateFrom > 0 ? s.rateFrom : s.rateTo);
      if (v.type === GE.VOICE_BINAURAL && s.rateTo === 0) lines.push("A steady tone at " + s.baseFrom.toFixed(1) + " Hz.");
      else if (v.type === GE.VOICE_BINAURAL) {
        lines.push(label + " at " + s.rateFrom.toFixed(2) + (s.rateTo !== s.rateFrom ? " to " + s.rateTo.toFixed(2) : "") +
          " Hz around " + s.baseFrom.toFixed(0) + " Hz" + (band ? " (" + band.label + "-range)" : "") +
          ". Headphones required — on speakers the two tones are both heard by both ears and the beat is gone.");
      } else if (v.type === GE.VOICE_ISOPULSE || v.type === GE.VOICE_ISOPULSE_ALT) {
        lines.push(label + " at " + s.rateFrom.toFixed(2) + (s.rateTo !== s.rateFrom ? " to " + s.rateTo.toFixed(2) : "") +
          " Hz on a " + s.baseFrom.toFixed(0) + " Hz carrier" + (band ? " (" + band.label + "-range)" : "") +
          ". Speaker-safe: the pulse is in the signal itself.");
      } else {
        lines.push(label + " bed" + (v.mute ? " (muted)" : "") + ".");
      }
    });
    lines.push("Runs for " + API.fmtTime(dur) + (S.schedule.loops === Infinity ? ", looping." : "."));
    var plain = [];
    if (pairs && !iso && !beds) plain.push("Headphone session.");
    if (iso && !pairs) plain.push("Speaker-friendly session.");
    if (pairs && iso) plain.push("Mixed: the pairs need headphones, the pulses do not.");
    info.innerHTML = lines.map(function (l) { return "<div>" + l.replace(/</g, "&lt;") + "</div>"; }).join("") +
      (plain.length ? "<div style='margin-top:6px;color:var(--acc2)'>" + plain.join(" ") + "</div>" : "");
    renderBand();
  }

  function renderBand() {
    var voices = liveVoices();
    var rates = [];
    voices.forEach(function (v) {
      if (v.type !== GE.VOICE_BINAURAL && v.type !== GE.VOICE_ISOPULSE && v.type !== GE.VOICE_ISOPULSE_ALT) return;
      var s = voiceSummary(v);
      if (s.rateTo > 0) rates.push(s.rateTo);
    });
    var box = $("bandinfo");
    if (!rates.length) { box.textContent = "no rate layers (beds only)"; return; }
    var hz = Math.max.apply(null, rates);
    var b = R.bandOf(hz);
    box.innerHTML = "<div><b>" + hz.toFixed(2) + " Hz</b></div><div>" +
      (b ? b.label + "-range" : "above 100 Hz") + "</div><div style='color:var(--ink-faint)'>" +
      (b ? b.note : "") + "</div>";
  }

  /* ============================================================== live meters */

  var analyser = null, specData = null, coreCtx = null;
  function ensureAnalyser() {
    if (!S.ctx || !S.master) return null;
    if (analyser && coreCtx === S.ctx) return analyser;
    try {
      coreCtx = S.ctx;
      analyser = S.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      S.master.disconnect();
      S.master.connect(analyser);
      analyser.connect(S.ctx.destination);
      specData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { analyser = null; }
    return analyser;
  }

  var specCtx = $("spec").getContext("2d");
  function drawSpectrum() {
    var c = $("spec"), W = c.width, H = c.height;
    specCtx.clearRect(0, 0, W, H);
    var an = ensureAnalyser();
    var css = getComputedStyle(document.documentElement);
    var acc = css.getPropertyValue("--acc").trim() || "#ff9e4f";
    var line = css.getPropertyValue("--line").trim() || "#333";
    specCtx.strokeStyle = line;
    specCtx.strokeRect(0.5, 0.5, W - 1, H - 1);
    if (!an) return;
    an.getByteFrequencyData(specData);
    var bars = 64, step = Math.floor(specData.length * 0.6 / bars);
    specCtx.fillStyle = acc;
    for (var i = 0; i < bars; i++) {
      var v = 0;
      for (var k = 0; k < step; k++) v = Math.max(v, specData[i * step + k]);
      var h = (v / 255) * (H - 6);
      specCtx.fillRect(i * (W / bars), H - 3 - h, Math.max(1, W / bars - 2), h);
    }
  }

  var phaseCtx = $("phase").getContext("2d");
  function drawPhase(t) {
    var c = $("phase"), W = c.width, H = c.height;
    phaseCtx.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement);
    var acc = css.getPropertyValue("--acc").trim() || "#ff9e4f";
    var info = css.getPropertyValue("--info").trim() || "#82b3d8";
    var faint = css.getPropertyValue("--ink-faint").trim() || "#777";
    var voices = liveVoices();
    /* pick the most interesting voice: the fastest binaural pair, else any pulse */
    var pick = null, pickKind = "";
    voices.forEach(function (v) {
      if (v.mute) return;
      var s = voiceSummary(v);
      if (v.type === GE.VOICE_BINAURAL && s.rateTo > 0 && (!pick || s.rateTo > voiceSummary(pick).rateTo)) { pick = v; pickKind = "pair"; }
    });
    if (!pick) voices.forEach(function (v) {
      if (pick) return;
      if (v.type === GE.VOICE_ISOPULSE && !v.mute) { pick = v; pickKind = "iso"; }
    });
    phaseCtx.strokeStyle = faint;
    phaseCtx.beginPath();
    phaseCtx.arc(W / 2, H / 2, Math.min(W, H) / 2 - 10, 0, Math.PI * 2);
    phaseCtx.stroke();
    if (!pick) {
      phaseCtx.fillStyle = faint;
      phaseCtx.font = "12px ui-monospace, monospace";
      phaseCtx.fillText("no rate layer selected", 12, H - 12);
      return;
    }
    var s = voiceSummary(pick);
    var base = s.baseFrom || 200, beat = s.rateTo || 0;
    var scale = Math.min(W, H) / 2 - 12;
    function hand(angle, color, label, len) {
      phaseCtx.strokeStyle = color;
      phaseCtx.lineWidth = 2;
      phaseCtx.beginPath();
      phaseCtx.moveTo(W / 2, H / 2);
      phaseCtx.lineTo(W / 2 + Math.cos(angle) * scale * len, H / 2 - Math.sin(angle) * scale * len);
      phaseCtx.stroke();
      phaseCtx.fillStyle = color;
      phaseCtx.font = "11px ui-monospace, monospace";
      phaseCtx.fillText(label, W / 2 + Math.cos(angle) * scale * len * 0.82 - 10,
                        H / 2 - Math.sin(angle) * scale * len * 0.82 - 4);
    }
    if (pickKind === "pair") {
      var fL = base + beat / 2, fR = base - beat / 2;
      var aL = (t * fL) % 1 * Math.PI * 2, aR = (t * fR) % 1 * Math.PI * 2;
      hand(aL, info, "L " + fL.toFixed(2) + " Hz", 1);
      hand(aR, acc, "R " + fR.toFixed(2) + " Hz", 1);
      phaseCtx.fillStyle = faint;
      phaseCtx.fillText("beat " + beat.toFixed(2) + " Hz", 12, 16);
    } else {
      /* pulse: show the on/off envelope for the selected rate */
      var cycles = Math.min(24, Math.max(4, Math.round(beat * 2)));
      phaseCtx.fillStyle = acc;
      for (var i = 0; i < cycles; i++) {
        var x = 10 + (W - 20) * (i / cycles);
        phaseCtx.fillRect(x, H / 2 - 18, (W - 20) / cycles * 0.5 - 1, 36);
      }
      phaseCtx.fillStyle = faint;
      phaseCtx.font = "11px ui-monospace, monospace";
      phaseCtx.fillText("pulse " + beat.toFixed(2) + " Hz · 50% duty", 12, H - 10);
      hand((t * beat) % 1 * Math.PI * 2, acc, "", 0.9);
    }
  }

  function updateLive() {
    var L = $("barL"), Rr = $("barR");
    var live = S.live || { peakL: 0, peakR: 0 };
    L.style.width = Math.min(100, (live.peakL || 0) * 140) + "%";
    Rr.style.width = Math.min(100, (live.peakR || 0) * 140) + "%";
    var pill = $("modePill");
    var mode = S.playing ? (S.mode === "worklet" ? "playing · worklet" : (S.mode === "fallback" ? "playing · fallback" : "playing")) : "idle";
    if (pill.textContent !== mode) pill.textContent = mode;
    pill.className = "pill" + (S.playing ? " ok" : "");
    var pi = $("packinfo");
    var imported = (S.imported || []).length;
    var txt = imported ? (imported + " imported · " + S.presetList.length + " sessions") : (S.presetList.length + " sessions");
    if (pi.textContent !== txt) pi.textContent = txt;
    var rmp = $("rmpacks");
    if (rmp && imported) { rmp.textContent = "Remove " + imported + " imported"; }
  }

  /* ================================================================== tools */

  var timer = { id: null, endsAt: 0, fade: true };
  function renderTools() {
    var box = $("toolpanes");
    box.innerHTML = "";

    /* timer pane */
    var tp = document.createElement("details");
    tp.className = "tool"; tp.id = "timerPane";
    var ts = document.createElement("summary"); ts.textContent = "Session timer";
    tp.appendChild(ts);
    var tb = el("div", "body");
    var row1 = el("div", "row");
    [5, 10, 20, 30, 60, 90].forEach(function (m) {
      var b = el("button", "chip", m + " min"); b.type = "button";
      b.onclick = function () { startTimer(m * 60); };
      row1.appendChild(b);
    });
    tb.appendChild(row1);
    var row2 = el("div", "row", "");
    var fadeLbl = el("label", "chk");
    var fadeBox = document.createElement("input"); fadeBox.type = "checkbox"; fadeBox.checked = true;
    fadeLbl.appendChild(fadeBox); fadeLbl.appendChild(el("span", null, "fade out over the last minute"));
    row2.appendChild(fadeLbl);
    tb.appendChild(row2);
    var tstat = el("div", "readout", "no timer running");
    tb.appendChild(tstat);
    var stop = el("button", "ghost", "Cancel timer");
    stop.type = "button";
    stop.onclick = function () { cancelTimer(); };
    tb.appendChild(stop);
    tp.appendChild(tb);
    box.appendChild(tp);

    /* pacer pane */
    var pp = document.createElement("details");
    pp.className = "tool"; pp.id = "pacerPane";
    var ps = document.createElement("summary"); ps.textContent = "Breathing pacer";
    pp.appendChild(ps);
    var pb = el("div", "body");
    var pr = el("div", "row");
    var rateSel = document.createElement("select");
    [["0.1", "6 / min (0.1 Hz)"], ["0.0917", "5.5 / min"], ["0.0833", "5 / min"], ["0.125", "7.5 / min"]]
      .forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; rateSel.appendChild(op); });
    var startB = el("button", "chip", "Start pacer"); startB.type = "button";
    var pstat = el("span", "readout", "");
    pr.appendChild(rateSel); pr.appendChild(startB); pr.appendChild(pstat);
    pb.appendChild(pr);
    var dial = el("div", "dial");
    var dot = document.createElement("i");
    var label = document.createElement("span", null, "in");
    dial.appendChild(dot); dial.appendChild(label);
    pb.appendChild(dial);
    pb.appendChild(el("p", "hint", "A visual pacer only: it shows the in/out pace and counts breaths. " +
      "To hear that rate as well, add the matching isochronic quick-pick (pulses on a 300 Hz carrier). " +
      "Slow paced breathing around six a minute is the rate used in the HRV literature."));
    pp.appendChild(pb);
    box.appendChild(pp);

    var running = false, rafId = null, breath = 0;
    function pacerFrame() {
      if (!running) return;
      var hz = parseFloat(rateSel.value);
      var period = 1 / hz;                      /* one full breath per cycle */
      var t = (performance.now() / 1000) % period;
      var phase = t / period;                    /* 0..1: 0-0.4 in, 0.4-1 out */
      var scale, txt;
      if (phase < 0.4) { scale = 0.5 + (phase / 0.4) * 1.5; txt = "in"; }
      else { scale = 2 - ((phase - 0.4) / 0.6) * 1.5; txt = "out"; }
      dot.style.transform = "scale(" + scale.toFixed(3) + ")";
      label.textContent = txt;
      var n = Math.floor((performance.now() / 1000) * hz);
      if (n !== breath) { breath = n; pstat.textContent = breath + " breaths"; }
      rafId = requestAnimationFrame(pacerFrame);
    }
    startB.onclick = function () {
      running = !running;
      startB.textContent = running ? "Stop pacer" : "Start pacer";
      startB.classList.toggle("on", running);
      if (running) { breath = 0; pstat.textContent = "0 breaths"; pacerFrame(); }
      else if (rafId) cancelAnimationFrame(rafId);
    };

    /* adapter pane */
    var ap = document.createElement("details");
    ap.className = "tool";
    var as = document.createElement("summary"); as.textContent = "Length of layers added by quick picks";
    ap.appendChild(as);
    var ab = el("div", "body");
    var lenRow = el("div", "row");
    [["60", "1 min"], ["300", "5 min"], ["600", "10 min"], ["1800", "30 min"], ["3600", "60 min"]]
      .forEach(function (o) {
        var b = el("button", "chip" + (quickSeconds === Number(o[0]) ? " on" : ""), o[1]);
        b.type = "button";
        b.onclick = function () { quickSeconds = Number(o[0]); store(PREF_KEY, Object.assign(prefs, { quickSeconds: quickSeconds })); renderTools(); };
        lenRow.appendChild(b);
      });
    ab.appendChild(lenRow);
    ab.appendChild(el("p", "hint", "Quick picks add this much material; adjust it in the entry editor afterwards."));
    ap.appendChild(ab);
    box.appendChild(ap);
  }

  var quickSeconds = (prefs && prefs.quickSeconds) || 600;

  function startTimer(seconds) {
    cancelTimer();
    timer.endsAt = performance.now() + seconds * 1000;
    var tick = function () {
      var left = Math.max(0, (timer.endsAt - performance.now()) / 1000);
      var st = document.querySelector("#timerPane .readout");
      if (st) st.textContent = "stopping in " + API.fmtTime(left);
      if (timer.fade && left <= 60 && S.master) S.master.gain.value = Math.max(0.0001, (S.master.gain.value || 0.7) * 0.985);
      if (left <= 0) { API.stopPlayback(false); toast("Timer finished — stopped."); cancelTimer(); }
      else timer.id = setTimeout(tick, 250);
    };
    toast("Timer set: " + minutes(seconds) + " minutes");
    tick();
  }
  function cancelTimer() {
    if (timer.id) clearTimeout(timer.id);
    timer.id = null;
    var st = document.querySelector("#timerPane .readout");
    if (st) st.textContent = "no timer running";
  }

  /* ============================================================ files/export */

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function safeName(s) { return (s || "schedule").replace(/[^\w.-]+/g, "_").slice(0, 60) || "schedule"; }

  function saveGnaural() {
    try {
      var text = API.toGnauralText();
      /* self-check before offering it: it must parse back and play */
      var back = GNM.parseGnaural(text);
      if (!back.voices.length) throw new Error("nothing to write");
      download(safeName(S.title) + ".gnaural", text, "application/xml");
      toast("Saved " + back.voices.length + " voice(s) · " + API.fmtTime(back.duration));
    } catch (e) { toast("Could not save: " + e.message); }
  }

  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    var s = str.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }
  function shareLink() {
    try {
      var text = API.toGnauralText();
      var hash = "#s=" + b64urlEncode(text);
      /* the desktop shell sets window.RS_SHARE_BASE so the link points at the live site
         (a 127.0.0.1 URL is useless to paste anywhere); undefined in a browser, so the
         site keeps building the identical URL it always did */
      var url = (window.RS_SHARE_BASE || (location.origin + location.pathname)) + hash;
      if (url.length > 12000) toast("That schedule is long — the link may be too long for some browsers.");
      history.replaceState(null, "", hash);
      var done = function () { toast("Share link copied (" + url.length + " chars)."); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link:", url); });
      } else { window.prompt("Copy this link:", url); }
    } catch (e) { toast("Could not build a link: " + e.message); }
  }
  function loadFromHash() {
    var m = /^#s=(.+)$/.exec(location.hash || "");
    if (!m) return false;
    try {
      var text = b64urlDecode(m[1]);
      var res = API.loadGnauralText(text, "shared link");
      toast("Loaded a shared schedule (" + res.voices + " voices, " + API.fmtTime(res.duration) + ")");
      return true;
    } catch (e) { toast("That share link could not be read: " + e.message); return false; }
  }

  /* ============================================================== voice adder */

  function renderVoiceAdder() {
    var dlg = document.createElement("details");
    dlg.className = "tool"; dlg.id = "addvoicePane";
    var sm = document.createElement("summary"); sm.textContent = "Build a layer by hand";
    dlg.appendChild(sm);
    var b = el("div", "body");
    var kind = document.createElement("select");
    [["iso", "Isochronic pulses (speaker-safe)"], ["binaural", "Binaural pair (headphones)"],
     ["tone", "Steady tone (mono)"], ["monaural", "Monaural beat (two tones, room air)"],
     ["pink", "Pink noise bed"], ["brown", "Brown noise bed"], ["white", "White noise bed"]]
      .forEach(function (o) { var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; kind.appendChild(op); });
    var rates = document.createElement("input"); rates.type = "number"; rates.value = "10"; rates.step = "0.01";
    rates.setAttribute("aria-label", "rate in Hz");
    var carrier = document.createElement("input"); carrier.type = "number"; carrier.value = "300"; carrier.step = "1";
    carrier.setAttribute("aria-label", "carrier in Hz");
    var dur = document.createElement("input"); dur.type = "number"; dur.value = String(quickSeconds / 60); dur.step = "1";
    dur.setAttribute("aria-label", "duration in minutes");
    var add = el("button", null, "Add layer"); add.type = "button";
    var g = el("div", "grid2");
    g.appendChild(labelled("What to add", kind));
    g.appendChild(labelled("Rate (Hz)", rates));
    g.appendChild(labelled("Carrier (Hz)", carrier));
    g.appendChild(labelled("Minutes", dur));
    g.appendChild(labelled("", add));
    b.appendChild(g);
    b.appendChild(el("p", "hint", "Pulses: the carrier switches on and off at the rate. Pairs: two tones a rate " +
      "apart, one per ear. Monaural: two steady tones, played to both ears, that beat in the room."));
    function labelled(text, node) {
      var w = document.createElement("div");
      var l = document.createElement("label"); l.className = "small"; l.textContent = text;
      w.appendChild(l); w.appendChild(node);
      return w;
    }
    add.onclick = function () {
      var hz = parseFloat(rates.value) || 10, base = parseFloat(carrier.value) || 300;
      var secs = Math.max(5, (parseFloat(dur.value) || 10) * 60);
      var k = kind.value;
      if (k === "iso") addIso(hz, base, { seconds: secs });
      else if (k === "binaural") addPair(hz, base, { seconds: secs });
      else if (k === "tone") addTone(base, { seconds: secs });
      else if (k === "monaural") addMonaural(hz, base, { seconds: secs });
      else addBed(k, { seconds: secs });
      refreshHearing();
    };
    dlg.appendChild(b);
    $("voicelist").parentNode.insertBefore(dlg, $("voicelist"));
  }

  /* ================================================================ skins etc. */

  function applySkin(id) {
    document.documentElement.setAttribute("data-skin", id || "forge");
    store(PREF_KEY, Object.assign(prefs, { skin: id }));
    var sel = $("skin");
    if (sel && sel.value !== id) sel.value = id;
  }
  function toggleFocus() {
    document.body.classList.toggle("focus");
    var on = document.body.classList.contains("focus");
    $("focusBtn").classList.toggle("on", on);
    try {
      if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      else if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    } catch (e) { /* fullscreen may be refused — the CSS focus mode still applies */ }
    toast(on ? "Focus mode — F to return" : "Panels back");
  }

  /* ==================================================================== boot */

  function boot() {
    API = window.__gnauralAPI;
    if (!API) { console.warn("studio.js: core API missing — the core script did not boot"); return; }
    S = API.state;
    /* skin first (so nothing flashes) */
    var skin = (prefs && prefs.skin) || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "paper" : "forge");
    applySkin(skin);
    $("skin").onchange = function () { applySkin(this.value); };
    $("focusBtn").onclick = toggleFocus;

    renderBrowser();
    $("search").oninput = function () { query = this.value; renderBrowser(); };
    $("randomBtn").onclick = function () {
      var items = visibleItems();
      if (!items.length) return;
      var pick = items[Math.floor(Math.random() * items.length)];
      API.loadPreset(pick.i); $("presets").value = String(pick.i); renderBrowser();
      toast("Rolled: " + pick.it.name);
    };

    renderQuickPicks();
    renderVoiceAdder();
    renderTools();
    refreshHearing();

    $("addvoiceBtn").onclick = function () {
      var panes = $("addvoicePane");
      if (panes) { panes.open = true; panes.scrollIntoView({ block: "nearest" }); }
    };
    $("delvoiceBtn").onclick = function () {
      if (API.removeVoice(S.selected)) { refreshHearing(); toast("Voice removed."); }
      else toast("A session needs at least one voice.");
    };
    $("timerBtn").onclick = function () {
      var p = $("timerPane"); if (p) { p.open = true; p.scrollIntoView({ block: "nearest" }); }
    };
    $("pacerBtn").onclick = function () {
      var p = $("pacerPane"); if (p) { p.open = true; p.scrollIntoView({ block: "nearest" }); }
    };
    $("panicBtn").onclick = function () {
      API.stopPlayback(false);
      API.setMaster(0);
      toast("Stopped and muted. Raise Vol to listen again.");
    };
    $("saveGnm").onclick = saveGnaural;
    $("shareBtn").onclick = shareLink;
    $("presets").addEventListener("change", function () { setTimeout(renderBrowser, 0); });

    document.addEventListener("keydown", function (ev) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      if (ev.key === "Escape") { API.stopPlayback(false); }
      else if (ev.key === "[") { API.setMaster(Math.max(0, parseFloat($("master").value) - 0.05)); }
      else if (ev.key === "]") { API.setMaster(Math.min(1, parseFloat($("master").value) + 0.05)); }
      else if (ev.key === "f" || ev.key === "F") { toggleFocus(); }
      else if (ev.key === "s" || ev.key === "S") { saveGnaural(); }
      else if (ev.key === "?" ) { document.querySelector(".col.right .card:last-child").scrollIntoView({ behavior: "smooth" }); }
      else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        var n = API.presetCount(), step = ev.shiftKey ? 10 : 1;
        var cur = parseInt($("presets").value || "0", 10);
        var next = ev.key === "ArrowRight" ? (cur + step) % n : (cur - step + n) % n;
        API.loadPreset(next); $("presets").value = String(next); renderBrowser();
      }
    });

    loadFromHash();


    /* ---- Marantz face (styled in studio.css): glue the knob's visuals to
     * #master. The range input stays the single source of truth — pointer
     * drag, arrow keys, focus and app.js's own gain wiring are untouched;
     * this only repaints the champagne dome and adds wheel nudging. */
    (function marantzFace() {
      var wrap = $("volknob"), m = $("master");
      if (!wrap || !m) return;
      var knob = wrap.querySelector(".pf-knob");
      var val = wrap.querySelector(".mk-val");
      function sync() {
        var v = Math.max(0, Math.min(1, parseFloat(m.value)));
        if (!isFinite(v)) v = 0;
        knob.style.setProperty("--mk-ang", (-135 + 270 * v).toFixed(1) + "deg");
        knob.style.setProperty("--knob-arc", (270 * v).toFixed(1) + "deg");
        if (val) val.textContent = String(Math.round(v * 100));
      }
      m.addEventListener("input", sync);
      wrap.addEventListener("wheel", function (ev) {
        var step = ev.shiftKey ? 0.01 : 0.03;
        var v = Math.max(0, Math.min(1, parseFloat(m.value) + (ev.deltaY < 0 ? step : -step)));
        m.value = String(Math.round(v * 100) / 100);
        m.dispatchEvent(new Event("input", { bubbles: true }));
        ev.preventDefault();
      }, { passive: false });
      sync();
    })();

    /* heartbeat: meters, spectrum, phase wheel, plus re-sync of chrome that the
     * core can change behind us (a loaded file, an imported pack, a new skin) */
    var lastTitle = null;
    function frame() {
      var t = performance.now() / 1000;
      updateLive();
      drawSpectrum();
      drawPhase(t);
      if (S.title !== lastTitle) {
        lastTitle = S.title;
        refreshHearing();
        renderBrowser();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
