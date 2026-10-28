// The comments of a picture in the properties panel (notes.js is the «Разметка» layer itself — loaded when opened).
import { esc } from '../util.js';

export const notesOf = (x) => (Array.isArray(x && x.notes) ? x.notes : []);
const when = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

// a short list, «Разметка» opens the layer
export function notesBlock(item) {
  const list = notesOf(item);
  if (item.trashed || !(item.kind === 'image' || item.kind === 'psd' || item.kind === 'gif' || item.thumb)) return '';
  return `<div class="fld nts-blk"><span class="row-h">Комментарии${list.length ? ` · ${list.length}` : ''}<span><button class="lnk" data-act="notes">${list.length ? 'Разметка →' : '+ Комментарий'}</button></span></span>` +
    (list.length ? `<ol class="nts-mini">${list.slice(0, 4).map((n) => `<li><p>${esc(n.text)}</p><small>${esc(n.by || '')} · ${when(n.t)}</small></li>`).join('')}${list.length > 4 ? `<li class="more">ещё ${list.length - 4}</li>` : ''}</ol>` : '') + '</div>';
}
