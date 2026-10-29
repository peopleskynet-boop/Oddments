// «Лицензии» (Settings › О программе): Oddments' own licence and THIRD_PARTY_NOTICES.md — every library, model and
// program it is built with, and their full texts (each folded under its package). The files load only when the sheet
// opens. A layer of its own (layers.js): Esc or the cross closes it.
import './licenses.css';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { pushLayer, popLayer } from './layers.js';
import { sfx } from './sound.js';

let el = null, back = null;

// the little Markdown the notices use: headings, tables, lists, **bold**, `code`, fenced texts (folded under the
// heading above them)
function render(md) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>'); // \x60: a backquote, so tools/i18n_missing.py reads the file right
  const out = [];
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let head = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const body = [];
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i]);
      out.push(`<details class="lc-txt"><summary>${inline(head || 'Текст лицензии')}</summary><pre>${esc(body.join('\n'))}</pre></details>`);
      head = '';
    } else if (/^### /.test(l)) { head = l.slice(4); }
    else if (/^#{1,2} /.test(l)) out.push(`<h3>${inline(l.replace(/^#+ /, ''))}</h3>`);
    else if (/^\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim()));
      i--;
      out.push(`<div class="lc-tw"><table>${rows.map((r, n) => `<tr>${r.map((c) => (n ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table></div>`);
    } else if (/^- /.test(l)) {
      const items = [];
      for (; i < lines.length && /^(- |  )/.test(lines[i]); i++) { if (/^- /.test(lines[i])) items.push(lines[i].slice(2)); else items[items.length - 1] += ' ' + lines[i].trim(); }
      i--;
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (l.trim() && !/^<!--/.test(l)) {
      let p = l;
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||- |\x60{3})/.test(lines[i + 1])) p += ' ' + lines[++i];
      out.push(`<p>${inline(p)}</p>`);
    }
  }
  return out.join('');
}

export async function openLicenses() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'lc glass';
    el.hidden = true;
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Лицензии');
    el.innerHTML = `<div class="lc-h"><h2>Лицензии</h2><button type="button" class="ib" data-lc="x" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></div><div class="lc-b">Загружаю…</div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target.closest('[data-lc="x"]')) closeLicenses(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLicenses(); } });
    const [own, notes] = await Promise.all([import('../../LICENSE?raw'), import('../../THIRD_PARTY_NOTICES.md?raw')]);
    el.querySelector('.lc-b').innerHTML = `<h3>Oddments — MIT</h3><pre class="lc-own">${esc(own.default.trim())}</pre>` + render(notes.default);
  }
  if (!el.hidden) return;
  back = document.activeElement;
  el.hidden = false;
  sfx('open');
  pushLayer({ el, title: 'Лицензии', close: closeLicenses });
  el.focus({ preventScroll: true });
}

export function closeLicenses() {
  if (!el || el.hidden) return;
  el.hidden = true;
  sfx('close');
  popLayer(el);
  if (back && back.isConnected) back.focus({ preventScroll: true });
}
