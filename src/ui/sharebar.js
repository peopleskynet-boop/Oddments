// A shared link's visitor (lib/lite.js SHARE; «Поделиться ссылкой», lib/share.js): a strip at the bottom says what this
// is — the collection's name, how many files, the note it was sent with — and offers the files as one zip; Oddments is
// named at its end. Nothing here writes anywhere.
import './sharebar.css';
import { S } from '../state.js';
import { $, esc, plural } from '../util.js';
import { ic } from './icons.js';
import { SHARE } from '../lib/lite.js';

export async function mountShareBar() {
  let meta = null;
  try { const r = await fetch(SHARE + 'share.json', { cache: 'no-cache' }); if (r.ok) meta = await r.json(); } catch (e) { /* the bar says it below */ }
  const items = S.items.filter((i) => !i.trashed);
  const title = (meta && meta.title) || 'Подборка';
  document.title = `${title} · Oddments`;
  const label = $('#libLabel');
  if (label) { label.textContent = title; label.title = title; }
  const el = document.createElement('div');
  el.className = 'shb glass';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Подборка по ссылке');
  if (!meta && !items.length) {
    el.innerHTML = '<div class="shb-t"><b>Ссылка больше не работает</b><span>Её закрыли или вышел её срок. Попросите прислать новую.</span></div>';
  } else {
    const note = meta && meta.note ? `<span class="shb-note">${esc(meta.note)}</span>` : '';
    el.innerHTML = `<div class="shb-t"><b>${esc(title)}</b><span>${items.length} ${plural(items.length, ['файл', 'файла', 'файлов'])}</span>${note}</div>`
      + `<button type="button" class="ibtn pri shb-dl" title="Все файлы подборки одним zip-архивом">${ic('download')}<span>Скачать всё</span></button>`
      + `<a class="shb-odd" href="https://github.com/peopleskynet-boop/Oddments" target="_blank" rel="noopener" title="Oddments — приложение для референсов">Сделано в Oddments</a>`;
    el.querySelector('.shb-dl').addEventListener('click', () => import('../lib/exporter.js').then((m) => m.runExport(S.items.filter((i) => !i.trashed), title, true)));
  }
  document.body.appendChild(el);
}
