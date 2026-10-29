// Motion layer: small, calm interactions in the spirit of Apple's animations. Everything here is cheap
// (one delegated listener each, CSS variables and transforms only) and switches off when animations are
// off in Settings or the system asks for reduced motion.
import { settings } from './settings.js';
import { SPRINGS } from './spring.js';
import { layerOpen } from '../util.js';

// «Анимации»: 'smooth' (default) — always on; 'system' — off when Windows / macOS asks for reduced motion; 'none' — off.
// The default ignores the system on purpose: with Windows' «Эффекты анимации» off the exe lost every slide and
// spring while the web build kept them (bugs #82, #84, #87) — the person chooses here.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export const animOn = (anim) => anim === 'smooth' || (anim === 'system' && !reduced.matches);
export const systemReduced = () => reduced.matches;
export const motionOn = () => animOn(settings.anim);
// presses and small indicators: Arc's snappy spring (spring.js), not a cubic-bezier with an overshoot
export const SPRING = SPRINGS.snappy.easing;

// Liquid Glass: a soft highlight that follows the pointer over glass surfaces.
function glassLight() {
  let cur = null, raf = 0, px = 0, py = 0;
  document.addEventListener('pointermove', (e) => {
    let g = motionOn() && e.target.closest ? e.target.closest('.glass') : null;
    // under a full-screen layer only the layer's own glass lights up
    if (g && layerOpen() && !g.closest('.plg, .flw, .sb-layer, .s3d, .ik, .feed, .news')) g = null;
    // a panel that scrolls itself (the inspector, long lists) would carry the rim along with its content and
    // draw it across the middle of the panel: no light there
    if (g && g.scrollHeight > g.clientHeight + 1) g = null;
    if (cur && cur !== g) cur.classList.remove('lit-g');
    cur = g;
    if (!g) return;
    px = e.clientX; py = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      cur.style.setProperty('--mx', px - r.left + 'px');
      cur.style.setProperty('--my', py - r.top + cur.scrollTop + 'px');
      cur.classList.add('lit-g');
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (cur) cur.classList.remove('lit-g'); cur = null; });
}

// «Марафон»: the bloom of a glass panel (--glow, set by :hover in CSS) comes up in .35 s and fades in .6 s. Eased
// here with WAAPI, not a CSS transition: that one would replace every panel's own transition (bug #118).
function glassGlow() {
  const chain = (el) => { const a = []; for (let g = el && el.closest && el.closest('.glass'); g; g = g.parentElement && g.parentElement.closest('.glass')) if (!g.classList.contains('pill')) a.push(g); return a; };
  const ease = (g, to) => {
    if (!motionOn() || document.documentElement.dataset.theme !== 'marathon') return;
    const from = parseFloat(getComputedStyle(g).getPropertyValue('--glow')) || 0;
    if (g._glow) g._glow.cancel();
    g._glow = g.animate([{ '--glow': from }, { '--glow': to }], { duration: to ? 350 : 600, easing: 'ease' });
  };
  const move = (from, to) => {
    const a = chain(from), b = chain(to);
    for (const g of a) if (!b.includes(g)) ease(g, 0);
    for (const g of b) if (!a.includes(g)) ease(g, 1);
  };
  document.addEventListener('pointerover', (e) => move(e.relatedTarget, e.target), { passive: true });
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) move(e.target, null); }, { passive: true });
}

// Cards lean slightly towards the pointer, like a picture in the hand.
function cardTilt() {
  const grid = document.getElementById('grid');
  let cur = null, raf = 0, ev = null;
  const reset = () => { if (cur) { cur.style.removeProperty('--rx'); cur.style.removeProperty('--ry'); } cur = null; };
  grid.addEventListener('pointermove', (e) => {
    if (!motionOn() || e.buttons) return reset();
    const c = e.target.closest('.card');
    if (c !== cur) reset();
    cur = c;
    ev = e;
    if (!c || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!cur || !ev) return;
      const r = cur.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
      cur.style.setProperty('--rx', (-y * 5).toFixed(2) + 'deg');
      cur.style.setProperty('--ry', (x * 6).toFixed(2) + 'deg');
    });
  }, { passive: true });
  grid.addEventListener('pointerleave', reset);
}

// A pill under the active item of a list (tabs, sidebar). Neighbours: it glides over, with no
// overshoot. Far away: it does not sweep across every label — it fades out and appears in place.
// The indicator survives re-renders: it is re-attached to the container after innerHTML changes.
const FAR = 140; // px; beyond this the pill re-appears instead of travelling
export function slideIndicator(container, activeSel, cls) {
  if (!container) return;
  let ind = container.__ind;
  if (!ind) { ind = document.createElement('i'); ind.className = cls; ind.setAttribute('aria-hidden', 'true'); container.__ind = ind; }
  container.__sel = activeSel;
  if (!container.__ro && window.ResizeObserver) {
    // the list changed its width (a narrower window, a scrollbar came): the pill takes its row's new size at once — it
    // kept the old one and stuck out of the row (audit 29.10). Only a real change: the observer's first call is not one.
    container.__ro = new ResizeObserver(() => {
      const a = ind.dataset.placed && container.querySelector(container.__sel);
      if (!a) return;
      const x = a.offsetLeft, y = a.offsetTop, w = a.offsetWidth, h = a.offsetHeight;
      if (x === +ind.dataset.x && y === +ind.dataset.y && w === +ind.dataset.w && h === +ind.dataset.h) return;
      Object.assign(ind.dataset, { x, y, w, h });
      ind.style.transition = 'none';
      ind.style.transform = `translate(${x}px, ${y}px)`;
      ind.style.width = w + 'px'; ind.style.height = h + 'px';
      void ind.offsetWidth; ind.style.transition = '';
    });
    container.__ro.observe(container);
  }
  if (ind.parentNode !== container) {
    // re-rendering the list (innerHTML) detaches the pill; a re-inserted element has no previous style,
    // so it would animate in from the top-left corner. Put it back exactly where it was first.
    container.prepend(ind);
    if (ind.dataset.placed) {
      ind.style.transition = 'none';
      ind.style.transform = `translate(${ind.dataset.x}px, ${ind.dataset.y}px)`;
      ind.style.width = ind.dataset.w + 'px'; ind.style.height = ind.dataset.h + 'px';
      const fading = Date.now() < +(ind.dataset.fadeUntil || 0); // a second re-render during the fade-in
      if (fading) { ind.style.opacity = '0'; ind.style.scale = '.92'; }
      void ind.offsetWidth;
      if (fading) {
        ind.style.transition = 'opacity .22s ease, scale .3s cubic-bezier(.2, .8, .2, 1)';
        ind.style.opacity = '1'; ind.style.scale = '1';
        ind.dataset.fadeUntil = Date.now() + 320;
        setTimeout(() => { ind.style.transition = ''; }, 320);
      } else ind.style.transition = '';
    }
  }
  const a = container.querySelector(activeSel);
  if (!a) { ind.style.opacity = '0'; ind.dataset.placed = ''; return; }
  const x = a.offsetLeft, y = a.offsetTop, w = a.offsetWidth, h = a.offsetHeight;
  const px = +ind.dataset.x || 0, py = +ind.dataset.y || 0;
  const far = Math.hypot(x - px, y - py) > FAR;
  const place = () => {
    ind.style.transform = `translate(${x}px, ${y}px)`;
    ind.style.width = w + 'px'; ind.style.height = h + 'px';
  };
  ind.dataset.x = x; ind.dataset.y = y; ind.dataset.w = w; ind.dataset.h = h;
  if (!ind.dataset.placed || !motionOn()) {
    ind.style.transition = 'none'; place(); ind.style.opacity = '1';
    void ind.offsetWidth; ind.style.transition = '';
  } else if (far) {
    // appear in place: a quick fade and a slight grow, no journey across the list
    ind.style.transition = 'none';
    ind.style.opacity = '0';
    place();
    ind.style.scale = '.92';
    void ind.offsetWidth;
    ind.style.transition = 'opacity .22s ease, scale .3s cubic-bezier(.2, .8, .2, 1)';
    ind.style.opacity = '1'; ind.style.scale = '1';
    ind.dataset.fadeUntil = Date.now() + 320;
    setTimeout(() => { ind.style.transition = ''; }, 320);
  } else {
    ind.style.opacity = '1';
    place();
  }
  ind.dataset.placed = '1';
}

// Opening a picture: the other cards on screen fly away from it along the line from its centre and fade
// (the nearest go first); closing brings them back. Cards are placed with `transform`, so the flight
// uses the separate `translate` property and never fights the layout.
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const SETTLE = 'cubic-bezier(.16, 1, .3, 1)'; // a long, soft arrival (ease-out-expo-like), no bump at the end
let scattered = [];
export function scatterCards(fromCard, out) {
  if (!out) {
    // the way back is its own animation, not the scatter reversed: reversed, an ease-out speeds up towards the
    // end and the cards slammed into place. Here they set off from wherever they are now and settle softly,
    // the near ones first.
    const anims = scattered;
    scattered = [];
    anims.forEach((a) => {
      const el = a.effect && a.effect.target;
      if (!el) { a.cancel(); return; }
      const cs = getComputedStyle(el), from = { translate: cs.translate, scale: cs.scale, opacity: cs.opacity, filter: cs.filter };
      const order = (a.effect.getTiming().delay || 0) * 0.6;
      a.cancel();
      el.animate([from, { translate: '0 0', scale: '1', opacity: 1, filter: 'blur(0)' }],
        { duration: 620, delay: order, easing: SETTLE, fill: 'backwards' });
    });
    return;
  }
  scattered.forEach((a) => a.cancel());
  scattered = [];
  if (!motionOn() || !fromCard) return;
  const r = fromCard.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  document.querySelectorAll('#grid .card').forEach((c) => {
    if (c === fromCard) return;
    const b = c.getBoundingClientRect();
    if (b.bottom < -40 || b.top > innerHeight + 40) return;
    const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy, d = Math.hypot(dx, dy) || 1, push = 380 + d * .5;
    scattered.push(c.animate([
      { translate: '0 0', scale: '1', opacity: 1, filter: 'blur(0)' },
      { translate: `${(dx / d) * push}px ${(dy / d) * push}px`, scale: '.86', opacity: 0, filter: 'blur(8px)' },
    ], { duration: 540, delay: Math.min(d, 900) * 0.1, easing: EASE_OUT, fill: 'both' }));
  });
}

// Numbers count to their new value instead of snapping.
export function tick(el, to) {
  if (!el) return;
  const from = parseInt(el.dataset.n || el.textContent, 10);
  el.dataset.n = to;
  if (!motionOn() || !Number.isFinite(from) || from === to) { el.textContent = to; return; }
  const t0 = performance.now(), d = 420;
  cancelAnimationFrame(el.__tick);
  const step = (t) => {
    const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) el.__tick = requestAnimationFrame(step);
  };
  el.__tick = requestAnimationFrame(step);
}

// Calm cross-fade between library views (uses the browser's View Transitions when available).
export function viewTransition(update) {
  if (motionOn() && document.startViewTransition && !document.body.classList.contains('kbd')) document.startViewTransition(update);
  else update();
}

export function initMotion() {
  glassLight();
  glassGlow();
  cardTilt();
  document.body.classList.toggle('motion', motionOn());
  reduced.addEventListener('change', () => document.body.classList.toggle('motion', motionOn()));
}
