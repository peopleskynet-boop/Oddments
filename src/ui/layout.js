// Pure layout maths for the virtualised grid (no DOM) so it can be unit-tested.
// items: [{ar}] — ar = height / width. Returns { boxes: [{x,y,w,h}], height, cols }.
export function computeLayout(items, width, cw, gap, capH, mode) {
  // the chosen size is the smallest a card gets: as many columns as fit, stretched to fill the width,
  // so no strip narrower than a column is left empty on the right of a wide window
  const cols = Math.max(1, Math.floor((width + gap) / (cw + gap)));
  const colW = Math.max(1, (width - (cols - 1) * gap) / cols);
  const x0 = 0;
  const boxes = new Array(items.length);
  if (mode === 'grid') {
    const h = colW + capH;
    for (let i = 0; i < items.length; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      boxes[i] = { x: x0 + c * (colW + gap), y: r * (h + gap), w: colW, h };
    }
    const rows = Math.ceil(items.length / cols);
    return { boxes, height: rows ? rows * (h + gap) - gap : 0, cols, colW };
  }
  const ys = new Array(cols).fill(0);
  for (let i = 0; i < items.length; i++) {
    let c = 0;
    for (let k = 1; k < cols; k++) if (ys[k] < ys[c]) c = k;
    const ar = Math.min(4, Math.max(0.2, items[i].ar || 0.75));
    const h = colW * ar + capH;
    boxes[i] = { x: x0 + c * (colW + gap), y: ys[c], w: colW, h };
    ys[c] += h + gap;
  }
  return { boxes, height: Math.max(0, Math.max(...ys) - gap), cols, colW };
}

// Indices of boxes intersecting [top, bottom].
export function visibleRange(boxes, top, bottom) {
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.y + b.h >= top && b.y <= bottom) out.push(i);
  }
  return out;
}
