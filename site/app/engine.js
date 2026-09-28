/* Gnaural Web — synthesis engine.
 *
 * Faithful port of the Gnaural scheduling/synthesis core.
 *   Gnaural engine — Copyright (C) 2008 Bret Logan — LGPL-2.1-or-later
 *   Upstream: gnaural.sourceforge.net  (BinauralBeat.c, 1.0.20110606)
 *
 * This is a re-implementation in JavaScript of the upstream engine's algorithm
 * and file semantics, written from the published source. The upstream engine is
 * LGPL-2.1-or-later, so this port is distributed under the same terms
 * (licence text: COPYING.LESSER). All other gnaural-web files are
 * GPL-2.0-or-later. See NOTICE.txt.
 *
 * Ported voice types:
 *   0 BINAURALBEAT  — two sines, L = base + beat/2, R = base − beat/2 (beat heard in the brain)
 *   1 PINKNOISE     — the upstream 31/32 lopass pink-noise approximation
 *   3 ISOPULSE      — isochronic tones (tone/silence alternating at the beat frequency)
 *   4 ISOPULSE_ALT  — isochronic tones alternating between L and R each half-cycle
 * Not ported in v1: 2 (PCM file loops), 5 (waterdrops), 6 (rain).
 *
 * Fidelity notes (deliberate, documented):
 *  - Envelope/entry recalculation happens every UPDATE_PERIOD_SAMPLES = 16 samples and the
 *    sample counter advances in 16-sample steps, exactly as upstream.
 *  - Upstream casts the mixed float to signed 16-bit (wrap-around on overflow); we clamp
 *    to [-1, 1] instead, which is the only behavioural deviation.
 *  - Output is float (Web Audio); upstream 16-bit scale (SIN_SCALER = 0x3FFF) is kept
 *    internally so preset volumes mean the same thing.
 *
 * Runs unchanged in three places: browser main thread, AudioWorklet global scope,
 * and Node (tests) — no DOM, no imports, no globals besides GnauralEngine.
 */
(function () {
  "use strict";

  var SAMPLE_RATE = 44100;
  var TWO_PI = Math.PI * 2;
  var SAMPLE_FACTOR = TWO_PI / 44100;      // == 2*PI/sample_rate  (upstream BB_SAMPLE_FACTOR)
  var SAMPLERATE_HALF = 22050;             // 0.5 * sample rate
  var SIN_SCALER = 0x3FFF;                 // 16383: upstream scales sin() output to a short
  var UPDATE_PERIOD_SAMPLES = 16;          // upstream BB_UPDATEPERIOD_SAMPLES

  var VOICE_BINAURAL = 0;
  var VOICE_PINK = 1;
  var VOICE_PCM = 2;
  var VOICE_ISOPULSE = 3;
  var VOICE_ISOPULSE_ALT = 4;
  /* Extensions beyond upstream's playable set. Upstream reserves 5 (waterdrops)
   * and 6 (rain) for sample-based ambience we do not port; 7 and 8 are ours.
   * Both are calibrated to the pink voice's measured level (raw RMS 4773 at
   * vol 1, i.e. float RMS 0.1457 after the /32767 scale), so a bed written at
   * a given volume sounds equally loud whichever colour is chosen. Files using
   * 7/8 play here; other Gnaural builds will report them as unsupported. */
  var VOICE_WHITE = 7;
  var VOICE_BROWN = 8;
  var WHITE_SCALE = 8267;     // uniform [-1,1) * this = raw RMS 4773
  var BROWN_GAIN = 9.86;      // leaky-integrated white * this = raw RMS 4773
  var BROWN_LEAK = 0.02;      // integrator input gain (pole 1/(1+LEAK))

  var FLAG_COMPLETED = 1;
  var FLAG_NEWLOOP = 2;
  var FLAG_NEWENTRY = 4;

  function num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }
  function clamp1(x) {
    return x > 1 ? 1 : (x < -1 ? -1 : x);
  }

  /* ------------------------------------------------------------------ *
   * Deterministic pseudo-random generator (upstream BB_Rand, 32-bit
   * Windows semantics: xorshift + multiply-with-carry).
   * ------------------------------------------------------------------ */
  function XorRandom() {
    this.mcgn = 3677;
    this.srgn = 127;
  }
  XorRandom.prototype.rand = function () {
    var r0, r1, r0b;
    r0 = this.srgn >>> 15;
    r1 = (this.srgn ^ r0) | 0;
    r0b = r1 << 17;
    this.srgn = (r0b ^ r1) | 0;
    this.mcgn = (Math.imul(69069, this.mcgn) | 0);
    return ((this.mcgn ^ this.srgn) | 0);
  };
  /* Upstream BB_LoPass: a heavy one-pole lowpass used for the pink approximation. */
  function loPass(state, value) {
    return ((((state.n * 31) + value) >> 5) | 0);
  }

  /* ------------------------------------------------------------------ *
   * Entry (upstream BB_EventData): one schedule segment of a voice.
   * Authoring fields (what presets provide):
   *    duration          seconds
   *    volL, volR        0..1 channel volumes at segment start
   *    basefreq          Hz at segment start
   *    beatfreqHalf      Hz/2 at segment start (upstream stores half; beat = 2*half)
   * The segment *ends* at the next entry's start values (last entry wraps to entry 0),
   * exactly like upstream BB_CalibrateVoice.
   * ------------------------------------------------------------------ */
  function Entry(spec) {
    spec = spec || {};
    this.duration = num(spec.duration, 1);
    this.volL_start = num(spec.volL, 1);
    this.volR_start = num(spec.volR, this.volL_start);
    this.basefreq_start = num(spec.basefreq, 200);
    this.beatfreq_start_HALF = num(spec.beatHalf, num(spec.beat, 4) / 2);
    /* computed by calibrate(): */
    this.volL_end = 0; this.volR_end = 0;
    this.volL_spread = 0; this.volR_spread = 0;
    this.basefreq_end = 0; this.basefreq_spread = 0;
    this.beatfreq_end_HALF = 0; this.beatfreq_spread_HALF = 0;
    this.absStart = 0; this.absEnd = 0;
  }

  /* ------------------------------------------------------------------ *
   * Voice (upstream BB_VoiceData).
   * ------------------------------------------------------------------ */
  function Voice(type, entries, opts) {
    opts = opts || {};
    this.type = type | 0;
    this.mute = !!opts.mute;
    this.mono = !!opts.mono;
    this.entries = (entries || []).map(function (e) {
      return (e instanceof Entry) ? e : new Entry(e);
    });
    this.entryCount = this.entries.length;
    this.totalDuration = 0;
    this.reset();
  }
  Voice.prototype.reset = function () {
    /* upstream BB_InitVoices defaults */
    this.curEntry = 0;
    this.curVolL = 0; this.curVolR = 0;
    this.curBasefreq = 0; this.curBeatfreq = 0;
    this.curBeatfreqLFactor = 0; this.curBeatfreqRFactor = 0;
    this.phaseSampleCount = 1; this.phaseSampleCountStart = 1;
    this.phaseFlag = 0; this.phaseEnvelope = 0;
    this.sinPosL = 0; this.sinPosR = 0;
    this.sinL = 0; this.sinR = 0;
    this.noise = { n: 1 }; this.noiseR = { n: 1 };
    this.brown = 0; this.brownR = 0;
  };

  /* ------------------------------------------------------------------ *
   * Engine (upstream BB_MainLoop + calibration + reset).
   * ------------------------------------------------------------------ */
  function Engine() {
    this.voices = [];
    this.totalDuration = 0;
    this.currentSample = 0;
    this.currentSampleLooped = 0;
    this.loopCount = 1;
    this.loops = 1;                 // 1 = play once; Infinity = loop forever
    this.updatePeriod = 1;          // upstream: static int, initialised to 1
    this.completed = false;
    this.infoFlag = 0;
    this.volumeOverallL = 1;
    this.volumeOverallR = 1;
    this.mono = false;
    this.stereoSwap = false;
    this.paused = true;
    this.peakL = 0; this.peakR = 0;
    this.rng = new XorRandom();
  }

  /* Replace the schedule. voicesSpec: [{type, mute, mono, entries:[...]}, ...] */
  Engine.prototype.setSchedule = function (voicesSpec) {
    this.voices = (voicesSpec || []).map(function (v) {
      return new Voice(v.type, v.entries, v);
    });
    this.currentSample = 0;
    this.updatePeriod = 1;
    this.calibrate();
    this.reset();
    return this;
  };

  /* upstream BB_CalibrateVoice, applied to every voice, then BB_FixVoiceDurations */
  Engine.prototype.calibrate = function () {
    var i, j, v, e, next, prev;
    this.totalDuration = 0;
    for (i = 0; i < this.voices.length; i++) {
      v = this.voices[i];
      v.totalDuration = 0;
      for (j = 0; j < v.entryCount; j++) {
        v.totalDuration += v.entries[j].duration;
        v.entries[j].absEnd = Math.floor(v.totalDuration * SAMPLE_RATE);
      }
      for (j = 0; j < v.entryCount; j++) {
        e = v.entries[j];
        next = (j + 1 >= v.entryCount) ? v.entries[0] : v.entries[j + 1];
        e.beatfreq_end_HALF = next.beatfreq_start_HALF;
        e.beatfreq_spread_HALF = e.beatfreq_end_HALF - e.beatfreq_start_HALF;
        e.basefreq_end = next.basefreq_start;
        e.basefreq_spread = e.basefreq_end - e.basefreq_start;
        e.volL_end = next.volL_start;
        e.volL_spread = e.volL_end - e.volL_start;
        e.volR_end = next.volR_start;
        e.volR_spread = e.volR_end - e.volR_start;
        prev = j - 1;
        e.absStart = (prev < 0) ? 0 : v.entries[prev].absEnd;
      }
      if (v.totalDuration > this.totalDuration) this.totalDuration = v.totalDuration;
    }
    /* upstream BB_FixVoiceDurations: extend shorter voices' last entry to match */
    for (i = 0; i < this.voices.length; i++) {
      v = this.voices[i];
      if (v.totalDuration < this.totalDuration && v.entryCount > 0) {
        v.entries[v.entryCount - 1].duration += (this.totalDuration - v.totalDuration);
        /* recompute this voice's absolute times after the extension */
        var acc = 0;
        for (j = 0; j < v.entryCount; j++) {
          acc += v.entries[j].duration;
          v.entries[j].absEnd = Math.floor(acc * SAMPLE_RATE);
          v.entries[j].absStart = (j === 0) ? 0 : v.entries[j - 1].absEnd;
        }
        v.totalDuration = acc;
      }
    }
    return this;
  };

  /* upstream BB_ResetAllVoices */
  Engine.prototype.resetAllVoices = function () {
    for (var i = 0; i < this.voices.length; i++) this.voices[i].curEntry = 0;
  };

  /* upstream BB_Reset */
  Engine.prototype.reset = function () {
    this.currentSample = 0;
    this.currentSampleLooped = 0;
    this.infoFlag &= ~FLAG_COMPLETED;
    this.loopCount = (this.loops === Infinity) ? Infinity : this.loops;
    this.completed = false;
    this.updatePeriod = 1;
    this.peakL = 0; this.peakR = 0;
    for (var i = 0; i < this.voices.length; i++) this.voices[i].reset();
    this.resetAllVoices();
    var r = this.rng; r.mcgn = 3677; r.srgn = 127;
  };

  /* ------------------------------------------------------------------ *
   * render(outL, outR, n) — the upstream BB_MainLoop, one sample at a time.
   * Fills two Float32Arrays with n samples. Returns {completed, flags}.
   * ------------------------------------------------------------------ */
  Engine.prototype.render = function (outL, outR, n) {
    /* Paused (or empty schedule): emit silence and HOLD position. This is a
       deliberate deviation from upstream, whose sample counter keeps advancing
       while its internal flag is set — for a user-facing pause we freeze. */
    if (this.paused || !this.voices.length) {
      for (var z = 0; z < n; z++) { outL[z] = 0; outR[z] = 0; }
      return { completed: false, flags: 0 };
    }
    var updateperiod = this.updatePeriod;
    var sumL, sumR, Sample_left, Sample_right;
    var voice, v, nv = this.voices.length;
    var k, i;
    var completedNow = false;

    for (k = 0; k < n; k++) {
      updateperiod--;
      sumL = 0; sumR = 0;

      if (!this.paused) {
        for (voice = 0; voice < nv; voice++) {
          v = this.voices[voice];
          Sample_left = 0; Sample_right = 0;

          /* ##### periodic (every 16 samples) ##### */
          if (updateperiod === 0) {
            while (v.curEntry >= v.entryCount) { this.resetAllVoices(); v.curEntry = 0; }

            /* if the sample count was moved before curEntry (rare) */
            while (this.currentSample < v.entries[v.curEntry].absStart) {
              this.infoFlag |= FLAG_NEWENTRY;
              if (--v.curEntry < 0) v.curEntry = 0;
            }
            /* advance curEntry past finished entries */
            while (this.currentSample > v.entries[v.curEntry].absEnd) {
              this.infoFlag |= FLAG_NEWENTRY;
              v.curEntry++;
              if (v.curEntry >= v.entryCount) {
                this.currentSampleLooped += this.currentSample;
                this.currentSample = 0;
                this.resetAllVoices();
                this.infoFlag |= FLAG_NEWLOOP;
                if (this.loops !== Infinity) {   /* Infinity set late still never completes */
                  this.loopCount--;
                  if (this.loopCount <= 0) {
                    this.infoFlag |= FLAG_COMPLETED;
                    this.completed = true;
                    completedNow = true;
                  }
                }
                break;
              }
            }

            if (!v.mute) {
              var entry = v.entries[v.curEntry];
              var factor = 0;
              if (entry.duration !== 0) {
                factor = (this.currentSample - entry.absStart) / (entry.duration * SAMPLE_RATE);
              }
              v.curVolL = (entry.volL_spread * factor) + entry.volL_start;
              v.curVolR = (entry.volR_spread * factor) + entry.volR_start;

              if (v.type === VOICE_BINAURAL) {
                v.curBasefreq = (entry.basefreq_spread * factor) + entry.basefreq_start;
                v.curBeatfreqLFactor = v.curBeatfreqRFactor = (entry.beatfreq_spread_HALF * factor);
                var oldBeat = v.curBeatfreq;
                var newBeat = v.curBeatfreq = (v.curBeatfreqLFactor + entry.beatfreq_start_HALF) * 2;
                v.curBeatfreqLFactor = (v.curBasefreq + entry.beatfreq_start_HALF + v.curBeatfreqLFactor) * SAMPLE_FACTOR;
                v.curBeatfreqRFactor = (v.curBasefreq - entry.beatfreq_start_HALF - v.curBeatfreqRFactor) * SAMPLE_FACTOR;
                if (newBeat < 0.0001) newBeat = 0.0001;
                if (oldBeat !== newBeat) {
                  var pf = v.phaseSampleCount / v.phaseSampleCountStart;
                  v.phaseSampleCountStart = Math.floor(SAMPLERATE_HALF / newBeat);
                  v.phaseSampleCount = v.phaseSampleCountStart * pf;
                }
              } else if (v.type === VOICE_PINK || v.type === VOICE_WHITE || v.type === VOICE_BROWN) {
                /* noise voices: nothing periodic to recompute */
              } else if (v.type === VOICE_ISOPULSE || v.type === VOICE_ISOPULSE_ALT) {
                v.curBasefreq = (entry.basefreq_spread * factor) + entry.basefreq_start;
                var oldB = v.curBeatfreq;
                v.curBeatfreq = ((entry.beatfreq_spread_HALF * factor) + entry.beatfreq_start_HALF) * 2;
                if (v.curBeatfreq < 0.0001) v.curBeatfreq = 0.0001;
                v.curBeatfreqRFactor = v.curBeatfreqLFactor = v.curBasefreq * SAMPLE_FACTOR;
                if (oldB !== v.curBeatfreq) {
                  var pf2 = v.phaseSampleCount / v.phaseSampleCountStart;
                  v.phaseSampleCountStart = Math.floor(SAMPLERATE_HALF / v.curBeatfreq);
                  v.phaseSampleCount = v.phaseSampleCountStart * pf2;
                }
              }
            }
          }
          /* ##### per-sample ##### */
          if (!v.mute) {
            if (v.type === VOICE_BINAURAL) {
              v.sinPosL += v.curBeatfreqLFactor;
              if (v.sinPosL >= TWO_PI) v.sinPosL -= TWO_PI;
              v.sinPosR += v.curBeatfreqRFactor;
              if (v.sinPosR >= TWO_PI) v.sinPosR -= TWO_PI;
              v.sinL = Math.sin(v.sinPosL);
              Sample_left = v.sinL * SIN_SCALER;
              v.sinR = Math.sin(v.sinPosR);
              Sample_right = v.sinR * SIN_SCALER;
              if (1 > --v.phaseSampleCount) {
                v.phaseSampleCount = v.phaseSampleCountStart;
                v.phaseFlag = v.phaseFlag ? 0 : 1;
                v.phaseEnvelope = 0;
              }
            } else if (v.type === VOICE_PINK) {
              var rl = this.rng.rand() >> 15, rr = this.rng.rand() >> 15;
              v.noise.n = loPass(v.noise, rl);
              Sample_left = v.noise.n;
              v.noiseR.n = loPass(v.noiseR, rr);
              Sample_right = v.noiseR.n;
            } else if (v.type === VOICE_WHITE) {
              Sample_left = (((this.rng.rand() >>> 16) / 32768) - 1) * WHITE_SCALE;
              Sample_right = (((this.rng.rand() >>> 16) / 32768) - 1) * WHITE_SCALE;
            } else if (v.type === VOICE_BROWN) {
              v.brown = (v.brown + (((this.rng.rand() >>> 16) / 32768) - 1) * WHITE_SCALE * BROWN_LEAK) / (1 + BROWN_LEAK);
              v.brownR = (v.brownR + (((this.rng.rand() >>> 16) / 32768) - 1) * WHITE_SCALE * BROWN_LEAK) / (1 + BROWN_LEAK);
              Sample_left = v.brown * BROWN_GAIN;
              Sample_right = v.brownR * BROWN_GAIN;
            } else if (v.type === VOICE_ISOPULSE || v.type === VOICE_ISOPULSE_ALT) {
              var alt = (v.type === VOICE_ISOPULSE_ALT) ? 1 : 0;
              v.sinPosL += v.curBeatfreqLFactor;
              if (v.sinPosL >= TWO_PI) v.sinPosL -= TWO_PI;
              v.sinPosR = v.sinPosL;
              if (1 > --v.phaseSampleCount) {
                v.phaseSampleCount = v.phaseSampleCountStart;
                v.phaseFlag = v.phaseFlag ? 0 : 1;
                v.phaseEnvelope = 0;
              }
              v.sinR = v.sinL = Math.sin(v.sinPosL);
              if (v.phaseFlag !== 0) {
                Sample_left = v.sinL * SIN_SCALER * (1.0 - v.phaseEnvelope);
                Sample_right = alt ? (v.sinL * SIN_SCALER * v.phaseEnvelope) : Sample_left;
              } else {
                Sample_left = v.sinL * SIN_SCALER * v.phaseEnvelope;
                Sample_right = alt ? (v.sinL * SIN_SCALER * (1.0 - v.phaseEnvelope)) : Sample_left;
              }
              if ((v.phaseEnvelope += 0.01) > 1) v.phaseEnvelope = 1;
            }
            /* stereo/mono mixing */
            if (!v.mono) {
              sumL += Sample_left * v.curVolL;
              sumR += Sample_right * v.curVolR;
            } else {
              Sample_left = (Sample_left + Sample_right) * 0.5;
              sumL += Sample_left * v.curVolL;
              sumR += Sample_left * v.curVolR;
            }
          }
        }
      }

      if (this.mono) { sumL = 0.5 * (sumL + sumR); sumR = sumL; }

      var outl, outr;
      if (!this.stereoSwap) {
        outl = sumL * this.volumeOverallL;
        outr = sumR * this.volumeOverallR;
      } else {
        outl = sumR * this.volumeOverallR;
        outr = sumL * this.volumeOverallL;
      }
      var sl = outl / 32768, sr = outr / 32768;
      if (sl > 1) sl = 1; else if (sl < -1) sl = -1;      /* clamp (upstream wraps a short) */
      if (sr > 1) sr = 1; else if (sr < -1) sr = -1;
      outL[k] = sl; outR[k] = sr;

      var peak = Math.abs(outl | 0);
      if (peak > this.peakL) this.peakL = peak;
      peak = Math.abs(outr | 0);
      if (peak > this.peakR) this.peakR = peak;

      if (updateperiod === 0) {
        updateperiod = UPDATE_PERIOD_SAMPLES;
        this.currentSample += UPDATE_PERIOD_SAMPLES;
      }
    }

    this.updatePeriod = updateperiod;
    return { completed: completedNow, flags: this.infoFlag };
  };

  /* Total rendered seconds for the current schedule. */
  Engine.prototype.duration = function () {
    return this.totalDuration;
  };

  var api = {
    SAMPLE_RATE: SAMPLE_RATE,
    VOICE_BINAURAL: VOICE_BINAURAL,
    VOICE_PINK: VOICE_PINK,
    VOICE_PCM: VOICE_PCM,
    VOICE_ISOPULSE: VOICE_ISOPULSE,
    VOICE_ISOPULSE_ALT: VOICE_ISOPULSE_ALT,
    VOICE_WHITE: VOICE_WHITE,
    VOICE_BROWN: VOICE_BROWN,
    FLAG_COMPLETED: FLAG_COMPLETED,
    FLAG_NEWLOOP: FLAG_NEWLOOP,
    FLAG_NEWENTRY: FLAG_NEWENTRY,
    Engine: Engine,
    Voice: Voice,
    Entry: Entry
  };

  if (typeof globalThis !== "undefined") globalThis.GnauralEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
