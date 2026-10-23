// Oddments for Chrome and Edge: the page side. Alt+click and the hover button save a picture (embedded Vimeo players —
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
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => toast('Расширение перезагружено: обновите страницу', 'err'));

  /* ---------- one shadow root for everything we draw ---------- */
  const host = document.createElement('perch-ui');
  host.style.cssText = 'all: initial; position: fixed; inset: 0 auto auto 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { --acc: #c6ff00; --bg: rgba(14, 15, 13, .92); --fg: #f2f3ee; --mut: #9a9c94; --line: rgba(255,255,255,.1); }
    * { box-sizing: border-box; font-family: "Golos Text", "Segoe UI", system-ui, sans-serif; }
    .toast { position: fixed; right: 20px; bottom: 20px; max-width: 360px; padding: 11px 18px 11px 14px; border-radius: 999px;
      background: var(--bg); color: var(--fg); font-size: 13px; line-height: 1.3; display: flex; gap: 10px; align-items: center;
      backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 10px 40px rgba(0,0,0,.35), inset 0 0 0 1px var(--line);
      transform: translateY(14px) scale(.96); opacity: 0; transition: transform .38s cubic-bezier(.32,1.28,.6,1), opacity .2s; pointer-events: none; }
    .toast.on { transform: none; opacity: 1; }
    .toast i { width: 8px; height: 8px; border-radius: 50%; background: var(--acc); flex: none; }
    .toast.err i { background: #ff2d6f; }
    .toast.busy i { animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: .3; } }
    .hov { position: fixed; padding: 6px 12px 6px 9px; border: 0; border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 12px;
      cursor: pointer; display: none; align-items: center; gap: 7px; box-shadow: 0 4px 18px rgba(0,0,0,.3), inset 0 0 0 1px var(--line); }
    .hov.on { display: flex; }
    .hov:hover { background: var(--acc); color: #0a0b09; }
    .hov i, .dock i { width: 9px; height: 9px; border-radius: 3px; border: 2px solid currentColor; position: relative; }
    .dock { position: fixed; right: 18px; top: 50%; width: 132px; height: 132px; margin-top: -66px; border-radius: 34px; display: none;
      flex-direction: column; gap: 10px; align-items: center; justify-content: center; text-align: center; padding: 14px;
      background: var(--bg); color: var(--fg); font-size: 12px; line-height: 1.3; box-shadow: 0 16px 50px rgba(0,0,0,.4), inset 0 0 0 1px var(--line);
      transition: transform .3s cubic-bezier(.32,1.28,.6,1), background .15s; }
    .dock.on { display: flex; }
    .dock.over { transform: scale(1.08); background: var(--acc); color: #0a0b09; }
    .dock i { width: 22px; height: 22px; border-radius: 7px; border-width: 2.5px; }
    .area { position: fixed; inset: 0; width: 100vw; height: 100vh; cursor: crosshair; background: rgba(0,0,0,.28); }
    .area b { position: fixed; border: 1.5px solid var(--acc); border-radius: 4px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.28); }
    .area span { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 12px; }
    .gal { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(6,7,5,.86); backdrop-filter: blur(10px); color: var(--fg);
      display: flex; flex-direction: column; }
    .gal header { display: flex; gap: 12px; align-items: center; padding: 18px 24px; flex-wrap: wrap; }
    .gal h2 { margin: 0 auto 0 0; font-size: 18px; font-weight: 500; }
    .gal h2 em { font-style: normal; color: var(--mut); margin-left: 6px; }
    .gal label { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--mut); }
    .gal input[type=range] { accent-color: var(--acc); width: 120px; }
    .btn { height: 34px; padding: 0 16px; border: 0; border-radius: 999px; background: rgba(255,255,255,.08); color: var(--fg); font-size: 13px; cursor: pointer; }
    .btn:hover { background: rgba(255,255,255,.14); }
    .btn.pri { background: var(--acc); color: #0a0b09; font-weight: 500; }
    .btn.pri:disabled { opacity: .4; cursor: default; }
    .grid { flex: 1; overflow: auto; padding: 4px 24px 24px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; align-content: start; }
    .tile { position: relative; aspect-ratio: 1; border-radius: 18px; overflow: hidden; background: rgba(255,255,255,.05); cursor: pointer; border: 0; padding: 0; }
    .tile img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .tile small { position: absolute; left: 8px; bottom: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(0,0,0,.6); color: #ddd; font-size: 11px; }
    .tile::after { content: ''; position: absolute; top: 9px; right: 9px; width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); background: rgba(0,0,0,.3); }
    .tile.on { box-shadow: inset 0 0 0 2.5px var(--acc); }
    .tile.on::after { background: var(--acc) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.5 10.5l3 3 6-7' fill='none' stroke='%230a0b09' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); box-shadow: none; }
    .tile:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
    .empty { grid-column: 1 / -1; padding: 60px 0; text-align: center; color: var(--mut); }
  </style><div class="toast"><i></i><span></span></div><button class="hov"><i></i>В Oddments</button><div class="dock"><i></i>Бросьте сюда — в Oddments</div>`;
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
    } else if (msg.t === 'pickArea') { pickArea().then(reply); return true; }
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
    toast('Сохраняю…', 'busy');
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
    toast('Сохраняю видео…', 'busy');
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
    toast('Сохраняю видео…', 'busy');
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
      toast('Сохраняю…', 'busy');
      return send({ t: 'saveFile', url: src, page: location.href, alt: document.title });
    }
    const link = postOf(v), title = document.title;
    if (record) return recordVideo(v, link, title);
    // Pinterest and Instagram play a stream (blob:), but the video itself can be had: Pinterest — the pin goes as a
    // link and Oddments downloads its MP4; Instagram — the post's own video file, asked for as the page itself does
    if (/(^|\.)pinterest\./i.test(location.hostname)) {
      const pin = pinOf(v), hls = pinStream(v);
      if (hls) { toast('Сохраняю видео…', 'busy'); return send({ t: 'savePinVideo', hls, pin, title: pinName(v) }); }
      if (pin) { toast('Сохраняю видео…', 'busy'); return send({ t: 'saveLink', url: pin, title }); }
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
      toast('Сохраняю кадр…', 'busy');
      send({ t: 'saveFrame', data, link, title });
    } catch (er) {
      // a video from another site without CORS taints the canvas: the post goes as a link
      toast('Кадр не взять — сохраняю ссылку', 'busy');
      send({ t: 'saveLink', url: link, title });
    }
  }
  function recordVideo(v, link, title) {
    let stream;
    try { stream = v.captureStream ? v.captureStream() : null; } catch (er) { stream = null; }
    if (!stream) { toast('Это видео не записать — сохраните кадр (Alt+клик)', 'err'); return; }
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
      if (!blob.size) { toast('Запись пустая', 'err'); return; }
      const f = new FileReader();
      f.onload = () => { toast('Сохраняю запись…', 'busy'); send({ t: 'saveRecording', data: f.result, link, title }); };
      f.readAsDataURL(blob);
    };
    rec = r;
    r.start(1000);
    if (v.paused) v.play().catch(() => {});
    toast('Записываю видео · Alt+клик — стоп', 'busy');
  }

  /* ---------- hover button ---------- */
  let hovImg = null, hideT = null;
  // Vimeo players embedded in the page (Behance animations): their hover button and Alt+click live in the player's
  // own frame (embed.js) — the pointer over an iframe never reaches this page; here only the gallery lists them
  const VIMEO = /^https:\/\/player\.vimeo\.com\/video\/\d+/i;
  const isEmbed = (el) => el && el.tagName === 'IFRAME' && VIMEO.test(el.src);
  addEventListener('mouseover', (e) => {
    if (!alive || !prefs.hoverBtn) return;
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
    toast('Сохраняю…', 'busy');
    send({ t: 'saveFile', url: bestOf(hovImg), page: location.href, alt: hovImg.alt || document.title });
    $('.hov').classList.remove('on');
  });

  /* ---------- drag to the dock ---------- */
  let dragged = null;
  addEventListener('dragstart', (e) => {
    if (!alive) return;
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
    toast('Сохраняю…', 'busy');
    if (d.url) send({ t: 'saveFile', url: d.url, page: location.href, alt: d.alt || document.title });
    else send({ t: 'saveLink', url: d.link, title: d.title });
  });

  /* ---------- area screenshot ---------- */
  function pickArea() {
    return new Promise((resolve) => {
      mount();
      const ov = document.createElement('div');
      ov.className = 'area';
      ov.innerHTML = '<b hidden></b><span>Выделите область · Esc — отмена</span>';
      root.appendChild(ov);
      const box = ov.querySelector('b');
      let x0 = 0, y0 = 0, rect = null;
      const done = (r) => {
        removeEventListener('keydown', key, true);
        ov.remove();
        // the frame must be gone from the screen before the capture
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(r), 40)));
      };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      addEventListener('keydown', key, true);
      ov.addEventListener('pointerdown', (e) => {
        ov.setPointerCapture(e.pointerId);
        x0 = e.clientX; y0 = e.clientY;
        box.hidden = false;
        ov.querySelector('span').hidden = true;
        ov.style.background = 'none';
      });
      ov.addEventListener('pointermove', (e) => {
        if (box.hidden) return;
        rect = { x: Math.min(x0, e.clientX), y: Math.min(y0, e.clientY), w: Math.abs(e.clientX - x0), h: Math.abs(e.clientY - y0) };
        Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
      });
      ov.addEventListener('pointerup', () => done(rect && rect.w > 4 && rect.h > 4 ? { ...rect, vw: innerWidth } : null));
    });
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
    g.innerHTML = `<header><h2>Картинки страницы<em></em></h2>
      <label>от <input type="range" min="0" max="1200" step="50"> <b></b></label>
      <button class="btn" data-a="all">Выбрать все</button><button class="btn" data-a="none">Снять</button>
      <button class="btn pri" data-a="save" disabled>Сохранить</button><button class="btn" data-a="close">Закрыть</button></header>
      <div class="grid"><div class="empty">Ищу картинки…</div></div>`;
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
      save.textContent = picked.size ? `Сохранить ${picked.size} в Oddments` : 'Сохранить';
      g.querySelector('h2 em').textContent = `(${vis.length})`;
      g.querySelector('label b').textContent = range.value + ' px';
    };
    const render = () => {
      const vis = shown();
      grid.innerHTML = vis.length ? '' : '<div class="empty">Нет картинок такого размера — сдвиньте ползунок влево</div>';
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
