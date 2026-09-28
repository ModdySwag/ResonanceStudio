/* Node tests for the visualizer maths kernel (vizmath.js).
 * Run:  node vizmath.test.js      (from site/resonance/app/)
 *
 * The load-bearing claim under test: the visualizer's picture of each voice
 * (parameters, isochronic gate phase, binaural envelope phase) reproduces the
 * ENGINE'S OWN internal state exactly — verified directly against
 * engine.js's phase counter arithmetic and, where possible, against rendered
 * audio.
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "engine.js"), "utf8"));
const GE = globalThis.GnauralEngine;
eval(fs.readFileSync(path.join(__dirname, "vizmath.js"), "utf8"));
const VM = globalThis.GnauralVizMath;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function makeEngine(spec) {
  const e = new GE.Engine();
  e.setSchedule(spec);
  e.loops = Infinity;
  e.reset();
  e.paused = false;
  return e;
}
function close(a, b, tol) { return Math.abs(a - b) <= tol; }

/* ---------- 1. Cursor sampling == engine internal values on 16-sample tick ---------- */
{
  const spec = [
    { type: GE.VOICE_BINAURAL, entries: [
      { duration: 3, volL: 0.0, volR: 0.0, basefreq: 140, beat: 2 },
      { duration: 3, volL: 0.4, volR: 0.4, basefreq: 200, beat: 10 },
      { duration: 4, volL: 0.2, volR: 0.3, basefreq: 300, beat: 4 }] },
    { type: GE.VOICE_ISOPULSE, entries: [
      { duration: 5, volL: 0.3, volR: 0.3, basefreq: 300, beat: 4 },
      { duration: 5, volL: 0.1, volR: 0.1, basefreq: 220, beat: 7.83 }] }
  ];
  const eng = makeEngine(spec);
  const cursors = eng.voices.map(v => new VM.Cursor(v));
  const L = new Float32Array(16), R = new Float32Array(16);
  let worst = 0, ticks = 0;
  for (let c = 0; c < 4 * GE.SAMPLE_RATE / 16; c++) {
    eng.render(L, R, 16);
    const cs = eng.currentSample - 16;
    eng.voices.forEach((v, i) => {
      const p = cursors[i].sampleAt(cs);
      const d = Math.max(Math.abs(p.baseHz - v.curBasefreq), Math.abs(p.beatHz - v.curBeatfreq),
                         Math.abs(p.volL - v.curVolL), Math.abs(p.volR - v.curVolR));
      if (d > worst) worst = d;
      ticks++;
    });
  }
  check("cursor: reproduces engine parameters exactly on every tick (4 s, ramps included)", worst === 0, worst);
  check("cursor: tick count sane", ticks === 4 * GE.SAMPLE_RATE / 16 * 2, ticks);
}

/* ---------- 2. GateMirror == engine phase counter, zero divergence ---------- */
{
  const spec = [{ type: GE.VOICE_ISOPULSE, entries: [
    { duration: 30, volL: 0.5, volR: 0.5, basefreq: 300, beat: 10 },
    { duration: 30, volL: 0.5, volR: 0.5, basefreq: 300, beat: 4 }] },
    { type: GE.VOICE_ISOPULSE, entries: [
      { duration: 60, volL: 0.4, volR: 0.4, basefreq: 250, beat: 7.83 }] }];
  const eng = makeEngine(spec);
  const cur = new VM.Cursor(eng.voices[0]), cur2 = new VM.Cursor(eng.voices[1]);
  const m1 = new VM.GateMirror(), m2 = new VM.GateMirror();
  const L = new Float32Array(16), R = new Float32Array(16);
  let bad = 0, flips = 0, prevFlag = 0;
  const chunks = 20 * GE.SAMPLE_RATE / 16;
  for (let c = 0; c < chunks; c++) {
    const from = eng.currentSample;
    eng.render(L, R, 16);
    const to = eng.currentSample;
    m1.advance(cur, from, to); m2.advance(cur2, from, to);
    const v1 = eng.voices[0], v2 = eng.voices[1];
    if (m1.count !== v1.phaseSampleCount || m1.start !== v1.phaseSampleCountStart || m1.flag !== v1.phaseFlag) bad++;
    if (m2.count !== v2.phaseSampleCount || m2.start !== v2.phaseSampleCountStart || m2.flag !== v2.phaseFlag) bad++;
    if (v1.phaseFlag !== prevFlag) { flips++; prevFlag = v1.phaseFlag; }
  }
  check("mirror: zero divergence from engine counters over 20 s ramping (2 voices)", bad === 0, bad);
  check("mirror: gate actually toggled during the run", flips > 300, flips);

  /* batching: advancing in one jump == advancing tick-by-tick */
  const m3 = new VM.GateMirror(), m4 = new VM.GateMirror();
  const c3 = new VM.Cursor(eng.voices[0]), c4 = new VM.Cursor(eng.voices[0]);
  m3.advance(c3, 0, 10 * GE.SAMPLE_RATE);
  for (let s = 0; s < 10 * GE.SAMPLE_RATE; s += 735) m4.advance(c4, s, Math.min(s + 735, 10 * GE.SAMPLE_RATE));
  const same = Math.abs(m3.count - m4.count) < 1e-9 && m3.start === m4.start && m3.flag === m4.flag;
  check("mirror: one big step == many small steps", same, { a: [m3.count, m3.flag], b: [m4.count, m4.flag] });
}

/* ---------- 3. Gate parity: phase < 0.5 <=> engine flag 0 (gate open) ---------- */
{
  const spec = [{ type: GE.VOICE_ISOPULSE, entries: [{ duration: 8, volL: 0.5, volR: 0.5, basefreq: 300, beat: 4 }] }];
  const eng = makeEngine(spec);
  const cur = new VM.Cursor(eng.voices[0]);
  const m = new VM.GateMirror();
  const L = new Float32Array(16), R = new Float32Array(16);
  let agree = 0, tot = 0, openSamples = 0;
  for (let c = 0; c < 8 * GE.SAMPLE_RATE / 16; c++) {
    const from = eng.currentSample;
    eng.render(L, R, 16);
    m.advance(cur, from, eng.currentSample);
    const ph = m.phase();
    const openPredict = ph < 0.5;
    const openEngine = eng.voices[0].phaseFlag === 0;
    if (openPredict === openEngine) agree++; else { /* any disagreement would be fatal */ }
    tot++;
    if (openEngine) openSamples += 16;
  }
  check("parity: mirror phase < 0.5 matches engine open flag everywhere", agree === tot, { agree, tot });
  check("parity: ~50% duty over the run", close(openSamples / (8 * GE.SAMPLE_RATE), 0.5, 0.01), openSamples / (8 * GE.SAMPLE_RATE));
}

/* ---------- 4. EnvPhase: trapezoid is exact on piecewise-linear beat ---------- */
{
  const spec = [{ type: GE.VOICE_BINAURAL, entries: [
    { duration: 7, volL: 0.4, volR: 0.4, basefreq: 200, beat: 1.5 },
    { duration: 7, volL: 0.4, volR: 0.4, basefreq: 200, beat: 10.25 }] }];
  const eng = makeEngine(spec);
  const cur = new VM.Cursor(eng.voices[0]);
  const N = 12 * GE.SAMPLE_RATE;
  /* (a) exact continuous integral of the piecewise-linear rate: 1-sample trapezoids */
  let ref = 0;
  for (let s = 0; s < N; s++) {
    ref += (cur.sampleAt(s).beatHz + cur.sampleAt(s + 1).beatHz) / 2 / GE.SAMPLE_RATE;
  }
  /* (b) the engine's own blocky accumulation: each sample uses the beat of its 16-block */
  let refBlocky = 0;
  for (let s = 0; s < N; s++) refBlocky += cur.sampleAt(s - (s % 16)).beatHz / GE.SAMPLE_RATE;
  const ep = new VM.EnvPhase();
  let s2 = 0;
  while (s2 < N) { const to = Math.min(s2 + 735, N); ep.advance(cur, s2, to); s2 = to; }
  const dmod = (a, b) => { let d = Math.abs((a % 1) - (b % 1)); return d > 0.5 ? 1 - d : d; };
  const dExact = dmod(ep.phi, ref);
  check("envelope: == exact continuous integral (< 1e-9 cycles)", dExact < 1e-9, "d=" + dExact);
  const dBlocky = dmod(ep.phi, refBlocky);
  check("envelope: within 2.5e-3 cycles of the engine's blocky accumulation", dBlocky < 2.5e-3, "d=" + dBlocky);
}
{
  const spec = [{ type: GE.VOICE_BINAURAL, entries: [{ duration: 20, volL: 0.4, volR: 0.4, basefreq: 200, beat: 10 }] }];
  const eng = makeEngine(spec);
  const cur = new VM.Cursor(eng.voices[0]);
  const ep = new VM.EnvPhase();
  let s = 0;
  while (s < 10 * GE.SAMPLE_RATE) { const to = Math.min(s + 735, 10 * GE.SAMPLE_RATE); ep.advance(cur, s, to); s = to; }
  let d = Math.abs(ep.phi - 0); if (d > 0.5) d = 1 - d;   /* 10 Hz for 10 s = 100 exact cycles */
  check("envelope: constant 10 Hz for 10 s lands on phase 0", d < 1e-6, ep.phi);
}

/* ---------- 5. Strobe / safety maths ---------- */
check("strobe: 0.1 Hz not slowed", VM.strobeFactor(0.1) === 1);
check("strobe: 1 Hz not slowed (at the cap)", VM.strobeFactor(1) === 1);
check("strobe: 2 Hz shown 2x slower", VM.strobeFactor(2) === 2, VM.strobeFactor(2));
check("strobe: 10 Hz shown 10x slower", VM.strobeFactor(10) === 10, VM.strobeFactor(10));
check("strobe: 40 Hz shown 40x slower", VM.strobeFactor(40) === 40, VM.strobeFactor(40));
check("strobe: capped visible rate <= 1 Hz", VM.cappedRate(40) <= 1 && VM.cappedRate(7.83) <= 1);
check("strobe: flash cap constant exposed (1 Hz, EF + suite strict)", VM.FLASH_CAP_HZ === 1);

/* ---------- 6. Smoothing: frame-rate independent ---------- */
{
  let a = 0; a = VM.smooth(a, 1, 1 / 60, 0.09); a = VM.smooth(a, 1, 1 / 60, 0.09);
  let b = VM.smooth(0, 1, 2 / 60, 0.09);
  check("smooth: two 60 fps steps ~= one 30 fps step", Math.abs(a - b) < 2e-3, { a, b });
  check("smooth: alpha value sane (dt 16.7 ms, tau 90 ms)", close(VM.smoothAlpha(1 / 60, 0.09), 0.169, 0.003), VM.smoothAlpha(1 / 60, 0.09));
  const f1 = VM.follow(0, 1, 1 / 60, 0.06, 0.4);
  const f2 = VM.follow(0, 1, 1 / 60, 0.4, 0.06);
  check("follow: attack faster than release", f1 > f2, { attack: f1, release: f2 });
  let g = 0; for (let i = 0; i < 60; i++) g = VM.visualGate(g, true, 1 / 60, 0.09, 0.35);
  check("visualGate: open converges near 1 in 1 s", g > 0.99, g);
  let h = 1; for (let i = 0; i < 60; i++) h = VM.visualGate(h, false, 1 / 60, 0.09, 0.35);
  check("visualGate: closed releases slower than attack", h > 0.04 && h < 0.2, h);
}

/* ---------- 7. Analyser features on synthetic data ---------- */
{
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(128 + 64 * Math.sin(i * 0.37));
  check("rms: byte sine amplitude 0.5 -> ~0.354", close(VM.rmsFromBytes(bytes), 0.354, 0.02), VM.rmsFromBytes(bytes));
  const silence = new Uint8Array(512).fill(128);
  check("rms: constant 128 is silence", VM.rmsFromBytes(silence) === 0);

  const bins2048 = VM.bandBins(2048, 44100);
  const bw = 44100 / 2048;
  check("bands: sub band ~= 20-60 Hz bins", bins2048[0].from === Math.round(20 / bw) && bins2048[0].to === Math.round(60 / bw), bins2048[0]);
  check("bands: carrier band covers 250-700 Hz", bins2048[2].from === Math.round(250 / bw) && bins2048[2].to === Math.round(700 / bw), bins2048[2]);

  const fb = new Uint8Array(1024).fill(0);
  fb[15] = 255; fb[16] = 255;    /* energy around bin 15.5 -> ~334 Hz */
  const be = VM.bandEnergies(fb, bins2048);
  check("bands: energy lands in the carrier band", be.carrier > 0 && be.sub === 0 && be.air === 0, be);
  check("centroid: single peak -> ~ its frequency", close(VM.spectralCentroid(fb, 2048, 44100), 15.5 * bw, 25), VM.spectralCentroid(fb, 2048, 44100));

  const a1 = new Uint8Array(64).fill(10), a2 = new Uint8Array(64).fill(10); a2[5] = 200;
  check("flux: identical frames -> 0", VM.spectralFlux(a1, a1) === 0);
  check("flux: rising frame -> positive", VM.spectralFlux(a1, a2) > 0, VM.spectralFlux(a1, a2));
  check("flux: falling frame -> 0 (half-wave)", VM.spectralFlux(a2, a1) === 0, VM.spectralFlux(a2, a1));

  const x = [], y = [], z = [];
  for (let i = 0; i < 32; i++) { x.push(Math.sin(i)); y.push(Math.sin(i)); z.push(i % 2); }
  check("pearson: identical -> 1", close(VM.pearson(x, y), 1, 1e-9));
  check("pearson: negated -> -1", close(VM.pearson(x, x.map(v => -v)), -1, 1e-9));
  const zz = VM.pearson(x, z);
  check("pearson: unrelated bounded", zz > -0.6 && zz < 0.6, zz);
}

/* ---------- 8. PhaseMirror: analytic carrier phase vs rendered audio ---------- */
{
  const spec = [{ type: GE.VOICE_BINAURAL, entries: [
    { duration: 6, volL: 0.4, volR: 0.4, basefreq: 200, beat: 10 }] }];
  const eng = makeEngine(spec);
  const n = 6 * GE.SAMPLE_RATE;
  const L = new Float32Array(n), R = new Float32Array(n);
  eng.render(L, R, n);
  const cur = new VM.Cursor(eng.voices[0]);
  const pm = new VM.PhaseMirror(cur);
  let worst = 0;
  for (let j = 0; j < n; j += 61) {
    pm.advanceTo(j);
    const d = Math.max(Math.abs(pm.sinL() * VM.SC * 0.4 - L[j]),
                       Math.abs(pm.sinR() * VM.SC * 0.4 - R[j]));
    if (d > worst) worst = d;
  }
  check("phase: binaural carrier matches rendered audio (6 s, every 61st sample)", worst < 1e-4, "worst=" + worst);
  pm.advanceTo(n - 1);
  let d0 = Math.abs(pm.phiL); if (d0 > Math.PI) d0 = 2 * Math.PI - d0;
  check("phase: 205 Hz for 6 s lands near phase 0 (1230 exact cycles)", d0 < 0.05, pm.phiL);
  pm.reset(); pm.advanceTo(0);
  const s0 = Math.abs(pm.sinL() - Math.sin(205 * VM.SF));
  check("phase: reset() + advanceTo(0) == first-sample phase (advance-before-emit convention)", s0 < 1e-12, s0);
}
{
  const spec = [{ type: GE.VOICE_ISOPULSE, entries: [
    { duration: 4, volL: 0.5, volR: 0.5, basefreq: 300, beat: 10 }] }];
  const eng = makeEngine(spec);
  const n = 4 * GE.SAMPLE_RATE;
  const L = new Float32Array(n), R = new Float32Array(n);
  eng.render(L, R, n);
  const cur = new VM.Cursor(eng.voices[0]);
  const pm = new VM.PhaseMirror(cur);
  const NH = Math.floor(22050 / 10);
  function gateAt(k) {
    const h = Math.floor((k + 1) / NH);
    const m = k - (h * NH - (h > 0 ? 1 : 0));
    return (h % 2 === 0) ? Math.min(m / 100, 1) : Math.max(0, 1 - m / 100);
  }
  let worst = 0, worstSilent = 0, ramps = 0;
  for (let j = 0; j < n; j += 37) {
    pm.advanceTo(j);
    const g = gateAt(j);
    if (g === 1) {
      const d = Math.abs(pm.sinL() * VM.SC * 0.5 - L[j]);
      if (d > worst) worst = d;
    } else if (g === 0) {
      const d = Math.abs(L[j]);
      if (d > worstSilent) worstSilent = d;
    } else ramps++;
  }
  check("phase: iso carrier matches audio wherever the gate is fully open", worst < 1e-4, "worst=" + worst);
  check("phase: closed gate is exact silence in the audio", worstSilent < 1e-9, "worst=" + worstSilent);
  check("phase: iso run crossed ramp samples (gate model exercised)", ramps > 0, ramps);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
