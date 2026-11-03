/* Node tests for the cymatic FIELD layer (cymfield.js).
 * Run:  node cymfield.test.js
 *
 * These are the claims a screenshot cannot make: that the sand converges on
 * the nodal set, that the water family selector actually selects, and that a
 * bubble's Minnaert radius is the one the physics says.
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "cymatics.js"), "utf8"));
eval(fs.readFileSync(path.join(__dirname, "cymfield.js"), "utf8"));
const C = globalThis.GnauralCymatics;
const F = globalThis.GnauralCymField;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function close(a, b, tol) { return Math.abs(a - b) <= tol; }

/* ---------- 1. water medium ---------- */
{
  const m = F.waterMedium({ f: 60, size: 0.2 });
  check("60 Hz drive -> 8.61 mm Faraday wavelength", close(m.lambda * 1000, 8.61, 0.05), m.lambda * 1000);
  check("the true tank holds ~23 wavelengths at 200 mm", close(m.wavelengths, 0.2 / m.lambda, 1e-6), m.wavelengths);
  check("display is compressed to 12 wavelengths", m.displayWaves === 12, m.displayWaves);
  check("4 pattern families are present",
    ["stripe", "hex", "square", "quasi"].every(f => m.modes.some(x => x.family === f)));
  check("every wave satisfies |k| = k0",
    m.modes.every(x => close(Math.hypot(x.kx, x.ky), Math.PI * m.displayWaves, 1e-9)));

  const stripe = F.waterWeights(m, 0.05, 0).family;
  const square = F.waterWeights(m, 0.65, 0).family;
  const quasi = F.waterWeights(m, 0.98, 0).family;
  check("low drive selects stripes", stripe.stripe > 0.8, JSON.stringify(stripe));
  check("mid drive selects squares over hexagons", square.square > square.hex && square.square > 0.5,
    JSON.stringify(square));
  check("high drive selects the quasi-crystal", quasi.quasi > 0.5, JSON.stringify(quasi));
}

/* ---------- 2. Ritz mode grid ---------- */
{
  const med = C.squarePlateModes({ material: "steel", size: 0.3, thickness: 0.001, keep: 3 });
  const g = F.ritzGrid(med.modes[0], 64);
  let mn = 1e9, mx = -1e9, neg = 0, pos = 0;
  for (let i = 0; i < g.length; i++) { mn = Math.min(mn, g[i]); mx = Math.max(mx, g[i]); if (g[i] < -0.15) neg++; if (g[i] > 0.15) pos++; }
  check("mode-1 grid is a saddle: both signs present, symmetric extrema", neg > 50 && pos > 50 && close(mx, -mn, 1e-3), mn + ".." + mx);
  const fld0 = new F.Field(med, 64);
  fld0.setWeights(new Float64Array([1, 0, 0]), new Float64Array([0, 0, 0]));
  let gmax = 0; for (let q = 0; q < fld0.env.length; q++) gmax = Math.max(gmax, Math.abs(fld0.env[q]));
  check("Field normalises the rendered mode grid to max 1", close(gmax, 1, 1e-6), gmax);
  check("mode-1 nodal set is near the centre axes",
    Math.abs(g[32 * 64 + 32]) < 0.08, g[32 * 64 + 32]);
}

/* ---------- 3. Field: complex sum + envelope ---------- */
{
  const med = { kind: "water", geometry: "square", modes: [
    { i: 0, kx: Math.PI, ky: 0, phase: 0, f: 100, kind: "water" }
  ] };
  const f = new F.Field(med, 96);
  f.setWeights(new Float64Array([1]), new Float64Array([0]));
  check("field normalises its envelope to max 1", close(Math.max.apply(null, Array.from(f.env)), 1, 1e-6));
  check("envelope is zero on the nodal lines (u = +-0.5)",
    f.envAt(-0.5, 0.3) < 0.05 && f.envAt(0.5, -0.2) < 0.05,
    f.envAt(-0.5, 0.3).toFixed(4) + "," + f.envAt(0.5, -0.2).toFixed(4));
  check("envelope is 1 at an antinode (u = 0)", close(f.envAt(0, 0.3), 1, 1e-3), f.envAt(0, 0.3));

  /* rotating the phase swaps height sign but never the envelope */
  /* sample an ANTINODE column (u ~ 0), not the nodal line */
  const h0 = f.heightAt(0)[48 * 96 + 47];
  const hp = f.heightAt(Math.PI)[48 * 96 + 47];
  check("height flips sign at phase pi, envelope unchanged", close(h0, -hp, 1e-4) && close(f.envAt(0, 0.3), 1, 1e-3), h0 + " / " + hp);
}

/* ---------- 4. sand converges on nodes ---------- */
{
  const med = { kind: "water", geometry: "square", modes: [
    { i: 0, kx: Math.PI, ky: 0, phase: 0, f: 100, kind: "water" }
  ] };
  const f = new F.Field(med, 128);
  f.setWeights(new Float64Array([1]), new Float64Array([0]));
  const sand = new F.Sand(400, 7);
  function meanEnv() {
    let s = 0, n = 0;
    for (let i = 0; i < sand.n; i++) {
      const rr = Math.hypot(sand.x[i], sand.y[i]);
      if (rr < 0.92) { s += f.envAt(sand.x[i], sand.y[i]); n++; }
    }
    return s / Math.max(1, n);
  }
  const before = meanEnv();
  for (let k = 0; k < 900; k++) sand.step(f, 1 / 60, 0.8, { strength: 12, damp: 0.12, jitter: 0.25 });
  const after = meanEnv();
  check("sand mean envelope falls towards the nodes (before " + before.toFixed(3) + " -> after " + after.toFixed(3) + ")",
    after < before * 0.45, after.toFixed(3));
  let onNodes = 0;
  for (let i = 0; i < sand.n; i++) if (f.envAt(sand.x[i], sand.y[i]) < 0.15) onNodes++;
  check("a majority of grains end up within 0.15 of the nodal set", onNodes / sand.n > 0.6, onNodes + "/" + sand.n);
}

/* ---------- 5. bubble physics ---------- */
{
  check("Minnaert radius at 440 Hz is 7.47 mm", close(F.Bubbles.resonantRadius(440) * 1000, 7.47, 0.02),
    F.Bubbles.resonantRadius(440) * 1000);
  check("Minnaert radius scales as 1/f", close(F.Bubbles.resonantRadius(880), F.Bubbles.resonantRadius(440) / 2, 1e-9));
  const tbl = [[50, 65.74], [100, 32.87], [200, 16.435], [440, 7.470], [1000, 3.287]];
  let rworst = 0;
  for (const [f, mm] of tbl) rworst = Math.max(rworst, Math.abs(F.Bubbles.resonantRadius(f) * 1000 - mm));
  check("resonant radius matches the research table (50 Hz..1 kHz, |err| < 0.01 mm)", rworst < 0.01, rworst);
  check("measured damping Q falls with frequency (58 -> 35)",
    F.Bubbles.bubbleQ(50) > F.Bubbles.bubbleQ(440) && F.Bubbles.bubbleQ(440) > F.Bubbles.bubbleQ(1000) &&
    close(F.Bubbles.bubbleQ(440), 42, 0.5), F.Bubbles.bubbleQ(440));

  const med = { kind: "water", geometry: "square", modes: [
    { i: 0, kx: Math.PI, ky: 0, phase: 0, f: 440, kind: "water" }
  ] };
  const f = new F.Field(med, 128);
  f.setWeights(new Float64Array([1]), new Float64Array([0]));
  const b = new F.Bubbles(300, 3);
  for (let k = 0; k < 700; k++) b.step(f, 1 / 60, 440, 0.9, { trap: 3, rise: 0.0 });
  let above = 0, glowN = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.rad[i] > F.Bubbles.resonantRadius(440)) above++;
    if (b.glow[i] > 0.25) glowN++;
  }
  check("population spans the resonant radius (bubbles on both sides of it)",
    above > b.n * 0.25 && above < b.n * 0.75, above + "/" + b.n);
  check("a visible minority is within the resonance line-width (2-40%)",
    glowN > b.n * 0.02 && glowN < b.n * 0.40, glowN + "/" + b.n);
  let smallOnNodes = 0, small = 0;
  for (let i = 0; i < b.n; i++) {
    if (b.rad[i] < F.Bubbles.resonantRadius(440)) {
      small++;
      if (f.envAt(b.x[i], b.y[i]) < 0.25) smallOnNodes++;
    }
  }
  check("sub-resonant bubbles collect on the nodal lines", small > 0 && smallOnNodes / small > 0.5,
    smallOnNodes + "/" + small);
  let glowOk = true;
  for (let i = 0; i < b.n; i++) if (!(b.glow[i] >= 0 && b.glow[i] <= 1.0001)) glowOk = false;
  check("resonance glow stays in [0,1]", glowOk);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
