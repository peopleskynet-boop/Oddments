// Materials: a PBR material is one library file, `<name>.perchmat` — a ZIP with `material.json` and its texture maps.
// One file keeps the library format unchanged (one original per item) and travels to Blender as is: the addon
// unzips it and builds a Principled BSDF. Texture sets from Poly Haven / ambientCG / Substance exports (a zip or a
// handful of images named …_diff, …_nor_gl, …_rough…) are recognised by file name and packed into a .perchmat.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';

export const MAT_EXT = 'perchmat';

// slot → what Blender's Principled BSDF / three's MeshPhysicalMaterial call it, in the panel's order
export const SLOTS = [
  { id: 'baseColor', label: 'Цвет', color: true },
  { id: 'normal', label: 'Нормали' },
  { id: 'roughness', label: 'Шероховатость' },
  { id: 'metalness', label: 'Металл' },
  { id: 'ao', label: 'Затенение (AO)' },
  { id: 'arm', label: 'AO · Шерох. · Металл' },
  { id: 'height', label: 'Высота' },
  { id: 'emissive', label: 'Свечение', color: true },
  { id: 'opacity', label: 'Прозрачность' },
];

// file name → slot. The slot word is looked for from the end of the name («rough_stone_ao_2k» is AO, not roughness);
// two-word forms («nor_gl», «base_color», «ambient_occlusion») are checked before single words.
const WORDS = {
  arm: 'arm', orm: 'arm',
  norgl: 'normal', normalgl: 'normal', nor: 'normal', nrm: 'normal', norm: 'normal', normal: 'normal', nordx: 'normal:dx', normaldx: 'normal:dx',
  diff: 'baseColor', diffuse: 'baseColor', albedo: 'baseColor', basecolor: 'baseColor', basecolour: 'baseColor', col: 'baseColor', color: 'baseColor', colour: 'baseColor',
  rough: 'roughness', roughness: 'roughness', rgh: 'roughness',
  metal: 'metalness', metallic: 'metalness', metalness: 'metalness', mtl: 'metalness',
  ao: 'ao', occlusion: 'ao', ambientocclusion: 'ao',
  disp: 'height', displacement: 'height', height: 'height', bump: 'height',
  emissive: 'emissive', emission: 'emissive', emit: 'emissive',
  opacity: 'opacity', alpha: 'opacity', mask: 'opacity',
};
const IMG = /\.(png|jpe?g|webp|tga|tiff?|exr|bmp)$/i;
const BROWSER_IMG = /\.(png|jpe?g|webp|bmp)$/i;

export function slotFor(fileName) {
  const t = fileName.replace(/^.*[\\/]/, '').replace(IMG, '').toLowerCase().split(/[_\-. ]+/).filter(Boolean);
  for (let i = t.length - 1; i >= 0; i--) {
    const w = (i > 0 && WORDS[t[i - 1] + t[i]]) || WORDS[t[i]];
    if (w) { const [slot, dx] = w.split(':'); return { slot, dx: !!dx }; }
  }
  return null;
}

// a material name from map file names: «brick_wall_02_diff_1k.jpg» → «brick wall 02»
function nameFrom(names) {
  const b = names.map((n) => n.replace(/^.*[\\/]/, '').replace(IMG, ''));
  let p = b[0] || 'Материал';
  for (const n of b) { let i = 0; while (i < p.length && i < n.length && p[i] === n[i]) i++; p = p.slice(0, i); }
  p = p.replace(/[_\-. ]+(\d+k)?[_\-. ]*$/i, '').replace(/[_\-]+/g, ' ').trim();
  return p.length >= 2 ? p : (b[0] || 'Материал').replace(/[_\-]+/g, ' ');
}

export const defaults = () => ({ color: '#ffffff', roughness: 0.5, metalness: 0, normalScale: 1, uvScale: 1, emissive: '#000000', emissiveStrength: 1, opacity: 1, heightScale: 0, bumpStrength: 0 });

/** files: [{ name, data: Uint8Array }] → { json, files } when at least one map is recognised, else null */
export function recognise(files) {
  const maps = {}, picked = {};
  let dx = false;
  // prefer the browser-readable copy when the same slot comes as .exr and .png
  for (const f of files) {
    if (!IMG.test(f.name)) continue;
    const s = slotFor(f.name);
    if (!s) continue;
    const prev = picked[s.slot];
    if (prev && BROWSER_IMG.test(prev.name) && !BROWSER_IMG.test(f.name)) continue;
    if (prev && s.slot === 'normal' && s.dx && !prev.dx) continue; // OpenGL normals win over DirectX ones
    picked[s.slot] = { ...f, dx: !!s.dx };
  }
  if (!Object.keys(picked).length) return null;
  const out = {};
  for (const [slot, f] of Object.entries(picked)) {
    const ext = (f.name.match(/\.(\w+)$/) || ['', 'png'])[1].toLowerCase();
    const n = `${slot}.${ext}`;
    maps[slot] = n; out[n] = f.data;
    if (slot === 'normal') dx = f.dx;
  }
  const json = { perch: 1, name: nameFrom(Object.values(picked).map((f) => f.name)), ...defaults(), normalDX: dx, maps };
  if (maps.metalness || maps.arm) json.metalness = 1; // the map decides; 1 lets it through unchanged
  if (maps.roughness || maps.arm) json.roughness = 1;
  return { json, files: out };
}

export function pack({ json, files }) {
  const z = { 'material.json': strToU8(JSON.stringify(json, null, 2)) };
  for (const [n, d] of Object.entries(files || {})) z[n] = [d, { level: 0 }]; // images are compressed already
  return new Blob([zipSync(z)], { type: 'application/x-perch-material' });
}

// zip bombs (audit #38): a material's maps are at most 256 MB each and 1 GB together once unpacked
const ZIP_FILE_MAX = 256 << 20, ZIP_TOTAL_MAX = 1 << 30;
function guard() {
  let total = 0;
  return (f) => {
    const size = f.originalSize || 0;
    if (size > ZIP_FILE_MAX) throw new Error('Файл в архиве слишком большой: ' + f.name);
    total += size;
    if (total > ZIP_TOTAL_MAX) throw new Error('Архив распаковывается больше чем в 1 ГБ');
    return true;
  };
}

export function unpack(buf) {
  const g = guard();
  const z = unzipSync(new Uint8Array(buf), { filter: g });
  if (!z['material.json']) throw new Error('В файле нет material.json');
  const json = { ...defaults(), ...JSON.parse(strFromU8(z['material.json'])) };
  json.maps = json.maps || {};
  return { json, files: z };
}

/** A zip from a texture site → .perchmat blob and name, or null when it is not a texture set */
export function fromZip(u8) {
  let z;
  const g = guard();
  try { z = unzipSync(u8, { filter: (f) => (IMG.test(f.name) || f.name.endsWith('material.json')) && g(f) }); } catch (e) { return null; }
  if (z['material.json']) return null; // already a .perchmat that was renamed
  const r = recognise(Object.entries(z).map(([name, data]) => ({ name, data })));
  return r ? { blob: pack(r), name: r.json.name } : null;
}

/* ---------- three.js ---------- */
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };
async function texture(THREE, name, data, color, uvScale) {
  const ext = name.split('.').pop().toLowerCase();
  if (!MIME[ext]) return null; // .exr/.tga/.tif: kept for Blender, not shown here
  const bmp = await createImageBitmap(new Blob([data], { type: MIME[ext] }), { imageOrientation: 'flipY' });
  const t = new THREE.Texture(bmp);
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(uvScale, uvScale);
  t.anisotropy = 8;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** { json, files } → MeshPhysicalMaterial; textures are created once and kept in material.userData.maps */
export async function buildMaterial(THREE, { json, files }) {
  const m = new THREE.MeshPhysicalMaterial();
  const maps = {};
  for (const s of SLOTS) {
    const n = json.maps[s.id];
    if (n && files[n]) maps[s.id] = await texture(THREE, n, files[n], s.color, json.uvScale || 1).catch(() => null);
  }
  m.userData.maps = maps;
  m.userData.perch = json;
  m.name = json.name || 'Материал';
  applyParams(THREE, m, json);
  return m;
}

export function applyParams(THREE, m, p) {
  const maps = m.userData.maps || {};
  m.color.set(p.color || '#ffffff');
  m.roughness = p.roughness ?? 0.5;
  m.metalness = p.metalness ?? 0;
  m.map = maps.baseColor || null;
  m.normalMap = maps.normal || null;
  const ns = p.normalScale ?? 1;
  m.normalScale.set(ns, p.normalDX ? -ns : ns);
  m.roughnessMap = maps.roughness || maps.arm || null;
  m.metalnessMap = maps.metalness || maps.arm || null;
  m.aoMap = maps.ao || maps.arm || null;
  m.emissive.set(p.emissive || '#000000');
  m.emissiveIntensity = p.emissiveStrength ?? 1;
  m.emissiveMap = maps.emissive || null;
  if (maps.emissive && (p.emissive || '#000000') === '#000000') m.emissive.set('#ffffff');
  m.alphaMap = maps.opacity || null;
  m.opacity = p.opacity ?? 1;
  m.transparent = m.opacity < 1 || !!maps.opacity;
  m.displacementMap = maps.height && p.heightScale ? maps.height : null;
  m.displacementScale = p.heightScale || 0;
  // the height map as bump (Blender's Bump node): relief in the shading, no moved geometry. bumpStrength comes
  // from Blender (Strength) or the slider; 0 / absent keeps the old behaviour (older .perchmat files)
  m.bumpMap = maps.height && p.bumpStrength ? maps.height : null;
  m.bumpScale = (p.bumpStrength || 0) * 2;
  Object.values(maps).forEach((t) => { if (t) { t.repeat.set(p.uvScale || 1, p.uvScale || 1); } });
  m.needsUpdate = true;
}

export function disposeMaterial(m) {
  Object.values(m.userData.maps || {}).forEach((t) => { if (t) { if (t.image && t.image.close) t.image.close(); t.dispose(); } });
  m.dispose();
}

export const SHAPES = [
  { id: 'sphere', label: 'Сфера' },
  { id: 'cube', label: 'Куб' },
  { id: 'torus', label: 'Тор' },
  { id: 'plane', label: 'Плита' },
];
export function shapeGeometry(THREE, id) {
  let g;
  if (id === 'cube') g = roundedBox(THREE, 1.5, 0.12, 6);
  else if (id === 'torus') g = new THREE.TorusKnotGeometry(0.62, 0.22, 256, 48);
  else if (id === 'plane') { g = new THREE.PlaneGeometry(2.4, 2.4, 256, 256); g.rotateX(-Math.PI / 2); }
  else g = new THREE.SphereGeometry(1, 192, 128);
  return g;
}

// a box with rounded edges and continuous UVs per face (so tiling textures show seams the way a real cube does)
function roundedBox(THREE, size, r, seg) {
  const g = new THREE.BoxGeometry(size, size, size, 24, 24, 24);
  const p = g.attributes.position, h = size / 2 - r, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
    v.sub(c);
    if (v.lengthSq() > 0) v.normalize().multiplyScalar(r);
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  void seg;
  return g;
}

/** a preview object for the viewer and thumbnails */
export async function materialMesh(T, buf, shape = 'sphere') {
  const { THREE } = T;
  const data = unpack(buf);
  const mat = await buildMaterial(THREE, data);
  const mesh = new THREE.Mesh(shapeGeometry(THREE, shape), mat);
  mesh.name = mat.name;
  const g = new THREE.Group();
  g.add(mesh);
  g.animations = [];
  g.userData.material = { data, mat, mesh };
  return g;
}
