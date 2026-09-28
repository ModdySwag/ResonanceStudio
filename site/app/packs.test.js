/* Tests for the pack library (packs.js) — every generated session must be a
 * valid, sane, non-clipping schedule.  Run:  node packs.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "presets.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "packs.js"), "utf8"));
const GE = globalThis.GnauralEngine;
const P = globalThis.GnauralPresets;
const K = globalThis.GnauralPacks;
const SR = 44100;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL " + label + "  -> " + JSON.stringify(extra)); }
}

const report = [];
for (const item of K.LIBRARY) {
  const sched = P.presetToSchedule(item);
  const eng = new GE.Engine();
  eng.setSchedule(sched);
  eng.paused = false;
  eng.currentSample = Math.floor(SR * eng.duration() * 0.5);
  const bl = new Float32Array(128), br = new Float32Array(128);
  let done = 0, nan = 0, peak = 0, energy = 0;
  while (done < SR) {
    const n = Math.min(128, SR - done);
    eng.render(bl, br, n);
    for (let i = 0; i < n; i++) {
      const v = bl[i], w = br[i];
      if (!isFinite(v) || !isFinite(w)) nan++;
      peak = Math.max(peak, Math.abs(v), Math.abs(w));
      energy += Math.abs(v);
    }
    done += n;
  }
  let maxBase = 0, maxBeat = 0, maxVol = 0, badEntry = 0;
  for (const v of sched) for (const e of v.entries) {
    if (!isFinite(e.duration) || e.duration <= 0 || !isFinite(e.basefreq) || !isFinite(e.beat) || !isFinite(e.volL)) badEntry++;
    maxBase = Math.max(maxBase, e.basefreq);
    maxBeat = Math.max(maxBeat, e.beat);
    maxVol = Math.max(maxVol, e.volL);
  }
  const dur = eng.duration();
  report.push({ name: item.name, pack: item.packName, voices: sched.length,
                min: Math.round(dur / 6) / 10, peak: +peak.toFixed(3), energy: +energy.toFixed(2) });

  check("renders clean: " + item.name, nan === 0 && badEntry === 0 && energy > 1 && dur >= 300, { nan, badEntry, energy, dur });
  check("sane + no clip: " + item.name, maxBase <= 1200 && maxBeat <= 40 && maxVol <= 0.5 && peak < 1.0,
        { maxBase, maxBeat, maxVol, peak: +peak.toFixed(3) });
}

/* every session has a name, a blurb and a pack; and the blurb's stated length
 * must equal the real rendered length (no hand-written durations anywhere) */
const names = new Set();
for (const item of K.LIBRARY) {
  check("named + described: " + (item.name || "?"), !!item.name && !!item.blurb && item.blurb.length > 20, item.blurb);
  check("unique name: " + item.name, !names.has(item.name), item.name);
  names.add(item.name);

  const eng = new GE.Engine();
  eng.setSchedule(P.presetToSchedule(item));
  const stated = / (\d+) minutes\.\s*$/.exec(item.blurb);
  check("blurb duration matches render: " + item.name,
        !!stated && Number(stated[1]) === Math.round(eng.duration() / 60),
        { stated: stated && stated[1], real: eng.duration() });
}

/* the machinery itself: one level + one shape -> a session of the right shape */
{
  const intro = K.buildSession("F10", "intro");
  check("intro shape builds 4 voices", intro.length === 4, intro.length);
  const e0 = intro[0].entries;
  check("intro: fade in, settle down, hold, fade out",
        e0.length === 4 && e0[0].vol === 0 && e0[1].beat > e0[2].beat && e0[3].vol === 0,
        e0.map(e => [e.dur, e.beat, e.vol]));

  const nap = K.buildSession("F10", "nap");
  const ne = nap[0].entries;
  const beats = ne.map(e => e.beat);
  check("nap shape ends with a wake ramp (beat climbs and stays up)",
        ne.length === 6 && beats[4] > beats[2] && beats[5] >= beats[4], beats);

  const sleep = K.buildSession("F15", "sleep");
  check("sleep shape adds the surf bed", sleep.length === K.LEVELS.F15.sets.length + 1 &&
        sleep[sleep.length - 1].type === "pink", sleep.map(v => v.type));
}

/* the speaker pack must never depend on an interaural difference: every voice
 * is an isochronic pulse (type 3), a noise bed (type 1), or a steady carrier
 * whose beat is 0 (L and R identical).  Two of those carriers a few Hz apart
 * beat in the room itself — which is the point of the pack. */
{
  const sp = K.LIBRARY.filter(x => x.pack === "speakers");
  check("speaker pack ships 9 sessions", sp.length === 9, sp.length);

  const offenders = [];
  for (const item of sp) {
    for (const v of item.voices) {
      if (v.type === "iso" || v.type === "pink") continue;
      if (v.type === "binaural" && v.entries.every(e => e.beat === 0)) continue;
      offenders.push(item.name + " -> type " + v.type + " beats " + v.entries.map(e => e.beat).join(","));
    }
  }
  check("no speaker session contains an interaural (binaural) pair", offenders.length === 0, offenders);

  const pulse = (name, want) => {
    const it = sp.find(x => x.name === name);
    const iso = it && it.voices.filter(v => v.type === "iso" && v.entries[0].base !== 281);
    /* the longest entry is the held stretch — that is the rate the sitting sits in */
    const rate = v => v.entries.reduce((a, e) => (e.dur > a.dur ? e : a), v.entries[0]).beat;
    check("speaker pulse rate: " + name, !!iso && iso.length > 0 && iso.every(v => Math.abs(rate(v) - want) < 0.001),
          iso ? iso.map(v => v.entries.map(e => e.beat)) : null);
  };
  pulse("First pass — a quiet room pulse", 10);
  pulse("Evening room (slow pulse)", 2.5);
  pulse("Talk-over alpha (very quiet)", 10);
  pulse("Sit-anywhere focus (13.5 Hz)", 13.5);
  pulse("Room theta (six a second)", 6);
  pulse("Couch nap (pulse wake cue)", 2);

  /* the monaural session: two steady carriers, exactly 4 Hz apart, nothing else */
  const mono = sp.find(x => x.name === "The acoustic beat (200 + 204 Hz)");
  const carriers = mono.voices.map(v => v.entries[Math.floor(v.entries.length / 2)].base).sort((a, b) => a - b);
  check("acoustic-beat session is two plain carriers 4 Hz apart",
        mono.voices.length === 2 && mono.voices.every(v => v.type === "binaural" && v.entries.every(e => e.beat === 0)) &&
        carriers[0] === 200 && carriers[1] === 204, { carriers, types: mono.voices.map(v => v.type) });

  /* the slide drifts 4 -> 12 Hz, monotonically, across its hold */
  const slide = sp.find(x => x.name === "Slow slide (four into twelve)");
  const hold = slide.voices[0].entries.slice(1, -1).map(e => e.beat);
  check("slow slide walks the pulse rate 4 -> 12 without going backwards",
        hold.length >= 4 && hold[0] === 4 && hold[hold.length - 1] === 12 &&
        hold.every((b, i) => i === 0 || b > hold[i - 1]), hold);

  /* the nap's wake cue is a speaker pulse, not the headphone pair */
  const nap = sp.find(x => x.name === "Couch nap (pulse wake cue)");
  const cue = nap.voices[nap.voices.length - 1];
  check("nap wake cue is rendered as an isochronic pulse",
        cue.type === "iso" && cue.entries[0].base === 281 && cue.entries[1].beat === 22 &&
        cue.entries[0].vol === 0 && cue.entries[cue.entries.length - 1].vol === 0,
        { type: cue.type, base: cue.entries[0].base, beat: cue.entries[1].beat });

  /* speaker carriers stay in the band that survives small speakers and sits
   * above the room's own modal region (research: standing waves reach ~300 Hz;
   * small drivers roll off below that) */
  const low = [];
  for (const item of sp) {
    for (const v of item.voices) {
      if (v.type !== "iso") continue;
      for (const e of v.entries) if (e.base < 200 || e.base > 500) low.push(item.name + " " + e.base);
    }
  }
  check("speaker carriers sit between 200 and 500 Hz", low.length === 0, low);

  /* headroom: a summed equal-rate stack peaks at 0.5 x sum-of-levels (measured),
   * and the output stage hard-clamps at 1.0 — so no session may plan to sum past 0.9 */
  const hot = [];
  for (const item of K.LIBRARY) {
    const mid = item.voices.map(v => v.entries[Math.floor(v.entries.length / 2)].vol || 0)
      .reduce((a, b) => a + b, 0);
    if (mid * 0.5 > 0.9) hot.push(item.name + " sum " + mid.toFixed(3));
  }
  check("no session plans a summed level above 0.9 (clipping headroom)", hot.length === 0, hot);

  /* the beds must HOLD, not decay: shape() used to zero the trailing entry, which
   * turned every hold into one long fade-out (found by the engine probe).  Render
   * a bed-bearing session twice and require the late level to match the early one. */
  const bedSessions = K.LIBRARY.filter(i => i.voices.some(v => v.type === "pink"));
  const decays = [];
  for (const item of bedSessions) {
    const bed = P.presetToSchedule({ voices: item.voices.filter(v => v.type === "pink") });
    const eng = new GE.Engine();
    eng.setSchedule(bed);
    eng.paused = false;
    const total = eng.duration();
    const rmsAt = frac => {
      eng.currentSample = Math.floor(SR * total * frac);
      const bl = new Float32Array(SR), br = new Float32Array(SR);
      let e = 0;
      const blocks = Math.floor(SR / 128);
      for (let b = 0; b < blocks; b++) { eng.render(bl, br, 128); for (let i = 0; i < 128; i++) e += bl[i] * bl[i]; }
      return Math.sqrt(e / (blocks * 128));
    };
    const early = rmsAt(0.25), late = rmsAt(0.85);
    if (!(late > early * 0.7)) decays.push(item.name + " early " + early.toFixed(4) + " late " + late.toFixed(4));
  }
  check("every noise bed holds its level instead of fading away", decays.length === 0, decays);
}

/* the tour: N stages x stage seconds + lead-in + lead-out */
{
  const t = K.buildTour(["F10", "F15"], 600);
  const eng = new GE.Engine();
  eng.setSchedule(P.presetToSchedule({ voices: t }));
  check("tour length = 30 + stages*600 + 90", Math.abs(eng.duration() - (30 + 2 * 600 + 90)) <= 5, eng.duration());
}

/* ------------------------------------------------------------- mono safety --
 * A session that advertises itself as speaker/room work must contain nothing
 * that depends on an interaural difference: every layer either a single-carrier
 * pulse ("iso", identical in both channels) or a pair of steady carriers that
 * beat in the room (beat 0).  Anything else loses its beat on one speaker. */
{
  const SPEAKER_PACKS = ["speakers", "focus", "breathing"];
  const notMono = [];
  for (const item of K.LIBRARY) {
    const claimsRoom = SPEAKER_PACKS.indexOf(item.pack) >= 0 ||
                       /no headphones/i.test(item.name + " " + item.blurb);
    if (!claimsRoom) continue;
    for (const v of item.voices) {
      if (v.type === "iso") continue;
      for (const e of v.entries) if ((e.beat || 0) > 0) notMono.push(item.name + " / " + v.type + " beat " + e.beat);
    }
  }
  check("every speaker-claiming session is mono-safe", notMono.length === 0, notMono);

  /* and the claim itself must exist: the packs above really are all-mono, and
   * the two Schumann monaural sessions are the only others that say so */
  /* the two Schumann monaural sessions are the ones whose own copy promises
   * speaker use; the speaker/focus/breathing packs make that promise at pack
   * level, which the check above already enforces by pack id */
  const monoClaims = K.LIBRARY.filter(i => /no headphones/i.test(i.name + " " + i.blurb)).length;
  check("the two Schumann monaural sessions carry the no-headphones promise",
        monoClaims === 2, monoClaims);
}

/* ------------------------------------------------- the sub-1 Hz paces ------
 * The breathing pack claims "one on/off cycle per breath — five seconds of
 * tone, five of silence" at 0.1 Hz, and the help repeats it.  Measured on the
 * rendered samples here: the longest on-run and the longest off-run in a
 * 12-second window of the rendered stream must both be ~5 s. */
{
  const br = K.LIBRARY.find(i => i.name === "First pass — six breaths a minute");
  check("breathing pack present", !!br);
  if (br) {
    const sched = P.presetToSchedule({ voices: br.voices.filter(v => v.type === "iso") });
    const eng = new GE.Engine();
    eng.setSchedule(sched);
    eng.paused = false;
    /* sample the STEADY HOLD, not the settle: every shape's first entry glides
     * down from rate x 2.2, so the opening minute really does pulse faster */
    eng.currentSample = Math.floor(SR * eng.duration() * 0.5);
    const blocks = Math.floor(SR * 12 / 128);
    const bl = new Float32Array(128), brr = new Float32Array(128);
    const rms = [];
    for (let b = 0; b < blocks; b++) {
      eng.render(bl, brr, 128);
      let e = 0;
      for (let i = 0; i < 128; i++) e += bl[i] * bl[i];
      rms.push(Math.sqrt(e / 128));
    }
    const sorted = rms.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const thr = lo + (hi - lo) * 0.5;
    const secsPerBlock = 128 / SR;
    let on = 0, off = 0, maxOn = 0, maxOff = 0;
    for (const r of rms) {
      if (r > thr) { on++; maxOn = Math.max(maxOn, on); off = 0; }
      else { off++; maxOff = Math.max(maxOff, off); on = 0; }
    }
    const onSec = maxOn * secsPerBlock, offSec = maxOff * secsPerBlock;
    check("0.1 Hz pace renders ~5 s on / ~5 s off",
          Math.abs(onSec - 5) < 0.2 && Math.abs(offSec - 5) < 0.2,
          { onSec: +onSec.toFixed(3), offSec: +offSec.toFixed(3), period: +(onSec + offSec).toFixed(3) });
  }
}

console.log("library: " + K.LIBRARY.length + " sessions in " + K.PACKS.length + " pack(s)");
for (const r of report) console.log("   " + String(r.min).padStart(6) + " min  peak " + r.peak + "  " + r.voices + " v  " + r.name);
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
