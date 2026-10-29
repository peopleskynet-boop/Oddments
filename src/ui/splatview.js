// Gaussian splats in the preview: Spark on the app's one WebGL canvas (the 3D view's shared renderer), orbit like the
// 3D view, its backdrop and «Сбросить вид», an info panel (how many splats, harmonics, size) and «Перевернуть» —
// trainers write splats in the camera's frame, so most files stand upside down until turned; the choice is kept with
// the file by the caller (opts.onFlip). Returns a cleanup function.
import { loadThree } from '../lib/model3d.js';
import { loadSpark, openSplat, orient, splatStats, aimAt } from '../lib/splat.js';
import { sharedRenderer, BG, prefs, savePrefs } from './viewer3d.js';
import { ic } from './icons.js';
import { DEC, LOC } from '../util.js';

const fmt = (n) => Math.round(n).toLocaleString(LOC);
const fmtLen = (v) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2)).replace('.', DEC);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const SH_TEXT = ['нет — цвет не зависит от ракурса', '1 — блики слегка меняются с ракурсом', '2', '3 — как у обученных сцен'];

// opts: { flip (default true), onFlip(flip), name, format }
export async function mountSplat(holder, bytes, ext, isStale, opts = {}) {
  const [T, { S }] = await Promise.all([loadThree(), loadSpark()]);
  if (isStale()) return () => {};
  const { THREE } = T;
  const mesh = await openSplat(S, bytes, ext);
  if (isStale()) { mesh.dispose(); return () => {}; }
  let flip = opts.flip !== false;
  orient(mesh, flip);
  let st = splatStats(THREE, mesh);

  holder.innerHTML = '';
  holder.classList.add('m3d');
  const { canvas, renderer } = sharedRenderer(THREE);
  canvas.style.opacity = '0';
  canvas.style.visibility = '';
  holder.appendChild(canvas);
  const scene = new THREE.Scene();
  const spark = new S.SparkRenderer({ renderer });
  scene.add(spark);
  scene.add(mesh);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const controls = new T.OrbitControls(cam, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const size = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  const reset = () => {
    const dist = aimAt(THREE, cam, st, 1.25);
    controls.target.copy(st.center);
    controls.minDistance = dist / 50;
    controls.maxDistance = dist * 20;
    controls.update();
  };
  const applyBg = () => {
    const c = prefs.bg === 'light' ? BG.light : BG.dark;
    scene.background = new THREE.Color(c);
    renderer.setClearColor(c, 1);
    canvas.style.background = hex(c);
    holder.classList.toggle('light', prefs.bg === 'light');
  };
  size(); reset(); applyBg();

  const bar = document.createElement('div');
  bar.className = 'm3d-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Вид сплата');
  const btn = (act, inner, label, pressed) =>
    `<button type="button" data-sp="${act}" title="${label}" aria-label="${label}"${pressed == null ? '' : ` aria-pressed="${pressed}"`}>${inner}</button>`;
  const drawBar = () => {
    bar.innerHTML = btn('flip', ic('flipV'), 'Перевернуть (U)') +
      btn('bg', ic('contrast'), prefs.bg === 'light' ? 'Фон: светлый — сделать тёмным' : 'Фон: тёмный — сделать светлым') +
      btn('reset', ic('restore'), 'Сбросить вид (F)') +
      btn('info', ic('info'), 'Сведения о сплате (I)', prefs.splatInfo !== false);
  };
  drawBar();
  holder.appendChild(bar);

  const panel = document.createElement('aside');
  panel.className = 'm3d-info';
  panel.setAttribute('aria-label', 'Сведения о сплате');
  const row = (k, v, title) => `<dt${title ? ` title="${title}"` : ''}>${k}</dt><dd>${v}</dd>`;
  const fillPanel = () => {
    panel.innerHTML = `<b class="m3d-h">Сплат</b><dl>${row('Сплатов', fmt(st.count))}` +
      row('Гармоники', SH_TEXT[Math.min(3, st.sh)] || String(st.sh), 'Сферические гармоники: насколько цвет точки меняется, когда смотришь с другой стороны') +
      row('Габариты', st.size.map(fmtLen).join(' × '), 'Основная масса точек, без одиночных далёких «облачков»') +
      row('Формат', (opts.format || ext).toUpperCase()) + '</dl>' +
      '<p class="m3d-note">Сплат — облако цветных размытых точек: свет и материалы уже «запечены» в цвет, поэтому режимов глины и освещения здесь нет.</p>';
  };
  fillPanel();
  panel.hidden = prefs.splatInfo === false;
  holder.appendChild(panel);

  const hint = document.createElement('p');
  hint.className = 'm3d-hint';
  const HINT = 'Тяните — вращать · колесо — масштаб · правая кнопка — сдвиг · U перевернуть';
  hint.textContent = HINT;
  holder.appendChild(hint);

  const toggle = (k) => {
    if (k === 'flip') {
      flip = !flip;
      orient(mesh, flip);
      st = splatStats(THREE, mesh);
      reset(); fillPanel();
      if (opts.onFlip) opts.onFlip(flip);
    } else if (k === 'bg') { prefs.bg = prefs.bg === 'light' ? 'dark' : 'light'; applyBg(); savePrefs(); }
    else if (k === 'reset') reset();
    else if (k === 'info') { prefs.splatInfo = prefs.splatInfo === false; panel.hidden = prefs.splatInfo === false; savePrefs(); }
    drawBar();
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    e.stopPropagation();
    toggle(b.dataset.sp);
    const same = bar.querySelector(`[data-sp="${b.dataset.sp}"]`);
    if (same) same.focus();
  });
  const onKey = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    let hit = true;
    if (e.code === 'KeyF') toggle('reset');
    else if (e.code === 'KeyI') toggle('info');
    else if (e.code === 'KeyU') toggle('flip');
    else hit = false;
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  };
  document.addEventListener('keydown', onKey, true);
  holder.addEventListener('click', (e) => e.stopPropagation()); // a click on the splat must not close the preview

  const ro = new ResizeObserver(size);
  ro.observe(holder);
  let alive = true, shown = false;
  (function loop() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, cam);
    if (!shown) { shown = true; setTimeout(() => { if (alive) canvas.style.opacity = '1'; }, 120); } // after the first sort
    requestAnimationFrame(loop);
  })();

  return () => {
    alive = false;
    document.removeEventListener('keydown', onKey, true);
    if (canvas.parentNode === holder) { canvas.style.visibility = 'hidden'; canvas.remove(); }
    ro.disconnect();
    controls.dispose();
    scene.remove(mesh); scene.remove(spark);
    mesh.dispose();
    spark.dispose();
    renderer.renderLists.dispose();
  };
}
