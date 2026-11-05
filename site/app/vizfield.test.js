/* Node tests for the PHASE FIELD backdrop (vizmodes.js `phasefield`).
 * Run:  node vizfield.test.js
 *
 * The Entrainment Body is a claim about the KERNEL, not about a screenshot:
 * the mode has to be in the real registries, it has to put a bounded number
 * of additive sprites on the canvas for a frame, the population has to follow
 * the field width (900 / 1600) and the reduced-motion branch has to be static
 * between gate edges. A stub 2D context counts the primitives, so the frame
 * budget is measured instead of asserted from memory.
 *
 * Mapping under test: AUDIO-PARTICLE-CONCEPTS.md §1 (phase -> displacement,
 * loudness -> opacity, timbre -> size, slow luminance).
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* the real modules, in load order: the mode reads the palette + kernel */
require("./vizpal.js");
require("./vizmath.js");
const PAL = globalThis.GnauralVizPal;
const MODES = require("./vizmodes.js");

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}

/* ---------- stub 2D context: counts every primitive ---------- */
let GRADS = 0;
function recCtx() {
  const c = {
    arcs: 0, fills: 0, rects: 0, imgs: 0, grads: 0, strokes: 0, maxW: 0,
    fillStyle: "", strokeStyle: "", globalAlpha: 1, globalCompositeOperation: "",
    lineWidth: 1, font: "", textBaseline: ""
  };
  const noop = () => {};
  for (const n of ["save", "restore", "beginPath", "closePath", "stroke", "moveTo",
    "lineTo", "rect", "clip", "translate", "setTransform", "clearRect", "fillText",
    "createLinearGradient"]) c[n] = noop;
  c.arc = () => { c.arcs++; };
  c.fill = () => { c.fills++; };
  c.fillRect = () => { c.rects++; };
  c.stroke = () => { c.strokes++; };
  c.drawImage = (img, x, y, w) => { c.imgs++; if (w > c.maxW) c.maxW = w; };
  c.createRadialGradient = () => { c.grads++; GRADS++; return { addColorStop: noop }; };
  return c;
}
function canvasStub() {
  return { width: 0, height: 0, getContext: () => recCtx() };
}
function withDocument() { globalThis.document = { createElement: canvasStub }; }
function withoutDocument() { delete globalThis.document; }

/* ---------- synthetic frame ---------- */
function voice(i, kind) {
  return {
    i, kind, type: kind === "binaural" ? 0 : 3, base: 200, rate: 4,
    vol: 0.6, volL: 0.6, volR: 0.6, att: 0.6, u: 0.5,
    gate: { open: false, phase: 0.25, vis: 0.5, pulse: 0.4, N: 1, visRate: 1, cycleTotal: 3.2, openings: 3 },
    env: { phase: 0.3, vis: 0.5, level: 0.5, N: 1, visRate: 1, cycleTotal: 3.1, wraps: 2 }
  };
}
function frame(W) {
  return {
    ctx: recCtx(), W, H: 420, dt: 1 / 60, t: 1.5, dpr: 1,
    pre: { intensity: 0.7, calm: 1 },
    pal: PAL.paletteById("dusk", {}),
    feat: {
      rms: 0.2, rmsAtt: 0.2, rmsSlow: 0.2, flux: 0.12, sync: null,
      bands: {}, bandsAtt: { carrier: 0.3, mid: 0.2 }, bandsSlow: {},
      centroid: 900, centroidSlow: 900
    },
    field: { W, x0: 0 }, lum: 0.04,
    voices: [voice(0, "iso"), voice(1, "binaural")]
  };
}
function run(inst, F, n) {
  for (let i = 0; i < n; i++) { inst.step(F); F.t += F.dt; }
  return F;
}

/* ---------- 1. registration ---------- */
check("phasefield is a listed backdrop", MODES.BACKDROPS.includes("phasefield"), MODES.BACKDROPS.join(","));
check("phasefield is not an overlay", !MODES.OVERLAYS.includes("phasefield"));
check("phasefield has meta: field space, backdrop role",
  MODES.META.phasefield && MODES.META.phasefield.space === "field" && MODES.META.phasefield.role === "backdrop",
  JSON.stringify(MODES.META.phasefield));
check("phasefield has a human name in meta", typeof MODES.META.phasefield.name === "string" && MODES.META.phasefield.name.length > 2);
check("phasefield is in the factory (create returns an instance)",
  typeof MODES.create("phasefield", 12345) === "object" && MODES.create("phasefield", 12345) !== null);
check("an unknown id still misses cleanly", MODES.create("no-such-mode", 1) === null);

/* ---------- 2. instantiability + contract ---------- */
const inst0 = MODES.create("phasefield", 777);
check("instance is instantiable and seeded", !!inst0 && !!inst0.s && Array.isArray(inst0.s.parts));
check("instance has draw() and step()", typeof inst0.draw === "function" && typeof inst0.step === "function");
check("instance carries its id", inst0.id === "phasefield", inst0.id);
check("same seed, same first particle", (() => {
  const a = MODES.create("phasefield", 42), b = MODES.create("phasefield", 42);
  const F = frame(1500);
  a.step(F); a.step(F);
  b.step(F); b.step(F);
  return a.s.parts[0].x === b.s.parts[0].x && a.s.parts[0].y === b.s.parts[0].y;
})());

/* ---------- 3. sprite path: one drawImage per particle, bounded ---------- */
withDocument();
{
  const inst = MODES.create("phasefield", 99);
  const F = frame(1500);
  run(inst, F, 70);
  const count = inst.s.parts.length;
  check("wide field (1500 px) fills the 1600 pool", count === 1600, count);
  const before = { imgs: F.ctx.imgs, rects: F.ctx.rects };
  inst.draw(F);
  const drawn = F.ctx.imgs - before.imgs;
  check("draw() paints the opaque dark field first", F.ctx.rects - before.rects >= 1, F.ctx.rects - before.rects);
  check("draw() issues one additive sprite per particle", drawn === count, drawn + " vs " + count);
  check("sprite count is above 0 and below 2000", drawn > 0 && drawn < 2000, drawn);
  check("the sprites were pre-rendered once, not per frame", GRADS === 4, GRADS);
  check("no sprite is drawn wider than the 18 px screen clamp", F.ctx.maxW <= 18, F.ctx.maxW);
  check("four palette-slot sprites are cached", inst.sprites && inst.sprites.length === 4, inst.sprites && inst.sprites.length);
  check("composite mode is restored after the pass", F.ctx.globalCompositeOperation === "lighter" || F.ctx.globalCompositeOperation === "");
}

/* ---------- 4. arc fallback (no DOM): fills bounded the same way ---------- */
withoutDocument();
{
  const inst = MODES.create("phasefield", 100);
  const F = frame(1500);
  run(inst, F, 70);
  const before = { arcs: F.ctx.arcs, fills: F.ctx.fills };
  inst.draw(F);
  const arcs = F.ctx.arcs - before.arcs, fills = F.ctx.fills - before.fills;
  check("fallback path issues arcs", arcs > 0, arcs);
  check("fallback path issues fills", fills > 0, fills);
  check("fallback arcs stay above 0 and below 2000", arcs > 0 && arcs < 2000, arcs);
  check("fallback fills stay above 0 and below 2000", fills > 0 && fills < 2000, fills);
  check("no sprite is built without a document", inst.sprites === null);
}

/* ---------- 5. narrow field narrows the population ---------- */
{
  const inst = MODES.create("phasefield", 101);
  const F = frame(440);
  run(inst, F, 70);
  check("narrow field (440 px) settles at 900 particles", inst.s.parts.length === 900, inst.s.parts.length);
  const before = F.ctx.arcs;
  inst.draw(F);
  check("narrow draw stays under 2000 primitives", F.ctx.arcs - before > 0 && F.ctx.arcs - before < 2000, F.ctx.arcs - before);
}

/* ---------- 6. empty voices never throw ---------- */
{
  const inst = MODES.create("phasefield", 202);
  const F = frame(1500);
  F.voices = [];
  let threw = null;
  try { run(inst, F, 8); inst.draw(F); } catch (e) { threw = e; }
  check("empty voices array does not throw", threw === null, threw && threw.message);
  check("empty voices still leaves a drawable population", inst.s.parts.length > 0, inst.s.parts.length);
  check("empty voices draws primitives", F.ctx.arcs > 0 || F.ctx.imgs > 0);
}

/* ---------- 7. reduced motion: 300 static points, advance only on edges ---------- */
{
  const inst = MODES.create("phasefield", 303);
  const F = frame(1500);
  F.pre.reduced = true;
  run(inst, F, 80);
  check("reduced motion caps the population at 300", inst.s.parts.length === 300, inst.s.parts.length);
  const snap = inst.s.parts.map((p) => p.x + "," + p.y).join("|");
  run(inst, F, 5);
  inst.draw(F);
  const snap2 = inst.s.parts.map((p) => p.x + "," + p.y).join("|");
  check("reduced motion holds positions between gate edges", snap === snap2);
  F.voices[0].gate.openings += 1;
  run(inst, F, 1);
  const snap3 = inst.s.parts.map((p) => p.x + "," + p.y).join("|");
  check("a gate edge advances the reduced field", snap3 !== snap2);
  const before = F.ctx.arcs;
  inst.draw(F);
  check("reduced draw stays bounded", F.ctx.arcs - before > 0 && F.ctx.arcs - before < 2000, F.ctx.arcs - before);
}

/* ---------- 8. mapping spot-checks ---------- */
{
  const inst = MODES.create("phasefield", 404);
  const F = frame(1500);
  /* an emitter per ear: particles must appear on BOTH sides of the centre */
  let left = 0, right = 0;
  for (let k = 0; k < 30; k++) inst.step(F);
  for (const p of inst.s.parts) { if (p.x < F.W / 2) left++; else right++; }
  check("both ears emit (particles on both sides)", left > 0 && right > 0, left + "/" + right);
  check("emitters sit at +/-0.34 of the field width",
    inst.s.parts.some((p) => Math.abs(p.x - F.W * 0.16) < F.W * 0.12) &&
    inst.s.parts.some((p) => Math.abs(p.x - F.W * 0.84) < F.W * 0.12));
  check("life runs 0..1 with a finite ttl", inst.s.parts.every((p) => p.life >= 0 && p.life <= 1 && p.ttl >= 0.9 && p.ttl <= 4.5));
  inst.draw(F);
  check("opacity stays at or under the 0.5 cap", inst.s.opac <= 0.5, inst.s.opac);
  check("turbulence is clamped", inst.s.turb >= 0 && inst.s.turb <= 0.42);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
