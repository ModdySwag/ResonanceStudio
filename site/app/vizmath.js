/* Gnaural Web — visualizer maths kernel (pure, DOM-free, testable under Node).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * This file is the scientific core of the visualizer system. It answers one
 * question with the greatest accuracy the app can offer:
 *   "at this exact playback sample, what is every voice doing?"
 *
 * Two independent synchronisation paths, both verifiable:
 *
 *  1. THE SYNTHESIS IS KNOWN EXACTLY, SO THE VISUALS ARE LOCKED EXACTLY.
 *     - Voice parameters (carrier, beat, channel volumes) are sampled with a
 *       function that reproduces the engine's own 16-sample update block
 *       arithmetic (engine.render's periodic section) sample-for-sample.
 *     - The isochronic gate is tracked by a per-sample MIRROR of the engine's
 *       phase counter (count / rescale-on-rate-change / parity toggle). The
 *       mirror is arithmetic-identical to the engine, so it cannot drift.
 *       (A naive integral of rate*dt drifts ~0.05 cycles/minute when rates
 *       ramp; it was tested and rejected.)
 *     - The binaural beat envelope phase is integrated by the trapezoid rule
 *       on the beat rate, which is EXACT because the rate is piecewise linear
 *       between schedule entries.
 *
 *  2. WHAT IS NOT KNOWN EXACTLY (noise beds, master volume, muted states,
 *     imported files beyond the schedule) IS MEASURED from the audio graph's
 *     AnalyserNode: RMS, band energies, spectral centroid and flux, plus a
 *     live coherence score comparing the predicted gate envelope with the
 *     measured signal envelope (the "sync" number shown in the UI).
 *
 * Rules kept from engine.js: sample rate 44100 is fixed; a voice's entry is
 * "the last entry whose absEnd is below the sample" exactly as the engine's
 * while-loop decides; a hold means repeating the level, ramps are linear.
 *
 * Runs in browser and Node (no DOM, no imports; globalThis.GnauralVizMath).
 */
(function () {
  "use strict";

  var SR = 44100, SR2 = 22050;              /* engine fixed rate               */
  var SF = 2 * Math.PI / SR;                /* engine SAMPLE_FACTOR            */
  var SC = 16383 / 32768;                   /* engine SIN_SCALER / 32768       */
  /* Luminance-modulation cap. WCAG 2.2 SC 2.3.1 allows 3 general flashes/s;
   * the Epilepsy Foundation advises strobes stay under 2 Hz, and the project's
   * acceptance suite additionally caps mean-luminance sign changes at 2.2/s
   * (i.e. ~1.1 Hz of visible oscillation). Everything luminance-carried is
   * therefore divided down to <= 1 Hz. Faster source rates are shown as
   * slowed motion with an honest "xN slowed" label instead.               */
  var FLASH_CAP_HZ = 1;

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function clamp01(x) { return clamp(x, 0, 1); }

  /* =================================================================== *
   * Exact schedule sampling (mirror of engine.render's periodic block)
   * =================================================================== */

  /* Per-voice cursor: keeps the entry index monotonic so sampling stays O(1)
   * between entry changes; rewinds when the playback position jumps back
   * (loop wrap, stop, seek). */
  function Cursor(voice) { this.v = voice; this.j = 0; this.lastSample = 0; }

  Cursor.prototype.sampleAt = function (sample) {
    var v = this.v;
    if (!v || !v.entryCount) return null;
    if (sample < this.lastSample) this.j = 0;                 /* rewind  */
    var j = this.j;
    while (j < v.entryCount - 1 && sample > v.entries[j].absEnd) j++;
    while (j > 0 && sample < v.entries[j].absStart) j--;
    this.j = j; this.lastSample = sample;
    var e = v.entries[j];
    var factor = 0;
    if (e.duration !== 0) factor = (sample - e.absStart) / (e.duration * SR);
    return {
      entry: j,
      volL: e.volL_spread * factor + e.volL_start,
      volR: e.volR_spread * factor + e.volR_start,
      baseHz: e.basefreq_spread * factor + e.basefreq_start,
      beatHz: (e.beatfreq_spread_HALF * factor + e.beatfreq_start_HALF) * 2
    };
  };

  /* =================================================================== *
   * Isochronic gate phase mirror — per-sample arithmetic copy of the
   * engine's phaseSampleCount countdown, including the rescale-on-rate-
   * change rule (fraction preserved) and the <1 toggle threshold.
   * =================================================================== */

  function GateMirror() {
    this.count = 1;      /* engine Voice.reset(): count = start = 1        */
    this.start = 1;
    this.flag = 0;       /* flag 0 = gate open (engine emits (1-env) first) */
    this.lastBeat = 0;   /* engine curBeatfreq starts at 0                 */
    this.lastSample = -1;
  }

  GateMirror.prototype.halfLen = function (beatHz) {
    return Math.floor(SR2 / (beatHz < 0.0001 ? 0.0001 : beatHz));
  };

  /* Advance the mirror from fromSample to toSample (exclusive), walking the
   * engine's 16-sample block grid. Block scheduling in engine.render():
   * a block runs before the k-th sample when k % 16 === 0 (verified). */
  GateMirror.prototype.advance = function (cursor, fromSample, toSample) {
    if (toSample <= fromSample) return this;
    var v = cursor.v;
    var k = fromSample;
    while (k < toSample) {
      if (k % 16 === 0) {
        var b = cursor.sampleAt(k).beatHz;
        if (b !== this.lastBeat) {                       /* rescale, fraction preserved */
          var pf = this.count / this.start;
          this.start = this.halfLen(b);
          this.count = this.start * pf;
          this.lastBeat = b;
        }
      }
      var segEnd = (k % 16 === 0) ? k + 16 : k + (16 - (k % 16));
      if (segEnd > toSample) segEnd = toSample;
      var n = segEnd - k;
      if (this.count - n >= 1) {
        this.count -= n;                                  /* no toggle inside */
      } else {
        for (var i = 0; i < n; i++) {                     /* toggle walk      */
          if (1 > --this.count) { this.count = this.start; this.flag = this.flag ? 0 : 1; }
        }
      }
      k = segEnd;
    }
    this.lastSample = toSample;
    return this;
  };

  /* Fractional position inside the half-cycle, 1 -> 0 across the countdown. */
  GateMirror.prototype.halfFrac = function () { return 1 - this.count / this.start; };

  /* Cycle phase in [0,1): 0..0.5 = gate OPEN, 0.5..1 = closed. */
  GateMirror.prototype.phase = function () {
    return (this.halfFrac() / 2 + (this.flag ? 0.5 : 0)) % 1;
  };

  GateMirror.prototype.open = function () { return this.flag === 0; };

  /* =================================================================== *
   * Envelope-phase integrator (binaural beat power envelope).
   * cos^2(pi * fb * t) has period 1/fb, so the phase advances at fb
   * cycles/second. Beat rate is piecewise linear, so the trapezoid rule
   * over each entry segment is exact.
   * =================================================================== */

  function EnvPhase() { this.phi = 0; }

  EnvPhase.prototype.advance = function (cursor, fromSample, toSample) {
    var v = cursor.v;
    if (!v || toSample <= fromSample) return this;
    var s = fromSample;
    while (s < toSample) {
      /* segment end: next entry boundary or toSample */
      var j = cursor.sampleAt(s).entry;
      var segEnd = Math.min(toSample, v.entries[j].absEnd + 1);
      if (segEnd <= s) segEnd = Math.min(toSample, s + 16);
      var b0 = cursor.sampleAt(s).beatHz;
      var b1 = cursor.sampleAt(segEnd).beatHz;
      this.phi = (this.phi + (b0 + b1) / 2 * (segEnd - s) / SR) % 1;
      s = segEnd;
    }
    return this;
  };

  /* =================================================================== *
   * Carrier phase mirror — the analytic phase of the engine's own sine
   * accumulators (sinPosL / sinPosR). The engine samples the frequency on
   * its 16-sample grid, then advances phase once per sample BEFORE
   * emitting, so sample k carries phase (k+1)*f*SF. The mirror walks the
   * same blocks and counts the same increments; for a full 16-sample run
   * the multiply is IEEE-exact (16*x == x added sixteen times when x is a
   * float64 product), so this stays locked to the carrier indefinitely.
   * Lets the scope/phasor/lissajous draw the real carrier with no
   * analyser and no FFT latency.
   * =================================================================== */

  function PhaseMirror(cursor) {
    this.c = cursor;
    this.phiL = 0; this.phiR = 0;   /* radians in [0, 2pi)               */
    this.m = -1;                    /* last sample index applied         */
  }

  PhaseMirror.prototype.reset = function () {
    this.phiL = 0; this.phiR = 0; this.m = -1;
    return this;
  };

  /* Advance so that phiL/phiR are the phases OF sample `sample`. */
  PhaseMirror.prototype.advanceTo = function (sample) {
    var TWO_PI = 2 * Math.PI;
    while (this.m < sample) {
      var m = this.m + 1;
      var kb = m - (m % 16);                        /* its update block      */
      var segEnd = Math.min(sample, kb + 15);       /* last m with same f    */
      var s = this.c.sampleAt(kb);
      var n = segEnd - m + 1;
      /* The +/-beat/2 frequency split exists ONLY on binaural voices (engine
       * type 0); iso / iso-alt carriers run at the bare basefreq on both
       * channels and use their "beat" as the gate rate, not a frequency. */
      var half = (this.c.v && this.c.v.type === 0) ? s.beatHz / 2 : 0;
      this.phiL = (this.phiL + n * (s.baseHz + half) * SF) % TWO_PI;
      this.phiR = (this.phiR + n * (s.baseHz - half) * SF) % TWO_PI;
      this.m = segEnd;
    }
    return this;
  };

  /* Sine values of the carrier pair (-1..1). */
  PhaseMirror.prototype.sinL = function () { return Math.sin(this.phiL); };
  PhaseMirror.prototype.sinR = function () { return Math.sin(this.phiR); };

  /* =================================================================== *
   * Motion safety: stroboscopic slow-down factor. Luminance may never
   * modulate faster than FLASH_CAP_HZ (1 Hz, EF-strict); faster source
   * rates are shown as slowed motion with an honest label instead.
   * =================================================================== */
  function strobeFactor(rateHz) {
    if (!(rateHz > 0)) return 1;
    return Math.max(1, Math.ceil(rateHz / FLASH_CAP_HZ));
  }
  /* The visible modulation frequency once the cap is applied. */
  function cappedRate(rateHz) {
    return rateHz / strobeFactor(rateHz);
  }

  /* =================================================================== *
   * Frame-rate independent smoothing (one-pole), tau in seconds.
   * =================================================================== */
  function smoothAlpha(dt, tau) { return 1 - Math.exp(-dt / Math.max(1e-4, tau)); }
  function smooth(prev, next, dt, tau) { return prev + (next - prev) * smoothAlpha(dt, tau); }

  /* Attack/release envelope follower (asymmetric one-pole). */
  function follow(prev, x, dt, attackTau, releaseTau) {
    var tau = x > prev ? attackTau : releaseTau;
    return prev + (x - prev) * smoothAlpha(dt, tau);
  }

  /* =================================================================== *
   * Analyser feature extraction (works on the byte arrays the browser
   * gives us: getByteTimeDomainData / getByteFrequencyData).
   * =================================================================== */

  /* RMS of a byte time-domain buffer, 0..1 (1 = full-scale sine). */
  function rmsFromBytes(bytes) {
    var acc = 0;
    for (var i = 0; i < bytes.length; i++) { var x = (bytes[i] - 128) / 128; acc += x * x; }
    return Math.sqrt(acc / Math.max(1, bytes.length));
  }

  /* Logarithmic band edges (Hz), matched to what this app synthesises. */
  var AUDIO_BANDS = [
    { id: "sub", from: 20, to: 60 },       /* brown noise rumble, 50 Hz carriers  */
    { id: "low", from: 60, to: 250 },      /* low carriers                        */
    { id: "carrier", from: 250, to: 700 }, /* the apps's usual carrier band       */
    { id: "mid", from: 700, to: 2000 },    /* upper carriers                      */
    { id: "air", from: 2000, to: 8000 }    /* hiss / white-noise character         */
  ];

  /* Bin ranges for a linear FFT of fftSize at sampleRate. */
  function bandBins(fftSize, sampleRate) {
    var bw = sampleRate / fftSize;
    var out = [];
    for (var i = 0; i < AUDIO_BANDS.length; i++) {
      var b = AUDIO_BANDS[i];
      var lo = Math.max(1, Math.round(b.from / bw));
      var hi = Math.min(fftSize / 2 - 1, Math.round(b.to / bw));
      out.push({ id: b.id, from: lo, to: hi });
    }
    return out;
  }

  /* Mean energy per band from a byte frequency array, 0..1 scaled. */
  function bandEnergies(freqBytes, bins) {
    var out = {};
    for (var i = 0; i < bins.length; i++) {
      var b = bins[i], acc = 0, n = 0;
      for (var j = b.from; j <= b.to; j++) { acc += freqBytes[j]; n++; }
      out[b.id] = n ? (acc / n) / 255 : 0;
    }
    return out;
  }

  /* Spectral centroid in Hz from a byte frequency array. */
  function spectralCentroid(freqBytes, fftSize, sampleRate) {
    var num = 0, den = 0;
    var bw = sampleRate / fftSize;
    for (var i = 1; i < freqBytes.length; i++) {
      num += i * bw * freqBytes[i];
      den += freqBytes[i];
    }
    return den > 0 ? num / den : 0;
  }

  /* Half-wave rectified spectral flux between two byte frequency arrays. */
  function spectralFlux(prev, cur) {
    var acc = 0;
    for (var i = 0; i < cur.length; i++) { var d = (cur[i] - prev[i]) / 255; if (d > 0) acc += d; }
    return acc / Math.max(1, cur.length);
  }

  /* Pearson correlation of two equal-length numeric arrays. */
  function pearson(x, y) {
    var n = Math.min(x.length, y.length);
    if (n < 4) return 0;
    var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
    var den = Math.sqrt(Math.max(1e-12, (n * sxx - sx * sx) * (n * syy - sy * sy)));
    return (n * sxy - sx * sy) / den;
  }

  /* =================================================================== *
   * Gate shape for drawing: the audible gate is a hard switch (engine
   * ramps its own envelope over 100 samples); the VISUAL envelope is
   * deliberately slower (attack/release in seconds) so no mode can flash
   * at audio speed. Returns 0..1.
   * =================================================================== */
  function visualGate(prev, open, dt, attackTau, releaseTau) {
    return follow(prev, open ? 1 : 0, dt, attackTau, releaseTau);
  }

  var api = {
    SR: SR,
    SF: SF,
    SC: SC,
    FLASH_CAP_HZ: FLASH_CAP_HZ,
    Cursor: Cursor,
    GateMirror: GateMirror,
    EnvPhase: EnvPhase,
    PhaseMirror: PhaseMirror,
    AUDIO_BANDS: AUDIO_BANDS,
    bandBins: bandBins,
    bandEnergies: bandEnergies,
    rmsFromBytes: rmsFromBytes,
    spectralCentroid: spectralCentroid,
    spectralFlux: spectralFlux,
    pearson: pearson,
    smooth: smooth,
    smoothAlpha: smoothAlpha,
    follow: follow,
    visualGate: visualGate,
    strobeFactor: strobeFactor,
    cappedRate: cappedRate,
    clamp: clamp,
    clamp01: clamp01
  };

  if (typeof globalThis !== "undefined") globalThis.GnauralVizMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
