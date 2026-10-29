// One shared hover highlight per group, after Arc's floating button group (uiarc.dev, MIT, © 2026 Elia
// Kuratli). The buttons stay transparent; a single soft surface travels under them on the morph spring.
// Appearing from nothing it lands in place and grows from 94 % (no slide from where it last was); it stays
// put while the pointer crosses a gap; leaving the group fades it; a press darkens it and settles it to
// 96.5 %. Keyboard focus (body.kbd) takes it too. One delegated listener for the whole app, so menus and
// lists that re-render with innerHTML need nothing.
// In vertical lists (the left panel, menus) it slides quickly without the spring's overshoot (styles: 12-motion.css),
// and a jump over several rows fades in at the new row instead of flying through the list — it trailed the pointer and
// swung back and forth on fast moves (user, 28.10). A list re-rendered under a still pointer keeps it (reglide).
import { motionOn } from './motion.js';

const BOX = '.dock, .capg, .menu, .ctx, .gsel-list, .tabs, .side-scroll';
const ITEM = '.ib, .mi, .chip, .nav:not(.idle), .sb';
const LIST = '.menu, .ctx, .gsel-list, .side-scroll';
let box = null, item = null, px = -1, py = -1;

function hl(b) {
  let g = b.__gl;
  if (!g) { g = document.createElement('i'); g.className = 'glide'; g.setAttribute('aria-hidden', 'true'); b.__gl = g; }
  if (g.parentNode !== b) { b.prepend(g); g.dataset.on = ''; }
  return g;
}

function place(g, b, it, appear) {
  const br = b.getBoundingClientRect(), ir = it.getBoundingClientRect();
  const x = ir.left - br.left - b.clientLeft + b.scrollLeft, y = ir.top - br.top - b.clientTop + b.scrollTop;
  const set = () => {
    g.style.translate = `${x}px ${y}px`;
    g.style.width = ir.width + 'px'; g.style.height = ir.height + 'px';
    g.style.borderRadius = getComputedStyle(it).borderRadius;
  };
  if (appear) {
    g.style.transition = 'none';
    set(); g.style.scale = '.94'; g.style.opacity = '0';
    void g.offsetWidth;
    g.style.transition = '';
    g.style.scale = '1'; g.style.opacity = '1';
  } else { set(); g.style.opacity = '1'; }
  g.dataset.on = '1';
}

function move(b, it) {
  if (box && box !== b) hide();
  const from = box === b && item && item.isConnected ? item.getBoundingClientRect() : null;
  box = b; item = it;
  const g = hl(b);
  let appear = g.dataset.on !== '1' || g.style.opacity === '0';
  if (!appear && from && b.matches(LIST)) {
    const to = it.getBoundingClientRect();
    if (Math.abs(to.top - from.top) > to.height * 2.5) appear = true; // far: fade in there, no flight
  }
  place(g, b, it, appear);
}

// after a list re-rendered (innerHTML): the highlight goes back into it, on the row now under the pointer, without
// travel or the fade-in (it blinked out and popped back on every refresh of the left panel)
export function reglide(b) {
  const g = b && b.__gl;
  if (!g) return;
  if (g.parentNode !== b) b.prepend(g);
  if (box !== b) return;
  const el = px >= 0 ? document.elementFromPoint(px, py) : null, it = el && el.closest(ITEM);
  if (it && b.contains(it) && usable(it)) { item = it; place(g, b, it, false); } else hide();
}

function hide() {
  if (box && box.__gl) { const g = box.__gl; g.style.opacity = '0'; g.dataset.on = ''; delete g.dataset.press; }
  box = null; item = null;
}

const usable = (it) => it && !it.disabled && it.getAttribute('aria-disabled') !== 'true' && it.offsetWidth > 0;

export function initGlide() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !motionOn()) return;
    const it = e.target.closest ? e.target.closest(ITEM) : null;
    const b = it ? it.closest(BOX) : e.target.closest ? e.target.closest(BOX) : null;
    if (!b) return hide();
    if (!usable(it) || !b.contains(it)) return; // a gap or a separator: stay put
    if (it !== item || b !== box) move(b, it);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', hide);
  document.addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; }, { passive: true });
  // the list scrolled or re-laid out under a still pointer: follow without travel
  document.addEventListener('scroll', (e) => { if (box && item && e.target === box && box.__gl) place(box.__gl, box, item, false); }, true);
  document.addEventListener('pointerdown', (e) => {
    if (box && box.__gl && item && item.contains(e.target)) box.__gl.dataset.press = '1';
  });
  const up = () => { if (box && box.__gl) delete box.__gl.dataset.press; };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  // keyboard: the highlight follows focus (only when the app is in keyboard mode)
  document.addEventListener('focusin', (e) => {
    if (!document.body.classList.contains('kbd') || !motionOn()) return;
    const it = e.target.closest && e.target.closest(ITEM), b = it && it.closest(BOX);
    if (b && usable(it)) move(b, it); else hide();
  });
}
