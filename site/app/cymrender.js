/* Resonance Studio — CYMATIC RENDERER (WebGL2 with a canvas2d fallback).
 * Licensed GPL-2.0-or-later (see NOTICE.txt).
 *
 * Draws the plate as a displaced, lit surface (normal from screen-space
 * derivatives of the displaced position, so the shading is exact for whatever
 * height field the physics produces), the sand as round points, the bubbles as
 * refractive sprites, and the nodal set as a glow where the envelope is zero.
 *
 * Public:  GnauralCymRender.create(canvas) -> renderer | null (2d fallback)
 */
(function () {
  "use strict";

  var PALETTES = {
    champagne: { bg: [0.035, 0.028, 0.024], base: [0.62, 0.47, 0.24], line: [1.0, 0.84, 0.52], sand: [0.98, 0.93, 0.80], rim: [0.95, 0.78, 0.45] },
    ion:       { bg: [0.018, 0.028, 0.040], base: [0.22, 0.38, 0.50], line: [0.35, 0.92, 1.0], sand: [0.86, 0.96, 1.0], rim: [0.25, 0.85, 1.0] },
    copper:    { bg: [0.035, 0.022, 0.018], base: [0.55, 0.28, 0.16], line: [1.0, 0.60, 0.34], sand: [1.0, 0.88, 0.76], rim: [1.0, 0.55, 0.28] },
    verdigris: { bg: [0.018, 0.032, 0.030], base: [0.20, 0.44, 0.38], line: [0.55, 1.0, 0.86], sand: [0.88, 1.0, 0.96], rim: [0.35, 0.95, 0.78] },
    ice:       { bg: [0.020, 0.026, 0.038], base: [0.40, 0.46, 0.58], line: [0.80, 0.90, 1.0], sand: [0.94, 0.97, 1.0], rim: [0.70, 0.85, 1.0] },
    mono:      { bg: [0.030, 0.030, 0.032], base: [0.46, 0.46, 0.47], line: [0.98, 0.98, 0.98], sand: [0.92, 0.92, 0.90], rim: [0.85, 0.85, 0.85] },
    /* saturated set: the "pop" palettes. Still dark fields, hot lines. */
    ember:     { bg: [0.040, 0.014, 0.010], base: [0.62, 0.18, 0.09], line: [1.0, 0.62, 0.22], sand: [1.0, 0.90, 0.72], rim: [1.0, 0.44, 0.14] },
    magma:     { bg: [0.034, 0.012, 0.026], base: [0.58, 0.14, 0.26], line: [1.0, 0.42, 0.52], sand: [1.0, 0.86, 0.84], rim: [1.0, 0.24, 0.44] },
    orchid:    { bg: [0.026, 0.014, 0.040], base: [0.42, 0.20, 0.62], line: [0.86, 0.52, 1.0], sand: [0.96, 0.90, 1.0], rim: [0.78, 0.32, 1.0] },
    ultraviolet: { bg: [0.016, 0.012, 0.042], base: [0.28, 0.22, 0.72], line: [0.56, 0.48, 1.0], sand: [0.90, 0.88, 1.0], rim: [0.42, 0.24, 1.0] },
    toxic:     { bg: [0.014, 0.032, 0.016], base: [0.20, 0.46, 0.18], line: [0.52, 0.92, 0.26], sand: [0.90, 1.0, 0.78], rim: [0.36, 0.86, 0.14] },
    candy:     { bg: [0.030, 0.016, 0.030], base: [0.62, 0.24, 0.52], line: [1.0, 0.60, 0.86], sand: [1.0, 0.92, 0.98], rim: [1.0, 0.40, 0.72] },
    aurora:    { bg: [0.012, 0.026, 0.030], base: [0.16, 0.50, 0.50], line: [0.42, 1.0, 0.84], sand: [0.84, 1.0, 0.94], rim: [0.20, 0.96, 0.72] },
    solar:     { bg: [0.038, 0.028, 0.008], base: [0.66, 0.52, 0.10], line: [1.0, 0.88, 0.34], sand: [1.0, 0.97, 0.78], rim: [1.0, 0.78, 0.14] },
    neon:      { bg: [0.012, 0.020, 0.036], base: [0.16, 0.36, 0.70], line: [0.44, 0.74, 1.0], sand: [0.86, 0.94, 1.0], rim: [0.22, 0.62, 1.0] },
    blood:     { bg: [0.030, 0.010, 0.012], base: [0.54, 0.10, 0.14], line: [1.0, 0.34, 0.36], sand: [1.0, 0.84, 0.82], rim: [0.92, 0.14, 0.20] },
    lagoon:    { bg: [0.010, 0.028, 0.030], base: [0.10, 0.48, 0.50], line: [0.34, 0.94, 0.96], sand: [0.82, 1.0, 0.98], rim: [0.14, 0.82, 0.86] },
    blossom:   { bg: [0.034, 0.018, 0.026], base: [0.70, 0.26, 0.42], line: [1.0, 0.52, 0.66], sand: [1.0, 0.88, 0.94], rim: [1.0, 0.34, 0.52] },
    cobalt:    { bg: [0.012, 0.018, 0.032], base: [0.24, 0.33, 0.48], line: [0.62, 0.82, 1.0], sand: [0.90, 0.95, 1.0], rim: [0.28, 0.58, 0.94] },
    /* gunmetal: cold, desaturated steel — reads as metal, not as another blue */
    gunmetal:  { bg: [0.018, 0.022, 0.028], base: [0.26, 0.30, 0.34], line: [0.74, 0.82, 0.92], sand: [0.92, 0.94, 0.96], rim: [0.52, 0.66, 0.82] },
    /* abyss: near-black plate under a hot cyan line, for media where the plate
     * fill glows and the figure needs a hue it does not share */
    abyss:     { bg: [0.008, 0.016, 0.026], base: [0.06, 0.14, 0.22], line: [0.30, 0.98, 1.0], sand: [0.86, 0.98, 1.0], rim: [0.10, 0.80, 0.95] }
  };
  var PALETTE_IDS = ["champagne", "ion", "copper", "verdigris", "ice", "mono",
    "ember", "magma", "orchid", "ultraviolet", "toxic", "candy",
    "aurora", "solar", "neon", "blood", "lagoon", "blossom", "cobalt", "gunmetal", "abyss"];
  var DUST_HOT = new Float32Array([1.0, 0.97, 0.90]);

  var VS_PLATE = `#version 300 es
layout(location=0) in vec2 aUV;
uniform mat4 uMVP;
uniform sampler2D uHeight;
uniform float uAmp;
out vec3 vPos;
out vec2 vUV;
void main() {
  float h = texture(uHeight, aUV).r;
  vec3 p = vec3((aUV.x * 2.0 - 1.0) * 0.92, h * uAmp, (aUV.y * 2.0 - 1.0) * 0.92);
  vPos = p; vUV = aUV;
  gl_Position = uMVP * vec4(p, 1.0);
}`;

  var FS_PLATE = `#version 300 es
precision highp float;
in vec3 vPos;
in vec2 vUV;
uniform sampler2D uEnv;
uniform vec3 uBase, uLine, uRim, uCam, uBg;
uniform float uCircle;
uniform float uLineW, uWater, uGlow;
out vec4 frag;
void main() {
  if (uCircle > 0.5 && length(vPos.xz) > 0.901) discard;
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  if (n.y < 0.0) n = -n;
  n = normalize(vec3(n.x * 2.1, n.y, n.z * 2.1));
  vec3 L1 = normalize(vec3(0.72, 0.40, 0.52));
  vec3 L2 = normalize(vec3(-0.50, 0.55, -0.62));
  vec3 V = normalize(uCam - vPos);
  float d1 = max(dot(n, L1), 0.0), d2 = max(dot(n, L2), 0.0);
  vec3 H1 = normalize(L1 + V), H2 = normalize(L2 + V);
  float s1 = pow(max(dot(n, H1), 0.0), 110.0);
  float s2 = pow(max(dot(n, H2), 0.0), 26.0);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  float grain = fract(sin(dot(vUV * 900.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  vec3 R = reflect(-V, n);
  vec3 envCol = mix(uBg * 0.6, uRim * 0.85, smoothstep(-0.35, 0.95, R.y));
  float env = texture(uEnv, vUV).r;
  float line = 1.0 - smoothstep(0.0, uLineW, env);
  vec3 col = uBase * (0.06 + 0.52 * (0.72 * d1 + 0.22 * d2));
  col *= 0.94 + grain * 0.10;
  col += envCol * (0.16 + 0.55 * fres);
  col += vec3(1.0, 0.96, 0.88) * (s1 * 0.78 + s2 * 0.26);
  col += uRim * fres * 0.45;
  col += uLine * line * uGlow;
  float r = length(vPos.xz);
  col *= 1.0 - 0.38 * smoothstep(0.72, 1.30, r);
  float rr2 = length(vPos.xz);
  float edge = uCircle > 0.5 ? smoothstep(0.845, 0.897, rr2)
                             : smoothstep(0.855, 0.905, max(abs(vPos.x), abs(vPos.z)));
  col = mix(col, col * 0.30 + uRim * 0.05, edge * 0.85);
  vec3 waterCol = vec3(0.012, 0.030, 0.045) + envCol * (0.30 + 0.60 * fres)
                + vec3(0.90, 0.97, 1.0) * (s1 * 1.55 + s2 * 0.35);
  col = mix(col, waterCol, uWater);
  frag = vec4(col, 1.0);
}`;

  var VS_SAND = `#version 300 es
layout(location=0) in vec2 aUV;
layout(location=1) in float aSize;
uniform mat4 uMVP;
uniform sampler2D uHeight;
uniform float uAmp, uPx, uYOff;
out float vB;
void main() {
  float h = texture(uHeight, aUV).r;
  vec3 p = vec3(aUV.x * 2.0 - 1.0, h * uAmp + uYOff, aUV.y * 2.0 - 1.0);
  gl_Position = uMVP * vec4(p, 1.0);
  gl_PointSize = clamp(aSize * uPx / max(0.15, gl_Position.w), 1.0, 9.0);
  vB = 1.0;
}`;

  var FS_SAND = `#version 300 es
precision highp float;
in float vB;
uniform vec3 uSand;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = 1.0 - smoothstep(0.55, 1.0, r);
  if (a <= 0.01) discard;
  float lit = 0.65 + 0.35 * (1.0 - r);
  frag = vec4(uSand * lit * vB * 0.82, a * 0.95);
}`;

  var VS_BUB = `#version 300 es
layout(location=0) in vec2 aUV;
layout(location=1) in float aSize;
layout(location=2) in float aGlow;
uniform mat4 uMVP;
uniform float uPx;
out float vG;
void main() {
  vec3 p = vec3(aUV.x, 0.02, aUV.y);
  gl_Position = uMVP * vec4(p, 1.0);
  gl_PointSize = clamp(aSize * uPx / max(0.15, gl_Position.w), 2.0, 34.0);
  vG = aGlow;
}`;

  var FS_BUB = `#version 300 es
precision highp float;
in float vG;
uniform vec3 uRim;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float rim = smoothstep(0.55, 1.0, r);
  float hi = pow(max(0.0, 1.0 - length(d - vec2(-0.22, 0.22)) * 3.2), 2.0);
  float body = 0.10 + 0.25 * vG;
  vec3 col = uRim * (body + rim * 0.55 + hi * 0.9 * (0.4 + vG));
  frag = vec4(col, (0.35 + 0.6 * rim + 0.5 * hi) * (0.45 + 0.55 * vG));
}`;

  /* Airborne dust: a soft additive bokeh sprite. The shader reads the same
   * height + envelope textures as the plate, so a grain rides the surface and
   * lights up as it crosses a nodal line (the "sparkle" of the source system,
   * kept because crossing a node is exactly where a real dust grain would
   * touch down and be thrown again). */
  var VS_DUST = `#version 300 es
layout(location=0) in vec2 aUV;
layout(location=1) in float aZ;
layout(location=2) in float aLife;
layout(location=3) in float aSize;
uniform mat4 uMVP;
uniform sampler2D uHeight;
uniform sampler2D uEnv;
uniform float uAmp, uPx, uSizeScale;
out float vLife;
out float vSpark;
out float vFade;
void main() {
  float h = texture(uHeight, aUV).r;
  vec3 p = vec3((aUV.x * 2.0 - 1.0) * 0.92, aZ + h * uAmp + 0.035, (aUV.y * 2.0 - 1.0) * 0.92);
  gl_Position = uMVP * vec4(p, 1.0);
  float e = texture(uEnv, aUV).r;
  vSpark = 1.0 - smoothstep(0.0, 0.06, e);
  vLife = aLife;
  /* Depth cue: a grain high off the plate is nearer the lens and further out of
   * focus, so it draws bigger and dimmer - that gradient is what makes the
   * layer read as volume instead of screen-space speckle. */
  float depth = clamp(aZ / 1.4, 0.0, 1.0);
  float defocus = mix(0.36, 2.2, depth);
  /* fade at the rim so the footprint never reads as a hard rectangle, and fade
   * in/out over the life so nothing pops */
  float rr = length(p.xz);
  vFade = (1.0 - smoothstep(0.80, 1.06, rr))
        * smoothstep(0.0, 0.10, aLife) * (1.0 - smoothstep(0.70, 1.0, aLife))
        * mix(1.0, 0.62, depth);
  float grow = 0.6 + 0.4 * smoothstep(0.0, 0.20, aLife);
  gl_PointSize = clamp(aSize * uSizeScale * defocus * uPx * grow / max(0.15, gl_Position.w), 2.0, 74.0);
}`;

  var FS_DUST = `#version 300 es
precision highp float;
in float vLife;
in float vSpark;
in float vFade;
uniform vec3 uIn, uOut, uHot;
uniform float uOpacity, uHalo;
out vec4 frag;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  /* bokeh: a wide soft halo (scaled per medium) over a small core, nothing clipped */
  float halo = smoothstep(1.0, 0.10, r) * 0.55 * uHalo;
  float core = 1.0 - smoothstep(0.04, 0.34, r);
  if (halo <= 0.004 && core <= 0.004) discard;
  vec3 col = mix(uIn, uOut, vLife);
  col = mix(col, uHot, vSpark * 0.6);
  frag = vec4(col * (0.42 + core * 1.05 + vSpark * 0.7), (halo * 0.75 + core) * uOpacity * vFade);
}`;

  var VS_BG = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  var FS_BG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec3 uBg, uRim;
out vec4 frag;
void main() {
  float d = length((vUV - 0.5) * vec2(1.15, 1.0));
  vec3 col = uBg + uRim * (0.018 + 0.075 * exp(-d * d * 7.0));
  col *= 1.0 - 0.55 * smoothstep(0.35, 0.85, d);
  // fine grain so the background is not a flat gradient
  float g = fract(sin(dot(vUV * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.006;
  frag = vec4(col, 1.0);
}`;

  /* ---------------------------------------------------------------- maths */

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }
  function lookAt(eye, center, up) {
    var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
    ]);
  }
  function mul4(a, b) {
    /* column-major 4x4 (WebGL convention): C[col*4+row] */
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }

  /* ---------------------------------------------------------------- webgl */

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      console.warn("[cym] shader:", log, src.slice(0, 120));
      (globalThis.__cymShaderErrors = globalThis.__cymShaderErrors || []).push(String(log));
      return null;
    }
    return s;
  }
  function program(gl, vs, fs) {
    var v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn("[cym] link:", gl.getProgramInfoLog(p)); return null; }
    return p;
  }

  function mesh(gl, seg) {
    var n = (seg + 1) * (seg + 1);
    var pos = new Float32Array(n * 2), idx = new Uint32Array(seg * seg * 6);
    for (var i = 0; i <= seg; i++) {
      for (var j = 0; j <= seg; j++) {
        var k = (i * (seg + 1) + j) * 2;
        pos[k] = i / seg; pos[k + 1] = j / seg;
      }
    }
    var t = 0;
    for (i = 0; i < seg; i++) {
      for (j = 0; j < seg; j++) {
        var a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
        idx[t++] = a; idx[t++] = c; idx[t++] = b;
        idx[t++] = b; idx[t++] = c; idx[t++] = d;
      }
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: idx.length };
  }

  function makeTex(gl, N) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, N, N, 0, gl.RED, gl.FLOAT, null);
    return t;
  }

  function create(canvas) {
    var gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    var pPlate = program(gl, VS_PLATE, FS_PLATE);
    var pSand = program(gl, VS_SAND, FS_SAND);
    var pBub = program(gl, VS_BUB, FS_BUB);
    var pDust = program(gl, VS_DUST, FS_DUST);
    var pBg = program(gl, VS_BG, FS_BG);
    if (!pPlate || !pSand || !pBub || !pDust || !pBg) return null;

    var m = mesh(gl, 150);
    var texH = makeTex(gl, 256), texE = makeTex(gl, 256);
    var N = 256;

    /* sand point buffers */
    var sandVAO = gl.createVertexArray(), sandVBO = gl.createBuffer();
    gl.bindVertexArray(sandVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, sandVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    var bubVAO = gl.createVertexArray(), bubVBO = gl.createBuffer();
    gl.bindVertexArray(bubVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, bubVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    /* dust: u, v, z, life, size (5 floats) */
    var dustVAO = gl.createVertexArray(), dustVBO = gl.createBuffer();
    gl.bindVertexArray(dustVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);

    var quadVAO = gl.createVertexArray(), quadVBO = gl.createBuffer();
    gl.bindVertexArray(quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    var sandData = new Float32Array(24000 * 3), bubData = new Float32Array(4000 * 4);
    var dustData = new Float32Array(6000 * 5);
    var U = new Map();
    function loc(p, name) {
      var m = U.get(p);
      if (!m) { m = {}; U.set(p, m); }
      if (m[name] === undefined) m[name] = gl.getUniformLocation(p, name);
      return m[name];
    }

    return {
      kind: "webgl2", gl: gl, N: N,
      resize: function (w, h, dpr) {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        canvas.style.width = w + "px"; canvas.style.height = h + "px";
        gl.viewport(0, 0, canvas.width, canvas.height);
        this.W = w; this.H = h; this.dpr = dpr;
      },
      upload: function (height, env, n) {
        if (n !== N) { N = n; texH = makeTex(gl, N); texE = makeTex(gl, N); this.N = N; }
        gl.bindTexture(gl.TEXTURE_2D, texH);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, N, N, 0, gl.RED, gl.FLOAT, height);
        gl.bindTexture(gl.TEXTURE_2D, texE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, N, N, 0, gl.RED, gl.FLOAT, env);
      },
      draw: function (st) {
        var W = this.W || canvas.width, H = this.H || canvas.height;
        var pal = PALETTES[st.palette] || PALETTES.champagne;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.BLEND); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        /* background */
        gl.useProgram(pBg);
        gl.uniform3fv(loc(pBg, "uBg"), pal.bg);
        gl.uniform3fv(loc(pBg, "uRim"), pal.rim);
        gl.bindVertexArray(quadVAO);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        /* camera */
        var yaw = st.yaw || 0, pitch = st.pitch === undefined ? 1.05 : st.pitch, dist = st.dist || 2.5;
        var eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.15, Math.cos(yaw) * Math.cos(pitch) * dist];
        var P = perspective(0.8, W / H, 0.05, 40);
        var Vm = lookAt(eye, [0, 0, 0], [0, 1, 0]);
        var MVP = mul4(P, Vm);

        /* plate */
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(pPlate);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texH);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texE);
        gl.uniform1i(loc(pPlate, "uHeight"), 0);
        gl.uniform1i(loc(pPlate, "uEnv"), 1);
        gl.uniformMatrix4fv(loc(pPlate, "uMVP"), false, MVP);
        gl.uniform1f(loc(pPlate, "uAmp"), st.amp);
        gl.uniform1f(loc(pPlate, "uLineW"), st.lineW === undefined ? 0.016 : st.lineW);
        gl.uniform1f(loc(pPlate, "uGlow"), st.showLines === false ? 0.0 : (st.glow === undefined ? 0.55 : st.glow));
        gl.uniform1f(loc(pPlate, "uWater"), st.water ? 1.0 : 0.0);
        gl.uniform1f(loc(pPlate, "uCircle"), st.circle ? 1.0 : 0.0);
        gl.uniform3fv(loc(pPlate, "uBase"), pal.base);
        gl.uniform3fv(loc(pPlate, "uBg"), pal.bg);
        gl.uniform3fv(loc(pPlate, "uLine"), pal.line);
        gl.uniform3fv(loc(pPlate, "uRim"), pal.rim);
        gl.uniform3fv(loc(pPlate, "uCam"), new Float32Array(eye));
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        /* sand */
        if (st.sand && st.sand.n && st.showSand !== false) {
          var s = st.sand, k, o = 0, n = Math.min(s.n, 24000);
          for (k = 0; k < n; k++) {
            sandData[o++] = s.x[k] * 0.5 + 0.5;
            sandData[o++] = s.y[k] * 0.5 + 0.5;
            sandData[o++] = s.size[k] * 1.4;
          }
          gl.useProgram(pSand);
          gl.uniformMatrix4fv(loc(pSand, "uMVP"), false, MVP);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texH);
          gl.uniform1i(loc(pSand, "uHeight"), 0);
          gl.uniform1f(loc(pSand, "uAmp"), st.amp);
          gl.uniform1f(loc(pSand, "uPx"), canvas.width * 0.0034);
          gl.uniform1f(loc(pSand, "uYOff"), 0.004);
          gl.uniform3fv(loc(pSand, "uSand"), pal.sand);
          gl.bindVertexArray(sandVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, sandVBO);
          gl.bufferData(gl.ARRAY_BUFFER, sandData.subarray(0, n * 3), gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
          gl.drawArrays(gl.POINTS, 0, n);
        }

        /* airborne dust — additive bokeh, depth-tested so the far plate hides it */
        if (st.dust && st.dust.n && st.showDust !== false) {
          var du = st.dust, k3, o3 = 0, n3 = Math.min(du.n, 6000);
          for (k3 = 0; k3 < n3; k3++) {
            dustData[o3++] = du.x[k3] * 0.5 + 0.5;
            dustData[o3++] = du.y[k3] * 0.5 + 0.5;
            dustData[o3++] = du.z[k3];
            dustData[o3++] = du.life[k3];
            dustData[o3++] = du.size[k3] * 1.7;
          }
          gl.useProgram(pDust);
          gl.uniformMatrix4fv(loc(pDust, "uMVP"), false, MVP);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texH);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texE);
          gl.uniform1i(loc(pDust, "uHeight"), 0);
          gl.uniform1i(loc(pDust, "uEnv"), 1);
          gl.uniform1f(loc(pDust, "uAmp"), st.amp);
          gl.uniform1f(loc(pDust, "uPx"), canvas.width * 0.0135);
          gl.uniform1f(loc(pDust, "uSizeScale"), st.dustSize === undefined ? 1 : st.dustSize);
          gl.uniform1f(loc(pDust, "uHalo"), st.dustHalo === undefined ? 1 : st.dustHalo);
          gl.uniform1f(loc(pDust, "uOpacity"), st.dustOpacity === undefined ? 0.42 : st.dustOpacity);
          gl.uniform3fv(loc(pDust, "uIn"), pal.rim);
          gl.uniform3fv(loc(pDust, "uOut"), pal.sand);
          gl.uniform3fv(loc(pDust, "uHot"), DUST_HOT);
          gl.enable(gl.DEPTH_TEST);
          gl.depthMask(false);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.bindVertexArray(dustVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, dustVBO);
          gl.bufferData(gl.ARRAY_BUFFER, dustData.subarray(0, n3 * 5), gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8);
          gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12);
          gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16);
          gl.drawArrays(gl.POINTS, 0, n3);
          gl.depthMask(true);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        /* bubbles */
        if (st.bubbles && st.bubbles.n && st.showBubbles !== false) {
          var b = st.bubbles, k2, o2 = 0, n2 = Math.min(b.n, 4000);
          for (k2 = 0; k2 < n2; k2++) {
            bubData[o2++] = b.x[k2]; bubData[o2++] = b.y[k2];
            bubData[o2++] = b.r[k2] * 1.6; bubData[o2++] = b.glow[k2];
          }
          gl.useProgram(pBub);
          gl.uniformMatrix4fv(loc(pBub, "uMVP"), false, MVP);
          gl.uniform1f(loc(pBub, "uPx"), canvas.width * 0.42);
          gl.uniform3fv(loc(pBub, "uRim"), pal.rim);
          gl.bindVertexArray(bubVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, bubVBO);
          gl.bufferData(gl.ARRAY_BUFFER, bubData.subarray(0, n2 * 4), gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
          gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8);
          gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);
          gl.drawArrays(gl.POINTS, 0, n2);
        }
        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
      }
    };
  }

  /* ---------------------------------------------------------------- 2d fallback */

  function create2d(canvas) {
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    var off = document.createElement("canvas"), img = null, lastN = 0;
    return {
      kind: "canvas2d",
      resize: function (w, h, dpr) {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        canvas.style.width = w + "px"; canvas.style.height = h + "px";
        this.W = w; this.H = h; this.dpr = dpr;
      },
      upload: function (height, env, n) { this._h = height; this._e = env; this._n = n; },
      draw: function (st) {
        var W = canvas.width, H = canvas.height, n = this._n || 128;
        var pal = PALETTES[st.palette] || PALETTES.champagne;
        if (!img || lastN !== n) { off.width = n; off.height = n; img = off.getContext("2d").createImageData(n, n); lastN = n; }
        var d = img.data, h = this._h, e = this._e;
        var c = Math.cos(st.phase || 0), s = Math.sin(st.phase || 0);
        for (var i = 0; i < n; i++) {
          for (var j = 0; j < n; j++) {
            var k = i * n + j;
            var hv = ((st.re ? (st.re[k] * c - st.im[k] * s) : h[k])) * st.amp;
            var i1 = Math.min(n - 1, i + 1), j1 = Math.min(n - 1, j + 1);
            var dx = h[i1 * n + j] * st.amp - hv, dy = h[i * n + j1] * st.amp - hv;
            var nz = 1 / Math.sqrt(dx * dx + dy * dy + 0.02);
            var lit = 0.10 + 0.40 * Math.max(0, Math.min(1, (-dx * 0.5 - dy * 0.4 + 0.8) * nz * 0.20));
            var env = e ? e[k] : 0;
            var line = Math.max(0, 1 - env / 0.06);
            var o = k * 4;
            d[o] = 255 * Math.min(1, pal.base[0] * lit * 0.9 + pal.line[0] * line * 0.65);
            d[o + 1] = 255 * Math.min(1, pal.base[1] * lit * 0.9 + pal.line[1] * line * 0.65);
            d[o + 2] = 255 * Math.min(1, pal.base[2] * lit * 0.9 + pal.line[2] * line * 0.65);
            d[o + 3] = 255;
          }
        }
        off.getContext("2d").putImageData(img, 0, 0);
        ctx.fillStyle = "rgb(" + pal.bg.map(function (x) { return Math.round(x * 255); }).join(",") + ")";
        ctx.fillRect(0, 0, W, H);
        var side = Math.min(W, H) * 0.92, ox = (W - side) / 2, oy = (H - side) / 2;
        ctx.imageSmoothingEnabled = true;
        if (st.medium === "circle") {
          ctx.save(); ctx.beginPath(); ctx.arc(ox + side / 2, oy + side / 2, side / 2, 0, 6.2832); ctx.clip();
        }
        ctx.drawImage(off, ox, oy, side, side);
        if (st.medium === "circle") ctx.restore();
        var map = function (u, v) { return [ox + (u * 0.5 + 0.5) * side, oy + (v * 0.5 + 0.5) * side]; };
        if (st.bubbles && st.showBubbles !== false) {
          var b = st.bubbles;
          for (var q = 0; q < b.n; q++) {
            var p = map(b.x[q], b.y[q]);
            var rr = Math.max(1.2, b.r[q] * side * 0.5);
            ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 6.2832);
            ctx.strokeStyle = "rgba(" + pal.rim.map(function (x) { return Math.round(x * 255); }).join(",") + "," + (0.25 + 0.6 * b.glow[q]) + ")";
            ctx.lineWidth = Math.max(0.6, rr * 0.18); ctx.stroke();
          }
        }
        if (st.sand && st.showSand !== false) {
          var sd = st.sand;
          ctx.fillStyle = "rgb(" + pal.sand.map(function (x) { return Math.round(x * 255); }).join(",") + ")";
          for (q = 0; q < sd.n; q++) {
            var p2 = map(sd.x[q], sd.y[q]);
            var sz = 0.7 + sd.size[q] * 1.1;
            ctx.fillRect(p2[0], p2[1], sz, sz);
          }
        }
        /* dust: a sparse translucent overlay; the 2D path cannot depth-sort, so
         * grains are simply drawn on top at low alpha (Android fallback) */
        if (st.dust && st.dust.n && st.showDust !== false) {
          var dd = st.dust, m3 = Math.min(dd.n, 1200);
          ctx.fillStyle = "rgb(" + pal.sand.map(function (x) { return Math.round(x * 255); }).join(",") + ")";
          for (q = 0; q < m3; q++) {
            var pd = map(dd.x[q], dd.y[q]);
            ctx.globalAlpha = 0.10 + 0.32 * Math.sin(Math.PI * dd.life[q]) * (0.4 + 0.6 * dd.z[q]);
            var s3 = 0.8 + dd.size[q] * 1.2;
            ctx.fillRect(pd[0], pd[1], s3, s3);
          }
          ctx.globalAlpha = 1;
        }
      }
    };
  }

  function createAuto(canvas) {
    var gl = null;
    try { gl = create(canvas); } catch (e) { gl = null; }
    if (gl) return gl;
    /* A canvas that has already handed out a WebGL context cannot also give a
     * 2d context, so the fallback draws on a fresh element swapped into place. */
    var fresh = canvas.cloneNode(false);
    if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
    return create2d(fresh);
  }

  globalThis.GnauralCymRender = {
    version: 1,
    create: createAuto,
    create2d: create2d,
    PALETTES: PALETTES,
    PALETTE_IDS: PALETTE_IDS
  };
})();
