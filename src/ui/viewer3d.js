// Interactive 3D viewer for the full-screen preview, in the spirit of Sketchfab's model inspector:
// render modes (final, clay, matcaps, normals, UV checker), wireframe overlay, floor grid,
// backdrop, model info (vertices, triangles, quads, materials…) and animation playback.
// Orbit: drag · zoom: wheel · pan: right drag. Returns a cleanup function.
import { loadThree, parseModel, frameObject, disposeObject, modelInfo, objEdges } from '../lib/model3d.js';
import { ic } from './icons.js';
import { esc } from '../util.js';
import { toast } from './dialogs.js';
import { readPref, writePref } from '../lib/prefs.js';

const BG = { dark: 0x1c1c1f, light: 0xe6e6e8 };
const prefs = readPref('perch.viewer3d', {});
const savePrefs = () => writePref('perch.viewer3d', prefs);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Render modes. Matcaps are painted procedurally (a lit sphere), so no image files ship with the app.
// `hint` — what the mode shows, for someone who has not met the word (newbie pass 25.10)
const MODES = [
  { id: 'final', label: 'Рендер', key: '1', hint: 'модель со своими материалами и текстурами' },
  { id: 'clay', label: 'Глина', key: '2', hint: 'одним серым цветом — видна только форма' },
  { id: 'matcap', label: 'Мэткап', key: '3', hint: 'готовый «материал-шарик»: форма читается под любым углом' },
  { id: 'normals', label: 'Нормали', key: '4', hint: 'цвет по направлению граней — видны вывернутые и кривые места' },
  { id: 'uv', label: 'UV-шахматка', key: '5', hint: 'шахматная текстура — видно, как легла развёртка: растяжения и швы' },
];
const MATCAPS = [
  { id: 'studio', label: 'Студия', type: 'lit', base: [0.82, 0.82, 0.85], shade: [0.16, 0.16, 0.19], spec: 0.55, shin: 40, rim: 0.25 },
  { id: 'clay', label: 'Пластилин', type: 'lit', base: [0.8, 0.52, 0.38], shade: [0.22, 0.11, 0.07], spec: 0.12, shin: 12, rim: 0.18 },
  { id: 'wax', label: 'Красный воск', type: 'lit', base: [0.78, 0.18, 0.13], shade: [0.16, 0.03, 0.02], spec: 0.6, shin: 60, rim: 0.3 },
  { id: 'jade', label: 'Нефрит', type: 'lit', base: [0.36, 0.68, 0.54], shade: [0.04, 0.17, 0.12], spec: 0.7, shin: 80, rim: 0.4 },
  { id: 'chrome', label: 'Хром', type: 'chrome' },
  { id: 'toon', label: 'Мультяшный', type: 'toon', base: [0.92, 0.92, 0.94], mid: [0.62, 0.63, 0.68], shade: [0.3, 0.31, 0.36] },
];
// css preview of each matcap for the picker buttons
const CAP_CSS = {
  studio: 'radial-gradient(circle at 36% 30%, #fff, #d1d1d9 30%, #29292f)',
  clay: 'radial-gradient(circle at 36% 30%, #f3c8ad, #cc8561 35%, #38190f)',
  wax: 'radial-gradient(circle at 36% 30%, #ffb3a6, #c72e21 35%, #290504)',
  jade: 'radial-gradient(circle at 36% 30%, #d9fff0, #5cae8a 35%, #0a2b1f)',
  chrome: 'linear-gradient(#f4f8fc, #9aa8b6 46%, #15181d 50%, #7a6a5a 56%, #2a241f)',
  toon: 'radial-gradient(circle at 36% 30%, #fff 18%, #ebebee 19% 48%, #9ea0a8 49% 70%, #4d4f5a 71%)',
};

// Lighting: the built-in room (with a key light, as in the thumbnails) and six HDRIs from Poly Haven (CC0, 1k .hdr).
// The HDRIs are not in the installer any more (9 MB): each is downloaded the first time it is picked, checked by its
// size, kept in $APPLOCALDATA/hdri and used from there. Each is prefiltered once per session and shared by every preview.
const HDR_SIZE = { studio_small_08: 1508872, brown_photostudio_02: 1648130, kloofendal_48d_partly_cloudy_puresky: 1435119, venice_sunset: 1440400, empty_warehouse_01: 1672140, moonless_golf: 1672754 };
const hdrRemote = (id) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`;
async function hdrUrl(id) {
  if (!window.__TAURI_INTERNALS__) return hdrRemote(id); // the browser build reads it straight from Poly Haven
  const [{ appLocalDataDir, join }, fs, { convertFileSrc }] = await Promise.all([import('@tauri-apps/api/path'), import('@tauri-apps/plugin-fs'), import('@tauri-apps/api/core')]);
  const dir = await join(await appLocalDataDir(), 'hdri'), file = await join(dir, id + '.hdr');
  let ok = false;
  try { ok = (await fs.stat(file)).size === HDR_SIZE[id]; } catch (e) { ok = false; }
  if (!ok) {
    toast('Скачиваю освещение — один раз…', 2500);
    await fs.mkdir(dir, { recursive: true });
    const { downloadFile } = await import('../lib/download.js');
    await downloadFile(hdrRemote(id), file, { size: HDR_SIZE[id], what: 'файл освещения' });
  }
  return convertFileSrc(file);
}
const LIGHTS = [
  { id: 'room', label: 'Комната', css: 'radial-gradient(circle at 50% 28%, #fff, #b9b9c0 40%, #3a3a41)' },
  { id: 'studio_small_08', label: 'Студия', css: 'radial-gradient(ellipse at 30% 35%, #fff 8%, #5d5d63 30%, #1d1d20 70%)' },
  { id: 'brown_photostudio_02', label: 'Тёплая студия', css: 'radial-gradient(ellipse at 60% 35%, #fff2dc 6%, #a77a52 35%, #3a2416 75%)' },
  { id: 'kloofendal_48d_partly_cloudy_puresky', label: 'Небо', css: 'linear-gradient(#5d97d6, #c7dcef 48%, #8c8f84 52%, #4c4a40)' },
  { id: 'venice_sunset', label: 'Закат', css: 'linear-gradient(#36456b, #e9a26a 46%, #ffd9a0 50%, #4b3a33 54%, #2b2420)' },
  { id: 'empty_warehouse_01', label: 'Склад', css: 'linear-gradient(#6f6a62, #d8d2c6 40%, #8e877c 55%, #3b3731)' },
  { id: 'moonless_golf', label: 'Ночь', css: 'linear-gradient(#05070d, #1b2233 46%, #39415a 50%, #0b0d10)' },
];
function getEnv(T, renderer, id) {
  const envs = shared.envs || (shared.envs = {});
  if (!envs[id]) {
    envs[id] = (async () => {
      const { THREE } = T, pm = new THREE.PMREMGenerator(renderer);
      try {
        if (id === 'room') return pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
        const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
        const hdr = await new HDRLoader().loadAsync(await hdrUrl(id));
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        const t = pm.fromEquirectangular(hdr).texture;
        hdr.dispose();
        return t;
      } finally { pm.dispose(); }
    })();
    envs[id].catch(() => { delete envs[id]; });
  }
  return envs[id];
}
const evText = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',');

// Matcaps are shaded per pixel on a sphere (normal from x/y), so they look like real ones:
// 'lit' — diffuse + Blinn highlight + fresnel rim; 'chrome' — reflection of a sky/horizon/ground studio;
// 'toon' — three hard bands, a hard highlight and a dark outline.
function paintMatcap(THREE, m) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
  const L = norm([-0.45, 0.6, 0.66]), H = norm([L[0], L[1], L[2] + 1]);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    let nx = ((px + 0.5) / S) * 2 - 1, ny = -(((py + 0.5) / S) * 2 - 1);
    let r2 = nx * nx + ny * ny;
    if (r2 > 1) { const k = 1 / Math.sqrt(r2); nx *= k; ny *= k; r2 = 1; } // edge colour continues outside
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    const ndl = nx * L[0] + ny * L[1] + nz * L[2], ndh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
    const fres = Math.pow(1 - nz, 3);
    let col;
    if (m.type === 'chrome') {
      const ry = 2 * nz * ny; // reflected ray, y component (view along +z)
      const sky = [0.94, 0.96, 0.99], hor = [0.55, 0.6, 0.66], dark = [0.06, 0.07, 0.08], ground = [0.42, 0.36, 0.3], deep = [0.12, 0.1, 0.09];
      if (ry > 0.06) col = mix(hor, sky, Math.min(1, (ry - 0.06) / 0.7));
      else if (ry > -0.02) col = mix(dark, hor, (ry + 0.02) / 0.08);
      else col = mix(ground, deep, Math.min(1, (-ry - 0.02) / 0.8));
      col = col.map((v) => v + Math.pow(ndh, 220) * 1.2 + fres * 0.15);
    } else if (m.type === 'toon') {
      col = ndl > 0.55 ? m.base : ndl > 0.1 ? m.mid : m.shade;
      if (Math.pow(ndh, 60) > 0.6) col = [1, 1, 1];
      if (nz < 0.18) col = [0.09, 0.09, 0.11];
    } else {
      const dif = Math.max(0, ndl) * 0.85 + 0.15;
      col = mix(m.shade, m.base, dif).map((v) => v + Math.pow(ndh, m.shin) * m.spec + fres * m.rim);
    }
    const i = (py * S + px) * 4;
    d[i] = Math.min(255, col[0] * 255); d[i + 1] = Math.min(255, col[1] * 255); d[i + 2] = Math.min(255, col[2] * 255); d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function norm(v) { const l = Math.hypot(...v); return v.map((a) => a / l); }

function paintChecker(THREE) {
  const S = 512, N = 16, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d'), q = S / N;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    x.fillStyle = (i + j) % 2 ? '#2b2b31' : '#e9e9ee'; x.fillRect(i * q, j * q, q, q);
  }
  x.fillStyle = '#ff3b30'; x.font = `700 ${q * 0.5}px Geist Mono Variable, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < N; i += 4) for (let j = 0; j < N; j += 4) x.fillText(String.fromCharCode(65 + i / 4) + (j / 4 + 1), i * q + q / 2, j * q + q / 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// One canvas and WebGL context for the whole app, reused by every preview. Creating and
// dropping a context on each open made the browser flash the stage white on quick toggling.
let shared = null;
function sharedRenderer(THREE) {
  if (!shared) {
    const canvas = document.createElement('canvas');
    canvas.className = 'm3d-c';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Модель: тяните, чтобы вращать, колесо — масштаб');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    shared = { canvas, renderer, textures: null };
  }
  return shared;
}

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'));
const fmtLen = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2)).replace('.', ',');

// opts (from the preview): { lib: { libraryMaterials, readItem, saveFromViewer }, itemId, name } — the library side of
// materials: a model can try on a library material and be saved with it; a material can be edited and saved as new.
export async function mountViewer(holder, buf, ext, isStale, opts = {}) {
  const T = await loadThree();
  if (isStale()) return () => {};
  const { THREE } = T;
  let obj = await parseModel(T, ext, buf);
  if (isStale()) { disposeObject(obj); return () => {}; }
  let info = modelInfo(T, obj, ext, buf);

  holder.innerHTML = '';
  holder.classList.add('m3d');
  const { canvas, renderer } = sharedRenderer(THREE);
  if (!shared.textures) shared.textures = { checker: paintChecker(THREE), matcaps: {} };
  const tex = shared.textures;
  // hidden until this model's first frame: the canvas still holds the previous model's picture
  canvas.style.opacity = '0';
  canvas.style.visibility = '';
  holder.appendChild(canvas);

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.2); // only for the room: an HDRI brings its own sun
  scene.add(key);
  scene.add(obj);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new T.OrbitControls(cam, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // original materials, so render modes can be swapped and restored; `orig` is what the file itself had
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh) meshes.push({ o, mat: o.material, orig: o.material }); });
  const isMat = ext === 'perchmat';
  const M = isMat || opts.lib ? await import('../lib/material.js') : null;
  const matSel = isMat ? obj.userData.material : null; // { data: { json, files }, mat, mesh }
  const infoKey = isMat ? 'matInfo' : 'info'; // the material editor is open by default, apart from the model stats
  let matDirty = false;
  const mapUrls = [];
  const overrides = new Set();
  const mk = (m) => { overrides.add(m); return m; };
  // a material is looked at as itself, and so is a textured model: the remembered «Глина» or «Мэткап» hid the
  // textures of every model that came after (it looked as if the textures had not arrived from Blender)
  const textured = meshes.some(({ orig }) => (Array.isArray(orig) ? orig : [orig]).some((m) => m && (m.map || m.normalMap || m.emissiveMap)));
  let mode = isMat || textured ? 'final' : MODES.some((m) => m.id === prefs.mode) ? prefs.mode : 'final';
  let matcap = MATCAPS.some((m) => m.id === prefs.matcap) ? prefs.matcap : 'studio';
  const flatShade = (m) => { const side = Array.isArray(m) ? m[0].side : m && m.side; return side; };
  const applyMode = () => {
    overrides.forEach((m) => m.dispose()); overrides.clear();
    let mat = null;
    if (mode === 'clay') mat = mk(new THREE.MeshStandardMaterial({ color: 0xbdbdc2, roughness: 0.85, metalness: 0 }));
    else if (mode === 'matcap') {
      if (!tex.matcaps[matcap]) tex.matcaps[matcap] = paintMatcap(THREE, MATCAPS.find((m) => m.id === matcap));
      mat = mk(new THREE.MeshMatcapMaterial({ matcap: tex.matcaps[matcap] }));
    } else if (mode === 'normals') mat = mk(new THREE.MeshNormalMaterial());
    else if (mode === 'uv') mat = mk(new THREE.MeshBasicMaterial({ map: tex.checker }));
    meshes.forEach(({ o, mat: orig }) => {
      if (!mat) { o.material = orig; return; }
      const m = mat.clone(); overrides.add(m);
      m.side = flatShade(orig) ?? THREE.FrontSide;
      if (mode !== 'final' && o.geometry.attributes.color && mode === 'clay') m.vertexColors = false;
      o.material = m;
    });
    if (mat) mat.dispose();
    overrides.delete(mat);
  };

  // wireframe overlay: triangle edges drawn on top of whatever mode is active
  let wire = null;
  const buildWire = () => {
    if (wire) { obj.remove(wire); wire.traverse((w) => { if (w.geometry) w.geometry.dispose(); }); wire.userData.mat.dispose(); wire = null; }
    if (!prefs.wire) return;
    const light = prefs.bg === 'light';
    const mat = new THREE.LineBasicMaterial({ color: light ? 0x1c1c1f : 0xf5f5f7, transparent: true, opacity: light ? 0.45 : 0.35, depthTest: true });
    wire = new THREE.Group();
    wire.userData.mat = mat;
    obj.updateMatrixWorld(true);
    if (ext === 'obj') { // real polygon edges: quads stay quads
      wire.add(new THREE.LineSegments(objEdges(THREE, new TextDecoder().decode(buf)), mat));
      obj.add(wire);
      return;
    }
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    meshes.forEach(({ o }) => {
      if (o.geometry.attributes.position.count > 1.5e6) return; // too heavy to outline
      const seg = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), mat);
      seg.matrixAutoUpdate = false;
      seg.matrix.multiplyMatrices(inv, o.matrixWorld);
      seg.renderOrder = 1;
      // keep skinned/animated meshes in sync by parenting the outline to the mesh itself
      if (o.isSkinnedMesh || info.animations.length) { seg.matrix.identity(); o.add(seg); } else wire.add(seg);
    });
    obj.add(wire);
  };

  let frame = null, grid = null;
  const size = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; // css box, not the padded holder
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  const reset = () => {
    frame = frameObject(THREE, obj, cam, 1.3);
    controls.target.copy(frame.center);
    controls.minDistance = frame.dist / 50;
    controls.maxDistance = frame.dist * 20;
    controls.update();
  };
  const buildGrid = () => {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    if (!prefs.grid) return;
    const light = prefs.bg === 'light';
    const s = frame.radius * 6;
    grid = new THREE.GridHelper(s, 24, light ? 0x9a9aa0 : 0x55555c, light ? 0xc8c8cc : 0x34343a);
    grid.position.set(frame.center.x, frame.minY, frame.center.z);
    scene.add(grid);
  };
  const applyBg = () => {
    const c = prefs.bg === 'light' ? BG.light : BG.dark;
    // «Окружение как фон»: the environment itself, softly blurred so the model stays the subject
    if (prefs.hdrBg && envTex) { scene.background = envTex; scene.backgroundBlurriness = 0.35; }
    else scene.background = new THREE.Color(c);
    renderer.setClearColor(c, 1);
    canvas.style.background = hex(c);
    holder.classList.toggle('light', prefs.bg === 'light' && !prefs.hdrBg);
  };

  // lighting: which environment, its turn around the model, exposure in stops
  let light = LIGHTS.some((l) => l.id === prefs.light) ? prefs.light : 'room', envTex = null, lightSeq = 0;
  const applyLightParams = () => {
    const r = ((prefs.lightRot || 0) * Math.PI) / 180;
    scene.environmentRotation.set(0, r, 0);
    scene.backgroundRotation.set(0, r, 0);
    key.position.set(3 * Math.cos(r) + 4 * Math.sin(r), 5, -3 * Math.sin(r) + 4 * Math.cos(r));
    renderer.toneMappingExposure = Math.pow(2, prefs.ev || 0); // shared renderer: every viewer sets its own
  };
  const applyLight = async () => {
    const id = light, my = ++lightSeq;
    let t;
    try { t = await getEnv(T, renderer, id); } catch (e) { console.warn('hdri', id, e); toast('Освещение не скачалось (нет сети?) — пока «Комната»', 3500); t = await getEnv(T, renderer, 'room'); }
    if (my !== lightSeq || isStale()) return;
    envTex = t;
    scene.environment = t;
    key.visible = id === 'room';
    applyLightParams(); applyBg();
  };

  // animations
  const mixer = info.animations.length ? new THREE.AnimationMixer(obj) : null;
  let action = null, playing = false;
  const clock = new THREE.Clock();
  const play = (i) => {
    if (!mixer) return;
    if (action) action.stop();
    action = mixer.clipAction(obj.animations[i]);
    action.play(); playing = true;
  };

  await applyLight();
  if (isStale()) { disposeObject(obj); return () => {}; }
  size(); reset(); applyBg(); applyMode(); buildGrid(); buildWire();
  // a holder that rebuilds its model often (the SVG → 3D sliders) keeps the angle the user turned it to
  if (holder.dataset.keepView && holder.__view) { cam.position.copy(holder.__view.p); controls.target.copy(holder.__view.t); controls.update(); }
  if (mixer) play(0);

  // ——— UI: tool bar at the bottom, info panel on the right ———
  const bar = document.createElement('div');
  bar.className = 'm3d-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Вид модели');
  const btn = (act, inner, label, pressed, cls = '') =>
    `<button type="button" class="${cls}" data-m3d="${act}" title="${label}" aria-label="${label}"${pressed == null ? '' : ` aria-pressed="${pressed}"`}>${inner}</button>`;
  let lpOpen = false, mpOpen = false;
  const drawBar = () => {
    bar.innerHTML =
      `<div class="m3d-seg" role="radiogroup" aria-label="Режим отображения">${MODES.map((m) =>
        `<button type="button" role="radio" aria-checked="${mode === m.id}" class="${mode === m.id ? 'on' : ''}" data-mode="${m.id}" title="${m.label} (${m.key}) — ${m.hint}">${m.label}</button>`).join('')}</div>` +
      (mode === 'matcap' ? `<div class="m3d-caps" role="radiogroup" aria-label="Мэткап">${MATCAPS.map((m) =>
        `<button type="button" role="radio" aria-checked="${matcap === m.id}" class="${matcap === m.id ? 'on' : ''}" data-cap="${m.id}" title="${m.label}" aria-label="${m.label}" style="background:${CAP_CSS[m.id]}"></button>`).join('')}</div>` : '') +
      '<span class="m3d-sep"></span>' +
      btn('wire', ic('wire'), 'Каркас (W)', !!prefs.wire) +
      btn('grid', ic('gridfloor'), 'Пол-сетка (G)', !!prefs.grid) +
      (!isMat && opts.lib ? btn('mat', ic('sphere'), 'Материал из библиотеки (M)', mpOpen) : '') +
      btn('light', ic('bulb'), 'Освещение (L)', lpOpen) +
      btn('bg', ic(prefs.bg === 'light' ? 'moon' : 'sun'), prefs.bg === 'light' ? 'Тёмный фон' : 'Светлый фон') +
      btn('reset', ic('restore'), 'Сбросить вид (F)') +
      btn('info', ic(isMat ? 'sphere' : 'info'), isMat ? 'Настройки материала (I)' : 'Информация о модели (I)', prefs[infoKey] !== false);
  };
  drawBar();
  holder.appendChild(bar);

  let checks = null, uvDirty = false, uvBusy = ''; // the model check and «Развернуть UV» (below the material panel)
  const panel = document.createElement('aside');
  panel.className = 'm3d-info';
  panel.setAttribute('aria-label', 'Информация о модели');
  const row = (k, v, title) => `<dt${title ? ` title="${esc(title)}"` : ''}>${k}</dt><dd>${v}</dd>`;
  const fillPanel = () => {
    if (isMat) { matPanel(); return; }
    const sz = info.size ? info.size.map(fmtLen).join(' × ') : '—';
    const topo = info.polys
    ? row('Полигоны', fmt(info.polys)) + row('Квады', fmt(info.quads)) + row('Треугольные грани', fmt(info.triFaces)) + (info.ngons ? row('N-гоны', fmt(info.ngons)) : '')
    : row('Квады', '—', 'Формат хранит модель уже разбитой на треугольники, исходных квадов в файле нет');
    panel.innerHTML = `<b class="m3d-h">Модель</b>
    <dl>${row('Вершины', fmt(info.polys ? info.verts : info.verts))}${row('Треугольники', fmt(info.tris))}${topo}
    ${row('Меши', fmt(info.meshes))}${row('Материалы', fmt(info.materials))}${row('Текстуры', fmt(info.textures))}
    ${row('Габариты', sz, 'X × Y × Z в единицах файла')}${info.uvless ? row('Без UV', fmt(info.uvless) + ' меш.') : ''}</dl>` + checkHtml() +
    (info.animations.length ? `<b class="m3d-h">Анимации</b><div class="m3d-anims">${info.animations.map((a, i) =>
      `<button type="button" data-anim="${i}" class="${i === 0 ? 'on' : ''}">${esc(a.name)}<span>${a.duration.toFixed(1).replace('.', ',')} с</span></button>`).join('')}
      <button type="button" data-anim="pause" class="pz">${ic('pause')}<span>Пауза</span></button></div>` : '');
  };
  fillPanel();
  panel.hidden = prefs[infoKey] === false;
  holder.appendChild(panel);
  if (!isMat) setTimeout(() => { if (alive) runCheck(); }, 60); // after the first frame: the walk over the mesh takes a moment

  /* ---------- «Проверка» and «Развернуть UV» (../lib/modelcheck.js, ../lib/uvatlas.js, Blender) ---------- */
  function checkHtml() {
    if (!checks) return '<b class="m3d-h">Проверка</b><p class="m3d-note">Проверяю…</p>';
    const bad = checks.filter((c) => c.level !== 'ok').length;
    return `<b class="m3d-h">Проверка${bad ? ` · ${bad}` : ''}</b><ul class="m3d-chk">${checks.map((c) => `<li class="${c.level}"><span>${esc(c.text)}</span>${c.how ? `<small>${esc(c.how)}</small>` : ''}</li>`).join('')}</ul>
      <div class="m3d-uvrow"><button type="button" class="m3d-save" data-uv="go"${uvBusy ? ' disabled' : ''} title="Швы по форме модели, развёртка с малым растяжением, острова упакованы. Через ваш Blender, если он есть; иначе прямо здесь (xatlas)">${uvBusy || 'Развернуть UV'}</button>
      ${uvDirty ? '<button type="button" class="m3d-save" data-uv="save">Сохранить с новой UV</button>' : ''}</div>`;
  }
  const runCheck = async () => {
    try { checks = (await import('../lib/modelcheck.js')).checkModel(THREE, obj, info); } catch (e) { console.warn('check', e); checks = []; }
    // the team's own limits (brand.js): polygons, size, UV, materials, names by default
    try {
      const [{ checkModelRules }, { brandRules }] = await Promise.all([import('../lib/brand.js'), import('../lib/brandrules.js')]);
      const objects = [], materialNames = new Set();
      obj.traverse((o) => { if (o.isMesh) { objects.push(o.name || ''); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && m.name && materialNames.add(m.name)); } });
      const team = checkModelRules({ ...info, objects: objects.filter(Boolean), materialNames: [...materialNames] }, brandRules().model).filter((c) => c.level !== 'ok');
      checks = [...checks.filter((c) => c.level !== 'ok' || !team.length), ...team.map((c) => ({ ...c, text: 'Команда: ' + c.text }))];
    } catch (e) { console.warn('brand', e); }
    if (alive) fillPanel();
  };
  const unwrapUv = async () => {
    if (uvBusy) return;
    const { S } = await import('../state.js');
    const it = opts.itemId ? S.byId.get(opts.itemId) : null;
    const B = await import('../lib/blender.js');
    const viaB = it && window.__TAURI_INTERNALS__ && opts.lib && (await B.blenderPath().catch(() => null));
    uvBusy = viaB ? 'Blender разворачивает…' : 'Разворачиваю…'; fillPanel();
    try {
      if (viaB) {
        const r = await B.unwrapInBlender(it);
        const fs = await import('@tauri-apps/plugin-fs');
        const { absPath } = await import('../lib/library.js');
        const u8 = await fs.readFile(absPath(r.rel));
        const name = (opts.name || it.name || 'Модель') + ' — UV';
        const added = await opts.lib.saveFromViewer(new Blob([u8], { type: 'model/gltf-binary' }), name + '.glb', opts.itemId);
        fs.remove(absPath(r.rel)).catch(() => {});
        if (added && added.length) toast(`Готово: «${name}» в библиотеке${r.counts.seams ? ` · швов ${fmt(r.counts.seams)}` : ''}`, 5000);
      } else {
        const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
        const r = await (await import('../lib/uvatlas.js')).unwrapObject(THREE, obj, { mergeVertices });
        if (!r.done.length) throw new Error(r.tooBig.length ? 'меши больше 65 000 вершин — разверните через Blender' : 'нечего разворачивать');
        uvDirty = true;
        info = modelInfo(T, obj, ext, null);
        buildWire();
        mode = 'uv'; applyMode(); drawBar();
        toast(`Развёрнуто мешей: ${r.done.length}${r.tooBig.length ? ` · пропущены большие: ${r.tooBig.length} (нужен Blender)` : ''} — включена UV-шахматка`, 5000);
      }
    } catch (e) { toast('Не удалось развернуть UV: ' + (e && e.message ? e.message : e), 5000); }
    uvBusy = '';
    checks = null; fillPanel(); runCheck();
  };
  const saveUv = async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const keepMode = mode, keepWire = prefs.wire;
    prefs.wire = false; buildWire(); prefs.wire = keepWire;
    mode = 'final'; applyMode();
    try {
      const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations || [] });
      const name = (opts.name || 'Модель') + ' — UV';
      const added = await opts.lib.saveFromViewer(new Blob([glb], { type: 'model/gltf-binary' }), name + '.glb', opts.itemId);
      if (added && added.length) { toast('Сохранено в библиотеку: ' + name + '.glb'); uvDirty = false; }
    } catch (e) { console.warn(e); toast('Не удалось сохранить модель с UV'); }
    mode = keepMode; applyMode(); buildWire(); drawBar(); fillPanel();
  };

  /* ---------- a material: shape, parameters, maps, «Сохранить как новый» ---------- */
  const setShape = (id) => {
    if (!matSel) return;
    prefs.matShape = id; savePrefs();
    matSel.mesh.geometry.dispose();
    matSel.mesh.geometry = M.shapeGeometry(THREE, id);
    reset(); buildGrid(); buildWire();
    panel.querySelectorAll('[data-shape]').forEach((b) => { const on = b.dataset.shape === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  };
  function matPanel() { // hoisted: the info panel is filled before this block runs
    const j = matSel.data.json, maps = j.maps || {};
    if (!mapUrls.length) for (const sl of M.SLOTS) {
      const n = maps[sl.id], d = n && matSel.data.files[n];
      mapUrls.push(d && /\.(png|jpe?g|webp|bmp)$/i.test(n) ? { id: sl.id, label: sl.label, url: URL.createObjectURL(new Blob([d])) } : n ? { id: sl.id, label: sl.label, url: '', ext: n.split('.').pop() } : null);
    }
    const sl = (k, label, min, max, step, v, fmtv) =>
      `<label class="m3d-ms"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-mp="${k}"><output>${fmtv(v)}</output></label>`;
    const f2 = (v) => (+v).toFixed(2).replace('.', ',');
    const shape = prefs.matShape || 'sphere';
    panel.innerHTML = `<b class="m3d-h">${esc(j.name || 'Материал')}</b>
      <div class="m3d-shapes" role="radiogroup" aria-label="Форма">${M.SHAPES.map((x) =>
        `<button type="button" role="radio" aria-checked="${shape === x.id}" class="${shape === x.id ? 'on' : ''}" data-shape="${x.id}">${x.label}</button>`).join('')}</div>
      <div class="m3d-mps">
        <label class="m3d-ms m3d-mc"><span>${maps.baseColor ? 'Оттенок' : 'Цвет'}</span><input type="color" value="${esc(j.color || '#ffffff')}" data-mp="color"></label>
        ${sl('roughness', 'Шероховатость', 0, 1, 0.01, j.roughness ?? 0.5, f2)}
        ${sl('metalness', 'Металл', 0, 1, 0.01, j.metalness ?? 0, f2)}
        ${maps.normal ? sl('normalScale', 'Сила нормалей', 0, 3, 0.05, j.normalScale ?? 1, f2) : ''}
        ${maps.height ? sl('heightScale', 'Смещение', 0, 0.2, 0.005, j.heightScale || 0, f2) : ''}
        ${maps.height ? sl('bumpStrength', 'Рельеф', 0, 3, 0.05, j.bumpStrength || 0, f2) : ''}
        ${sl('uvScale', 'Масштаб текстуры', 0.25, 8, 0.25, j.uvScale ?? 1, (v) => '×' + f2(v))}
      </div>
      <b class="m3d-h">Карты</b>
      <ul class="m3d-maps">${mapUrls.filter(Boolean).map((m) => `<li>${m.url ? `<img src="${m.url}" alt="">` : `<span class="x">${esc(m.ext.toUpperCase())}</span>`}<span>${m.label}</span></li>`).join('') || '<li class="none">Без текстур: только цвет и ползунки</li>'}</ul>
      ${opts.lib ? `<button type="button" class="m3d-save" data-mp="save"${matDirty ? '' : ' disabled'}>Сохранить как новый материал</button>` : ''}
      <p class="m3d-note">В Blender: выделите материал в Oddments, в Blender — «Применить материал из Oddments» (аддон, панель N › Oddments).</p>`;
  }
  const saveMat = async () => {
    const j = matSel.data.json, files = {};
    for (const [n, d] of Object.entries(matSel.data.files)) if (n !== 'material.json') files[n] = d;
    const name = (opts.name || j.name || 'Материал') + ' — правка';
    const blob = M.pack({ json: { ...j, name }, files });
    const added = await opts.lib.saveFromViewer(blob, name + '.perchmat', opts.itemId);
    if (added && added.length) { matDirty = false; toast('Сохранено в библиотеку: ' + name); fillPanel(); }
  };
  /* ---------- a model: try on a material from the library ---------- */
  // A tile puts the material on the whole model; with a part picked (a click on the model while the panel is
  // open) it goes on that part only. Each mesh remembers which library material it wears (`worn`, null = its own).
  const libMats = new Map(); // item id → Promise<MeshPhysicalMaterial>
  let part = null, partBox = null;
  const getLibMat = (id) => {
    if (!libMats.has(id)) {
      const pr = opts.lib.readItem(id).then((b) => M.buildMaterial(THREE, M.unpack(b))).then((m) => {
        const k = prefs.texScale || 1;
        if (k !== 1) Object.values(m.userData.maps || {}).forEach((t) => t && t.repeat.set(k, k));
        return m;
      });
      pr.catch(() => libMats.delete(id));
      libMats.set(id, pr);
    }
    return libMats.get(id);
  };
  const wear = async (id) => {
    const m = id ? await getLibMat(id) : null;
    (part ? [part] : meshes).forEach((e) => { e.mat = m || e.orig; e.worn = id; });
    if (mode !== 'final') setMode('final');
    else applyMode();
    drawMp();
  };
  const showPart = () => {
    if (partBox) { scene.remove(partBox); partBox.geometry.dispose(); partBox.material.dispose(); partBox = null; }
    if (!part) return;
    partBox = new THREE.BoxHelper(part.o, 0xf5f5f7);
    partBox.material.transparent = true; partBox.material.opacity = 0.6;
    scene.add(partBox);
  };
  const pickPart = (entry) => { part = entry && entry !== part ? entry : null; showPart(); drawMp(); };
  const texScale = (k) => { libMats.forEach((pr) => pr.then((m) => { Object.values(m.userData.maps || {}).forEach((t) => t && t.repeat.set(k, k)); })); };
  const saveModel = async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const keepMode = mode, keepWire = prefs.wire, keepPart = part;
    prefs.wire = false; buildWire(); prefs.wire = keepWire;
    part = null; showPart();
    mode = 'final'; applyMode();
    try {
      const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations || [] });
      const ids = Array.from(new Set(meshes.map((e) => e.worn).filter(Boolean)));
      const one = ids.length === 1 && meshes.every((e) => e.worn === ids[0]) ? (opts.lib.libraryMaterials().find((x) => x.id === ids[0]) || {}).name : '';
      const name = (opts.name || 'Модель') + ' — ' + (one || 'материалы');
      const added = await opts.lib.saveFromViewer(new Blob([glb], { type: 'model/gltf-binary' }), name + '.glb', opts.itemId);
      if (added && added.length) toast('Сохранено в библиотеку: ' + name + '.glb');
    } catch (e) { console.warn(e); toast('Не удалось сохранить модель с материалом'); }
    mode = keepMode; applyMode(); buildWire();
    part = keepPart; showPart();
  };
  const mp = document.createElement('div');
  mp.className = 'm3d-lp m3d-mp';
  mp.setAttribute('role', 'group');
  mp.setAttribute('aria-label', 'Материал из библиотеки');
  mp.hidden = true;
  const drawMp = () => {
    if (!mpOpen) return;
    const list = opts.lib.libraryMaterials();
    const changed = meshes.some((e) => e.worn);
    // the lit tile: what the picked part wears, or what the whole model wears when it is all one material
    const same = meshes.every((e) => (e.worn || null) === (meshes[0].worn || null));
    const cur = part ? part.worn || null : same ? meshes[0].worn || null : undefined;
    const tile = (id, inner, label) => `<button type="button" role="radio" aria-checked="${cur === id}" class="${cur === id ? 'on' : ''}" data-wear="${id || ''}"${id ? ' draggable="true"' : ''} title="${esc(label)}${id ? ' — или перетащите на нужную часть модели' : ''}">${inner}<span>${esc(label)}</span></button>`;
    const partName = part ? part.o.name || 'часть без имени' : '';
    mp.innerHTML = list.length
      ? `<p class="m3d-target">${part ? `Часть: <b>${esc(partName)}</b> <button type="button" class="lnk" data-mpk="all">Ко всей модели</button>` : meshes.length > 1 ? 'На всю модель · кликните по модели, чтобы выбрать часть' : 'На всю модель'}</p>
        <div class="m3d-lights" role="radiogroup" aria-label="Материал">
          ${tile(null, '<i class="own"></i>', 'Свои')}
          ${list.map((x) => tile(x.id, `<i${x.thumb ? ` style="background-image:url('${x.thumb}')"` : ''}></i>`, x.name)).join('')}
        </div>
        <div class="m3d-sls">
          <label class="m3d-sl"><span>Масштаб текстуры</span><input type="range" min="0.25" max="16" step="0.25" value="${prefs.texScale || 1}" data-mpk="scale"><output>×${String(prefs.texScale || 1).replace('.', ',')}</output></label>
          ${info.uvless ? '<span class="m3d-note">У части мешей нет UV — текстура ляжет одним цветом</span>' : ''}
          <button type="button" class="m3d-save" data-mpk="save"${changed ? '' : ' disabled'}>Сохранить как новую модель</button>
        </div>`
      : '<p class="m3d-note wide">В библиотеке пока нет материалов. Перетащите в Oddments zip с текстурами (Poly Haven, ambientCG) или «Добавить › Материал из текстур…».</p>';
  };
  mp.addEventListener('click', (e) => {
    e.stopPropagation();
    const w = e.target.closest('[data-wear]');
    if (w) { wear(w.dataset.wear || null); return; }
    if (e.target.closest('[data-mpk="all"]')) { pickPart(null); return; }
    if (e.target.closest('[data-mpk="save"]')) saveModel();
  });
  mp.addEventListener('input', (e) => {
    if (e.target.dataset.mpk !== 'scale') return;
    prefs.texScale = +e.target.value; savePrefs();
    e.target.nextElementSibling.textContent = '×' + String(prefs.texScale).replace('.', ',');
    texScale(prefs.texScale);
  });
  // a click (not a drag) on the model while the panel is open picks that part; on empty space — the whole model
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  const onPartDown = (e) => { downAt = mpOpen && e.button === 0 && !e.shiftKey && e.target === canvas ? { x: e.clientX, y: e.clientY } : null; };
  const onPartUp = (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) { downAt = null; return; }
    downAt = null;
    if (meshes.length < 2) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(meshes.map((m) => m.o), false)[0];
    pickPart(hit ? meshes.find((m) => m.o === hit.object) : null);
  };
  // a material dragged onto the model (a tile of the M panel, or the 3D section's shelf): it goes onto the part under
  // the pointer, or onto the whole model when there is only one part
  const MAT_TYPE = 'text/x-perch-mat';
  const onMatOver = (e) => { if (Array.from(e.dataTransfer.types).includes(MAT_TYPE)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } };
  const onMatDrop = (e) => {
    const id = e.dataTransfer.getData(MAT_TYPE);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(meshes.map((m) => m.o), false)[0];
    part = meshes.length > 1 && hit ? meshes.find((m) => m.o === hit.object) : null;
    showPart();
    wear(id);
  };
  if (!isMat && opts.lib) {
    holder.appendChild(mp);
    holder.addEventListener('pointerdown', onPartDown, true);
    holder.addEventListener('pointerup', onPartUp, true);
    holder.addEventListener('dragover', onMatOver, true);
    holder.addEventListener('drop', onMatDrop, true);
    mp.addEventListener('dragstart', (e) => {
      const t = e.target.closest('[data-wear]');
      if (!t || !t.dataset.wear) return;
      e.dataTransfer.setData(MAT_TYPE, t.dataset.wear);
      e.dataTransfer.setData('text/x-perch', '[]'); // ours, not a file from outside
      e.dataTransfer.effectAllowed = 'copy';
    });
  }

  // lighting panel above the bar: scenes, turn, exposure, the environment as the backdrop
  const lp = document.createElement('div');
  lp.className = 'm3d-lp';
  lp.setAttribute('role', 'group');
  lp.setAttribute('aria-label', 'Освещение');
  lp.hidden = true;
  const drawLp = () => {
    lp.innerHTML = `<div class="m3d-lights" role="radiogroup" aria-label="Сцена освещения">${LIGHTS.map((l) =>
      `<button type="button" role="radio" aria-checked="${light === l.id}" class="${light === l.id ? 'on' : ''}" data-light="${l.id}"><i style="background:${l.css}"></i><span>${l.label}</span></button>`).join('')}</div>
      <div class="m3d-sls">
        <label class="m3d-sl"><span>Поворот</span><input type="range" min="0" max="360" step="1" value="${prefs.lightRot || 0}" data-lp="rot"><output>${prefs.lightRot || 0}°</output></label>
        <label class="m3d-sl"><span>Экспозиция</span><input type="range" min="-3" max="3" step="0.1" value="${prefs.ev || 0}" data-lp="ev"><output>${evText(prefs.ev || 0)}</output></label>
        <label class="m3d-ck"><input type="checkbox" data-lp="bg"${prefs.hdrBg ? ' checked' : ''}> Окружение как фон</label>
      </div>`;
  };
  const placeLp = () => { lp.style.bottom = (40 + bar.offsetHeight + 10) + 'px'; };
  const setLp = (open) => {
    lpOpen = open; lp.hidden = !open;
    if (open) { mpOpen = false; mp.hidden = true; drawLp(); }
    drawBar();
    if (open) placeLp();
  };
  const setMp = (open) => {
    mpOpen = open; mp.hidden = !open;
    if (!open && part) { part = null; showPart(); }
    if (open) { lpOpen = false; lp.hidden = true; drawMp(); }
    drawBar();
    if (open) mp.style.bottom = (40 + bar.offsetHeight + 10) + 'px';
  };
  const setLight = (id) => {
    light = id; prefs.light = id; savePrefs();
    lp.querySelectorAll('[data-light]').forEach((b) => { const on = b.dataset.light === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    applyLight();
  };
  lp.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-light]');
    if (b) setLight(b.dataset.light);
  });
  lp.addEventListener('input', (e) => {
    const k = e.target.dataset.lp, out = e.target.nextElementSibling;
    if (k === 'rot') { prefs.lightRot = +e.target.value; out.textContent = prefs.lightRot + '°'; applyLightParams(); }
    else if (k === 'ev') { prefs.ev = +e.target.value; out.textContent = evText(prefs.ev); applyLightParams(); }
    else if (k === 'bg') { prefs.hdrBg = e.target.checked; applyBg(); buildGrid(); buildWire(); }
    savePrefs();
  });
  holder.appendChild(lp);

  // Shift + drag turns the lighting around the model (the camera stays put), as in Blender's look-dev
  let turn = null;
  const onTurnDown = (e) => {
    if (!e.shiftKey || e.button !== 0 || e.target !== canvas) return;
    e.stopPropagation(); e.preventDefault();
    turn = { x: e.clientX, r: prefs.lightRot || 0, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  };
  const onTurnMove = (e) => {
    if (!turn || e.pointerId !== turn.id) return;
    e.stopPropagation();
    prefs.lightRot = Math.round((((turn.r + (e.clientX - turn.x) * 0.5) % 360) + 360) % 360);
    applyLightParams();
    const rot = lp.querySelector('[data-lp="rot"]');
    if (rot) { rot.value = prefs.lightRot; rot.nextElementSibling.textContent = prefs.lightRot + '°'; }
  };
  const onTurnUp = (e) => { if (turn && e.pointerId === turn.id) { e.stopPropagation(); turn = null; savePrefs(); } };
  holder.addEventListener('pointerdown', onTurnDown, true);
  holder.addEventListener('pointermove', onTurnMove, true);
  holder.addEventListener('pointerup', onTurnUp, true);
  holder.addEventListener('pointercancel', onTurnUp, true);

  const hint = document.createElement('p');
  hint.className = 'm3d-hint';
  const HINT = 'Тяните — вращать · колесо — масштаб · правая кнопка — сдвиг · Shift + тянуть — свет · L освещение';
  hint.textContent = HINT;
  holder.appendChild(hint);

  const toggle = (k) => {
    if (k === 'wire') { prefs.wire = !prefs.wire; buildWire(); }
    else if (k === 'grid') { prefs.grid = !prefs.grid; buildGrid(); }
    else if (k === 'bg') { prefs.bg = prefs.bg === 'light' ? 'dark' : 'light'; applyBg(); buildGrid(); buildWire(); }
    else if (k === 'info') { prefs[infoKey] = prefs[infoKey] === false; panel.hidden = prefs[infoKey] === false; }
    else if (k === 'reset') reset();
    else if (k === 'light') { setLp(!lpOpen); return; }
    else if (k === 'mat') { setMp(!mpOpen); return; }
    savePrefs(); drawBar();
    if (lpOpen) placeLp();
    if (mpOpen) mp.style.bottom = (40 + bar.offsetHeight + 10) + 'px';
  };
  const setMode = (m) => { mode = m; prefs.mode = m; applyMode(); savePrefs(); drawBar(); };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.cap) { matcap = b.dataset.cap; prefs.matcap = matcap; applyMode(); savePrefs(); drawBar(); }
    else if (b.dataset.m3d) toggle(b.dataset.m3d);
    const same = bar.querySelector(b.dataset.mode ? `[data-mode="${b.dataset.mode}"]` : b.dataset.cap ? `[data-cap="${b.dataset.cap}"]` : `[data-m3d="${b.dataset.m3d}"]`);
    if (same) same.focus();
  });
  panel.addEventListener('input', (e) => {
    const k = e.target.dataset.mp;
    if (!k || !matSel) return;
    const j = matSel.data.json;
    j[k] = k === 'color' ? e.target.value : +e.target.value;
    const out = e.target.nextElementSibling;
    if (out && out.tagName === 'OUTPUT') out.textContent = (k === 'uvScale' ? '×' : '') + (+e.target.value).toFixed(2).replace('.', ',');
    M.applyParams(THREE, matSel.mat, j);
    if (!matDirty) { matDirty = true; const sv = panel.querySelector('[data-mp="save"]'); if (sv) sv.disabled = false; }
  });
  panel.addEventListener('click', (e) => {
    const sh = e.target.closest('[data-shape]');
    if (sh) { e.stopPropagation(); setShape(sh.dataset.shape); return; }
    if (e.target.closest('[data-mp="save"]')) { e.stopPropagation(); saveMat(); return; }
    const uv = e.target.closest('[data-uv]');
    if (uv) { e.stopPropagation(); if (uv.dataset.uv === 'go') unwrapUv(); else if (opts.lib) saveUv(); return; }
    const b = e.target.closest('[data-anim]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.anim === 'pause') { playing = !playing; b.innerHTML = ic(playing ? 'pause' : 'play') + `<span>${playing ? 'Пауза' : 'Играть'}</span>`; return; }
    play(+b.dataset.anim);
    panel.querySelectorAll('[data-anim]').forEach((x) => x.classList.toggle('on', x === b));
  });
  // keys work while the preview is open; they are swallowed so the app's own shortcuts do not fire
  const onKey = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    const m = MODES.find((x) => x.key === e.key);
    let hit = true;
    if (m) setMode(m.id);
    else if (e.code === 'KeyW') toggle('wire');
    else if (e.code === 'KeyG') toggle('grid');
    else if (e.code === 'KeyI') toggle('info');
    else if (e.code === 'KeyF') toggle('reset');
    else if (e.code === 'KeyL') { // next lighting scene (Shift — previous)
      const i = LIGHTS.findIndex((l) => l.id === light), n = LIGHTS.length;
      setLight(LIGHTS[(i + (e.shiftKey ? n - 1 : 1)) % n].id);
      if (!lpOpen) flash('Освещение: ' + LIGHTS.find((l) => l.id === light).label);
    }
    else if (e.code === 'KeyM' && !isMat && opts.lib) setMp(!mpOpen);
    else if (e.key === 'Escape' && lpOpen) setLp(false);
    else if (e.key === 'Escape' && mpOpen) setMp(false);
    else hit = false;
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey, true);
  // clicks on the model must not close the preview (a click on the bare stage does)
  holder.addEventListener('click', (e) => e.stopPropagation());

  let ft = null;
  const flash = (text) => {
    hint.textContent = text;
    hint.classList.add('flash');
    clearTimeout(ft);
    ft = setTimeout(() => { hint.classList.remove('flash'); hint.textContent = HINT; }, 1400);
  };
  if (isMat && prefs.matShape && prefs.matShape !== 'sphere') setShape(prefs.matShape);
  const ro = new ResizeObserver(size);
  ro.observe(holder);
  let alive = true, shown = false;
  (function loop() {
    if (!alive) return;
    const dt = clock.getDelta();
    if (mixer && playing) mixer.update(dt);
    controls.update();
    renderer.render(scene, cam);
    if (!shown) { shown = true; requestAnimationFrame(() => { if (alive) canvas.style.opacity = '1'; }); }
    requestAnimationFrame(loop);
  })();

  // Replace the model in place (same scene, camera, mode, matcap): used by the SVG → 3D sliders, so the view
  // changes live without the canvas going dark between models.
  let swapping = Promise.resolve();
  const swap = (nbuf) => (swapping = swapping.then(async () => {
    const nobj = await parseModel(T, ext, nbuf);
    if (!alive) { disposeObject(nobj); return; }
    const keepWire = prefs.wire;
    prefs.wire = false; buildWire(); prefs.wire = keepWire; // takes the old outline off the old model
    meshes.forEach(({ o, mat }) => { o.material = mat; });
    overrides.forEach((m) => m.dispose()); overrides.clear();
    scene.remove(obj);
    disposeObject(obj);
    obj = nobj; buf = nbuf;
    scene.add(obj);
    meshes.length = 0;
    obj.traverse((o) => { if (o.isMesh) meshes.push({ o, mat: o.material }); });
    info = modelInfo(T, obj, ext, buf);
    // the camera and the floor stay exactly where they were: rebuilding the floor for the new size made the
    // whole view seem to move while a slider was dragged
    checks = null;
    applyMode(); buildWire(); fillPanel(); runCheck();
  }).catch((e) => console.warn('viewer swap', e)));

  const stop = () => {
    alive = false;
    if (holder.dataset.keepView) holder.__view = { p: cam.position.clone(), t: controls.target.clone() };
    document.removeEventListener('keydown', onKey, true);
    // another preview may already own the shared canvas: only detach it from our own stage
    if (canvas.parentNode === holder) { canvas.style.visibility = 'hidden'; canvas.remove(); }
    ro.disconnect();
    controls.dispose();
    if (mixer) mixer.stopAllAction();
    if (grid) { grid.geometry.dispose(); grid.material.dispose(); }
    clearTimeout(ft);
    holder.removeEventListener('pointerdown', onTurnDown, true);
    holder.removeEventListener('pointerdown', onPartDown, true);
    holder.removeEventListener('pointerup', onPartUp, true);
    holder.removeEventListener('dragover', onMatOver, true);
    holder.removeEventListener('drop', onMatDrop, true);
    mapUrls.forEach((m) => m && m.url && URL.revokeObjectURL(m.url));
    holder.removeEventListener('pointermove', onTurnMove, true);
    holder.removeEventListener('pointerup', onTurnUp, true);
    holder.removeEventListener('pointercancel', onTurnUp, true);
    scene.environment = null; scene.background = null; // the environments stay cached for the next preview
    meshes.forEach((e) => { e.o.material = e.orig; }); // the file's own materials go with the model
    if (partBox) { partBox.geometry.dispose(); partBox.material.dispose(); }
    overrides.forEach((m) => m.dispose());
    disposeObject(obj);
    libMats.forEach((pr) => pr.then((m) => M.disposeMaterial(m)).catch(() => {}));
    renderer.renderLists.dispose(); // the context itself stays for the next preview
  };
  stop.swap = swap;
  // opened by dropping a material on a model card (the 3D section): the model comes up wearing it
  if (opts.wear && !isMat && opts.lib) wear(opts.wear);
  return stop;
}
