// One centre for the full-screen layers over the wall: the preview, the feed, the news, the plugins, the icon
// constructor, the 3D workshop, a flow's review and storyboard. A stack: the top layer gets the keys first — also when
// focus fell out of it onto the page body (bug #126) — Esc closes only the top one, and everything under it is inert:
// no hover, no clicks, no Tab (bug #111). The window strip over the layers shows the top one's title (main.js).
//
// pushLayer({ el, title, close, onKey }) when a layer opens, popLayer(el) when it closes; both are idempotent.
//   el     the layer's root element (a child of body)
//   close  closes the layer (Esc when onKey did not take it, the window strip's ×)
//   onKey  optional: called for keys whose target is outside el (inside el the layer's own listeners run)
const stack = [];
const subs = new Set();
let inerted = [];

export const topLayer = () => stack[stack.length - 1] || null;
export const layerOpen = () => stack.length > 0;
export const onLayers = (fn) => { subs.add(fn); return () => subs.delete(fn); };

// the wall and everything a lower layer owns stay in the page but take no pointer, keys or focus
function sync() {
  inerted.forEach((n) => { n.inert = false; });
  inerted = [];
  const top = topLayer();
  if (top) {
    const app = document.getElementById('app');
    const under = [...(app ? app.children : []), document.getElementById('settings'), ...stack.slice(0, -1).map((l) => l.el)];
    for (const n of under) {
      if (!n || n === top.el || n.id === 'winbar' || n.contains(top.el) || n.inert) continue;
      n.inert = true;
      inerted.push(n);
    }
  }
  document.body.classList.toggle('layer-up', !!top);
  subs.forEach((fn) => fn(top));
}

export function pushLayer(layer) {
  const i = stack.findIndex((l) => l.el === layer.el);
  if (i >= 0) stack.splice(i, 1);
  stack.push(layer);
  sync();
}

export function popLayer(el) {
  const i = stack.findIndex((l) => l.el === el);
  if (i < 0) return;
  stack.splice(i, 1);
  sync();
}

// keys that land outside the top layer (on body, or on something it left behind) are the top layer's
document.addEventListener('keydown', (e) => {
  const top = topLayer();
  if (!top || top.el.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.ctx, .ctx-sub, .gsel-list, .modal, .cmdk, .keys, #toast')) return; // popups over the layer
  if (top.onKey) top.onKey(e);
  if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); top.close(); }
  e.stopPropagation(); // the wall's shortcuts stay off under a layer
}, true);

// Esc inside a layer that does not handle it itself
window.addEventListener('keydown', (e) => {
  const top = topLayer();
  if (top && e.key === 'Escape' && !e.defaultPrevented && top.el.contains(e.target)) { e.preventDefault(); top.close(); }
});
