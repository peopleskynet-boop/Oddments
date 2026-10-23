// Oddments for Chrome and Edge: «Забрать блок» — a piece of a page's layout as a reference. The block under the
// pointer is framed with its size and kind; the wheel or ↑/↓ take the enclosing or the inner block; a click or Enter
// takes it. Saved as one .oddblock file (a ZIP, no compression): shot.png — the block as it looks (screens joined
// when it is taller than the window), block.html — its markup with the computed styles inlined (it opens live in
// Oddments, without scripts), block.json — size, kind, fonts, colours, the page. Tags (kind, site, fonts, dark or
// light) are put on by themselves.
(() => {
  if (window.__oddBlock) return;
  window.__oddBlock = true;
  const ui = window.__odd;
  if (!ui) return;
  const { root, host, mount, toast, send } = ui;

  const style = document.createElement('style');
  style.textContent = `
    .blk { position: fixed; pointer-events: none; border-radius: 6px; box-shadow: 0 0 0 2px var(--acc), 0 0 0 9999px rgba(6,7,5,.28);
      background: rgba(198,255,0,.07); transition: left .12s, top .12s, width .12s, height .12s; display: none; }
    .blk.on { display: block; }
    .blk b { position: absolute; left: -2px; bottom: calc(100% + 6px); white-space: nowrap; padding: 5px 11px; border-radius: 999px;
      background: var(--acc); color: #0a0b09; font-size: 12px; font-weight: 600; }
    .blk b.under { bottom: auto; top: calc(100% + 6px); }
    .blk b em { font-style: normal; font-weight: 400; opacity: .7; margin-left: 6px; }
    .blk-hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); padding: 9px 18px; border-radius: 999px; background: var(--bg);
      color: var(--fg); font-size: 12.5px; box-shadow: inset 0 0 0 1px var(--line); white-space: nowrap; display: none; pointer-events: none; }
    .blk-hint.on { display: block; }
    .blk-hint kbd { font: inherit; padding: 1px 7px; border-radius: 6px; background: rgba(255,255,255,.1); margin: 0 2px; }
  `;
  root.appendChild(style);
  const box = document.createElement('div');
  box.className = 'blk';
  box.innerHTML = '<b></b>';
  const hint = document.createElement('div');
  hint.className = 'blk-hint';
  hint.innerHTML = 'Наведите на блок · <kbd>колесо</kbd> или <kbd>↑</kbd><kbd>↓</kbd> — больше / меньше · <kbd>клик</kbd> — забрать · <kbd>Esc</kbd> — отмена';
  root.append(box, hint);

  /* ---------- what kind of block ---------- */
  const tagOf = (el) => el.tagName.toLowerCase();
  function kindOf(el) {
    const t = tagOf(el), role = el.getAttribute('role') || '', r = el.getBoundingClientRect();
    const n = (sel) => el.querySelectorAll(sel).length;
    if (t === 'button' || role === 'button' || (t === 'a' && r.height < 72 && r.width < 420 && n('img, svg') <= 1 && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)')) return 'Кнопка';
    if (t === 'input' || t === 'select' || t === 'textarea') return 'Поле ввода';
    if (t === 'nav' || role === 'navigation') return 'Навигация';
    if (t === 'header' || role === 'banner') return 'Шапка';
    if (t === 'footer' || role === 'contentinfo') return 'Подвал';
    if (t === 'form' || n('input, select, textarea') >= 2) return 'Форма';
    if (t === 'table' || role === 'table' || role === 'grid') return 'Таблица';
    if (t === 'dialog' || role === 'dialog') return 'Окно';
    if ((t === 'ul' || t === 'ol' || role === 'list') && n(':scope > li, :scope > [role=listitem]') >= 3) return 'Список';
    const top = r.top + scrollY;
    if (top < innerHeight * 0.3 && r.width >= innerWidth * 0.8 && r.height >= innerHeight * 0.5) return 'Первый экран';
    // a card: narrow, with words, and drawn as a card (a picture, a fill, rounded corners or a shadow)
    const cs = getComputedStyle(el);
    const looks = n('img, svg, picture') >= 1 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopLeftRadius) > 4 || cs.boxShadow !== 'none';
    if (r.width <= 640 && r.height <= 1600 && looks && (el.textContent || '').trim().length > 8) return 'Карточка';
    if (r.width >= innerWidth * 0.8) return 'Секция';
    return 'Блок';
  }

  /* ---------- picking ---------- */
  let picking = false, cur = null, stack = [], lastXY = [0, 0];
  const skip = (el) => !el || el === host || el === document.documentElement || el === document.body;
  function show(el) {
    cur = el;
    if (!el) { box.classList.remove('on'); return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const b = box.querySelector('b');
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0].slice(0, 24) : '';
    b.innerHTML = '';
    b.append(kindOf(el));
    const em = document.createElement('em');
    em.textContent = `${tagOf(el)}${cls} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
    b.append(em);
    b.classList.toggle('under', r.top < 40);
    box.classList.add('on');
  }
  function at(x, y) {
    for (const el of document.elementsFromPoint(x, y)) if (!skip(el) && el.getRootNode() === document) return el;
    return null;
  }
  const onMove = (e) => { lastXY = [e.clientX, e.clientY]; const el = at(e.clientX, e.clientY); if (el && !stack.includes(el)) { stack = [el]; show(el); } };
  function up() { if (cur && !skip(cur.parentElement)) { stack.push(cur.parentElement); show(cur.parentElement); } }
  function down() { if (stack.length > 1) { stack.pop(); show(stack[stack.length - 1]); } }
  const onWheel = (e) => { e.preventDefault(); e.stopPropagation(); if (e.deltaY < 0) up(); else down(); };
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const onClick = (e) => { eat(e); if (e.type === 'click' && cur) take(cur); };
  const onKey = (e) => {
    if (e.key === 'Escape') { eat(e); stop(); }
    else if (e.key === 'ArrowUp') { eat(e); up(); }
    else if (e.key === 'ArrowDown') { eat(e); down(); }
    else if (e.key === 'Enter' && cur) { eat(e); take(cur); }
  };
  const onScroll = () => { if (cur) show(cur); };
  function start() {
    if (picking) return;
    picking = true; mount();
    hint.classList.add('on');
    addEventListener('pointermove', onMove, true);
    addEventListener('wheel', onWheel, { capture: true, passive: false });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu']) addEventListener(t, onClick, true);
    addEventListener('keydown', onKey, true);
    addEventListener('scroll', onScroll, true);
    const el = at(innerWidth / 2, innerHeight / 3);
    if (el) { stack = [el]; show(el); }
  }
  function stop() {
    picking = false;
    hint.classList.remove('on'); box.classList.remove('on');
    removeEventListener('pointermove', onMove, true);
    removeEventListener('wheel', onWheel, { capture: true });
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'contextmenu']) removeEventListener(t, onClick, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', onScroll, true);
    cur = null; stack = [];
  }

  /* ---------- the markup with its styles ---------- */
  // every element gets the computed styles that differ from a clean element of the same tag (a hidden blank iframe
  // holds those); inherited ones only where they differ from the parent. Scripts, frames and event handlers go;
  // addresses become absolute; ::before / ::after become rules of their own; <use> of a sprite brings its symbol.
  const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'font-stretch', 'font-feature-settings',
    'font-variation-settings', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-indent', 'text-shadow',
    'white-space', 'visibility', 'cursor', 'list-style-type', 'list-style-position', 'list-style-image', 'direction', 'quotes', 'tab-size',
    'text-rendering', '-webkit-font-smoothing', 'fill', 'stroke', 'stroke-width', 'hyphens', 'word-break', 'overflow-wrap', 'caret-color']);
  const KEEP_WEBKIT = new Set(['-webkit-text-fill-color', '-webkit-background-clip', '-webkit-line-clamp', '-webkit-box-orient', '-webkit-font-smoothing', '-webkit-text-stroke-width', '-webkit-text-stroke-color', '-webkit-mask-image', '-webkit-mask-size', '-webkit-mask-position', '-webkit-mask-repeat']);
  const DROP = /^(transition|animation|will-change|view-transition|scroll-|overscroll|content-visibility|contain-intrinsic|anchor|position-try|interpolate|interactivity|field-sizing|app-region)|block-|inline-|-block|-inline|^(user-select|pointer-events|touch-action|cursor|caret-color|speak|ruby|math-|text-size-adjust)$/;
  const PSEUDO = ['content', 'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'color', 'background-color', 'background-image', 'background-size', 'background-position',
    'background-repeat', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow', 'opacity', 'transform', 'z-index',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'mask-image', '-webkit-mask-image', 'mask-size', 'filter', 'vertical-align'];
  const DROP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'STYLE', 'OBJECT', 'EMBED', 'BASE']);
  const URL_ATTR = new Set(['src', 'href', 'poster', 'xlink:href', 'action']);
  const absUrl = (u) => { try { return new URL(u, location.href).href; } catch (e) { return u; } };

  function blankDoc() {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;border:0;visibility:hidden';
    document.documentElement.appendChild(f);
    const d = f.contentDocument;
    d.open(); d.write('<!doctype html><html><head></head><body></body></html>'); d.close();
    return f;
  }

  function serialize(rootEl) {
    const frame = blankDoc(), bd = frame.contentDocument;
    const defaults = new Map();
    // the clean element has the attributes the browser's own styles look at: a link is underlined only with an href,
    // an input looks by its type
    const defOf = (el) => {
      const ns = el.namespaceURI, t = el.localName, href = t === 'a' && el.hasAttribute('href'), type = t === 'input' ? el.type : '';
      const k = ns + t + (href ? '[href]' : '') + type;
      if (!defaults.has(k)) {
        const d = ns && ns !== 'http://www.w3.org/1999/xhtml' ? bd.createElementNS(ns, t) : bd.createElement(t);
        if (href) d.setAttribute('href', '#');
        if (type) d.setAttribute('type', type);
        (ns === 'http://www.w3.org/2000/svg' && t !== 'svg' ? (bd.body.querySelector('svg') || bd.body.appendChild(bd.createElementNS(ns, 'svg'))) : bd.body).appendChild(d);
        const cs = frame.contentWindow.getComputedStyle(d), o = {};
        for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
        defaults.set(k, o);
      }
      return defaults.get(k);
    };
    const rules = [];
    let pid = 0, count = 0;
    const keep = (p) => !DROP.test(p) && (!p.startsWith('-') || KEEP_WEBKIT.has(p)) && !p.startsWith('--');
    function styleOf(el, parentCs) {
      const cs = getComputedStyle(el), def = defOf(el), out = [];
      for (let i = 0; i < cs.length; i++) {
        const p = cs[i];
        if (!keep(p)) continue;
        const v = cs.getPropertyValue(p);
        if (INHERITED.has(p) && parentCs) { if (parentCs.getPropertyValue(p) === v) continue; } else if (def[p] === v) continue;
        out.push(`${p}:${v.replace(/"/g, "'")}`);
      }
      return { cs, text: out.join(';') };
    }
    function pseudo(el, clone) {
      // list and <summary> markers the site hid (its ::marker / ::-webkit-details-marker rules do not come along)
      const cs = getComputedStyle(el);
      if (cs.display === 'list-item' || el.localName === 'summary') {
        const mk = getComputedStyle(el, '::marker'), wk = getComputedStyle(el, '::-webkit-details-marker');
        const hide = mk.content === 'none' || wk.display === 'none' || cs.listStyleType === 'none';
        if (hide) {
          if (!clone.getAttribute('data-ob')) clone.setAttribute('data-ob', String(++pid));
          const id = clone.getAttribute('data-ob');
          rules.push(`[data-ob="${id}"]{list-style:none}[data-ob="${id}"]::marker{content:none}[data-ob="${id}"]::-webkit-details-marker{display:none}`);
        }
      }
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which);
        const c = ps.getPropertyValue('content');
        if (!c || c === 'none' || c === 'normal') continue;
        if (!clone.getAttribute('data-ob')) clone.setAttribute('data-ob', String(++pid));
        rules.push(`[data-ob="${clone.getAttribute('data-ob')}"]${which}{${PSEUDO.map((p) => `${p}:${ps.getPropertyValue(p)}`).join(';')}}`);
      }
    }
    function walk(el, parentCs) {
      if (DROP_TAGS.has(el.tagName)) return null;
      if (++count > 6000) return null;
      const t = el.tagName;
      if (t === 'IFRAME' || t === 'VIDEO' || t === 'CANVAS') {
        const r = el.getBoundingClientRect();
        let src = '';
        if (t === 'CANVAS') { try { src = el.toDataURL(); } catch (e) { src = ''; } }
        if (t === 'VIDEO' && el.poster) src = absUrl(el.poster);
        const ph = document.createElement(src ? 'img' : 'div');
        if (src) ph.setAttribute('src', src);
        const { text } = styleOf(el, parentCs);
        ph.setAttribute('style', `${text};width:${r.width}px;height:${r.height}px;${src ? 'object-fit:cover' : 'background:#888;opacity:.35'}`);
        return ph;
      }
      // a site's own element (include-fragment, my-card…) becomes a plain div or span with its styles: nothing else
      // knows these tags, and a cleaner would drop them
      let clone;
      if (el.localName.includes('-') && el.namespaceURI === 'http://www.w3.org/1999/xhtml') {
        clone = document.createElement(/^inline/.test(getComputedStyle(el).display) ? 'span' : 'div');
        for (const a of el.attributes) if (!/^on/i.test(a.name)) { try { clone.setAttribute(a.name, a.value); } catch (e) { /* odd name */ } }
      } else clone = el.cloneNode(false);
      for (const a of [...clone.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'style' || n === 'srcset' || n === 'sizes' || n === 'loading' || n === 'nonce' || n === 'integrity' || (n.startsWith('data-') && n !== 'data-ob')) clone.removeAttribute(a.name);
        else if (URL_ATTR.has(n) && !a.value.startsWith('#') && !/^(data:|javascript:)/i.test(a.value)) clone.setAttribute(a.name, absUrl(a.value));
        else if (URL_ATTR.has(n) && /^javascript:/i.test(a.value)) clone.removeAttribute(a.name);
      }
      if (t === 'IMG') { clone.setAttribute('src', el.currentSrc || absUrl(el.getAttribute('src') || '')); }
      if (t === 'INPUT' || t === 'TEXTAREA') clone.setAttribute('value', el.value || '');
      if (t === 'A') clone.removeAttribute('target');
      const { cs, text } = styleOf(el, parentCs);
      if (text) clone.setAttribute('style', text);
      pseudo(el, clone);
      // an icon from a sprite elsewhere on the page: the symbol comes along
      if (el.localName === 'use') {
        const ref = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        const sym = ref.startsWith('#') && document.getElementById(ref.slice(1));
        if (sym) { const svg = el.ownerSVGElement; if (svg) needSymbols.add(sym); }
      }
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) clone.appendChild(document.createTextNode(ch.nodeValue));
        else if (ch.nodeType === 1) { const c = walk(ch, cs); if (c) clone.appendChild(c); }
      }
      return clone;
    }
    const needSymbols = new Set();
    const parent = rootEl.parentElement ? getComputedStyle(rootEl.parentElement) : null;
    const out = walk(rootEl, parent);
    // things inherited from outside the block (its font, colour) go onto its root
    if (parent && out) {
      const extra = [...INHERITED].filter((p) => keep(p) && !(out.getAttribute('style') || '').includes(p + ':')).map((p) => `${p}:${parent.getPropertyValue(p)}`).join(';');
      out.setAttribute('style', `${extra};${out.getAttribute('style') || ''};margin:0`);
    }
    frame.remove();
    let defs = '';
    if (needSymbols.size) defs = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden">${[...needSymbols].map((s) => s.outerHTML).join('')}</svg>`;
    return { html: out ? out.outerHTML : '', rules: rules.join('\n'), defs, truncated: count > 6000 };
  }

  /* ---------- fonts ---------- */
  // the @font-face rules of the families the block uses: from the page's own style sheets (other sites' sheets are read
  // by the extension's service worker), the font files inlined by it (Oddments shows only fonts it carries along)
  async function fontFaces(families) {
    const want = new Set([...families].map((f) => f.toLowerCase()));
    const faces = [], far = [];
    for (const sh of document.styleSheets) {
      let list;
      try { list = sh.cssRules; } catch (e) { if (sh.href) far.push(sh.href); continue; }
      const scan = (rules, base) => {
        for (const r of rules) {
          if (r.type === CSSRule.FONT_FACE_RULE) {
            const fam = (r.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim().toLowerCase();
            if (want.has(fam)) faces.push(r.cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (m, u) => `url("${new URL(u, base).href}")`));
          } else if (r.cssRules) scan(r.cssRules, base);
        }
      };
      scan(list, sh.href || location.href);
    }
    const r = await chrome.runtime.sendMessage({ t: 'blockFonts', faces, far: far.slice(0, 12), want: [...want] }).catch(() => null);
    return (r && r.css) || '';
  }

  /* ---------- fonts, colours, words ---------- */
  const hex = (c) => {
    const m = String(c).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && +m[4] < 0.05)) return '';
    return '#' + [m[1], m[2], m[3]].map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('');
  };
  const firstFamily = (f) => (f || '').split(',')[0].replace(/["']/g, '').trim();
  function describe(el) {
    const fonts = new Map(), text = new Map(), fill = new Map();
    const add = (m, k, w) => { if (k) m.set(k, (m.get(k) || 0) + w); };
    const all = [el, ...el.querySelectorAll('*')].slice(0, 4000);
    for (const e of all) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ');
      if (own) {
        add(fonts, `${firstFamily(cs.fontFamily)}|${cs.fontWeight}|${Math.round(parseFloat(cs.fontSize))}`, own.length);
        add(text, hex(cs.color), own.length);
      }
      const r = e.getBoundingClientRect();
      add(fill, hex(cs.backgroundColor), r.width * r.height);
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    return {
      fonts: top(fonts, 8).map(([k, w]) => { const [family, weight, size] = k.split('|'); return { family, weight: +weight, size: +size, chars: w }; }),
      colors: [...top(fill, 5).map(([c]) => ({ hex: c, role: 'фон' })), ...top(text, 4).map(([c]) => ({ hex: c, role: 'текст' }))],
    };
  }
  function backdrop(el) {
    for (let e = el; e; e = e.parentElement) { const c = hex(getComputedStyle(e).backgroundColor); if (c) return c; }
    return '#ffffff';
  }
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };

  /* ---------- the shot ---------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const MAX_DEV = 12000; // device pixels of height, at most
  async function shoot(el) {
    const keep = { x: scrollX, y: scrollY, behavior: document.documentElement.style.scrollBehavior };
    document.documentElement.style.scrollBehavior = 'auto';
    // fixed and sticky things outside the block (headers, chat buttons) would sit on every screen
    const hidden = [];
    for (const e of document.querySelectorAll('body *')) {
      if (e === host || el.contains(e) || e.contains(el)) continue;
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'sticky') { hidden.push([e, e.style.visibility]); e.style.visibility = 'hidden'; }
    }
    host.style.display = 'none';
    let canvas = null, ctx = null, k = 1, H = 0, W = 0, x0 = 0;
    try {
      const r0 = el.getBoundingClientRect();
      const docTop = r0.top + scrollY;
      let y = 0, guard = 0;
      while (guard++ < 40) {
        scrollTo(keep.x, Math.max(0, docTop + y - (y === 0 ? 0 : 0)));
        await frames(); await wait(120);
        const r = el.getBoundingClientRect();
        const segTop = Math.max(r.top, 0), segEnd = Math.min(r.bottom, innerHeight);
        const off = segTop - r.top;
        if (segEnd <= segTop) break;
        const shot = await chrome.runtime.sendMessage({ t: 'blockCapture' });
        if (!shot || !shot.data) throw new Error((shot && shot.error) || 'снимок не получился');
        const bmp = await createImageBitmap(await (await fetch(shot.data)).blob());
        if (!canvas) {
          k = bmp.width / innerWidth;
          x0 = Math.max(0, r.left);
          W = Math.min(r.right, innerWidth) - x0;
          H = Math.min(r.height, MAX_DEV / k);
          canvas = new OffscreenCanvas(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
          ctx = canvas.getContext('2d');
        }
        const h = Math.min(segEnd - segTop, H - off);
        if (h > 0) ctx.drawImage(bmp, Math.round(x0 * k), Math.round(segTop * k), Math.round(W * k), Math.round(h * k), 0, Math.round(off * k), Math.round(W * k), Math.round(h * k));
        bmp.close();
        const next = off + (segEnd - segTop);
        if (next >= H - 0.5 || next <= y) break;
        y = next;
      }
    } finally {
      for (const [e, v] of hidden) e.style.visibility = v;
      scrollTo(keep.x, keep.y);
      document.documentElement.style.scrollBehavior = keep.behavior;
      host.style.display = '';
    }
    if (!canvas) throw new Error('блок не виден на экране');
    return { png: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()), k, W, H };
  }

  /* ---------- a ZIP without compression ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const [name, data] of files) {
      const nb = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  /* ---------- taking it ---------- */
  async function take(el) {
    stop();
    toast('Забираю блок…', 'busy');
    try {
      const kind = kindOf(el);
      const r = el.getBoundingClientRect();
      const info = describe(el);
      const code = serialize(el);
      const fams = new Set(info.fonts.map((f) => f.family).filter(Boolean));
      const faces = await fontFaces(fams);
      const shot = await shoot(el);
      const bg = backdrop(el);
      const site = location.hostname.replace(/^www\./, '');
      const head = el.querySelector('h1, h2, h3, h4, [role=heading]');
      const words = ((head && head.textContent) || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      const title = `${kind}${words ? ` «${words}»` : ''} — ${site}`;
      const meta = {
        v: 1, url: location.href, title: document.title, site, kind, name: title,
        tag: tagOf(el), w: Math.round(r.width), h: Math.round(r.height), shotW: Math.round(shot.W), shotH: Math.round(shot.H), scale: shot.k,
        background: bg, fonts: info.fonts, colors: info.colors, truncated: code.truncated || shot.H < r.height - 1, at: new Date().toISOString(),
      };
      const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>`
        + `<style>${faces}\nhtml,body{margin:0}body{background:${bg};padding:0}\n${code.rules}</style></head>`
        + `<body>${code.defs}${code.html}</body></html>`;
      const enc = new TextEncoder();
      const file = zip([['shot.png', shot.png], ['block.html', enc.encode(doc)], ['block.json', enc.encode(JSON.stringify(meta, null, 1))]]);
      const tags = [kind, site, ...[...fams].slice(0, 2), lum(bg) < 0.4 ? 'Тёмный' : 'Светлый'];
      send({ t: 'saveBlock', data: b64(file), name: title, page: location.href, tags });
    } catch (e) {
      toast('Блок не забрался: ' + ((e && e.message) || e), 'err');
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (!ui.alive() || msg.t !== 'pickBlock') return;
    start();
    reply(true);
  });
})();
