// Demo 3D files for the browser build: a few procedural scenes exported to GLB with GLTFExporter,
// and a synthetic .blend (header + REND + TEST preview block, gzip-compressed) to exercise the preview reader.
import { generate } from '../lib/ingest.js';

async function makeGlb(THREE, GLTFExporter, k) {
  const scene = new THREE.Scene();
  const mat = (c, r = 0.45, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  if (k === 0) { // torus knot on a plinth
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.26, 220, 32), mat(0xd9643a, 0.3, 0.1));
    knot.position.y = 1.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.3, 64), mat(0xe8e2d6, 0.8));
    scene.add(knot, base);
  } else if (k === 1) { // stool
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 48), mat(0x8e6c55, 0.6));
    seat.position.y = 1.5;
    scene.add(seat);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 16), mat(0x1f2a2e, 0.3, 0.8));
      leg.position.set(Math.cos(a) * 0.6, 0.75, Math.sin(a) * 0.6);
      leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      scene.add(leg);
    }
  } else { // cluster of faceted crystals
    const cols = [0x5b4b8a, 0xffb4a2, 0x3e7c8c, 0xefe9f4];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25 + (i % 4) * 0.12, 0), mat(cols[i % 4], 0.25, 0.2));
      const a = i * 2.4;
      m.position.set(Math.cos(a) * (0.3 + i * 0.12), 0.3 + (i % 3) * 0.35, Math.sin(a) * (0.3 + i * 0.12));
      m.rotation.set(i, i * 0.7, 0);
      scene.add(m);
    }
  }
  const buf = await new GLTFExporter().parseAsync(scene, { binary: true });
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return new Blob([buf], { type: 'model/gltf-binary' });
}

// Quad-dominant OBJ (a torus of quads, outward-facing, no normals in the file) so the info panel shows quads.
function makeObj() {
  const R = 1, r = 0.38, N = 36, M = 18, L = ['# Oddments demo: quad torus'];
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const u = (i / N) * Math.PI * 2, v = (j / M) * Math.PI * 2;
    L.push(`v ${((R + r * Math.cos(v)) * Math.cos(u)).toFixed(5)} ${(r * Math.sin(v)).toFixed(5)} ${((R + r * Math.cos(v)) * Math.sin(u)).toFixed(5)}`);
  }
  const id = (i, j) => ((i % N) * M + (j % M)) + 1;
  // counter-clockwise seen from outside, so the faces point outwards
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) L.push(`f ${id(i, j)} ${id(i, j + 1)} ${id(i + 1, j + 1)} ${id(i + 1, j)}`);
  return new Blob([L.join('\n')], { type: 'model/obj' });
}

// Animated GLB: a spinning, bobbing knot, to test animation playback.
async function makeAnimated(THREE, GLTFExporter) {
  const scene = new THREE.Scene();
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.6, 0.2, 160, 24), new THREE.MeshStandardMaterial({ color: 0x3ddc97, roughness: 0.3 }));
  knot.name = 'knot';
  scene.add(knot);
  const q = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a).toArray();
  const clip = new THREE.AnimationClip('Вращение', 3, [
    new THREE.QuaternionKeyframeTrack('knot.quaternion', [0, 1, 2, 3], [...q(0), ...q(2.1), ...q(4.2), ...q(6.283)]),
    new THREE.VectorKeyframeTrack('knot.position', [0, 1.5, 3], [0, 0, 0, 0, 0.4, 0, 0, 0, 0]),
  ]);
  const buf = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [clip] });
  knot.geometry.dispose(); knot.material.dispose();
  return new Blob([buf], { type: 'model/gltf-binary' });
}

// ASCII PLY icosphere with vertex colours.
async function makePly(THREE, PLYExporter) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); col.set([0.9, 0.45 + y * 0.3, 0.2 + (1 - y) * 0.3], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
  const txt = await new Promise((res) => new PLYExporter().parse(mesh, res, { binary: false }));
  geo.dispose(); mesh.material.dispose();
  return new Blob([txt], { type: 'model/x-ply' });
}

// Minimal .blend: "BLENDER-v405" + REND block + TEST (128×128 RGBA, rows bottom-up) + ENDB.
async function makeBlend() {
  const W = 128, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(54, 50, 6, 64, 64, 60);
  g.addColorStop(0, '#f2b880'); g.addColorStop(0.6, '#c4532f'); g.addColorStop(1, '#4a1e12');
  x.fillStyle = '#2b2b30'; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(64, 112, 40, 8, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = g; x.beginPath(); x.arc(64, 62, 44, 0, Math.PI * 2); x.fill();
  const px = x.getImageData(0, 0, W, H).data;
  const rows = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) rows.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);

  const parts = [new TextEncoder().encode('BLENDER-v405')];
  const block = (code, data) => {
    const h = new DataView(new ArrayBuffer(24));
    for (let i = 0; i < 4; i++) h.setUint8(i, code.charCodeAt(i) || 0);
    h.setInt32(4, data.length, true);
    h.setInt32(20, 1, true);
    parts.push(new Uint8Array(h.buffer), data);
  };
  block('REND', new Uint8Array(72));
  const test = new Uint8Array(8 + rows.length);
  new DataView(test.buffer).setInt32(0, W, true);
  new DataView(test.buffer).setInt32(4, H, true);
  test.set(rows, 8);
  block('TEST', test);
  block('ENDB', new Uint8Array(0));
  const raw = new Blob(parts);
  return new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

// Returns [{ name, ext, blob, thumb, w, h, ar, colors, verts?, tris? }]
export async function demoModels() {
  try {
    const [THREE, { GLTFExporter }, { PLYExporter }] = await Promise.all([import('three'), import('three/examples/jsm/exporters/GLTFExporter.js'), import('three/examples/jsm/exporters/PLYExporter.js')]);
    const out = [];
    const names = ['Узел', 'Табурет', 'Кристаллы'];
    for (let k = 0; k < 3; k++) out.push({ name: names[k], ext: 'glb', blob: await makeGlb(THREE, GLTFExporter, k) });
    out.push({ name: 'Сфера (Blender)', ext: 'blend', blob: await makeBlend() });
    out.push({ name: 'Тор из квадов', ext: 'obj', blob: makeObj() });
    out.push({ name: 'Анимация', ext: 'glb', blob: await makeAnimated(THREE, GLTFExporter) });
    out.push({ name: 'Икосфера', ext: 'ply', blob: await makePly(THREE, PLYExporter) });
    out.push({ name: 'Кэш симуляции', ext: 'abc', blob: new Blob([new Uint8Array([0x4f, 0x67, 0x61, 0x77, 0x61, 0xff, 0, 1])]) });
    for (const m of out) {
      const g = await generate({ id: 'seed3d', kind: 'model', ext: m.ext, name: m.name }, { size: m.blob.size, getBlob: async () => m.blob });
      Object.assign(m, { thumb: g.thumb, w: g.w, h: g.h, ar: g.ar, colors: g.colors }, g.verts ? { verts: g.verts, tris: g.tris } : {});
    }
    return out;
  } catch (e) {
    console.warn('demo 3D failed', e);
    return [];
  }
}

/* ---------- demo materials: procedural texture sets packed as .perchmat ---------- */
const canvasPng = (S, paint) => {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let i = 0; i < S; i++) {
    const [r, g, b] = paint(i / S, y / S), o = (y * S + i) * 4;
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), 'image/png'));
};
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.5 + vnoise(x * 2, y * 2) * 0.25 + vnoise(x * 4, y * 4) * 0.125 + vnoise(x * 8, y * 8) * 0.0625;
// a tangent-space normal map from a height function (OpenGL: green up)
const normalFrom = (h, k) => (u, v) => {
  const e = 1 / 256, dx = (h(u + e, v) - h(u - e, v)) * k, dy = (h(u, v + e) - h(u, v - e)) * k;
  const l = Math.hypot(dx, dy, 1);
  return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
};

export async function demoMaterials() {
  try {
    const M = await import('../lib/material.js');
    const S = 256, out = [];
    // bricks: rows of 4 × 8, mortar lines, a little colour noise per brick
    const brickH = (u, v) => {
      const r = Math.floor(v * 8), uu = u * 4 + (r % 2) * 0.5, fu = uu - Math.floor(uu), fv = v * 8 - r;
      const m = Math.min(fu, 1 - fu) * 4, n = Math.min(fv, 1 - fv) * 2; // distance to the mortar
      return Math.min(1, Math.min(m, n) * 6) * 0.8 + fbm(u * 16, v * 16) * 0.2;
    };
    const bricks = {
      'red_brick_diff.png': await canvasPng(S, (u, v) => {
        const h = brickH(u, v), r = Math.floor(v * 8), c = Math.floor(u * 4 + (r % 2) * 0.5), t = hash(c, r) * 0.25 + fbm(u * 24, v * 24) * 0.2;
        return h < 0.5 ? [150, 146, 138] : [140 + t * 120, 58 + t * 50, 40 + t * 30];
      }),
      'red_brick_nor_gl.png': await canvasPng(S, normalFrom(brickH, 3)),
      'red_brick_rough.png': await canvasPng(S, (u, v) => { const g = 200 + fbm(u * 20, v * 20) * 55; return [g, g, g]; }),
    };
    // brushed metal: long horizontal streaks
    const brushed = {
      'brushed_metal_diff.png': await canvasPng(S, (u, v) => { const g = 175 + vnoise(u * 3, v * 180) * 50; return [g, g + 2, g + 6]; }),
      'brushed_metal_rough.png': await canvasPng(S, (u, v) => { const g = 60 + vnoise(u * 2, v * 220) * 70; return [g, g, g]; }),
      'brushed_metal_metal.png': await canvasPng(S, () => [255, 255, 255]),
    };
    // wood: rings bent by noise
    const woodH = (u, v) => { const r = (u * 9 + fbm(u * 3, v * 6) * 2.2) % 1; return Math.pow(Math.sin(r * Math.PI), 0.6); };
    const wood = {
      'oak_planks_diff.png': await canvasPng(S, (u, v) => { const h = woodH(u, v), n = fbm(u * 40, v * 4) * 0.15; return [150 + h * 60 - n * 90, 98 + h * 42 - n * 70, 58 + h * 22 - n * 40]; }),
      'oak_planks_nor_gl.png': await canvasPng(S, normalFrom(woodH, 0.6)),
      'oak_planks_rough.png': await canvasPng(S, (u, v) => { const g = 150 + woodH(u, v) * 70; return [g, g, g]; }),
    };
    const sets = [['Кирпич', bricks, {}], ['Шлифованный металл', brushed, {}], ['Дуб', wood, { uvScale: 2 }]];
    for (const [name, files, extra] of sets) {
      const r = M.recognise(Object.entries(files).map(([n, data]) => ({ name: n, data })));
      Object.assign(r.json, { name }, extra);
      const blob = M.pack(r);
      const g = await generate({ id: 'seedmat', kind: 'material', ext: 'perchmat', name }, { size: blob.size, getBlob: async () => blob });
      out.push({ name, ext: 'perchmat', blob, thumb: g.thumb, w: g.w, h: g.h, ar: g.ar, colors: g.colors });
    }
    return out;
  } catch (e) {
    console.warn('demo materials failed', e);
    return [];
  }
}
