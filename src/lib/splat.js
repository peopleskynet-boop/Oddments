// Gaussian splats (3DGS): which files are splats, their thumbnails, a standard PLY writer and «Сплат из модели» — a model
// turned into splats without training. Its geometry is known, so nothing has to be learned: points are laid evenly over
// the surface as flat discs, and each one's colour comes from renders of the model from many sides (the light of the 3D
// view baked in), fitted as a colour plus a part that changes with the view (spherical harmonics of degree 1), so
// highlights move a little as one turns around. Rendering is Spark (World Labs, MIT; WebGL2, three r180+), lazily.

export const SPLAT_EXT = ['spz', 'splat', 'ksplat', 'sog'];

// A .ply is a splat when its header has the 3DGS fields (a scanned mesh has x y z, normals, colours, faces), or the
// packed fields of a compressed PLY (SuperSplat / PlayCanvas).
export function isSplatPly(u8) {
  const head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 8192)));
  const end = head.indexOf('end_header');
  if (!head.startsWith('ply') || end < 0) return false;
  const h = head.slice(0, end), has = (p) => new RegExp(`property\\s+\\w+\\s+${p}\\b`).test(h);
  return (has('opacity') && (has('f_dc_0') || has('scale_0'))) || has('packed_position');
}
export const isSplatFile = (ext, u8) => SPLAT_EXT.includes(ext) || (ext === 'ply' && !!u8 && isSplatPly(u8));

let sparkP = null;
export function loadSpark() {
  if (!sparkP) {
    sparkP = Promise.all([import('three'), import('@sparkjsdev/spark')]).then(([THREE, S]) => ({ THREE, S }));
    sparkP.catch(() => { sparkP = null; });
  }
  return sparkP;
}

export async function openSplat(S, bytes, ext) {
  const mesh = new S.SplatMesh({ fileBytes: bytes, fileName: 'splat.' + ext });
  await mesh.initialized;
  return mesh;
}

// Trainers write the camera's frame (OpenCV: y down, z forward), so nearly every splat file stands upside down in a
// y-up viewer; turned over by default, and a file can say otherwise (`flip` false).
export function orient(mesh, flip = true) {
  if (flip) mesh.quaternion.set(1, 0, 0, 0); else mesh.quaternion.identity();
  mesh.updateMatrixWorld(true);
}

// How many, which harmonics, and the bounds of the bulk: floaters (stray faint splats far away, common in captures)
// would otherwise make the camera stand far off — 2–98 % of the visible centres, sampled.
export function splatStats(THREE, mesh) {
  const n = mesh.packedSplats ? mesh.packedSplats.numSplats : mesh.splats ? mesh.splats.getNumSplats() : 0;
  const sh = mesh.splats && mesh.splats.getNumSh ? mesh.splats.getNumSh() : 0;
  const step = Math.max(1, Math.ceil(n / 65536)), xs = [], ys = [], zs = [];
  mesh.forEachSplat((i, c, s, q, opacity) => {
    if (i % step || opacity < 0.1) return;
    xs.push(c.x); ys.push(c.y); zs.push(c.z);
  });
  const box = new THREE.Box3();
  if (xs.length) {
    const cut = (a) => { a.sort((p, q) => p - q); return [a[Math.floor(a.length * 0.02)], a[Math.min(a.length - 1, Math.floor(a.length * 0.98))]]; };
    const [x0, x1] = cut(xs), [y0, y1] = cut(ys), [z0, z1] = cut(zs);
    const pts = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld));
    box.setFromPoints(pts);
  }
  const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return { count: n, sh, size: size.toArray(), center, radius: Math.max(1e-6, size.length() / 2), minY: box.isEmpty() ? 0 : box.min.y };
}

// The camera looks at the bulk from the same angle as model thumbnails.
export function aimAt(THREE, cam, st, margin = 1.1) {
  const fov = (cam.fov * Math.PI) / 180, fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * cam.aspect));
  const dist = (st.radius * margin) / Math.sin(fit / 2);
  cam.position.copy(st.center).addScaledVector(new THREE.Vector3(1, 0.7, 1.25).normalize(), dist);
  cam.near = dist / 200; cam.far = dist * 50;
  cam.lookAt(st.center);
  cam.updateProjectionMatrix();
  return dist;
}

// Off-screen thumbnail. The splats are sorted in Spark's worker, so the first frame can come out empty: render until the
// renderer stops asking for another frame (or ~1.5 s).
export async function renderSplatThumb(buf, ext, W = 640, H = 480) {
  const { THREE, S } = await loadSpark();
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const glc = document.createElement('canvas');
  glc.width = W; glc.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, alpha: true, preserveDrawingBuffer: true });
  let mesh = null, spark = null;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    let dirty = 0;
    spark = new S.SparkRenderer({ renderer, onDirty: () => { dirty++; } });
    scene.add(spark);
    mesh = await openSplat(S, bytes, ext);
    orient(mesh, true);
    scene.add(mesh);
    const st = splatStats(THREE, mesh);
    const cam = new THREE.PerspectiveCamera(35, W / H, 0.01, 1000);
    aimAt(THREE, cam, st);
    renderer.render(scene, cam);
    for (let i = 0, t0 = performance.now(); i < 12 && performance.now() - t0 < 1500; i++) {
      const was = dirty;
      await new Promise((r) => setTimeout(r, 70));
      renderer.render(scene, cam);
      if (dirty === was && i >= 2) break;
    }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(glc, 0, 0);
    return { canvas, colorSrc: canvas, w: W, h: H, splats: st.count };
  } finally {
    if (mesh) mesh.dispose();
    if (spark) spark.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/* ---------- PLY ---------- */

const SH_C0 = 0.28209479177387814, SH_C1 = 0.4886025119029199;

// Standard 3DGS PLY, as the INRIA trainer writes it and Blender 5.3, SuperSplat, Postshot and Spark read it:
// little-endian floats; f_dc — harmonics of degree 0, f_rest — degree 1 channel by channel (R1 R2 R3 G1… B3);
// opacity as a logit, scales as logs, rotation w x y z. sp: { n, pos, nrm?, dc, rest?, opacity, scale, rot }.
export function writeSplatPly(sp, comment = 'Oddments') {
  const { n, pos, dc, rest, opacity, scale, rot } = sp;
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  if (rest) for (let i = 0; i < 9; i++) props.push('f_rest_' + i);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  // the header is ASCII and ends at any byte; the comment is padded with spaces so the floats after it start on a multiple
  // of 4 and can be written through one Float32Array
  const build = (c) => new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment ${c}\nelement vertex ${n}\n` +
    props.map((p) => `property float ${p}\n`).join('') + 'end_header\n');
  let c = comment.replace(/\s+/g, ' '), head = build(c);
  while (head.length % 4) { c += ' '; head = build(c); }
  const k = props.length, out = new Uint8Array(head.length + n * k * 4);
  out.set(head);
  const f = new Float32Array(out.buffer, head.length, n * k);
  for (let i = 0; i < n; i++) {
    let o = i * k;
    f[o++] = pos[i * 3]; f[o++] = pos[i * 3 + 1]; f[o++] = pos[i * 3 + 2];
    if (sp.nrm) { f[o++] = sp.nrm[i * 3]; f[o++] = sp.nrm[i * 3 + 1]; f[o++] = sp.nrm[i * 3 + 2]; } else o += 3;
    f[o++] = dc[i * 3]; f[o++] = dc[i * 3 + 1]; f[o++] = dc[i * 3 + 2];
    if (rest) for (let j = 0; j < 9; j++) f[o++] = rest[i * 9 + j];
    f[o++] = opacity[i];
    f[o++] = scale[i * 3]; f[o++] = scale[i * 3 + 1]; f[o++] = scale[i * 3 + 2];
    f[o++] = rot[i * 4]; f[o++] = rot[i * 4 + 1]; f[o++] = rot[i * 4 + 2]; f[o++] = rot[i * 4 + 3];
  }
  return out;
}

/* ---------- «Сплат из модели» ---------- */

const R2A = 1 / 1.32471795724474602596, R2B = R2A * R2A; // the R2 low-discrepancy sequence: even points, no clumps

// Triangles of every visible mesh in world space, with areas.
function trianglesOf(obj) {
  obj.updateMatrixWorld(true);
  const parts = [];
  let total = 0;
  obj.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
    const g = o.geometry, p = g.attributes.position, idx = g.index, m = o.matrixWorld.elements;
    const nt = Math.floor((idx ? idx.count : p.count) / 3);
    const v = new Float32Array(nt * 9), area = new Float64Array(nt);
    for (let t = 0; t < nt; t++) {
      for (let c = 0; c < 3; c++) {
        const i = idx ? idx.getX(t * 3 + c) : t * 3 + c;
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        v[t * 9 + c * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        v[t * 9 + c * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        v[t * 9 + c * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const o9 = t * 9;
      const ax = v[o9 + 3] - v[o9], ay = v[o9 + 4] - v[o9 + 1], az = v[o9 + 5] - v[o9 + 2];
      const bx = v[o9 + 6] - v[o9], by = v[o9 + 7] - v[o9 + 1], bz = v[o9 + 8] - v[o9 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      area[t] = Math.hypot(cx, cy, cz) / 2;
      total += area[t];
    }
    if (nt) parts.push({ v, area, nt });
  });
  return { parts, total };
}

// Points over the surface, about `want` of them, each triangle getting its share of the area (the remainder carried to the
// next, so small triangles are not lost); inside a triangle — the R2 sequence mapped to barycentric coordinates.
function samplePoints(tris, want) {
  const { parts, total } = tris;
  const cap = Math.ceil(want * 1.02) + 64;
  const pos = new Float32Array(cap * 3), nrm = new Float32Array(cap * 3);
  let n = 0, carry = 0, g = 0;
  for (const { v, area, nt } of parts) {
    for (let t = 0; t < nt && n < cap; t++) {
      const e = (area[t] / total) * want + carry;
      let k = Math.floor(e);
      carry = e - k;
      if (!k) continue;
      const o9 = t * 9;
      const ax = v[o9 + 3] - v[o9], ay = v[o9 + 4] - v[o9 + 1], az = v[o9 + 5] - v[o9 + 2];
      const bx = v[o9 + 6] - v[o9], by = v[o9 + 7] - v[o9 + 1], bz = v[o9 + 8] - v[o9 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (; k > 0 && n < cap; k--, g++) {
        const r1 = (0.5 + g * R2A) % 1, r2 = (0.5 + g * R2B) % 1, s = Math.sqrt(r1);
        const b = s * (1 - r2), c = s * r2;
        pos[n * 3] = v[o9] + ax * b + bx * c;
        pos[n * 3 + 1] = v[o9 + 1] + ay * b + by * c;
        pos[n * 3 + 2] = v[o9 + 2] + az * b + bz * c;
        nrm[n * 3] = nx; nrm[n * 3 + 1] = ny; nrm[n * 3 + 2] = nz;
        n++;
      }
    }
  }
  return { n, pos: pos.subarray(0, n * 3), nrm: nrm.subarray(0, n * 3) };
}

// Directions spread evenly over a sphere (Fibonacci).
function sphereDirs(k) {
  const out = [], ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < k; i++) {
    const y = 1 - ((i + 0.5) / k) * 2, r = Math.sqrt(1 - y * y), a = i * ga;
    out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return out;
}

// distance to the camera, packed into red and green (16 bits) — no tone mapping or colour conversion in this shader
const DIST_VS = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const DIST_FS = 'uniform vec3 camPos; uniform float far; varying vec3 vW; void main() { float d = clamp(distance(vW, camPos) / far, 0.0, 0.99998); float h = floor(d * 255.0) / 255.0; gl_FragColor = vec4(h, fract(d * 255.0), 0.0, 1.0); }';

// Solves a·x = b for a symmetric 4×4 (row-major, 16) with Gaussian elimination; b is 4×3 (one column per channel).
function solve4(a, b) {
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r * 4 + c]) > Math.abs(a[p * 4 + c])) p = r;
    if (Math.abs(a[p * 4 + c]) < 1e-12) return false;
    if (p !== c) {
      for (let k = 0; k < 4; k++) { const t = a[c * 4 + k]; a[c * 4 + k] = a[p * 4 + k]; a[p * 4 + k] = t; }
      for (let k = 0; k < 3; k++) { const t = b[c * 3 + k]; b[c * 3 + k] = b[p * 3 + k]; b[p * 3 + k] = t; }
    }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r * 4 + c] / a[c * 4 + c];
      if (!f) continue;
      for (let k = c; k < 4; k++) a[r * 4 + k] -= f * a[c * 4 + k];
      for (let k = 0; k < 3; k++) b[r * 3 + k] -= f * b[c * 3 + k];
    }
  }
  for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) b[c * 3 + k] /= a[c * 4 + c];
  return true;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// The model as splats. opts: { count, sh (view-dependent part), views, light: { env (a PMREM texture of `renderer`),
// room (true: add the room's key light), rot (degrees), ev (stops) }, renderer (a WebGLRenderer of its own — the bake
// renders into its canvas), name }. onProgress({ phase: 'sample' | 'view' | 'fit', done, total }).
// opts.shots — views rendered elsewhere (Cycles in Blender, «Сплат (Cycles)» of the add-on): [{ pos, target, up,
// pixels: async () => ({ data: RGBA top row first, w, h }) }] with opts.fov; their pixels are the colours, and only the
// distance pass (which surface is nearest) is rendered here, from the same cameras.
// Returns { ply (Uint8Array), n, ms }. Coordinates are written in the trainers' frame (y down, z forward), like the
// files people download, so every viewer (and ours, which turns them over) shows it the right way up.
export async function bakeSplats(T, obj, opts, onProgress = () => {}, isStale = () => false) {
  const { THREE } = T, t0 = performance.now();
  const want = Math.max(1000, Math.min(4e6, opts.count || 500000));
  const tris = trianglesOf(obj);
  if (!tris.total) throw new Error('у модели нет поверхности (только линии или точки)');
  onProgress({ phase: 'sample', done: 0, total: 1 });
  const P = samplePoints(tris, want), n = P.n;
  const spacing = Math.sqrt(tris.total / n);

  // the bake renders: square views from all around, sharp enough for the point spacing
  const R = Math.round(Math.max(512, Math.min(1536, Math.sqrt(n) * 1.2)));
  const renderer = opts.renderer;
  renderer.setPixelRatio(1);
  renderer.setSize(R, R, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = Math.pow(2, (opts.light && opts.light.ev) || 0);
  const gl = renderer.getContext();
  const scene = new THREE.Scene();
  scene.add(obj);
  const L = opts.light || {};
  const rot = ((L.rot || 0) * Math.PI) / 180;
  if (L.env) { scene.environment = L.env; scene.environmentRotation.set(0, rot, 0); }
  let key = null;
  if (L.room !== false) {
    key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3 * Math.cos(rot) + 4 * Math.sin(rot), 5, -3 * Math.sin(rot) + 4 * Math.cos(rot));
    scene.add(key);
  }
  const box = new THREE.Box3().setFromObject(obj), sphere = box.getBoundingSphere(new THREE.Sphere());
  const shots = opts.shots || null, fov = shots ? opts.fov || 35 : 35;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 1000);
  const dist = (sphere.radius * 1.08) / Math.sin((fov * Math.PI) / 360);
  const distMat = new THREE.ShaderMaterial({ uniforms: { camPos: { value: new THREE.Vector3() }, far: { value: 1 } }, vertexShader: DIST_VS, fragmentShader: DIST_FS, side: THREE.DoubleSide });
  let col = new Uint8Array(R * R * 4), dep = new Uint8Array(R * R * 4), S = R;
  const sh = opts.sh !== false, K = 4;
  // per point: weighted normal equations of [C0, −C1·y, C1·z, −C1·x] (10 numbers) and the right side (4 × 3)
  const ata = sh ? new Float32Array(n * 10) : null, atb = new Float32Array(n * (sh ? 12 : 3)), wsum = new Float32Array(n);
  const views = shots || sphereDirs(opts.views || 64), m = new THREE.Matrix4(), target = new THREE.Vector3();
  const { pos, nrm } = P;
  for (let vi = 0; vi < views.length; vi++) {
    if (isStale()) throw new Error('stale');
    // flipY: pixels from a file run top row first, readPixels bottom row first
    let flipY = false;
    if (shots) {
      const v = views[vi], img = await v.pixels();
      if (img.w !== S) { S = img.w; renderer.setSize(S, S, false); dep = new Uint8Array(S * S * 4); }
      col = img.data; flipY = true;
      cam.position.fromArray(v.pos); cam.up.fromArray(v.up); target.fromArray(v.target);
    } else {
      const d = views[vi];
      cam.position.set(sphere.center.x + d[0] * dist, sphere.center.y + d[1] * dist, sphere.center.z + d[2] * dist);
      cam.up.set(Math.abs(d[1]) > 0.99 ? 1 : 0, Math.abs(d[1]) > 0.99 ? 0 : 1, 0);
      target.copy(sphere.center);
    }
    cam.lookAt(target);
    const cd = cam.position.distanceTo(sphere.center);
    cam.near = Math.max(1e-4, cd - sphere.radius * 1.3); cam.far = cd + sphere.radius * 1.3;
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    const far = cam.far, R2 = S;
    distMat.uniforms.far.value = far;
    if (!shots) {
      renderer.setClearColor(0x000000, 0);
      scene.overrideMaterial = null;
      renderer.render(scene, cam);
      gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, col);
    }
    // a point is seen when it lies on the nearest surface of that pixel: within the spacing, plus the depth a pixel spans
    // on a slanted face (more at grazing angles)
    const pw = (2 * Math.tan((fov * Math.PI) / 360)) / R2;
    distMat.uniforms.camPos.value.copy(cam.position);
    scene.overrideMaterial = distMat;
    if (key) key.visible = false;
    renderer.setClearColor(0xffffff, 1);
    renderer.render(scene, cam);
    gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, dep);
    scene.overrideMaterial = null;
    if (key) key.visible = true;
    m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const e = m.elements, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let vx = x - cx, vy = y - cy, vz = z - cz;
      const dd = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx /= dd; vy /= dd; vz /= dd;
      const cos = -(vx * nrm[i * 3] + vy * nrm[i * 3 + 1] + vz * nrm[i * 3 + 2]);
      // a disc is seen from both sides: a face turned away still counts (thin parts, planes), with its own |cos|
      const ac = Math.abs(cos);
      if (ac < 0.08) continue;
      const w4 = e[3] * x + e[7] * y + e[11] * z + e[15];
      const px = Math.floor(((e[0] * x + e[4] * y + e[8] * z + e[12]) / w4 * 0.5 + 0.5) * R2);
      const py = Math.floor(((e[1] * x + e[5] * y + e[9] * z + e[13]) / w4 * 0.5 + 0.5) * R2);
      if (px < 0 || py < 0 || px >= R2 || py >= R2) continue;
      const o = (py * R2 + px) * 4, oc = flipY ? ((R2 - 1 - py) * R2 + px) * 4 : o;
      const D = (dep[o] / 255 + dep[o + 1] / 65025) * far;
      if (dd > D + spacing * 1.2 + dd * pw * (1 + 1 / ac) || col[oc + 3] < 128) continue;
      const w = ac * ac;
      const r = col[oc] / 255, g = col[oc + 1] / 255, b = col[oc + 2] / 255;
      wsum[i] += w;
      if (!sh) { atb[i * 3] += w * r; atb[i * 3 + 1] += w * g; atb[i * 3 + 2] += w * b; continue; }
      const a0 = SH_C0, a1 = -SH_C1 * vy, a2 = SH_C1 * vz, a3 = -SH_C1 * vx, q = i * 10;
      ata[q] += w * a0 * a0; ata[q + 1] += w * a0 * a1; ata[q + 2] += w * a0 * a2; ata[q + 3] += w * a0 * a3;
      ata[q + 4] += w * a1 * a1; ata[q + 5] += w * a1 * a2; ata[q + 6] += w * a1 * a3;
      ata[q + 7] += w * a2 * a2; ata[q + 8] += w * a2 * a3; ata[q + 9] += w * a3 * a3;
      const rr = r - 0.5, gg = g - 0.5, bb2 = b - 0.5, u = i * 12;
      atb[u] += w * a0 * rr; atb[u + 1] += w * a0 * gg; atb[u + 2] += w * a0 * bb2;
      atb[u + 3] += w * a1 * rr; atb[u + 4] += w * a1 * gg; atb[u + 5] += w * a1 * bb2;
      atb[u + 6] += w * a2 * rr; atb[u + 7] += w * a2 * gg; atb[u + 8] += w * a2 * bb2;
      atb[u + 9] += w * a3 * rr; atb[u + 10] += w * a3 * gg; atb[u + 11] += w * a3 * bb2;
    }
    onProgress({ phase: 'view', done: vi + 1, total: views.length });
    await tick();
  }
  scene.remove(obj);
  if (key) scene.remove(key);
  distMat.dispose();

  // colours: the fitted harmonics, or the weighted mean; a point no view saw (deep in a crevice) takes the last seen
  // neighbour's colour, darker — like ambient occlusion
  onProgress({ phase: 'fit', done: 0, total: 1 });
  const dc = new Float32Array(n * 3), rest = sh ? new Float32Array(n * 9) : null;
  const A = new Float64Array(16), B = new Float64Array(12);
  let last = [0.5, 0.5, 0.5];
  for (let i = 0; i < n; i++) {
    const w = wsum[i];
    if (!w) {
      for (let c = 0; c < 3; c++) dc[i * 3 + c] = (last[c] * 0.6 - 0.5) / SH_C0;
      continue;
    }
    if (sh) {
      const q = i * 10, u = i * 12;
      A[0] = ata[q]; A[1] = A[4] = ata[q + 1]; A[2] = A[8] = ata[q + 2]; A[3] = A[12] = ata[q + 3];
      A[5] = ata[q + 4]; A[6] = A[9] = ata[q + 5]; A[7] = A[13] = ata[q + 6];
      A[10] = ata[q + 7]; A[11] = A[14] = ata[q + 8]; A[15] = ata[q + 9];
      // a ridge on the view-dependent part: few or one-sided views must not invent strong highlights
      const lam = 0.35 * w * SH_C1 * SH_C1;
      A[5] += lam; A[10] += lam; A[15] += lam;
      for (let k = 0; k < 12; k++) B[k] = atb[u + k];
      if (solve4(A, B)) {
        for (let c = 0; c < 3; c++) {
          dc[i * 3 + c] = B[c];
          // f_rest channel by channel: R1 R2 R3 G1 G2 G3 B1 B2 B3; clamped so a grazing view cannot blow up
          for (let j = 0; j < 3; j++) rest[i * 9 + c * 3 + j] = Math.max(-1.5, Math.min(1.5, B[(j + 1) * 3 + c]));
        }
        last = [0, 1, 2].map((c) => 0.5 + SH_C0 * dc[i * 3 + c]);
        continue;
      }
      // the fit failed (one view only): the plain weighted mean — Σw·C0·(c−½) / Σw·C0²
      for (let c = 0; c < 3; c++) dc[i * 3 + c] = atb[u + c] / ata[q];
      last = [0, 1, 2].map((c) => 0.5 + SH_C0 * dc[i * 3 + c]);
      continue;
    }
    for (let c = 0; c < 3; c++) { const v = atb[i * 3 + c] / w; last[c] = v; dc[i * 3 + c] = (v - 0.5) / SH_C0; }
  }

  // flat discs along the surface: σ along it ≈ 0.85 of the spacing, thin across it. Points are even inside a triangle but
  // not across triangle edges, so at 0.6 the background showed through as dark freckles
  const st = Math.log(spacing * (opts.sigma || 0.85)), sn = Math.log(spacing * 0.06);
  const scale = new Float32Array(n * 3), rot4 = new Float32Array(n * 4), opacity = new Float32Array(n).fill(Math.log(0.96 / 0.04));
  const out = new Float32Array(n * 3), onrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    scale[i * 3] = st; scale[i * 3 + 1] = st; scale[i * 3 + 2] = sn;
    // the turn that takes +z onto the normal, then the whole thing turned 180° about x into the trainers' frame
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    let qw, qx, qy, qz;
    if (nz < -0.999999) { qw = 0; qx = 1; qy = 0; qz = 0; } else { qw = 1 + nz; qx = -ny; qy = nx; qz = 0; const l = Math.hypot(qw, qx, qy); qw /= l; qx /= l; qy /= l; }
    // (0,1,0,0) ⊗ q  — 180° about x on the left
    rot4[i * 4] = -qx; rot4[i * 4 + 1] = qw; rot4[i * 4 + 2] = -qz; rot4[i * 4 + 3] = qy;
    out[i * 3] = pos[i * 3]; out[i * 3 + 1] = -pos[i * 3 + 1]; out[i * 3 + 2] = -pos[i * 3 + 2];
    onrm[i * 3] = nx; onrm[i * 3 + 1] = -ny; onrm[i * 3 + 2] = -nz;
    // the harmonics turn with the frame: y and z change sign, so the y and z coefficients do too
    if (rest) for (let c = 0; c < 3; c++) { rest[i * 9 + c * 3] = -rest[i * 9 + c * 3]; rest[i * 9 + c * 3 + 1] = -rest[i * 9 + c * 3 + 1]; }
  }
  const ply = writeSplatPly({ n, pos: out, nrm: onrm, dc, rest, opacity, scale, rot: rot4 }, `Oddments: splats from ${(opts.name || 'model').slice(0, 80)}`);
  return { ply, n, ms: performance.now() - t0, res: R };
}

// A splat in a format Blender does not read (.splat, .ksplat, .sog) as a standard PLY: centre, size, turn, opacity and the
// base colour of each splat (the view-dependent part does not come through Spark's reader — PLY and SPZ go as they are).
export async function splatToPly(bytes, ext, name = '') {
  const { S } = await loadSpark();
  const mesh = await openSplat(S, bytes, ext);
  try {
    const n = mesh.packedSplats ? mesh.packedSplats.numSplats : mesh.splats.getNumSplats();
    const pos = new Float32Array(n * 3), dc = new Float32Array(n * 3), opacity = new Float32Array(n), scale = new Float32Array(n * 3), rot = new Float32Array(n * 4);
    const lg = (v) => Math.log(Math.max(v, 1e-8));
    mesh.forEachSplat((i, c, s, q, o, col) => {
      pos[i * 3] = c.x; pos[i * 3 + 1] = c.y; pos[i * 3 + 2] = c.z;
      dc[i * 3] = (col.r - 0.5) / SH_C0; dc[i * 3 + 1] = (col.g - 0.5) / SH_C0; dc[i * 3 + 2] = (col.b - 0.5) / SH_C0;
      const a = Math.min(0.9999, Math.max(1e-4, o));
      opacity[i] = Math.log(a / (1 - a));
      scale[i * 3] = lg(s.x); scale[i * 3 + 1] = lg(s.y); scale[i * 3 + 2] = lg(s.z);
      rot[i * 4] = q.w; rot[i * 4 + 1] = q.x; rot[i * 4 + 2] = q.y; rot[i * 4 + 3] = q.z;
    });
    return writeSplatPly({ n, pos, dc, rest: null, opacity, scale, rot }, `Oddments: ${name || 'splat'}`);
  } finally { mesh.dispose(); }
}

// SPZ (Niantic's compressed format, ~10× smaller than PLY) from any splat file Spark reads.
export async function toSpz(bytes, ext = 'ply') {
  const { S } = await loadSpark();
  const r = await S.transcodeSpz({ inputs: [{ fileBytes: bytes, pathOrUrl: 'splat.' + ext }], maxSh: 3 });
  return r.fileBytes;
}
