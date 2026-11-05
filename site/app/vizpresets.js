/* Resonance Studio — VISUALISER SCENES.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Named looks for the ambient margin visualiser: backdrop + overlays + palette
 * + the two sliders, in one pick. Every id here must exist in vizmodes.js or
 * vizpal.js — `node vizpresets.test.js` proves that against the real lists.
 *
 * Overlays cap at four because that is the kernel's cap (viz.js setOverlays).
 * It is a table so the picker, the tests and the shuffle all read one source.
 */
(function () {
  "use strict";

  var LIST = [
    { id: "quiet-tide", name: "Quiet Tide", backdrop: "tide", overlays: [], palette: "dusk", intensity: 0.35, calm: 0.95,
      blurb: "Barely moving water line, no overlays, dim." },
    { id: "tide-and-pulse", name: "Tide and Pulse", backdrop: "tide", overlays: ["pulse"], palette: "auto", intensity: 0.60, calm: 0.85,
      blurb: "Water with one breath-following bar." },
    { id: "cold-drift", name: "Cold Drift", backdrop: "drift", overlays: [], palette: "ice", intensity: 0.45, calm: 1.00,
      blurb: "Slow drifting specks in cold light." },
    { id: "drift-meter", name: "Drift Meter", backdrop: "drift", overlays: ["meters"], palette: "mono", intensity: 0.55, calm: 0.90,
      blurb: "Drift under a plain band meter." },
    { id: "night-rain", name: "Night Rain", backdrop: "rainfall", overlays: [], palette: "mono", intensity: 0.50, calm: 0.95,
      blurb: "Falling streaks, nothing else." },
    { id: "rain-phasors", name: "Rain Phasors", backdrop: "rainfall", overlays: ["phasors"], palette: "ice", intensity: 0.55, calm: 0.80,
      blurb: "Rain with the phase dials over it." },
    { id: "score-card", name: "Score Card", backdrop: "score", overlays: [], palette: "dusk", intensity: 0.50, calm: 0.92,
      blurb: "The session drawn as a plain running score." },
    { id: "score-traces", name: "Score Traces", backdrop: "score", overlays: ["traces"], palette: "auto", intensity: 0.55, calm: 0.85,
      blurb: "Score with the voice traces on top." },
    { id: "aurora-low", name: "Aurora Low", backdrop: "aurora", overlays: [], palette: "moss", intensity: 0.40, calm: 1.00,
      blurb: "Green curtain, long and slow." },
    { id: "aurora-orbits", name: "Aurora Orbits", backdrop: "aurora", overlays: ["orbits"], palette: "auto", intensity: 0.55, calm: 0.88,
      blurb: "Aurora with slow orbital bodies." },
    { id: "ember-bed", name: "Ember Bed", backdrop: "tide", overlays: [], palette: "ember", intensity: 0.60, calm: 0.80,
      blurb: "Warm water line at the flashing cap." },
    { id: "ember-ripples", name: "Ember Ripples", backdrop: "tide", overlays: ["ripples"], palette: "ember", intensity: 0.65, calm: 0.75,
      blurb: "Heat colour with ripples spreading." },
    { id: "rose-ripples", name: "Rose Ripples", backdrop: "aurora", overlays: ["ripples"], palette: "rose", intensity: 0.55, calm: 0.90,
      blurb: "Soft rose ripples over a low curtain." },
    { id: "rose-weave", name: "Rose Weave", backdrop: "score", overlays: ["weave"], palette: "rose", intensity: 0.50, calm: 0.95,
      blurb: "Woven threads in muted pink." },
    { id: "phosphor", name: "Phosphor", backdrop: "drift", overlays: ["traces", "meters"], palette: "moss", intensity: 0.60, calm: 0.82,
      blurb: "Green traces and bars on dark." },
    { id: "lab-bench", name: "Lab Bench", backdrop: "score", overlays: ["meters", "traces"], palette: "mono", intensity: 0.60, calm: 0.85,
      blurb: "Everything readable at once, no colour." },
    { id: "harmonograph", name: "Harmonograph", backdrop: "off", overlays: ["harmonograph"], palette: "auto", intensity: 0.55, calm: 0.95,
      blurb: "Pure figure, no backdrop." },
    { id: "ripple-only", name: "Ripple Only", backdrop: "off", overlays: ["ripples"], palette: "ice", intensity: 0.50, calm: 1.00,
      blurb: "Only the rings, on the bare page." },
    { id: "orbits-only", name: "Orbits Only", backdrop: "off", overlays: ["orbits"], palette: "dusk", intensity: 0.45, calm: 1.00,
      blurb: "Bodies in orbit, nothing behind them." },
    { id: "weave-only", name: "Weave Only", backdrop: "off", overlays: ["weave"], palette: "moss", intensity: 0.50, calm: 0.95,
      blurb: "Threads alone, sparse and calm." },
    { id: "phasor-pair", name: "Phasor Pair", backdrop: "off", overlays: ["phasors"], palette: "rose", intensity: 0.55, calm: 0.90,
      blurb: "Two phase dials, bare page." },
    { id: "double-up", name: "Double Up", backdrop: "aurora", overlays: ["pulse", "orbits", "meters"], palette: "auto", intensity: 0.70, calm: 0.75,
      blurb: "Pulse, orbits and a meter over a curtain." },
    { id: "full-stack", name: "Full Stack", backdrop: "drift", overlays: ["pulse", "traces", "meters", "ripples"], palette: "auto", intensity: 0.80, calm: 0.70,
      blurb: "Four overlays, the busiest legal scene." },
    { id: "flashy", name: "Flashy", backdrop: "tide", overlays: ["pulse", "meters"], palette: "ember", intensity: 0.95, calm: 0.60,
      blurb: "Maximum intensity at the 1 Hz cap." }
  ];

  var BY = {};
  for (var i = 0; i < LIST.length; i++) BY[LIST[i].id] = LIST[i];

  globalThis.GnauralVizPresets = {
    version: 1,
    LIST: LIST,
    byId: function (id) { return BY[id] || null; },
    step: function (id, dir) {
      var k = -1;
      for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) { k = i; break; }
      if (k < 0) k = 0;
      return LIST[(k + (dir || 1) + LIST.length) % LIST.length];
    },
    random: function (not) {
      if (LIST.length < 2) return LIST[0];
      var p;
      do { p = LIST[Math.floor(Math.random() * LIST.length)]; } while (p.id === not);
      return p;
    }
  };
})();
