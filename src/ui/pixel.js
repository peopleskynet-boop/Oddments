// Pixel effects after haoqi.design:
// - bootIntro(): at launch a thin loading line, then ODDMENTS gathers from raster dots and the window clears;
// - card facts: hold the pointer on a card and its picture dissolves in a pixel raster into its card of facts
//   (name, type, size, tags, the palette with HEX); leaving dissolves it back. Off with the setting «Сведения при
//   наведении», and never for video (the hover plays it) or while dragging / selecting with the frame.
import { S } from '../state.js';
import { settings } from './settings.js';
import { fmtSize, inkOn } from '../util.js';

const motionOK = () => settings.anim === 'smooth' || (settings.anim === 'system' && !matchMedia('(prefers-reduced-motion: reduce)').matches);
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- the raster dissolve: each cell's square shrinks to a dot and the next picture grows from one ---------- */
function dissolve(cv, A, B, ms, done) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, s = Math.max(8, Math.round(W / 30)), cw = Math.ceil(W / s), ch = Math.ceil(H / s);
  const order = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) order[j * cw + i] = (i / cw) * 0.45 + (j / ch) * 0.25 + Math.random() * 0.3;
  const t0 = performance.now(), id = (cv.__id = (cv.__id || 0) + 1);
  const step = (now) => {
    if (cv.__id !== id) return;
    const t = Math.min(1, (now - t0) / ms);
    x.clearRect(0, 0, W, H);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const d = (t - order[j * cw + i] * 0.7) / 0.3, X = i * s, Y = j * s;
      if (d <= 0) { x.drawImage(A, X, Y, s, s, X, Y, s, s); continue; }
      if (d >= 1) { x.drawImage(B, X, Y, s, s, X, Y, s, s); continue; }
      const src = d < 0.5 ? A : B, q = d < 0.5 ? 1 - d * 2 : d * 2 - 1, sz = Math.max(1, s * Math.max(0.15, q)), o = (s - sz) / 2;
      x.drawImage(src, X, Y, s, s, X + o, Y + o, sz, sz);
    }
    if (t < 1) requestAnimationFrame(step); else if (done) done();
  };
  requestAnimationFrame(step);
}

/* ---------- card facts ---------- */
const KIND = { image: 'Картинка', gif: 'GIF', video: 'Видео', audio: 'Аудио', font: 'Шрифт', pdf: 'PDF', psd: 'PSD', model: '3D', material: 'Материал', figma: 'Figma', link: 'Ссылка', other: 'Файл' };
function factsCanvas(it, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), theme = document.documentElement.dataset.theme;
  const light = theme === 'calm' || theme === 'light';
  const bg = light ? '#1d1d1b' : cssv('--card') || '#141417', fg = light ? '#f0eee8' : cssv('--fg'), hud = theme === 'marathon' ? cssv('--hud') : fg;
  const mono = cssv('--mono') || 'monospace', ui = cssv('--font-ui') || 'sans-serif';
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const pad = Math.round(W * 0.07), cols = (it.colors || []).slice(0, 4), bh = Math.round(H * 0.32);
  // the palette along the bottom, as bars with their HEX
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(Math.floor((W / cols.length) * i), H - bh, Math.ceil(W / cols.length) + 1, bh); });
  const f = Math.max(10, Math.round(W * 0.042));
  x.textBaseline = 'top';
  x.fillStyle = hud; x.font = `500 ${f}px ${mono}`;
  x.fillText((KIND[it.kind] || 'Файл').toUpperCase() + ' · ' + (it.ext || '').toUpperCase(), pad, pad);
  x.fillStyle = fg; x.font = `600 ${Math.round(f * 1.9)}px ${ui}`;
  let name = it.name || ''; while (name.length > 3 && x.measureText(name).width > W - pad * 2) name = name.slice(0, -2);
  if (name !== it.name) name = name.replace(/.$/, '…');
  x.fillText(name, pad, pad + f * 1.7);
  x.font = `500 ${f}px ${mono}`; x.globalAlpha = 0.72;
  const lines = [];
  if (it.w && it.kind !== 'model' && it.kind !== 'material') lines.push(`${Math.round(it.w)} × ${Math.round(it.h)}`);
  if (it.verts) lines.push(`${it.verts.toLocaleString('ru-RU')} верш.`);
  lines.push(fmtSize(it.size || 0));
  if (it.tags && it.tags.length) lines.push(it.tags.slice(0, 3).map((t) => '#' + t).join('  '));
  lines.forEach((l, i) => x.fillText(l.toUpperCase(), pad, pad + f * 4.6 + i * f * 1.55));
  x.globalAlpha = 1;
  x.font = `500 ${Math.max(9, Math.round(f * 0.85))}px ${mono}`;
  cols.forEach((col, i) => {
    x.fillStyle = inkOn(col); // full black or white, whichever has the higher contrast on this colour
    x.fillText(col.toUpperCase(), Math.floor((W / cols.length) * i) + f * 0.6, H - f * 1.6);
  });
  return c;
}
// the picture as the card shows it (object-fit: cover)
function pictureCanvas(img, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), iw = img.naturalWidth || W, ih = img.naturalHeight || H, s = Math.max(W / iw, H / ih);
  try { x.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); } catch (e) { /* not decoded yet */ }
  return c;
}

let timer = null, active = null;
function enter(card) {
  clearTimeout(timer);
  if (!settings.facts || !motionOK() || card.dataset.kind === 'video' || document.body.classList.contains('marqueeing')) return;
  timer = setTimeout(() => show(card), 650);
}
function show(card) {
  // a selected card already has its facts in the properties panel: dissolving it would only hide the picture
  if (!card.isConnected || !card.matches(':hover') || card.classList.contains('sel') || card.querySelector('[data-fav]:hover')) return;
  const it = S.byId.get(card.dataset.id), ph = card.querySelector('.ph'), img = ph && ph.querySelector('img');
  if (!it || !img || !img.complete) return;
  hide();
  const r = ph.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (W < 60 || H < 60) return;
  const cv = document.createElement('canvas');
  cv.className = 'facts'; cv.width = W; cv.height = H;
  cv.setAttribute('aria-hidden', 'true');
  ph.appendChild(cv);
  const A = pictureCanvas(img, W, H), B = factsCanvas(it, W, H);
  active = { card, cv, A, B };
  dissolve(cv, A, B, 380);
}
function hide() {
  clearTimeout(timer);
  if (!active) return;
  const { cv, A, B } = active; active = null;
  dissolve(cv, B, A, 280, () => cv.remove());
}

export function initPixel() {
  const grid = document.getElementById('grid');
  grid.addEventListener('pointerover', (e) => { const c = e.target.closest('.card'); if (c && (!active || active.card !== c)) { if (active) hide(); enter(c); } });
  // the facts wait for a resting pointer: while it moves (on its way to the heart, say) the clock restarts,
  // and over the heart it does not run at all, so the card never turns over under a click that is coming
  grid.addEventListener('pointermove', (e) => {
    const c = e.target.closest('.card');
    if (!c || (active && active.card === c)) return;
    if (e.target.closest('[data-fav]')) { clearTimeout(timer); return; }
    enter(c);
  }, { passive: true });
  grid.addEventListener('pointerout', (e) => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) { clearTimeout(timer); if (active && active.card === c) hide(); } });
  grid.addEventListener('pointerdown', () => { clearTimeout(timer); hide(); }, true);
  document.getElementById('scroll').addEventListener('scroll', () => { clearTimeout(timer); if (active) hide(); }, { passive: true });
}
