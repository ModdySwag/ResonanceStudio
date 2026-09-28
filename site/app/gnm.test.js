/* Tests for the .gnaural reader — validated against the seven REAL upstream fixtures
 * (cache/gnaural/presets-raw/, used as local test material only; not redistributed).
 * Run:  node gnm.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "gnm.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
const G = globalThis.GnauralGNM;
const GE = globalThis.GnauralEngine;

const RAW = path.join(__dirname, "..", "..", "..", "cache", "gnaural", "presets-raw");
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---------- 1. PowerNap: full-field parse ---------- */
{
  const xml = fs.readFileSync(path.join(RAW, "PowerNap.gnaural"), "utf8");
  const p = G.parseGnaural(xml);
  check("PowerNap: format version", p.formatVersion === "1.20101006", p.formatVersion);
  check("PowerNap: title/author", p.title === "Power Nap" && p.author === "Gnaural", [p.title, p.author]);
  check("PowerNap: loops 1, volumes 1", p.loops === 1 && p.overallVolL === 1 && p.overallVolR === 1);
  check("PowerNap: 3 voices, types 0/5/6", p.voices.length === 3 &&
        p.voices.map(v => v.type).join("/") === "0/5/6", p.voices.map(v => v.type));
  const v0 = p.voices[0];
  check("PowerNap: voice0 has 12 entries", v0.entries.length === 12, v0.entries.length);
  const e0 = v0.entries[0];
  check("PowerNap: first entry values", Math.abs(e0.duration - 13.1737) < 1e-9 &&
        Math.abs(e0.beat - 10.991) < 1e-9 && Math.abs(e0.base - 164) < 1e-9,
        [e0.duration, e0.beat, e0.base]);
  check("PowerNap: beat stored as true Hz (not halved)", Math.abs(e0.beat - 10.991) < 1e-9, e0.beat);
  check("PowerNap: derived duration ~1200 s", Math.abs(p.duration - 1200) < 5, p.duration);
  check("PowerNap: unplayable voices flagged (5,6)", !p.voices[0].playable && !p.voices[1].playable && !p.voices[2].playable ? false : !p.voices[1].playable && !p.voices[2].playable);
  const eng = G.toEngineSchedule(p);
  check("PowerNap: engine schedule keeps only playable voices", eng.voices.length === 1 && eng.voices[0].type === 0, eng.voices.length);
  check("PowerNap: warning mentions unplayable types", p.warnings.some(w => /not yet playable/.test(w)), p.warnings);
}

/* ---------- 2. every real fixture parses cleanly ---------- */
{
  const files = fs.readdirSync(RAW).filter(f => f.endsWith(".gnaural"));
  check("fixtures found", files.length >= 5, files.length);
  for (const f of files) {
    let p = null, err = null;
    try { p = G.parseGnaural(fs.readFileSync(path.join(RAW, f), "utf8")); } catch (e) { err = e.message; }
    if (!p) { check(f + " parses", false, err); continue; }
    let bad = 0, nums = 0;
    for (const v of p.voices) for (const e of v.entries) {
      nums++;
      if (!isFinite(e.duration) || !isFinite(e.base) || !isFinite(e.beat) || !isFinite(e.volL) || !isFinite(e.volR)) bad++;
    }
    check(f + " parses (" + p.voices.length + " voices, " + nums + " entries, " + p.duration.toFixed(1) + " s)",
          p.voices.length > 0 && nums > 0 && bad === 0 && p.duration > 0);
  }
}

/* ---------- 3. grouping is by CONSECUTIVE same-parent runs ---------- */
{
  const xml = '<?xml version="1.0"?><schedule><gnauralfile_version>1.20101006</gnauralfile_version>' +
    '<loops>0</loops><voicecount>2</voicecount>' +
    '<voice><type>0</type><voice_mute>0</voice_mute></voice>' +
    '<voice><type>3</type><voice_mute>1</voice_mute><voice_mono>1</voice_mono></voice>' +
    '<entries>' +
    '<entry parent="0" duration="1" basefreq="200" beatfreq="4" volume_left="1" volume_right="1"/>' +
    '<entry parent="0" duration="1" basefreq="210" beatfreq="4" volume_left="0.5" volume_right="0.5"/>' +
    '<entry parent="1" duration="2" basefreq="300" beatfreq="8" volume_left="0.8" volume_right="0.8"/>' +
    '</entries></schedule>';
  const p = G.parseGnaural(xml);
  check("grouping: 2 voices split on parent change", p.voices.length === 2 &&
        p.voices[0].entries.length === 2 && p.voices[1].entries.length === 1, p.voices.map(v => v.entries.length));
  check("grouping: voice metadata applies in order", p.voices[1].type === 3 && p.voices[1].mute === true && p.voices[1].mono === true);
  check("loops 0 -> Infinity", G.toEngineSchedule(p).loops === Infinity);
}

/* ---------- 4. round-trip into the engine produces audio ---------- */
{
  const xml = fs.readFileSync(path.join(RAW, "DefaultMeditationSession.gnaural"), "utf8");
  const p = G.parseGnaural(xml);
  const eng = new GE.Engine();
  const sched = G.toEngineSchedule(p);
  check("engine schedule non-empty for DefaultMeditationSession", sched.voices.length >= 1, sched.voices.length);
  eng.setSchedule(sched.voices);
  eng.paused = false;
  const L = new Float32Array(44100), R = new Float32Array(44100);
  const bufL = new Float32Array(128), bufR = new Float32Array(128);
  let done = 0, energy = 0;
  while (done < L.length) {
    const n = Math.min(128, L.length - done);
    eng.render(bufL, bufR, n);
    for (let i = 0; i < n; i++) { L[done + i] = bufL[i]; R[done + i] = bufR[i]; energy += Math.abs(bufL[i]); }
    done += n;
  }
  check("renders 1 s of the real preset with signal", energy / L.length > 0.001, energy / L.length);
  check("engine duration matches preset duration", Math.abs(eng.duration() - p.duration) < 1, [eng.duration(), p.duration]);
}

/* ---------- 5. writer: write -> parse round-trips (incl. extension types) ---------- */
{
  const sched = {
    title: "Writer test <&>", description: "round-trip", author: "test", loops: 3,
    overallVolL: 0.8, overallVolR: 0.7, stereoSwap: true,
    voices: [
      { type: 0, mute: false, mono: false, description: "pair", entries: [
        { duration: 60, volL: 0.12, volR: 0.12, beat: 7.83, basefreq: 200 },
        { duration: 30, volL: 0, volR: 0, beat: 7.83, basefreq: 200 } ] },
      { type: 8, mute: true, mono: false, description: "brown bed", entries: [
        { duration: 90, volL: 0.05, volR: 0.05, beat: 0, basefreq: 0 } ] },
      { type: 3, mute: false, mono: true, description: "pulses", entries: [
        { duration: 45, volL: 0.1, volR: 0.1, beat: 10, basefreq: 300 } ] }
    ]
  };
  const xml = G.writeGnaural(sched);
  check("writer emits XML declaration and the schedule root tag (no wrapper)",
    xml.startsWith('<?xml version="1.0"?>') && /<schedule>/.test(xml) && !/<gnaural>/.test(xml) &&
    xml.trim().endsWith("</schedule>"), xml.slice(0, 60));
  const back = G.parseGnaural(xml);
  check("round-trip: voice count", back.voices.length === 3, back.voices.length);
  check("round-trip: types preserved (0, 8, 3)",
    back.voices.map(v => v.type).join(",") === "0,8,3", back.voices.map(v => v.type));
  check("round-trip: extension type 8 is playable", back.voices[1].playable === true && back.voices[1].typeName === "brown noise", back.voices[1].typeName);
  check("round-trip: title escaped and restored", back.title === "Writer test <&>", back.title);
  check("round-trip: loops", back.loops === 3, back.loops);
  check("round-trip: overall volumes", Math.abs(back.overallVolL - 0.8) < 1e-9 && Math.abs(back.overallVolR - 0.7) < 1e-9, [back.overallVolL, back.overallVolR]);
  check("round-trip: stereoSwap", back.stereoSwap === true, back.stereoSwap);
  check("round-trip: mute/mono flags", back.voices[1].mute === true && back.voices[2].mono === true, [back.voices[1].mute, back.voices[2].mono]);
  check("round-trip: durations", Math.abs(back.voices[0].duration - 90) < 1e-6 && Math.abs(back.voices[2].duration - 45) < 1e-6, back.voices.map(v => v.duration));
  const e1 = back.voices[0].entries[0], e2 = back.voices[2].entries[0];
  check("round-trip: beat is true Hz (not halved)", Math.abs(e1.beat - 7.83) < 1e-6 && Math.abs(e2.beat - 10) < 1e-6, [e1.beat, e2.beat]);
  check("round-trip: base frequency", Math.abs(e1.base - 200) < 1e-6 && Math.abs(e2.base - 300) < 1e-6, [e1.base, e2.base]);
  check("round-trip: volumes", Math.abs(e1.volL - 0.12) < 1e-9 && Math.abs(back.voices[0].entries[1].volL) < 1e-9, e1.volL);
  /* the written file must play: engine schedule from the re-parsed text */
  const eng2 = new GE.Engine();
  eng2.setSchedule(G.toEngineSchedule(back).voices);
  eng2.paused = false;
  const L2 = new Float32Array(44100), R2 = new Float32Array(44100);
  const bl2 = new Float32Array(256), br2 = new Float32Array(256);
  let energy2 = 0;
  for (let off = 0; off < L2.length; off += 256) {
    const n = Math.min(256, L2.length - off);
    eng2.render(bl2, br2, n);
    for (let i = 0; i < n; i++) energy2 += Math.abs(bl2[i]);
  }
  check("round-trip file renders audio", energy2 / L2.length > 0.0005, energy2 / L2.length);
  check("infinite loops write as 0 (upstream convention)",
    /<loops>0<\/loops>/.test(G.writeGnaural({ loops: Infinity, voices: [{ type: 0, entries: [{ duration: 1, beat: 4, basefreq: 200 }] }] })));
  /* every shipped preset must survive write -> parse intact */
  const PR = require("./presets.js");
  let bad = [];
  for (const p of PR.PRESETS) {
    const eng0 = PR.presetToSchedule(p);
    const model = G.engineScheduleToGnaural(eng0, { title: p.name });
    const rt = G.parseGnaural(G.writeGnaural(model));
    if (rt.voices.length !== eng0.length) { bad.push(p.name + " count"); continue; }
    for (let v = 0; v < eng0.length; v++) {
      if (rt.voices[v].type !== eng0[v].type) { bad.push(p.name + " v" + v + " type " + rt.voices[v].type + "!=" + eng0[v].type); break; }
      if (rt.voices[v].entries.length !== eng0[v].entries.length) { bad.push(p.name + " v" + v + " entries"); break; }
      for (let e = 0; e < eng0[v].entries.length; e++) {
        const src = eng0[v].entries[e];
        if (Math.abs(rt.voices[v].entries[e].duration - src.duration) > 1e-6) { bad.push(p.name + " v" + v + " e" + e + " dur"); break; }
        if (Math.abs(rt.voices[v].entries[e].beat - src.beat) > 1e-6) { bad.push(p.name + " v" + v + " e" + e + " beat"); break; }
        if (Math.abs(rt.voices[v].entries[e].base - src.basefreq) > 1e-6) { bad.push(p.name + " v" + v + " e" + e + " base"); break; }
      }
    }
  }
  check("all classic presets survive write -> parse", bad.length === 0, bad.slice(0, 4));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
