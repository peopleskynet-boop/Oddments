// A loupe that follows the cursor, as on shop pages with clothes: a round window beside the pointer with the picture
// under it magnified. Used where detail is the point — «Увеличить» (what the AI drew, against a plain resize) and «Убрать
// фон» (the edge). The wheel changes the magnification (1:1 picture pixels and up), L switches the loupe off and on; both
// remembered (`perch.loupe`). The window decides what is drawn: paint(ctx, x, y, s, w, h) draws its picture so that
// picture point (x, y) lands in the middle of a w × h canvas at s canvas pixels per picture pixel.
//   const lp = attachLoupe(stageEl, { at: (cx, cy) → { x, y } | null, paint });   lp.refresh(); lp.destroy();
import './loupe.css';
import { readPref, writePref } from '../lib/prefs.js';

const PREF = 'perch.loupe';
const ZOOMS = [1, 2, 4, 8];
const prefs = readPref(PREF, { on: true, zoom: 2 });
const SIZE = 236; // css px

export function attachLoupe(host, { at, paint }) {
  const el = document.createElement('div');
  el.className = 'loupe';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<canvas></canvas><b></b>';
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), cx = cv.getContext('2d'), label = el.querySelector('b');
  let last = null, raf = 0;

  const draw = () => {
    raf = 0;
    if (!last || !prefs.on) { el.hidden = true; return; }
    const p = at(last.x, last.y);
    if (!p) { el.hidden = true; return; }
    const dpr = devicePixelRatio || 1, w = Math.round(SIZE * dpr);
    if (cv.width !== w) { cv.width = cv.height = w; }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, w, w);
    cx.imageSmoothingEnabled = prefs.zoom < 4; // at 4× and more the pixels are what one wants to see
    cx.imageSmoothingQuality = 'high';
    paint(cx, p.x, p.y, prefs.zoom * dpr, w, w);
    label.textContent = '×' + prefs.zoom;
    // beside the pointer, up and to the right; turned over at the window's edges
    const gap = 26;
    let left = last.x + gap, top = last.y - gap - SIZE;
    if (left + SIZE > innerWidth - 8) left = last.x - gap - SIZE;
    if (top < 8) top = last.y + gap;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    el.hidden = false;
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const onMove = (e) => { last = { x: e.clientX, y: e.clientY }; queue(); };
  const onLeave = () => { last = null; el.hidden = true; };
  const onWheel = (e) => {
    if (!prefs.on || !last || !at(last.x, last.y) || e.ctrlKey) return;
    e.preventDefault();
    const i = ZOOMS.indexOf(prefs.zoom), j = Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 1 : i) + (e.deltaY < 0 ? 1 : -1)));
    if (ZOOMS[j] !== prefs.zoom) { prefs.zoom = ZOOMS[j]; writePref(PREF, prefs); queue(); }
  };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('wheel', onWheel, { passive: false });
  return {
    get on() { return prefs.on; },
    toggle() { prefs.on = !prefs.on; writePref(PREF, prefs); if (prefs.on) queue(); else el.hidden = true; return prefs.on; },
    refresh: queue,
    hide: onLeave,
    destroy() {
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('wheel', onWheel);
      el.remove();
    },
  };
}
