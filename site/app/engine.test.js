/* Node sanity tests for the Gnaural Web engine (no browser, no Ableton).
 * Run:  node engine.test.js      (from site/apps/gnaural-web/)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "engine.js"), "utf8");
eval(src);  // defines globalThis.GnauralEngine
const GE = globalThis.GnauralEngine;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

function render(engine, seconds, block) {
  block = block || 128;
  const total = Math.floor(seconds * GE.SAMPLE_RATE);
  const L = new Float32Array(total), R = new Float32Array(total);
  let done = 0, completed = false;
  const bufL = new Float32Array(block), bufR = new Float32Array(block);
  while (done < total) {
    const n = Math.min(block, total - done);
    const res = engine.render(bufL, bufR, n);
    if (res.completed) completed = true;
    for (let i = 0; i < n; i++) { L[done + i] = bufL[i]; R[done + i] = bufR[i]; }
    done += n;
    if (completed) break;
  }
  return { L: L.subarray(0, done), R: R.subarray(0, done), completed: completed };
}

function zeroCrossings(buf) {
  let n = 0;
  for (let i = 1; i < buf.length; i++) if (buf[i - 1] <= 0 && buf[i] > 0) n++;
  return n;
}

function rms(buf, from, to) {
  let s = 0, n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

/* ---------- 1. binaural: base 220, beat 4 -> L 222 Hz, R 218 Hz (symmetric around base) ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_BINAURAL, entries: [{ duration: 5, basefreq: 220, beat: 4, volL: 0.9, volR: 0.9 }] }]);
  e.paused = false;
  const { L, R } = render(e, 2.0);
  const zl = zeroCrossings(L), zr = zeroCrossings(R);
  check("binaural: L ~222 Hz (upstream symmetric convention)", Math.abs(zl - 444) <= 3, zl);
  check("binaural: R ~218 Hz", Math.abs(zr - 436) <= 3, zr);
  check("binaural: L-R frequency difference = beat (4 Hz over 2 s = 8 crossings)", Math.abs((zl - zr) - 8) <= 2, (zl - zr));
  check("binaural: signal present", rms(L, 0, L.length) > 0.05, rms(L, 0, L.length));
}

/* ---------- 2. isopulse: tone/silence alternating at 8 Hz, ~50% duty ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_ISOPULSE, entries: [{ duration: 4, basefreq: 440, beat: 8, volL: 1, volR: 1 }] }]);
  e.paused = false;
  const { L } = render(e, 2.0);
  const win = Math.floor(GE.SAMPLE_RATE / 100); // 10 ms windows
  let loud = 0;
  for (let i = 0; i + win < L.length; i += win) {
    if (rms(L, i, i + win) > 0.15) loud++;
  }
  check("isopulse: tone windows exist", loud > 20, loud);
  let silent = 0, total = 0;
  const start = Math.floor(0.2 * GE.SAMPLE_RATE), end = Math.floor(1.8 * GE.SAMPLE_RATE);
  for (let i = start; i < end; i++) { total++; if (Math.abs(L[i]) < 1e-6) silent++; }
  const frac = silent / total;
  check("isopulse: ~50% duty (silent fraction 0.42-0.56)", frac > 0.42 && frac < 0.56, frac.toFixed(3));
}

/* ---------- 3. isopulse ALT: the tone pans between L and R each half-cycle ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_ISOPULSE_ALT, entries: [{ duration: 2, basefreq: 300, beat: 4, volL: 1, volR: 1 }] }]);
  e.paused = false;
  const { L, R } = render(e, 2.0);
  const win = Math.floor(GE.SAMPLE_RATE / 40); // 25 ms windows
  let hi = 0, lo = 0, mid = 0;
  for (let i = 0; i + win < L.length; i += win) {
    const rl = rms(L, i, i + win), rr = rms(R, i, i + win);
    const ratio = rl / (rl + rr + 1e-12);
    if (ratio > 0.7) hi++; else if (ratio < 0.3) lo++; else mid++;
  }
  check("isopulse-alt: tone alternates L/R (hi/lo windows, few mid)", hi > 20 && lo > 20 && mid <= 20,
        "hi=" + hi + " lo=" + lo + " mid=" + mid);
}

/* ---------- 4. pink noise: present, bounded, not constant ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_PINK, entries: [{ duration: 3, volL: 0.5, volR: 0.5 }] }]);
  e.paused = false;
  const { L, R } = render(e, 2.0);
  let max = 0, nonZero = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]); if (a > max) max = a; if (L[i] !== 0) nonZero++; }
  const r = rms(L, 0, L.length);
  check("pink: signal present + bounded", nonZero > L.length * 0.99 && max <= 1 && r > 0.001 && r < 0.8, "max=" + max.toFixed(3) + " rms=" + r.toFixed(4));
  let differs = false;
  for (let i = 0; i < 1000; i++) if (L[i] !== R[i]) { differs = true; break; }
  check("pink: L/R decorrelated", differs);
}

/* ---------- 5. calibration semantics (spreads, wrap-around, fix) ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([
    { type: GE.VOICE_BINAURAL, entries: [
      { duration: 10, volL: 1.0, basefreq: 200, beat: 4 },
      { duration: 10, volL: 0.5, basefreq: 220, beat: 8 }
    ] },
    { type: GE.VOICE_BINAURAL, entries: [{ duration: 10, volL: 0.4, basefreq: 300, beat: 2 }] }
  ]);
  const v = e.voices[0];
  check("calibrate: spread = next-start minus start", Math.abs(v.entries[0].volL_spread - (-0.5)) < 1e-9 &&
        Math.abs(v.entries[0].basefreq_spread - 20) < 1e-9 && Math.abs(v.entries[0].beatfreq_spread_HALF - 2) < 1e-9,
        [v.entries[0].volL_spread, v.entries[0].basefreq_spread, v.entries[0].beatfreq_spread_HALF]);
  check("calibrate: last entry wraps to entry 0 start",
        Math.abs(v.entries[1].volL_end - 1.0) < 1e-9 && Math.abs(v.entries[1].basefreq_end - 200) < 1e-9);
  check("calibrate: absStart/absEnd chain", v.entries[0].absStart === 0 &&
        v.entries[0].absEnd === 441000 && v.entries[1].absStart === 441000 && v.entries[1].absEnd === 882000,
        [v.entries[0].absStart, v.entries[0].absEnd, v.entries[1].absStart, v.entries[1].absEnd]);
  check("calibrate: totalDuration = max voice", e.duration() === 20);
  const v2 = e.voices[1];
  check("fix: shorter voice extended to 20 s", Math.abs(v2.entries[0].duration - 20) < 1e-9, v2.entries[0].duration);
  check("fix: extended voice absEnd = 882000", v2.entries[0].absEnd === 882000, v2.entries[0].absEnd);
}

/* ---------- 6. completion + loop count ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_BINAURAL, entries: [{ duration: 0.05, basefreq: 200, beat: 4, volL: 1, volR: 1 }] }]);
  e.paused = false;
  const { completed } = render(e, 2.0);
  check("completion: flags COMPLETED after loops exhausted", completed && e.completed && (e.infoFlag & GE.FLAG_COMPLETED));

  const e2 = new GE.Engine();
  e2.setSchedule([{ type: GE.VOICE_BINAURAL, entries: [{ duration: 0.05, basefreq: 200, beat: 4, volL: 1, volR: 1 }] }]);
  e2.loops = Infinity; e2.paused = false;
  const r2 = render(e2, 0.5);
  check("loops=Infinity: never completes", !r2.completed && !e2.completed && (e2.infoFlag & GE.FLAG_NEWLOOP));
}

/* ---------- 7. muted voice + mono/stereo-swap plumbing ---------- */
{
  const e = new GE.Engine();
  e.setSchedule([{ type: GE.VOICE_BINAURAL, mute: true, entries: [{ duration: 1, basefreq: 200, beat: 4 }] }]);
  e.paused = false;
  const { L } = render(e, 0.5);
  check("mute: silent output", rms(L, 0, L.length) === 0);

  const e3 = new GE.Engine();
  e3.setSchedule([{ type: GE.VOICE_BINAURAL, entries: [{ duration: 1, basefreq: 220, beat: 4, volL: 1, volR: 0 }] }]);
  e3.mono = true; e3.paused = false;
  const r3 = render(e3, 0.2);
  let same = true;
  for (let i = 0; i < r3.L.length; i++) if (Math.abs(r3.L[i] - r3.R[i]) > 1e-7) { same = false; break; }
  check("mono: channels identical after mono mix", same);
}

/* ---------- white / brown noise voices (extension types 7 and 8) ---------- */
{
  function noiseStats(type) {
    const e = new GE.Engine();
    e.setSchedule([{ type: type, entries: [{ duration: 30, volL: 1, volR: 1, basefreq: 200, beat: 4 }] }]);
    e.paused = false;
    const N = GE.SAMPLE_RATE * 30;
    const L = new Float32Array(N), R = new Float32Array(N);
    let off = 0;
    while (off < N) {
      const n = Math.min(4096, N - off);
      const bl = new Float32Array(n), br = new Float32Array(n);
      e.render(bl, br, n);
      L.set(bl, off); R.set(br, off); off += n;
    }
    let rms = 0, peak = 0, num = 0, aut = 0, hf = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      rms += L[i] * L[i];
      if (Math.abs(L[i]) > peak) peak = Math.abs(L[i]);
      num += L[i] * R[i];
      if (i) aut += L[i] * L[i - 1];
      /* crude high-frequency residue: 1-pole lowpass at ~300 Hz subtracted */
      lp = lp + 0.04 * (L[i] - lp);
      hf += (L[i] - lp) * (L[i] - lp);
    }
    rms = Math.sqrt(rms / N);
    return { rms: rms, peak: peak, corr: num / N / (rms * rms), autocorr: aut / (N - 1) / (rms * rms),
             hfRatio: Math.sqrt(hf / N) / rms };
  }
  const white = noiseStats(GE.VOICE_WHITE);
  const brown = noiseStats(GE.VOICE_BROWN);
  const pink = noiseStats(GE.VOICE_PINK);
  check("white noise: sane level (rms 0.10-0.20 at vol 1)", white.rms > 0.10 && white.rms < 0.20, white.rms.toFixed(4));
  check("brown noise: sane level (rms 0.10-0.20 at vol 1)", brown.rms > 0.10 && brown.rms < 0.20, brown.rms.toFixed(4));
  check("white/brown match pink's level within 15%",
    Math.abs(white.rms - pink.rms) / pink.rms < 0.15 && Math.abs(brown.rms - pink.rms) / pink.rms < 0.15,
    [white.rms.toFixed(4), brown.rms.toFixed(4), pink.rms.toFixed(4)]);
  check("white noise stays under full scale", white.peak < 0.6, white.peak.toFixed(4));
  check("white and brown are not channel-identical (independent generators)",
    Math.abs(white.corr) < 0.05 && Math.abs(brown.corr) < 0.05, [white.corr.toFixed(4), brown.corr.toFixed(4)]);
  check("white is spectrally flat (no sample-to-sample correlation)", Math.abs(white.autocorr) < 0.05, white.autocorr.toFixed(4));
  check("brown is heavily low-frequency dominated (autocorr > 0.9)", brown.autocorr > 0.9, brown.autocorr.toFixed(4));
  check("spectral ordering white > pink > brown (high-frequency residue)",
    white.hfRatio > pink.hfRatio && pink.hfRatio > brown.hfRatio,
    [white.hfRatio.toFixed(4), pink.hfRatio.toFixed(4), brown.hfRatio.toFixed(4)]);
  check("noise voices produce no NaN", !isNaN(white.rms) && !isNaN(brown.rms));
  /* determinism: same seed -> same first samples */
  function firstSamples(type) {
    const e = new GE.Engine();
    e.setSchedule([{ type: type, entries: [{ duration: 1, volL: 1, volR: 1, basefreq: 200, beat: 4 }] }]);
    e.paused = false;
    const bl = new Float32Array(64), br = new Float32Array(64);
    e.render(bl, br, 64);
    return Array.from(bl).map(x => x.toFixed(8)).join(",");
  }
  check("noise generation is deterministic for a given seed", firstSamples(GE.VOICE_WHITE) === firstSamples(GE.VOICE_WHITE));
  check("white and brown differ sample-for-sample", firstSamples(GE.VOICE_WHITE) !== firstSamples(GE.VOICE_BROWN));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
