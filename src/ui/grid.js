// Virtualised masonry/grid: only cards near the viewport exist in the DOM,
// so thousands of files scroll smoothly.
import { S, ui, folderById } from '../state.js';
import { esc, raf, fmtDur, typeLabel, fmtSize } from '../util.js';
import { assetUrl, saveIndex } from '../lib/library.js';
import { ic } from './icons.js';
import { computeLayout, visibleRange } from './layout.js';
import { settings } from './settings.js';
import { sfx } from './sound.js';
import { setFrameGeometry } from './frame.js';
import { motionOn } from './motion.js';
import { t, lang } from '../lib/i18n.js';
import { layoutNow, syncLayoutBtns } from './viewlayout.js';
import { LITE } from '../lib/lite.js';

const scroller = () => document.getElementById('scroll');
const host = () => document.getElementById('grid');

let boxes = [], total = 0, nodes = new Map(), lastIds = '', lastView = '', lastSigs = new Map();
let freeCols = 0; // the wall's columns before it made room for the properties panel (layoutGrid)
let wave = false; // next render shows its cards in a staggered wave
let cur = null; // keyboard cursor (item id); lives in data, cards come and go with scrolling
let mode = 'masonry'; // the layout of the place on screen (viewlayout.js): 'masonry' | 'grid' | 'list'
const OVERSCAN = 700;

const KIND_ICON = { video: '▶', audio: '♪', font: 'Aa', pdf: 'PDF', psd: 'PSD', gif: 'GIF', model: '3D', other: '' };
const liveVideo = (it) => it.kind === 'video' && settings.vplay === 'always';
// cards are never translated as a whole (the names are the person's own words): their own labels go through t() here
const favTip = (it) => t(it.fav ? 'Убрать из избранного' : 'В избранное');

function capHeight() { return settings.captions ? 24 : 0; }

// A link's site on its card: a pill with the site's icon (a play mark for a clip, the first letter when the site gave
// none) and its short name — «sketchfab», «YouTube». Links read before covers have no `page` and no pill yet.
function sitePill(it) {
  const p = it.page;
  if (it.kind !== 'link' || !p || p.cover === 'figma' || !(p.site || p.host)) return ''; // the Figma card has its mark drawn
  const name = p.site || p.host;
  const mark = p.cover === 'video' ? `<i class="lk-ic play">${ic('play')}</i>`
    : p.icon ? `<img class="lk-ic" src="${assetUrl(p.icon)}" alt="" decoding="async" draggable="false">`
    : `<i class="lk-ic">${esc(name.slice(0, 1).toUpperCase())}</i>`;
  return `<span class="lk-site">${mark}<span>${esc(name)}</span></span>`;
}
// a page without a picture: its name in big letters on the theme's card colour, washed with the site icon's colour
const typeCard = (it) => it.kind === 'link' && !!it.page && !it.page.cover;
const tintVar = (it) => (it.page && /^#[0-9a-f]{6}$/i.test(it.page.tint || '') ? ` style="--lk-tint:${it.page.tint}"` : '');

function cardHTML(it) {
  let media;
  if (typeCard(it)) {
    media = `<div class="lk-type"${tintVar(it)}><b>${esc(it.name)}</b></div>`;
  } else if (it.thumb) {
    media = `<img src="${assetUrl(it.thumb)}" alt="" decoding="async" draggable="false">`;
  } else {
    media = `<div class="nothumb"><b>${esc(typeLabel(it))}</b></div>`;
  }
  if (liveVideo(it)) media += `<video class="hv live" src="${assetUrl(it.file)}" muted loop autoplay playsinline preload="metadata"></video>`;
  let badge = '';
  if (liveVideo(it)) badge = '';
  else if (it.kind === 'video' || it.kind === 'audio') badge = `<span class="badge">${KIND_ICON[it.kind]} ${esc(fmtDur(it.duration))}</span>`;
  else if (it.kind === 'gif') badge = '<span class="badge">GIF</span>';
  else if (it.kind === 'pdf') badge = `<span class="badge">PDF${it.pages ? ' · ' + it.pages : ''}</span>`;
  else if (it.kind === 'psd') badge = `<span class="badge">${it.ext === 'tif' || it.ext === 'tiff' ? 'TIFF' : esc((it.ext || 'psd').toUpperCase())}</span>`;
  else if (it.kind === 'hdri') badge = `<span class="badge">${it.w && it.h && Math.abs(it.w / it.h - 2) < 0.05 ? 'HDRI · ' : ''}${esc((it.ext || '').toUpperCase())}</span>`;
  else if (it.kind === 'font') badge = '<span class="badge">Aa</span>';
  else if (it.kind === 'material') badge = `<span class="badge">${t('Материал')}</span>`;
  else if (it.kind === 'block') badge = `<span class="badge">${t('Блок')}</span>`;
  else if (it.kind === 'model') badge = `<span class="badge">${it.ext === 'blend' ? 'BLEND' : '3D · ' + esc((it.ext || '').toUpperCase())}</span>`;
  // the type is said once: a card with a type badge does not repeat the extension in its caption
  const ex = badge || it.kind === 'link' ? '' : `<span class="ex">${esc(it.ext || '')}</span>`; // a link says its site on the pill, not «url»
  const cap = settings.captions
    ? `<div class="cap"><span class="nm">${esc(it.name)}</span>${ex}</div>` : '';
  const ovl = settings.captions ? '' : `<div class="ovl"><span class="nm">${esc(it.name)}</span>${ex}</div>`;
  const fav = `<button class="fav${it.fav ? ' on' : ''}" data-fav tabindex="-1" aria-label="${favTip(it)}" title="${favTip(it)}">${ic(it.fav ? 'heartOn' : 'heart')}</button>`;
  const dot = it.fresh ? `<span class="newdot" aria-label="${t('Новый файл')}"></span>` : '';
  // a flow collection (flows.js): the step number in the corner
  const fl = S.view.type === 'folder' && folderById(S.view.id);
  const at = fl && fl.flow && fl.order ? fl.order.indexOf(it.id) : -1;
  const step = at >= 0 ? `<span class="step">${String(at + 1).padStart(2, '0')}</span>` : '';
  const team = it.by ? t(`Из командной библиотеки · добавил(а) ${it.by}`) : t('Из командной библиотеки');
  const pii = piiMark(it) + (it.team ? `<span class="teamm" title="${esc(team)}">${ic('team')}</span>` : '');
  return `<div class="ph">${media}${badge}${sitePill(it)}${step}${dot}${pii}${fav}${typeCard(it) ? '' : ovl}</div>${cap}`;
}

// A row of the list: the preview, the name in full (two lines), what it is — for a link its site and the page's own
// description, for a file its type, size and length — up to three tags, the date, and on hover «open» and the heart
const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
const yearFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
const when = (ms) => (new Date(ms).getFullYear() === new Date().getFullYear() ? dayFmt : yearFmt).format(ms);
function rowHTML(it) {
  const p = it.kind === 'link' ? it.page : null;
  let media;
  if (typeCard(it)) {
    const mark = p.icon ? `<img src="${assetUrl(p.icon)}" alt="" decoding="async" draggable="false">` : `<b>${esc((p.site || p.host || '?').slice(0, 1).toUpperCase())}</b>`;
    media = `<div class="lr-ic"${tintVar(it)}>${mark}</div>`;
  } else if (it.thumb) media = `<img src="${assetUrl(it.thumb)}" alt="" decoding="async" draggable="false">`;
  else media = `<div class="nothumb"><b>${esc(typeLabel(it))}</b></div>`;
  const play = p && p.cover === 'video' ? `<span class="lr-play">${ic('play')}</span>` : '';
  let meta;
  if (p) {
    const site = (p.icon ? `<img class="lk-ic" src="${assetUrl(p.icon)}" alt="" decoding="async" draggable="false">` : p.cover === 'video' ? `<i class="lk-ic play">${ic('play')}</i>` : '') + `<span class="lr-host">${esc(p.host || p.site || '')}</span>`;
    const desc = p.desc || (p.title && p.title !== it.name ? p.title : '');
    meta = site + (desc ? `<span class="lr-sep">·</span><span class="lr-desc">${esc(desc)}</span>` : '');
  } else {
    const dims = it.w && it.kind !== 'model' && it.kind !== 'material' && it.kind !== 'link' ? `${Math.round(it.w)} × ${Math.round(it.h)}` : '';
    meta = [esc(typeLabel(it)), dims, it.duration ? fmtDur(it.duration) : '', it.pages ? it.pages + ' ' + t('стр.') : '', it.size ? fmtSize(it.size) : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('<span class="lr-sep">·</span>');
  }
  const tags = it.tags.slice(0, 3).map((x) => `<span class="lr-tag">${esc(x)}</span>`).join('');
  const goTip = t(it.kind === 'link' ? 'Открыть на сайте' : 'Открыть в программе');
  const go = it.kind === 'link' || !LITE ? `<button class="lr-go" data-go tabindex="-1" aria-label="${goTip}" title="${goTip}">${ic('external')}</button>` : '';
  const fav = `<button class="fav${it.fav ? ' on' : ''}" data-fav tabindex="-1" aria-label="${favTip(it)}" title="${favTip(it)}">${ic(it.fav ? 'heartOn' : 'heart')}</button>`;
  const dot = it.fresh ? `<span class="newdot" aria-label="${t('Новый файл')}"></span>` : '';
  return `<div class="ph">${media}${play}</div><div class="lr-tx"><span class="lr-nm">${esc(it.name)}</span><span class="lr-mt">${meta}</span></div>` +
    `<div class="lr-tags">${tags}</div><span class="lr-dt">${when(it.added)}</span><span class="lr-acts">${go}${fav}</span>${dot}`;
}

// what a screen reader hears for a card: name, type, and the states shown only visually
function cardLabel(it) {
  const flags = [it.team && 'командный', it.fresh && 'новый', it.fav && 'в избранном', it.pii && it.pii.length && !it.masked && 'личные данные'];
  return [it.name, typeLabel(it), ...flags.filter(Boolean).map(t)].join(', ');
}

// keep a card's heart and label in sync after favourites change elsewhere (F key, inspector)
// personal data on the picture (pii.js): a quiet shield in the corner — check it before it goes to Figma or the team
const piiMark = (it) => (it.pii && it.pii.length && !it.masked ? `<span class="piim" title="${t('Личные данные на картинке — «Скрыть личные данные…» в меню')}">${ic('shield')}</span>` : '');

export function syncCard(id) {
  const n = nodes.get(id), it = S.byId.get(id);
  if (!n || !it) return;
  const b = n.querySelector('[data-fav]');
  if (b) { b.classList.toggle('on', it.fav); b.innerHTML = ic(it.fav ? 'heartOn' : 'heart'); b.title = b.ariaLabel = favTip(it); }
  n.setAttribute('aria-label', cardLabel(it));
  const ph = n.querySelector('.ph'), m = ph && ph.querySelector('.piim'), want = piiMark(it), fv = ph && ph.querySelector('[data-fav]');
  if (m && !want) m.remove();
  else if (fv && want && !m) fv.insertAdjacentHTML('beforebegin', want); // a list row has no mark on its little preview
}

function makeNode(it, b) {
  const el = document.createElement('div');
  el.className = 'card' + (mode === 'list' ? ' row' : typeCard(it) ? ' lk-bare' : '') + (S.sel.has(it.id) ? ' sel' : '') + (it.id === cur ? ' cur' : '') + (settings.anim === 'smooth' ? ' enter' : '');
  el.dataset.id = it.id;
  el.dataset.kind = it.kind;
  el.id = 'c-' + it.id;
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', S.sel.has(it.id) ? 'true' : 'false');
  el.setAttribute('aria-label', cardLabel(it));
  el.draggable = true;
  el.innerHTML = mode === 'list' ? rowHTML(it) : cardHTML(it);
  const lv = el.querySelector('video.live');
  if (lv) lv.addEventListener('error', () => lv.remove(), { once: true });
  place(el, b);
  if (it.fresh) seenIO.observe(el);
  return el;
}

// A new file counts as seen once its card has been at least 60% on screen for 1.2 s:
// the red dot then fades by itself, nothing has to be hovered or clicked.
const seenTimers = new Map();
let seenFlush = null;
const seenIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (e.isIntersecting && document.visibilityState === 'visible') {
      if (seenTimers.has(el)) continue;
      seenTimers.set(el, setTimeout(() => {
        seenTimers.delete(el);
        seenIO.unobserve(el);
        const it = S.byId.get(el.dataset.id);
        if (!it || !it.fresh || !el.isConnected) return;
        it.fresh = false;
        el.classList.add('seen');
        el.setAttribute('aria-label', cardLabel(it));
        clearTimeout(seenFlush);
        seenFlush = setTimeout(() => { saveIndex(); ui.freshChanged(); }, 400);
      }, 1200));
    } else { clearTimeout(seenTimers.get(el)); seenTimers.delete(el); }
  }
}, { root: document.getElementById('scroll'), threshold: 0.6 });
// cards already on screen while the window was hidden start counting once it is visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  nodes.forEach((n, id) => { const it = S.byId.get(id); if (it && it.fresh) { seenIO.unobserve(n); seenIO.observe(n); } });
});
function place(el, b) {
  el.style.width = b.w + 'px';
  el.style.height = b.h + 'px';
  el.style.transform = `translate(${b.x}px,${b.y}px)`;
}

// Full relayout (items, width or zoom changed).
export function layoutGrid(keepNodes) {
  const sc = scroller(), g = host();
  const items = S.vis;
  const width = Math.max(120, sc.clientWidth - parseFloat(getComputedStyle(sc).paddingLeft) - parseFloat(getComputedStyle(sc).paddingRight));
  // making room for the properties panel (main.js makeRoom, body.insp-room) keeps the columns the wall had: narrower
  // columns, every card in its own — a re-fit to fewer columns re-dealt the masonry and the clicked card jumped away.
  // Not when that squeezes cards below 60 % of the chosen size (a narrow window): then the wall re-fits as before.
  const room = document.body.classList.contains('insp-room');
  const fit = Math.max(1, Math.floor((width + settings.gap) / (settings.zoom + settings.gap)));
  const keep = room && freeCols > fit && (width - (freeCols - 1) * settings.gap) / freeCols >= settings.zoom * 0.6 ? freeCols : 0;
  mode = layoutNow();
  syncLayoutBtns(mode);
  const list = mode === 'list';
  const res = computeLayout(items, width, settings.zoom, settings.gap, list ? 0 : capHeight(), mode, list ? 0 : keep);
  if (!room && !list) freeCols = res.cols;
  boxes = res.boxes; total = res.height;
  g.style.height = total + 'px';
  setFrameGeometry({ host: g, left: g.getBoundingClientRect().left, cols: res.cols, colW: res.colW, gap: settings.gap });
  const sig = (i) => i.id + '|' + i.name + '|' + i.ext + '|' + (i.thumb || '') + (i.page ? '|' + (i.page.cover || '-') + (i.page.icon || '') + (list ? i.page.desc : '') : '') + (list ? '|' + i.tags.join(',') : '');
  const ids = items.map(sig).join(',');
  // the same view (place, search, colour, sort) with files only taken out or put back — Delete, «В корзину»,
  // «Вернуть»: the cards stay; the gone ones fade, the rest slide to their new places, returned ones come in.
  // Only a different view rebuilds the wall with its entrance wave (rebuilding on Delete made it all blink).
  const viewKey = JSON.stringify([S.view, S.q, S.color, S.sort, S.dir, mode]);
  if (!keepNodes || viewKey !== lastView) { nodes.forEach((n) => n.remove()); nodes = new Map(); wave = true; }
  else if (ids !== lastIds) {
    const now = new Map(items.map((i) => [i.id, sig(i)]));
    nodes.forEach((n, id) => {
      if (now.get(id) === lastSigs.get(id)) return; // unchanged: it slides (body.reflow below)
      nodes.delete(id); seenIO.unobserve(n); clearTimeout(seenTimers.get(n)); seenTimers.delete(n);
      if (!now.has(id) && motionOn()) {
        n.style.pointerEvents = 'none';
        n.animate([{ opacity: 1, scale: '1', filter: 'blur(0)' }, { opacity: 0, scale: '.9', filter: 'blur(4px)' }],
          { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).onfinish = () => n.remove();
      } else n.remove(); // renamed / re-thumbed: drawn again in place
    });
    document.body.classList.add('reflow');
    clearTimeout(layoutGrid.t);
    layoutGrid.t = setTimeout(() => document.body.classList.remove('reflow'), 600);
  }
  lastIds = ids; lastView = viewKey;
  lastSigs = new Map(items.map((i) => [i.id, sig(i)]));
  document.getElementById('empty').hidden = items.length > 0;
  render();
}

export function render() {
  const sc = scroller();
  const items = S.vis;
  const off = host().offsetTop; // the view header scrolls above the grid
  const top = sc.scrollTop - off - OVERSCAN, bottom = sc.scrollTop - off + sc.clientHeight + OVERSCAN;
  const want = new Set();
  const g = host();
  const frag = document.createDocumentFragment();
  for (const i of visibleRange(boxes, top, bottom)) {
    const it = items[i];
    want.add(it.id);
    let n = nodes.get(it.id);
    if (!n) {
      n = makeNode(it, boxes[i]); nodes.set(it.id, n); frag.appendChild(n);
      if (wave) n.style.setProperty('--d', Math.min(frag.childNodes.length * 18, 360) + 'ms');
    }
    else place(n, boxes[i]);
  }
  nodes.forEach((n, id) => { if (!want.has(id)) { seenIO.unobserve(n); clearTimeout(seenTimers.get(n)); seenTimers.delete(n); n.remove(); nodes.delete(id); } });
  g.appendChild(frag);
  wave = false;
}

export function refreshSelection() {
  nodes.forEach((n, id) => { const on = S.sel.has(id); n.classList.toggle('sel', on); n.setAttribute('aria-selected', on ? 'true' : 'false'); });
}

export function setCursor(id) {
  if (cur === id) return;
  if (cur && nodes.get(cur)) nodes.get(cur).classList.remove('cur');
  cur = id;
  if (id && nodes.get(id)) nodes.get(id).classList.add('cur');
  if (id) host().setAttribute('aria-activedescendant', 'c-' + id); else host().removeAttribute('aria-activedescendant');
}

// Index of the keyboard cursor: the cursor itself, else the last clicked/selected card.
export function cursorIndex() {
  const ids = [cur, S.last, ...S.sel];
  for (const id of ids) {
    if (!id) continue;
    const i = S.vis.findIndex((x) => x.id === id);
    if (i >= 0) return i;
  }
  return -1;
}

// First card fully inside the viewport, so the first arrow press starts where the user is looking.
export function firstInView() {
  const sc = scroller(), off = host().offsetTop;
  const top = sc.scrollTop - off, bottom = top + sc.clientHeight;
  let best = -1;
  for (const i of visibleRange(boxes, top, bottom)) {
    const b = boxes[i];
    if (b.y >= top && (best < 0 || b.y < boxes[best].y || (b.y === boxes[best].y && b.x < boxes[best].x))) best = i;
  }
  return best >= 0 ? best : (boxes.length ? 0 : -1);
}

// Neighbour of card i in direction dir ('left' | 'right' | 'up' | 'down'), computed from the layout boxes.
// Up/down prefer the same column, then the nearest column that has a card on that side.
export function neighbour(i, dir) {
  const n = boxes.length;
  if (i < 0 || i >= n) return -1;
  if (dir === 'left') return i > 0 ? i - 1 : i;
  if (dir === 'right') return i < n - 1 ? i + 1 : i;
  const a = boxes[i], ax = a.x + a.w / 2, ay = a.y + a.h / 2, up = dir === 'up';
  let best = -1, bdx = Infinity, bdy = Infinity;
  for (let k = 0; k < n; k++) {
    if (k === i) continue;
    const b = boxes[k], by = b.y + b.h / 2;
    if (up ? by >= ay : by <= ay) continue;
    const dx = Math.round(Math.abs(b.x + b.w / 2 - ax)), dy = Math.abs(by - ay);
    if (dx < bdx || (dx === bdx && dy < bdy)) { best = k; bdx = dx; bdy = dy; }
  }
  return best >= 0 ? best : i;
}

// Indices of cards intersecting a rectangle in grid coordinates (for the marquee): uses layout boxes,
// so cards scrolled out of the DOM are selected too.
export function hitRect(x0, y0, x1, y1) {
  const out = [];
  for (const i of visibleRange(boxes, y0, y1)) {
    const b = boxes[i];
    if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) out.push(i);
  }
  return out;
}

export function scrollToItem(id) {
  const i = S.vis.findIndex((x) => x.id === id);
  if (i < 0 || !boxes[i]) return;
  const sc = scroller(), b = boxes[i], off = host().offsetTop, pad = parseFloat(getComputedStyle(sc).paddingTop) || 0;
  const y = b.y + off;
  if (y < sc.scrollTop + pad) sc.scrollTop = y - pad - 20;
  else if (y + b.h > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + b.h - sc.clientHeight + 20;
}

export function initGrid() {
  const sc = scroller();
  // favourite heart on a card: toggles without selecting the card
  // «open» on a list row: the page in the browser, the file in its program — without selecting the row
  host().addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (!g) return;
    e.stopPropagation();
    const c = g.closest('.card'), it = c && S.byId.get(c.dataset.id);
    if (it) import('./ctxmenu.js').then((m) => m.openInApp(it)).catch(() => {});
  }, true);
  host().addEventListener('click', (e) => {
    const b = e.target.closest('[data-fav]');
    if (!b) return;
    e.stopPropagation();
    const c = b.closest('.card'), it = c && S.byId.get(c.dataset.id);
    if (!it) return;
    it.fav = !it.fav;
    sfx(it.fav ? 'fav' : 'unfav');
    b.classList.toggle('on', it.fav);
    b.innerHTML = ic(it.fav ? 'heartOn' : 'heart');
    b.title = b.ariaLabel = favTip(it);
    c.setAttribute('aria-label', cardLabel(it));
    saveIndex();
    if (S.view.type === 'fav') ui.refresh(); else ui.renderSide();
  }, true);
  const onScroll = raf(render);
  sc.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(raf(() => layoutGrid(true))).observe(sc);

  // Hover preview: animated GIF plays, video loops muted.
  const g = host();
  g.addEventListener('mouseover', (e) => {
    if (!settings.hover) return;
    const c = e.target.closest('.card');
    if (!c || c.dataset.hov) return;
    const it = S.byId.get(c.dataset.id);
    if (!it) return;
    const ph = c.querySelector('.ph');
    if (it.kind === 'gif') {
      const im = ph.querySelector('img');
      if (im) { c.dataset.hov = '1'; im.dataset.thumb = im.src; im.src = assetUrl(it.file); }
    } else if (it.kind === 'video' && it.thumb && !liveVideo(it)) {
      c.dataset.hov = '1';
      const v = document.createElement('video');
      v.src = assetUrl(it.file); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.className = 'hv';
      ph.appendChild(v);
      v.play().catch(() => {});
    }
  });
  g.addEventListener('mouseout', (e) => {
    const c = e.target.closest('.card');
    if (!c || !c.dataset.hov || c.contains(e.relatedTarget)) return;
    delete c.dataset.hov;
    const im = c.querySelector('img');
    if (im && im.dataset.thumb) { im.src = im.dataset.thumb; delete im.dataset.thumb; }
    const v = c.querySelector('video.hv:not(.live)');
    if (v) { v.pause(); v.removeAttribute('src'); v.remove(); }
  });
}
