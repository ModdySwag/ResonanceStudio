/* Resonance Studio — CYMATIC SCENES.
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Thirty tuned scenes for the chamber: each one sets the medium, material and
 * plate dimensions, a REAL mode index (the app resolves it to that mode's own
 * frequency, so every preset lands on a genuine resonance instead of a
 * near-miss), the palette, the camera and the layer flags.
 *
 * DOM-free and dependency-free on purpose: `node cympresets.test.js` builds
 * every scene through cymatics.js and asserts the resolved mode exists.
 *
 * mode is an index into the medium's own spectrum and is kept small (1..13) so
 * it survives whatever material/size the caller brings. Water modes all carry
 * the drive frequency, so a water scene's index is cosmetic.
 *
 * CAMERA VARIETY IS PART OF THE DESIGN, not decoration: no two scenes share a
 * yaw/pitch/distance family, because five centred oblique plates at the same
 * fill height read as one preset recoloured. Plate size spreads for the same
 * reason.
 */
(function () {
  "use strict";

  var LIST = [
    /* ---- free plate ---- */
    { id: "cold-forge", name: "Cold Forge", medium: "plate", material: "steel", size: 380, thickness: 1.6, q: 95,
      palette: "gunmetal", mode: 10, drive: 0.70, speed: 0.40, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: 1.35, pitch: 1.05, dist: 4.10 }, blurb: "Cold bare steel, tall and distant, high mode." },
    { id: "ember-grid", name: "Ember Grid", medium: "plate", material: "copper", size: 230, thickness: 0.7, q: 110,
      palette: "ember", mode: 5, drive: 0.86, speed: 0.55, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.10, pitch: 0.46, dist: 2.60 }, blurb: "Thin copper at high selectivity, burning orange." },
    { id: "ultraviolet-room", name: "Ultraviolet Room", medium: "plate", material: "glass", size: 420, thickness: 0.6, q: 120,
      palette: "ultraviolet", mode: 6, drive: 0.80, speed: 0.40, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -1.45, pitch: 0.62, dist: 3.15 }, blurb: "Big glass sheet under a black light." },
    { id: "salt-flat", name: "Salt Flat", medium: "plate", material: "aluminium", size: 520, thickness: 1.4, q: 70,
      palette: "solar", mode: 2, drive: 0.62, speed: 0.30, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.18, pitch: 1.22, dist: 5.40 }, blurb: "Low and wide: a huge soft plate, sun-bleached." },
    { id: "toxic-bloom", name: "Toxic Bloom", medium: "plate", material: "brass", size: 220, thickness: 0.5, q: 130,
      palette: "toxic", mode: 8, drive: 0.90, speed: 0.60, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.92, pitch: 0.80, dist: 3.05 }, blurb: "Thin brass, acid green, dense figure." },
    { id: "cathedral", name: "Cathedral", medium: "plate", material: "steel", size: 600, thickness: 2.4, q: 60,
      palette: "mono", mode: 1, drive: 0.50, speed: 0.22, sand: true, lines: true, bubbles: false, dust: false,
      cam: { yaw: 1.15, pitch: 1.12, dist: 5.20 }, blurb: "Thick, dark, slow. One low mode, no dust." },
    { id: "lagoon-drift", name: "Lagoon Drift", medium: "plate", material: "glass", size: 380, thickness: 1.1, q: 85,
      palette: "lagoon", mode: 4, drive: 0.66, speed: 0.35, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.62, pitch: 0.55, dist: 2.45 }, blurb: "Glass and shallow water colour." },
    { id: "orchid-field", name: "Orchid Field", medium: "plate", material: "acrylic", size: 330, thickness: 1.6, q: 100,
      palette: "orchid", mode: 7, drive: 0.84, speed: 0.50, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: 0.08, pitch: 0.72, dist: 3.45 }, blurb: "Acrylic rings at a violet pitch." },
    { id: "blood-iron", name: "Blood Iron", medium: "plate", material: "copper", size: 280, thickness: 1.8, q: 95,
      palette: "blood", mode: 9, drive: 0.88, speed: 0.42, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -1.18, pitch: 0.88, dist: 3.90 }, blurb: "Heavy copper, deep red nodes." },
    { id: "blossom", name: "Blossom", medium: "plate", material: "aluminium", size: 200, thickness: 0.4, q: 140,
      palette: "blossom", mode: 13, drive: 0.92, speed: 0.65, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: -0.55, pitch: 0.56, dist: 3.60 }, blurb: "Thin aluminium, high mode, petal pink." },

    /* ---- centre-bolted plate ---- */
    { id: "machine-room", name: "Machine Room", medium: "bolted", material: "steel", size: 320, thickness: 1.2, q: 100,
      palette: "neon", mode: 4, drive: 0.78, speed: 0.48, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.72, pitch: 0.66, dist: 3.70 }, blurb: "Bolted steel under cold blue light." },
    { id: "magma-bolt", name: "Magma Bolt", medium: "bolted", material: "steel", size: 300, thickness: 1.0, q: 120,
      palette: "magma", mode: 6, drive: 0.85, speed: 0.55, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.30, pitch: 0.55, dist: 2.60 }, blurb: "Molten lattice around a fixed centre." },
    { id: "candy-rig", name: "Candy Rig", medium: "bolted", material: "brass", size: 300, thickness: 0.8, q: 115,
      palette: "candy", mode: 5, drive: 0.82, speed: 0.60, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: 1.02, pitch: 0.68, dist: 2.25 }, blurb: "Sugared brass, sweet and loud." },
    { id: "aurora-bolt", name: "Aurora Bolt", medium: "bolted", material: "aluminium", size: 380, thickness: 0.9, q: 90,
      palette: "aurora", mode: 3, drive: 0.70, speed: 0.38, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.86, pitch: 0.95, dist: 3.85 }, blurb: "Polar green on a wide bolted plate." },
    { id: "iron-weather", name: "Iron Weather", medium: "bolted", material: "steel", size: 440, thickness: 2.0, q: 65,
      palette: "ice", mode: 2, drive: 0.55, speed: 0.28, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.10, pitch: 1.18, dist: 4.60 }, blurb: "Thick plate, slow weather, pale light." },

    /* ---- clamped disc ---- */
    { id: "solar-disc", name: "Solar Disc", medium: "disc", material: "brass", size: 240, thickness: 0.8, q: 110,
      palette: "solar", mode: 4, drive: 0.86, speed: 0.50, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.62, pitch: 1.00, dist: 3.80 }, blurb: "Brass disc at noon." },
    { id: "deep-lagoon", name: "Deep Lagoon", medium: "disc", material: "glass", size: 300, thickness: 0.7, q: 125,
      palette: "ice", mode: 3, drive: 0.74, speed: 0.36, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: -0.55, pitch: 0.62, dist: 2.80 }, blurb: "Bessel rings, pale water." },
    { id: "violet-vault", name: "Violet Vault", medium: "disc", material: "steel", size: 260, thickness: 1.0, q: 135,
      palette: "ultraviolet", mode: 6, drive: 0.90, speed: 0.45, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.75, pitch: 0.38, dist: 1.95 }, blurb: "Small stiff disc, violet, tight rings." },
    { id: "neon-plate", name: "Neon Plate", medium: "disc", material: "aluminium", size: 210, thickness: 0.5, q: 130,
      palette: "neon", mode: 5, drive: 0.88, speed: 0.58, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.20, pitch: 0.85, dist: 3.30 }, blurb: "Electric blue, thin aluminium." },
    { id: "ash-coin", name: "Ash Coin", medium: "disc", material: "copper", size: 160, thickness: 1.4, q: 80,
      palette: "mono", mode: 2, drive: 0.60, speed: 0.25, sand: true, lines: true, bubbles: false, dust: false,
      cam: { yaw: 1.28, pitch: 0.50, dist: 1.65 }, blurb: "Small, heavy, grey: a struck coin." },

    /* ---- membrane drum ---- */
    { id: "skin-tight", name: "Skin Tight", medium: "drum", material: "steel", size: 300, thickness: 1.0, q: 95,
      palette: "verdigris", mode: 3, drive: 0.80, speed: 0.50, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 0.40, pitch: 0.58, dist: 2.70 }, blurb: "A struck head, green patina." },
    { id: "toxic-membrane", name: "Toxic Membrane", medium: "drum", material: "steel", size: 240, thickness: 1.0, q: 120,
      palette: "toxic", mode: 5, drive: 0.90, speed: 0.62, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: -0.80, pitch: 0.46, dist: 2.30 }, blurb: "Fast drum figure, acid bright." },
    { id: "blood-drum", name: "Blood Drum", medium: "drum", material: "steel", size: 360, thickness: 1.0, q: 85,
      palette: "blood", mode: 2, drive: 0.75, speed: 0.34, sand: true, lines: true, bubbles: false, dust: true,
      cam: { yaw: 1.05, pitch: 0.75, dist: 3.20 }, blurb: "Deep red membrane, slow beat." },
    { id: "candy-skin", name: "Candy Skin", medium: "drum", material: "steel", size: 200, thickness: 1.0, q: 140,
      palette: "candy", mode: 6, drive: 0.92, speed: 0.66, sand: true, lines: true, bubbles: true, dust: true,
      cam: { yaw: 0.22, pitch: 0.42, dist: 2.00 }, blurb: "Small head, high mode, pink glare." },

    /* ---- water (Faraday) ---- */
    { id: "faraday-storm", name: "Faraday Storm", medium: "water", material: "steel", size: 220, thickness: 1.0, q: 90,
      palette: "ion", mode: 0, hz: 60, drive: 0.90, speed: 0.55, sand: false, lines: true, bubbles: true, dust: true,
      cam: { yaw: -1.30, pitch: 0.66, dist: 2.50 }, blurb: "60 Hz: the classic 8.6 mm Faraday lattice, ion blue." },
    { id: "black-water", name: "Black Water", medium: "water", material: "steel", size: 200, thickness: 1.0, q: 90,
      palette: "mono", mode: 0, hz: 42, drive: 0.62, speed: 0.30, sand: false, lines: true, bubbles: true, dust: false,
      cam: { yaw: 0.48, pitch: 1.05, dist: 3.55 }, blurb: "Low drive, long wavelength, no colour at all." },
    { id: "ember-pool", name: "Ember Pool", medium: "water", material: "steel", size: 240, thickness: 1.0, q: 90,
      palette: "ember", mode: 0, hz: 75, drive: 0.95, speed: 0.60, sand: false, lines: true, bubbles: true, dust: true,
      cam: { yaw: 0.95, pitch: 0.38, dist: 2.15 }, blurb: "75 Hz capillary lattice, molten." },
    { id: "aurora-ripple", name: "Aurora Ripple", medium: "water", material: "steel", size: 180, thickness: 1.0, q: 90,
      palette: "aurora", mode: 0, hz: 110, drive: 0.88, speed: 0.48, sand: false, lines: true, bubbles: true, dust: true,
      cam: { yaw: -0.45, pitch: 0.60, dist: 2.40 }, blurb: "Fast, fine waves in polar green." },

    /* ---- bubbles ---- */
    { id: "minnaert-cloud", name: "Minnaert Cloud", medium: "bubbles", material: "steel", size: 150, thickness: 1.0, q: 100,
      palette: "abyss", mode: 1, drive: 0.92, speed: 0.34, q: 120, sand: false, lines: true, bubbles: false, dust: true,
      cam: { yaw: -0.05, pitch: 0.36, dist: 2.70 }, blurb: "Air in water: the resonant minority glows." },
    { id: "orchid-fizz", name: "Orchid Fizz", medium: "bubbles", material: "steel", size: 150, thickness: 1.0, q: 130,
      palette: "orchid", mode: 4, drive: 0.90, speed: 0.52, sand: false, lines: true, bubbles: true, dust: true,
      cam: { yaw: -0.62, pitch: 0.50, dist: 1.95 }, blurb: "Violet fizz, bubbles crowding the nodes." }
  ];

  var BY = {};
  for (var i = 0; i < LIST.length; i++) BY[LIST[i].id] = LIST[i];

  globalThis.GnauralCymPresets = {
    version: 1,
    LIST: LIST,
    byId: function (id) { return BY[id] || null; },
    /* next/prev by id so a shuffle never repeats what is on screen */
    step: function (id, dir) {
      var k = LIST.findIndex ? LIST.findIndex(function (p) { return p.id === id; }) : -1;
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
