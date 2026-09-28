/* Gnaural Web — rate and carrier reference tables.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * These tables are what the studio's quick-pick panels and the site's help
 * pages are generated from, so the numbers on a page and the numbers a preset
 * plays can never drift apart.
 *
 * Honesty rules (asserted by rates.test.js, and the reason every entry carries
 * a `status`):
 *   "practice"  — an ordinary practice or convention (breathing rate, band name)
 *   "physics"   — a measured physical phenomenon (Schumann resonances are real
 *                 electromagnetic resonances; the audio is only a representation)
 *   "tradition" — historical / folk lists with no peer-reviewed support
 *   "source"    — our own schedules, built from publicly documented tone layouts
 * Banned here and everywhere in the UI: "heals", "cures", "entrains your
 * brainwaves", "DNA repair", "chakra healing", "raises vibration". The site
 * makes no medical claim anywhere.
 */
(function () {
  "use strict";

  /* EEG band names. These are descriptive conventions from clinical
   * electroencephalography, used here only to say where a rate sits. */
  var BANDS = [
    { id: "delta", label: "delta", from: 0.5, to: 4, note: "the slowest band; the rate of deep sleep" },
    { id: "theta", label: "theta", from: 4, to: 8, note: "the drowsy / drifting band" },
    { id: "alpha", label: "alpha", from: 8, to: 13, note: "the relaxed, eyes-closed band" },
    { id: "smr", label: "SMR", from: 13, to: 15, note: "sensorimotor rhythm, 12-15 Hz" },
    { id: "beta", label: "beta", from: 15, to: 30, note: "the ordinary waking band" },
    { id: "gamma", label: "gamma", from: 30, to: 100, note: "the fast band; 40 Hz is the one usually named" }
  ];
  var SUB_DELTA = { id: "subdelta", label: "below delta", from: 0, to: 0.5,
                    note: "slower than any EEG band — this is a paced-breathing or slow-throb rate, not a brainwave band" };
  function bandOf(hz) {
    if (!isFinite(hz) || hz <= 0) return null;
    if (hz < SUB_DELTA.to) return SUB_DELTA;
    for (var i = 0; i < BANDS.length; i++) if (hz >= BANDS[i].from && hz < BANDS[i].to) return BANDS[i];
    return hz >= 100 ? null : BANDS[0];
  }

  /* Groups of quick-pick rates. `kind` decides what a click builds:
   *   "binaural" — a binaural pair (carrier + this rate), headphones
   *   "iso"      — isochronic pulses at this rate (speaker-safe)
   *   "tone"     — a steady carrier at this exact frequency (solfeggio/historic)
   *   "monaural" — two steady carriers `hz` apart, beating in room air */
  var GROUPS = [
    {
      id: "bands",
      name: "Brainwave bands (a rate for each named band)",
      blurb: "Band names are descriptive EEG conventions: they say where a rate sits on the " +
             "scale clinicians use, not that listening puts you there.",
      items: [
        { hz: 2.5, name: "Slow delta-range", kind: "iso", status: "practice", note: "a very slow throb for winding down; well below conversational pace" },
        { hz: 4, name: "Delta-range", kind: "iso", status: "practice", note: "the edge of the slowest band" },
        { hz: 6, name: "Theta-range", kind: "iso", status: "practice", note: "the drowsy band" },
        { hz: 7.83, name: "Alpha-range (low)", kind: "iso", status: "physics", note: "also the Schumann fundamental — see the Schumann group" },
        { hz: 10, name: "Alpha-range (mid)", kind: "iso", status: "practice", note: "a steady ten a second; the classic alpha-range rate" },
        { hz: 13.5, name: "SMR-range", kind: "iso", status: "practice", note: "sensorimotor rhythm territory" },
        { hz: 18, name: "Beta-range (low)", kind: "iso", status: "practice", note: "alert but unhurried" },
        { hz: 40, name: "Gamma-range (40 Hz)", kind: "iso", status: "practice", note: "40 Hz is the rate used in the visual/auditory gamma-stimulation research; that work used light and clicks together, not a consumer tone generator" }
      ]
    },
    {
      id: "schumann",
      name: "Schumann resonances (measured electromagnetic resonances)",
      blurb: "The Schumann resonances are real: electromagnetic standing waves in the cavity " +
             "between the Earth's surface and the ionosphere, measured since the 1950s. Playing " +
             "an audio tone at one of those numbers is a representation of the number, not a " +
             "connection to the cavity.",
      items: [
        { hz: 7.83, name: "7.83 Hz — fundamental", kind: "iso", status: "physics", note: "the first mode, around 7.8 Hz and drifting with ionospheric conditions" },
        { hz: 14.3, name: "14.3 Hz — second mode", kind: "iso", status: "physics", note: "measured near 14.3 Hz" },
        { hz: 20.8, name: "20.8 Hz — third mode", kind: "iso", status: "physics", note: "measured near 20.8 Hz" },
        { hz: 27.3, name: "27.3 Hz — fourth mode", kind: "iso", status: "physics", note: "measured near 27.3 Hz" },
        { hz: 33.8, name: "33.8 Hz — fifth mode", kind: "iso", status: "physics", note: "measured near 33.8 Hz" },
        { hz: 7.83, name: "7.83 Hz — monaural pair", kind: "monaural", status: "physics", note: "two steady carriers 7.83 Hz apart (e.g. 100 + 107.83); the beat happens in the air, so one speaker carries it" }
      ]
    },
    {
      id: "breathing",
      name: "Resonance breathing (breaths per minute)",
      blurb: "Slow paced breathing around six breaths a minute — about 0.1 Hz — is the rate at " +
             "which the cardiovascular system's own feedback loop is usually said to resonate. " +
             "The pacer in the studio's tools panel is the visual version of these entries.",
      items: [
        { hz: 0.1, name: "6 breaths/min (0.1 Hz)", kind: "iso", status: "practice", note: "the usual 'resonance frequency' rate in the HRV literature" },
        { hz: 0.0917, name: "5.5 breaths/min", kind: "iso", status: "practice", note: "the rate used in the Rosary/Ave Maria breathing studies" },
        { hz: 0.0833, name: "5 breaths/min", kind: "iso", status: "practice", note: "slower end of the paced-breathing range" },
        { hz: 0.125, name: "7.5 breaths/min", kind: "iso", status: "practice", note: "a gentler pace if six is uncomfortable" },
        { hz: 0.1, name: "0.1 Hz on a 200 Hz carrier", kind: "iso", status: "practice", note: "the same rate with a mid-band carrier that small speakers reproduce" }
      ]
    },
    {
      id: "focus",
      name: "Focus-level sets (our own schedules)",
      blurb: "Original tone schedules written for this site from publicly documented tone " +
             "layouts, named descriptively. No affiliation with, or material from, the Monroe " +
             "Institute or any other programme.",
      items: [
        { hz: 4, name: "Focus layout 10", kind: "binaural", status: "source", note: "100[1.5] / 200[4.0] / 250[4.0] / 300[4.0]" },
        { hz: 10, name: "Focus layout 12", kind: "binaural", status: "source", note: "adds 400[10.0] / 500[10.1] / 600[4.8]" },
        { hz: 7.05, name: "Focus layout 15", kind: "binaural", status: "source", note: "adds 500[7.05] / 630[7.1] / 750[7.0]" },
        { hz: 16.2, name: "Focus layout 21", kind: "binaural", status: "source", note: "200[4.0] / 250[5.4] / 300[5.4] / 600[16.2] / 750[16.2] / 900[16.2]" },
        { hz: 4, name: "Focus layout 27", kind: "binaural", status: "source", note: "50[0.80] / 400[4.0] / 503[4.2] / 600[4.0] / 750[4.0] / 900[4.0]" },
        { hz: 22, name: "Measured return signal", kind: "binaural", status: "source", note: "281.20 + 22.00 Hz, the measured return-to-waking pair rendered as a beat" }
      ]
    },
    {
      id: "solffeggio",
      name: "Solfeggio and other historical lists",
      blurb: "These numbers circulate as healing frequencies. Their provenance is a 1990s " +
             "book by Joseph Puleo and Leonard Horowitz, built on a numerological reading of " +
             "a hymn; the '528 Hz repairs DNA' line has no peer-reviewed support. They are " +
             "pleasant steady tones and interesting history. That is all this site claims.",
      items: [
        { hz: 174, name: "174 Hz", kind: "tone", status: "tradition", note: "the lowest of the set" },
        { hz: 285, name: "285 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 396, name: "396 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 417, name: "417 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 528, name: "528 Hz", kind: "tone", status: "tradition", note: "the one usually called the 'love frequency'" },
        { hz: 639, name: "639 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 741, name: "741 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 852, name: "852 Hz", kind: "tone", status: "tradition", note: "" },
        { hz: 963, name: "963 Hz", kind: "tone", status: "tradition", note: "the highest of the set" },
        { hz: 432, name: "A = 432 Hz", kind: "tone", status: "tradition", note: "a tuning-preference debate, not a frequency effect: orchestras have tuned all over the map historically and the audible difference is the ordinary one between two pitches" },
        { hz: 440, name: "A = 440 Hz", kind: "tone", status: "practice", note: "the modern concert-pitch standard" }
      ]
    },
    {
      id: "beds",
      name: "Noise beds (masking and texture)",
      blurb: "The three colours this engine can generate. Level-matched to each other, so a bed " +
             "written at one volume sounds equally loud whichever colour you pick. They are " +
             "stereo and independent per channel: in a mono fold-down they lose a few dB.",
      items: [
        { hz: 0, name: "Pink noise", kind: "pink", status: "practice", note: "-3 dB per octave; the standard broadband masking bed" },
        { hz: 0, name: "Brown noise", kind: "brown", status: "practice", note: "-6 dB per octave; deeper and softer, popular for sleep and for masking low-frequency rumble" },
        { hz: 0, name: "White noise", kind: "white", status: "practice", note: "flat across the spectrum; the brightest of the three" }
      ]
    }
  ];

  function find(kind) {
    var out = [];
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (!kind || it.kind === kind) out.push(it); }); });
    return out;
  }
  function byName(name) {
    var found = null;
    GROUPS.forEach(function (g) { g.items.forEach(function (it) { if (it.name === name) found = it; }); });
    return found;
  }

  var api = { BANDS: BANDS, bandOf: bandOf, GROUPS: GROUPS, find: find, byName: byName };
  if (typeof globalThis !== "undefined") globalThis.GnauralRates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
