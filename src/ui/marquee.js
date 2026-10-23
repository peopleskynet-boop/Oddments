// Rubber-band selection: drag on empty space in the grid. Shift/Ctrl adds to the selection.
// Hits come from the layout boxes (grid.js), not from DOM cards, so it works across the virtual grid
// and keeps selecting while the view auto-scrolls.
import { S } from '../state.js';
import { hitRect } from './grid.js';

const MIN = 5; // px of movement before a press becomes a drag

export function initMarquee(onChange) {
  const sc = document.getElementById('scroll'), grid = document.getElementById('grid');
  let st = null, box = null, raf = 0, auto = 0, swallow = false;

  sc.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    // only on bare space: the grid itself or the scroller's padding around it
    if (e.target !== grid && e.target !== sc) return;
    if (e.target === sc && e.clientX - sc.getBoundingClientRect().left >= sc.clientWidth) return; // scrollbar
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    st = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, base: add ? new Set(S.sel) : new Set(), on: false, id: e.pointerId };
  });

  window.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    st.cx = e.clientX; st.cy = e.clientY;
    if (!st.on) {
      if (Math.hypot(st.cx - st.x, st.cy - st.y) < MIN) return;
      st.on = true;
      // anchor in grid coordinates so scrolling during the drag keeps the start point
      const r = grid.getBoundingClientRect();
      st.gx = st.x - r.left; st.gy = st.y - r.top;
      box = document.createElement('div');
      box.className = 'marquee';
      grid.appendChild(box);
      document.body.classList.add('marqueeing');
      try { sc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      tickAuto();
    }
    schedule();
  });

  const end = (e) => {
    if (!st || (e && e.pointerId !== st.id)) return;
    if (st.on) {
      swallow = true; // the click that follows must not clear the fresh selection
      setTimeout(() => { swallow = false; }, 0);
      box.remove(); box = null;
      document.body.classList.remove('marqueeing');
    }
    cancelAnimationFrame(raf); cancelAnimationFrame(auto);
    st = null;
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  sc.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); swallow = false; } }, true);
  sc.addEventListener('scroll', () => { if (st && st.on) schedule(); }, { passive: true });

  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }

  function update() {
    if (!st || !st.on) return;
    const r = grid.getBoundingClientRect();
    const x = st.cx - r.left, y = st.cy - r.top;
    const x0 = Math.min(x, st.gx), y0 = Math.min(y, st.gy), x1 = Math.max(x, st.gx), y1 = Math.max(y, st.gy);
    box.style.transform = `translate(${x0}px,${y0}px)`;
    box.style.width = x1 - x0 + 'px';
    box.style.height = y1 - y0 + 'px';
    const sel = new Set(st.base);
    for (const i of hitRect(x0, y0, x1, y1)) sel.add(S.vis[i].id);
    const changed = sel.size !== S.sel.size || [...sel].some((id) => !S.sel.has(id));
    if (changed) {
      S.sel = sel;
      const hits = hitRect(x0, y0, x1, y1);
      if (hits.length) S.last = S.vis[hits[hits.length - 1]].id;
      onChange();
    }
  }

  // scroll when the pointer is held near the top or bottom edge
  function tickAuto() {
    if (!st || !st.on) return;
    const r = sc.getBoundingClientRect(), edge = 60;
    let v = 0;
    if (st.cy < r.top + edge) v = -Math.ceil((r.top + edge - st.cy) / 4);
    else if (st.cy > r.bottom - edge) v = Math.ceil((st.cy - (r.bottom - edge)) / 4);
    if (v) { sc.scrollTop += Math.max(-40, Math.min(40, v)); update(); }
    auto = requestAnimationFrame(tickAuto);
  }
}
