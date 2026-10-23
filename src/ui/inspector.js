import { S, ui, KINDS, flatFolders, folderById, activeItems } from '../state.js';
import { $, esc, fmtSize, fmtDur, plural, dateFmt, hexRGB, toHex, inkOn, isMac } from '../util.js';
import { ic } from './icons.js';
import { enhanceAll } from './gselect.js';
import { assetUrl, saveIndex, trashItems, restoreItems, purgeItems, absPath, cleanName } from '../lib/library.js';
import { viewTitle, setView } from '../lib/filter.js';
import { similarTo } from '../lib/similar.js';
import { scrollToItem } from './grid.js';
import { ensureFont, fontFamily } from '../lib/fonts.js';
import { openPreview } from './preview.js';
import { toast, arm } from './dialogs.js';
import { bindDragOut } from '../lib/dragout.js';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

const fmtNum = (n) => Math.round(n).toLocaleString('ru');
const selItems = () => Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean);

function allTags() {
  const m = new Map();
  activeItems().forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export function renderInsp() {
  const el = $('#insp');
  const items = selItems();
  if (!items.length) el.innerHTML = overview();
  else if (items.length === 1) {
    el.innerHTML = single(items[0]); afterSingle(items[0]);
    const it = items[0];
    (window.requestIdleCallback || ((f) => setTimeout(f, 30)))(() => fillSimilar(it), { timeout: 200 });
  }
  else el.innerHTML = multi(items);
  enhanceAll(el);
  const key = items.map((i) => i.id).join(',');
  // a new selection starts at the top: name and preview first, not the fields the last file was scrolled to
  if (key !== lastKey) { el.scrollTop = 0; el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); lastKey = key; }
}
let lastKey = null;

function overview() {
  const total = S.vis.reduce((s, i) => s + i.size, 0);
  const m = new Map();
  S.vis.forEach((i) => i.colors.slice(0, 3).forEach((c) => {
    const [r, g, b] = hexRGB(c);
    const k = toHex((r >> 4) * 17, (g >> 4) * 17, (b >> 4) * 17);
    m.set(k, (m.get(k) || 0) + 1);
  }));
  const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => e[0]);
  return `<h2 class="ov-h">${esc(viewTitle())}</h2><p class="ov-s">${S.vis.length} ${plural(S.vis.length, ['файл', 'файла', 'файлов'])} · ${fmtSize(total)}</p>` +
    (top.length ? `<span class="sec">Цвета здесь · клик — фильтр</span><div class="pal wrap">${top.map((c) => `<button data-ovc="${c}" style="background:${c}" aria-label="Фильтр по цвету ${c}"></button>`).join('')}</div>` : '') +
    `<details class="hint"><summary>Как добавлять и клавиши</summary><p>Ctrl+V — картинка из буфера (браузер, скриншот, файлы из Проводника; из Figma — Ctrl+Shift+C). Или перетащите файлы в окно.</p><p><kbd>/</kbd> поиск · <kbd>Ctrl</kbd>+<kbd>A</kbd> всё · <kbd>Пробел</kbd> просмотр · <kbd>F</kbd> избранное · <kbd>Del</kbd> в корзину · <kbd>[</kbd> <kbd>]</kbd> панели · стрелки — по сетке · <kbd>?</kbd> все клавиши</p></details>`;
}

// the file's collections as chips (× takes it out), the rest behind one «+ В подборку» list: a long column of
// checkboxes for every collection in the library made the panel three screens tall
function folderChips(it) {
  const fl = flatFolders();
  if (!fl.length) return '<div class="none">Сначала создайте подборку слева</div>';
  const mine = fl.filter((x) => it.folders.includes(x.f.id));
  const rest = fl.filter((x) => !it.folders.includes(x.f.id));
  return `<div class="tags fchips">${mine.map((x) => `<span class="tag">${esc(x.f.name)}<button data-rmf="${x.f.id}" aria-label="Убрать из подборки ${esc(x.f.name)}">${ic('x')}</button></span>`).join('')}` +
    (rest.length ? `<select id="fAdd" aria-label="Добавить в подборку"><option value="">+ В подборку</option>${rest.map((x) => `<option value="${x.f.id}">${'— '.repeat(x.d)}${esc(x.f.name)}</option>`).join('')}</select>` : '') + '</div>';
}

function mediaBlock(it) {
  switch (it.kind) {
    case 'image': return `<div class="ip-prev" data-act="pv"><img src="${assetUrl(it.thumb || it.file)}" alt=""></div>`;
    case 'gif': return `<div class="ip-prev" data-act="pv"><img src="${assetUrl(it.file)}" alt=""></div>`;
    case 'video': return `<div class="ip-prev"><video controls preload="metadata" ${it.thumb ? `poster="${assetUrl(it.thumb)}"` : ''} src="${assetUrl(it.file)}"></video></div>`;
    case 'audio': return `<div class="ip-prev nobg">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : ''}<audio controls preload="metadata" src="${assetUrl(it.file)}"></audio></div>`;
    case 'font': return `<div class="ip-prev font" data-act="pv"><div class="fsample" id="fsample" style="font-family:'${fontFamily(it)}'">Aa Бб Яя<br>0123456789</div></div>`;
    case 'pdf': case 'psd': case 'model': case 'material': case 'link': case 'figma': return it.thumb ? `<div class="ip-prev" data-act="pv"><img src="${assetUrl(it.thumb)}" alt=""></div>` : `<div class="ip-prev file">${esc(it.ext)}</div>`;
    default: return `<div class="ip-prev file">${esc(it.ext || 'file')}</div>`;
  }
}

// «Похожие» for the panel: computed after the panel is on screen (fillSimilar)
function simHtml(it) {
  const sim = similarTo(it, S.items, 8);
  return sim.length ? `<div class="fld"><span class="row-h">Похожие<span><button class="lnk" data-act="allsim">Все →</button></span></span><div class="sim">${sim.map((x) => `<button data-sim="${x.id}" title="${esc(x.name)}">${x.thumb ? `<img src="${assetUrl(x.thumb)}" alt="" decoding="async">` : `<b>${esc((x.ext || x.kind).toUpperCase())}</b>`}</button>`).join('')}</div></div>` : '';
}
function fillSimilar(it) {
  const slot = document.querySelector(`#insp .sim-slot[data-simfor="${CSS.escape(it.id)}"]`);
  if (slot) slot.outerHTML = simHtml(it);
}

function single(it) {
  const tags = it.tags.map((t) => `<span class="tag">${esc(t)}<button data-rmtag="${esc(t)}" aria-label="Убрать тег ${esc(t)}">${ic('x')}</button></span>`).join('') +
    // AI tags (aitags.js): dimmer, with ✦; a click pins one as an ordinary tag, × drops it for good
    (it.aiTags || []).map((t) => `<span class="tag ai" title="Тег от ИИ. Нажмите, чтобы закрепить"><button class="pin" data-aipin="${esc(t)}">✦ ${esc(t)}</button><button data-aino="${esc(t)}" aria-label="Убрать тег ИИ ${esc(t)}">${ic('x')}</button></span>`).join('');
  const dl = allTags().filter((t) => !it.tags.includes(t[0])).map((t) => `<option value="${esc(t[0])}">`).join('');
  // the palette (#79): a click on a colour finds it in the library, its HEX copies; the strip under it shows how much
  // of the picture each colour takes (older files get shares in the background, repalette.js)
  const shares = it.shares && it.shares.length === it.colors.length ? it.shares : null;
  const pal = it.colors.length ? `<div class="fld"><span>Палитра</span><div class="pal">${it.colors.map((c) => `<div class="sw" style="background:${c}"><button class="sw-find" data-findc="${c}" title="Найти этот цвет в библиотеке" aria-label="Найти цвет ${c.toUpperCase()}"></button><button class="sw-hex" data-hex="${c}" title="Копировать ${c.toUpperCase()}" aria-label="Копировать ${c}" style="color:${inkOn(c)}">${c.slice(1).toUpperCase()}</button></div>`).join('')}</div>`
    + (shares ? `<div class="pal-bar" aria-hidden="true">${it.colors.map((c, i) => `<i style="background:${c};flex:${Math.max(shares[i], 0.02)}"></i>`).join('')}</div>` : '') + '</div>' : '';
  // «Похожие» looks through the whole library (8 ms on 5 000 files): drawn a moment later (fillSimilar), so a click
  // on a card shows the panel at once
  const simBlock = it.trashed ? '' : `<div class="sim-slot" data-simfor="${it.id}"></div>`;
  const actions = it.trashed
    ? `<div class="acts-row"><button class="ibtn" data-act="restore">${ic('restore')}Вернуть</button><button class="ibtn danger" data-act="purge">Удалить навсегда</button></div>`
    : `<div class="acts-row">${it.kind === 'model' && BLENDER_NATIVE.has(it.ext) ? '' : `<button class="ibtn" data-act="open">${esc(openLabel(it))}</button>`}<button class="ibtn" data-act="reveal">В папке</button><button class="ibtn danger" data-act="trash">В корзину</button></div>`;
  return mediaBlock(it) +
    `<input id="nameIn" class="title-in" type="text" value="${esc(it.name)}" aria-label="Название" title="Нажмите, чтобы переименовать">` +
    // type, size, weight, length and date in one line under the name (the old table repeated half of it)
    `<p class="ov-s sub">${[esc((it.ext || it.kind).toUpperCase()), it.w && it.kind !== 'model' && it.kind !== 'material' ? `${Math.round(it.w)} × ${Math.round(it.h)}` : '', it.pages ? `${it.pages} стр.` : '', it.duration ? fmtDur(it.duration) : '', fmtSize(it.size), esc(dateFmt.format(it.added))].filter(Boolean).join(' · ')}</p>` +
    (it.kind === 'model' && !it.trashed ? modelBlock(it) : '') +
    (it.ext === 'svg' && !it.trashed ? `<div class="m-blk"><button class="ibtn pri wide" data-act="s3d">${ic('cube')}Сделать 3D…</button></div>` : '') +
    `<div class="fld"><span>Теги</span><div class="tags">${tags}<input id="tagIn" type="text" placeholder="Тег и Enter" list="taglist" autocomplete="off"></div><datalist id="taglist">${dl}</datalist></div>` +
    (it.aiDesc ? `<p class="ai-desc" title="Так эту картинку видит ИИ — по этим словам её найдёт поиск">✦ ${esc(it.aiDesc)}</p>` : '') +
    pal +
    `<div class="fld"><span>Подборки</span>${folderChips(it)}</div>` +
    // the source: a field only when there is a link (or one is being added) — an empty «https://» box was noise; the
    // notes field is gone (#78: unused); `it.note` stays in index.json
    (it.url ? `<label class="fld"><span>Источник</span><input id="urlIn" type="text" value="${esc(it.url)}" placeholder="https://"></label>`
      : `<div class="fld"><button class="lnk add-url" data-act="addurl">+ Ссылка на источник</button></div>`) +
    simBlock + actions;
}

const BLENDER_NATIVE = new Set(['blend', 'abc']);
const openLabel = (it) => (BLENDER_NATIVE.has(it.ext) ? 'Открыть в Blender' : it.ext === 'psd' || it.ext === 'psb' ? 'Открыть в Photoshop' : 'Открыть');

// 3D comes first for a model: its topology right under the name, and the way into Blender as the main action.
// .blend / .abc open in Blender itself; other formats go in through the add-on, which takes what is selected here.
function modelBlock(it) {
  const stats = it.verts
    ? `<div class="m-stats"><div><b>${fmtNum(it.verts)}</b><span>${plural(it.verts, ['вершина', 'вершины', 'вершин'])}</span></div><div><b>${fmtNum(it.tris || 0)}</b><span>${plural(it.tris || 0, ['треугольник', 'треугольника', 'треугольников'])}</span></div></div>`
    : '';
  const go = BLENDER_NATIVE.has(it.ext)
    ? `<button class="ibtn pri wide" data-act="open">${ic('cube')}Открыть в Blender</button>`
    : `<div class="m-acts"><button class="ibtn pri" data-act="pv">${ic('cube')}Смотреть</button>` +
      `<button class="ibtn" data-act="toblender" title="Как вставить модель в сцену Blender">В Blender</button></div>` +
      (isMac ? '' : `<button class="ibtn wide flat" data-act="s3d" title="Квадовая сетка через AutoRemesher">Ремеш…</button>`);
  return `<div class="m-blk">${stats}${go}</div>`;
}

function afterSingle(it) { if (it.kind === 'font') ensureFont(it); }

function multi(items) {
  const total = items.reduce((s, i) => s + i.size, 0);
  const trashed = items.every((i) => i.trashed);
  const opts = '<option value="">Добавить в подборку…</option>' + flatFolders().map((x) => `<option value="${x.f.id}">${'— '.repeat(x.d)}${esc(x.f.name)}</option>`).join('');
  return `<h2 class="ov-h">Выбрано: ${items.length}</h2><p class="ov-s">${fmtSize(total)}</p>` +
    (trashed
      ? `<div class="acts-row"><button class="ibtn" data-act="restore">${ic('restore')}Вернуть</button><button class="ibtn danger" data-act="purge">Удалить навсегда</button></div>`
      : `<div class="fld"><span>Добавить тег всем</span><div class="tags"><input id="tagInM" type="text" placeholder="Тег и Enter" autocomplete="off"></div></div>` +
        `<div class="fld"><span>Подборка</span><select id="folderM">${opts}</select></div>` +
        `<div class="acts-row"><button class="ibtn danger" data-act="trash">${ic('trash')}В корзину</button></div>`);
}

function addTags(items, raw) {
  const tags = raw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
  items.forEach((it) => tags.forEach((t) => { if (!it.tags.includes(t)) it.tags.push(t); }));
  saveIndex();
}

export function initInspector() {
  const insp = $('#insp');
  // the panel's picture drags the selected files out into other programs (PureRef, Blender, Figma, Explorer)
  bindDragOut(insp, '.ip-prev img, .ip-prev .fsample', selItems, () => toast('Перетаскивание в другие программы — в приложении Oddments'));
  let noteTimer;

  insp.addEventListener('click', async (e) => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-rmtag]'))) {
      const it = selItems()[0]; it.tags = it.tags.filter((x) => x !== b.dataset.rmtag); saveIndex(); ui.refresh(); return;
    }
    if ((b = t.closest('[data-aipin]'))) {
      const it = selItems()[0], w = b.dataset.aipin;
      it.aiTags = (it.aiTags || []).filter((x) => x !== w); if (!it.tags.includes(w)) it.tags.push(w); saveIndex(); ui.refresh(); return;
    }
    if ((b = t.closest('[data-aino]'))) {
      const it = selItems()[0], w = b.dataset.aino;
      it.aiTags = (it.aiTags || []).filter((x) => x !== w); it.aiNo = [...new Set([...(it.aiNo || []), w])]; saveIndex(); ui.refresh(); return;
    }
    if ((b = t.closest('[data-rmf]'))) {
      const it = selItems()[0]; it.folders = it.folders.filter((x) => x !== b.dataset.rmf); saveIndex(); ui.refresh(); return;
    }
    if ((b = t.closest('[data-hex]'))) {
      try { await writeText(b.dataset.hex); toast('Скопировано ' + b.dataset.hex); } catch (err) { toast(b.dataset.hex); }
      return;
    }
    if ((b = t.closest('[data-findc]'))) { S.color = b.dataset.findc; S.sel.clear(); ui.refresh(); toast('Ищу по цвету ' + b.dataset.findc.toUpperCase(), 3000, { label: 'Сбросить', fn: () => { S.color = null; ui.refresh(); } }); return; }
    if ((b = t.closest('[data-ovc]'))) { S.color = b.dataset.ovc; ui.refresh(); return; }
    if ((b = t.closest('[data-sim]'))) { const id = b.dataset.sim; S.sel = new Set([id]); S.last = id; ui.refresh(); scrollToItem(id); return; }
    if ((b = t.closest('[data-act]'))) {
      const a = b.dataset.act, items = selItems();
      if (a === 'pv' && items[0]) openPreview(items[0].id);
      else if (a === 'allsim' && items[0]) setView('similar', items[0].id);
      // other formats reach Blender through the add-on, which takes what is selected here: say how, once, on request
      else if (a === 's3d' && items[0]) import('./svg3d.js').then((m) => m.openFromItem(items[0]));
      else if (a === 'toblender') toast('В Blender: N › Oddments › «Вставить из Oddments»', 7000, { label: 'Аддон', fn: () => import('./settings.js').then((m) => m.openSettings('int')) });
      else if (a === 'trash') { trashItems(items); S.sel.clear(); ui.refresh(); toast('В корзину: ' + items.length, 0, { fn: () => { restoreItems(items); ui.refresh(); } }); }
      else if (a === 'restore') { restoreItems(items); S.sel.clear(); ui.refresh(); toast('Возвращено: ' + items.length); }
      else if (a === 'purge') arm(b, async () => { await purgeItems(items); ui.refresh(); toast('Удалено навсегда: ' + items.length); });
      else if (a === 'open' && items[0]) { try { await openPath(absPath(items[0].file)); } catch (err) { toast('Не удалось открыть файл. Попробуйте «В папке» и откройте его оттуда.'); } }
      else if (a === 'addurl') {
        const f = document.createElement('label');
        f.className = 'fld';
        f.innerHTML = '<span>Источник</span><input id="urlIn" type="text" value="" placeholder="https://">';
        b.closest('.fld').replaceWith(f);
        f.querySelector('input').focus();
      }
      else if (a === 'reveal' && items[0]) { try { await revealItemInDir(absPath(items[0].file)); } catch (err) { toast('Не удалось показать файл в папке: его могли переместить или удалить не через Oddments.'); } }
    }
  });

  insp.addEventListener('change', (e) => {
    const t = e.target, it = selItems()[0];
    if (t.id === 'nameIn' && it) { it.name = cleanName(t.value).trim() || it.name; saveIndex(); ui.refresh(); }
    else if (t.id === 'urlIn' && it) { it.url = t.value.trim(); saveIndex(); }
    else if (t.id === 'fAdd' && t.value && it) {
      if (!it.folders.includes(t.value)) it.folders.push(t.value);
      saveIndex(); ui.refresh();
    } else if (t.id === 'folderM' && t.value) {
      const fid = t.value, its = selItems();
      its.forEach((x) => { if (!x.folders.includes(fid)) x.folders.push(fid); });
      saveIndex(); ui.refresh();
      const f = folderById(fid);
      toast('В подборку «' + (f ? f.name : '') + '»: ' + its.length);
    }
  });

  insp.addEventListener('input', (e) => {
    if (e.target.id === 'noteIn') {
      const it = selItems()[0];
      if (it) { it.note = e.target.value; clearTimeout(noteTimer); noteTimer = setTimeout(saveIndex, 400); }
    }
  });

  insp.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.id !== 'tagIn' && t.id !== 'tagInM') return;
    if ((e.key === 'Enter' || e.key === ',') && t.value.trim()) {
      e.preventDefault();
      addTags(selItems(), t.value);
      ui.refresh();
      const nx = $('#tagIn') || $('#tagInM');
      if (nx) nx.focus();
    } else if (e.key === 'Backspace' && !t.value && t.id === 'tagIn') {
      const it = selItems()[0];
      if (it && it.tags.length) { it.tags.pop(); saveIndex(); ui.refresh(); const n2 = $('#tagIn'); if (n2) n2.focus(); }
    }
  });
}
