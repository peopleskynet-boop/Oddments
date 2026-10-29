// Full-screen viewer: zoomable images, GIF, video, audio with waveform, fonts, PDF pages, PSD composite.
import { S, ui } from '../state.js';
import { motionOn, scatterCards } from './motion.js';
import { $, esc, fmtSize, fmtDur, dateFmt } from '../util.js';
import { ic } from './icons.js';
import { assetUrl, absPath, addFromBlobs, saveIndex } from '../lib/library.js';
import { ensureFont, fontFamily } from '../lib/fonts.js';
import { loadPdfjs } from '../lib/ingest.js';
import { openPath, openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { toast } from './dialogs.js';
import * as fs from '@tauri-apps/plugin-fs';
import { sfx } from './sound.js';
import { markStep } from './onboard.js';
import { similarTo } from '../lib/similar.js';
import { pushLayer, popLayer } from './layers.js';
import { isOffline } from '../lib/net.js';
// the player (player.js + embedmedia.js) loads on first use or quietly after start (lazy.js preloadLazy): once it is
// here it mounts at once, as before; the very first time it waits a few milliseconds, and a file switched meanwhile wins
let P = null;
const unmountPlayer = () => { if (P) P.unmountPlayer(); };
function mountPlayer(holder, it, ...rest) {
  if (P) return P.mountPlayer(holder, it, ...rest);
  import('./player.js').then((m) => { P = m; if (S.previewId === it.id && holder.isConnected) m.mountPlayer(holder, it, ...rest); });
}

let token = 0;
let cleanup = null; // frees the 3D viewer (WebGL context) when the preview moves on

function teardown() { if (cleanup) { const f = cleanup; cleanup = null; f(); } }

export const isPreviewOpen = () => !!S.previewId;

// where the picture grows from: the card's image on screen, if it is visible
let fromRect = null, closeT = null, backFocus = null, flownFrom = null;

// opts.wear: a material id the model should come up wearing (a material dropped onto its card)
let openOpts = {};
// the preview's keys live in main.js (they reach into the grid); layers.js hands it the keys that land outside it
let previewKeys = null;
export const setPreviewKeys = (fn) => { previewKeys = fn; };

export function openPreview(id, opts = {}) {
  if (!S.byId.get(id)) return;
  openOpts = opts;
  clearTimeout(closeT);
  const im = document.querySelector(`#c-${CSS.escape(id)} .ph img`);
  fromRect = im && motionOn() ? im.getBoundingClientRect() : null;
  const first = !S.previewId;
  if (first) { backFocus = document.activeElement; sfx('open'); }
  S.previewId = id;
  markStep('open');
  if (S.byId.get(id).kind === 'model' || S.byId.get(id).kind === 'material') markStep('3d');
  const pv = $('#pv');
  pv.classList.remove('out');
  pv.classList.add('on');
  pushLayer({ el: pv, title: 'Просмотр', close: () => closePreview(), onKey: (e) => previewKeys && previewKeys(e) });
  // opened from a card on screen: the other cards fly apart and the room darkens after them
  if (first && fromRect) {
    const card = im.closest('.card');
    scatterCards(card, true);
    card.style.opacity = '0'; flownFrom = card;
    pv.style.animation = 'none';
    pv.animate([{ backgroundColor: 'rgba(5, 5, 6, 0)', backdropFilter: 'blur(0px)' }, { backgroundColor: 'rgba(5, 5, 6, .9)', backdropFilter: 'blur(30px) saturate(1.2)' }], { duration: 560, easing: 'ease-out' });
    pv.querySelector('.pv-top').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 260, fill: 'backwards' });
  } else if (!first && flownFrom) {
    // stepping with ← →: closing should land in the card of the picture that is open now
    flownFrom.style.opacity = '';
    flownFrom = im ? im.closest('.card') : null;
    if (flownFrom) flownFrom.style.opacity = '0';
  }
  draw();
  // the viewer is a modal dialog: focus moves in (Tab cycles inside) and comes back on close
  if (!pv.contains(document.activeElement)) pv.focus({ preventScroll: true });
}

// the coloured glow behind the viewer (.pv::before) fades with the dark glass; left alone it vanished in one
// frame at the very end and the window seemed to flash
const glowOut = (pv, ms) => {
  try { pv.animate([{ opacity: 0.3 }, { opacity: 0 }], { duration: ms * 0.8, easing: 'ease-out', fill: 'forwards', pseudoElement: '::before' }); } catch (e) { /* no pseudo-element animations: the glow just goes with the layer */ }
};

// now: true — no flight back to the card, the 3D view is freed right away (another 3D screen opens next)
export function closePreview(now = false) {
  unmountPlayer();
  dropClip();
  if (S.previewId) sfx('close');
  S.previewId = null;
  token++;
  const pv = $('#pv');
  popLayer(pv); // first: the wall stops being inert, so focus can go back to it
  if (pv.contains(document.activeElement)) {
    const b = backFocus && backFocus.isConnected && backFocus !== document.body ? backFocus : $('#grid');
    b.focus({ preventScroll: true });
  }
  backFocus = null;
  const finish = () => {
    // hide first, then free the 3D viewer: nothing visible while the WebGL context goes away
    pv.classList.remove('on', 'out');
    pv.style.animation = ''; // only once hidden: clearing it while shown replays the fade-in (the double flash)
    $('#pvS').innerHTML = '';
    teardown();
  };
  clearTimeout(closeT);
  const card = flownFrom;
  flownFrom = null;
  const restore = () => { if (card) card.style.opacity = ''; };
  if (now || !motionOn() || !pv.classList.contains('on')) { scatterCards(null, false); restore(); return finish(); }
  // flown out of a card that is still on screen: the picture flies back into it and the cards gather round
  const img = pv.querySelector('.zi'), back = card && card.isConnected && card.querySelector('.ph img');
  const to = back && back.getBoundingClientRect();
  if (img && to && to.width && to.bottom > 0 && to.top < innerHeight) {
    const from = img.getBoundingClientRect(), s = Math.max(to.width / from.width, to.height / from.height);
    // a picture not laid out yet (zero box) has no scale to fly back with (bug #122): just close
    if (!isFinite(s) || !s) { scatterCards(null, false); restore(); return finish(); }
    const dx = to.left + to.width / 2 - (from.left + from.width / 2), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    scatterCards(null, false);
    pv.animate([{ backgroundColor: 'rgba(5, 5, 6, .9)', backdropFilter: 'blur(30px) saturate(1.2)' }, { backgroundColor: 'rgba(5, 5, 6, 0)', backdropFilter: 'blur(0px)' }], { duration: 420, easing: 'ease-in', fill: 'forwards' });
    glowOut(pv, 420);
    [pv.querySelector('.pv-top'), $('#pvMore'), ...pv.querySelectorAll('.pv-peek')].forEach((el) => el && el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
    img.animate([{ transform: img.style.transform || 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: '16px' }], { duration: 440, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' })
      .finished.then(() => { if (S.previewId === null) { restore(); pv.getAnimations({ subtree: true }).forEach((a) => a.cancel()); finish(); } });
    return;
  }
  scatterCards(null, false);
  restore();
  // 3D, PDF, video…: the dark glass thins out and the stage fades. Not an opacity transition on the whole layer:
  // Chrome drops the backdrop blur for the first frame of one and the window flashed twice on close.
  pv.animate([{ backgroundColor: 'rgba(5, 5, 6, .9)', backdropFilter: 'blur(30px) saturate(1.2)' }, { backgroundColor: 'rgba(5, 5, 6, 0)', backdropFilter: 'blur(0px)' }], { duration: 340, easing: 'cubic-bezier(.25, .1, .25, 1)', fill: 'forwards' });
  glowOut(pv, 340);
  [pv.querySelector('.pv-top'), $('#pvS'), $('#pvMore')].forEach((el) => el && el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }));
  closeT = setTimeout(() => { if (S.previewId === null) { pv.getAnimations({ subtree: true }).forEach((a) => a.cancel()); finish(); } }, 340);
}

let slideDir = 0; // the last step's direction: the new picture slides in from that side (#81)
export function stepPreview(d, onMove) {
  const ids = S.vis.map((i) => i.id);
  const i = ids.indexOf(S.previewId);
  if (i < 0 || ids.length < 2) return;
  slideDir = d;
  S.previewId = ids[(i + d + ids.length) % ids.length];
  S.sel = new Set([S.previewId]);
  S.last = S.previewId;
  draw();
  if (onMove) onMove(S.previewId);
}

function draw() {
  const it = S.byId.get(S.previewId);
  if (!it) return closePreview();
  const my = ++token;
  teardown();
  const ids = S.vis.map((i) => i.id), i = ids.indexOf(it.id);
  $('#pvT').textContent = it.name + (it.ext && it.kind !== 'link' ? '.' + it.ext : ''); // a link card is not «….url»
  const pv = $('#pv'), c = it.colors || [];
  pv.style.setProperty('--amb1', c[1] || c[0] || 'transparent');
  pv.style.setProperty('--amb2', c[2] || c[0] || 'transparent');
  $('#pvC').textContent = (i >= 0 ? `${i + 1} / ${ids.length} · ` : '') + (it.w && it.kind !== 'pdf' && it.kind !== 'model' && it.kind !== 'material' ? `${Math.round(it.w)}×${Math.round(it.h)} · ` : '') + (it.duration ? fmtDur(it.duration) + ' · ' : '') + fmtSize(it.size);
  const stage = $('#pvS');
  unmountPlayer();
  dropClip();
  stage.innerHTML = '';
  const nav = ids.length > 1
    ? `<button class="pv-nav l" data-nav="-1" aria-label="Назад">${ic('left')}</button><button class="pv-nav r" data-nav="1" aria-label="Вперёд">${ic('right')}</button>` : '';
  // the carousel (#81): the neighbours peek in at the edges — thumbnails only, no players or 3D. A model or a
  // material is worked with alone: no neighbours, no «Ещё похожие» (bug #108; ←/→ still step)
  const solo = it.kind === 'model' || it.kind === 'material';
  document.getElementById('pv').classList.toggle('pv-solo', solo);
  if (ids.length > 1 && i >= 0 && !solo) {
    const peek = (j, side) => {
      const n = S.vis[(j + ids.length) % ids.length];
      return n && n.id !== it.id && n.thumb ? `<button class="pv-peek ${side}" data-nav="${side === 'l' ? -1 : 1}" aria-label="${side === 'l' ? 'Предыдущий' : 'Следующий'}: ${esc(n.name)}" tabindex="-1"><img src="${assetUrl(n.thumb)}" alt="" decoding="async"></button>` : '';
    };
    stage.insertAdjacentHTML('beforeend', peek(i - 1, 'l') + peek(i + 1, 'r'));
  }
  const holder = document.createElement('div');
  holder.className = 'pv-hold';
  stage.appendChild(holder);
  stage.insertAdjacentHTML('beforeend', nav);
  bindStage(stage);
  // a 3D cover-flow step (bug #87): the new centre swings in from its side out of a turned pose, the old centre
  // swings back into the neighbour on the other side, the next neighbour slides in from beyond the edge
  if (slideDir && motionOn()) {
    const d = slideDir, ease = 'cubic-bezier(.2, .85, .25, 1)';
    holder.animate([{ transform: `translateX(${d * 34}%) rotateY(${-d * 38}deg) scale(.84)`, opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: ease });
    const back = stage.querySelector(d > 0 ? '.pv-peek.l' : '.pv-peek.r'), fresh = stage.querySelector(d > 0 ? '.pv-peek.r' : '.pv-peek.l');
    if (back) back.animate([{ transform: `translate(${d > 0 ? 30 : -30}%, -50%) rotateY(0deg) scale(1.05)`, opacity: .9 }, {}], { duration: 560, easing: ease });
    if (fresh) fresh.animate([{ transform: `translate(${d > 0 ? 160 : -160}%, -50%) rotateY(${d > 0 ? -60 : 60}deg) scale(.7)`, opacity: 0 }, {}], { duration: 560, easing: ease });
  }
  slideDir = 0;
  drawMore(it);

  switch (it.kind) {
    case 'image': case 'gif': zoomImage(holder, assetUrl(it.file)); break;
    case 'psd': if (it.preview) zoomImage(holder, assetUrl(it.preview)); else other(holder, it, 'Нет встроенного превью. Сохраните PSD с опцией «Максимальная совместимость».'); break;
    case 'video': videoView(holder, it); break;
    case 'audio': holder.innerHTML = `<div class="aud">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : ''}<audio controls autoplay src="${assetUrl(it.file)}"></audio></div>`; break;
    case 'font': fontView(holder, it, my); break;
    case 'pdf': pdfView(holder, it, my); break;
    case 'model': case 'material': modelView(holder, it, my); break;
    case 'figma': case 'link': linkView(holder, it); break;
    case 'block': blockView(holder, it, my); break;
    default: other(holder, it);
  }
}

// a horizontal wheel or trackpad swipe steps through the files (a vertical wheel stays the zoom of a picture)
let wheelAcc = 0, wheelT = 0;
function bindStage(stage) {
  if (stage.dataset.bound) return;
  stage.dataset.bound = '1';
  stage.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelT < 380) return; // one step per gesture
    wheelAcc += e.deltaX;
    if (Math.abs(wheelAcc) > 60) {
      const b = stage.querySelector(`.pv-nav[data-nav="${wheelAcc > 0 ? 1 : -1}"]`);
      wheelAcc = 0; wheelT = now;
      if (b) b.click();
    }
  }, { passive: false });
}

/* ---------- «Ещё похожие» under the picture (#80) ---------- */
// the closest in meaning (AI vectors) or, without AI, by palette / tags / collections; a strip that loads more as it is
// scrolled; a click opens that file here. Folded / unfolded by its header (remembered).
const MORE_KEY = 'perch.pvMore';
let moreOpen = (() => { try { return localStorage.getItem(MORE_KEY) !== '0'; } catch (e) { return true; } })();
let moreList = [], moreShown = 0, moreBy = 'ai';
// only what is really close (audit 29.10: a dog and a dandelion under a sneaker): with AI — standing out against the
// library; without it the match is mostly the palette, so a stricter score and the strip says «по цвету и тегам»
async function similarFor(it) {
  try {
    const ai = await import('../lib/ai.js');
    if (ai.aiReady()) { const n = ai.nearestTo(it.id, 120, 1.6); if (n) { moreBy = 'ai'; return n.map((x) => S.byId.get(x.id)).filter(Boolean); } }
  } catch (e) { /* no AI module */ }
  moreBy = 'color';
  return similarTo(it, S.items.filter((x) => !x.trashed), 60, 0.5);
}
function moreItems(from, to) {
  return moreList.slice(from, to).map((x) => `<button class="pvm-i" data-more="${x.id}" title="${esc(x.name)}">${x.thumb ? `<img src="${assetUrl(x.thumb)}" alt="" loading="lazy" decoding="async">` : `<b>${esc((x.ext || x.kind).toUpperCase())}</b>`}</button>`).join('');
}
async function drawMore(it) {
  const box = $('#pvMore');
  if (!box) return;
  if (it.kind === 'model' || it.kind === 'material') { box.innerHTML = ''; return; } // 3D: one object at a time (#108)
  const my = token;
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', (e) => {
      const h = e.target.closest('[data-moretog]');
      if (h) {
        moreOpen = !moreOpen;
        try { localStorage.setItem(MORE_KEY, moreOpen ? '1' : '0'); } catch (er) { /* private mode */ }
        box.classList.toggle('open', moreOpen); h.setAttribute('aria-expanded', String(moreOpen));
        return;
      }
      const b = e.target.closest('[data-more]');
      if (b) { const id = b.dataset.more; S.sel = new Set([id]); S.last = id; openPreview(id); }
    });
    box.addEventListener('scroll', (e) => {
      const row = e.target;
      if (!row.classList || !row.classList.contains('pvm-row')) return;
      if (row.scrollLeft + row.clientWidth > row.scrollWidth - 300 && moreShown < moreList.length) {
        row.insertAdjacentHTML('beforeend', moreItems(moreShown, moreShown + 24));
        moreShown = Math.min(moreList.length, moreShown + 24);
      }
    }, true);
    // the vertical wheel scrolls the strip sideways
    box.addEventListener('wheel', (e) => {
      const row = box.querySelector('.pvm-row');
      if (!row || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault(); row.scrollLeft += e.deltaY;
    }, { passive: false });
  }
  const list = it.trashed ? [] : await similarFor(it);
  if (my !== token) return;
  moreList = list; moreShown = Math.min(list.length, 24);
  box.classList.toggle('open', moreOpen);
  box.hidden = it.trashed;
  // nothing close: said so in one quiet line instead of the least far files
  box.innerHTML = list.length ? `<button class="pvm-h" data-moretog aria-expanded="${moreOpen}">${moreBy === 'ai' ? 'Ещё похожие' : 'Похожие по цвету и тегам'} <span>${list.length}</span></button><div class="pvm-row" role="list">${moreItems(0, moreShown)}</div>`
    : `<p class="pvm-none">${moreBy === 'ai' ? 'Похожего в библиотеке нет' : 'Похожего по цвету и тегам нет · с ИИ-поиском похожие ищутся по смыслу'}</p>`;
}

// a clip played from the web (a Pinterest video, a page's og:video): downloaded to memory, played by Oddments'
// own player; one at a time
let webClip = '';
const dropClip = () => { if (webClip) URL.revokeObjectURL(webClip); webClip = ''; };
async function playWeb(holder, it, url, btn, site) {
  if (btn) { btn.disabled = true; btn.textContent = 'Загружаю…'; }
  try {
    const vl = await import('../lib/videolink.js');
    const m = await vl.mediaFor(url);
    if (!m || m.kind !== 'video') throw new Error('нет ролика');
    const { blob } = await vl.downloadMedia(m);
    if (S.previewId !== it.id) return;
    dropClip();
    webClip = URL.createObjectURL(blob);
    mountPlayer(holder, it, () => { unmountPlayer(); other(holder, it, 'Этот ролик не воспроизводится внутри Oddments: его кодек браузерный движок не поддерживает.'); }, webClip, [
      { icon: 'download', label: 'Скачать в библиотеку', fn: (b) => keepWeb(it, url, b) },
      { icon: 'external', label: 'Открыть на ' + (site || 'сайте'), fn: () => openUrl(url).catch(() => {}) },
    ]);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Смотреть здесь'; }
    toast(/нет ролика/.test(e.message) ? 'Не нашлось ролика по этой ссылке: возможно, это картинка или пин удалён.' : 'Не удалось загрузить ролик: ' + e.message);
  }
}
// the clip as a file in the library, next to the link card (same tags and collections)
async function keepWeb(it, url, btn) {
  // a text button shows the state in its label, an icon button (the player's bar) in its tooltip
  const say = (t) => { const sp = btn.querySelector('span'); if (sp) sp.textContent = t; else if (btn.querySelector('svg')) btn.title = t; else btn.textContent = t; };
  btn.disabled = true; say('Скачиваю…');
  try {
    const vl = await import('../lib/videolink.js');
    const m = await vl.mediaFor(url);
    if (!m) throw new Error('нет файла');
    const { blob, ext } = await vl.downloadMedia(m);
    const name = (m.title || it.name).replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.' + ext;
    const out = await addFromBlobs([{ blob, name, source: url }], { folder: it.folders[0] });
    out.forEach((n) => { n.tags = it.tags.slice(); n.folders = it.folders.slice(); });
    if (out.length) { saveIndex(); ui.refresh(); toast('В библиотеке: ' + out[0].name); }
    say('Сохранено');
  } catch (e) { btn.disabled = false; say('Скачать в библиотеку'); toast('Не удалось скачать: ' + e.message); }
}

// Figma files and links: the card or embedded preview, and a button that opens the source
async function linkView(holder, it) {
  dropClip();
  const isFig = it.kind === 'figma';
  let url = it.url || '';
  if (!isFig && !url) { try { const { urlFromShortcut } = await import('../lib/figma.js'); url = urlFromShortcut(new TextDecoder().decode(await fs.readFile(absPath(it.file)))); } catch (e) { /* no url */ } }
  // a video link opens like a picture: the clip fills the preview in its own shape and starts at once
  const { parseVideoUrl, videoAspect } = await import('../lib/figma.js');
  const vid = !isFig && parseVideoUrl(url);
  if (vid) {
    // YouTube and Vimeo: the site's player, online, under Oddments' own controls. Pinterest: the clip is fetched as a
    // file and plays in Oddments' own player (playWeb), and can be kept in the library as a real video.
    const embed = vid.site === 'YouTube' || vid.site === 'Vimeo';
    const ar0 = it.w && it.h ? it.w / it.h : 16 / 9; // the cover's shape until the clip's own is known
    holder.innerHTML = `<div class="vlink-full">
      <div class="vl-stage" style="--ar:${ar0}">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : ''}</div>
      <div class="vl-acts">${embed ? '' : `<button type="button" class="pv-btn" data-keep>${ic('download')}<span>Скачать в библиотеку</span></button>`}<button type="button" class="pv-btn" data-open>${ic('external')}<span>Открыть на ${esc(vid.site)}</span></button></div></div>`;
    holder.querySelector('[data-open]').addEventListener('click', async (e) => { e.stopPropagation(); try { await openUrl(url); } catch (err) { console.warn(err); } });
    if (!embed) {
      holder.querySelector('[data-keep]').addEventListener('click', (e) => { e.stopPropagation(); keepWeb(it, url, e.currentTarget); });
      playWeb(holder, it, url, null, vid.site);
      return;
    }
    // YouTube / Vimeo: the site's player under Oddments' own capsule (player.js + embedmedia.js), in the clip's shape;
    // if the site never answers, the cover card with «Открыть на …» stays; in «Без сети» it stays from the start
    if (isOffline()) return;
    const ar = await videoAspect(vid);
    if (S.previewId !== it.id) return;
    const card = holder.innerHTML;
    mountPlayer(holder, it, () => {
      if (S.previewId !== it.id) return;
      unmountPlayer();
      holder.innerHTML = card;
      holder.querySelector('[data-open]').addEventListener('click', async (e) => { e.stopPropagation(); try { await openUrl(url); } catch (err) { console.warn(err); } });
      toast(`${vid.site} не отвечает: откройте ролик на сайте.`);
    }, null, [{ icon: 'external', label: 'Открыть на ' + vid.site, fn: () => openUrl(url).catch(() => {}) }], { site: vid.site, id: vid.id, ar });
    return;
  }
  const label = isFig ? 'Открыть в Figma' : /figma\.com/.test(url) ? 'Открыть в Figma' : 'Открыть ссылку';
  const note = isFig && !it.thumb ? '<p>В этом .fig нет встроенного превью: так бывает со старыми файлами.</p>' : url ? `<p class="lnk-url">${esc(url)}</p>` : '';
  holder.innerHTML = `<div class="pv-other blend">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : `<b>${isFig ? 'FIG' : 'URL'}</b>`}${note}<button type="button" class="pv-btn" data-open>${label}</button></div>`;
  holder.querySelector('[data-open]').addEventListener('click', async (e) => {
    e.stopPropagation();
    // a link card opens only http(s); a .fig file opens in Figma (audit #39)
    try {
      if (isFig) await openPath(absPath(it.file));
      else if (/^https?:\/\//i.test(url)) await openUrl(url);
      else toast('Эта ссылка ведёт не на веб-страницу (не http/https) — Oddments её не открывает.');
    } catch (err) { console.warn(err); }
  });
  // any other page: if it announces a video file (og:video), it plays here too
  if (!isFig && /^https?:/i.test(url)) {
    const m = await (await import('../lib/videolink.js')).pageVideo(url);
    if (!m || S.previewId !== it.id || !holder.querySelector('[data-open]')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pv-btn pri'; b.textContent = 'Смотреть здесь';
    b.addEventListener('click', (e) => { e.stopPropagation(); playWeb(holder, it, url, b); });
    holder.querySelector('[data-open]').before(b);
  }
}

// a video the webview cannot decode would otherwise sit there as an empty grey player
// video: Oddments' own player (player.js), not the browser's controls
function videoView(holder, it) {
  mountPlayer(holder, it, () => {
    if (S.previewId !== it.id) return;
    unmountPlayer();
    other(holder, it, 'Это видео не воспроизводится внутри Oddments: его кодек браузерный движок не поддерживает.');
  });
}

// No view inside Oddments (unknown type, or it failed): say why and offer the two ways out, not a dead end.
// a block of a page (blockview.js, loaded on first use): the shot, the live block with an inspector, the code
function blockView(holder, it, my) {
  import('./blockview.js').then(async (m) => {
    if (my !== token || !holder.isConnected) return;
    const done = await m.mountBlock(holder, it, zoomImage);
    if (my !== token) done(); else cleanup = done;
  }).catch(() => other(holder, it, 'Просмотр блока не открылся.'));
}

function other(holder, it, msg) {
  holder.innerHTML = `<div class="pv-other"><b>${esc((it.ext || 'file').toUpperCase())}</b><p>${esc(msg || 'Для этого типа нет встроенного просмотра.')}</p>` +
    `<div class="pv-acts"><button type="button" class="pill" data-pva="app">${ic('external')}<span>Открыть в программе</span><kbd>Ctrl Enter</kbd></button>` +
    `<button type="button" class="pill ghost" data-pva="reveal">${ic('folder')}<span>Показать в папке</span></button></div></div>`;
  import('./ctxmenu.js').then((m) => { const b = holder.querySelector('[data-pva="app"] span'); if (b) b.textContent = m.appLabel(it); });
  holder.querySelector('.pv-acts').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pva]');
    if (!b) return;
    if (b.dataset.pva === 'app') (await import('./ctxmenu.js')).openInApp(it);
    else {
      try { await revealItemInDir(absPath(it.file)); } catch (err) { toast('Не удалось показать файл в папке: его могли переместить или удалить не через Oddments.'); }
    }
  });
}

function zoomImage(holder, url) {
  holder.classList.add('zoomable');
  const img = new Image();
  img.src = url; img.draggable = false; img.className = 'zi';
  holder.appendChild(img);
  // grow out of the card it was opened from (shared-element transition)
  const from = fromRect;
  fromRect = null;
  if (from) {
    img.style.animation = 'none';
    img.style.opacity = '0';
    img.decode().catch(() => {}).then(() => {
      const to = img.getBoundingClientRect();
      img.style.opacity = '';
      if (!to.width || !to.height || !from.width || !from.height) return;
      const s = Math.max(from.width / to.width, from.height / to.height);
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      // the flight to the centre: a touch of motion blur on the way, settling sharp
      img.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: '16px', filter: 'blur(0)' },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 16}px) scale(${(s + 1) / 2})`, filter: 'blur(2px)', offset: 0.45 },
        { transform: 'none', borderRadius: '6px', filter: 'blur(0)' },
      ], { duration: 640, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    });
  }
  let sc = 1, tx = 0, ty = 0;
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; };
  holder.addEventListener('wheel', (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015), nsc = Math.min(30, Math.max(0.1, sc * k));
    const r = holder.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    tx = cx - (cx - tx) * (nsc / sc); ty = cy - (cy - ty) * (nsc / sc); sc = nsc;
    apply();
  }, { passive: false });
  let drag = null;
  holder.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - tx, y: e.clientY - ty }; holder.setPointerCapture(e.pointerId); holder.classList.add('grab'); });
  holder.addEventListener('pointermove', (e) => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } });
  const endDrag = () => { drag = null; holder.classList.remove('grab'); };
  holder.addEventListener('pointerup', endDrag);
  holder.addEventListener('pointercancel', endDrag);
  holder.addEventListener('lostpointercapture', endDrag);
  holder.addEventListener('dblclick', () => { sc = 1; tx = 0; ty = 0; apply(); });
  // keyboard zoom (+ / − / 0), about the centre
  holder.__zoom = (k) => {
    if (!k) { sc = 1; tx = 0; ty = 0; apply(); return; }
    const nsc = Math.min(30, Math.max(0.1, sc * k));
    tx *= nsc / sc; ty *= nsc / sc; sc = nsc; apply();
  };
}

// + / − / 0 in the viewer: zoom the picture when there is one
export function zoomKey(key) {
  const h = document.querySelector('#pv .zoomable');
  if (!h || !h.__zoom) return false;
  h.__zoom(key === '0' ? 0 : key === '-' || key === '−' ? 0.8 : 1.25);
  return true;
}

async function fontView(holder, it, my) {
  holder.innerHTML = `<div class="fview"><div class="frow"><input type="range" id="fsz" min="12" max="220" value="72" aria-label="Размер"><span id="fszv">72 px</span></div>
    <div class="ftxt" id="ftxt" contenteditable="true" spellcheck="false" style="font-family:'${fontFamily(it)}';font-size:72px">Съешь ещё этих мягких французских булок, да выпей чаю. The quick brown fox jumps over the lazy dog 0123456789</div>
    <div class="fglyphs" style="font-family:'${fontFamily(it)}'">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ<br>абвгдеёжзийклмнопрстуфхцчшщъыьэюя<br>0123456789 !?&amp;@#%*()[]{}—–«»</div></div>`;
  await ensureFont(it);
  if (my !== token) return;
  const t = $('#ftxt'), r = $('#fsz');
  r.oninput = () => { t.style.fontSize = r.value + 'px'; $('#fszv').textContent = r.value + ' px'; };
  t.style.fontFamily = `'${fontFamily(it)}'`;
}

// .blend has no viewer: show Blender's own preview and offer to open the file in Blender.
// .blend / .abc not yet exported: offer to show the scene through the user's Blender, or open it there
function blendView(holder, it, my, err) {
  const abc = it.ext === 'abc';
  const note = err || (abc
    ? 'Alembic — кэш из Blender, Houdini или Maya. Oddments покажет его через ваш Blender: он один раз сохранит сцену в GLB.'
    : 'Oddments покажет сцену целиком через ваш Blender: он один раз сохранит её в GLB, дальше открывается сразу.');
  // a file card, not an error screen: Blender's own preview at its real size, what the file is, and the way into
  // Blender as the main action (the same accent button as in the properties panel); the scene here is the extra
  const meta = [(it.ext || '').toUpperCase(), fmtSize(it.size), dateFmt.format(it.added)].filter(Boolean).join(' · ');
  holder.innerHTML = `<div class="pv-other blend"><div class="bl-pic">${it.thumb ? `<img src="${assetUrl(it.thumb)}" alt="">` : `<b>${abc ? 'ABC' : 'BLEND'}</b>`}</div>
    <div class="bl-info"><h3>${esc(it.name)}</h3><span class="bl-meta">${esc(meta)}</span><p${err ? ' class="err"' : ''}>${esc(note)}</p>
    <div class="pv-acts"><button type="button" class="pv-btn pri" data-blend>Открыть в Blender</button><button type="button" class="pv-btn" data-scene>Показать сцену здесь</button></div></div></div>`;
  holder.querySelector('[data-blend]').addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await openPath(absPath(it.file)); } catch (er) { console.warn(er); }
  });
  holder.querySelector('[data-scene]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Blender готовит сцену…';
    try {
      const { prepare } = await import('../lib/blender.js');
      await prepare(it);
      if (my === token) modelView(holder, it, my);
    } catch (er) {
      if (my === token) blendView(holder, it, my, er && er.message ? er.message : String(er));
    }
  });
}

async function modelView(holder, it, my) {
  const scene = it.ext === 'blend' || it.ext === 'abc';
  if (scene && !it.glb) return blendView(holder, it, my);
  holder.innerHTML = '<div class="pv-other"><p>Загружаю модель…</p></div>';
  try {
    const u8 = await fs.readFile(absPath(scene ? it.glb : it.file));
    if (my !== token) return;
    const { isSplatFile } = await import('../lib/splat.js');
    if (!scene && isSplatFile(it.ext, u8)) { // Gaussian splats: their own viewer (Spark)
      if (it.ext === 'ply' && !it.splat) { it.splat = true; saveIndex(); }
      const { mountSplat } = await import('./splatview.js');
      const done = await mountSplat(holder, u8, it.ext, () => my !== token, {
        flip: it.splatFlip !== false,
        onFlip: (f) => { if (f) delete it.splatFlip; else it.splatFlip = false; saveIndex(); }, // optional field, only when turned back
      });
      openOpts = {};
      if (my !== token) done(); else cleanup = done;
      return;
    }
    const [{ mountViewer }, lib] = await Promise.all([import('./viewer3d.js'), import('./materials.js')]);
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    if (my !== token) return;
    const done = await mountViewer(holder, buf, scene ? 'glb' : it.ext, () => my !== token, { lib, itemId: it.id, name: it.name, wear: openOpts.wear });
    openOpts = {};
    if (my !== token) done(); else cleanup = done;
  } catch (e) {
    console.warn(e);
    if (my === token) other(holder, it, 'Не удалось показать модель. Для .gltf с отдельными файлами (bin, текстуры) лучше сохранить GLB.');
  }
}

async function pdfView(holder, it, my) {
  holder.classList.add('pdfhold');
  holder.innerHTML = '<div class="pv-other"><p>Загружаю PDF…</p></div>';
  try {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await fs.readFile(absPath(it.file)));
    const doc = await pdfjs.getDocument({ data }).promise;
    if (my !== token) { doc.destroy(); return; }
    holder.innerHTML = '';
    const first = await doc.getPage(1);
    const v1 = first.getViewport({ scale: 1 });
    const width = Math.min(960, Math.max(320, holder.clientWidth - 24));
    const scale = width / v1.width, dpr = window.devicePixelRatio || 1;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(async (en) => {
        if (!en.isIntersecting) return;
        const pg = en.target;
        obs.unobserve(pg);
        const page = await doc.getPage(+pg.dataset.p);
        if (my !== token) return;
        const vp = page.getViewport({ scale: scale * dpr });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        c.style.width = '100%'; c.style.height = '100%';
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
        if (my === token) pg.appendChild(c);
      });
    }, { root: holder, rootMargin: '600px' });
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = document.createElement('div');
      pg.className = 'pdfpg'; pg.dataset.p = p;
      pg.style.width = width + 'px'; pg.style.aspectRatio = `${v1.width} / ${v1.height}`;
      holder.appendChild(pg);
      obs.observe(pg);
    }
  } catch (e) {
    console.warn(e);
    other(holder, it, 'Не удалось показать PDF — возможно, файл повреждён или защищён паролем.');
  }
}
