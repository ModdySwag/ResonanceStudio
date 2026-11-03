/* Resonance Studio — CYMATICS ENGINE (pure maths, no DOM).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * This file is the physics core of the Cymatic Chamber: plate/membrane mode
 * solvers, Bessel and free-edge beam functions, the gravity-capillary
 * dispersion relation for water, and the linear response of a driven plate.
 *
 * It is deliberately DOM-free and assigns to globalThis, so the identical
 * file runs under Node for tests and in the browser for rendering.
 *
 * Units are SI throughout (metres, seconds, kilograms, radians) unless a
 * field name says otherwise (Hz, mm, etc.).
 */
(function () {
  "use strict";

  var G = 9.80665;                 /* m/s^2, standard gravity               */
  var WATER_RHO = 998.2;           /* kg/m^3 at 20 C                        */
  var WATER_SIGMA = 0.0728;        /* N/m surface tension at 20 C           */
  var WATER_NU = 1.004e-6;         /* m^2/s kinematic viscosity at 20 C     */

  /* Material constants: E [Pa], rho [kg/m^3], nu [-], alpha [1/K] (unused) */
  var MATERIALS = {
    steel:     { name: "Steel",     E: 200e9, rho: 7850, nu: 0.29, note: "cold-rolled" },
    brass:     { name: "Brass",     E: 105e9, rho: 8500, nu: 0.34, note: "cartridge brass" },
    aluminium: { name: "Aluminium", E: 69e9,  rho: 2700, nu: 0.33, note: "6061-T6" },
    glass:     { name: "Glass",     E: 70e9,  rho: 2500, nu: 0.22, note: "soda-lime" },
    acrylic:   { name: "Acrylic",   E: 3.2e9, rho: 1180, nu: 0.37, note: "PMMA" },
    copper:    { name: "Copper",    E: 117e9, rho: 8960, nu: 0.34, note: "annealed" }
  };

  /* ==================================================================== *
   * Bessel functions
   * ==================================================================== */

  /* Miller's downward recurrence: stable for every order and argument.
   * Returns Float64Array J[0..nmax]. The normalisation uses the identity
   * J0(x) + 2*J2(x) + 2*J4(x) + ... = 1. */
  function besselJn(nmax, x) {
    nmax = Math.max(0, nmax | 0);
    var out = new Float64Array(nmax + 1);
    if (x === 0) { out[0] = 1; return out; }
    if (x < 0) {
      var sign = 1;
      for (var q = 0; q <= nmax; q++) { out[q] = sign * besselJn(nmax, -x)[q]; sign = -sign; }
      return out;
    }
    /* Truncation order: the downward recurrence needs N comfortably above x
     * as well as above nmax, or the growing (Y_n) contamination flips signs.
     * This runs only when a mode set is built, never per pixel. */
    var N = 2 * (nmax + Math.ceil(x * 1.2) + 30);
    var j = new Float64Array(N + 2);
    j[N] = 0; j[N - 1] = 1e-280;
    var i, s;
    for (i = N - 1; i >= 1; i--) {
      j[i - 1] = (2 * i / x) * j[i] - j[i + 1];
      if (Math.abs(j[i - 1]) > 1e250) {           /* rescale the tail */
        for (s = i - 1; s <= N; s++) j[s] *= 1e-250;
      }
    }
    var sum = j[0];
    for (i = 2; i <= N; i += 2) sum += 2 * j[i];
    var scale = 1 / sum;
    for (i = 0; i <= nmax; i++) out[i] = j[i] * scale;
    return out;
  }

  function besselJ(n, x) {
    if (n < 0) return (n % 2 ? -1 : 1) * besselJ(-n, x);
    return besselJn(n, x)[n];
  }

  /* Modified Bessel I_n(x): power series (all terms positive, no cancellation). */
  function besselI(n, x) {
    n = Math.abs(n | 0);
    if (x < 0) return (n % 2 ? -1 : 1) * besselI(n, -x);
    var half = x / 2, term = 1, sum = 0, k;
    for (k = 1; k <= n; k++) term *= half / k;     /* (x/2)^n / n! */
    sum = term;
    for (k = 1; k < 200; k++) {
      term *= (half * half) / (k * (n + k));
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return sum;
  }

  function besselJPrime(n, x) {
    if (n === 0) return -besselJ(1, x);
    return 0.5 * (besselJ(n - 1, x) - besselJ(n + 1, x));
  }

  /* Zeros of J_m, computed (not trusted from a table) by bracketed bisection.
   * Cached per order. j[m][n-1] is the n-th positive zero. */
  var _zeros = {};
  function besselZeros(m, count) {
    m = Math.max(0, m | 0); count = Math.max(1, count | 0);
    if (_zeros[m] && _zeros[m].length >= count) return _zeros[m].slice(0, count);
    var found = (_zeros[m] || []).slice();
    /* All positive zeros of J_m lie above 2.4 (J0's first), so scanning from
     * 0.5 avoids the trivial zero at the origin for m > 0. */
    var x0 = found.length ? found[found.length - 1] + 1e-9 : 0.5;
    var f0 = besselJ(m, x0);
    var step = 0.2;
    for (var x = x0 + step; found.length < count && x < 1e6; x += step) {
      var f1 = besselJ(m, x);
      if (f0 * f1 < 0) {
        var lo = x0, hi = x, flo = f0;
        for (var it = 0; it < 90; it++) {
          var mid = 0.5 * (lo + hi), fm = besselJ(m, mid);
          if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
        }
        var root = 0.5 * (lo + hi);
        if (!found.length || root - found[found.length - 1] > 1e-7) found.push(root);
      }
      x0 = x; f0 = f1;
    }
    _zeros[m] = found;
    return found.slice(0, count);
  }

  /* ==================================================================== *
   * Free-edge beam functions (the building block of a free Chladni plate)
   * ==================================================================== */

  var _beta = [0];
  function freeFreeBeta(m) {                          /* m = 1,2,3... */
    if (_beta[m] !== undefined) return _beta[m];
    var b = (m + 0.5) * Math.PI;
    for (var it = 0; it < 40; it++) {
      var f = Math.cos(b) * Math.cosh(b) - 1;
      var fp = -Math.sin(b) * Math.cosh(b) + Math.cos(b) * Math.sinh(b);
      var nb = b - f / fp;
      if (!isFinite(nb)) break;
      if (Math.abs(nb - b) < 1e-14) { b = nb; break; }
      b = nb;
    }
    _beta[m] = b;
    return b;
  }
  function freeFreeSigma(m) {
    var b = freeFreeBeta(m);
    return (Math.cosh(b) - Math.cos(b)) / (Math.sinh(b) - Math.sin(b));
  }
  /* X(x) on x in [0,1]; X(0) = 2 - sigma*0 ... satisfies X''=X'''=0 at both ends. */
  function freeFreeBeam(m, x) {
    var b = freeFreeBeta(m), s = freeFreeSigma(m);
    return Math.cosh(b * x) + Math.cos(b * x) - s * (Math.sinh(b * x) + Math.sin(b * x));
  }

  /* ==================================================================== *
   * Water: gravity-capillary dispersion
   * ==================================================================== */

  /* Solves omega^2 = g*k + (sigma/rho)*k^3 for the wavenumber k [1/m].
   * omega is the ANGULAR frequency of the surface wave. Remember Faraday:
   * the surface responds at HALF the vertical drive frequency. */
  function gravityCapillaryK(omega, opts) {
    opts = opts || {};
    var g = opts.g === undefined ? G : opts.g;
    var sigma = opts.sigma === undefined ? WATER_SIGMA : opts.sigma;
    var rho = opts.rho === undefined ? WATER_RHO : opts.rho;
    var target = omega * omega;
    var lo = 1e-8, hi = 1e6;
    for (var i = 0; i < 200; i++) {
      var mid = Math.sqrt(lo * hi);                     /* log bisection */
      var f = g * mid + (sigma / rho) * mid * mid * mid - target;
      if (f > 0) hi = mid; else lo = mid;
      if (hi / lo < 1 + 1e-12) break;
    }
    return Math.sqrt(lo * hi);
  }
  function gravityCapillaryOmega(k, opts) {
    opts = opts || {};
    var g = opts.g === undefined ? G : opts.g;
    var sigma = opts.sigma === undefined ? WATER_SIGMA : opts.sigma;
    var rho = opts.rho === undefined ? WATER_RHO : opts.rho;
    return Math.sqrt(g * k + (sigma / rho) * k * k * k);
  }
  /* Wavelength of the standing pattern produced by a vertical drive at fDrive. */
  function faradayWavelength(fDrive) {
    var k = gravityCapillaryK(Math.PI * fDrive);        /* response at fDrive/2 */
    return 2 * Math.PI / k;
  }

  /* ==================================================================== *
   * Plate mechanics
   * ==================================================================== */

  function flexuralRigidity(E, h, nu) { return (E * h * h * h) / (12 * (1 - nu * nu)); }
  /* Phase speed of flexural waves: omega = k^2 * sqrt(D/(rho h)). */
  function plateWavenumber(omega, D, rho, h) { return Math.sqrt(omega / Math.sqrt(D / (rho * h))); }
  function plateOmega(k, D, rho, h) { return k * k * Math.sqrt(D / (rho * h)); }

  /* Simply supported rectangular plate: exact. m,n >= 1. */
  function ssPlateOmega(m, n, a, b, D, rho, h) {
    var kx = m * Math.PI / a, ky = n * Math.PI / b;
    return (kx * kx + ky * ky) * Math.sqrt(D / (rho * h));
  }

  /* Warburton's approximation for a rectangular plate with ALL EDGES FREE.
   * Non-dimensional parameter lambda = omega * a^2 * sqrt(rho*h/D):
   *   lambda^2 ~ pi^2 * [ (m-0.5)^2 * (1 + ... ) ] — the full form is in
   * research/01; this function is filled in once the brief lands. */

  /* ==================================================================== *
   * Gauss-Legendre quadrature + Legendre basis
   * ==================================================================== */

  function gaussLegendre(n) {
    var x = new Float64Array(n), w = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), pp = 0;
      for (var it = 0; it < 100; it++) {
        var p0 = 1, p1 = z;
        for (var k = 2; k <= n; k++) { var p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
        pp = n * (z * p1 - p0) / (z * z - 1);
        var dz = p1 / pp;
        z -= dz;
        if (Math.abs(dz) < 1e-15) break;
      }
      x[i] = z;
      w[i] = 2 / ((1 - z * z) * pp * pp);
    }
    return { x: x, w: w };
  }

  /* Legendre values and first/second derivatives at one point, orders 0..n. */
  function legendre3(n, x) {
    var L = new Float64Array(n + 1), D = new Float64Array(n + 1), S = new Float64Array(n + 1);
    L[0] = 1;
    if (n >= 1) { L[1] = x; D[1] = 1; }
    for (var k = 2; k <= n; k++) L[k] = ((2 * k - 1) * x * L[k - 1] - (k - 1) * L[k - 2]) / k;
    for (k = 1; k <= n; k++) D[k] = k * (x * L[k] - L[k - 1]) / (x * x - 1);
    for (k = 0; k <= n; k++) S[k] = (2 * x * D[k] - k * (k + 1) * L[k]) / (1 - x * x);
    return { L: L, D: D, S: S };
  }

  /* ==================================================================== *
   * Symmetric Jacobi eigensolver (row-major n*n)
   * ==================================================================== */

  function jacobiEigen(Ain, n, maxSweeps) {
    var A = Float64Array.from(Ain);
    var V = new Float64Array(n * n);
    for (var i = 0; i < n; i++) V[i * n + i] = 1;
    maxSweeps = maxSweeps || 24;
    for (var sweep = 0; sweep < maxSweeps; sweep++) {
      var off = 0, diag = 0;
      for (i = 0; i < n; i++) { diag += A[i * n + i] * A[i * n + i]; for (var j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j]; }
      if (off <= 1e-26 * Math.max(1, diag)) break;
      for (var p = 0; p < n - 1; p++) {
        for (var q = p + 1; q < n; q++) {
          var apq = A[p * n + q];
          if (Math.abs(apq) < 1e-300) continue;
          var app = A[p * n + p], aqq = A[q * n + q];
          var theta = (aqq - app) / (2 * apq);
          var t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          var c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (var k = 0; k < n; k++) {
            var akp = A[k * n + p], akq = A[k * n + q];
            A[k * n + p] = c * akp - s * akq;
            A[k * n + q] = s * akp + c * akq;
          }
          for (k = 0; k < n; k++) {
            var apk = A[p * n + k], aqk = A[q * n + k];
            A[p * n + k] = c * apk - s * aqk;
            A[q * n + k] = s * apk + c * aqk;
          }
          for (k = 0; k < n; k++) {
            var vkp = V[k * n + p], vkq = V[k * n + q];
            V[k * n + p] = c * vkp - s * vkq;
            V[k * n + q] = s * vkp + c * vkq;
          }
        }
      }
    }
    var vals = new Float64Array(n);
    for (i = 0; i < n; i++) vals[i] = A[i * n + i];
    return { values: vals, vectors: V };
  }

  /* ==================================================================== *
   * Free-edge square plate: Rayleigh-Ritz with a Legendre tensor basis.
   *
   * Free edges are NATURAL boundary conditions of the plate functional, so a
   * plain polynomial basis is admissible; with the basis normalised so the
   * mass matrix is the identity, the generalised problem becomes a standard
   * symmetric one. Output lambda2 = omega*a^2*sqrt(rho*h/D), the same
   * non-dimensional parameter tabulated by Leissa (NASA SP-160).
   * ==================================================================== */

  function freePlateRitz(opts) {
    opts = opts || {};
    var P = Math.max(4, Math.min(12, opts.degree || 10));
    var nu = opts.nu === undefined ? 0.30 : opts.nu;
    var keep = Math.max(6, Math.min(P * P - 4, opts.keep || 40));
    var quad = gaussLegendre(Math.min(26, P * 2 + 6));
    var nq = quad.x.length, nB = P * P;

    /* Per-node basis values, derivatives and the mass normalisation. */
    var at = [], norm = new Float64Array(nB);
    for (var i = 0; i < nq; i++) at.push(legendre3(P - 1, quad.x[i]));
    for (var p = 0; p < P; p++) {
      for (var q = 0; q < P; q++) norm[p * P + q] = Math.sqrt((2 * p + 1) * (2 * q + 1)) / 2;
    }

    var K = new Float64Array(nB * nB);
    for (var I = 0; I < nB; I++) {
      var p1 = (I / P) | 0, q1 = I % P;
      for (var J = I; J < nB; J++) {
        var r1 = (J / P) | 0, s1 = J % P;
        var sum = 0;
        for (var a = 0; a < nq; a++) {
          var A = at[a], wxa = quad.w[a];
          for (var b = 0; b < nq; b++) {
            var B = at[b];
            /* W = L_p(x)L_q(y) ; W_xx = L''_p L_q ; W_yy = L_p L''_q ; W_xy = L'_p L'_q */
            var xx = A.S[p1] * B.L[q1] + A.L[p1] * B.S[q1];
            var yy = A.S[r1] * B.L[s1] + A.L[r1] * B.S[s1];
            var xy = A.D[p1] * B.D[q1] * A.D[r1] * B.D[s1];
            /* Bilinear form of the plate energy: the (1-nu) cross term carries a
             * 1/2 in the quadratic form, so the OFF-DIAGONAL entries use
             * (1-nu) while the diagonal recovers 2(1-nu) naturally. */
            var xxA = A.S[p1] * B.L[q1], yyA = A.L[p1] * B.S[q1];
            var xxB = A.S[r1] * B.L[s1], yyB = A.L[r1] * B.S[s1];
            var bil = (1 - nu) * (xxA * yyB + yyA * xxB - 2 * xy);
            sum += wxa * quad.w[b] * (xx * yy - bil);
          }
        }
        var k = sum * norm[I] * norm[J];
        K[I * nB + J] = k;
        K[J * nB + I] = k;
      }
    }

    var eig = jacobiEigen(K, nB);
    var order = [];
    for (i = 0; i < nB; i++) order.push(i);
    order.sort(function (x, y) { return eig.values[x] - eig.values[y]; });

    var modes = [];
    for (i = 0; i < order.length && modes.length < keep; i++) {
      var idx = order[i], eigval = eig.values[idx];
      if (eigval < 1e-6) continue;                       /* 3 rigid-body modes */
      /* The basis is dimensionless (x,y in [-1,1]); with the physical plate
       * side a, lambda^2 = omega*a^2*sqrt(rho*h/D) = 4*sqrt(N_xi/M_xi). */
      var coeff = new Float64Array(nB);
      for (var kk = 0; kk < nB; kk++) coeff[kk] = eig.vectors[kk * nB + idx] * norm[kk];
      modes.push({ lambda2: 4 * Math.sqrt(eigval), eigval: eigval, coeff: coeff, p: P, nq: nq });
    }
    return { modes: modes, degree: P, nu: nu, lambda2: modes.map(function (m) { return m.lambda2; }),
             K: opts.kernel ? K : undefined, nB: nB, norm: opts.kernel ? norm : undefined };
  }

  /* Evaluate a Ritz mode on a normalized grid u,v in [-1,1]. */
  function ritzEval(mode, u, v) {
    var P = mode.p, nq = mode.nq;
    var xu = legendre3(P - 1, u), xv = legendre3(P - 1, v);
    var sum = 0;
    for (var p = 0; p < P; p++) {
      if (!mode.coeff[p * P] && !mode.coeff[p * P + 1]) { /* cheap skip */ }
      for (var q = 0; q < P; q++) {
        var c = mode.coeff[p * P + q];
        if (c) sum += c * xu.L[p] * xv.L[q];
      }
    }
    return sum;
  }

  /* ==================================================================== *
   * Circular clamped plate + circular membrane (Bessel modes)
   * ==================================================================== */

  /* Roots of J_m(x) I_{m+1}(x) + I_m(x) J_{m+1}(x) = 0 (clamped edge). */
  var _discRoots = {};
  function clampedDiscRoots(m, count) {
    m = Math.max(0, m | 0);
    if (_discRoots[m] && _discRoots[m].length >= count) return _discRoots[m].slice(0, count);
    var found = (_discRoots[m] || []).slice();
    var f = function (x) { return besselJ(m, x) * besselI(m + 1, x) + besselI(m, x) * besselJ(m + 1, x); };
    var x0 = found.length ? found[found.length - 1] + 0.05 : Math.max(1.5, m + 1.2);
    var f0 = f(x0), step = 0.1;
    for (var x = x0 + step; found.length < count && x < 60; x += step) {
      var f1 = f(x);
      if (f0 * f1 < 0) {
        var lo = x0, hi = x, flo = f0;
        for (var it = 0; it < 90; it++) {
          var mid = 0.5 * (lo + hi), fm = f(mid);
          if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
        }
        found.push(0.5 * (lo + hi));
      }
      x0 = x; f0 = f1;
    }
    _discRoots[m] = found;
    return found.slice(0, count);
  }

  /* ==================================================================== *
   * Medium builders: every mode carries a frequency and a shape(u,v)
   * ==================================================================== */

  function materialOf(spec) { return MATERIALS[(spec && spec.material) || "steel"] || MATERIALS.steel; }

  /* Free-edge square plate, Rayleigh-Ritz modes. f from lambda^2. */
  function squarePlateModes(spec) {
    spec = spec || {};
    var mat = materialOf(spec), h = spec.thickness || 0.001, a = spec.size || 0.3;
    var D = flexuralRigidity(mat.E, h, mat.nu);
    var ritz = freePlateRitz({ degree: spec.degree || 10, nu: mat.nu, keep: spec.keep || 36 });
    var c = Math.sqrt(D / (mat.rho * h));
    var out = [];
    for (var i = 0; i < ritz.modes.length; i++) {
      var m = ritz.modes[i];
      out.push({
        i: i, kind: "free-square", lambda2: m.lambda2,
        f: m.lambda2 * c / (2 * Math.PI * a * a),
        coeff: m.coeff, p: m.p, label: "mode " + (i + 1)
      });
    }
    return { kind: "plate", geometry: "square", modes: out, material: mat, size: a, thickness: h,
             D: D, c: c, nu: mat.nu,
             fMin: out.length ? out[0].f : 0, fMax: out.length ? out[out.length - 1].f : 0 };
  }

  /* Classical Chladni superposition: the centre-bolted demo plate.
   * W = cos(n*pi*u)cos(m*pi*v) - cos(m*pi*u)cos(n*pi*v), u,v in [0,1].
   * A node at the centre by construction; frequencies follow the
   * membrane-like (m^2+n^2) law the plate takes when the centre is held. */
  function boltedPlateModes(spec) {
    spec = spec || {};
    var mat = materialOf(spec), h = spec.thickness || 0.001, a = spec.size || 0.3;
    var D = flexuralRigidity(mat.E, h, mat.nu);
    var c = Math.sqrt(D / (mat.rho * h));
    var out = [];
    for (var m = 1; m <= 7; m++) {
      for (var n = 1; n <= 7; n++) {
        if (m === n) continue;
        var f = (Math.PI / 2) * c * (m * m + n * n) / (a * a);
        out.push({ i: out.length, kind: "bolted", m: m, n: n, f: f, label: "(" + m + "," + n + ")" });
      }
    }
    out.sort(function (x, y) { return x.f - y.f; });
    out.forEach(function (o, i) { o.i = i; });
    return { kind: "bolted", geometry: "square", modes: out, material: mat, size: a, thickness: h,
             D: D, c: c, nu: mat.nu, fMin: out[0].f, fMax: out[out.length - 1].f };
  }

  /* Clamped circular plate: J_m(lambda r) - (J_m(lambda)/I_m(lambda)) I_m(lambda r). */
  function discModes(spec) {
    spec = spec || {};
    var mat = materialOf(spec), h = spec.thickness || 0.001, R = spec.size || 0.15;
    var D = flexuralRigidity(mat.E, h, mat.nu);
    var c = Math.sqrt(D / (mat.rho * h));
    var out = [], m, s;
    for (m = 0; m <= 6; m++) {
      var roots = clampedDiscRoots(m, 4);
      for (s = 0; s < roots.length; s++) {
        var lam = roots[s];
        out.push({ i: 0, kind: "disc", m: m, s: s, lambda: lam, lambda2: lam * lam,
                   f: lam * lam * c / (2 * Math.PI * R * R),
                   label: m === 0 ? (s === 0 ? "monopole" : "ring " + s) : (m + " diameter" + (m > 1 ? "s" : "") + (s ? " · ring " + s : "")) });
      }
    }
    out.sort(function (x, y) { return x.f - y.f; });
    out.forEach(function (o, i) { o.i = i; });
    return { kind: "disc", geometry: "circle", modes: out, material: mat, size: R, thickness: h,
             D: D, c: c, nu: mat.nu, fMin: out[0].f, fMax: out[out.length - 1].f };
  }

  /* Circular membrane: Bessel zeros, tension sets the speed. */
  function membraneModes(spec) {
    spec = spec || {};
    var R = spec.size || 0.15;
    var tension = spec.tension === undefined ? 60 : spec.tension;      /* N/m */
    var density = spec.density === undefined ? 0.12 : spec.density;    /* kg/m^2 */
    var c = Math.sqrt(tension / density);
    var out = [], m, n;
    for (m = 0; m <= 6; m++) {
      var z = besselZeros(m, 5);
      for (n = 0; n < z.length; n++) {
        out.push({ i: 0, kind: "drum", m: m, n: n, j: z[n],
                   f: z[n] * c / (2 * Math.PI * R),
                   label: m === 0 ? (n === 0 ? "fundamental" : "ring " + n) : (m + " nodal diameter" + (m > 1 ? "s" : "") + (n ? " · ring " + n : "")) });
      }
    }
    out.sort(function (x, y) { return x.f - y.f; });
    out.forEach(function (o, i) { o.i = i; });
    return { kind: "drum", geometry: "circle", modes: out, size: R, tension: tension, density: density,
             c: c, fMin: out[0].f, fMax: out[out.length - 1].f };
  }

  /* ==================================================================== *
   * Driven response: complex Lorentzian modal weights
   * ==================================================================== */

  /* partials: [{f, amp, phase}] . Returns per-mode complex weights
   * (re/im) and the nearest mode + detuning in cents. */
  function modalResponse(modes, partials, opts) {
    opts = opts || {};
    var Q = opts.q || 40, norm = opts.normalize !== false;
    var re = new Float64Array(modes.length), im = new Float64Array(modes.length);
    var energy = 0, peak = 0, peakIndex = -1;
    for (var k = 0; k < modes.length; k++) {
      var fk = modes[k].f;
      var wr = 0, wi = 0;
      for (var v = 0; v < partials.length; v++) {
        var p = partials[v];
        var r = p.f / fk;
        var d = (1 - r * r) * (1 - r * r) + (r / Q) * (r / Q);
        var hre = (1 - r * r) / d, him = (-(r / Q)) / d;
        var a = p.amp === undefined ? 1 : p.amp;
        var ph = p.phase || 0, cph = Math.cos(ph), sph = Math.sin(ph);
        wr += a * (cph * hre - sph * him);
        wi += a * (sph * hre + cph * him);
      }
      re[k] = wr; im[k] = wi;
      var mag = Math.sqrt(wr * wr + wi * wi);
      energy += mag * mag;
      if (mag > peak) { peak = mag; peakIndex = k; }
    }
    if (norm && energy > 0) {
      var s = 1 / Math.sqrt(energy);
      for (k = 0; k < modes.length; k++) { re[k] *= s; im[k] *= s; }
    }
    var f0 = partials.length ? partials[0].f : 0;
    var near = null, best = Infinity;
    for (k = 0; k < modes.length; k++) {
      var dd = Math.abs(modes[k].f - f0);
      if (dd < best) { best = dd; near = k; }
    }
    var detune = near === null ? 0 : 1200 * Math.log(f0 / Math.max(1e-9, modes[near].f)) / Math.LN2;
    return { re: re, im: im, peakIndex: peakIndex, nearest: near, detuneCents: detune };
  }

  /* ==================================================================== *
   * Public surface
   * ==================================================================== */

  var api = {
    version: 1,
    G: G, WATER_RHO: WATER_RHO, WATER_SIGMA: WATER_SIGMA, WATER_NU: WATER_NU,
    MATERIALS: MATERIALS,
    besselJ: besselJ, besselJn: besselJn, besselI: besselI, besselJPrime: besselJPrime,
    besselZeros: besselZeros,
    gaussLegendre: gaussLegendre, legendre3: legendre3, jacobiEigen: jacobiEigen,
    freePlateRitz: freePlateRitz, ritzEval: ritzEval, clampedDiscRoots: clampedDiscRoots,
    squarePlateModes: squarePlateModes, boltedPlateModes: boltedPlateModes,
    discModes: discModes, membraneModes: membraneModes, modalResponse: modalResponse,
    freeFreeBeta: freeFreeBeta, freeFreeSigma: freeFreeSigma, freeFreeBeam: freeFreeBeam,
    gravityCapillaryK: gravityCapillaryK, gravityCapillaryOmega: gravityCapillaryOmega,
    faradayWavelength: faradayWavelength,
    flexuralRigidity: flexuralRigidity, plateWavenumber: plateWavenumber, plateOmega: plateOmega,
    ssPlateOmega: ssPlateOmega
  };

  globalThis.GnauralCymatics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
