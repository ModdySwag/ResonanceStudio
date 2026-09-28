/* Gnaural Web — UI + audio host.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 */
(function () {
  "use strict";

  var E = globalThis.GnauralEngine;
  var GNM = globalThis.GnauralGNM;
  var P = globalThis.GnauralPresets;
  var K = globalThis.GnauralPacks || { LIBRARY: [], PACKS: [] };   /* packs.js must load first */
  var $ = function (id) { return document.getElementById(id); };
  var COLORS = ["#e0b96f", "#82b3d8", "#45d6ff", "#93c793", "#e0604f", "#d9a066", "#b48ead", "#7fd0c0"];

  var state = {
    schedule: null,          // {voices:[engine voices], loops, volumeL, volumeR}
    title: "", source: "", fileBase: "gnaural",
    engine: null,            // main-thread engine for Graph + export
    ctx: null, node: null, master: null, mode: "", fallback: null,
    playing: false,
    live: { sample: 0, total: 0, completed: false, peakL: 0, peakR: 0, voices: [] },
    selected: 0,
    curves: null,            // cached draw data
    exportMinutes: 20,
    presetList: [],          // everything the dropdown offers (library + imported)
    imported: null           // packs remembered from .zip imports
  };

  /* ---------------------------------------------------------------- utils */
  function fmtTime(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }
  function msgs(list) {
    var el = $("warnings");
    el.innerHTML = "";
    (list || []).forEach(function (w) { var d = document.createElement("div"); d.textContent = "· " + w; el.appendChild(d); });
    el.style.display = (list && list.length) ? "block" : "none";
  }
  function toast(text) {
    var t = $("toast"); t.textContent = text; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ------------------------------------------------------------- schedule */
  function loadSchedule(voices, meta) {
    state.schedule = { voices: voices, loops: meta.loops === undefined ? Infinity : meta.loops,
                       volumeL: meta.volumeL === undefined ? 1 : meta.volumeL,
                       volumeR: meta.volumeR === undefined ? 1 : meta.volumeR };
    state.title = meta.title || "";
    state.source = meta.source || "";
    state.fileBase = (meta.title || "gnaural").replace(/[^\w.-]+/g, "_").slice(0, 60) || "gnaural";
    state.selected = 0;
    if (state.playing) stopPlayback(true);
    rebuildEngine();
    syncToWorklet();
    msgs(meta.warnings || []);
    $("nowtitle").textContent = state.title || "(untitled)";
    $("nowsrc").textContent = state.source;
    $("loop").checked = state.schedule.loops === Infinity;
    updateMeta();
  }

  function updateMeta() {
    var v = state.engine ? state.engine.voices : [];
    var nEntries = v.reduce(function (a, x) { return a + x.entryCount; }, 0);
    var lo = state.schedule.loops === Infinity ? "loop ∞" : ("play ×" + state.schedule.loops);
    $("meta").textContent = v.length + " voice" + (v.length === 1 ? "" : "s") + " · " + nEntries +
      " entries · " + fmtTime(state.engine ? state.engine.duration() : 0) + " · " + lo;
  }

  function rebuildEngine() {
    state.engine = new E.Engine();
    state.engine.setSchedule(state.schedule.voices.map(cloneVoice));
    state.engine.loops = state.schedule.loops;
    state.engine.reset();
    state.curves = buildCurves();
    renderVoiceList();
    renderEntryEditor();
    drawGraph();
  }

  function cloneVoice(v) {
    return { type: v.type, mute: !!v.mute, mono: !!v.mono,
             entries: v.entries.map(function (e) {
               return { duration: e.duration, volL: e.volL, volR: e.volR, basefreq: e.basefreq, beat: e.beat };
             }) };
  }

  /* ----------------------------------------------------------------- audio */
  function fetchText(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ": " + r.status); return r.text(); });
  }

  function ensureAudio() {
    if (state.ctx) return Promise.resolve();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx({ sampleRate: 44100 });
    state.ctx = ctx;
    state.master = ctx.createGain();
    state.master.gain.value = parseFloat($("master").value);
    state.master.connect(ctx.destination);
    if (ctx.audioWorklet) {
      return Promise.all([fetchText("engine.js"), fetchText("worklet-processor.js")]).then(function (src) {
        var blob = new Blob([src[0], "\n", src[1]], { type: "text/javascript" });
        var url = URL.createObjectURL(blob);
        return ctx.audioWorklet.addModule(url).then(function () {
          var node = new AudioWorkletNode(ctx, "gnaural-processor", {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
          });
          node.port.onmessage = function (ev) { onWorkletMessage(ev.data); };
          node.connect(state.master);
          state.node = node;
          state.mode = "worklet";
          syncToWorklet();   /* hand the current schedule to the fresh worklet */
        });
      }).catch(function (err) {
        console.warn("AudioWorklet unavailable, using ScriptProcessor:", err);
        bootFallback(ctx);
      });
    }
    bootFallback(ctx);
    return Promise.resolve();
  }

  function bootFallback(ctx) {
    if (state.node) return;
    var sp = ctx.createScriptProcessor(4096, 0, 2);
    state.fallback = new E.Engine();
    state.fallback.setSchedule(state.schedule.voices.map(cloneVoice));
    state.fallback.loops = state.schedule.loops;
    state.fallback.reset();
    state.fallback.paused = true;
    var bufL = new Float32Array(4096), bufR = new Float32Array(4096);
    sp.onaudioprocess = function (ev) {
      var out = ev.outputBuffer;
      var L = out.getChannelData(0), R = out.getChannelData(1);
      state.fallback.render(bufL, bufR, bufL.length);
      for (var i = 0; i < L.length; i++) { L[i] = bufL[i]; R[i] = bufR[i]; }
    };
    sp.connect(state.master);
    state.node = sp;
    state.mode = "spn";
  }

  function syncToWorklet() {
    var s = state.schedule;
    if (state.mode === "worklet" && state.node) {
      state.node.port.postMessage({ t: "schedule", voices: s.voices, loops: s.loops });
      state.node.port.postMessage({ t: "loop", loops: s.loops });
    } else if (state.mode === "spn" && state.fallback) {
      state.fallback.setSchedule(s.voices.map(cloneVoice));
      state.fallback.loops = s.loops;
      state.fallback.reset();
    }
  }

  function onWorkletMessage(m) {
    if (m.t !== "pos") return;
    state.live = m;
    if (m.completed) { stopPlayback(false); toast("Schedule complete"); }
  }

  function play() {
    ensureAudio().then(function () {
      if (state.ctx.state === "suspended") state.ctx.resume();
      if (state.mode === "worklet") { state.node.port.postMessage({ t: "play" }); }
      else if (state.fallback) { state.fallback.paused = false; }
      state.playing = true;
      $("play").textContent = "❚❚ Pause";
      $("play").classList.add("on");
    });
  }
  function pause() {
    if (state.mode === "worklet" && state.node) state.node.port.postMessage({ t: "pause" });
    if (state.fallback) state.fallback.paused = true;
    state.playing = false;
    $("play").textContent = "▶ Play";
    $("play").classList.remove("on");
  }
  function stopPlayback(quiet) {
    pause();
    syncToWorklet(); // resets position to 0
    state.live = { sample: 0, total: 0, completed: false, peakL: 0, peakR: 0, voices: [] };
    if (!quiet) drawGraph();
  }
  function togglePlay() { state.playing ? pause() : play(); }

  /* ------------------------------------------------------------- graph */
  function buildCurves() {
    var out = [], maxBase = 200, maxBeat = 20;
    var eng = state.engine;
    if (!eng) return { voices: [], maxBase: 500, maxBeat: 50, total: 1 };
    for (var i = 0; i < eng.voices.length; i++) {
      var v = eng.voices[i];
      var step = Math.max(1, Math.ceil(v.entryCount / 1500));
      var base = [], beat = [], vol = [];
      for (var j = 0; j < v.entryCount; j += step) {
        var e = v.entries[j];
        var x0 = e.absStart / E.SAMPLE_RATE, x1 = e.absEnd / E.SAMPLE_RATE;
        var b0 = e.basefreq_start, b1 = e.basefreq_start + e.basefreq_spread;
        var t0 = e.beatfreq_start_HALF * 2, t1 = (e.beatfreq_start_HALF + e.beatfreq_spread_HALF) * 2;
        var w0 = e.volL_start, w1 = e.volL_start + e.volL_spread;
        if (b0 > maxBase) maxBase = b0;
        if (b1 > maxBase) maxBase = b1;
        if (t0 > maxBeat) maxBeat = t0;
        if (t1 > maxBeat) maxBeat = t1;
        base.push(x0, b0, x1, b1);
        beat.push(x0, t0, x1, t1);
        vol.push(x0, w0, x1, w1);
      }
      out.push({ base: base, beat: beat, vol: vol, type: v.type, mute: v.mute, n: v.entryCount });
    }
    return { voices: out, maxBase: Math.ceil(maxBase * 1.15), maxBeat: Math.ceil(maxBeat * 1.25), total: Math.max(1, eng.duration()) };
  }

  function polyline(ctx, pts, W, H, total, vmax, color, dim, xOff, yOff) {
    xOff = xOff || 0; yOff = yOff || 0;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < pts.length; i += 4) {
      var x0 = xOff + pts[i] / total * W, y0 = yOff + H - (pts[i + 1] / vmax) * H;
      var x1 = xOff + pts[i + 2] / total * W, y1 = yOff + H - (pts[i + 3] / vmax) * H;
      if (!started) { ctx.moveTo(x0, y0); started = true; }
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.strokeStyle = dim ? color + "44" : color;
    ctx.lineWidth = dim ? 1 : 1.6;
    ctx.stroke();
  }

  function drawGraph() {
    var cv = $("graph");
    var dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.floor(W * dpr) || cv.height !== Math.floor(H * dpr)) {
      cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    }
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var c = state.curves || { voices: [], maxBase: 500, maxBeat: 50, total: 1 };
    var padL = 46, padT = 8, gap = 14;
    var bandH = Math.floor((H - padT * 2 - gap * 2) / 3);
    var bands = [
      { y: padT, h: bandH, vmax: c.maxBase, label: "carrier Hz" },
      { y: padT + bandH + gap, h: bandH, vmax: c.maxBeat, label: "beat Hz" },
      { y: padT + (bandH + gap) * 2, h: bandH, vmax: 1, label: "volume" }
    ];
    var plotW = W - padL - 8;
    g.font = "10px ui-monospace, Consolas, monospace";
    bands.forEach(function (b) {
      g.fillStyle = "#131109"; g.fillRect(padL, b.y, plotW, b.h);
      g.strokeStyle = "#2a261d"; g.lineWidth = 1;
      g.strokeRect(padL + 0.5, b.y + 0.5, plotW - 1, b.h - 1);
      g.fillStyle = "#a99f89";
      g.fillText(b.label, 4, b.y + 11);
      g.fillText(String(b.vmax), 4, b.y + b.h - 2);
      /* time gridlines */
      var stepT = niceStep(c.total);
      g.strokeStyle = "#211e17";
      for (var t = 0; t <= c.total; t += stepT) {
        var x = padL + (t / c.total) * plotW;
        g.beginPath(); g.moveTo(x, b.y); g.lineTo(x, b.y + b.h); g.stroke();
        if (b === bands[2]) { g.fillStyle = "#a99f89"; g.fillText(fmtTime(t), x + 2, b.y + b.h - 3); }
      }
    });
    for (var i = 0; i < c.voices.length; i++) {
      var v = c.voices[i];
      var col = COLORS[i % COLORS.length];
      var dim = (i !== state.selected) || v.mute;
      [["base", 0], ["beat", 1], ["vol", 2]].forEach(function (pair) {
        var b = bands[pair[1]];
        polyline(g, v[pair[0]], plotW, b.h, c.total, b.vmax, col, dim, padL, b.y);
      });
    }
    /* playhead */
    var pos = state.pos = (state.live.sample || 0) / E.SAMPLE_RATE;
    var x = padL + (pos / c.total) * plotW;
    g.strokeStyle = "#e0b96f"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padT); g.stroke();
  }

  function niceStep(total) {
    var raw = total / 8;
    var steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
    return 3600;
  }

  /* --------------------------------------------------------------- panels */
  function renderVoiceList() {
    var box = $("voicelist");
    box.innerHTML = "";
    if (!state.engine) return;
    state.engine.voices.forEach(function (v, i) {
      var row = document.createElement("div");
      row.className = "vrow" + (i === state.selected ? " sel" : "");
      var chip = document.createElement("span");
      chip.className = "chip"; chip.style.background = COLORS[i % COLORS.length];
      var name = document.createElement("span");
      name.className = "vname";
      name.textContent = "#" + i + " " + (GNM.TYPE_NAMES[v.type] || ("type " + v.type)) + (v.entryCount ? "" : " (empty)");
      var mute = document.createElement("button");
      mute.className = "mini" + (v.mute ? " on" : "");
      mute.textContent = v.mute ? "muted" : "mute";
      mute.onclick = function (ev) {
        ev.stopPropagation();
        v.mute = !v.mute;
        state.schedule.voices[i].mute = v.mute;
        rebuildEngine(); syncToWorklet();
      };
      row.appendChild(chip); row.appendChild(name); row.appendChild(mute);
      row.onclick = function () { state.selected = i; renderVoiceList(); renderEntryEditor(); drawGraph(); };
      box.appendChild(row);
    });
  }

  function renderEntryEditor() {
    var box = $("entryedit");
    box.innerHTML = "";
    if (!state.engine || !state.engine.voices[state.selected]) return;
    var v = state.engine.voices[state.selected];
    var cap = Math.min(v.entryCount, 400);
    var head = document.createElement("div");
    head.className = "ehead";
    head.innerHTML = "<span>#</span><span>dur s</span><span>base Hz</span><span>beat Hz</span><span>vol L</span><span>vol R</span><span></span>";
    box.appendChild(head);
    var frag = document.createDocumentFragment();
    for (var j = 0; j < cap; j++) frag.appendChild(buildEntryRow(j, v));
    box.appendChild(frag);
    if (v.entryCount > cap) {
      var note = document.createElement("div");
      note.className = "enote";
      note.textContent = "+ " + (v.entryCount - cap) + " more entries (not shown; editing capped at " + cap + ")";
      box.appendChild(note);
    }
    var tools = document.createElement("div");
    tools.className = "etools";
    var add = document.createElement("button");
    add.className = "mini"; add.textContent = "+ entry";
    add.onclick = function () {
      var src = state.schedule.voices[state.selected].entries;
      var last = src[src.length - 1];
      src.push({ duration: last ? last.duration : 10, volL: last ? last.volL : 0.3, volR: last ? last.volR : 0.3,
                 basefreq: last ? last.basefreq : 200, beat: last ? last.beat : 10 });
      rebuildEngine(); syncToWorklet();
    };
    tools.appendChild(add);
    box.appendChild(tools);
  }

  function round6(x) { return Math.round(x * 1e6) / 1e6; }
  function cell(text, cls) { var s = document.createElement("span"); s.className = cls; s.textContent = text; return s; }

  function buildEntryRow(rowIndex, v) {
    var e = v.entries[rowIndex];
    var row = document.createElement("div");
    row.className = "erow";
    row.appendChild(cell(String(rowIndex), "idx"));
    [["duration", e.duration], ["basefreq", e.basefreq_start], ["beat", e.beatfreq_start_HALF * 2],
     ["volL", e.volL_start], ["volR", e.volR_start]].forEach(function (field) {
      var wrap = document.createElement("span");
      var inp = document.createElement("input");
      inp.type = "number"; inp.step = "any"; inp.value = round6(field[1]);
      inp.onchange = function () { applyEntryEdit(state.selected, rowIndex, field[0], parseFloat(inp.value)); };
      wrap.appendChild(inp);
      row.appendChild(wrap);
    });
    var del = document.createElement("button");
    del.className = "mini"; del.textContent = "×";
    del.title = "delete entry";
    del.onclick = function () { deleteEntry(state.selected, rowIndex); };
    row.appendChild(del);
    return row;
  }

  function applyEntryEdit(vi, ei, field, value) {
    if (!isFinite(value)) return;
    var e = state.schedule.voices[vi].entries[ei];
    if (field === "duration") e.duration = Math.max(0, value);
    else if (field === "basefreq") e.basefreq = value;
    else if (field === "beat") e.beat = Math.max(0, value);
    else if (field === "volL") e.volL = Math.min(1, Math.max(0, value));
    else if (field === "volR") e.volR = Math.min(1, Math.max(0, value));
    rebuildEngine(); syncToWorklet();
  }
  function deleteEntry(vi, ei) {
    state.schedule.voices[vi].entries.splice(ei, 1);
    if (!state.schedule.voices[vi].entries.length) state.schedule.voices[vi].entries.push({ duration: 60, volL: 0.3, volR: 0.3, basefreq: 200, beat: 10 });
    rebuildEngine(); syncToWorklet();
  }

  /* -------------------------------------------------------------- presets */
  /* The list the dropdown shows: the pack library first (grouped by pack),
   * then anything the user imported from a .zip pack this browser remembers.
   * Option values are indices into state.presetList, so the numeric selection
   * behaviour is unchanged from when this was a flat array. */
  function rebuildOptions() {
    var sel = $("presets");
    var keep = sel.value;
    sel.innerHTML = "";
    var group = null, groupName = null;
    state.presetList.forEach(function (item, i) {
      if (item.packName !== groupName) {
        groupName = item.packName;
        group = document.createElement("optgroup");
        group.label = groupName;
        sel.appendChild(group);
      }
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = item.name;
      group.appendChild(o);
    });
    if (keep !== "" && sel.options.length > Number(keep)) sel.value = keep;
    $("rmpacks").style.display = state.imported.length ? "" : "none";
    $("rmpacks").textContent = "Remove " + state.imported.length + " imported";
  }
  function fillPresets() {
    /* packs.js normally supplies the whole library; if it did not load (a stale
     * cached page, say) fall back to the classic presets rather than coming up empty */
    var library = K.LIBRARY.length ? K.LIBRARY : P.PRESETS.map(function (p) {
      return { pack: "classic", packName: "Classic sessions", name: p.name, blurb: p.blurb, voices: p.voices };
    });
    state.presetList = library.map(function (it) {
      return { packName: it.packName, name: it.name, blurb: it.blurb, preset: it };
    });
    loadImported();                       /* remembered packs -> state.imported */
    state.imported.forEach(function (it) {
      state.presetList.push({ packName: it.packName, name: it.name, blurb: it.blurb,
                              sched: it.sched, imported: true });
    });
    rebuildOptions();
    $("presets").onchange = function () { loadPreset(parseInt($("presets").value, 10)); };
    loadPreset(0);
  }
  function loadPreset(i) {
    var item = state.presetList[i];
    if (!item) return;
    if (item.sched) {
      loadSchedule(item.sched.voices, { title: item.name, source: item.blurb,
        loops: item.sched.loops === undefined ? Infinity : item.sched.loops,
        volumeL: item.sched.volumeL, volumeR: item.sched.volumeR, warnings: [] });
    } else {
      loadSchedule(P.presetToSchedule(item.preset), { title: item.name, source: item.blurb, loops: Infinity, warnings: [] });
    }
    $("presets").value = String(i);
  }

  /* ------------------------------------------------ imported preset packs */
  var PACK_KEY = "gnaural.packs.v1";

  function loadImported() {
    if (state.imported) return;
    state.imported = [];
    var raw = null;
    try { raw = localStorage.getItem(PACK_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      JSON.parse(raw).forEach(function (rec) {
        try {
          var parsed = GNM.parseGnaural(rec.text);
          var sched = GNM.toEngineSchedule(parsed);
          if (!sched.voices.length) return;
          state.imported.push({ packName: rec.packName, name: rec.name, text: rec.text,
                                blurb: "imported pack · " + (parsed.author || "unknown author"),
                                sched: sched });
        } catch (e) { /* a corrupt entry just drops out */ }
      });
    } catch (e) { /* ignore unreadable storage */ }
  }

  function saveImported() {
    try {
      localStorage.setItem(PACK_KEY, JSON.stringify(state.imported.map(function (it) {
        return { packName: it.packName, name: it.name, text: it.text };
      })));
    } catch (e) {
      toast("Pack too large to remember in this browser — it will work until you reload");
    }
  }

  function clearImported() {
    state.imported = [];
    try { localStorage.removeItem(PACK_KEY); } catch (e) { /* noop */ }
    state.presetList = state.presetList.filter(function (it) { return !it.imported; });
    rebuildOptions();
    loadPreset(0);
    toast("Imported packs removed");
  }

  async function loadPackZip(file) {
    var buf = await file.arrayBuffer();
    var entries = await GnauralPack.parseZip(buf);
    var packName = file.name.replace(/\.zip$/i, "");
    var added = 0, skipped = 0;
    entries.forEach(function (e) {
      if (!/\.gnaural(\.xml)?$/i.test(e.name)) return;      /* README.txt etc. skipped */
      var text = new TextDecoder().decode(e.bytes);
      try {
        var parsed = GNM.parseGnaural(text);
        var sched = GNM.toEngineSchedule(parsed);
        if (!sched.voices.length) throw new Error("no playable voices");
        state.imported.push({
          packName: packName, name: parsed.title || e.name.replace(/^.*\//, "").replace(/\.gnaural$/i, ""),
          text: text, blurb: "imported pack · " + (parsed.author || "unknown author"), sched: sched
        });
        added++;
      } catch (err) { skipped++; }
    });
    if (added) {
      saveImported();
      var base = state.presetList.filter(function (it) { return !it.imported; }).length;
      state.imported.forEach(function (it, idx) {
        if (!state.presetList.some(function (x) { return x.imported && x.name === it.name && x.text === it.text; })) {
          state.presetList.push({ packName: it.packName, name: it.name, blurb: it.blurb,
                                  sched: it.sched, imported: true });
        }
      });
      rebuildOptions();
      loadPreset(base);                                    /* show the first imported one */
    }
    toast("Pack \"" + packName + "\": " + added + " preset" + (added === 1 ? "" : "s") + " added" +
          (skipped ? ", " + skipped + " skipped" : ""));
    return { added: added, skipped: skipped };
  }

  /* ------------------------------------------- pack downloads (page footer) */
  /* Counts are computed from the library, never written by hand, so the page
   * can never advertise a pack size that does not match what shipped. */
  function buildPackDownloads() {
    var list = $("pklist");
    if (!list) return;
    var packs = [{ id: "classic", name: "Classic sessions" }]
      .concat(K.PACKS.map(function (p) { return { id: p.id, name: p.name }; }));
    var totalSessions = 0, totalMinutes = 0;
    packs.forEach(function (pk) {
      var items = K.LIBRARY.filter(function (x) { return x.pack === pk.id; });
      if (!items.length) return;
      var mins = items.reduce(function (a, x) {
        var m = / (\d+) minutes\.\s*$/.exec(x.blurb);
        return a + (m ? Number(m[1]) : 0);
      }, 0);
      totalSessions += items.length;
      totalMinutes += mins;
      var row = document.createElement("div");
      row.innerHTML = '<a href="pack/' + pk.id + '.zip" download>' + pk.name + "</a> " +
        '<span class="pk-n">— ' + items.length + " session" + (items.length === 1 ? "" : "s") +
        " · " + (mins / 60).toFixed(1) + " hours</span>";
      list.appendChild(row);
    });
    var all = document.createElement("div");
    all.innerHTML = '<a href="pack/gnaural-web-complete.zip" download>Everything</a> ' +
      '<span class="pk-n">— ' + totalSessions + " sessions · " + (totalMinutes / 60).toFixed(1) +
      " hours, all of the above in one archive</span>";
    list.appendChild(all);
  }

  /* ------------------------------------------------------------ file load */
  function loadFile(file) {
    if (/\.zip$/i.test(file.name)) { loadPackZip(file)["catch"](function (e) { toast("Could not read pack: " + e.message); }); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = GNM.parseGnaural(String(reader.result));
        var sched = GNM.toEngineSchedule(parsed);
        if (!sched.voices.length) throw new Error("no playable voices in this file");
        loadSchedule(sched.voices, {
          title: parsed.title || file.name.replace(/\.gnaural$/i, ""),
          source: "file: " + file.name + " · " + parsed.author,
          loops: sched.loops, volumeL: parsed.overallVolL, volumeR: parsed.overallVolR,
          warnings: parsed.warnings
        });
        toast("Loaded " + file.name);
      } catch (err) {
        toast("Could not read file: " + err.message);
        msgs(["Could not read " + file.name + ": " + err.message]);
      }
    };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------- WAV export */
  function encodeWav(chunks, sampleRate) {
    var len = 0; chunks.forEach(function (c) { len += c.length; });
    var buf = new ArrayBuffer(44 + len * 2);
    var dv = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF"); dv.setUint32(4, 36 + len * 2, true); str(8, "WAVE");
    str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 4, true);
    dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    str(36, "data"); dv.setUint32(40, len * 2, true);
    var off = 44;
    for (var ci = 0; ci < chunks.length; ci++) {
      var c = chunks[ci];
      for (var i = 0; i < c.length; i++) { dv.setInt16(off, c[i], true); off += 2; }
    }
    return buf;
  }

  function exportWav() {
    if (!state.engine) return;
    var total = state.engine.duration();
    var minutes = state.schedule.loops === Infinity ? Math.min(state.exportMinutes, Math.ceil(total / 60)) : Math.ceil(total / 60);
    minutes = Math.max(1, minutes);
    var frames = Math.min(Math.round(total * E.SAMPLE_RATE), minutes * 60 * E.SAMPLE_RATE);
    var eng = new E.Engine();
    eng.setSchedule(state.schedule.voices.map(cloneVoice));
    eng.loops = 1;
    eng.reset();
    eng.paused = false;
    var chunks = [], done = 0, chunkSamples = E.SAMPLE_RATE * 10;
    var L = new Float32Array(44100), R = new Float32Array(44100);
    $("prog").hidden = false;
    function step() {
      var t0 = performance.now();
      while (done < frames && performance.now() - t0 < 120) {
        var n = Math.min(44100, frames - done);
        eng.render(L, R, n);
        var c = new Int16Array(n * 2);
        for (var i = 0; i < n; i++) { c[i * 2] = clamp16(L[i] * 32767); c[i * 2 + 1] = clamp16(R[i] * 32767); }
        chunks.push(c);
        done += n;
      }
      $("prog").value = done / frames;
      if (done < frames) { setTimeout(step, 0); return; }
      var blob = new Blob([encodeWav(chunks, E.SAMPLE_RATE)], { type: "audio/wav" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = state.fileBase + (frames < Math.round(total * E.SAMPLE_RATE) ? "-" + minutes + "min" : "") + ".wav";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      $("prog").hidden = true;
      toast("Exported " + fmtTime(frames / E.SAMPLE_RATE) + " of audio as WAV");
    }
    step();
  }
  function clamp16(x) { return x > 32767 ? 32767 : x < -32768 ? -32768 : x | 0; }

  /* ------------------------------------------------------------------ loop */
  var lastFrame = 0;
  function raf(ts) {
    requestAnimationFrame(raf);
    if (ts - lastFrame < 66) return;  // ~15 fps for panel updates
    lastFrame = ts;
    if (state.mode === "spn" && state.fallback) {
      var f = state.fallback;
      state.live = { sample: f.currentSample, total: Math.floor(f.totalDuration * E.SAMPLE_RATE),
                     completed: f.completed, peakL: f.peakL, peakR: f.peakR, voices: [] };
      if (f.completed && state.playing) stopPlayback(false);
    }
    var pos = (state.live.sample || 0) / E.SAMPLE_RATE;
    var total = (state.live.total || 0) / E.SAMPLE_RATE || (state.engine ? state.engine.duration() : 0);
    $("clock").textContent = fmtTime(pos) + " / " + fmtTime(total);
    $("meterL").style.width = Math.min(100, (state.live.peakL || 0) * 100) + "%";
    $("meterR").style.width = Math.min(100, (state.live.peakR || 0) * 100) + "%";
    var vv = state.live.voices || [];
    var rows = document.querySelectorAll("#voicelist .vrow");
    rows.forEach(function (row, i) {
      var n = row.querySelector(".vname");
      if (n && vv[i]) n.title = "carrier " + vv[i].base.toFixed(1) + " Hz · beat " + vv[i].beat.toFixed(2) + " Hz · vol " + vv[i].volL.toFixed(2);
    });
    drawGraph();
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    fillPresets();
    buildPackDownloads();
    $("play").onclick = togglePlay;
    $("stopBtn").onclick = function () { stopPlayback(false); };
    $("master").oninput = function () {
      var v = parseFloat($("master").value);
      if (state.master) state.master.gain.value = v;
    };
    $("loop").onchange = function () {
      var v = $("loop").checked ? Infinity : 1;
      state.schedule.loops = v;
      if (state.mode === "worklet" && state.node) state.node.port.postMessage({ t: "loop", loops: v });
      if (state.fallback) { state.fallback.loops = v; state.fallback.loopCount = v; }
      updateMeta();
    };
    $("loadBtn").onclick = function () { $("file").click(); };
    $("file").onchange = function () { if (this.files && this.files[0]) loadFile(this.files[0]); this.value = ""; };
    $("loadPackBtn").onclick = function () { $("packfile").click(); };
    $("packfile").onchange = function () { if (this.files && this.files[0]) loadFile(this.files[0]); this.value = ""; };
    $("rmpacks").onclick = function () { clearImported(); };
    $("exportBtn").onclick = exportWav;
    $("exportMin").onchange = function () { state.exportMinutes = parseInt(this.value, 10); };
    document.addEventListener("keydown", function (ev) {
      if (ev.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
        ev.preventDefault(); togglePlay();
      }
    });
    document.addEventListener("dragover", function (ev) { ev.preventDefault(); });
    document.addEventListener("drop", function (ev) {
      ev.preventDefault();
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]) loadFile(ev.dataTransfer.files[0]);
    });
    window.addEventListener("resize", drawGraph);
    /* debug/QA hooks (used by the hub's headless checks; harmless in normal use) */
    window.__gnaural = state;
    /* Studio API: what the standalone site's panels (studio.js) drive. Kept
     * deliberately small and additive so the hub copy behaves identically. */
    window.__gnauralAPI = {
      state: state,
      loadSchedule: loadSchedule,
      loadPreset: loadPreset,
      presetCount: function () { return state.presetList.length; },
      presetInfo: function (i) { return state.presetList[i]; },
      rebuildOptions: rebuildOptions,
      rebuildEngine: rebuildEngine,
      syncToWorklet: syncToWorklet,
      updateMeta: updateMeta,
      drawGraph: drawGraph,
      refresh: function () { renderVoiceList(); renderEntryEditor(); drawGraph(); updateMeta(); },
      play: play, pause: pause, stopPlayback: stopPlayback, togglePlay: togglePlay,
      exportWav: exportWav,
      toast: toast,
      fmtTime: fmtTime,
      addVoice: function (type, entries, opts) {
        opts = opts || {};
        var v = { type: type | 0, mute: false, mono: !!opts.mono,
                  entries: (entries || []).map(function (e) {
                    return { duration: e.duration === undefined ? 60 : e.duration,
                             volL: e.volL === undefined ? 0.3 : e.volL,
                             volR: e.volR === undefined ? (e.volL === undefined ? 0.3 : e.volL) : e.volR,
                             basefreq: e.basefreq === undefined ? 200 : e.basefreq,
                             beat: e.beat === undefined ? 0 : e.beat };
                  }) };
        if (!v.entries.length) v.entries.push({ duration: 60, volL: 0.3, volR: 0.3, basefreq: 200, beat: 0 });
        state.schedule.voices.push(v);
        state.selected = state.schedule.voices.length - 1;
        rebuildEngine(); syncToWorklet(); window.__gnauralAPI.refresh();
        return state.schedule.voices.length - 1;
      },
      removeVoice: function (i) {
        if (state.schedule.voices.length <= 1) return false;
        state.schedule.voices.splice(i, 1);
        state.selected = Math.max(0, Math.min(state.selected, state.schedule.voices.length - 1));
        rebuildEngine(); syncToWorklet(); window.__gnauralAPI.refresh();
        return true;
      },
      toGnauralText: function () {
        var model = GNM.engineScheduleToGnaural(state.schedule.voices, {
          title: state.title, description: state.source, author: "Gnaural Web",
          loops: state.schedule.loops, overallVolL: state.schedule.volumeL, overallVolR: state.schedule.volumeR
        });
        return GNM.writeGnaural(model);
      },
      loadGnauralText: function (text, name) {
        var p = GNM.parseGnaural(text);
        var s = GNM.toEngineSchedule(p);
        if (!s.voices.length) throw new Error("that schedule has no playable voices");
        loadSchedule(s.voices, { title: p.title || name || "shared schedule",
          source: p.author ? ("shared by " + p.author) : "shared link",
          loops: s.loops, volumeL: s.volumeL, volumeR: s.volumeR, warnings: p.warnings });
        return { voices: s.voices.length, duration: state.engine.duration() };
      },
      setMaster: function (v) {
        $("master").value = String(v);
        $("master").dispatchEvent(new Event("input", { bubbles: true }));   // repaint the Marantz face
        if (state.master) state.master.gain.value = v;
      },
      analyser: function () { return state.analyser || null; }
    };
    window.__gnauralLoadPackBytes = function (buf, name) {
      return loadPackZip(new File([buf], name || "pack.zip"));
    };
    window.__gnauralLoadText = function (text, name) {
      try {
        var p = GNM.parseGnaural(text);
        var s = GNM.toEngineSchedule(p);
        loadSchedule(s.voices, { title: p.title || name || "inline test", source: "inline test",
                                 loops: s.loops, warnings: p.warnings });
        return { voices: s.voices.length, duration: state.engine.duration(), warnings: p.warnings };
      } catch (e) { return { error: e.message }; }
    };
    requestAnimationFrame(raf);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
