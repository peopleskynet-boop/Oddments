// «Эффекты»: the drawing — one WebGL 2 program for every look and medium (lib/effects.js has the math and the settings,
// ui/effects.js the screen). One context per screen (CONTRIBUTING): the preview, the mini tiles and the saved file are
// drawn by the same program — tiles and the file into a framebuffer, the file piece by piece (40 MP is beyond any
// viewport). Sizes in the shader are relative to the picture, and patterns finer than a pixel fade to their average,
// so the preview is the file seen from further away.
//   createFx(canvas, onLost)       → fx, or null without WebGL 2
//   fx.source(bitmap)              the picture (the caller keeps it ≤ 4096 px; mipmaps give cell averages)
//   fx.ansi(data, cols, rows) / fx.bits(data, cols, rows) / fx.atlas(canvas, n) / fx.label(canvas | null)
//   fx.draw(u, crop)               the preview into the canvas (its current size)
//   fx.tile(u, w, h, crop)         → ImageData of a small drawing (the tiles)
//   fx.toCanvas(u, W, H, onPiece)  → OffscreenCanvas of the whole file
//   paramsOf(st, meta)             → the uniforms for a state
import { hexRgb, PHOSPHOR, BACKLIGHT, PAPER, INK, bitColors, ansiBg, GLYPHS, glyphCount } from './effects.js';

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform sampler2D uSrc, uAnsi, uBits, uAtlas, uLow, uLabel;
uniform vec2 uDraw, uGrid;
uniform vec3 uPiece;   // this piece of the drawing: x, y from the top-left, its height in pixels
uniform vec4 uCrop;    // the part of the picture the drawing shows: x, y, width, height (0..1)
uniform int uPass, uLook, uMedia, uToneShape, uToneCmyk, uPhos, uClear, uNeg, uMarks, uLabelOn;
uniform float uAsp, uSeed, uGlyphs, uToneN, uToneAngle, uToneLod, uLines, uBulge, uVig, uGrain, uGlow, uLowLod;
uniform float uFall, uFGrain, uFocus, uLabelH;
uniform vec3 uAnsiBg, uDark, uLight, uPaper, uInk, uPhosColor, uBack;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 65536);
  uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ uint(uSeed * 16777216.0) * 2654435761u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return float(h) * (1.0 / 4294967296.0);
}

// ——— looks ———
vec3 ansiAt(vec2 uv, vec2 dx, vec2 dy) {
  vec2 g = uv * uGrid;
  vec4 cell = texelFetch(uAnsi, ivec2(clamp(floor(g), vec2(0.0), uGrid - 1.0)), 0);
  float gi = floor(cell.a * 255.0 + 0.5);
  vec2 f = fract(g), s = vec2(1.0 / uGlyphs, 1.0);
  // the gradient of the whole grid, not of fract(): no seams at the cell borders; glyphs smaller than a pixel give
  // their average from the atlas' mipmaps
  float m = textureGrad(uAtlas, vec2((gi + f.x) / uGlyphs, f.y), dx * uGrid * s, dy * uGrid * s).a;
  return mix(uAnsiBg, cell.rgb, m);
}
float inkOf(vec3 c, int ch) {
  if (ch == 4) return 1.0 - luma(c);
  float k = 1.0 - max(c.r, max(c.g, c.b));
  if (ch == 3) return k;
  float d = max(1.0 - k, 1e-4);
  return ch == 0 ? (1.0 - c.r - k) / d : ch == 1 ? (1.0 - c.g - k) / d : (1.0 - c.b - k) / d;
}
// one screen of a halftone: the dots of the cell under P and of its three neighbours on P's side (a big dot reaches
// over the border), each as big as the ink its cell needs
float screenAt(vec2 P, float ang, int ch, float aa, float fw) {
  float cs = cos(ang), sn = sin(ang);
  mat2 R = mat2(cs, sn, -sn, cs);
  vec2 Q = R * P, base = floor(Q), f = Q - base;
  vec2 side = vec2(f.x < 0.5 ? -1.0 : 1.0, f.y < 0.5 ? -1.0 : 1.0);
  float ink = 0.0, own = 0.0;
  int n = uToneShape == 0 ? 4 : 1;
  for (int i = 0; i < 4; i++) {
    if (i >= n) break;
    vec2 cc = base + 0.5 + vec2((i == 1 || i == 3) ? side.x : 0.0, i >= 2 ? side.y : 0.0);
    vec2 cp = transpose(R) * cc;
    vec4 s = textureLod(uSrc, clamp(vec2(cp.x / uToneN, cp.y * uAsp / uToneN), 0.0, 1.0), uToneLod);
    float cov = clamp(inkOf(mix(vec3(1.0), s.rgb, s.a), ch), 0.0, 1.0);
    if (i == 0) own = cov;
    float r = uToneShape == 0 ? 0.7071 * sqrt(cov) : 0.5 * cov;
    float d = uToneShape == 0 ? length(Q - cc) : abs(Q.y - cc.y);
    ink = max(ink, 1.0 - smoothstep(r - aa, r + aa, d));
  }
  // dots of a few pixels: the eye gets their average
  return mix(ink, own, smoothstep(0.3, 0.7, fw));
}
vec3 toneAt(vec2 uv, vec2 dx, vec2 dy) {
  vec2 k = vec2(uToneN, uToneN / uAsp);
  vec2 P = uv * k;
  float fw = max(length(dx * k), length(dy * k)), aa = 0.6 * fw + 0.002;
  if (uToneCmyk == 0) return mix(uPaper, uInk, screenAt(P, uToneAngle, 4, aa, fw));
  // the four inks at their print angles (K at the chosen angle, C and M 30° off it, Y 45°), multiplied on paper
  vec3 col = uPaper;
  col *= mix(vec3(1.0), vec3(0.0, 0.64, 0.92), screenAt(P, uToneAngle - 0.5236, 0, aa, fw));
  col *= mix(vec3(1.0), vec3(0.93, 0.12, 0.56), screenAt(P, uToneAngle + 0.5236, 1, aa, fw));
  col *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), screenAt(P, uToneAngle - 0.7854, 2, aa, fw));
  col *= mix(vec3(1.0), vec3(0.14, 0.14, 0.15), screenAt(P, uToneAngle, 3, aa, fw));
  return col;
}
// the picture drawn by the chosen look; straight alpha (only «Как есть» can be transparent)
vec4 lookAt(vec2 uv, vec2 dx, vec2 dy) {
  if (uLook == 1) return vec4(ansiAt(uv, dx, dy), 1.0);
  if (uLook == 2) return vec4(mix(uDark, uLight, texture(uBits, uv).r), 1.0);
  if (uLook == 3) return vec4(toneAt(uv, dx, dy), 1.0);
  return texture(uSrc, uv);
}

void main() {
  vec2 p = vec2(uPiece.x + gl_FragCoord.x, uPiece.y + uPiece.z - gl_FragCoord.y);
  vec2 ud = p / uDraw;
  if (uPass == 0) { // the look alone and small: the tube's glow is its blur
    vec4 l = lookAt(ud, dFdx(ud), dFdy(ud));
    o = vec4(l.rgb * l.a, 1.0);
    return;
  }
  vec2 uv = uCrop.xy + ud * uCrop.zw;
  if (uMedia == 1) {
    // the tube bulges: the picture is pushed towards the corners and ends in a rounded edge
    vec2 c = uv * 2.0 - 1.0;
    float k = uBulge * 0.14;
    vec2 q = c * (1.0 + k * dot(c, c)) / (1.0 + k);
    vec2 a = vec2(uAsp, 1.0);
    float rad = 0.04 + 0.08 * uBulge;
    vec2 b = abs(q) * a - (a - rad);
    float edge = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - rad;
    float ae = fwidth(edge) * 0.75 + 1e-6;
    float inside = 1.0 - smoothstep(-ae, ae, edge);
    vec2 u2 = q * 0.5 + 0.5;
    vec4 l = lookAt(u2, dFdx(u2), dFdy(u2));
    vec3 col = l.rgb * l.a;
    vec2 lu = vec2(u2.x, 1.0 - u2.y); // the small look was drawn into a framebuffer: its rows go up
    vec3 glow = textureLod(uLow, lu, uLowLod).rgb * 0.6 + textureLod(uLow, lu, uLowLod + 1.5).rgb * 0.4;
    if (uPhos == 0) {
      // a touch more colour, as on a tube, and the shadow mask's stripes (their average is the picture's brightness)
      col = clamp(mix(vec3(luma(col)), col, 1.15), 0.0, 1.0);
      float x = u2.x * uLines * uAsp;
      float am = 1.0 - smoothstep(0.12, 0.3, fwidth(x));
      float s = fract(x) * 3.0;
      vec3 m = vec3(step(s, 1.0), step(1.0, s) * step(s, 2.0), step(2.0, s));
      col *= 1.0 + am * (m * 0.42 - 0.14);
    } else {
      col = uPhosColor * smoothstep(0.02, 0.95, luma(col));
      glow = uPhosColor * luma(glow);
    }
    // scanlines; finer than a few pixels they give their average darkening, as the saved file seen smaller does
    float y = u2.y * uLines;
    float as = 1.0 - smoothstep(0.2, 0.45, fwidth(y));
    col *= mix(1.0 - 0.21, 1.0 - 0.42 * (0.5 - 0.5 * cos(6.2832 * y)), as);
    col += uGlow * (glow * 0.25 + max(glow - 0.45, 0.0) * 0.9);
    col *= 1.0 - uVig * 0.6 * pow(length(q * vec2(0.8, 0.9)), 3.0);
    float ag = clamp(1.0 / max(fwidth(u2.y * 1400.0), 1e-3), 0.0, 1.0);
    col += (hash(u2 * a * 1400.0) - 0.5) * uGrain * 0.16 * ag;
    o = vec4(clamp(col, 0.0, 1.0) * inside, uClear == 1 ? inside : 1.0);
  } else if (uMedia == 2) {
    // film on a light table: out of focus, grain in the emulsion, light falling off from a spot near the centre
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec3 col;
    if (uFocus > 0.001) {
      vec3 acc = vec3(0.0);
      float r = uFocus * 0.007;
      for (int i = 0; i < 12; i++) {
        float an = float(i) * 2.39996, rr = sqrt((float(i) + 0.5) / 12.0) * r;
        vec4 l = lookAt(uv + vec2(cos(an) * rr / uAsp, sin(an) * rr), dx, dy);
        acc += mix(vec3(1.0), l.rgb, l.a);
      }
      col = acc / 12.0;
    } else { vec4 l = lookAt(uv, dx, dy); col = mix(vec3(1.0), l.rgb, l.a); }
    float ag = clamp(1.0 / max(fwidth(uv.y * 1100.0), 1e-3), 0.0, 1.0);
    float v = clamp(luma(col) + (hash(uv * vec2(uAsp, 1.0) * 1100.0) - 0.5) * uFGrain * 0.24 * ag, 0.0, 1.0);
    if (uNeg == 1) v = 1.0 - v;
    float t = mix(0.045, 1.0, pow(v, 1.1));
    float fall = 1.0 - uFall * 0.62 * smoothstep(0.15, 1.45, length((uv - vec2(0.47, 0.45)) * 2.0));
    // the title strip: dark film with clear letters
    vec2 lg = vec2(1.0, 1.0 / max(uLabelH, 1e-3));
    float la = textureGrad(uLabel, vec2(uv.x, uv.y / max(uLabelH, 1e-3)), dx * lg, dy * lg).a;
    if (uLabelOn == 1 && uv.y < uLabelH) t = mix(0.06, 0.9, la);
    float mark = 0.0;
    if (uMarks == 1) {
      vec2 P = uv * vec2(uAsp, 1.0);
      float m = 0.055, R = 0.022, w = 0.0016;
      float ty = uLabelOn == 1 ? uLabelH + m : m;
      vec2 cs[4] = vec2[4](vec2(m, ty), vec2(uAsp - m, ty), vec2(m, 1.0 - m), vec2(uAsp - m, 1.0 - m));
      for (int i = 0; i < 4; i++) {
        vec2 d = P - cs[i];
        float sd = min(abs(length(d) - R) - w, min(max(abs(d.y) - w, abs(d.x) - R * 1.6), max(abs(d.x) - w, abs(d.y) - R * 1.6)));
        float aa = max(fwidth(sd), 1e-5);
        mark = max(mark, 1.0 - smoothstep(-aa, aa, sd));
      }
    }
    o = vec4(clamp(uBack * t * fall * (1.0 - 0.85 * mark), 0.0, 1.0), 1.0);
  } else {
    o = lookAt(uv, dFdx(uv), dFdy(uv));
  }
}`;

const INTS = new Set(['uPass', 'uLook', 'uMedia', 'uToneShape', 'uToneCmyk', 'uPhos', 'uClear', 'uNeg', 'uMarks', 'uLabelOn']);
const UNITS = { uSrc: 0, uAnsi: 1, uBits: 2, uAtlas: 3, uLow: 4, uLabel: 5 };
export const LABEL_H = 0.075; // the microfiche's title strip, in picture heights

// the uniforms of a state; meta: { asp, srcW, ansiGrid: [cols, rows], seed, label (a strip texture is set) }
export function paramsOf(st, m) {
  const [dark, light] = bitColors(st.bit);
  return {
    uLook: { none: 0, ansi: 1, bit: 2, tone: 3 }[st.look] || 0, uMedia: { none: 0, crt: 1, fiche: 2 }[st.media] || 0,
    uAsp: m.asp, uSeed: m.seed || 0,
    uGrid: m.ansiGrid || [1, 1], uGlyphs: glyphCount(st.ansi.set), uAnsiBg: ansiBg(st.ansi),
    uDark: dark, uLight: light,
    uToneN: st.tone.cells, uToneAngle: st.tone.angle * Math.PI / 180, uToneShape: st.tone.shape === 'line' ? 1 : 0,
    uToneCmyk: st.tone.ink === 'cmyk' ? 1 : 0, uToneLod: Math.max(0, Math.log2((m.srcW || 1) / st.tone.cells)),
    uPaper: hexRgb(PAPER), uInk: hexRgb(INK),
    uPhos: { color: 0, green: 1, amber: 2, white: 3 }[st.crt.phos] || 0, uPhosColor: hexRgb(PHOSPHOR[st.crt.phos] || '#ffffff'),
    uLines: st.crt.lines, uBulge: st.crt.bulge / 100, uVig: st.crt.vig / 100, uGrain: st.crt.grain / 100, uGlow: st.crt.glow / 100,
    uClear: st.crt.around === 'clear' ? 1 : 0,
    uBack: hexRgb(BACKLIGHT[st.fiche.light] || BACKLIGHT.green), uFall: st.fiche.fall / 100, uFGrain: st.fiche.grain / 100,
    uFocus: st.fiche.focus / 100, uNeg: st.fiche.neg ? 1 : 0, uMarks: st.fiche.marks ? 1 : 0,
    uLabelOn: st.fiche.label && m.label ? 1 : 0, uLabelH: LABEL_H,
  };
}

export function createFx(canvas, onLost) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: true, depth: false, stencil: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('шейдер не собрался: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('шейдер не собрался: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle over the view
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const loc = new Map();
  const at = (n) => { if (!loc.has(n)) loc.set(n, gl.getUniformLocation(prog, n)); return loc.get(n); };
  for (const [n, u] of Object.entries(UNITS)) gl.uniform1i(at(n), u);

  const tex = (unit, { mip = false, near = false } = {}) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : near ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, near ? gl.NEAREST : gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // empty until set
    return t;
  };
  const T = {
    src: tex(0, { mip: true }), ansi: tex(1, { near: true }), bits: tex(2, { mip: true, near: true }),
    atlas: tex(3, { mip: true }), low: tex(4, { mip: true }), label: tex(5, { mip: true }), none: tex(6),
  };
  const bind = (unit, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
  const MAX_VIEW = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  // framebuffers: the small look for the glow, and the piece being drawn for a tile or the file
  const fbo = (w, h) => {
    const t = gl.createTexture();
    bind(7, t); // a spare unit: bound to a sampler's unit it would be read while drawn into
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f, t, w, h };
  };
  let lowF = null, piece = null;
  const lowFbo = () => {
    if (!lowF) {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.low, 0);
      lowF = { f, w: 0, h: 0 };
    }
    return lowF;
  };
  const pieceFbo = (w, h) => {
    if (!piece || piece.w < w || piece.h < h) {
      if (piece) { gl.deleteFramebuffer(piece.f); gl.deleteTexture(piece.t); }
      piece = fbo(Math.max(w, piece ? piece.w : 0), Math.max(h, piece ? piece.h : 0));
    }
    return piece;
  };

  const set = (u) => {
    for (const [n, v] of Object.entries(u)) {
      const l = at(n);
      if (!l) continue;
      if (Array.isArray(v)) gl[`uniform${v.length}fv`](l, v);
      else if (INTS.has(n)) gl.uniform1i(l, v);
      else gl.uniform1f(l, v);
    }
  };
  // the look alone into the small texture the glow blurs (its mipmaps); `long` — its long side
  function low(u, long) {
    const w = u.uAsp >= 1 ? long : Math.max(1, Math.round(long * u.uAsp)), h = u.uAsp >= 1 ? Math.max(1, Math.round(long / u.uAsp)) : long;
    const L = lowFbo();
    bind(4, T.none); // not sampled while drawn into (a feedback loop is an error)
    if (L.w !== w || L.h !== h) {
      bind(6, T.low);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      L.w = w; L.h = h;
      bind(6, T.none);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, L.f);
    gl.viewport(0, 0, w, h);
    set({ ...u, uPass: 0, uDraw: [w, h], uPiece: [0, 0, h], uCrop: [0, 0, 1, 1] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bind(4, T.low);
    gl.generateMipmap(gl.TEXTURE_2D);
    // the glow's blur: about 1.5 % of the picture's height
    return Math.max(0, Math.log2(Math.max(1, h * 0.015)));
  }
  function pass(u, dw, dh, x, y, ph, crop, lowLod) {
    set({ ...u, uPass: 1, uDraw: [dw, dh], uPiece: [x, y, ph], uCrop: crop, uLowLod: lowLod });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // a piece read back is upside down (GL rows go up)
  function readFlipped(w, h) {
    const buf = new Uint8ClampedArray(w * h * 4), row = w * 4;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = new Uint8ClampedArray(buf.length);
    for (let r = 0; r < h; r++) out.set(buf.subarray((h - 1 - r) * row, (h - r) * row), r * row);
    return new ImageData(out, w, h);
  }
  const upload = (unit, t, w, h, data, fmt = gl.RGBA, internal = gl.RGBA8) => {
    bind(unit, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, gl.UNSIGNED_BYTE, data);
  };

  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; if (onLost) onLost(); });

  return {
    maxTex: MAX_TEX,
    get lost() { return lost; },
    source(bitmap) {
      bind(0, T.src);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    ansi(data, cols, rows) { upload(1, T.ansi, cols, rows, data); },
    bits(data, cols, rows) { upload(2, T.bits, cols, rows, data, gl.RED, gl.R8); gl.generateMipmap(gl.TEXTURE_2D); },
    atlas(cv) { bind(3, T.atlas); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D); },
    label(cv) {
      bind(5, T.label);
      if (cv) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    draw(u, crop = [0, 0, 1, 1]) {
      if (lost) return;
      const lod = low(u, 512);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      pass(u, canvas.width, canvas.height, 0, 0, canvas.height, crop, lod);
    },
    tile(u, w, h, crop) {
      if (lost) return null;
      const lod = low(u, 128);
      const P = pieceFbo(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, P.f);
      gl.viewport(0, 0, w, h);
      pass(u, w, h, 0, 0, h, crop, lod);
      return readFlipped(w, h);
    },
    // the whole file, piece by piece; onPiece(done, total) may return a promise (the screen breathes between pieces)
    async toCanvas(u, W, H, onPiece) {
      const lod = low(u, 1024);
      const S = Math.min(2048, MAX_VIEW), out = new OffscreenCanvas(W, H), g = out.getContext('2d');
      const nx = Math.ceil(W / S), ny = Math.ceil(H / S);
      let done = 0;
      for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) {
        if (lost) throw new Error('видеокарта сбросила рисунок');
        const pw = Math.min(S, W - x), ph = Math.min(S, H - y), P = pieceFbo(pw, ph);
        gl.bindFramebuffer(gl.FRAMEBUFFER, P.f);
        gl.viewport(0, 0, pw, ph);
        pass(u, W, H, x, y, ph, [0, 0, 1, 1], lod);
        g.putImageData(readFlipped(pw, ph), x, y);
        if (onPiece) await onPiece(++done, nx * ny);
      }
      return out;
    },
    dispose() {
      const x = gl.getExtension('WEBGL_lose_context');
      if (x) x.loseContext();
    },
  };
}

// ——— textures drawn on a canvas ———
// the glyphs of a text set in one row, white on transparent, 64 px a cell
export async function glyphAtlas(set) {
  const S = 64, list = GLYPHS[set] || GLYPHS.blocks, n = list.length;
  const c = new OffscreenCanvas(S * n, S), g = c.getContext('2d');
  g.fillStyle = '#fff';
  if (set === 'ascii') {
    const font = `700 ${Math.round(S * 0.9)}px "Geist Mono Variable", Consolas, monospace`;
    try { await document.fonts.load(font); } catch (e) { /* the fallback font draws them */ }
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    list.forEach((ch, i) => g.fillText(ch, i * S + S / 2, S / 2 + S * 0.04));
  } else if (set === 'dots') {
    // a 5 × 5 matrix in a 7 × 7 cell (a dot of space around), round dots
    const d = S / 7;
    list.forEach((mask, i) => {
      for (let k = 0; k < 25; k++) if (mask >> k & 1) {
        g.beginPath();
        g.arc(i * S + (1.5 + (k % 5)) * d, (1.5 + Math.floor(k / 5)) * d, d * 0.42, 0, Math.PI * 2);
        g.fill();
      }
    });
  } else {
    // ░ ▒ ▓ as the 8 × 8 patterns of a text screen: a quarter, a half, three quarters of the dots; █ full
    const d = S / 8, lit = [() => false, (x, y) => (y % 2 === 0 ? x % 4 === 0 : x % 4 === 2), (x, y) => (x + y) % 2 === 0,
      (x, y) => !(y % 2 === 0 ? x % 4 === 0 : x % 4 === 2), () => true];
    lit.forEach((f, i) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (f(x, y)) g.fillRect(i * S + x * d, y * d, d, d); });
  }
  return c;
}
// the microfiche's title strip: the name on the left, the date on the right, white on transparent
export async function labelCanvas(name, date, asp) {
  const W = 2048, H = Math.max(24, Math.round(W * LABEL_H / asp));
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
  const font = `600 ${Math.round(H * 0.4)}px "Geist Mono Variable", Consolas, monospace`;
  try { await document.fonts.load(font); } catch (e) { /* the fallback font draws it */ }
  g.font = font; g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const pad = Math.round(H * 0.7) * Math.min(1, asp);
  g.textAlign = 'right';
  g.fillText(date, W - pad, H / 2);
  const room = W - pad * 3 - g.measureText(date).width;
  g.textAlign = 'left';
  let t = String(name).toUpperCase();
  while (t.length > 1 && g.measureText(t).width > room) t = t.slice(0, -2) + '…';
  g.fillText(t, pad, H / 2);
  return c;
}
