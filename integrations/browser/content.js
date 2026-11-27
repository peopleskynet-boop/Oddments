// Oddments for Chrome, Edge, Zen and Firefox: the page side. Alt+click and the hover button save a picture (embedded Vimeo players —
// Behance animations — have their own in embed.js), a dragged picture or
// link can be dropped on the dock at the right edge, «Все картинки страницы» opens a picker, «Снимок области» draws
// a frame. The downloads and the token stay in the service worker; this script only finds what to save.
(() => {
  if (window.__perch) return;
  window.__perch = true;
  // after the extension is updated or reloaded the old copy of this script stays in open tabs, cut off from the
  // extension: the new copy tells it to step aside, so there is one overlay and one set of listeners
  // the hello carries a secret kept in the extension's storage, which the page cannot read: a page cannot fake it
  // to switch Oddments off on itself (audit #40)
  const me = Math.random().toString(36).slice(2);
  let alive = true, secret = '';
  chrome.storage.local.get('helloKey').then(async ({ helloKey }) => {
    secret = helloKey || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    if (!helloKey) await chrome.storage.local.set({ helloKey: secret });
    document.dispatchEvent(new CustomEvent('perch-ext-hello', { detail: secret + ':' + me }));
  }).catch(() => {});
  document.addEventListener('perch-ext-hello', (e) => {
    const [key, who] = String(e.detail || '').split(':');
    if (secret && key === secret && who !== me) { alive = false; host.remove(); }
  });

  let prefs = { altClick: true, hoverBtn: true, minSize: 200 };
  const load = () => chrome.runtime.sendMessage({ t: 'prefs' }).then((p) => { if (p) prefs = p; }).catch(() => {});
  load();
  chrome.storage.onChanged.addListener(load);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => toast(T('Расширение перезагружено: обновите страницу'), 'err'));

  /* ---------- one shadow root for everything we draw ---------- */
  // the Oddments prism: a rounded triangle with the app icon's colours
  const PRISM = '<svg class="prism" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="odd-prism" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6b4ff"/><stop offset=".5" stop-color="#a7c7ff"/><stop offset="1" stop-color="#ffc7e8"/></linearGradient></defs><path d="M12 4.4 20 18.4H4Z" fill="none" stroke="url(#odd-prism)" stroke-width="3.4" stroke-linejoin="round"/></svg>';
  const host = document.createElement('perch-ui');
  host.style.cssText = 'all: initial; position: fixed; inset: 0 auto auto 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { --acc: #d7ff63; --acc-fg: #0b0c10; --bg: rgba(16, 19, 30, .88); --solid: #12141b; --fg: #eceaf2; --mut: #9a9bab; --line: rgba(255,255,255,.1);
      --red: #ff2e88; --rim-a: #d6b4ff; --rim-b: #a7c7ff; --rim-c: #ffc7e8; }
    * { box-sizing: border-box; font-family: "Golos Text", "Segoe UI", system-ui, sans-serif; }
    /* the app's glass: a gradient rim (lavender → sky → pink) drawn as a 1px masked border */
    .rim { position: fixed; }
    .rim::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px; pointer-events: none;
      background: linear-gradient(140deg, rgba(214,180,255,.6), rgba(167,199,255,.3) 28%, rgba(255,255,255,.05) 52%, rgba(255,255,255,.04) 70%, rgba(255,199,232,.42));
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
    .prism { width: 16px; height: 16px; flex: none; display: block; }
    [hidden] { display: none !important; }
    .toast { position: fixed; right: 20px; bottom: 20px; max-width: 360px; padding: 11px 18px 11px 14px; border-radius: 999px;
      background: var(--bg); color: var(--fg); font-size: 13px; line-height: 1.3; display: flex; gap: 10px; align-items: center;
      backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 10px 40px rgba(0,0,0,.35), inset 0 0 0 1px var(--line);
      transform: translateY(14px) scale(.96); opacity: 0; transition: transform .38s cubic-bezier(.32,1.28,.6,1), opacity .2s; pointer-events: none; }
    .toast.on { transform: none; opacity: 1; }
    .toast i { width: 8px; height: 8px; border-radius: 50%; background: var(--acc); flex: none; }
    .toast.err i { background: var(--red); }
    .toast.busy i { animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .3; } }
    .hov { position: fixed; padding: 6px 12px 6px 9px; border: 0; border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 12px;
      cursor: pointer; display: none; align-items: center; gap: 7px; box-shadow: 0 4px 18px rgba(0,0,0,.3), inset 0 0 0 1px var(--line); }
    .hov.on { display: flex; }
    .hov:hover { background: var(--acc); color: var(--acc-fg); }
    .dock { position: fixed; right: 18px; top: 50%; width: 132px; height: 132px; margin-top: -66px; border-radius: 34px; display: none;
      flex-direction: column; gap: 10px; align-items: center; justify-content: center; text-align: center; padding: 14px;
      background: var(--bg); color: var(--fg); font-size: 12px; line-height: 1.3; box-shadow: 0 16px 50px rgba(0,0,0,.4), inset 0 0 0 1px var(--line);
      transition: transform .3s cubic-bezier(.32,1.28,.6,1), background .15s; }
    .dock.on { display: flex; }
    .dock.over { transform: scale(1.08); background: var(--acc); color: var(--acc-fg); }
    .dock .prism { width: 30px; height: 30px; }
    .area { position: fixed; inset: 0; width: 100vw; height: 100vh; cursor: crosshair; background: rgba(0,0,0,.28); }
    .area b { position: fixed; border: 1.5px solid var(--acc); border-radius: 4px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.28); }
    .area-bar { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; padding: 6px 6px 6px 16px;
      border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 12.5px; backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 10px 40px rgba(0,0,0,.35); cursor: default; }
    .area-bar .btn { height: 30px; font-size: 12.5px; }
    .area.adjust { background: none; cursor: default; }
    .area.adjust b { cursor: move; border-width: 2px; }
    .area .h { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: var(--acc); box-shadow: 0 0 0 2px var(--solid); }
    .area .size { position: absolute; left: 0; top: -26px; font: 11px ui-monospace, Consolas, monospace; color: var(--fg); padding: 3px 8px; border-radius: 999px; background: var(--bg); white-space: nowrap; }
    .area-go { position: fixed; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; padding: 6px; border-radius: 999px; background: var(--bg);
      backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 10px 40px rgba(0,0,0,.35); }
    .area-go .btn { height: 34px; }
    .area-go .btn.pri::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--red); margin-right: 8px; vertical-align: 0; }
    .mark-cal { position: fixed; pointer-events: none; box-shadow: inset 0 0 0 5px #ff00ff; }
    .rec-frame { position: fixed; pointer-events: none; border-radius: 2px; box-shadow: 0 0 0 2px var(--acc), 0 0 0 100vmax rgba(0,0,0,.22); }
    .rec-bar { position: fixed; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; padding: 6px 6px 6px 14px; border-radius: 999px;
      background: var(--bg); color: var(--fg); font-size: 13px; backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 10px 40px rgba(0,0,0,.35), inset 0 0 0 1px var(--line); }
    .rec-bar i { width: 10px; height: 10px; border-radius: 50%; background: var(--red); animation: pulse 1.2s infinite; }
    .rec-bar.paused i { animation: none; opacity: .35; }
    .rec-bar b { min-width: 38px; font-weight: 500; font-variant-numeric: tabular-nums; margin-right: 4px; }
    .rec-bar .x { width: 34px; padding: 0; font-size: 18px; line-height: 1; }
    .gal { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(8,9,13,.88); backdrop-filter: blur(10px); color: var(--fg);
      display: flex; flex-direction: column; }
    .gal header { display: flex; gap: 12px; align-items: center; padding: 18px 24px; flex-wrap: wrap; }
    .gal h2 { margin: 0 auto 0 0; font-size: 18px; font-weight: 500; }
    .gal h2 em { font-style: normal; color: var(--mut); margin-left: 6px; }
    .gal label { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--mut); }
    .gal input[type=range] { accent-color: var(--acc); width: 120px; }
    .btn { height: 34px; padding: 0 16px; border: 0; border-radius: 999px; background: rgba(255,255,255,.08); color: var(--fg); font-size: 13px; cursor: pointer; }
    .btn:hover { background: rgba(255,255,255,.14); }
    .btn.pri { background: var(--acc); color: var(--acc-fg); font-weight: 500; box-shadow: inset 0 1px 0 rgba(255,255,255,.65), 0 0 18px rgba(215,255,99,.2); }
    .btn.pri:disabled { opacity: .4; cursor: default; }
    .grid { flex: 1; overflow: auto; padding: 4px 24px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; align-content: start; }
    .tile { position: relative; aspect-ratio: 1; border-radius: 18px; overflow: hidden; background: rgba(255,255,255,.05); cursor: pointer; border: 0; padding: 0; }
    .tile img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .tile small { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(0,0,0,.6); color: #ddd; font-size: 11px; }
    .tile::after { content: ''; position: absolute; top: 9px; right: 9px; width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); background: rgba(0,0,0,.3); }
    .tile.on { box-shadow: inset 0 0 0 2.5px var(--acc); }
    .tile.on::after { background: var(--acc) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.5 10.5l3 3 6-7' fill='none' stroke='%230b0c10' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); box-shadow: none; }
    .tile:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
    .empty { grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--mut); }
  </style><div class="toast rim"><i></i><span></span></div><button class="hov rim">${PRISM}${T('В Oddments')}</button><div class="dock rim">${PRISM}${T('Бросьте сюда — в Oddments')}</div>`;
  const mount = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };
  const $ = (s) => root.querySelector(s);

  let toastT = null;
  function toast(text, kind = 'ok') {
    mount();
    const t = $('.toast');
    t.className = 'toast on ' + kind;
    t.querySelector('span').textContent = text;
    clearTimeout(toastT);
    // «Сохраняю…» waits for the answer, but never forever (the service worker may have been stopped)
    toastT = setTimeout(() => t.classList.remove('on'), kind === 'err' ? 4200 : kind === 'busy' ? 30000 : 2200);
  }

  /* ---------- the best source of a picture ---------- */
  function largest(srcset) {
    const c = (srcset || '').split(/,\s+(?=\S)/).map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    if (!c.length) return '';
    const size = (d) => (d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1);
    return c.sort((a, b) => size(b[1]) - size(a[1]))[0][0];
  }
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  const placeholder = (u) => !u || /^data:image\/(gif|svg)/i.test(u) && u.length < 400;
  function bestOf(img) {
    const cands = [largest(img.getAttribute('srcset') || img.getAttribute('data-srcset')), img.getAttribute('data-src') || img.getAttribute('data-original'), img.currentSrc, img.src];
    const pic = img.closest('picture');
    if (pic) pic.querySelectorAll('source').forEach((s) => cands.unshift(largest(s.getAttribute('srcset'))));
    for (const c of cands) { const u = c && abs(c); if (u && !placeholder(u)) return u; }
    return '';
  }
  // a picture under a point: an <img>, or an element painted with a background image (Pinterest, Behance covers)
  function pictureAt(el) {
    for (let e = el, i = 0; e && i < 4; e = e.parentElement, i++) {
      if (e.tagName === 'IMG') return bestOf(e);
      const bg = getComputedStyle(e).backgroundImage;
      const m = bg && bg.match(/url\(["']?(.+?)["']?\)/);
      if (m && !placeholder(m[1])) return abs(m[1]);
    }
    return '';
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!alive) return;
    if (msg.t === 'toast') { toast(msg.text, msg.kind); reply(true); }
    else if (msg.t === 'best') {
      const img = [...document.images].find((i) => i.currentSrc === msg.url || i.src === msg.url);
      reply({ url: (img && bestOf(img)) || msg.url });
    } else if (msg.t === 'readBlob') {
      fetch(msg.url).then((r) => r.blob()).then((b) => new Promise((res) => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); }))
        .then((data) => reply({ data }), () => reply({}));
      return true;
    } else if (msg.t === 'pickArea') { pickArea(msg.label, { video: !!msg.video }).then(reply); return true; }
    else if (msg.t === 'recLocal') { recLocal(msg).then(reply, (e) => reply({ error: (e && e.message) || String(e) })); return true; }
    else if (msg.t === 'recUi') { recUi(msg); reply(true); }
    else if (msg.t === 'recEnd') { recEnd(); reply(true); }
    else if (msg.t === 'gallery') { gallery(); reply(true); }
    else if (msg.t === 'pageHtml') reply({ html: '<!doctype html>' + document.documentElement.outerHTML, title: document.title, url: location.href });
  });

  /* ---------- Alt+click ---------- */
  // Sites like Behance open or zoom a picture on pointerdown / mousedown, before any click: so the save happens on
  // the first press with Alt, and the whole press (down, up, click) is kept from the page. The picture is looked up
  // under the pointer through every layer (overlays and links sit on top of the <img>), not only in the target's parents.
  // Behance puts a link over the <img> and gives the <img> pointer-events: none, so it is not in elementsFromPoint:
  // an <img> inside a hit element whose box holds the point counts too
  const holds = (el, x, y) => { const r = el.getBoundingClientRect(); return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  function imgInside(el, x, y) {
    if (!el.querySelectorAll) return null;
    for (const im of el.querySelectorAll('img')) if (holds(im, x, y)) { const u = bestOf(im); if (u) return { url: u, el: im }; }
    return null;
  }
  function pictureUnder(x, y, target) {
    const own = pictureAt(target);
    if (own) return { url: own, el: target };
    const stack = document.elementsFromPoint(x, y).filter((el) => el !== host);
    for (const el of stack) {
      const u = pictureAt(el);
      if (u) return { url: u, el };
    }
    for (const el of stack.slice(0, 4)) {
      const hit = imgInside(el, x, y);
      if (hit) return hit;
    }
    return null;
  }
  let swallow = 0;
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  addEventListener('pointerdown', (e) => {
    if (!alive || !e.altKey || !prefs.altClick || e.button !== 0) return;
    // a video first: Instagram and Pinterest lay its poster picture over it, and the poster is not what was meant
    const vid = videoUnder(e.clientX, e.clientY);
    const hit = vid ? null : pictureUnder(e.clientX, e.clientY, e.target);
    if (!hit && !vid) return;
    eat(e);
    swallow = Date.now();
    if (vid) return saveVideo(vid, e.shiftKey);
    swallow = Date.now();
    toast(T('Сохраняю…'), 'busy');
    send({ t: 'saveFile', url: hit.url, page: location.href, alt: altOf(hit.el) });
  }, true);
  // the rest of that press must not reach the page either (Alt+click on a link would also download it)
  for (const type of ['mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dragstart']) {
    addEventListener(type, (e) => { if (alive && swallow && Date.now() - swallow < 1500) { eat(e); if (type === 'click') swallow = 0; } }, true);
  }
  const altOf = (el) => (el.closest && el.closest('img') && el.closest('img').alt) || document.title;

  /* ---------- Alt+click on a video ---------- */
  // A <video> with a file (src http…) is saved as that file. Instagram, X and the like play from Media Source (blob:),
  // there is no file to take: Alt+click saves the current frame + a link card to the post, Alt+Shift+click records the
  // video while it plays (to its end, at most 60 s; Alt+click again stops) as WebM. One video per press — no crawling.
  function videoUnder(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host) continue;
      if (el.tagName === 'VIDEO') return el;
      const v = el.querySelector && el.querySelector('video');
      if (v) { const r = v.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return v; }
    }
    return null;
  }
  // the pin of a video on Pinterest: the pin page itself, the link around the video, or the one pin link in the
  // nearest block around it (a block with several pins — a grid row — is not a guess worth making)
  function pinOf(v) {
    const pin = (u) => { const m = String(u || '').match(/^https?:\/\/[^/]*pinterest\.[^/]+\/pin\/[\w-]+/i); return m ? m[0] + '/' : ''; };
    if (pin(location.href)) return pin(location.href);
    const a = v.closest('a[href*="/pin/"]');
    if (a) return pin(a.href);
    for (let el = v.parentElement, i = 0; el && i < 10; el = el.parentElement, i++) {
      const all = new Set([...el.querySelectorAll('a[href*="/pin/"]')].map((l) => pin(l.href)).filter(Boolean));
      if (all.size === 1) return [...all][0];
      if (all.size > 1) return '';
    }
    return '';
  }
  // the stream of a Pinterest video: its poster (…/videos/thumbnails/originals/ab/cd/ef/<hash>.0000000.jpg) names the
  // same <hash> as its playlist (…/videos/iht/hls/ab/cd/ef/<hash>.m3u8); the playlist the page really loaded wins
  function pinStream(v) {
    const m = String(v.poster || '').match(/\/videos\/thumbnails\/originals\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{16,})\./i);
    if (!m) return '';
    const hash = m[1].split('/').pop();
    const seen = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(hash) && /\.m3u8(\?|$)/.test(n) && !/_\d+w\.m3u8|_audio\.m3u8/.test(n));
    return seen || `https://v1.pinimg.com/videos/iht/hls/${m[1]}.m3u8`;
  }
  // a name for it: the pin's own picture description next to the video, else the page title
  function pinName(v) {
    for (let el = v.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
      const im = el.querySelector('img[alt]');
      if (im && im.alt.trim().length > 2) return im.alt.trim().slice(0, 80);
    }
    return document.title.replace(/\s*[|–—-]\s*Pinterest\s*$/i, '') || 'Pinterest';
  }
  // Instagram: the shortcode of the post (/p/, /reel/) → its media id → the media info the site's own page asks for
  // (same origin, the person's own session), the video file of the post — in a carousel, the one as long as this one
  const IG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  async function instagramVideo(v, link) {
    const code = (String(link).match(/\/(?:p|reel|reels|tv)\/([\w-]+)/) || location.pathname.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/) || [])[1];
    if (!code) throw new Error('no post');
    let id = 0n;
    for (const ch of code.slice(0, 11)) id = id * 64n + BigInt(IG.indexOf(ch));
    toast(T('Сохраняю видео…'), 'busy');
    const r = await fetch(`/api/v1/media/${id}/info/`, { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' } });
    if (!r.ok) throw new Error('info ' + r.status);
    const item = ((await r.json()).items || [])[0];
    if (!item) throw new Error('no item');
    const vids = (item.carousel_media || [item]).filter((m) => m.video_versions && m.video_versions.length);
    if (!vids.length) throw new Error('no video');
    const dur = v.duration || 0;
    const m = vids.sort((a, b) => Math.abs((a.video_duration || 0) - dur) - Math.abs((b.video_duration || 0) - dur))[0];
    const best = m.video_versions.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    const who = item.user && item.user.username ? '@' + item.user.username : 'Instagram';
    const cap = item.caption && item.caption.text ? ' — ' + item.caption.text.split(/\r?\n/)[0].slice(0, 60) : '';
    send({ t: 'saveFile', url: best.url, page: 'https://www.instagram.com/p/' + code + '/', alt: document.title, name: who + cap });
  }
  // Instagram without its API (not signed in): the player's own DASH pieces. Each piece's `efg` names the clip
  // (xpv_asset_id), its length and bitrate; without bytestart/byteend the CDN gives the whole track file. The clip
  // as long as this video (the latest one loaded when several are), its best video track and its audio, if any.
  function instagramStream(v, link) {
    const clips = new Map();
    performance.getEntriesByType('resource').forEach((e, i) => {
      if (!/\.mp4(\?|$)/.test(e.name) || !/cdninstagram\.com|fbcdn\.net/.test(e.name)) return;
      let u, info;
      try { u = new URL(e.name); info = JSON.parse(atob(decodeURIComponent(u.searchParams.get('efg') || ''))); } catch (er) { return; }
      if (!info || !info.xpv_asset_id) return;
      u.searchParams.delete('bytestart'); u.searchParams.delete('byteend');
      const c = clips.get(info.xpv_asset_id) || { dur: +info.duration_s || 0, at: 0, video: null, audio: null };
      const kind = /audio/i.test(info.vencode_tag || '') ? 'audio' : 'video';
      if (!c[kind] || (+info.bitrate || 0) > c[kind].br) c[kind] = { url: u.href, br: +info.bitrate || 0 };
      c.at = i;
      clips.set(info.xpv_asset_id, c);
    });
    const dur = v.duration || 0;
    const best = [...clips.values()].filter((c) => c.video && (!dur || Math.abs(c.dur - dur) <= 1.5))
      .sort((a, b) => Math.abs(a.dur - dur) - Math.abs(b.dur - dur) || b.at - a.at)[0];
    if (!best) return false;
    const og = document.querySelector('meta[property="og:title"]');
    const name = ((og && og.content) || document.title || 'Instagram').replace(/\s*[•|]\s*Instagram.*$/i, '').slice(0, 80);
    toast(T('Сохраняю видео…'), 'busy');
    send({ t: 'saveStream', video: best.video.url, audio: best.audio ? best.audio.url : '', page: link, title: name });
    return true;
  }
  // the post the video belongs to: a link to /p/ or /reel/ (Instagram), /status/ (X) near it, else the page
  function postOf(v) {
    let el = v;
    for (let i = 0; el && i < 12; i++, el = el.parentElement) {
      const a = el.querySelector && el.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/status/"]');
      if (a) return a.href;
    }
    return location.href;
  }
  let rec = null;
  function saveVideo(v, record) {
    const src = v.currentSrc || v.src || '';
    if (rec) { rec.stop(); return; }
    if (/^https?:/i.test(src) && !record) {
      toast(T('Сохраняю…'), 'busy');
      return send({ t: 'saveFile', url: src, page: location.href, alt: document.title });
    }
    const link = postOf(v), title = document.title;
    if (record) return recordVideo(v, link, title);
    // Pinterest and Instagram play a stream (blob:), but the video itself can be had: Pinterest — the pin goes as a
    // link and Oddments downloads its MP4; Instagram — the post's own video file, asked for as the page itself does
    if (/(^|\.)pinterest\./i.test(location.hostname)) {
      const pin = pinOf(v), hls = pinStream(v);
      if (hls) { toast(T('Сохраняю видео…'), 'busy'); return send({ t: 'savePinVideo', hls, pin, title: pinName(v) }); }
      if (pin) { toast(T('Сохраняю видео…'), 'busy'); return send({ t: 'saveLink', url: pin, title }); }
    }
    if (/(^|\.)instagram\.com$/i.test(location.hostname)) {
      return instagramVideo(v, link).catch(() => { if (!instagramStream(v, link)) frameOf(v, link, title); });
    }
    frameOf(v, link, title);
  }
  function frameOf(v, link, title) {
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      if (!c.width) throw new Error('empty');
      c.getContext('2d').drawImage(v, 0, 0);
      const data = c.toDataURL('image/png');
      toast(T('Сохраняю кадр…'), 'busy');
      send({ t: 'saveFrame', data, link, title });
    } catch (er) {
      // a video from another site without CORS taints the canvas: the post goes as a link
      toast(T('Кадр не взять — сохраняю ссылку'), 'busy');
      send({ t: 'saveLink', url: link, title });
    }
  }
  function recordVideo(v, link, title) {
    let stream;
    try { stream = v.captureStream ? v.captureStream() : null; } catch (er) { stream = null; }
    if (!stream) { toast(T('Это видео не записать — сохраните кадр (Alt+клик)'), 'err'); return; }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    const parts = [];
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const left = isFinite(v.duration) && v.duration > 0 ? Math.min(60, v.duration - v.currentTime) : 60;
    const stopT = setTimeout(() => r.state !== 'inactive' && r.stop(), Math.max(1, left) * 1000);
    const end = () => r.state !== 'inactive' && r.stop();
    v.addEventListener('ended', end, { once: true });
    r.onstop = () => {
      clearTimeout(stopT); v.removeEventListener('ended', end); rec = null;
      const blob = new Blob(parts, { type: 'video/webm' });
      if (!blob.size) { toast(T('Запись пустая'), 'err'); return; }
      const f = new FileReader();
      f.onload = () => { toast(T('Сохраняю запись…'), 'busy'); send({ t: 'saveRecording', data: f.result, link, title }); };
      f.readAsDataURL(blob);
    };
    rec = r;
    r.start(1000);
    if (v.paused) v.play().catch(() => {});
    toast(T('Записываю видео · Alt+клик — стоп'), 'busy');
  }

  /* ---------- hover button ---------- */
  let hovImg = null, hideT = null;
  // Vimeo players embedded in the page (Behance animations): their hover button and Alt+click live in the player's
  // own frame (embed.js) — the pointer over an iframe never reaches this page; here only the gallery lists them
  const VIMEO = /^https:\/\/player\.vimeo\.com\/video\/\d+/i;
  const isEmbed = (el) => el && el.tagName === 'IFRAME' && VIMEO.test(el.src);
  addEventListener('mouseover', (e) => {
    if (!alive || !prefs.hoverBtn || recording) return;
    const img = e.target.closest && e.target.closest('img');
    if (!img || img === hovImg) return;
    const r = img.getBoundingClientRect();
    if (r.width < 140 || r.height < 110) return;
    hovImg = img;
    mount();
    const b = $('.hov');
    b.style.left = Math.max(4, r.left + 10) + 'px';
    b.style.top = Math.max(4, r.top + 10) + 'px';
    b.classList.add('on');
    clearTimeout(hideT);
  }, { passive: true });
  addEventListener('mouseout', (e) => {
    if (!hovImg || e.target !== hovImg) return;
    hideT = setTimeout(() => { $('.hov').classList.remove('on'); hovImg = null; }, 260);
  }, { passive: true });
  addEventListener('scroll', () => { $('.hov').classList.remove('on'); hovImg = null; }, { passive: true, capture: true });
  $('.hov').addEventListener('mouseenter', () => clearTimeout(hideT));
  $('.hov').addEventListener('mouseleave', () => { $('.hov').classList.remove('on'); hovImg = null; });
  $('.hov').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!hovImg) return;
    toast(T('Сохраняю…'), 'busy');
    send({ t: 'saveFile', url: bestOf(hovImg), page: location.href, alt: hovImg.alt || document.title });
    $('.hov').classList.remove('on');
  });

  /* ---------- drag to the dock ---------- */
  let dragged = null;
  addEventListener('dragstart', (e) => {
    if (!alive || recording) return;
    const t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!t) return;
    const img = t.tagName === 'IMG' ? t : t.querySelector && t.querySelector('img');
    const a = t.closest && t.closest('a[href]');
    dragged = img ? { url: bestOf(img), alt: img.alt } : a ? { link: a.href, title: a.textContent.trim() } : null;
    if (!dragged) return;
    mount();
    $('.dock').classList.add('on');
  }, true);
  const endDrag = () => { $('.dock').classList.remove('on', 'over'); dragged = null; };
  addEventListener('dragend', endDrag, true);
  const dock = $('.dock');
  dock.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dock.classList.add('over'); });
  dock.addEventListener('dragleave', () => dock.classList.remove('over'));
  dock.addEventListener('drop', (e) => {
    e.preventDefault();
    const d = dragged;
    endDrag();
    if (!d) return;
    toast(T('Сохраняю…'), 'busy');
    if (d.url) send({ t: 'saveFile', url: d.url, page: location.href, alt: d.alt || document.title });
    else send({ t: 'saveLink', url: d.link, title: d.title });
  });

  /* ---------- area screenshot, area video ---------- */
  // A frame drawn with the pointer. For a screenshot it is taken at once. For a video (opts.video) it stays: it can
  // be moved and resized by its handles, and the recording starts on «Начать запись» (or Enter); «Вся вкладка» takes
  // the whole visible page. The answer is the frame in CSS pixels of the viewport.
  function pickArea(label, opts = {}) {
    return new Promise((resolve) => {
      mount();
      const ov = document.createElement('div');
      ov.className = 'area';
      ov.innerHTML = '<b hidden></b><div class="area-bar rim"><span></span></div>';
      const bar = ov.querySelector('.area-bar');
      bar.querySelector('span').textContent = label || T('Выделите область · Esc — отмена');
      if (opts.video) {
        const all = Object.assign(document.createElement('button'), { className: 'btn', textContent: T('Вся вкладка') });
        all.onclick = (e) => { e.stopPropagation(); finish({ x: 0, y: 0, w: innerWidth, h: innerHeight }); };
        bar.appendChild(all);
      }
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(ov);
      const box = ov.querySelector('b');
      let x0 = 0, y0 = 0, rect = null, go = null;
      const out = (r) => ({ ...r, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1 });
      const done = (r) => {
        removeEventListener('keydown', key, true);
        removeEventListener('resize', place);
        ov.remove();
        if (go) go.remove();
        // the frame must be gone from the screen before the capture
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(r), 40)));
      };
      const finish = (r) => done(r && r.w > 4 && r.h > 4 ? out(r) : null);
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && go) { e.preventDefault(); e.stopPropagation(); finish(rect); }
      };
      addEventListener('keydown', key, true);
      const draw = () => Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      ov.addEventListener('pointerdown', (e) => {
        if (go) return;
        ov.setPointerCapture(e.pointerId);
        x0 = e.clientX; y0 = e.clientY;
        box.hidden = false;
        bar.hidden = true;
        ov.style.background = 'none';
      });
      ov.addEventListener('pointermove', (e) => {
        if (box.hidden || go) return;
        rect = { x: Math.min(x0, e.clientX), y: Math.min(y0, e.clientY), w: Math.abs(e.clientX - x0), h: Math.abs(e.clientY - y0) };
        draw();
      });
      ov.addEventListener('pointerup', () => {
        if (go) return;
        if (!opts.video || !rect || rect.w < 8 || rect.h < 8) return finish(rect);
        adjust();
      });

      // the video's second step: handles, moving, the size, «Начать запись»
      function adjust() {
        ov.classList.add('adjust');
        const hs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => {
          const h = document.createElement('i');
          h.className = 'h';
          h.dataset.d = d;
          h.style.cursor = d + '-resize';
          box.appendChild(h);
          return h;
        });
        const size = document.createElement('span');
        size.className = 'size';
        box.appendChild(size);
        go = document.createElement('div');
        go.className = 'area-go rim';
        go.innerHTML = `<button class="btn pri" data-g="start"></button><button class="btn" data-g="all"></button><button class="btn" data-g="cancel"></button>`;
        go.querySelector('[data-g=start]').textContent = T('Начать запись');
        go.querySelector('[data-g=all]').textContent = T('Вся вкладка');
        go.querySelector('[data-g=cancel]').textContent = T('Отмена');
        go.title = T('Enter — начать, Esc — отмена');
        root.appendChild(go);
        go.addEventListener('click', (e) => {
          const b = e.target.closest('[data-g]');
          if (!b) return;
          if (b.dataset.g === 'start') finish(rect);
          else if (b.dataset.g === 'all') finish({ x: 0, y: 0, w: innerWidth, h: innerHeight });
          else done(null);
        });
        place();
        addEventListener('resize', place);
        let drag = null;
        box.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          box.setPointerCapture(e.pointerId);
          drag = { d: e.target.dataset.d || 'move', x: e.clientX, y: e.clientY, r: { ...rect } };
        });
        box.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y, r = { ...drag.r };
          if (drag.d === 'move') { r.x = clamp(r.x + dx, 0, innerWidth - r.w); r.y = clamp(r.y + dy, 0, innerHeight - r.h); }
          else {
            if (/w/.test(drag.d)) { const x = clamp(r.x + dx, 0, r.x + r.w - 16); r.w += r.x - x; r.x = x; }
            if (/e/.test(drag.d)) r.w = clamp(r.w + dx, 16, innerWidth - r.x);
            if (/n/.test(drag.d)) { const y = clamp(r.y + dy, 0, r.y + r.h - 16); r.h += r.y - y; r.y = y; }
            if (/s/.test(drag.d)) r.h = clamp(r.h + dy, 16, innerHeight - r.y);
          }
          rect = r;
          place();
        });
        const end = () => { drag = null; };
        box.addEventListener('pointerup', end);
        box.addEventListener('lostpointercapture', end);
        function spots() {
          const at = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
          for (const h of hs) { const [l, t] = at[h.dataset.d]; h.style.left = l + '%'; h.style.top = t + '%'; }
        }
        spots();
      }
      // the box, its size, and the bar under it (above it when there is no room below)
      function place() {
        if (!rect) return;
        draw();
        const k = devicePixelRatio || 1;
        const size = box.querySelector('.size');
        if (size) size.textContent = `${Math.round(rect.w * k)} × ${Math.round(rect.h * k)}`;
        if (!go) return;
        const bh = 46, gap = 12;
        const top = rect.y + rect.h + gap + bh <= innerHeight ? rect.y + rect.h + gap : rect.y - gap - bh >= 0 ? rect.y - gap - bh : rect.y + rect.h - bh - gap;
        go.style.top = top + 'px';
        go.style.left = clamp(rect.x + rect.w / 2, 170, innerWidth - 170) + 'px';
      }
    });
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- a video of an area: the frame and the bar ---------- */
  // The recording itself runs in the extension (offscreen.js); here the frame shows what is recorded and the bar
  // pauses and stops it. The frame is drawn just outside the area and the bar beside it, so neither is in the video;
  // the page inside stays live (clicks, scrolling). The «В Oddments» button and the dock stay away meanwhile.
  let recording = null;
  function recUi({ rect, elapsed = 0, paused = false, max = 300000 }) {
    recEnd();
    mount();
    const ui = document.createElement('div');
    ui.className = 'rec';
    ui.innerHTML = `<div class="rec-frame"></div><div class="rec-bar"><i></i><b>0:00</b>
      <button class="btn" data-r="pause"></button><button class="btn pri" data-r="stop">${T('Стоп')}</button>
      <button class="btn x" data-r="cancel" aria-label="${T('Отменить запись')}" title="${T('Отменить запись')}">×</button></div>`;
    root.appendChild(ui);
    Object.assign(ui.querySelector('.rec-frame').style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    const bar = ui.querySelector('.rec-bar');
    // below the area, else above it, else inside its lower edge (then it is in the video)
    const bh = 46, gap = 12;
    const top = rect.y + rect.h + gap + bh <= innerHeight ? rect.y + rect.h + gap : rect.y - gap - bh >= 0 ? rect.y - gap - bh : rect.y + rect.h - bh - gap;
    bar.style.top = top + 'px';
    bar.style.left = Math.round(rect.x + rect.w / 2) + 'px';
    const s = { ui, bar, paused, base: elapsed, from: performance.now(), max, tick: 0 };
    recording = s;
    const time = () => (s.paused ? s.base : s.base + performance.now() - s.from);
    const show = () => {
      const t = Math.floor(time() / 1000);
      bar.querySelector('b').textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      bar.classList.toggle('paused', s.paused);
      bar.querySelector('[data-r=pause]').textContent = s.paused ? T('Продолжить') : T('Пауза');
      if (time() >= s.max && recording === s) { if (localRec) localRec.control('stop'); else send({ t: 'recCtl', do: 'stop' }); }
    };
    show();
    s.tick = setInterval(show, 250);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      let what = b.dataset.r;
      if (what === 'pause' && s.paused) what = 'resume';
      if (what === 'pause') { s.base = time(); s.paused = true; } else if (what === 'resume') { s.from = performance.now(); s.paused = false; }
      show();
      if (localRec) localRec.control(what); else send({ t: 'recCtl', do: what });
    });
    $('.hov').classList.remove('on');
  }
  function recEnd() {
    if (!recording) return;
    clearInterval(recording.tick);
    recording.ui.remove();
    recording = null;
  }

  /* ---------- a video of an area in Zen and Firefox ---------- */
  // Gecko gives extensions no way to capture a tab, so the page asks for «show the screen» (getDisplayMedia) right in
  // the click on «Начать запись». What is shown — the Zen window or the whole screen — is not the page itself, so the
  // frame is found on it: for a moment a magenta border is drawn just inside the frame, the picture before and after
  // is compared, and the changed magenta pixels give the frame in the captured picture (any window position, scale
  // or monitor). Every captured frame is then cropped to it on a canvas and recorded as WebM (Gecko records no MP4),
  // without sound (Gecko's screen sharing has none). The file goes to the extension (recFile) and on to Oddments.
  let localRec = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function recLocal({ max = 300000, name, page }) {
    if (localRec) { localRec.control('stop'); return { ok: true }; } // the same command again stops
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return { error: T('Этот браузер не умеет записывать экран') };
    const rect = await pickArea(T('Выделите область для видео · Esc — отмена'), { video: true });
    if (!rect) return { ok: true }; // cancelled
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false }); } catch (e) {
      if (e && e.name === 'NotAllowedError') { toast(T('Запись отменена')); return { ok: true }; }
      return { error: T('Запись не началась: ') + ((e && e.message) || e) };
    }
    const [track] = stream.getVideoTracks();
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* plays once frames come */ }
    toast(T('Ищу область на экране…'), 'busy');
    let crop;
    try { crop = await findFrame(video, rect); } catch (e) { crop = null; }
    if (!crop) {
      track.stop();
      return { error: T('Не нашёл область на том, что показал браузер: при записи выберите окно Zen (или весь экран), а не другое окно') };
    }
    const cv = document.createElement('canvas');
    cv.width = crop.w; cv.height = crop.h;
    const cx = cv.getContext('2d');
    let on = true;
    const draw = () => { if (on && video.videoWidth) cx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h); };
    const loop = () => { if (!on) return; draw(); if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop); };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop);
    const tick = video.requestVideoFrameCallback ? 0 : setInterval(draw, 33);
    draw();
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const bits = Math.min(16e6, Math.max(2e6, crop.w * crop.h * 30 * 0.1));
    const rec = new MediaRecorder(cv.captureStream(30), { mimeType: type, videoBitsPerSecond: bits });
    const parts = [];
    let cancel = false;
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const job = {
      control(what) {
        if (what === 'pause' && rec.state === 'recording') rec.pause();
        else if (what === 'resume' && rec.state === 'paused') rec.resume();
        else if ((what === 'stop' || what === 'cancel') && rec.state !== 'inactive') { cancel = what === 'cancel'; rec.stop(); }
      },
    };
    rec.onstop = () => {
      on = false;
      clearInterval(tick);
      clearTimeout(limit);
      track.stop();
      localRec = null;
      recEnd();
      if (cancel) return;
      const blob = new Blob(parts, { type: 'video/webm' });
      if (!blob.size) { toast(T('Запись пустая'), 'err'); return; }
      toast(T('Сохраняю видео…'), 'busy');
      chrome.runtime.sendMessage({ t: 'recFile', blob, name, page: page || location.href }).catch(() => toast(T('Расширение перезагружено: обновите страницу'), 'err'));
    };
    // «Прекратить показ» in the browser's own bar: what was recorded is kept
    track.addEventListener('ended', () => job.control('stop'));
    addEventListener('pagehide', () => job.control('stop'), { once: true });
    const limit = setTimeout(() => job.control('stop'), max);
    localRec = job;
    rec.start(1000);
    recUi({ rect, elapsed: 0, paused: false, max });
    toast(T('Идёт запись · «Стоп» под рамкой'));
    return { ok: true };
  }
  // the frame on the captured picture: the magenta border's pixels that were not there a moment before
  async function findFrame(video, rect) {
    for (let i = 0; i < 40 && !video.videoWidth; i++) await sleep(50);
    const W = video.videoWidth, H = video.videoHeight;
    if (!W || !H) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const grab = () => { g.drawImage(video, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
    const pink = (d, i) => d[i] > 200 && d[i + 1] < 80 && d[i + 2] > 200;
    await sleep(350);
    const before = grab();
    const m = document.createElement('div');
    m.className = 'mark-cal';
    Object.assign(m.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    root.appendChild(m);
    let box = null;
    try {
      for (let tries = 0; tries < 6 && !box; tries++) {
        await sleep(220);
        const after = grab();
        let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (pink(after, i) && !pink(before, i)) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
        }
        // a real border: enough pixels, and a box of about the frame's proportions
        if (n > 40 && x1 > x0 + 8 && y1 > y0 + 8 && Math.abs((x1 - x0) / (y1 - y0) - rect.w / rect.h) < 0.12 * (rect.w / rect.h) + 0.05) box = { x0, y0, x1, y1 };
      }
    } finally { m.remove(); }
    if (!box) return null;
    const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
    await sleep(120); // the border must be gone from the captured picture before the first recorded frame
    return { x: box.x0, y: box.y0, w: even(box.x1 - box.x0 + 1), h: even(box.y1 - box.y0 + 1) };
  }

  /* ---------- all pictures of the page ---------- */
  function collect() {
    const seen = new Map();
    const add = (url, w, h, alt) => {
      if (!url || placeholder(url) || /^blob:/i.test(url)) return;
      const o = seen.get(url);
      if (!o) seen.set(url, { url, w, h, alt: alt || '' });
      else { o.w = Math.max(o.w, w); o.h = Math.max(o.h, h); }
    };
    for (const img of document.images) add(bestOf(img), img.naturalWidth, img.naturalHeight, img.alt);
    for (const v of document.querySelectorAll('video[poster]')) add(abs(v.poster), v.videoWidth, v.videoHeight, document.title);
    for (const a of document.querySelectorAll('a[href]')) if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(a.href)) add(a.href, 0, 0, a.textContent.trim());
    // painted backgrounds, only on elements big enough to be a picture
    for (const el of document.querySelectorAll('body *')) {
      if (el.offsetWidth < 120 || el.offsetHeight < 90) continue;
      const m = getComputedStyle(el).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
      if (m) add(abs(m[1]), 0, 0, '');
    }
    const og = document.querySelector('meta[property="og:image"]');
    if (og) add(abs(og.content), 0, 0, document.title);
    return [...seen.values()];
  }
  // pictures with unknown size are measured by loading them (from the browser cache, mostly)
  const measure = (it) => (it.w ? Promise.resolve(it) : new Promise((res) => {
    const im = new Image();
    im.onload = () => { it.w = im.naturalWidth; it.h = im.naturalHeight; res(it); };
    im.onerror = () => res(it);
    im.src = it.url;
    setTimeout(() => res(it), 4000);
  }));

  async function gallery() {
    mount();
    if ($('.gal')) return;
    const g = document.createElement('div');
    g.className = 'gal';
    g.innerHTML = `<header><h2>${T('Картинки страницы')}<em></em></h2>
      <label>${T('от')} <input type="range" min="0" max="1200" step="50"> <b></b></label>
      <button class="btn" data-a="all">${T('Выбрать все')}</button><button class="btn" data-a="none">${T('Снять')}</button>
      <button class="btn pri" data-a="save" disabled>${T('Сохранить')}</button><button class="btn" data-a="close">${T('Закрыть')}</button></header>
      <div class="grid"><div class="empty">${T('Ищу картинки…')}</div></div>`;
    root.appendChild(g);
    const range = g.querySelector('input'), grid = g.querySelector('.grid'), save = g.querySelector('[data-a=save]');
    range.value = prefs.minSize || 200;
    const picked = new Set();
    let items = [];
    const close = () => { g.remove(); removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    addEventListener('keydown', key, true);
    const keyOf = (it) => it.embed || it.url;
    // videos are always shown: their cover's size says nothing about the video
    const shown = () => items.filter((it) => it.embed || Math.max(it.w, it.h) >= +range.value);
    const sync = () => {
      const vis = shown();
      [...picked].forEach((u) => { if (!vis.some((it) => keyOf(it) === u)) picked.delete(u); });
      save.disabled = !picked.size;
      save.textContent = picked.size ? T('Сохранить {n} в Oddments', { n: picked.size }) : T('Сохранить');
      g.querySelector('h2 em').textContent = `(${vis.length})`;
      g.querySelector('label b').textContent = range.value + ' px';
    };
    const render = () => {
      const vis = shown();
      grid.innerHTML = vis.length ? '' : '<div class="empty">' + T('Нет картинок такого размера — сдвиньте ползунок влево') + '</div>';
      for (const it of vis) {
        const t = document.createElement('button');
        t.className = 'tile' + (picked.has(keyOf(it)) ? ' on' : '');
        t.innerHTML = `<img loading="lazy" referrerpolicy="no-referrer"><small></small>`;
        t.querySelector('small').textContent = (it.embed ? '▶ Vimeo · ' : '') + (it.w && it.h ? it.w + '×' + it.h : '?');
        if (it.url) t.querySelector('img').src = it.url;
        t.title = it.alt || it.url;
        t.onclick = () => { picked.has(keyOf(it)) ? picked.delete(keyOf(it)) : picked.add(keyOf(it)); t.classList.toggle('on'); sync(); };
        grid.appendChild(t);
      }
      sync();
    };
    range.oninput = render;
    range.onchange = () => chrome.storage.local.set({ minSize: +range.value });
    g.querySelector('[data-a=all]').onclick = () => { shown().forEach((it) => picked.add(keyOf(it))); render(); };
    g.querySelector('[data-a=none]').onclick = () => { picked.clear(); render(); };
    g.querySelector('[data-a=close]').onclick = close;
    save.onclick = () => {
      const list = items.filter((it) => picked.has(keyOf(it))).map((it) => (it.embed ? { embed: it.embed } : { url: it.url, alt: it.alt }));
      close();
      send({ t: 'saveMany', items: list });
    };
    const frames = [...document.querySelectorAll('iframe')].filter(isEmbed);
    const ids = [...new Set(frames.map((f) => f.src.match(/video\/(\d+)/)[1]))];
    const info = ids.length ? (await chrome.runtime.sendMessage({ t: 'embedInfo', ids }).catch(() => [])) || [] : [];
    const vids = ids.map((id) => {
      const x = info.find((i) => i.id === id) || {};
      return { url: x.thumb || '', w: x.w || 0, h: x.h || 0, alt: x.title || 'Vimeo ' + id, embed: frames.find((f) => f.src.includes('/video/' + id)).src };
    });
    items = await Promise.all(collect().map(measure));
    items.sort((a, b) => b.w * b.h - a.w * a.h);
    items = [...vids, ...items]; // the page's videos first
    render();
  }
  // the block grabber (block.js) draws in the same overlay and talks through the same channel
  window.__odd = { root, host, mount, toast, send, alive: () => alive };
})();
