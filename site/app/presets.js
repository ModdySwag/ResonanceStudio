/* Gnaural Web — built-in presets.
 *
 * These are ORIGINAL schedules written for gnaural-web.  Upstream Gnaural presets
 * are not bundled (the upstream preset archive carries no licence; see NOTICE.txt),
 * but the app can open any .gnaural file you already have.
 *
 * Authoring shape — each entry RAMP: over its `dur` seconds every parameter glides
 * linearly from this entry's values to the NEXT entry's values ("next" = wrap to the
 * first entry after the last).  So a value is "held" by giving the next entry the
 * same value, and the last entry fades back to entry 0.
 *
 * vol = both channels; volR overrides right.  beat = binaural-beat / pulse rate in Hz
 * (file semantics: true Hz).  type: "binaural" | "pink" | "iso" | "isoalt".
 *
 * Licensed GPL-2.0-or-later like the rest of gnaural-web.
 */
(function () {
  "use strict";

  function binaural(entries, opts) { return Object.assign({ type: "binaural" }, opts || {}, { entries: entries }); }
  function pink(entries, opts) { return Object.assign({ type: "pink" }, opts || {}, { entries: entries }); }
  function white(entries, opts) { return Object.assign({ type: "white" }, opts || {}, { entries: entries }); }
  function brown(entries, opts) { return Object.assign({ type: "brown" }, opts || {}, { entries: entries }); }
  function iso(entries, opts) { return Object.assign({ type: "iso" }, opts || {}, { entries: entries }); }

  /* helper: fade-in + hold + fade-out around constant values.
   * The third entry must repeat the LEVEL, not zero it: under the ramp rule the
   * middle entry ramps into the next entry's values, so a trailing vol 0 turns
   * the whole hold into one long fade-out (measured bug).  The fade-out happens
   * during the last entry, which ramps into entry 0's zero on wrap. */
  function shape(seconds, values, fadeIn, fadeOut) {
    return [
      Object.assign({}, values, { vol: 0, dur: fadeIn }),
      Object.assign({}, values, { dur: seconds }),
      Object.assign({}, values, { dur: fadeOut })
    ];
  }

  /* helper: layered tone set — one binaural voice per documented carrier.
   * carriers: [{base, beat, vol}] held for holdSec behind a fadeIn/fadeOut envelope.
   * The focus-level sets are built this way: Hemi-Sync-style sessions layer several
   * carrier[beat] pairs at once, and each pair is exactly one Gnaural binaural voice. */
  function layered(carriers, holdSec, fadeIn, fadeOut) {
    return carriers.map(function (c) {
      return binaural([
        { dur: fadeIn, base: c.base, beat: c.beat, vol: 0 },
        { dur: holdSec, base: c.base, beat: c.beat, vol: c.vol },
        { dur: fadeOut, base: c.base, beat: c.beat, vol: c.vol }   /* level repeats: the hold holds */
      ]);
    });
  }

  /* helper: one voice whose beat rate glides from beatFrom to beatTo, then holds
   * (used for the "settling down" opening of a session). */
  function glide(base, beatFrom, beatTo, vol, glideSec, holdSec, fadeIn, fadeOut) {
    return binaural([
      { dur: fadeIn, base: base, beat: beatFrom, vol: 0 },
      { dur: glideSec, base: base, beat: beatFrom, vol: vol },
      { dur: holdSec, base: base, beat: beatTo, vol: vol },
      { dur: fadeOut, base: base, beat: beatTo, vol: 0 }
    ]);
  }

  var PRESETS = [
    {
      name: "Focus 40 (gamma)",
      blurb: "40 Hz binaural beat over a 200 Hz carrier with a low pink-noise bed. 21 minutes.",
      voices: [
        binaural(shape(1200, { base: 200, beat: 40, vol: 0.35 }, 20, 20)),
        pink(shape(1200, { vol: 0.035 }, 30, 30))
      ]
    },
    {
      name: "Deep Work (beta)",
      blurb: "14 Hz beta beat, 190 Hz carrier, silence at both ends. 31 minutes.",
      voices: [ binaural(shape(1800, { base: 190, beat: 14, vol: 0.35 }, 25, 25)) ]
    },
    {
      name: "Calm Clarity (alpha)",
      blurb: "10 Hz alpha beat at 180 Hz. 21 minutes.",
      voices: [ binaural(shape(1200, { base: 180, beat: 10, vol: 0.32 }, 20, 20)) ]
    },
    {
      name: "Meditation (Schumann)",
      blurb: "7.83 Hz beat with a faint pink-noise bed. 31 minutes.",
      voices: [
        binaural(shape(1800, { base: 200, beat: 7.83, vol: 0.3 }, 25, 25)),
        pink(shape(1800, { vol: 0.03 }, 30, 30))
      ]
    },
    {
      name: "Theta Drift (6 to 4 Hz)",
      blurb: "Beat glides 6 Hz down to 4 Hz and back. 45 minutes.",
      voices: [ binaural([
        { dur: 300, base: 170, beat: 6, vol: 0 },
        { dur: 300, base: 165, beat: 4.5, vol: 0.3 },
        { dur: 1500, base: 160, beat: 4, vol: 0.3 },
        { dur: 300, base: 165, beat: 4.5, vol: 0.3 },
        { dur: 300, base: 170, beat: 6, vol: 0 }
      ]) ]
    },
    {
      name: "Delta Sleep (2.5 Hz)",
      blurb: "Very soft 2.5 Hz delta beat, long 10-minute fade-out. 60 minutes.",
      voices: [ binaural([
        { dur: 120, base: 150, beat: 4, vol: 0 },
        { dur: 1380, base: 148, beat: 2.5, vol: 0.25 },
        { dur: 600, base: 150, beat: 2.5, vol: 0.25 },
        { dur: 1500, base: 150, beat: 2.5, vol: 0 }
      ]) ]
    },
    {
      name: "Reset Break (16 to 10 Hz)",
      blurb: "Short session: beta down to alpha. 10 minutes.",
      voices: [ binaural([
        { dur: 20, base: 200, beat: 16, vol: 0 },
        { dur: 240, base: 190, beat: 11, vol: 0.33 },
        { dur: 300, base: 185, beat: 10, vol: 0.33 },
        { dur: 40, base: 200, beat: 10, vol: 0 }
      ]) ]
    },
    {
      name: "Iso Pulse Focus (10 Hz)",
      blurb: "Isochronic pulse at 320 Hz — a pulse instead of a beat, for speakers/single-ear use. 16 minutes.",
      voices: [ iso(shape(900, { base: 320, beat: 10, vol: 0.3 }, 20, 20)) ]
    },

    /* ---- focus-level sets --------------------------------------------------
     * Inspired by the publicly documented focus-level tone sets of the Monroe
     * Institute's Gateway programme — independent measurements that have been
     * republished since the 1990s (notation "503[4.2]" = a 4.2 Hz beat between
     * two carriers equally separated from 503 Hz).  These are ORIGINAL tone
     * schedules written for this app: no audio, narration or scripts from those
     * recordings, and no affiliation with the Monroe Institute.  The measured
     * sets layer several carrier[beat] pairs at once, which is why each preset
     * here is a stack of binaural voices.  Headphones required — the beat exists
     * between your ears, not in the air.  Work through them in order; the
     * sessions are built to sit with for a while rather than to rush.
     * Levels: F10 mind awake/body asleep · F12 expanded awareness · F15 "no
     * time" · F21 the bridge · F27 the deepest of the commonly listed levels.
     */
    {
      name: "Focus 3 — Orientation (resonant tuning)",
      blurb: "Where the sequence opens: the 300/304 Hz pair (4 Hz) over plain 100 Hz and 500 Hz carriers. 25 minutes.",
      voices: layered([
        { base: 302, beat: 4.0, vol: 0.16 },
        { base: 100, beat: 0, vol: 0.12 },
        { base: 500, beat: 0, vol: 0.08 }
      ], 1380, 40, 60)
    },
    {
      name: "Focus 10 — Mind Awake, Body Asleep",
      blurb: "The classic set: 100[1.5], 200[4.0], 250[4.0], 300[4.0], with the 200 Hz layer settling from 10 Hz down to 4 Hz and a faint pink-noise bed. 37 minutes.",
      voices: [
        glide(200, 10, 4, 0.15, 240, 1860, 60, 60),
        binaural(shape(1980, { base: 100, beat: 1.5, vol: 0.16 }, 90, 90)),
        binaural(shape(1980, { base: 250, beat: 4.0, vol: 0.13 }, 90, 90)),
        binaural(shape(1980, { base: 300, beat: 4.0, vol: 0.13 }, 90, 90)),
        pink(shape(1980, { vol: 0.02 }, 120, 120))
      ]
    },
    {
      name: "Focus 12 — Expanded Awareness",
      blurb: "The full Focus 12 stack: 100[1.5], 200[4.0], 250[4.0], 300[4.0] plus the bright 400[10.0], 500[10.1] and 600[4.8] layers. 36 minutes.",
      voices: layered([
        { base: 100, beat: 1.5, vol: 0.13 },
        { base: 200, beat: 4.0, vol: 0.12 },
        { base: 250, beat: 4.0, vol: 0.11 },
        { base: 300, beat: 4.0, vol: 0.11 },
        { base: 400, beat: 10.0, vol: 0.10 },
        { base: 500, beat: 10.1, vol: 0.10 },
        { base: 600, beat: 4.8, vol: 0.09 }
      ], 2000, 75, 75)
    },
    {
      name: "Focus 15 — No Time",
      blurb: "Deep and steady: the Focus 15 set with 500[7.05], 630[7.1] and 750[7.0] layers over the usual bed, and a quiet pink-noise bed underneath. 42 minutes.",
      voices: layered([
        { base: 100, beat: 1.5, vol: 0.13 },
        { base: 200, beat: 4.0, vol: 0.12 },
        { base: 250, beat: 4.0, vol: 0.11 },
        { base: 300, beat: 4.0, vol: 0.11 },
        { base: 500, beat: 7.05, vol: 0.10 },
        { base: 630, beat: 7.1, vol: 0.09 },
        { base: 750, beat: 7.0, vol: 0.08 }
      ], 2340, 75, 75).concat([pink(shape(2340, { vol: 0.02 }, 90, 90))])
    },
    {
      name: "Focus 21 — The Bridge",
      blurb: "The Focus 21 set as measured on the later tapes: 200[4.0], 250[5.4], 300[5.4] with the fast 600[16.2], 750[16.2] and 900[16.2] layers and a quiet pink-noise bed. 42 minutes.",
      voices: layered([
        { base: 200, beat: 4.0, vol: 0.14 },
        { base: 250, beat: 5.4, vol: 0.13 },
        { base: 300, beat: 5.4, vol: 0.13 },
        { base: 600, beat: 16.2, vol: 0.10 },
        { base: 750, beat: 16.2, vol: 0.09 },
        { base: 900, beat: 16.2, vol: 0.09 }
      ], 2340, 75, 75).concat([pink(shape(2340, { vol: 0.02 }, 90, 90))])
    },
    {
      name: "Focus 27 — Deep Stillness",
      blurb: "The deepest of the commonly listed levels: 50[0.80], 400[4.0], 503[4.2], 600[4.0], 750[4.0] and 900[4.0], very still, with a faint pink-noise bed. 42 minutes.",
      voices: layered([
        { base: 50, beat: 0.8, vol: 0.10 },
        { base: 400, beat: 4.0, vol: 0.12 },
        { base: 503, beat: 4.2, vol: 0.11 },
        { base: 600, beat: 4.0, vol: 0.11 },
        { base: 750, beat: 4.0, vol: 0.10 },
        { base: 900, beat: 4.0, vol: 0.09 }
      ], 2340, 75, 75).concat([pink(shape(2340, { vol: 0.02 }, 90, 90))])
    },
    (function () {
      /* Level tour — six stages x ten minutes, morphing through the documented
       * sets in order (this is the shape of the old "t-seqall" experiment: walk
       * the levels, ten minutes each).  Per voice, per stage: [base, beat, vol].
       * A silent stage carries the voice's home values, so the cross-stage glide
       * is volume-only until the voice's own level arrives. */
      var S = 600;
      var tour = [
        /* Focus 3  */ [[100, 1.3, 0.12], [302, 4.0, 0.15], [500, 0, 0.07], [300, 4.0, 0], [630, 7.1, 0], [900, 4.0, 0]],
        /* Focus 10 */ [[100, 1.5, 0.14], [200, 4.0, 0.14], [250, 4.0, 0.12], [300, 4.0, 0.12], [630, 7.1, 0], [900, 4.0, 0]],
        /* Focus 12 */ [[100, 1.5, 0.13], [200, 4.0, 0.12], [250, 4.0, 0.11], [300, 4.0, 0.11], [500, 10.1, 0.10], [600, 4.8, 0.09]],
        /* Focus 15 */ [[100, 1.5, 0.13], [200, 4.0, 0.12], [250, 4.0, 0.11], [300, 4.0, 0.11], [630, 7.1, 0.10], [750, 7.0, 0.09]],
        /* Focus 21 */ [[200, 4.0, 0.13], [250, 5.4, 0.12], [300, 5.4, 0.12], [600, 16.2, 0.10], [750, 16.2, 0.09], [900, 4.0, 0]],
        /* Focus 27 */ [[50, 0.8, 0.10], [400, 4.0, 0.12], [503, 4.2, 0.11], [600, 4.0, 0.11], [750, 4.0, 0.10], [900, 4.0, 0.09]]
      ];
      var voices = [];
      for (var vi = 0; vi < 6; vi++) {
        var entries = [{ dur: 30, base: tour[0][vi][0], beat: tour[0][vi][1], vol: 0 }];
        for (var si = 0; si < tour.length; si++) {
          var c = tour[si][vi];
          entries.push({ dur: si === 0 ? S - 30 : S, base: c[0], beat: c[1], vol: c[2] });
        }
        entries.push({ dur: 90, base: tour[5][vi][0], beat: tour[5][vi][1], vol: 0 });
        voices.push(binaural(entries));
      }
      voices.push(pink(shape(S * 6 - 120, { vol: 0.02 }, 30, 90)));
      return {
        name: "Level Tour — through the levels",
        blurb: "A condensed pass through the documented sets in order — Focus 3, 10, 12, 15, 21, 27, ten minutes each — morphing smoothly between them over a faint pink-noise bed. The long sitting: headphones on, no narration, just follow the pitch down.",
        voices: voices
      };
    })()
  ];

  var TYPE_MAP = { binaural: 0, pink: 1, iso: 3, isoalt: 4, white: 7, brown: 8 };

  /* preset -> engine schedule (same shape gnm.js produces) */
  function presetToSchedule(preset) {
    return preset.voices.map(function (v) {
      return {
        type: TYPE_MAP[v.type],
        mute: false,
        mono: !!v.mono,
        entries: v.entries.map(function (e) {
          var needsCarrier = (v.type === "binaural" || v.type === "iso" || v.type === "isoalt");
          return {
            duration: e.dur,
            volL: (e.vol === undefined ? 1 : e.vol),
            volR: (e.volR === undefined ? (e.vol === undefined ? 1 : e.vol) : e.volR),
            /* a carrier voice without a base must not become 0 Hz: leave it to the
             * engine's own default (200 Hz). Noise voices carry no carrier at all. */
            basefreq: (e.base === undefined ? (needsCarrier ? undefined : 0) : e.base),
            beat: e.beat === undefined ? 0 : e.beat
          };
        })
      };
    });
  }

  var api = {
    PRESETS: PRESETS,
    presetToSchedule: presetToSchedule,
    helpers: { binaural: binaural, pink: pink, white: white, brown: brown, iso: iso, shape: shape, layered: layered, glide: glide, GNAURAL_TYPE_MAP: TYPE_MAP }
  };
  if (typeof globalThis !== "undefined") globalThis.GnauralPresets = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
