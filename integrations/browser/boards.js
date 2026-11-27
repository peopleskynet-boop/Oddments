// Oddments for browsers: «Забрать доску целиком», the page side. Injected by the background (background.js
// grabBoards) only when a board is being taken, into the content script's overlay (window.__odd). It lists the boards
// of a profile and lets the person tick them, scrolls a board at a person's pace and gathers its pictures and videos as
// the page itself shows them (Pinterest — the original of every pin, a video pin's stream; Cosmos — the original file
// of every element; Savee — the biggest picture of every item), and shows everything for a last look before sending.
// Are.na is read through its API in the background; only its lists and the last look are drawn here.
(() => {
  const ui = window.__odd;
  if (!ui || ui.boards) return;
  ui.boards = true;
  const { root, mount, toast } = ui;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  // Russian counts: 1 доска, 2 доски, 5 досок
  const plural = (n, forms) => { const a = n % 10, b = n % 100; return forms[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 1 : 2]; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style');
  css.textContent = `
    .bp { position: fixed; left: 20px; bottom: 20px; width: 320px; padding: 14px 14px 12px 16px; border-radius: 22px; background: var(--bg); color: var(--fg);
      backdrop-filter: blur(18px) saturate(1.4); box-shadow: 0 16px 50px rgba(0,0,0,.4); font-size: 13px; display: grid; gap: 8px; }
    .bp b { font-weight: 500; }
    .bp small { color: var(--mut); font-size: 12px; }
    .bp .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.08); overflow: hidden; }
    .bp .bar i { display: block; height: 100%; width: 0; background: var(--acc); border-radius: 4px; transition: width .3s; }
    .bp .bar.free i { width: 30% !important; animation: slide 1.2s ease-in-out infinite alternate; }
    @keyframes slide { from { transform: translateX(-20%); } to { transform: translateX(260%); } }
    .bp .row { display: flex; align-items: center; gap: 8px; }
    .bp .row small { flex: 1; }
    .bp .btn { height: 30px; font-size: 12.5px; }
    .bm { position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(8,9,13,.9); backdrop-filter: blur(10px); color: var(--fg); display: flex; flex-direction: column; }
    .bm header { display: flex; gap: 10px; align-items: center; padding: 18px 24px; flex-wrap: wrap; }
    .bm h2 { margin: 0 auto 0 0; font-size: 18px; font-weight: 500; }
    .bm h2 em { font-style: normal; color: var(--mut); margin-left: 6px; font-size: 14px; }
    .bm .note { padding: 0 24px 10px; color: var(--mut); font-size: 12.5px; }
    .bm .body { flex: 1; overflow: auto; padding: 0 24px 24px; }
    .bm h3 { margin: 18px 2px 10px; font: 500 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--mut); }
    .bm h3::before { content: "// "; color: var(--acc); }
    .bm h3 em { font-style: normal; margin-left: 6px; }
    .bm .grid { padding: 0; }
    .tile .seen { position: absolute; left: 8px; top: 8px; padding: 3px 8px; border-radius: 999px; background: rgba(0,0,0,.65); color: #ddd; font-size: 11px; }
    .tile.old img { opacity: .38; }
    .tile .kind { position: absolute; right: 9px; bottom: 8px; padding: 3px 7px; border-radius: 999px; background: rgba(0,0,0,.6); color: #fff; font-size: 11px; }
    .tile .ph { width: 100%; height: 100%; display: grid; place-items: center; padding: 12px; color: var(--mut); font-size: 12px; text-align: center; word-break: break-word; }
    .bl { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
    .bl label { display: flex; align-items: center; gap: 12px; padding: 8px 12px 8px 8px; border-radius: 18px; background: rgba(255,255,255,.04); cursor: pointer; }
    .bl label:hover { background: rgba(215,255,99,.07); }
    .bl img, .bl .nocov { width: 52px; height: 52px; border-radius: 12px; object-fit: cover; flex: none; background: rgba(255,255,255,.06); }
    .bl span { flex: 1; min-width: 0; }
    .bl b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bl small { color: var(--mut); font-size: 12px; }
    .bl input { accent-color: var(--acc); width: 18px; height: 18px; }
  `;
  root.appendChild(css);

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!ui.alive()) return;
    const go = (p) => { p.then(reply, (e) => { console.warn('Oddments', e); reply(null); }); return true; };
    if (msg.t === 'boardList') return go(listBoards(msg.where));
    if (msg.t === 'boardChoose') return go(choose(msg.where, msg.boards));
    if (msg.t === 'boardCollect') return go(collect(msg));
    if (msg.t === 'boardReview') return go(review(msg.groups, msg.known || []));
    if (msg.t === 'boardProgress') { progress(msg); reply(true); }
    // Are.na's API answers the site's own pages (an extension's background is turned away): asked from here
    if (msg.t === 'arenaApi') {
      fetch('https://api.are.na/v3' + msg.path, { headers: msg.token ? { Authorization: 'Bearer ' + msg.token } : {}, credentials: 'omit' })
        .then(async (r) => reply({ status: r.status, json: r.ok ? await r.json() : null }), (e) => reply({ status: 0, error: String(e && e.message || e) }));
      return true;
    }
  });

  /* ---------- the progress card ---------- */
  let card = null, stopped = false;
  function progress({ text, sub, n, all, step, steps, done }) {
    if (done) { if (card) card.remove(); card = null; return; }
    mount();
    if (!card) {
      card = document.createElement('div');
      card.className = 'bp rim';
      card.innerHTML = `<b></b><div class="bar"><i></i></div><div class="row"><small></small><button class="btn" type="button"></button></div>`;
      const stop = card.querySelector('button');
      stop.textContent = T('Остановить');
      stop.onclick = () => { stopped = true; stop.disabled = true; chrome.runtime.sendMessage({ t: 'boardStop' }).catch(() => {}); };
      root.appendChild(card);
    }
    if (text != null) card.querySelector('b').textContent = text;
    const left = [sub || '', steps > 1 ? T('доска {i} из {n}', { i: step, n: steps }) : ''].filter(Boolean).join(' · ');
    card.querySelector('small').textContent = left;
    const bar = card.querySelector('.bar');
    bar.classList.toggle('free', !all);
    if (all) bar.querySelector('i').style.width = Math.min(100, Math.round((n || 0) / all * 100)) + '%';
  }

  /* ---------- a profile's boards ---------- */
  const pinState = () => { try { return JSON.parse(document.getElementById('__PWS_INITIAL_PROPS__').textContent).initialReduxState || {}; } catch (e) { return {}; } };
  async function listBoards(where) {
    const found = new Map();
    const read = () => {
      for (const a of document.querySelectorAll('a[href]')) {
        const u = new URL(a.getAttribute('href'), location.href);
        if (u.origin !== location.origin) continue;
        const seg = u.pathname.split('/').filter(Boolean);
        if (where.service === 'Pinterest') {
          if (seg.length !== 2 || seg[0].toLowerCase() !== where.user.toLowerCase() || seg[1].startsWith('_')) continue;
        } else if (where.service === 'Cosmos') {
          if (seg.length !== 2 || seg[0].toLowerCase() !== where.user.toLowerCase() || /^(collections|clusters)$/i.test(seg[1])) continue;
        } else continue;
        const url = u.origin + '/' + seg.join('/') + (where.service === 'Pinterest' ? '/' : '');
        if (found.has(url)) continue;
        const img = a.querySelector('img');
        const text = (a.innerText || a.getAttribute('aria-label') || '').split('\n').map((s) => s.trim()).filter(Boolean);
        found.set(url, { url, name: (text[0] || decodeURIComponent(seg[1]).replace(/-/g, ' ')).replace(/,\s*[\d.,]+\s*[kKкК]?\s*\S*$/, ''), cover: img ? img.currentSrc || img.src : '', count: 0 });
      }
    };
    progress({ text: T('Ищу доски профиля…') });
    // the profile's grid loads as it is scrolled
    let still = 0, before = -1;
    for (let i = 0; i < 40 && still < 3 && !stopped; i++) {
      read();
      still = found.size === before ? still + 1 : 0;
      before = found.size;
      scrollBy(0, Math.round(innerHeight * 0.9));
      await sleep(700);
    }
    read();
    scrollTo(0, 0);
    progress({ done: true });
    // Pinterest knows the boards' real names and counts
    const st = pinState();
    for (const b of Object.values(st.boards || {})) {
      const it = found.get(location.origin + b.url);
      if (it) { it.name = b.name || it.name; it.count = b.pin_count || 0; }
    }
    return [...found.values()];
  }

  // the ticks: every board is ticked, the person unticks what they do not want
  function choose(where, boards) {
    return new Promise((resolve) => {
      mount();
      const m = document.createElement('div');
      m.className = 'bm';
      m.innerHTML = `<header><h2></h2><button class="btn" data-a="all"></button><button class="btn" data-a="none"></button>
        <button class="btn pri" data-a="go"></button><button class="btn" data-a="close"></button></header><div class="body"><div class="bl"></div></div>`;
      m.querySelector('h2').innerHTML = esc(T('{service}: какие доски забрать', { service: where.service })) + `<em>(${boards.length})</em>`;
      m.querySelector('[data-a=all]').textContent = T('Выбрать все');
      m.querySelector('[data-a=none]').textContent = T('Снять');
      m.querySelector('[data-a=close]').textContent = T('Отмена');
      const list = m.querySelector('.bl');
      for (const b of boards) {
        const l = document.createElement('label');
        l.innerHTML = `${b.cover ? `<img referrerpolicy="no-referrer" alt="">` : '<i class="nocov"></i>'}<span><b></b><small></small></span><input type="checkbox" checked>`;
        if (b.cover) l.querySelector('img').src = b.cover;
        l.querySelector('b').textContent = b.name;
        l.querySelector('small').textContent = b.count ? T('{n} шт.', { n: b.count.toLocaleString(oddLang() === 'en' ? 'en' : 'ru') }) : '';
        l.querySelector('input').__b = b;
        list.appendChild(l);
      }
      const go = m.querySelector('[data-a=go]');
      const boxes = () => [...list.querySelectorAll('input')];
      const sync = () => { const n = boxes().filter((x) => x.checked).length; go.textContent = T('Забрать: {n}', { n }); go.disabled = !n; };
      list.addEventListener('change', sync);
      sync();
      const end = (v) => { m.remove(); removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(null); } };
      addEventListener('keydown', key, true);
      m.querySelector('[data-a=all]').onclick = () => { boxes().forEach((x) => { x.checked = true; }); sync(); };
      m.querySelector('[data-a=none]').onclick = () => { boxes().forEach((x) => { x.checked = false; }); sync(); };
      m.querySelector('[data-a=close]').onclick = () => end(null);
      go.onclick = () => end(boxes().filter((x) => x.checked).map((x) => x.__b));
      root.appendChild(m);
    });
  }

  /* ---------- one board ---------- */
  // a name worth keeping: not Pinterest's «Pin» and without its «This may contain:» prefix
  const nameOf = (alt) => {
    const s = String(alt || '').replace(/^(this may contain|это может быть|может содержать)\s*:\s*/i, '').replace(/\s+/g, ' ').trim();
    return /^(pin|пин|image|изображение|an image uploaded.*|a video uploaded.*)\.?$/i.test(s) ? '' : s.slice(0, 90);
  };
  function largest(srcset) {
    const c = (srcset || '').split(/,\s+(?=\S)/).map((s) => s.trim().split(/\s+/)).filter((p) => p[0]);
    if (!c.length) return '';
    const size = (d) => (d ? parseFloat(d) * (/x$/.test(d) ? 1000 : 1) : 1);
    return c.sort((a, b) => size(b[1]) - size(a[1]))[0][0];
  }

  // Pinterest: the cards of the board's own grid (not «More ideas»); a pin's original is /originals/ of its picture
  const PIN_SIZE = /\/(\d+x\d*(?:_RS)?|originals)\//;
  function pinItems() {
    const feed = document.querySelector('[data-test-id="board-feed"]') || document.querySelector('[data-test-id="masonry-container"]') || document.querySelector('[role="list"]') || document.body;
    const out = [];
    for (const card of feed.querySelectorAll('[data-grid-item="true"], [data-test-id="pin"]')) {
      const img = card.querySelector('img[src*="pinimg.com"]');
      if (!img) continue;
      const src = abs(largest(img.getAttribute('srcset')) || img.currentSrc || img.src);
      const hash = (src.match(/\/([0-9a-f]{16,})\.[a-z0-9]+(?:\?|$)/i) || [])[1];
      if (!hash || !PIN_SIZE.test(src)) continue;
      const a = card.querySelector('a[href*="/pin/"]');
      const pin = a ? abs(a.getAttribute('href')).replace(/[?#].*$/, '') : '';
      const v = card.querySelector('video');
      out.push({
        key: hash, src: 'pinterest:' + hash, kind: v && pinHls(v) ? 'hls' : 'file', hls: v ? pinHls(v) : '',
        url: src.replace(PIN_SIZE, '/originals/'), alt: ['/736x/', '/564x/', '/474x/'].map((z) => src.replace(PIN_SIZE, z)),
        thumb: img.currentSrc || img.src, name: nameOf(img.alt), note: nameOf(img.alt) ? (img.alt || '').trim() : '', link: pin || location.href.replace(/[?#].*$/, ''),
      });
    }
    return out;
  }
  // a video pin's stream: its poster names the same hash as its playlist (as in content.js)
  function pinHls(v) {
    const m = String(v.poster || '').match(/\/videos\/thumbnails\/originals\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{16,})\./i);
    if (!m) return /\.m3u8(\?|$)/.test(v.currentSrc || v.src || '') ? v.currentSrc || v.src : '';
    const hash = m[1].split('/').pop();
    const seen = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(hash) && /\.m3u8(\?|$)/.test(n) && !/_\d+w\.m3u8|_audio\.m3u8/.test(n));
    return seen || `https://v1.pinimg.com/videos/iht/hls/${m[1]}.m3u8`;
  }
  // Cosmos: every element's picture (cdn.cosmos.so/<id> without the size is the original) and every video file
  function cosmosItems() {
    const out = [];
    for (const img of document.querySelectorAll('img[data-testid="element-image-img"], main img[src*="cdn.cosmos.so"]')) {
      const u = abs(img.currentSrc || img.src);
      const id = (u.match(/cdn\.cosmos\.so\/([0-9a-f-]{20,})/i) || [])[1];
      if (!id || img.closest('a[href$="/collections"]') || (img.width && img.width < 90)) continue;
      out.push({ key: id, src: 'cosmos:' + id, kind: 'file', url: 'https://cdn.cosmos.so/' + id, alt: [u], thumb: u, name: nameOf(img.alt), note: nameOf(img.alt) ? img.alt.trim() : '', link: location.href.replace(/[?#].*$/, '') });
    }
    for (const v of document.querySelectorAll('video')) {
      const u = abs(v.currentSrc || v.src || (v.querySelector('source') || {}).src || '');
      const id = (u.match(/cdn\.cosmos\.so\/([0-9a-f-]{20,})/i) || [])[1];
      if (!id) continue;
      out.push({ key: id, src: 'cosmos:' + id, kind: 'file', url: u, thumb: abs(v.poster || ''), video: true, name: nameOf(v.title), note: nameOf(v.title) ? v.title.trim() : '', link: location.href.replace(/[?#].*$/, '') });
    }
    return out;
  }
  // Savee: the items' pictures (its own CDN) and videos; small pictures (avatars, icons) are left
  function saveeItems() {
    const out = [];
    for (const img of document.images) {
      const u = abs(largest(img.getAttribute('srcset')) || img.currentSrc || img.src);
      if (!/savee(-cdn)?\.(com|it)|savee\.it/i.test(u) || /\/(avatar|avatars|static|img\/new-home)\//i.test(u)) continue;
      const r = img.getBoundingClientRect();
      if (Math.max(r.width, img.naturalWidth) < 120) continue;
      const key = new URL(u).pathname.split('/').filter(Boolean).pop().replace(/\.[a-z0-9]+$/i, '');
      const a = img.closest('a[href]');
      out.push({ key, src: 'savee:' + key, kind: 'file', url: u, thumb: img.currentSrc || img.src, name: nameOf(img.alt), note: (img.alt || '').trim(), link: a ? abs(a.getAttribute('href')) : location.href });
    }
    for (const v of document.querySelectorAll('video')) {
      const u = abs(v.currentSrc || v.src || (v.querySelector('source') || {}).src || '');
      if (!/^https?:/.test(u) || !/savee/i.test(u)) continue;
      const key = new URL(u).pathname.split('/').filter(Boolean).pop().replace(/\.[a-z0-9]+$/i, '');
      out.push({ key, src: 'savee:' + key, kind: 'file', url: u, thumb: abs(v.poster || ''), video: true, name: '', note: '', link: location.href });
    }
    return out;
  }

  // scrolled at a person's pace: a screen at a time, a short pause, until the end of the board (or the count it shows)
  async function scrollCollect(read, expect, label, step, steps) {
    const items = new Map();
    stopped = false;
    scrollTo(0, 0);
    await sleep(600);
    let idle = 0;
    for (let i = 0; i < 3000 && !stopped; i++) {
      for (const it of read()) if (!items.has(it.key)) items.set(it.key, it);
      progress({ text: label, sub: expect ? T('{n} из {all}', { n: items.size, all: expect }) : T('найдено: {n}', { n: items.size }), n: items.size, all: expect, step, steps });
      if (expect && items.size >= expect) break;
      const bottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 8;
      if (bottom) { idle++; if (idle >= 5) break; } else idle = 0;
      scrollBy(0, Math.round(innerHeight * 0.8));
      await sleep(650 + Math.random() * 350);
    }
    for (const it of read()) if (!items.has(it.key)) items.set(it.key, it);
    return [...items.values()];
  }

  async function collect({ where, parent, step, steps }) {
    mount();
    if (!where) return null;
    // the board's name and how many it holds, as the page shows them
    const h1 = document.querySelector('[data-test-id="board-title"] h1, [data-test-id="board-title"], h1');
    let name = ((h1 && h1.innerText) || where.name || '').split('\n')[0].trim();
    let expect = 0, sections = [], path;
    if (where.service === 'Pinterest') {
      const st = pinState();
      const boardUrl = `/${where.user}/${where.board}/`.toLowerCase();
      const b = Object.values(st.boards || {}).find((x) => String(x.url || '').toLowerCase() === boardUrl);
      const boardName = (b && b.name) || (where.section ? decodeURIComponent(where.board).replace(/-/g, ' ') : name);
      const boardKey = 'pinterest:board:' + `${where.user}/${where.board}`.toLowerCase();
      if (where.section) {
        const s = Object.values(st.boardsections || {}).find((x) => String(x.slug || '').toLowerCase() === where.section.toLowerCase());
        name = (s && s.title) || name || where.name;
        expect = (s && s.pin_count) || 0;
        path = [...(parent || [['pinterest', 'Pinterest'], [boardKey, boardName]]), ['pinterest:section:' + `${where.user}/${where.board}/${where.section}`.toLowerCase(), name]];
      } else {
        name = boardName || name;
        expect = (b && b.pin_count) || parseInt(((document.querySelector('[data-test-id="pin-count"]') || {}).innerText || '').replace(/\D+/g, ''), 10) || 0;
        path = [['pinterest', 'Pinterest'], [boardKey, name]];
        // the board's sections: links one level below it
        const seenS = new Set();
        for (const a of document.querySelectorAll(`a[href]`)) {
          const u = new URL(a.getAttribute('href'), location.href);
          const seg = u.pathname.split('/').filter(Boolean);
          if (u.origin !== location.origin || seg.length !== 3 || seg[0].toLowerCase() !== where.user.toLowerCase() || seg[1].toLowerCase() !== where.board.toLowerCase()) continue;
          if (seg[2].startsWith('_') || /^(more_ideas|organize|ideas)$/i.test(seg[2]) || seenS.has(seg[2])) continue;
          seenS.add(seg[2]);
          sections.push({ url: u.origin + '/' + seg.join('/') + '/', name: (a.innerText || '').split('\n')[0].trim() || seg[2] });
        }
        // sections hold their own pins; the board's count includes them
        if (sections.length && b && b.pin_count) expect = 0;
      }
    } else if (where.service === 'Cosmos') {
      name = name || where.name;
      path = [['cosmos', 'Cosmos'], ['cosmos:' + `${where.user}/${where.board}`.toLowerCase(), name]];
    } else {
      name = name || document.title.replace(/\s*[|·—-]\s*Savee.*$/i, '') || where.name;
      path = [['savee', 'Savee'], ['savee:' + `${where.user}/${where.board}`.toLowerCase().replace(/\/$/, ''), name]];
    }
    const read = where.service === 'Pinterest' ? pinItems : where.service === 'Cosmos' ? cosmosItems : saveeItems;
    const label = `${where.service} · ${name}`;
    let items = await scrollCollect(read, expect, label, step, steps);
    let n = 0;
    items = items.map((it) => ({ ...it, path, name: it.name || `${name} ${++n}` }));
    return { name, path, items, sections, expect };
  }

  /* ---------- the last look ---------- */
  // every board in its own block; what Oddments already has is shown dimmed and unticked
  function review(groups, known) {
    return new Promise((resolve) => {
      progress({ done: true });
      mount();
      const have = new Set(known);
      const all = groups.flatMap((g) => g.items);
      const picked = new Set(all.filter((it) => !have.has(it.src)).map((it) => it.src));
      const m = document.createElement('div');
      m.className = 'bm';
      m.innerHTML = `<header><h2></h2><button class="btn" data-a="new"></button><button class="btn" data-a="none"></button>
        <button class="btn pri" data-a="go"></button><button class="btn" data-a="close"></button></header><div class="note"></div><div class="body"></div>`;
      const service = (groups[0] && groups[0].path[0][1]) || '';
      const boardsN = new Set(groups.map((g) => g.path[1][0])).size;
      m.querySelector('h2').innerHTML = esc(boardsN === 1 ? `${service} · ${groups[0].path[1][1]}` : T('{service}: {n} ' + plural(boardsN, ['доска', 'доски', 'досок']), { service, n: boardsN })) + `<em>(${all.length})</em>`;
      m.querySelector('[data-a=new]').textContent = T('Выбрать новые');
      m.querySelector('[data-a=none]').textContent = T('Снять');
      m.querySelector('[data-a=close]').textContent = T('Отмена');
      const old = all.length - picked.size;
      const skipped = groups.reduce((s, g) => s + (g.skipped || 0), 0);
      const notes = [];
      if (old) notes.push(T('Уже в Oddments: {n} — они не выбраны.', { n: old }));
      if (skipped) notes.push(T('Текстовые блоки и вложенные каналы не переносятся: {n}.', { n: skipped }));
      // a site that shows a guest only the start of a board (Pinterest: 25 pins)
      const short = groups.find((g) => g.expect && g.items.length < g.expect * 0.9);
      if (short) notes.push(T('{service} показал {n} из {all}: без входа в аккаунт он даёт только начало доски. Войдите и заберите доску ещё раз — добавится только новое.', { service, n: short.items.length, all: short.expect }));
      notes.push((boardsN > 1 ? T('Попадут в подборку «{service}», каждая доска — своей подборкой в ней.', { service })
        : T('Попадут в подборку «{path}».', { path: groups[0] ? groups[0].path.slice(0, 2).map((p) => p[1]).join(' › ') : '' })) + (groups.some((g) => g.path.length > 2) ? ' ' + T('Разделы доски — вложенными подборками.') : ''));
      m.querySelector('.note').textContent = notes.join(' ');
      const body = m.querySelector('.body');
      // thumbnails load as they come near (loading=lazy does not fire inside this overlay)
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.src = e.target.dataset.src; io.unobserve(e.target); } }), { root: body, rootMargin: '800px' });
      for (const g of groups) {
        const h = document.createElement('h3');
        h.innerHTML = esc(g.path.slice(1).map((p) => p[1]).join(' › ')) + `<em>(${g.items.length})</em>`;
        body.appendChild(h);
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (const it of g.items) {
          const t = document.createElement('button');
          t.type = 'button';
          t.className = 'tile' + (picked.has(it.src) ? ' on' : '') + (have.has(it.src) ? ' old' : '');
          t.title = it.name || '';
          if (it.thumb) t.innerHTML = `<img referrerpolicy="no-referrer" alt="">`;
          else t.innerHTML = `<div class="ph"></div>`;
          if (it.thumb) { const im = t.querySelector('img'); im.dataset.src = it.thumb; io.observe(im); }
          else t.querySelector('.ph').textContent = it.name || it.url;
          if (have.has(it.src)) t.insertAdjacentHTML('beforeend', `<span class="seen">${esc(T('уже в Oddments'))}</span>`);
          const kind = it.kind === 'link' ? T('ссылка') : it.kind === 'hls' || it.video ? T('видео') : it.file ? T('файл') : '';
          if (kind) t.insertAdjacentHTML('beforeend', `<span class="kind">${esc(kind)}</span>`);
          t.onclick = () => { picked.has(it.src) ? picked.delete(it.src) : picked.add(it.src); t.classList.toggle('on', picked.has(it.src)); sync(); };
          t.__src = it.src;
          grid.appendChild(t);
        }
        body.appendChild(grid);
      }
      const go = m.querySelector('[data-a=go]');
      const sync = () => { go.textContent = picked.size ? T('Сохранить {n} в Oddments', { n: picked.size }) : T('Сохранить'); go.disabled = !picked.size; };
      const redraw = () => { for (const t of body.querySelectorAll('.tile')) t.classList.toggle('on', picked.has(t.__src)); sync(); };
      sync();
      const end = (v) => { io.disconnect(); m.remove(); removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(null); } };
      addEventListener('keydown', key, true);
      m.querySelector('[data-a=new]').onclick = () => { picked.clear(); all.forEach((it) => { if (!have.has(it.src)) picked.add(it.src); }); redraw(); };
      m.querySelector('[data-a=none]').onclick = () => { picked.clear(); redraw(); };
      m.querySelector('[data-a=close]').onclick = () => end(null);
      go.onclick = () => { const out = all.filter((it) => picked.has(it.src)); end(out); toast(T('Сохраняю…'), 'busy'); };
      root.appendChild(m);
    });
  }
})();
