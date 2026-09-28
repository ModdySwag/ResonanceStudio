/* Tests for the built-in presets — numeric sanity + no-clip headroom.
 * Run:  node presets.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "presets.js"), "utf8"));
const GE = globalThis.GnauralEngine;
const P = globalThis.GnauralPresets;
const SR = 44100;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + "  -> " + extra); }
}

/* ---------- 1. every preset converts, calibrates and renders cleanly ---------- */
const report = [];
for (const p of P.PRESETS) {
  const sched = P.presetToSchedule(p);
  const eng = new GE.Engine();
  eng.setSchedule(sched);
  eng.paused = false;
  eng.currentSample = Math.floor(SR * eng.duration() * 0.5);   /* mid-session, where it is loudest */
  const L = new Float32Array(44100), R = new Float32Array(44100);
  const bl = new Float32Array(128), br = new Float32Array(128);
  let done = 0, nan = 0, peak = 0, energy = 0;
  while (done < L.length) {
    const n = Math.min(128, L.length - done);
    eng.render(bl, br, n);
    for (let i = 0; i < n; i++) {
      const v = bl[i], w = br[i];
      if (!isFinite(v) || !isFinite(w)) nan++;
      const m = Math.max(Math.abs(v), Math.abs(w));
      if (m > peak) peak = m;
      energy += Math.abs(v);
    }
    done += n;
  }
  const dur = eng.duration();
  let maxBase = 0, maxBeat = 0, maxVol = 0, badNums = 0;
  for (const v of sched) for (const e of v.entries) {
    if (!isFinite(e.duration) || !isFinite(e.basefreq) || !isFinite(e.beat) || !isFinite(e.volL)) badNums++;
    if (e.basefreq > maxBase) maxBase = e.basefreq;
    if (e.beat > maxBeat) maxBeat = e.beat;
    if (e.volL > maxVol) maxVol = e.volL;
  }
  report.push({ name: p.name, voices: sched.length, dur: Math.round(dur / 60 * 10) / 10, peak: peak.toFixed(3) });
  check("preset renders: " + p.name, nan === 0 && badNums === 0 && dur > 300 && energy > 0.01,
        { nan, badNums, dur, energy: energy.toFixed(3) });
  check("  sane ranges: " + p.name, maxBase <= 1200 && maxBeat <= 40 && maxVol <= 0.5 && peak <= 1.0,
        { maxBase, maxBeat, maxVol, peak: peak.toFixed(3) });
}

/* ---------- 2. the focus-level set exists with the documented carriers ---------- */
function byName(n) { return P.PRESETS.find(p => p.name.indexOf(n) === 0); }
function carriers(preset) {
  const s = P.presetToSchedule(preset);
  return s.map(v => {
    const e = v.entries[0];
    return [e.basefreq, e.beat];
  });
}
{
  const f10 = byName("Focus 10");
  check("Focus 10 preset present", !!f10);
  const v200 = P.presetToSchedule(f10).find(v => v.entries[0].basefreq === 200);
  check("Focus 10: 200 Hz layer settles 10 -> 4 Hz, bed has 100[1.5]/250[4]/300[4]",
        !!v200 && v200.entries.some(e => e.beat === 10) && v200.entries.some(e => e.beat === 4) &&
        JSON.stringify(carriers(f10)).includes("[100,1.5]") &&
        carriers(f10).some(x => x[0] === 250 && x[1] === 4) && carriers(f10).some(x => x[0] === 300 && x[1] === 4),
        carriers(f10));

  const f12 = byName("Focus 12");
  const c12 = carriers(f12);
  check("Focus 12 adds 400[10.0], 500[10.1], 600[4.8]", c12.some(x => x[0] === 400 && x[1] === 10) &&
        c12.some(x => x[0] === 500 && x[1] === 10.1) && c12.some(x => x[0] === 600 && x[1] === 4.8) && c12.length === 7, c12);

  const f15 = byName("Focus 15");
  const c15 = carriers(f15);
  check("Focus 15 adds 500[7.05], 630[7.1], 750[7.0]", c15.some(x => x[0] === 500 && x[1] === 7.05) &&
        c15.some(x => x[0] === 630 && x[1] === 7.1) && c15.some(x => x[0] === 750 && x[1] === 7), c15);

  const f21 = byName("Focus 21");
  const c21 = carriers(f21);
  check("Focus 21 carries 200[4.0], 600[16.2], 750[16.2]", c21.some(x => x[0] === 200 && x[1] === 4) &&
        c21.some(x => x[0] === 600 && x[1] === 16.2) && c21.some(x => x[0] === 750 && x[1] === 16.2), c21);

  const f27 = byName("Focus 27");
  const c27 = carriers(f27);
  check("Focus 27 carries 50[0.80], 503[4.2], 900[4.0]", c27.some(x => x[0] === 50 && x[1] === 0.8) &&
        c27.some(x => x[0] === 503 && x[1] === 4.2) && c27.some(x => x[0] === 900 && x[1] === 4), c27);

  const tour = byName("Level Tour");
  check("Level Tour preset present", !!tour);
  const eng = new GE.Engine();
  eng.setSchedule(P.presetToSchedule(tour));
  check("Level Tour runs ~61 minutes", Math.abs(eng.duration() - 3690) < 5, eng.duration());
}

/* ---------- 3. the tour's stages really change the carrier sets ---------- */
{
  const tour = byName("Level Tour");
  const eng = new GE.Engine();
  eng.setSchedule(P.presetToSchedule(tour));
  // voice 1 is the 200 Hz layer at Focus 10, 503-ish by Focus 27 (glides via entries)
  const ee = eng.voices[1].entries;
  const at = (sec) => {
    for (const e of ee) if (sec * 44100 >= e.absStart && sec * 44100 <= e.absEnd) return e;
    return null;
  };
  const s10 = at(600 + 300), s27 = at(5 * 600 + 300);
  check("tour voice 1: 200 Hz at F10 stage, 400 Hz at F27 stage",
        s10 && Math.abs(s10.basefreq_start - 200) < 1 && s27 && Math.abs(s27.basefreq_start - 400) < 1,
        [s10 && s10.basefreq_start, s27 && s27.basefreq_start]);
}

console.log("\npreset durations (minutes):");
for (const r of report) console.log("   " + String(r.dur).padStart(6) + "  peak " + r.peak + "  " + r.voices + " voice(s)  " + r.name);
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
