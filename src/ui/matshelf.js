// The 3D section's material shelf: in «Модели», a row of the library's materials above the grid. A material dragged
// onto a model card opens that model wearing it (preview → viewer3d `opts.wear`); inside the viewer the materials
// of the M panel go onto the part under the pointer the same way. «+ Из текстур…» makes a new one.
import { S } from '../state.js';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, absPath } from '../lib/library.js';

export const MAT_TYPE = 'text/x-perch-mat';
let el = null, sig = '';

const inModels = () => S.view.type === 'kind' && S.view.id === 'model';

export function renderShelf() {
  if (!el) return;
  const mats = inModels() ? S.items.filter((i) => i.kind === 'material' && !i.trashed) : [];
  el.hidden = !inModels();
  if (el.hidden) { sig = ''; return; }
  const s = mats.map((m) => m.id + (m.thumb || '')).join('|');
  if (s === sig) return;
  sig = s;
  el.innerHTML = `<span class="ms-h">${ic('sphere')}<b>Материалы</b><small>${mats.length ? 'перетащите на модель' : 'пока нет'}</small></span>` +
    `<div class="ms-row">${mats.map((m) => `<button type="button" class="ms-t" draggable="true" data-mat="${m.id}" title="${esc(m.name)} — перетащите на модель"><img src="${m.thumb ? assetUrl(m.thumb) : ''}" alt="" draggable="false"><span>${esc(m.name)}</span></button>`).join('')}` +
    `<button type="button" class="ms-add" data-act="mat-new" title="Материал из набора текстур (Poly Haven, ambientCG, Substance)">${ic('plus')}<span>Из текстур…</span></button></div>` +
    (mats.length ? `<button type="button" class="pill ghost ms-bl" data-act="mat-blender" title="Все материалы — в открытый файл Blender, в Asset Browser (аддон Oddments 1.6)">${ic('external')}<span>Все в Blender</span></button>` : '');
}

export function initShelf() {
  el = document.getElementById('matShelf');
  const grid = document.getElementById('grid');
  if (!el || !grid) return;
  el.addEventListener('dragstart', (e) => {
    const t = e.target.closest('[data-mat]');
    if (!t) return;
    e.dataTransfer.setData(MAT_TYPE, t.dataset.mat);
    e.dataTransfer.setData('text/x-perch', '[]'); // ours, not a file from outside
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('mat-drag');
  });
  el.addEventListener('dragend', () => { document.body.classList.remove('mat-drag'); grid.querySelectorAll('.mat-over').forEach((c) => c.classList.remove('mat-over')); });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="mat-new"]')) import('./materials.js').then((m) => m.pickTextures());
    // the whole set into the open .blend as assets (add-on 1.6 adds a set without putting it on the selection)
    if (e.target.closest('[data-act="mat-blender"]')) {
      const mats = S.items.filter((i) => i.kind === 'material' && !i.trashed);
      import('./toblender.js').then((m) => m.toBlender(mats.map((i) => absPath(i.file)), `Материалы (${mats.length})`));
    }
    const t = e.target.closest('[data-mat]');
    if (t) import('./preview.js').then((m) => m.openPreview(t.dataset.mat));
  });
  // onto a model card
  const cardOf = (e) => {
    const c = e.target.closest && e.target.closest('.card');
    const it = c && S.byId.get(c.id.replace(/^c-/, ''));
    return it && it.kind === 'model' && !(it.ext === 'blend' && !it.glb) && it.ext !== 'abc' ? { c, it } : null;
  };
  let over = null;
  grid.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types).includes(MAT_TYPE)) return;
    const hit = cardOf(e);
    if (over && (!hit || hit.c !== over)) { over.classList.remove('mat-over'); over = null; }
    if (!hit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (over !== hit.c) { over = hit.c; over.classList.add('mat-over'); }
  });
  grid.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(MAT_TYPE);
    if (!id) return;
    const hit = cardOf(e);
    if (over) { over.classList.remove('mat-over'); over = null; }
    document.body.classList.remove('mat-drag');
    if (!hit) return;
    e.preventDefault();
    import('./preview.js').then((m) => m.openPreview(hit.it.id, { wear: id }));
  });
}
