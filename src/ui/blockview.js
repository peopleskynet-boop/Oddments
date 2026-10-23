// The preview of a block of a page (.oddblock, lib/block.js): «Снимок» — the shot, zoomable like a picture;
// «Живой» — the block's own markup in a frame without scripts, pointing at a part shows its font, size, colours and
// spacing, a click copies that part's styles; «Код» — the markup, «Копировать HTML». Under it: the site, the kind,
// the size, the fonts and colours of the block.
import './blockview.css';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { assetUrl } from '../lib/library.js';
import { readBlock, safeHtml } from '../lib/block.js';
import { toast } from './dialogs.js';
import { openUrl } from '@tauri-apps/plugin-opener';

const MODE_KEY = 'perch.blockMode';
const getMode = () => { try { return localStorage.getItem(MODE_KEY) || 'shot'; } catch (e) { return 'shot'; } };
const setMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* private window */ } };
const copy = (text, what) => navigator.clipboard.writeText(text).then(() => toast(what + ' — в буфере'), () => toast('Не удалось скопировать'));
const hex = (c) => {
  const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (!m) return '';
  if (m[4] !== undefined && +m[4] < 0.05) return '';
  return '#' + [m[1], m[2], m[3]].map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('');
};

export async function mountBlock(holder, it, zoomImage) {
  const buf = await (await fetch(assetUrl(it.file))).arrayBuffer();
  const b = readBlock(new Uint8Array(buf));
  const meta = b.meta || {};
  const shotUrl = b.shot ? URL.createObjectURL(b.shot) : '';
  holder.innerHTML = '';
  holder.classList.add('bv-host');
  const fonts = (meta.fonts || []).slice(0, 4).map((f) => `<span class="bv-chip" title="${esc(`${f.family} · ${f.weight} · ${f.size} px`)}">${esc(f.family)} <em>${f.weight} · ${f.size}</em></span>`).join('');
  const colors = (meta.colors || []).filter((c) => c.hex).slice(0, 8).map((c) => `<button type="button" class="bv-sw" data-hex="${esc(c.hex)}" style="--c:${esc(c.hex)}" title="${esc(c.role || '')} ${esc(c.hex)} — копировать"></button>`).join('');
  holder.insertAdjacentHTML('beforeend', `<div class="bv">
    <div class="bv-tabs glass" role="tablist" aria-label="Вид блока">
      <button type="button" role="tab" data-bm="shot">Снимок</button><button type="button" role="tab" data-bm="live">Живой</button><button type="button" role="tab" data-bm="code">Код</button>
    </div>
    <div class="bv-body"></div>
    <div class="bv-info">
      ${meta.url ? `<button type="button" class="bv-site" data-bv="site" title="${esc(meta.url)}">${ic('external')}<span>${esc(meta.site || 'Страница')}</span></button>` : ''}
      <span class="bv-meta">${esc(meta.kind || 'Блок')}${meta.w ? ` · ${meta.w} × ${meta.h}` : ''}${meta.truncated ? ' · снимок обрезан' : ''}</span>
      ${fonts}${colors ? `<span class="bv-sws">${colors}</span>` : ''}
      <button type="button" class="pill ghost bv-copy" data-bv="html">Копировать HTML</button>
    </div>
  </div>`);
  const root = holder.querySelector('.bv');
  let mode = getMode(), body = root.querySelector('.bv-body'), live = null;

  function freshBody() {
    const nb = document.createElement('div');
    nb.className = 'bv-body';
    body.replaceWith(nb);
    body = nb;
  }
  async function show(m) {
    mode = m; setMode(m);
    root.querySelectorAll('[data-bm]').forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.bm === m)); t.classList.toggle('on', t.dataset.bm === m); });
    freshBody();
    live = null;
    if (m === 'shot') {
      if (shotUrl) zoomImage(body, shotUrl); else body.innerHTML = '<p class="bv-none">В файле нет снимка</p>';
    } else if (m === 'live') {
      await liveView();
    } else {
      body.innerHTML = '<pre class="bv-code"></pre>';
      // fonts and pictures inside the file are base64 walls: shown as «data:…» (the copy is the whole thing)
      const short = b.html.replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=]{40,}/g, 'data:…');
      const src = short.length > 300000 ? short.slice(0, 300000) + '\n…' : short;
      body.querySelector('pre').textContent = src.replace(/></g, '>\n<');
    }
  }

  async function liveView() {
    if (!b.html) { body.innerHTML = '<p class="bv-none">В файле нет кода блока</p>'; return; }
    const w = meta.w || 800;
    body.innerHTML = `<div class="bv-live"><div class="bv-wrap"><iframe class="bv-frame" sandbox="allow-same-origin" title="Блок ${esc(meta.kind || '')}"></iframe>
      <div class="bv-hl"></div></div><div class="bv-tip" role="status"></div></div>`;
    const box = body.querySelector('.bv-live'), wrap = box.querySelector('.bv-wrap'), frame = wrap.querySelector('iframe');
    const hl = wrap.querySelector('.bv-hl'), tip = box.querySelector('.bv-tip');
    const my = live = {};
    frame.srcdoc = await safeHtml(b.html);
    await new Promise((r) => { frame.onload = r; });
    if (live !== my) return;
    const doc = frame.contentDocument;
    const h = Math.max(meta.h || 0, doc.documentElement.scrollHeight);
    // fitted to the width of the window; a tall block scrolls
    const fit = () => {
      const s = Math.min(1, (box.clientWidth - 32) / w);
      frame.style.width = w + 'px'; frame.style.height = h + 'px';
      frame.style.transform = `scale(${s})`;
      wrap.style.width = w * s + 'px'; wrap.style.height = h * s + 'px';
      return s;
    };
    let s = fit();
    const ro = new ResizeObserver(() => { s = fit(); });
    ro.observe(box);
    my.stop = () => ro.disconnect();
    let cur = null;
    doc.addEventListener('mousemove', (e) => {
      const el = e.target;
      if (!el || el === doc.documentElement || el === doc.body || el === cur) return;
      cur = el;
      const r = el.getBoundingClientRect(), cs = frame.contentWindow.getComputedStyle(el);
      Object.assign(hl.style, { left: r.left * s + 'px', top: r.top * s + 'px', width: r.width * s + 'px', height: r.height * s + 'px', opacity: 1 });
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '');
      const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => Math.round(parseFloat(v))).join(' ');
      const bg = hex(cs.backgroundColor), fg = hex(cs.color);
      tip.innerHTML = `<b>${esc(el.localName)}</b> <span>${Math.round(r.width)} × ${Math.round(r.height)}</span>`
        + `<span>${esc(fam)} ${cs.fontWeight} · ${Math.round(parseFloat(cs.fontSize))}/${cs.lineHeight === 'normal' ? 'auto' : Math.round(parseFloat(cs.lineHeight))}</span>`
        + (fg ? `<span><i style="--c:${fg}"></i>${fg}</span>` : '') + (bg ? `<span><i style="--c:${bg}"></i>фон ${bg}</span>` : '')
        + (pad !== '0 0 0 0' ? `<span>отступы ${pad}</span>` : '') + (parseFloat(cs.borderTopLeftRadius) ? `<span>радиус ${Math.round(parseFloat(cs.borderTopLeftRadius))}</span>` : '')
        + '<small>клик — копировать стили</small>';
      tip.classList.add('on');
    });
    doc.addEventListener('mouseleave', () => { cur = null; hl.style.opacity = 0; tip.classList.remove('on'); });
    doc.addEventListener('click', (e) => {
      e.preventDefault();
      const el = e.target;
      if (el && el.getAttribute) copy((el.getAttribute('style') || '').split(';').filter(Boolean).join(';\n') + ';', 'Стили элемента');
    }, true);
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-bm]');
    if (t) { if (t.dataset.bm !== mode) show(t.dataset.bm); return; }
    const a = e.target.closest('[data-bv], [data-hex]');
    if (!a) return;
    if (a.dataset.hex) copy(a.dataset.hex, a.dataset.hex);
    else if (a.dataset.bv === 'html') copy(b.html, 'HTML блока');
    else if (a.dataset.bv === 'site') openUrl(meta.url).catch(() => window.open(meta.url, '_blank'));
  });
  await show(mode);
  return () => { if (live && live.stop) live.stop(); live = null; if (shotUrl) URL.revokeObjectURL(shotUrl); };
}
