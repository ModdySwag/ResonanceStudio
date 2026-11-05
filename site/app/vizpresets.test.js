/* Node tests for the visualiser SCENES (vizpresets.js).
 * Run:  node vizpresets.test.js
 *
 * A scene is only honest if its backdrop, its overlays and its palette all
 * exist in the real renderer. So the allowed ids are DERIVED here from
 * vizmodes.js and vizpal.js at run time — never a second hand-kept copy that
 * can drift away from the code the picker actually drives.
 *
 * The overlay cap of four is the kernel's own cap (viz.js setOverlays).
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* the real lists, straight from the modules that use them */
const MODES = require("./vizmodes.js");
const PAL = require("./vizpal.js");
eval(fs.readFileSync(path.join(__dirname, "vizpresets.js"), "utf8"));

const P = globalThis.GnauralVizPresets;
const BACKDROPS = MODES.BACKDROPS;
const OVERLAYS = MODES.OVERLAYS;
const PALETTES = PAL.PALETTES.map((p) => p.id);
const MAX_OVERLAYS = 4;
const WANTED = 24;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? " -> " + extra : "")); }
}

/* the fixture itself must be real, or every check below is vacuous */
check("mode list loads with backdrops and overlays",
  Array.isArray(BACKDROPS) && BACKDROPS.length > 0 && Array.isArray(OVERLAYS) && OVERLAYS.length > 0,
  "backdrops " + BACKDROPS + " / overlays " + OVERLAYS);
check("palette list loads from the real palette module",
  Array.isArray(PALETTES) && PALETTES.length > 0, PALETTES.join(" "));
check("the preset table is present", P && Array.isArray(P.LIST), typeof P);

const LIST = (P && Array.isArray(P.LIST)) ? P.LIST : [];

check(WANTED + " presets are shipped", LIST.length === WANTED, LIST.length);
check("every id is unique", new Set(LIST.map((s) => s.id)).size === LIST.length,
  LIST.map((s) => s.id).filter((id, i, a) => a.indexOf(id) !== i).join(" "));
check("every name is unique", new Set(LIST.map((s) => s.name)).size === LIST.length,
  LIST.map((s) => s.name).filter((n, i, a) => a.indexOf(n) !== i).join(" "));

let badBackdrop = [], badOverlay = [], dupOverlay = [], tooMany = [],
  badPalette = [], badIntensity = [], badCalm = [], badBlurb = [], badShape = [];

for (const s of LIST) {
  const id = s.id;
  if (!BACKDROPS.includes(s.backdrop)) badBackdrop.push(id + ":" + s.backdrop);
  if (!PALETTES.includes(s.palette)) badPalette.push(id + ":" + s.palette);
  if (typeof s.id !== "string" || !s.id) badShape.push(id + ":id");
  if (typeof s.name !== "string" || !s.name) badShape.push(id + ":name");
  if (!Array.isArray(s.overlays)) { badShape.push(id + ":overlays not an array"); }
  else {
    for (const o of s.overlays) if (!OVERLAYS.includes(o)) badOverlay.push(id + ":" + o);
    if (new Set(s.overlays).size !== s.overlays.length) dupOverlay.push(id + ":" + s.overlays.join(","));
    if (s.overlays.length > MAX_OVERLAYS) tooMany.push(id + ":" + s.overlays.length);
  }
  if (typeof s.intensity !== "number" || !(s.intensity >= 0 && s.intensity <= 1)) badIntensity.push(id + ":" + s.intensity);
  if (typeof s.calm !== "number" || !(s.calm >= 0.6 && s.calm <= 1.0)) badCalm.push(id + ":" + s.calm);
  if (typeof s.blurb !== "string" || s.blurb.length < 12) badBlurb.push(id + ":" + (s.blurb || "").length);
}

check("every backdrop is a real backdrop", badBackdrop.length === 0, badBackdrop.join(" "));
check("every overlay is a real overlay", badOverlay.length === 0, badOverlay.join(" "));
check("no preset repeats an overlay", dupOverlay.length === 0, dupOverlay.join(" "));
check("no preset has more than " + MAX_OVERLAYS + " overlays", tooMany.length === 0, tooMany.join(" "));
check("every preset shape is well formed", badShape.length === 0, badShape.join(" "));
check("every palette exists", badPalette.length === 0, badPalette.join(" "));
check("every intensity sits inside 0..1", badIntensity.length === 0, badIntensity.join(" "));
check("every calm sits inside 0.6..1.0", badCalm.length === 0, badCalm.join(" "));
check("every blurb is at least 12 characters", badBlurb.length === 0, badBlurb.join(" "));

/* the table must not collapse back into one template */
const backdropsUsed = new Set(LIST.map((s) => s.backdrop));
const palettesUsed = new Set(LIST.map((s) => s.palette));
check("at least 5 distinct backdrops are used", backdropsUsed.size >= 5,
  backdropsUsed.size + ": " + [...backdropsUsed].join(" "));
check("at least 4 distinct palettes are used", palettesUsed.size >= 4,
  palettesUsed.size + ": " + [...palettesUsed].join(" "));

/* lookup + traversal */
check("byId finds a known preset", P && P.byId("quiet-tide") && P.byId("quiet-tide").name === "Quiet Tide");
check("byId misses cleanly", P && P.byId("no-such-preset") === null, P && P.byId("no-such-preset"));

const firstId = LIST[0] && LIST[0].id;
const lastId = LIST.length ? LIST[LIST.length - 1].id : undefined;
check("step() wraps forward off the end", P && P.step(lastId, 1).id === firstId);
check("step() wraps back past the start", P && P.step(firstId, -1).id === lastId);

const excluded = firstId;
check("random() never returns the excluded preset over 60 draws",
  P && Array.from({ length: 60 }, () => P.random(excluded)).every((s) => s && s.id !== excluded),
  excluded);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
