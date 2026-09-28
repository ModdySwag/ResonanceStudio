/* Gnaural Web — preset PACKS.
 *
 * A pack library built around the documented focus-level tone sets (see
 * presets.js for the raw sets and NOTICE.txt for the licensing/unaffiliation
 * position).  Every session here is generated from two inputs:
 *
 *    LEVEL  — the documented carrier[beat] layers for one focus level
 *    SHAPE  — how the session is shaped (intro / standard / deep / sleep /
 *             nap with a wake ramp / free flow / tour)
 *
 * so the whole library is data-driven: adding a session is one line in PACKS,
 * and every session inherits the same calibrated levels, fades and bed.
 *
 * Licence: GPL-2.0-or-later, like the rest of gnaural-web.
 */
(function () {
  "use strict";

  var H = (typeof module !== "undefined" && module.exports)
    ? null                                   /* required lazily below (Node) */
    : (globalThis.GnauralPresets || {}).helpers;

  function helpers() {
    if (H) return H;
    return (typeof module !== "undefined" ? require("./presets.js") : globalThis.GnauralPresets).helpers;
  }

  /* ------------------------------------------------------------ level sets */
  /* Volumes are the calibrated per-voice gains used by the hand-built focus
   * presets (they sum well below clipping).  beat = true Hz, symmetric around
   * the carrier (L = base + beat/2, R = base - beat/2) — the file semantics. */
  var LEVELS = {
    F3: {
      label: "Focus 3 — orientation",
      note: "the opening pair: a 4 Hz beat between 300/304 Hz over plain 100 and 500 Hz carriers",
      sets: [[302, 4.0, 0.16], [100, 0, 0.12], [500, 0, 0.08]]
    },
    F10: {
      label: "Focus 10 — mind awake, body asleep",
      note: "100[1.5], 200[4.0], 250[4.0], 300[4.0]",
      sets: [[100, 1.5, 0.16], [200, 4.0, 0.15], [250, 4.0, 0.13], [300, 4.0, 0.13]]
    },
    F12: {
      label: "Focus 12 — expanded awareness",
      note: "the Focus 10 bed plus 400[10.0], 500[10.1], 600[4.8]",
      sets: [[100, 1.5, 0.13], [200, 4.0, 0.12], [250, 4.0, 0.11], [300, 4.0, 0.11],
             [400, 10.0, 0.10], [500, 10.1, 0.10], [600, 4.8, 0.09]]
    },
    F15: {
      label: "Focus 15 — no time",
      note: "the bed plus 500[7.05], 630[7.1], 750[7.0]",
      sets: [[100, 1.5, 0.13], [200, 4.0, 0.12], [250, 4.0, 0.11], [300, 4.0, 0.11],
             [500, 7.05, 0.10], [630, 7.1, 0.09], [750, 7.0, 0.08]]
    },
    F21: {
      label: "Focus 21 — the bridge",
      note: "200[4.0], 250[5.4], 300[5.4], 600[16.2], 750[16.2], 900[16.2]",
      sets: [[200, 4.0, 0.14], [250, 5.4, 0.13], [300, 5.4, 0.13],
             [600, 16.2, 0.10], [750, 16.2, 0.09], [900, 16.2, 0.09]]
    },
    F23: {
      label: "Focus 23 — the first of the deeper sets",
      note: "400[3.9], 503[4.0], 600[4.0], 750[3.9], 900[4.0] — no low layer",
      sets: [[400, 3.9, 0.13], [503, 4.0, 0.12], [600, 4.0, 0.11],
             [750, 3.9, 0.10], [900, 4.0, 0.09]]
    },
    F24: {
      label: "Focus 24 — the same stack over a low bed",
      note: "50[0.75], 400[3.9], 503[4.0], 600[4.0], 750[4.0], 900[4.0]",
      sets: [[50, 0.75, 0.10], [400, 3.9, 0.13], [503, 4.0, 0.12],
             [600, 4.0, 0.11], [750, 4.0, 0.10], [900, 4.0, 0.09]]
    },
    F25: {
      label: "Focus 25 — the narrow set",
      note: "503[4.0], 600[4.0], 750[4.0], 900[4.0] — four carriers, nothing low",
      sets: [[503, 4.0, 0.14], [600, 4.0, 0.13], [750, 4.0, 0.12], [900, 4.0, 0.11]]
    },
    F26: {
      label: "Focus 26 — the bright deeper set",
      note: "400[3.9], 503[4.2], 600[4.0], 750[4.0], 900[4.0]",
      sets: [[400, 3.9, 0.13], [503, 4.2, 0.12], [600, 4.0, 0.11],
             [750, 4.0, 0.10], [900, 4.0, 0.09]]
    },
    F3set: {
      label: "Focus 3 — the tone set (second measurement)",
      note: "50[1.2], 100[1.3], 288[3.6] — three plain layers, no glide and no \"resonant tuning\" pair",
      sets: [[50, 1.2, 0.14], [100, 1.3, 0.14], [288, 3.6, 0.12]]
    },
    F27: {
      label: "Focus 27 — deep stillness",
      note: "50[0.80], 400[4.0], 503[4.2], 600[4.0], 750[4.0], 900[4.0]",
      sets: [[50, 0.8, 0.10], [400, 4.0, 0.12], [503, 4.2, 0.11],
             [600, 4.0, 0.11], [750, 4.0, 0.10], [900, 4.0, 0.09]]
    },
    SchF: {
      label: "Schumann — the 7.83 Hz fundamental",
      note: "200[7.83] over a plain 100 Hz carrier",
      sets: [[200, 7.83, 0.16], [100, 0, 0.10]]
    },
    SchF14: {
      label: "Schumann — 7.83 Hz with the 14.3 Hz harmonic",
      note: "200[7.83], 280[14.3], plain 100",
      sets: [[200, 7.83, 0.15], [280, 14.3, 0.12], [100, 0, 0.09]]
    },
    SchH: {
      label: "Schumann — the harmonics (14.3/20.8/27.3/33.8 Hz)",
      note: "150[14.3], 200[20.8], 250[27.3], 300[33.8] — no fundamental",
      sets: [[150, 14.3, 0.13], [200, 20.8, 0.12], [250, 27.3, 0.11], [300, 33.8, 0.10]]
    },
    SchAll: {
      label: "Schumann — the whole measured set (7.83 to 33.8 Hz)",
      note: "200[7.83], plain 100, 280[14.3], 400[20.8], 520[27.3], 660[33.8]",
      sets: [[200, 7.83, 0.14], [100, 0, 0.10], [280, 14.3, 0.12],
             [400, 20.8, 0.11], [520, 27.3, 0.10], [660, 33.8, 0.09]]
    },
    SchMono: {
      label: "Schumann — monaural, 100 + 107.83 Hz (7.83 Hz in the air)",
      note: "two steady carriers 7.83 Hz apart; L = R, so one speaker carries the beat",
      sets: [[100, 0, 0.15], [107.83, 0, 0.15]]
    },
    SchMonoH: {
      label: "Schumann — the harmonics as monaural pairs",
      note: "200+214.3 (14.3), 300+320.8 (20.8), 400+427.3 (27.3), 500+533.8 (33.8)",
      sets: [[200, 0, 0.10], [214.3, 0, 0.10], [300, 0, 0.09], [320.8, 0, 0.09],
             [400, 0, 0.09], [427.3, 0, 0.09], [500, 0, 0.08], [533.8, 0, 0.08]]
    },
    Br6: {
      label: "Breathing — six breaths a minute (0.1 Hz)",
      note: "one pulse every ten seconds: 5 s of tone, 5 s of silence",
      sets: [[220, 0.1, 0.15, "iso"], [440, 0.1, 0.08, "iso"]]
    },
    Br55: {
      label: "Breathing — five and a half a minute (0.0917 Hz)",
      note: "the same pace slowed: 5.5 breaths a minute",
      sets: [[220, 0.0917, 0.15, "iso"], [440, 0.0917, 0.08, "iso"]]
    },
    Br5: {
      label: "Breathing — five a minute (0.0833 Hz)",
      note: "twelve seconds a breath, on lower carriers",
      sets: [[200, 0.0833, 0.15, "iso"], [400, 0.0833, 0.08, "iso"]]
    },
    Br783: {
      label: "Breathing — the six-a-minute pace with a 7.83 Hz layer",
      note: "0.1 Hz pace on 220 Hz plus a 7.83 Hz pulse on 314 Hz",
      sets: [[220, 0.1, 0.15, "iso"], [314, 7.83, 0.09, "iso"]]
    },
    Sol174: { label: "Solfeggio — 174 Hz", note: "one steady carrier", sets: [[174, 0, 0.16]] },
    Sol285: { label: "Solfeggio — 285 Hz", note: "one steady carrier", sets: [[285, 0, 0.16]] },
    Sol396: { label: "Solfeggio — 396 Hz", note: "one steady carrier", sets: [[396, 0, 0.16]] },
    Sol417: { label: "Solfeggio — 417 Hz", note: "one steady carrier", sets: [[417, 0, 0.16]] },
    Sol528: { label: "Solfeggio — 528 Hz", note: "one steady carrier", sets: [[528, 0, 0.16]] },
    Sol639: { label: "Solfeggio — 639 Hz", note: "one steady carrier", sets: [[639, 0, 0.16]] },
    Sol741: { label: "Solfeggio — 741 Hz", note: "one steady carrier", sets: [[741, 0, 0.16]] },
    Sol852: { label: "Solfeggio — 852 Hz", note: "one steady carrier", sets: [[852, 0, 0.16]] },
    Sol963: { label: "Solfeggio — 963 Hz", note: "one steady carrier", sets: [[963, 0, 0.16]] },
    Sol9: {
      label: "Solfeggio — all nine (174 to 963 Hz)",
      note: "nine steady carriers at 0.08 each — a cluster, not a chord",
      sets: [[174, 0, 0.08], [285, 0, 0.08], [396, 0, 0.08], [417, 0, 0.08], [528, 0, 0.08],
             [639, 0, 0.08], [741, 0, 0.08], [852, 0, 0.08], [963, 0, 0.08]]
    },
    SolTri: {
      label: "Solfeggio — 396 + 528 + 639 Hz",
      note: "three steady carriers, the most commonly cited three",
      sets: [[396, 0, 0.13], [528, 0, 0.13], [639, 0, 0.13]]
    },
    Slp6: {
      label: "Sleep ladder — 6 Hz",
      note: "200[6.0], 300[6.0]",
      sets: [[200, 6, 0.15], [300, 6, 0.11]]
    },
    Slp4: {
      label: "Sleep ladder — 4 Hz",
      note: "180[4.0], 280[4.0]",
      sets: [[180, 4, 0.15], [280, 4, 0.10]]
    },
    Slp25: {
      label: "Sleep ladder — 2.5 Hz",
      note: "160[2.5], 260[2.5]",
      sets: [[160, 2.5, 0.14], [260, 2.5, 0.10]]
    },
    Slp15: {
      label: "Sleep ladder — 1.5 Hz",
      note: "150[1.5], 250[1.5] and a plain 60 Hz carrier as a blanket",
      sets: [[150, 1.5, 0.14], [250, 1.5, 0.09], [60, 0, 0.08]]
    },
    Fx40: {
      label: "Focus series — 40 Hz pulses",
      note: "40 a second on 250 and 500 Hz",
      sets: [[250, 40, 0.14, "iso"], [500, 40, 0.08, "iso"]]
    },
    Fx18: {
      label: "Focus series — 18 Hz pulses",
      note: "18 a second on 250 and 500 Hz",
      sets: [[250, 18, 0.15, "iso"], [500, 18, 0.08, "iso"]]
    },
    Fx14: {
      label: "Focus series — 14 Hz pulses",
      note: "14 a second on 300 and 450 Hz",
      sets: [[300, 14, 0.16, "iso"], [450, 14, 0.08, "iso"]]
    },
    Fx10: {
      label: "Focus series — 10 Hz pulses",
      note: "10 a second on 280 and 420 Hz",
      sets: [[280, 10, 0.15, "iso"], [420, 10, 0.08, "iso"]]
    },
    Dl18: {
      label: "Listener — 18 Hz (the opening stage)",
      note: "200[18.0]",
      sets: [[200, 18, 0.13]]
    },
    Dl14: {
      label: "Listener — 14 Hz",
      note: "200[14.0]",
      sets: [[200, 14, 0.13]]
    },
    Dl10: {
      label: "Listener — 10 Hz",
      note: "200[10.0], 400[10.0]",
      sets: [[200, 10, 0.14], [400, 10, 0.10]]
    },
    Dl6: {
      label: "Listener — 6 Hz",
      note: "180[6.0], 340[6.0]",
      sets: [[180, 6, 0.14], [340, 6, 0.10]]
    },
    Dl25: {
      label: "Listener — 2.5 Hz",
      note: "150[2.5], 300[2.5]",
      sets: [[150, 2.5, 0.13], [300, 2.5, 0.09]]
    },
  };

  /* ------------------------------------------------- room (speaker) stacks */
  /* The speaker pack must not depend on interaural differences: nothing here
   * uses a binaural pair.  Each layer is one of
   *   [base, rate, vol, "iso"]  — isochronic: a single carrier switched on and
   *                               off at `rate` Hz, identical in both channels,
   *                               so one speaker or a pair carries it.
   *   [base, 0, vol]            — a plain steady carrier (L = R).  Two of these
   *                               a few Hz apart beat in the room itself
   *                               (monaural), which also works on speakers.
   * Carriers sit in the 200–500 Hz band because small room speakers lose the
   * bottom octaves; volumes are lower than the headphone sets because a pulse
   * train is more audible than a steady tone at the same level. */
  var ROOM = {
    Rfirst: {
      label: "Room — first pass",
      note: "one 10 Hz pulse on 300 Hz",
      sets: [[300, 10, 0.16, "iso"]]
    },
    Revening: {
      label: "Room — evening",
      note: "a slow 2.5 Hz throb on 200 Hz",
      sets: [[200, 2.5, 0.17, "iso"]]
    },
    Rtalk: {
      label: "Room — talk-over alpha",
      note: "10 Hz pulses on 250 and 500 Hz, quiet",
      sets: [[250, 10, 0.13, "iso"], [500, 10, 0.08, "iso"]]
    },
    Rfocus: {
      label: "Room — working pulse",
      note: "13.5 Hz pulses on 320 and 480 Hz",
      sets: [[320, 13.5, 0.16, "iso"], [480, 13.5, 0.09, "iso"]]
    },
    Rtheta: {
      label: "Room — theta-range pulse",
      note: "6 Hz pulses on 200 and 300 Hz",
      sets: [[200, 6, 0.17, "iso"], [300, 6, 0.10, "iso"]]
    },
    Racoustic: {
      label: "Room — the acoustic beat",
      note: "two steady carriers 4 Hz apart (200 + 204 Hz) — they beat in the room, not in your head",
      sets: [[200, 0, 0.13], [204, 0, 0.13]]
    },
    Rslide: {
      label: "Room — slow slide",
      note: "one pulse on 300 Hz drifting from 4 Hz up to 12 Hz across the sitting",
      sets: [[300, 4, 0.15, "iso"]]
    },
    Rnap: {
      label: "Room — couch nap",
      note: "a slow 2 Hz pulse on 220 Hz with a pulse wake cue at the end",
      sets: [[220, 2, 0.17, "iso"]]
    }
  };

  /* --------------------------------------------------------------- shapes */
  /* Each shape returns the per-voice entry list for one carrier layer.
   * `settle` = the beat on the first audible layer glides down from this value
   * into the level's own beat (the "descend into the level" opening).
   * `rise`   = seconds of wake-up ramp at the end (beat climbs back up).
   *
   * Lengths follow the documented convention for this kind of guided session:
   * a full sitting is a 30–45 minute exercise (typical measured length 34–38
   * minutes), with an unguided free-flow closer running longer by design and a
   * deliberately short ~13-minute first pass. */
  var SHAPES = {
    intro:     { fadeIn: 45,  settle: 120, hold: 570,  fadeOut: 45,  bed: false, rise: 0 },    /* 13 min */
    standard:  { fadeIn: 75,  settle: 0,   hold: 2100, fadeOut: 75,  bed: false, rise: 0 },    /* 37.5 min */
    deep:      { fadeIn: 90,  settle: 300, hold: 2190, fadeOut: 120, bed: true,  rise: 0 },    /* 45 min */
    sleep:     { fadeIn: 120, settle: 300, hold: 3000, fadeOut: 480, bed: true,  rise: 0 },    /* 65 min */
    nap:       { fadeIn: 60,  settle: 180, hold: 900,  fadeOut: 45,  bed: false, rise: 180 },  /* 22.75 min */
    freeflow:  { fadeIn: 120, settle: 0,   hold: 5400, fadeOut: 150, bed: true,  rise: 0 },    /* 94.5 min */
    extended:  { fadeIn: 90,  settle: 0,   hold: 3600, fadeOut: 150, bed: true,  rise: 0 }     /* 64 min */
  };

  var BED_VOL = 0.02;

  /* one layer tuple -> a voice.  The tuple's 4th element chooses the voice
   * type: "iso" = isochronic pulse (single carrier, identical channels),
   * anything else = a binaural pair (headphone sets only). */
  function layerVoice(spec, shape, isFirst) {
    var h = helpers();
    var base = spec[0], beat = spec[1], vol = spec[2];
    var iso = spec[3] === "iso";
    var v = [];
    var hold = (beat === 0) ? 0 : shape.settle;          /* a plain carrier never settles */

    v.push({ dur: shape.fadeIn, base: base, beat: beat, vol: 0 });
    if (hold > 0 && isFirst) {
      /* glide the rate down into the session, then hold */
      v.push({ dur: shape.settle, base: base, beat: beat * 2.2, vol: vol });
      v[0].beat = beat * 2.2;
    }
    if (shape.ramp && isFirst) {
      /* a slow drift of the pulse rate across the sitting (speaker pack):
       * split the hold into stages walking from ramp[0] to ramp[1] */
      var stages = shape.rampStages || 6;
      for (var st = 0; st < stages; st++) {
        var f = stages === 1 ? 1 : st / (stages - 1);
        var b = shape.ramp[0] + (shape.ramp[1] - shape.ramp[0]) * f;
        v.push({ dur: shape.hold / stages, base: base, beat: b, vol: vol });
      }
    } else {
      v.push({ dur: shape.hold, base: base, beat: beat, vol: vol });
    }
    if (shape.rise > 0) {
      /* wake ramp: rate climbs back up (mirrors the measured Power Nap rise) and
       * keeps climbing through the fade-out, so it never falls back mid-wake.
       * Bounded at 20 Hz — on the fast focus-21 layers a bare ×2.5 would land in
       * gamma, which is not a wake-up. */
      var riseBeat = Math.min(beat * 2.5, 20);
      v.push({ dur: shape.rise * 0.55, base: base, beat: Math.min(beat * 1.6, riseBeat), vol: vol });
      v.push({ dur: shape.rise * 0.45, base: base, beat: riseBeat, vol: vol * 0.8 });
      v.push({ dur: shape.fadeOut, base: base, beat: riseBeat, vol: 0 });
    } else {
      v.push({ dur: shape.fadeOut, base: base, beat: beat, vol: 0 });
    }
    return iso ? h.iso(v) : h.binaural(v);
  }

  /* full session from a level + shape */
  var RETURN_BASE = 281, RETURN_BEAT = 22;   /* the measured return-to-waking signal: 281.20 + 22.00 Hz */
  var CUE_BASE = 281, CUE_RATE = 22;         /* the same signal, as a speaker pulse */

  function level(key) {
    var l = LEVELS[key] || ROOM[key];
    if (!l) throw new Error("unknown level " + key);
    return l;
  }

  function buildSession(levelKey, shapeKey, opts) {
    opts = opts || {};
    var h = helpers();
    var lv = level(levelKey);
    var base = SHAPES[shapeKey];
    if (!base) throw new Error("unknown shape " + shapeKey);
    var shape = {};
    for (var k in base) shape[k] = base[k];
    for (var k2 in (opts.shape || {})) shape[k2] = opts.shape[k2];   /* per-session overrides */
    var scale = opts.scale === undefined ? 1 : opts.scale;
    var voices = lv.sets.map(function (s, i) {
      var scaled = s.slice();
      scaled[2] = s[2] * scale;
      return layerVoice(scaled, shape, i === 0);
    });
    if (shape.bed || opts.bed) {
      var hold = shape.fadeIn + shape.hold + shape.rise + shape.fadeOut;
      voices.push(h.pink(h.shape(hold - 180, { vol: BED_VOL * (opts.bedVol || 1) }, 120, 60)));
    }
    if (shape.rise > 0 || opts.return) {
      /* Sessions that bring you back up end with the measured return-to-waking
       * signal: a beta-range pair around 281 Hz with a ~22 Hz beat, in its own
       * voice, silent until the last stretch, and ending on volume 0.
       * opts.signal === "iso" renders the same rate as a speaker pulse instead
       * (a binaural pair is inaudible as a beat on loudspeakers). */
      var total = shape.fadeIn + shape.settle + shape.hold + shape.rise + shape.fadeOut;
      var sig = 90, fade = 30;
      var cue = [
        { dur: total - sig - fade, base: CUE_BASE, beat: CUE_RATE, vol: 0 },
        { dur: sig, base: CUE_BASE, beat: CUE_RATE, vol: 0.10 },
        { dur: fade, base: CUE_BASE, beat: CUE_RATE, vol: 0 }
      ];
      voices.push(opts.signal === "iso" ? h.iso(cue) : h.binaural(cue));
    }
    return voices;
  }

  /* tour: morph through several levels, `stageSec` each */
  function buildTour(levelKeys, stageSec, opts) {
    opts = opts || {};
    var h = helpers();
    var stage = stageSec || 600;
    var widest = 0;
    levelKeys.forEach(function (k) { widest = Math.max(widest, LEVELS[k].sets.length); });
    var voices = [];
    for (var vi = 0; vi < widest; vi++) {
      /* per stage: this voice's carrier values; silent when the level has fewer layers */
      var entries = levelKeys.map(function (k) {
        var sets = LEVELS[k].sets;
        var s = sets[Math.min(vi, sets.length - 1)];
        return [s[0], s[1], vi < sets.length ? s[2] : 0];
      });
      var v = [];
      v.push({ dur: 30, base: entries[0][0], beat: entries[0][1], vol: 0 });
      entries.forEach(function (s, si) {
        v.push({ dur: si === 0 ? stage - 30 : stage, base: s[0], beat: s[1], vol: s[2] });
      });
      v.push({ dur: 90, base: entries[entries.length - 1][0], beat: entries[entries.length - 1][1], vol: 0 });
      /* the first level that actually has this voice decides its type */
      var kind = "bin";
      levelKeys.forEach(function (k) {
        var sets = level(k).sets;
        if (vi < sets.length && sets[vi][3] === "iso") kind = "iso";
      });
      voices.push(kind === "iso" ? h.iso(v) : h.binaural(v));
    }
    voices.push(h.pink(h.shape(stage * levelKeys.length, { vol: BED_VOL }, 30, 90)));
    return voices;
  }

  /* ---------------------------------------------------------------- packs */
  /* The wave packages follow the level arc of the Gateway Experience as it is
   * publicly documented (wave I works focus 3 into focus 10; II adds focus-12
   * tools; III and IV stay in 10–12; V moves to focus 15; VI to focus 21; VII
   * reaches 23/25/27).  Names are descriptive of the levels only.
   *
   * session spec: [level, shape, name, blurb, opts?]
   * Blurbs deliberately carry NO duration — buildLibrary() appends the real,
   * computed length so a displayed number can never drift from the session. */
  var PACKS = [
    {
      id: "wave1",
      name: "Wave I — F3 to F10",
      blurb: "The opening arc: settle in, meet the focus-10 state, then live in it — short passes, long sittings, a nap and an open-ended free flow.",
      sessions: [
        ["F3", "intro", "Settling in (first pass)", "The very first pass: the 300/304 pair with plain 100 and 500 Hz carriers, no deep layers at all — for getting the headphones and the room right."],
        ["F10", "intro", "First pass — mind awake, body asleep", "A short introduction: the 200 Hz layer glides down into the focus-10 bed, rests there, fades out."],
        ["F10", "extended", "Advanced — hold the state", "The same bed held much longer, the deeper 250 and 300 Hz layers given room. For when the state is already familiar."],
        ["F10", "sleep", "Letting go (restorative)", "Softer volumes, an eight-minute tail, pink-noise bed underneath — restorative rather than exploratory."],
        ["F10", "nap", "Exploration nap (with a wake ramp)", "A short hold followed by a measured wake-up ramp: the beat climbs back up through the last three minutes instead of stopping dead."],
        ["F10", "freeflow", "Free flow (open sitting)", "Ninety extremely steady minutes: no settling, no wake ramp, just the bed and the noise. For sitting with whatever comes up."],
        ["F3set", "standard", "The focus-3 tone set (50/100/288)", "The focus-3 set as separately measured — 50 Hz at a 1.2 Hz beat, 100 Hz at 1.3, 288 Hz at 3.6 — three plain layers, no glide. A different artefact from the opening pair above, which is the orientation sitting's measurement."]
      ]
    },
    {
      id: "wave2",
      name: "Wave II — F10 to F12",
      blurb: "The second arc: focus 10 becomes the everyday sitting, then the bright focus-12 stack arrives — seven layers instead of four.",
      sessions: [
        ["F10", "standard", "Second sitting (ten, held)", "Straight focus 10 for thirty-seven minutes — the everyday sitting once the first pass is familiar."],
        ["F12", "intro", "First pass — up to twelve", "The wide focus-12 stack introduced gently: seven layers, the top three running ten-Hz beats."],
        ["F12", "standard", "Bright steady (working a question)", "The full focus-12 set held — the brightest, most alert focus level. Good for sitting with a question rather than emptying out."],
        ["F12", "deep", "The wide field", "Focus 12 extended to forty-five minutes over the pink-noise bed, for when the brightness stops being the point."],
        ["F12", "nap", "Bright nap (short with wake ramp)", "Twenty minutes in the focus-12 stack, then the wake ramp back up."],
        ["F10", "tour", "Walk — ten into twelve", "Focus 10 morphing into the focus-12 stack, fifteen minutes a stage.",
          { tour: ["F10", "F12"], stage: 900 }]
      ]
    },
    {
      id: "wave3",
      name: "Wave III — F12",
      blurb: "Settling into the bright level: long sittings, an unguided free flow and a slow descent to sleep, all on the focus-12 set.",
      sessions: [
        ["F12", "extended", "Long bright", "The bright stack for over an hour — the long sitting of this wave."],
        ["F12", "freeflow", "Open bright (free flow)", "Ninety minutes of focus 12 with nothing to follow — the unguided-sitting design."],
        ["F12", "sleep", "Bright descent (into sleep)", "The bright stack walked all the way down, with a slow fade instead of an ending."],
        ["F12", "nap", "Twelve, short (nap)", "A short bright sitting with the wake ramp — a nap that still leaves you alert."],
        ["F10", "deep", "Ground under the bright", "Back down to focus 10 for forty-five minutes over the noise bed: the quiet floor of this wave."]
      ]
    },
    {
      id: "wave4",
      name: "Wave IV — F12 to F15",
      blurb: "Applied work at twelve, then first contact with fifteen: the bright top layers give way to 500, 630 and 750 Hz around a seven-Hz beat.",
      sessions: [
        ["F12", "standard", "Working the question (steady)", "Thirty-seven minutes of the bright stack, held steady — the sitting for a single question."],
        ["F12", "deep", "Far bright", "Focus 12 at forty-five minutes with the pink-noise bed, deeper than the everyday sitting."],
        ["F15", "intro", "First pass — no time", "Focus 15 introduced: the wide top layers give way to 500/630/750 Hz over a seven-Hz beat."],
        ["F15", "standard", "The still sitting", "Straight focus 15, held for thirty-seven minutes. The level people describe as losing the clock."],
        ["F12", "nap", "Question nap", "Twenty minutes bright, then the wake ramp."]
      ]
    },
    {
      id: "wave5",
      name: "Wave V — F15",
      blurb: "Deeper into the no-time level: the still set in every shape — long, open, short, sleepy.",
      sessions: [
        ["F15", "deep", "The still field", "Focus 15 for forty-five minutes over the pink-noise bed."],
        ["F15", "extended", "Long still", "Over an hour of straight focus 15."],
        ["F15", "freeflow", "Open still (free flow)", "Ninety minutes of focus 15 — no settling, no ramp, the open-ended sitting."],
        ["F15", "nap", "Still nap (wake ramp)", "A short focus-15 hold with the measured wake ramp at the end."],
        ["F15", "sleep", "Down and away (into sleep)", "Focus 15 with a long tail into sleep territory."],
        ["F12", "tour", "Walk — twelve into fifteen", "Focus 12 morphing down into 15, fifteen minutes a stage.",
          { tour: ["F12", "F15"], stage: 900 }]
      ]
    },
    {
      id: "wave6",
      name: "Wave VI — F21",
      blurb: "The bridge level: focus 21 swaps the deep bed for fast 16.2 Hz layers — a strange, busy sound next to the other levels.",
      sessions: [
        ["F21", "intro", "First pass — the bridge", "Focus 21 introduced gently; the fast 16.2 Hz layers take a while to sit with."],
        ["F21", "standard", "The bridge (held)", "The full focus-21 set: 200[4], 250[5.4], 300[5.4], 600[16.2], 750[16.2]."],
        ["F21", "deep", "Crossing", "Forty-five minutes at the bridge over the pink-noise bed."],
        ["F21", "extended", "The long crossing", "Over an hour of focus 21."],
        ["F21", "nap", "Bridge nap", "Twenty minutes of the fast layers, then the wake ramp."],
        ["F15", "tour", "Walk — fifteen to twenty-one", "Focus 15 morphing into the focus-21 set, fifteen minutes a stage.",
          { tour: ["F15", "F21"], stage: 900 }]
      ]
    },
    {
      id: "wave7",
      name: "Wave VII — F21 to F27",
      blurb: "The deepest set in the library: focus 27, where the bed drops to a 50 Hz layer and everything else sits far above it.",
      sessions: [
        ["F27", "intro", "First pass — deep stillness", "Focus 27 introduced with a settle; the 50 Hz layer is felt more than heard on small headphones."],
        ["F27", "standard", "Deep stillness (held)", "The full focus-27 set: 50[0.8], 400[4], 503[4.2], 600[4], 750[4], 900[4]."],
        ["F27", "extended", "The deep drop", "Over an hour at focus 27 with the pink-noise bed."],
        ["F27", "freeflow", "Deep field (free flow)", "Ninety minutes of focus 27 with nothing to follow."],
        ["F27", "sleep", "Deep rest (into sleep)", "Focus 27 with the longest fade in the library."],
        ["F21", "tour", "Walk — twenty-one to twenty-seven", "The bridge morphing down into focus 27, fifteen minutes a stage.",
          { tour: ["F21", "F27"], stage: 900 }]
      ]
    },
    {
      id: "sleep",
      name: "Sleep & rest",
      blurb: "The library's softest sessions: long tails, quiet volumes, nothing that wakes you up.",
      sessions: [
        ["F10", "sleep", "Settle for sleep", "Focus 10 at low volume with an eight-minute fade — the shortest way down."],
        ["F12", "sleep", "Early evening (twelve, softer)", "The bright stack at three-quarter volume, walked down slowly.", { scale: 0.75 }],
        ["F15", "sleep", "Night drift", "Focus 15 with the long tail."],
        ["F27", "extended", "Deep blanket", "Focus 27 held for over an hour; the 50 Hz layer is a sub-bass blanket on good headphones."],
        ["F10", "nap", "Power nap", "Twenty minutes and a wake ramp — a nap you can get up from."]
      ]
    },
    {
      id: "depth",
      name: "Depth — F23 to F26",
      blurb: "The deeper documented sets, which only turn up in the second measurement lineage: five carriers spread 400–900 Hz, all on ~4 Hz beats. Focus 22 is described as identical to focus 21 in every source and gets no separate session.",
      sessions: [
        ["F23", "intro", "First pass — twenty-three", "The first of the deeper sets introduced gently: five carriers from 400 to 900 Hz, each on a ~4 Hz beat, and nothing low underneath."],
        ["F23", "standard", "Twenty-three, held", "The full deeper set held for thirty-seven minutes — the same architecture as twenty-seven but without the 50 Hz layer."],
        ["F24", "standard", "Twenty-four, over the low bed", "Adds a 50 Hz layer at a 0.75 Hz beat under the 400–900 Hz stack: the deepest-feeling of these sets."],
        ["F24", "deep", "Twenty-four, deeper", "The low-bed set for forty-five minutes over the pink-noise bed."],
        ["F25", "standard", "Twenty-five, narrow", "Four carriers from 503 to 900 Hz — the set with nothing low in it at all."],
        ["F26", "standard", "Twenty-six, bright", "400–900 Hz with the 4.2 Hz beat on the 503 Hz layer, held."]
      ]
    },
    {
      id: "speakers",
      name: "Speakers — isochronic room sessions",
      blurb: "No headphones anywhere in this pack. Every layer is either a single-carrier pulse (isochronic) or a pair of steady carriers a few Hz apart that beat in the room itself, so one speaker or a stereo pair carries the whole thing — nothing here depends on a difference between your ears. Built for a living room: carriers in the range small speakers reproduce, quiet volumes you can talk over, nothing demanding a quiet room.",
      sessions: [
        ["Rfirst", "intro", "First pass — a quiet room pulse", "Ten pulses a second on a single 300 Hz carrier, quiet, thirteen minutes: set the speakers up, walk around, hear how the pulse carries across the room."],
        ["Rfirst", "intro", "Settle the room (five minutes)", "The five-minute version: start it walking in, let it run while you put things down, and it is over. Useful as a level check too — if you cannot hear the pulse at a conversational volume, raise the volume rather than the level of the whole track.",
          { shape: { fadeIn: 30, settle: 0, hold: 240, fadeOut: 30 } }],
        ["Revening", "standard", "Evening room (slow pulse)", "A slow 2.5-a-second throb on 200 Hz for thirty-seven minutes over the pink bed — the unwinding session, low enough to read or cook to."],
        ["Rtalk", "standard", "Talk-over alpha (very quiet)", "Ten-a-second pulses on 250 and 500 Hz at low volume, over the bed: audible as a texture but quiet enough to hold a conversation across."],
        ["Rfocus", "standard", "Sit-anywhere focus (13.5 Hz)", "The working pulse: 13.5 a second on 320 and 480 Hz. You do not have to stay in one spot or keep still — the field covers the room."],
        ["Rtheta", "deep", "Room theta (six a second)", "Six pulses a second on 180 and 300 Hz for forty-five minutes over the pink bed — the deepest session in the pack."],
        ["Racoustic", "standard", "The acoustic beat (200 + 204 Hz)", "No pulses at all: two steady carriers four cycles apart, so the beat happens in the air between the speakers rather than in your head. The oldest loudspeaker trick there is."],
        ["Rslide", "extended", "Slow slide (four into twelve)", "One pulse on 300 Hz that drifts from four a second up to twelve across the hour — start it slow and let it come up to a working rate.",
          { shape: { ramp: [4, 12] } }],
        ["Rnap", "nap", "Couch nap (pulse wake cue)", "A slow two-a-second pulse on 220 Hz, twenty-three minutes, ending in a 22-a-second pulse cue — the measured wake signal rendered as a speaker pulse instead of a headphone beat.",
          { signal: "iso" }]
      ]
    },
    {
      id: "tours",
      name: "Tours",
      blurb: "Guided walks through the levels: sit down once and the schedule moves through the sets in order.",
      sessions: [
        ["F10", "tour", "Tour — ten, twelve, fifteen", "Half an hour through the middle levels, ten minutes each.", { tour: ["F10", "F12", "F15"], stage: 600 }],
        ["F15", "tour", "Tour — fifteen to twenty-seven", "The deep end in one sitting: 15, 21 then 27.", { tour: ["F15", "F21", "F27"], stage: 600 }],
        ["F3", "tour", "Tour — the whole ladder", "Every documented level in order: orientation through to focus 27.", { tour: ["F3", "F10", "F12", "F15", "F21", "F27"], stage: 500 }],
        ["F10", "tour", "Tour — the documented ladder (ten minutes a stage)", "The deep end at the pace the published tone-set sequences use: ten minutes per level, walking 10, 12, 15, 21, 23, 24, 25, 26, 27 in order — ninety minutes without a break.", { tour: ["F10", "F12", "F15", "F21", "F23", "F24", "F25", "F26", "F27"], stage: 600 }]
      ]
    },
    {
      id: "schumann",
      name: "Schumann resonances",
      blurb: "The measured resonances of the Earth–ionosphere cavity — the 7.83 Hz fundamental and the harmonics around 14.3, 20.8, 27.3 and 33.8 Hz — as tone sets in headphone and speaker versions; they are electromagnetic properties of the atmosphere rather than of a brain, and the audio here is only a representation of them.",
      sessions: [
        ["SchF", "intro", "First pass — the 7.83 Hz fundamental", "The fundamental of the cavity as a headphone beat: two tones 7.83 Hz apart around 200 Hz, over a plain 100 Hz carrier. Short, and useful for setting the headphone level."],
        ["SchF", "standard", "The fundamental, held", "The 7.83 Hz rate on its own, held long — the measured fundamental without any of the upper harmonics over it."],
        ["SchF14", "standard", "Fundamental and the 14.3 Hz harmonic", "The fundamental with the first harmonic added, the two rates running together over the low carrier."],
        ["SchH", "standard", "The harmonics alone (14.3 to 33.8 Hz)", "The four upper resonances stacked — 14.3, 20.8, 27.3 and 33.8 Hz - with nothing at the fundamental underneath them."],
        ["SchAll", "deep", "The whole measured set", "The fundamental and all four harmonics together over the pink-noise bed: the full series as one stack. Headphones — every layer in this one is a binaural pair."],
        ["SchMono", "standard", "Monaural — 100 + 107.83 Hz (no headphones needed)", "Two steady carriers 7.83 Hz apart, both present in both channels, so the beat happens in the air and a single speaker carries it. The same rate as the fundamental, delivered a different way."],
        ["SchMonoH", "deep", "The harmonics in the room (monaural pairs)", "All four harmonics as pairs of steady carriers beating in the room — no headphones, and nothing in it that depends on a difference between your ears."],
        ["SchF", "sleep", "The fundamental, down the long tail", "The 7.83 Hz pair with the longest fade in the library, for leaving running as you go under."]
      ]
    },
    {
      id: "breathing",
      name: "Breathing — six a minute",
      blurb: "Paced sessions built on six breaths a minute — the pace the heart-rate variability work places at the baroreflex resonance near 0.1 Hz, which is a cardiovascular measurement taken in a lab rather than anything about tones; the audio here just gives the breathing something to hold on to, on speakers or headphones.",
      sessions: [
        ["Br6", "intro", "First pass — six breaths a minute", "The pace at six breaths a minute: a pulse every ten seconds on a 220 Hz carrier with a quiet octave above it. One on/off cycle per breath - five seconds of tone, five of silence - and nothing to count."],
        ["Br55", "standard", "Five and a half a minute (slower than six)", "The same pace slowed to five and a half breaths a minute and held. Slower is not automatically better - this sits at the low end of the band the heart-rate work describes."],
        ["Br55", "tour", "Ladder — 5.5 up to six a minute", "Two stages: the pace starts at five and a half breaths a minute and glides the short distance up to six, so you can find where your own breathing sits instead of being told.", { tour: ["Br55", "Br6"], stage: 600 }],
        ["Br783", "standard", "The pace with a 7.83 Hz layer", "Six breaths a minute on one carrier with a faster 7.83 Hz pulse on another — the Schumann fundamental riding under the pace. The slow pulse is the one to follow."],
        ["Br6", "extended", "The long paced sitting", "The six-a-minute pace held for the longest ordinary sitting in the library, over the pink-noise bed, for when the rhythm has stopped needing attention."],
        ["Br6", "freeflow", "Open pace (nothing but the pulse)", "The longest, plainest shape: the pace runs unbroken, with no settling at the start and no wake ramp at the end."],
        ["Br5", "standard", "Five a minute (the slow end)", "Twelve seconds a breath on lower carriers, just under the 0.1 Hz band, for when six a minute feels rushed."],
        ["Br6", "nap", "Paced break (with a wake cue)", "A short paced sitting that ends with the measured return-to-waking signal, rendered as a pulse so a speaker carries it.", { signal: "iso" }]
      ]
    },
    {
      id: "solfeggio",
      name: "Solfeggio (the historical set)",
      blurb: "The nine tones usually listed as solfeggio — 174, 285, 396, 417, 528, 639, 741, 852 and 963 Hz - as a single-tone dwell, a walk through the series and a layered stack; the set as a set comes from a 1990s folk tradition and a numerological reading of a hymn text, not from any measurement.",
      sessions: [
        ["Sol396", "intro", "First pass — one tone (396 Hz)", "A single steady carrier from the bottom of the series with nothing layered over it: the shortest shape, for hearing what one tone in this set actually sounds like."],
        ["Sol528", "standard", "The 528 Hz tone, held", "The best-known number in the set as one continuous carrier — no beat, no pulse, no layers."],
        ["Sol963", "standard", "The top of the series (963 Hz)", "The highest of the nine alone; it sits well above the noise floor of most rooms and most headphones."],
        ["Sol9", "deep", "The whole series at once", "All nine carriers sounding together over the pink-noise bed — a dense cluster rather than a single tone, and deliberately more wall than melody."],
        ["Sol174", "tour", "Walk the series (174 up to 963)", "The nine tones in order, the carrier gliding from one number into the next, so the set is heard as one continuous climb rather than nine separate tracks.", { tour: ["Sol174", "Sol285", "Sol396", "Sol417", "Sol528", "Sol639", "Sol741", "Sol852", "Sol963"], stage: 300 }],
        ["SolTri", "extended", "Three tones, long sitting", "396, 528 and 639 held together over the pink-noise bed for the longest shape in the library."],
        ["Sol174", "sleep", "174 Hz, down the long tail", "The lowest carrier in the series with the long fade, for letting a single number run as you go under."]
      ]
    },
    {
      id: "sleepladder",
      name: "Sleep ladder",
      blurb: "A descent in four rungs — six, four, two and a half and one and a half a second - each rung a full session with a long tail, built to be left running while you sleep, with the pink-noise bed underneath all of it.",
      sessions: [
        ["Slp6", "sleep", "Rung one — six a second (into sleep)", "The top rung: a six-a-second beat on two carriers, with the long fade at the end and nothing at all to do."],
        ["Slp4", "sleep", "Rung two — four a second", "The next rung down on lower carriers - the same architecture, a slower rate."],
        ["Slp25", "sleep", "Rung three — two and a half a second", "Two and a half a second, the rate the classic delta-sleep recordings sit at, on lower carriers again."],
        ["Slp15", "sleep", "Rung four — one and a half a second", "The bottom rung: one and a half a second over a plain 60 Hz carrier that small headphones feel more than reproduce."],
        ["Slp15", "extended", "Silent tail (the tone leaves early)", "The bottom rung with a fifteen-minute fade: the tone is long gone while the file still has a stretch to run, so the last part is the noise bed and then nothing.", { shape: { fadeOut: 900 } }],
        ["Slp15", "freeflow", "The night rung (one rate, no descent)", "One and a half a second held for the longest shape in the library, with the noise bed raised slightly; it does not descend, so nothing changes under you if you sleep through the start.", { bedVol: 1.5 }],
        ["Slp6", "tour", "Descent — six into one and a half", "The four rungs in order, a quarter of an hour a stage, gliding from one rate to the next so the whole ladder is one continuous slide instead of four separate files.", { tour: ["Slp6", "Slp4", "Slp25", "Slp15"], stage: 900 }]
      ]
    },
    {
      id: "focus",
      name: "Focus series (speaker pulses)",
      blurb: "Isochronic pulses at 40, 18, 14 and 10 a second on carriers between 250 and 500 Hz, quiet enough to run under other work on a small speaker; the 40 Hz work usually cited from MIT used flickering light and clicks together in a lab task rather than a tone generator, so no effect is claimed here.",
      sessions: [
        ["Fx40", "intro", "First pass — forty a second", "Forty pulses a second on 250 and 500 Hz: the fastest rate in the series, and either the most useful or the most irritating thing here. It starts and stops flat, with no glide at either end.", { shape: { settle: 0 } }],
        ["Fx40", "standard", "Forty a second, held", "The same fast pulse for the standard sitting, over the pink bed."],
        ["Fx18", "standard", "Eighteen a second (up-tempo desk)", "A quick pulse on the same two carriers - the fastest of the series that still reads as a texture rather than a buzz."],
        ["Fx14", "standard", "Fourteen a second (working pulse)", "Fourteen a second on 300 and 450 Hz; brisk, but slower than the two above it."],
        ["Fx10", "standard", "Ten a second (talk-over)", "The slowest of the series, on 280 and 420 Hz - the one to run while reading or talking, since at conversational volume it stays in the background."],
        ["Fx10", "extended", "The long desk sitting (ten a second)", "Ten a second for the longest shape in the library, over the pink bed."],
        ["Fx14", "tour", "Desk ladder — eighteen down to ten", "Three stages, fifteen minutes a stage: the pulse starts at eighteen a second and slides down through fourteen to ten, so the series is heard as one continuous descent.", { tour: ["Fx18", "Fx14", "Fx10"], stage: 900 }],
        ["Fx10", "nap", "Desk break (with a wake cue)", "A short sit at ten a second ending with the measured return-to-waking signal as a speaker pulse.", { signal: "iso" }]
      ]
    },
    {
      id: "listener",
      name: "Deep listener (long tours)",
      blurb: "Long sittings that walk rather than hold — every session is a tour gliding through several rates over the pink-noise bed, from the beta range down into delta, all of it headphone material because every layer is a binaural pair.",
      sessions: [
        ["Dl14", "tour", "Deep walk — fourteen into two and a half", "Four stages of twenty-five minutes: fourteen a second slides down through ten and six to two and a half, all of it over the pink bed.", { tour: ["Dl14", "Dl10", "Dl6", "Dl25"], stage: 1500 }],
        ["Dl10", "tour", "Evening descent — alpha into delta", "Ten a second down through six to two and a half, twenty minutes a stage - the compact version of the same descent.", { tour: ["Dl10", "Dl6", "Dl25"], stage: 1200 }],
        ["Dl18", "tour", "The long walk — eighteen into delta", "The full arc in five stages of twenty-five minutes each: eighteen, fourteen, ten, six, two and a half. The longest session in the library, and the one to plan a blank evening around.", { tour: ["Dl18", "Dl14", "Dl10", "Dl6", "Dl25"], stage: 1500 }],
        ["Dl10", "tour", "Short walk — ten into six", "Two stages of fifteen minutes: alpha gliding into theta, for a sitting that still has somewhere to be afterwards.", { tour: ["Dl10", "Dl6"], stage: 900 }],
        ["Dl6", "extended", "Theta, held (no walking)", "One rate for the longest shape in the library, over the pink bed: the same theta bed the walks pass through, with nowhere to go."],
        ["Dl25", "freeflow", "Delta, open-ended", "Two and a half a second unbroken for the longest free-flow shape - no settling, no ramp, and no stages to follow."]
      ]
    }
  ];

  /* build the flat library the app and the pack writer both consume:
   * the classic hand-built presets first, then every pack session */
  function sessionSeconds(voices) {
    var max = 0;
    voices.forEach(function (v) {
      var s = v.entries.reduce(function (a, e) { return a + e.dur; }, 0);
      if (s > max) max = s;
    });
    return max;
  }

  function buildLibrary() {
    var lib = [];
    var classic = (typeof module !== "undefined" ? require("./presets.js") : globalThis.GnauralPresets).PRESETS;
    classic.forEach(function (p) {
      var mins = Math.round(sessionSeconds(p.voices) / 60);
      var blurb = / \d+ minutes\.\s*$/.test(p.blurb)
        ? p.blurb
        : p.blurb.replace(/\s*$/, "") + " " + mins + " minutes.";
      lib.push({ pack: "classic", packName: "Classic sessions", name: p.name, blurb: blurb, voices: p.voices });
    });
    PACKS.forEach(function (pack) {
      pack.sessions.forEach(function (s) {
        var shapes = {};
        if (s[4] && s[4].shape) shapes = s[4].shape;
        var merged = {};
        for (var k in (s[4] || {})) merged[k] = s[4][k];
        merged.shape = shapes;
        var voices = s[1] === "tour" ? buildTour(merged.tour, merged.stage) : buildSession(s[0], s[1], merged);
        var mins = Math.round(sessionSeconds(voices) / 60);
        lib.push({ pack: pack.id, packName: pack.name, name: s[2], blurb: s[3] + " " + mins + " minutes.", voices: voices });
      });
    });
    return lib;
  }

  var api = {
    LEVELS: LEVELS, ROOM: ROOM, SHAPES: SHAPES, PACKS: PACKS,
    buildSession: buildSession, buildTour: buildTour, buildLibrary: buildLibrary,
    LIBRARY: buildLibrary()
  };
  if (typeof globalThis !== "undefined") globalThis.GnauralPacks = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
