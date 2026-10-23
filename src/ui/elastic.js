// Elastic range inputs, after Arc's elastic slider (uiarc.dev, MIT, © 2026 Elia Kuratli): dragged past an
// end the track stretches like rubber towards the pointer (with resistance, a few pixels at most) and springs
// back on release; while dragging, a value tag rides above the thumb and sways with the speed of the hand.
// The native <input type="range"> keeps the value, the keyboard and the events, so nothing else changes.
// Every range input gets the rubber; the value tag only those with the class "elastic" (data-unit is
// appended to it, e.g. " px").
import { motionOn } from './motion.js';
import { sfx } from './sound.js';

const THUMB = 30; // the thumb width in styles.css (.zoom input::-webkit-slider-thumb)

function tagOf(inp) {
  let t = inp.__tag;
  if (!t) {
    t = document.createElement('output');
    t.className = 'etag'; t.setAttribute('aria-hidden', 'true');
    inp.parentNode.style.position = 'relative';
    inp.after(t);
    inp.__tag = t;
  }
  return t;
}

function placeTag(inp, t, sway) {
  const min = +inp.min || 0, max = +inp.max || 100, v = +inp.value;
  const k = (v - min) / (max - min || 1);
  const x = inp.offsetLeft + THUMB / 2 + k * (inp.offsetWidth - THUMB);
  t.textContent = v + (inp.dataset.unit || '');
  t.style.left = x + 'px';
  t.style.rotate = sway.toFixed(1) + 'deg';
}

function grab(inp, e) {
  if (!motionOn() || e.button !== 0 || inp.disabled) return;
  const r = inp.getBoundingClientRect(), t = inp.classList.contains('elastic') ? tagOf(inp) : null;
  if (!t) return stretchOnly(inp, r);
  let lastX = e.clientX, lastT = performance.now(), sway = 0;
  inp.classList.add('pull');
  t.classList.add('on');
  placeTag(inp, t, 0);
  const mv = (ev) => {
    const now = performance.now(), vx = (ev.clientX - lastX) / Math.max(8, now - lastT);
    lastX = ev.clientX; lastT = now;
    sway = Math.max(-14, Math.min(14, -vx * 9));
    // past an end: rubber with resistance, 1 - e^(-d) keeps it under ~16 px however far the hand goes
    const over = ev.clientX < r.left ? -(r.left - ev.clientX) : ev.clientX > r.right ? ev.clientX - r.right : 0;
    const s = 16 * (1 - Math.exp(-Math.abs(over) / 70));
    inp.style.transformOrigin = over < 0 ? '100% 50%' : '0% 50%';
    inp.style.scale = `${(r.width + s) / r.width} ${1 - (s / 16) * 0.25}`;
    placeTag(inp, t, sway);
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    inp.classList.remove('pull');
    if (inp.style.scale && parseFloat(inp.style.scale) > 1.02) sfx('drift'); // let go while stretched
    inp.style.scale = '';
    t.classList.remove('on');
    placeTag(inp, t, 0);
  };
  addEventListener('pointermove', mv, { passive: true }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

// sliders whose value is printed next to them (settings, the 3D panels) only get the rubber
function stretchOnly(inp, r) {
  inp.classList.add('pull');
  const mv = (ev) => {
    const over = ev.clientX < r.left ? -(r.left - ev.clientX) : ev.clientX > r.right ? ev.clientX - r.right : 0;
    const s = 12 * (1 - Math.exp(-Math.abs(over) / 70));
    inp.style.transformOrigin = over < 0 ? '100% 50%' : '0% 50%';
    inp.style.scale = `${(r.width + s) / r.width} 1`;
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    inp.classList.remove('pull');
    inp.style.scale = '';
  };
  addEventListener('pointermove', mv, { passive: true }); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

// one delegated listener: every range input in the app, including ones rendered later
export function initElastic() {
  document.addEventListener('pointerdown', (e) => {
    const inp = e.target;
    if (inp instanceof HTMLInputElement && inp.type === 'range') grab(inp, e);
  });
  document.addEventListener('input', (e) => {
    const inp = e.target;
    if (inp.__tag && inp.__tag.classList.contains('on')) placeTag(inp, inp.__tag, parseFloat(inp.__tag.style.rotate) || 0);
  });
}
