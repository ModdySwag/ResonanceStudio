/* Node tests for the cymatic SCENES (cympresets.js).
 * Run:  node cympresets.test.js
 *
 * A scene is only honest if it lands on a real mode of its own medium. Every
 * preset is built here through cymatics.js/cymfield.js and its mode index is
 * resolved the way the UI resolves it.
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "cymatics.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "cymfield.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "cympresets.js"), "utf8"));
const C = globalThis.GnauralCymatics;
const F = globalThis.GnauralCymField;
const P = globalThis.GnauralCymPresets;

const PALETTES = ["champagne", "ion", "copper", "verdigris", "ice", "mono",
  "ember", "magma", "orchid", "ultraviolet", "toxic", "candy",
  "aurora", "solar", "neon", "blood", "lagoon", "blossom", "cobalt", "gunmetal", "abyss"];
const MEDIA = ["plate", "bolted", "disc", "drum", "water", "bubbles"];

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

check("30 scenes are shipped", P.LIST.length === 30, P.LIST.length);
check("every id is unique", new Set(P.LIST.map((s) => s.id)).size === P.LIST.length);
check("every name is unique", new Set(P.LIST.map((s) => s.name)).size === P.LIST.length);

let badPal = [], badMedium = [], badRange = [], noBlurb = [], resolvedBad = [];
for (const s of P.LIST) {
  if (!PALETTES.includes(s.palette)) badPal.push(s.id + ":" + s.palette);
  if (!MEDIA.includes(s.medium)) badMedium.push(s.id + ":" + s.medium);
  if (!s.blurb || s.blurb.length < 12) noBlurb.push(s.id);
  if (!(s.size >= 80 && s.size <= 600)) badRange.push(s.id + ":size " + s.size);
  if (!(s.thickness >= 0.3 && s.thickness <= 3)) badRange.push(s.id + ":thick " + s.thickness);
  if (!(s.q >= 8 && s.q <= 140)) badRange.push(s.id + ":q " + s.q);
  if (!(s.drive >= 0 && s.drive <= 1)) badRange.push(s.id + ":drive " + s.drive);
  if (!(s.cam && s.cam.dist >= 1.35 && s.cam.dist <= 6)) badRange.push(s.id + ":dist " + (s.cam && s.cam.dist));
  if (!(s.cam && s.cam.yaw >= -Math.PI && s.cam.yaw <= Math.PI)) badRange.push(s.id + ":yaw " + (s.cam && s.cam.yaw));
  if (!(s.cam && s.cam.pitch >= 0.2 && s.cam.pitch <= 1.4)) badRange.push(s.id + ":pitch " + (s.cam && s.cam.pitch));
  if (typeof s.sand !== "boolean" || typeof s.lines !== "boolean" ||
      typeof s.bubbles !== "boolean" || typeof s.dust !== "boolean") badRange.push(s.id + ":flags");

  // build exactly like buildMedium() does, then resolve like applyScene()
  let medium = null;
  const size = s.size / 1000, th = s.thickness / 1000;
  if (s.medium === "bolted") medium = C.boltedPlateModes({ material: s.material, size: size, thickness: th });
  else if (s.medium === "disc") medium = C.discModes({ material: s.material, size: size / 2, thickness: th });
  else if (s.medium === "drum") medium = C.membraneModes({ size: size / 2 });
  else if (s.medium === "plate") medium = C.squarePlateModes({ material: s.material, size: size, thickness: th, keep: 30 });
  else if (s.medium === "water") medium = F.waterMedium({ f: s.hz, size: size });
  else if (s.medium === "bubbles") medium = C.discModes({ material: "steel", size: 0.15, thickness: 0.0008 });

  if (!medium || !medium.modes.length) { resolvedBad.push(s.id + ":no modes"); continue; }
  const hz = s.hz || (medium.modes[Math.min(s.mode, medium.modes.length - 1)] || {}).f;
  if (!(hz > 20 && hz < 8000)) resolvedBad.push(s.id + ":hz " + hz);
  if (!s.hz && medium.fMin && (hz < medium.fMin * 0.999 || hz > medium.fMax * 1.001)) {
    resolvedBad.push(s.id + ":outside spectrum " + hz.toFixed(1) + " of " + medium.fMin.toFixed(1) + "-" + medium.fMax.toFixed(1));
  }
  if (s.medium === "water" && !(s.hz >= 40 && s.hz <= 1200)) resolvedBad.push(s.id + ":water hz " + s.hz);
}

check("every palette exists", badPal.length === 0, badPal.join(" "));
check("every medium exists", badMedium.length === 0, badMedium.join(" "));
check("every scene has a blurb", noBlurb.length === 0, noBlurb.join(" "));
check("every value sits inside its UI range", badRange.length === 0, badRange.join(" "));
check("every scene resolves to a real mode inside its own spectrum", resolvedBad.length === 0, resolvedBad.join(" "));

/* the media are actually varied, not thirty plates */
const byMedium = {};
for (const s of P.LIST) byMedium[s.medium] = (byMedium[s.medium] || 0) + 1;
check("all six media are represented", MEDIA.every((m) => byMedium[m] > 0), JSON.stringify(byMedium));
check("no medium dominates (<= 12 scenes)", MEDIA.every((m) => (byMedium[m] || 0) <= 12), JSON.stringify(byMedium));

/* water scenes must not carry sand, and must drive a real Faraday tone */
const water = P.LIST.filter((s) => s.medium === "water");
check("water scenes disable sand", water.every((s) => !s.sand), water.map((s) => s.id).join(" "));
check("water scenes carry an explicit drive frequency", water.every((s) => s.hz > 0));

check("byId finds a scene and misses cleanly", P.byId("ember-grid").name === "Ember Grid" && P.byId("nope") === null);
check("step() wraps forward and back", P.step(P.LIST[P.LIST.length - 1].id, 1).id === P.LIST[0].id &&
  P.step(P.LIST[0].id, -1).id === P.LIST[P.LIST.length - 1].id);
check("random() never returns the excluded scene",
  Array.from({ length: 60 }, () => P.random("cold-forge")).every((s) => s.id !== "cold-forge"));

/* the framing must not collapse back into one template: every pair of cameras
 * has to differ in yaw, pitch or distance by a visible margin */
let minPair = 99, minIds = "";
for (let i = 0; i < P.LIST.length; i++) {
  for (let j = i + 1; j < P.LIST.length; j++) {
    const a = P.LIST[i].cam, b = P.LIST[j].cam;
    const d = Math.hypot((a.yaw - b.yaw) / Math.PI, (a.pitch - b.pitch) / 1.2, (a.dist - b.dist) / 5);
    if (d < minPair) { minPair = d; minIds = P.LIST[i].id + " / " + P.LIST[j].id; }
  }
}
check("no two scenes share a camera (closest pair " + minIds + " at " + minPair.toFixed(3) + ")", minPair > 0.05, minPair);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
