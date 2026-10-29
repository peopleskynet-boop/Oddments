// 3D models: Three.js (loaded lazily, only when a model is imported or opened),
// off-screen thumbnails, mesh statistics and the embedded preview of .blend files.

export const MODEL_EXT = ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'dae', '3mf', '3ds', 'usdz', 'perchmat', 'spz', 'splat', 'ksplat', 'sog']; // the last four: splats (splat.js)
// formats we catalogue but cannot open in the browser (Blender and Alembic need Blender itself)
export const NO_VIEWER = ['blend', 'abc'];
export const hasViewer = (it) => MODEL_EXT.includes(it.ext);

let threeP = null;
export function loadThree() {
  if (!threeP) {
    threeP = Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/OBJLoader.js'),
      import('three/examples/jsm/loaders/FBXLoader.js'),
      import('three/examples/jsm/loaders/STLLoader.js'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/environments/RoomEnvironment.js'),
      import('three/examples/jsm/loaders/PLYLoader.js'),
      import('three/examples/jsm/loaders/ColladaLoader.js'),
      import('three/examples/jsm/loaders/3MFLoader.js'),
      import('three/examples/jsm/loaders/TDSLoader.js'),
      import('three/examples/jsm/loaders/USDZLoader.js'),
      import('three/examples/jsm/utils/BufferGeometryUtils.js'),
    ]).then(([THREE, g, o, f, s, oc, re, ply, dae, tmf, tds, usdz, bgu]) => ({
      THREE, GLTFLoader: g.GLTFLoader, OBJLoader: o.OBJLoader, FBXLoader: f.FBXLoader, STLLoader: s.STLLoader,
      OrbitControls: oc.OrbitControls, RoomEnvironment: re.RoomEnvironment,
      PLYLoader: ply.PLYLoader, ColladaLoader: dae.ColladaLoader, ThreeMFLoader: tmf.ThreeMFLoader,
      TDSLoader: tds.TDSLoader, USDZLoader: usdz.USDZLoader, BGU: bgu,
    }));
    threeP.catch(() => { threeP = null; });
  }
  return threeP;
}

// a model without its own material (OBJ without .mtl, STL, SVG → 3D): a satin plastic with a clear coat — the
// environment shows in its highlights, so turning the HDRI visibly turns the light on it (a matte grey hardly
// changed, bug #107)
const plainMat = (THREE, colors) => colors
  ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.18 })
  : new THREE.MeshPhysicalMaterial({ color: 0x9aa0aa, roughness: 0.4, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.16 });

// Parses model bytes into an Object3D (animation clips, if any, in obj.animations).
// External files of a .gltf (bin, textures) are not resolved.
export async function parseModel(T, ext, buf) {
  const { THREE } = T;
  if (ext === 'perchmat') { // a material: shown on a sphere
    const { materialMesh } = await import('./material.js');
    return materialMesh(T, buf);
  }
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new T.GLTFLoader().parseAsync(buf, '');
    const sc = gltf.scene || gltf.scenes[0];
    sc.animations = gltf.animations || [];
    return sc;
  }
  if (ext === 'ply') {
    const geo = new T.PLYLoader().parse(buf);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.index && geo.attributes.position.count && !geo.attributes.normal) return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!geo.attributes.color }));
    return new THREE.Mesh(geo, plainMat(THREE, !!geo.attributes.color));
  }
  if (ext === 'dae') {
    const r = new T.ColladaLoader().parse(new TextDecoder().decode(buf), '');
    r.scene.animations = r.scene.animations || [];
    return r.scene;
  }
  if (ext === '3mf') return new T.ThreeMFLoader().parse(buf);
  if (ext === '3ds') return new T.TDSLoader().parse(buf, '');
  if (ext === 'usdz') return new T.USDZLoader().parse(buf, '');
  if (ext === 'obj') {
    const txt = new TextDecoder().decode(buf);
    const g = new T.OBJLoader().parse(earcutNgons(THREE, txt));
    // no vn lines: the loader falls back to flat facets; weld and smooth instead, as Blender shows it
    const hasNormals = /^vn\s/m.test(txt);
    g.traverse((o) => {
      if (!o.isMesh || hasNormals) return;
      const keep = o.geometry.attributes.uv ? ['uv'] : [];
      let geo = o.geometry;
      for (const a of Object.keys(geo.attributes)) if (a !== 'position' && !keep.includes(a)) geo.deleteAttribute(a);
      geo = T.BGU.mergeVertices(geo, 1e-5);
      geo.computeVertexNormals();
      o.geometry.dispose(); o.geometry = geo;
    });
    // no .mtl: OBJLoader's default is a pure white Phong that blows out under the studio light
    g.traverse((o) => {
      if (!o.isMesh) return;
      const swap = (m) => (m && m.isMeshPhongMaterial && !m.map && m.color.getHex() === 0xffffff ? (m.dispose(), plainMat(THREE, false)) : m);
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    return g;
  }
  if (ext === 'fbx') return new T.FBXLoader().parse(buf, '');
  if (ext === 'stl') {
    const geo = new T.STLLoader().parse(buf);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    return new THREE.Mesh(geo, plainMat(THREE, geo.hasColors));
  }
  throw new Error('unsupported model: ' + ext);
}

// Sketchfab-style model info. Loaders triangulate, so polygon structure (quads, n-gons) is only known
// where the source text says it: OBJ faces. `uniq` counts welded vertices (loaders often split them).
export function modelInfo(T, obj, ext, buf) {
  const { THREE } = T;
  let meshes = 0, verts = 0, tris = 0, uvless = 0;
  const mats = new Set(), texs = new Set();
  obj.traverse((o) => {
    if (!(o.isMesh || o.isPoints) || !o.geometry || !o.geometry.attributes.position) return;
    meshes++;
    const g = o.geometry, n = g.attributes.position.count;
    verts += uniqueCount(g.attributes.position); // loaders and exporters often split vertices by face
    if (o.isMesh) tris += Math.floor((g.index ? g.index.count : n) / 3);
    if (!g.attributes.uv) uvless++;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m) return;
      mats.add(m);
      Object.values(m).forEach((v) => { if (v && v.isTexture) texs.add(v.source || v); });
    });
  });
  const info = { meshes, verts, tris, materials: mats.size, textures: texs.size, uvless, quads: null, ngons: null, polys: null };
  if (ext === 'obj' && buf) Object.assign(info, objFaces(new TextDecoder().decode(buf)));
  const box = new THREE.Box3().setFromObject(obj);
  info.size = box.isEmpty() ? null : box.getSize(new THREE.Vector3()).toArray();
  info.animations = (obj.animations || []).map((a) => ({ name: a.name || 'Анимация', duration: a.duration }));
  return info;
}

function uniqueCount(pos) {
  if (pos.count > 3e6) return pos.count;
  const seen = new Set(), a = pos.array, k = pos.itemSize;
  for (let i = 0; i < pos.count; i++) seen.add(a[i * k].toFixed(5) + ',' + a[i * k + 1].toFixed(5) + ',' + a[i * k + 2].toFixed(5));
  return seen.size;
}

// OBJLoader splits a polygon into a fan from its first corner: right for a convex face, wrong for a concave n-gon — the
// cap of «P» (its outline cut open to the hole by a bridge) covered its own hole and flickered (audit 29.10: «рваная
// внутренняя стенка»). Faces of five corners and more are cut by earcut in their own plane, each triangle wound as the
// face was; only what the loader sees changes — the counts and the wireframe read the file's own n-gons.
function earcutNgons(THREE, txt) {
  if (!/^f(?:[ \t]+\S+){5,}/m.test(txt)) return txt;
  const v = [], out = [];
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push([+p[1], +p[2], +p[3]]); out.push(line); continue; }
    const tok = line.startsWith('f ') ? line.trim().split(/\s+/).slice(1) : null;
    if (!tok || tok.length < 5) { out.push(line); continue; }
    const pts = tok.map((t) => { const i = parseInt(t, 10); return v[i < 0 ? v.length + i : i - 1]; });
    if (pts.some((p) => !p)) { out.push(line); continue; }
    // the face's normal (Newell); the plane it is flattened to drops the normal's largest axis
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const [i0, i1] = Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny) ? [0, 1] : Math.abs(nx) >= Math.abs(ny) ? [1, 2] : [2, 0];
    const flat = pts.map((p) => new THREE.Vector2(p[i0], p[i1]));
    const area = THREE.ShapeUtils.area(flat);
    const tris = THREE.ShapeUtils.triangulateShape(flat.slice(), []);
    if (!tris.length) { out.push(line); continue; }
    for (let [a, b, c] of tris) {
      if (THREE.ShapeUtils.area([flat[a], flat[b], flat[c]]) * area < 0) [b, c] = [c, b];
      out.push(`f ${tok[a]} ${tok[b]} ${tok[c]}`);
    }
  }
  return out.join('\n');
}

// counts faces of an OBJ by their vertex count, and its real vertices
function objFaces(txt) {
  let polys = 0, tris = 0, quads = 0, ngons = 0, verts = 0;
  for (const line of txt.split('\n')) {
    if (line.charCodeAt(0) === 118 && line.charCodeAt(1) === 32) { verts++; continue; } // 'v '
    if (line.charCodeAt(0) !== 102 || line.charCodeAt(1) !== 32) continue; // 'f '
    const n = line.trim().split(/\s+/).length - 1;
    polys++;
    if (n === 3) tris++; else if (n === 4) quads++; else if (n > 4) ngons++;
  }
  return polys ? { polys, quads, ngons, triFaces: tris, verts } : {};
}

// Polygon edges of an OBJ as line segments: quads stay quads in the wireframe (loaders triangulate).
export function objEdges(THREE, txt) {
  const v = [], seen = new Set(), seg = [];
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push(+p[1], +p[2], +p[3]); continue; }
    if (!line.startsWith('f ')) continue;
    const ids = line.trim().split(/\s+/).slice(1).map((t) => { const i = parseInt(t, 10); return i < 0 ? v.length / 3 + i : i - 1; });
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k], b = ids[(k + 1) % ids.length], key = a < b ? a + '_' + b : b + '_' + a;
      if (seen.has(key)) continue;
      seen.add(key);
      seg.push(v[a * 3], v[a * 3 + 1], v[a * 3 + 2], v[b * 3], v[b * 3 + 1], v[b * 3 + 2]);
    }
    if (seg.length > 3e7) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  return g;
}

export function meshStats(obj) {
  let verts = 0, tris = 0;
  obj.traverse((o) => {
    const g = o.isMesh && o.geometry;
    if (!g || !g.attributes.position) return;
    const n = g.attributes.position.count;
    verts += uniqueCount(g.attributes.position); // welded, the same count the 3D viewer shows
    tris += Math.floor((g.index ? g.index.count : n) / 3);
  });
  return { verts, tris };
}

// Places the camera so the whole object fits; returns { center, dist, radius }.
export function frameObject(THREE, obj, camera, margin = 1.15) {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, 1e-6);
  const fov = (camera.fov * Math.PI) / 180, fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
  const dist = (r * margin) / Math.sin(fit / 2);
  const dir = new THREE.Vector3(1, 0.7, 1.25).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 100; camera.far = dist * 100;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  return { center: sphere.center.clone(), dist, radius: r, minY: box.isEmpty() ? 0 : box.min.y };
}

// Scene lighting shared by the thumbnail and the viewer: a neutral studio environment plus a key light.
export function makeEnv(T, renderer, scene) {
  const { THREE } = T;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  return env;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    mats.forEach((m) => {
      Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); });
      m.dispose();
    });
  });
}

// Off-screen render: { canvas (on a neutral background), colorSrc (transparent, model pixels only), w, h, verts, tris }.
export async function renderModelThumb(buf, ext, W = 640, H = 480) {
  const T = await loadThree();
  const { THREE } = T;
  const obj = await parseModel(T, ext, buf);
  const glc = document.createElement('canvas');
  glc.width = W; glc.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, alpha: true, preserveDrawingBuffer: true });
  let env = null;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    env = makeEnv(T, renderer, scene);
    scene.add(obj);
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 1000);
    frameObject(THREE, obj, cam);
    renderer.render(scene, cam);
    const colorSrc = document.createElement('canvas');
    colorSrc.width = W; colorSrc.height = H;
    colorSrc.getContext('2d').drawImage(glc, 0, 0);
    // the thumbnail keeps its transparent background: the card puts the theme's own backdrop under it (.m3d-bg), so a
    // model is not a dark tile in a light theme (it was drawn on a fixed dark gradient)
    return { canvas: colorSrc, colorSrc, w: W, h: H, ...meshStats(obj) };
  } finally {
    disposeObject(obj);
    if (env) env.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/* ---------- .blend embedded preview ---------- */

// Reads up to `limit` bytes of a (possibly gzip-compressed) .blend.
async function blendHead(blob, limit = 4 << 20) {
  const magic = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') return null;
    const rd = blob.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts = [];
    let n = 0;
    try {
      while (n < limit) {
        const { done, value } = await rd.read();
        if (done) break;
        parts.push(value); n += value.length;
        // the preview sits right after the header; stop as soon as it is in
        const r = parseBlendPreview(concat(parts, n));
        if (r !== undefined) return r;
      }
    } finally { rd.cancel().catch(() => {}); }
    return parseBlendPreview(concat(parts, n), true) || null;
  }
  if (magic[0] === 0x28 && magic[1] === 0xb5 && magic[2] === 0x2f && magic[3] === 0xfd) return null; // zstd: not supported
  return parseBlendPreview(new Uint8Array(await blob.slice(0, limit).arrayBuffer()), true) || null;
}

function concat(parts, n) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Walks file blocks until TEST (the preview). Returns { w, h, rgba } or null when there is none;
// undefined means "need more bytes" (unless `final`).
export function parseBlendPreview(u8, final = false) {
  if (u8.length < 12) return final ? null : undefined;
  const txt = (a, b) => String.fromCharCode(...u8.subarray(a, b));
  if (txt(0, 7) !== 'BLENDER') return null;
  let ptr, little, off, large = false;
  if (u8[7] === 0x5f || u8[7] === 0x2d) { // legacy: BLENDER_v279 / BLENDER-v405
    ptr = u8[7] === 0x5f ? 4 : 8; little = u8[8] === 0x76; off = 12;
  } else { // Blender 5+: BLENDER17-01v0500, 64-bit lengths
    const hlen = parseInt(txt(7, 9), 10);
    if (!(hlen > 0)) return null;
    ptr = 8; large = true; little = u8[12] === 0x76; off = hlen;
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const i32 = (o) => dv.getInt32(o, little);
  const i64 = (o) => Number(dv.getBigInt64(o, little));
  const hsize = large ? 32 : 16 + ptr;
  for (let guard = 0; guard < 64; guard++) {
    if (off + hsize > u8.length) return final ? null : undefined;
    const code = txt(off, off + 4);
    const len = large ? i64(off + 16) : i32(off + 4);
    const data = off + hsize;
    if (code === 'TEST') {
      if (data + 8 > u8.length) return final ? null : undefined;
      const w = i32(data), h = i32(data + 4);
      if (w <= 0 || h <= 0 || w > 1024 || h > 1024) return null;
      if (data + 8 + w * h * 4 > u8.length) return final ? null : undefined;
      return { w, h, rgba: u8.slice(data + 8, data + 8 + w * h * 4) };
    }
    if (code !== 'REND') return null; // the preview, if any, comes before everything else
    off = data + len;
  }
  return null;
}

// Canvas (upscaled for the grid) from the .blend preview, or null.
export async function blendThumb(blob) {
  const p = await blendHead(blob);
  if (!p) return null;
  const src = document.createElement('canvas');
  src.width = p.w; src.height = p.h;
  const img = new ImageData(new Uint8ClampedArray(p.rgba.buffer, p.rgba.byteOffset, p.rgba.length), p.w, p.h);
  src.getContext('2d').putImageData(img, 0, 0);
  // rows are stored bottom-up: flip, and scale up so the card is not a 128px smudge
  const S = 4, c = document.createElement('canvas');
  c.width = p.w * S; c.height = p.h * S;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2a2e'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.translate(0, c.height); x.scale(1, -1);
  x.drawImage(src, 0, 0, c.width, c.height);
  // flipped transparent copy for colours
  const colorSrc = document.createElement('canvas');
  colorSrc.width = p.w; colorSrc.height = p.h;
  const y = colorSrc.getContext('2d');
  y.translate(0, p.h); y.scale(1, -1); y.drawImage(src, 0, 0);
  return { canvas: c, colorSrc, w: p.w, h: p.h };
}
