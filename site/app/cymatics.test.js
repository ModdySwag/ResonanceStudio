/* Node tests for the cymatics physics engine (cymatics.js).
 * Run:  node cymatics.test.js      (from site/resonance/app/)
 *
 * The load-bearing claim under test: every primitive the visualiser uses is a
 * real special function or a real physical relation, checked against published
 * reference values — not a tuned approximation that only looks right.
 */
"use strict";
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "cymatics.js"), "utf8"));
const C = globalThis.GnauralCymatics;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FAIL " + label + (extra !== undefined ? "  -> " + extra : "")); }
}
function close(a, b, tol) { return Math.abs(a - b) <= tol; }

/* ---------- 1. Bessel J against published values ---------- */
{
  const cases = [
    [0, 1, 0.7651976865579666], [1, 1, 0.44005058574493355],
    [2, 1, 0.1149034849319005], [0, 10, -0.2459357644513483],
    [1, 10, 0.04347274616886144], [5, 10, -0.2340615282],
    [0, 30, -0.0863679831]
  ];
  let worst = 0;
  for (const [n, x, want] of cases) worst = Math.max(worst, Math.abs(C.besselJ(n, x) - want));
  check("J_n(x) matches published values (7 cases, |err| < 1e-9)", worst < 1e-9, "worst=" + worst);
}

/* ---------- 2. Modified Bessel I ---------- */
{
  check("I0(1) = 1.2660658778", close(C.besselI(0, 1), 1.2660658777520084, 1e-12), C.besselI(0, 1));
  check("I1(1) = 0.5651591040", close(C.besselI(1, 1), 0.5651591039924851, 1e-12), C.besselI(1, 1));
  check("I2(2) = 0.6889484477", close(C.besselI(2, 2), 0.6889484476987382, 1e-12), C.besselI(2, 2));
}

/* ---------- 3. J primes ---------- */
{
  check("J0'(x) = -J1(x)", close(C.besselJPrime(0, 2.5), -C.besselJ(1, 2.5), 1e-13));
  check("J1' has its first zero at 1.8411837813", Math.abs(C.besselJPrime(1, 1.8411837813)) < 1e-6,
    C.besselJPrime(1, 1.8411837813));
}

/* ---------- 4. Bessel zeros (computed by bisection, checked against tables) ---------- */
{
  const ref = {
    0: [2.4048255577, 5.5200781103, 8.6537279129, 11.7915344390],
    1: [3.8317059702, 7.0155866698, 10.1734681351, 13.3236919363],
    2: [5.1356223018, 8.4172441404, 11.6198411721, 14.7959517816],
    3: [6.3801618953, 9.7610231299, 13.0152007217, 16.2234661603],
    4: [7.5883424345, 11.0647094885, 14.3725366716]
  };
  let worst = 0, count = 0;
  for (const m in ref) {
    const got = C.besselZeros(+m, ref[m].length);
    for (let i = 0; i < ref[m].length; i++) { worst = Math.max(worst, Math.abs(got[i] - ref[m][i])); count++; }
  }
  check("Bessel zeros m=0..4 match tables (" + count + " zeros, |err| < 2e-7)", worst < 2e-7, "worst=" + worst);
  const rep = C.besselZeros(2, 3);
  check("Bessel zeros are cached identically", rep[0] === C.besselZeros(2, 3)[0] && rep.length === 3);
}

/* ---------- 5. Free-free beam eigenvalues and boundary conditions ---------- */
{
  const ref = [4.730040744862704, 7.853204624095838, 10.995607838001671, 14.137165491257464];
  let worst = 0;
  for (let m = 1; m <= 4; m++) worst = Math.max(worst, Math.abs(C.freeFreeBeta(m) - ref[m - 1]));
  check("free-free beam beta_1..4 match Leissa", worst < 1e-9, "worst=" + worst);
  check("sigma_1 = 0.9825022151", close(C.freeFreeSigma(1), 0.9825022151, 1e-9), C.freeFreeSigma(1));

  /* The free-edge SHEAR condition X'''(1) = 0, from the closed-form derivative
   * (finite-differencing it is hopeless: the terms are ~e^beta and cancel). */
  let edge2 = 0;
  for (let m = 1; m <= 4; m++) {
    const b = C.freeFreeBeta(m), s = C.freeFreeSigma(m);
    const x3 = Math.pow(b, 3) * ((Math.sinh(b) + Math.sin(b)) - s * (Math.cosh(b) - Math.cos(b)));
    edge2 = Math.max(edge2, Math.abs(x3) / Math.pow(b, 3));
  }
  check("free-edge shear condition X'''(1) = 0 holds for all four modes", edge2 < 1e-9, edge2);

  /* Structural check: the m-th free-free mode must have more sign changes
   * inside the beam than the (m-1)-th. */
  function nodes(m) {
    let n = 0, prev = C.freeFreeBeam(m, 1e-4);
    for (let i = 1; i < 4000; i++) {
      const v = C.freeFreeBeam(m, i / 4000);
      if (v * prev < 0) n++;
      prev = v;
    }
    return n;
  }
  const nc = [nodes(1), nodes(2), nodes(3), nodes(4)];
  check("mode node counts increase with mode order", nc[0] < nc[1] && nc[1] < nc[2] && nc[2] < nc[3], nc.join(","));

  /* sigma is DEFINED by the free-edge condition X''(1) = 0; check it holds. */
  let edge = 0;
  for (let m = 1; m <= 4; m++) {
    const b = C.freeFreeBeta(m), s = C.freeFreeSigma(m);
    edge = Math.max(edge, Math.abs((Math.cosh(b) - Math.cos(b)) - s * (Math.sinh(b) - Math.sin(b))));
  }
  check("free-edge moment condition X''(1) = 0 holds for all four modes", edge < 1e-9, edge);

  /* Orthogonality: integral of X_m X_n over [0,1] ~ 0 for m != n. */
  let orth = 0;
  for (let m = 1; m <= 3; m++) {
    for (let n = m + 1; n <= 4; n++) {
      let s = 0, N = 4000;
      for (let i = 0; i < N; i++) s += C.freeFreeBeam(m, (i + 0.5) / N) * C.freeFreeBeam(n, (i + 0.5) / N);
      orth = Math.max(orth, Math.abs(s / N));
    }
  }
  check("free-free beam modes are orthogonal (m != n overlap < 1e-3)", orth < 1e-3, "worst=" + orth);
}

/* ---------- 6. Plate dispersion and the simply-supported frequency ---------- */
{
  const st = C.MATERIALS.steel;
  const h = 0.001, a = 0.3;
  const D = C.flexuralRigidity(st.E, h, st.nu);
  check("steel 1 mm flexural rigidity ~ 18.2 N m", close(D, 18.196, 0.05), D);
  const omega = C.ssPlateOmega(1, 1, a, a, D, st.rho, h);
  check("300x300x1 mm steel (simply supported) f11 ~ 53.2 Hz", close(omega / (2 * Math.PI), 53.16, 0.4),
    omega / (2 * Math.PI));
  const k = C.plateWavenumber(omega, D, st.rho, h);
  check("flexural dispersion round-trips: omega(k(omega)) = omega",
    close(C.plateOmega(k, D, st.rho, h), omega, 1e-9));
  check("mode (2,1) is 2.5x the (1,1) frequency on a square plate",
    close(C.ssPlateOmega(2, 1, a, a, D, st.rho, h) / omega, 2.5, 1e-12),
    C.ssPlateOmega(2, 1, a, a, D, st.rho, h) / omega);
}

/* ---------- 7. Gravity-capillary dispersion for water ---------- */
{
  const w = 314.1592653589793;                       /* 50 Hz surface wave */
  const k = C.gravityCapillaryK(w);
  check("dispersion relation residual is zero", close(C.gravityCapillaryOmega(k), w, 1e-8), C.gravityCapillaryOmega(k));
  check("gravity limit at 1 rad/s: k -> omega^2/g", close(C.gravityCapillaryK(1), 1 / C.G, 2e-4),
    C.gravityCapillaryK(1));
  const kc = C.gravityCapillaryK(1e4);
  const pureCap = Math.cbrt(C.WATER_RHO * 1e8 / C.WATER_SIGMA);
  check("capillary limit at 1e4 rad/s: k -> (rho*omega^2/sigma)^(1/3)", close(kc, pureCap, pureCap * 0.02),
    kc + " vs " + pureCap);
  check("capillary length sqrt(sigma/(rho g)) ~ 2.73 mm",
    close(Math.sqrt(C.WATER_SIGMA / (C.WATER_RHO * C.G)), 0.002727, 2e-5),
    Math.sqrt(C.WATER_SIGMA / (C.WATER_RHO * C.G)));
}

/* ---------- 8. Faraday wavelengths (surface answers at half the drive) ---------- */
{
  const w100 = C.faradayWavelength(100);
  const w20 = C.faradayWavelength(20);
  check("100 Hz drive -> ~5.7 mm capillary ripple", w100 > 0.004 && w100 < 0.0075, w100);
  check("20 Hz drive -> ~1.5-2.5 cm mixed gravity-capillary wave", w20 > 0.012 && w20 < 0.030, w20);
  check("pattern wavelength shrinks as drive frequency rises", w100 < w20, w100 + " < " + w20);
  let mono = true;
  for (let f = 20; f < 900; f *= 1.3) if (C.faradayWavelength(f * 1.3) >= C.faradayWavelength(f)) mono = false;
  check("wavelength is monotone decreasing over 20-900 Hz", mono);
}

/* ---------- 9. Free square plate: the published Leissa table ---------- */
{
  const r = C.freePlateRitz({ degree: 10, nu: 0.30, keep: 8 });
  const want = [13.468, 19.596, 24.270, 34.801, 34.801, 61.092, 61.092, 63.686];
  let worst = 0;
  for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(r.lambda2[i] - want[i]));
  check("free square plate lambda^2 reproduces the Leissa table (8 modes, |err| < 0.01)",
    worst < 0.01, worst.toFixed(4) + " -> " + r.lambda2.slice(0, 8).map(v => v.toFixed(3)).join(" "));
  check("rigid-body modes are excluded (no lambda^2 < 1e-6)", r.lambda2.every(v => v > 1e-6));

  /* 300x300x1 mm steel: sqrt(D/rho h)=1.5275, 2*pi*a^2=0.56549 */
  const med = C.squarePlateModes({ material: "steel", size: 0.3, thickness: 0.001, keep: 8 });
  check("300x300x1 mm steel free plate: f1 = 36.4 Hz", close(med.modes[0].f, 36.4, 0.4), med.modes[0].f);
  check("mode frequencies increase with order", med.modes.every((m, i) => i === 0 || m.f > med.modes[i - 1].f));
}

/* ---------- 10. Disc and membrane frequencies ---------- */
{
  const disc = C.discModes({ material: "steel", size: 0.2, thickness: 0.001 });
  check("clamped steel disc R=200mm, h=1mm: f1 ~ 62 Hz", close(disc.modes[0].f, 62.1, 1.0), disc.modes[0].f);
  check("disc mode ordering starts at the monopole", disc.modes[0].m === 0 && disc.modes[0].s === 0);
  check("disc order is monopole, dipole, quadrupole (2nd/1st = 21.260/10.216)",
    close(disc.modes[1].f / disc.modes[0].f, 21.260 / 10.2158, 0.002),
    disc.modes[1].f / disc.modes[0].f);
  check("first ring mode sits at 39.771/10.216 = 3.893x",
    close(disc.modes[3].f / disc.modes[0].f, 39.771 / 10.2158, 0.004), disc.modes[3].f / disc.modes[0].f);

  const mem = C.membraneModes({ size: 0.15, tension: 60, density: 0.12 });
  check("membrane f1 = j01*c/(2*pi*R) = 57.1 Hz", close(mem.modes[0].f, 57.05, 0.15), mem.modes[0].f);
  check("membrane 2nd mode is the (1,0) dipole at 1.593x", close(mem.modes[1].f / mem.modes[0].f, 1.5933, 0.001),
    mem.modes[1].f / mem.modes[0].f);
  check("membrane has no octave (matches the research caveat)",
    mem.modes.every(m => Math.abs(m.f / mem.modes[0].f - 2) > 0.13));
}

/* ---------- 11. Driven modal response ---------- */
{
  const modes = [{ f: 100 }, { f: 200 }, { f: 300 }];
  const on = C.modalResponse(modes, [{ f: 100, amp: 1 }], { q: 40 });
  check("at resonance the hit mode dominates", on.peakIndex === 0 && on.nearest === 0, on.peakIndex);
  check("peak mode holds essentially all the normalised weight (> 0.999)",
    Math.hypot(on.re[0], on.im[0]) > 0.999, Math.hypot(on.re[0], on.im[0]));
  check("off-resonance neighbours are far down (< 0.05)", Math.hypot(on.re[1], on.im[1]) < 0.05,
    Math.hypot(on.re[1], on.im[1]));

  const off = C.modalResponse(modes, [{ f: 150, amp: 1 }], { q: 40 });
  const m1 = Math.hypot(off.re[0], off.im[0]), m2 = Math.hypot(off.re[1], off.im[1]);
  check("between modes both neighbours respond, and the nearer one wins", m1 > 0.02 && m2 > 0.02 && m2 > m1,
    m1.toFixed(3) + " / " + m2.toFixed(3));
  check("detuning is reported in cents", close(off.detuneCents, 1200 * Math.log2(150 / 100), 1e-6), off.detuneCents);

  /* Two partials 2 Hz apart (a binaural pair) must produce a phase difference
   * that turns into an amplitude beat when the field is summed. */
  const a = C.modalResponse(modes, [{ f: 100, amp: 1, phase: 0 }, { f: 102, amp: 1, phase: 0 }], { q: 8 });
  const b = C.modalResponse(modes, [{ f: 100, amp: 1, phase: 0 }, { f: 102, amp: 1, phase: Math.PI }], { q: 8 });
  const d = Math.abs(Math.hypot(a.re[0], a.im[0]) - Math.hypot(b.re[0], b.im[0]));
  check("partial phase changes the modal amplitude (beat is real, not decorative)", d > 1e-6, d);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
