/* Gnaural Web — AudioWorkletProcessor glue.
 *
 * Loaded by app.js and concatenated (engine.js + this file) into a Blob module,
 * so the engine code exists exactly once in the repo.  Runs on the audio thread.
 *
 * Protocol (main -> worklet):
 *   {t:"schedule", voices:[...], loops:Number}   replace schedule + reset to 0
 *   {t:"play"} / {t:"pause"}
 *   {t:"volume", l, r}                            engine overall volume (0..1)
 *   {t:"loop", loops}                             loops = 1 | Infinity
 * Worklet -> main (every ~200 ms of audio):
 *   {t:"pos", sample, total, completed, peakL, peakR,
 *    voices:[{base, beat, volL, volR}]}
 */
"use strict";

class GnauralProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    var E = globalThis.GnauralEngine;
    this.engine = new E.Engine();
    this.engine.paused = true;
    this.frames = 0;
    this.reportEvery = 4410 * 2; // ~200 ms @ 44.1 kHz
    this.port.onmessage = (ev) => this.onMessage(ev.data);
  }

  onMessage(m) {
    var e = this.engine;
    if (m.t === "schedule") {
      e.setSchedule(m.voices || []);
      if (m.loops !== undefined) { e.loops = m.loops; e.loopCount = m.loops; }
      e.reset();
      e.paused = true;
      this.post(true);
      return;
    }
    if (m.t === "play") { e.paused = false; return; }
    if (m.t === "pause") { e.paused = true; return; }
    if (m.t === "volume") {
      if (m.l !== undefined) e.volumeOverallL = m.l;
      if (m.r !== undefined) e.volumeOverallR = m.r;
      return;
    }
    if (m.t === "loop") { e.loops = m.loops; e.loopCount = m.loops; return; }
  }

  post(force) {
    var e = this.engine, vs = [];
    for (var i = 0; i < e.voices.length; i++) {
      var v = e.voices[i];
      vs.push({ base: v.curBasefreq || 0, beat: v.curBeatfreq || 0, volL: v.curVolL || 0, volR: v.curVolR || 0 });
    }
    this.port.postMessage({
      t: "pos",
      sample: e.currentSample,
      total: Math.floor(e.totalDuration * 44100),
      completed: e.completed,
      paused: e.paused,
      peakL: (e.peakL || 0) / 32768,
      peakR: (e.peakR || 0) / 32768,
      voices: vs
    });
    e.peakL = 0; e.peakR = 0;
  }

  process(inputs, outputs) {
    var out = outputs[0];
    var L = out[0];
    var R = out.length > 1 ? out[1] : out[0];
    this.engine.render(L, R, L.length);
    this.frames += L.length;
    if (this.frames >= this.reportEvery) { this.frames = 0; this.post(false); }
    return true; // keep alive
  }
}

registerProcessor("gnaural-processor", GnauralProcessor);
