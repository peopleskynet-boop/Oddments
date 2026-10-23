// Oddments — Figma plugin. Two ways:
// «Библиотека»: Oddments' library inside Figma — the UI (ui.html) finds pictures through Oddments' local receiver and
// hands the bytes here; this side puts them on the canvas, one at a time or a whole collection as a moodboard frame.
// «Отправить»: the selected frames/layers exported as PNG (2x) or SVG go to Oddments.
// «Иконки»: icons made in Oddments' icon constructor («Name — Size=24, Style=Outline» SVGs) become one component set
// with the Size and Style properties, as design-system icon libraries publish them. A picture's palette can become colour styles.
// The network requests are made by ui.html (plugin code has no fetch to localhost).
figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

(async () => {
  const token = (await figma.clientStorage.getAsync('perchToken')) || '';
  const format = (await figma.clientStorage.getAsync('perchFormat')) || 'PNG';
  figma.ui.postMessage({ type: 'init', token, format, count: figma.currentPage.selection.length });
})();

figma.on('selectionchange', () => figma.ui.postMessage({ type: 'count', count: figma.currentPage.selection.length }));

const safe = (s) => (s || 'Figma').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100);

// a picture as a rectangle with an image fill, at most 1200 px on its long side, named and marked with its Oddments id
function pictureNode(p) {
  const img = figma.createImage(p.bytes);
  const k = Math.min(1, 1200 / Math.max(p.w || 800, p.h || 600));
  const r = figma.createRectangle();
  r.resize(Math.max(1, Math.round((p.w || 800) * k)), Math.max(1, Math.round((p.h || 600) * k)));
  r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
  r.name = p.name || 'Oddments';
  r.setPluginData('perchId', p.id || '');
  return r;
}

const steps = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'шаг' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'шага' : 'шагов');
const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
async function flowOnCanvas(msg) {
  const W = 360, GAP = 150, PAD = 80, TOP = 150, title = msg.title || 'Сценарий';
  const LIME = { r: 0.84, g: 1, b: 0.39 }, INK = { r: 0.93, g: 0.92, b: 0.95 }, MUT = { r: 0.55, g: 0.55, b: 0.6 };
  await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }), figma.loadFontAsync({ family: 'Inter', style: 'Regular' })]);
  const text = (chars, size, style, color) => {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = chars;
    t.fills = [{ type: 'SOLID', color }];
    return t;
  };
  const sec = figma.createSection();
  sec.name = 'Сценарий · ' + title;
  sec.fills = [{ type: 'SOLID', color: { r: 0.043, g: 0.047, b: 0.063 } }];
  const frames = [];
  let x = PAD, maxH = 0;
  for (let i = 0; i < msg.items.length; i++) {
    const p = msg.items[i];
    let img;
    try { img = figma.createImage(p.bytes); } catch (e) { continue; }
    const h = Math.round(W * (p.h || 780) / (p.w || 360));
    const fr = figma.createFrame();
    const n = String(frames.length + 1).padStart(2, '0');
    fr.name = `${n} · ${title}`;
    fr.resize(W, h);
    fr.cornerRadius = 28; fr.clipsContent = true;
    fr.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
    fr.setPluginData('perchId', p.id || '');
    sec.appendChild(fr); fr.x = x; fr.y = TOP;
    const lab = text(`Шаг ${n}`, 20, 'Semi Bold', LIME);
    sec.appendChild(lab); lab.x = x; lab.y = TOP - 44;
    if (p.t != null) { const tm = text(fmtT(p.t), 16, 'Regular', MUT); sec.appendChild(tm); tm.x = x + W - tm.width; tm.y = TOP - 40; }
    frames.push(fr);
    maxH = Math.max(maxH, h);
    x += W + GAP;
  }
  if (!frames.length) { sec.remove(); figma.notify('Figma не прочитала ни одного экрана', { error: true }); return; }
  // arrows between the steps, at the height of the shorter neighbour's middle
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i], b = frames[i + 1];
    const ln = figma.createLine();
    ln.resize(GAP - 48, 0);
    ln.strokes = [{ type: 'SOLID', color: INK, opacity: 0.6 }];
    ln.strokeWeight = 3;
    try { ln.strokeCap = 'ARROW_LINES'; } catch (e) { /* older API: a plain line */ }
    sec.appendChild(ln);
    ln.x = a.x + W + 24; ln.y = TOP + Math.min(a.height, b.height) / 2;
  }
  const head = text(title, 40, 'Semi Bold', INK);
  sec.appendChild(head); head.x = PAD; head.y = 36;
  const sub = text(`${steps(frames.length)}${msg.items.length && msg.items[msg.items.length - 1].t != null ? ' · ' + fmtT(msg.items[msg.items.length - 1].t) + ' записи' : ''} · из Oddments`, 18, 'Regular', MUT);
  sec.appendChild(sub); sub.x = PAD + head.width + 20; sub.y = 52;
  sec.resizeWithoutConstraints(x - GAP + PAD, TOP + maxH + PAD);
  const c = figma.viewport.center;
  sec.x = Math.round(c.x - sec.width / 2); sec.y = Math.round(c.y - sec.height / 2);
  // the prototype: Figma design files only (FigJam has none)
  let proto = false;
  if (figma.editorType === 'figma') {
    for (let i = 0; i < frames.length; i++) {
      const next = frames[(i + 1) % frames.length];
      const reactions = [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: next.id, navigation: 'NAVIGATE', transition: { type: 'DISSOLVE', easing: { type: 'EASE_OUT' }, duration: 0.25 }, preserveScrollPosition: false, resetVideoPosition: false }] }];
      try { if (frames[i].setReactionsAsync) await frames[i].setReactionsAsync(reactions); else frames[i].reactions = reactions; proto = true; } catch (e) { proto = false; }
    }
    if (proto) {
      try { figma.currentPage.flowStartingPoints = [...figma.currentPage.flowStartingPoints, { nodeId: frames[0].id, name: title }]; } catch (e) { /* the frames still link to each other */ }
    }
  }
  figma.currentPage.selection = [sec];
  figma.viewport.scrollAndZoomIntoView([sec]);
  figma.notify(`Сценарий «${title}»: ${steps(frames.length)}${proto ? ' · прототип: Present, клик — следующий шаг' : ''}`);
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'save') {
    await figma.clientStorage.setAsync('perchToken', msg.token || '');
    await figma.clientStorage.setAsync('perchFormat', msg.format || 'PNG');
    return;
  }
  if (msg.type === 'place') {
    try {
      const r = pictureNode(msg);
      const c = figma.viewport.center;
      r.x = Math.round(c.x - r.width / 2); r.y = Math.round(c.y - r.height / 2);
      figma.currentPage.appendChild(r);
      figma.currentPage.selection = [r];
      figma.notify('Из Oddments: ' + r.name);
    } catch (e) { figma.notify('Не удалось поставить картинку: ' + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'board') {
    // a moodboard: a wrapping auto-layout frame with every picture of the collection
    const f = figma.createFrame();
    f.name = 'Oddments · ' + (msg.title || 'Подборка');
    f.layoutMode = 'HORIZONTAL';
    f.layoutWrap = 'WRAP';
    f.itemSpacing = 24; f.counterAxisSpacing = 24;
    f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = 48;
    // the width fits a near-square grid of 520 px pictures; resize() fixes both axes, so the height is set back to
    // «hug contents» after it — before, the frame stayed 400 px tall and cut the pictures off (bug #50)
    const cols = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(msg.items.length * 1.4))));
    f.resize(96 + cols * 520 + (cols - 1) * 24, 400);
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'AUTO';
    f.clipsContent = false;
    f.fills = [{ type: 'SOLID', color: { r: 0.06, g: 0.06, b: 0.06 } }];
    f.cornerRadius = 32;
    let n = 0;
    for (const p of msg.items) {
      try {
        const r = pictureNode({ ...p, w: (p.w || 800), h: (p.h || 600) });
        const k = 520 / Math.max(r.width, r.height);
        r.resize(Math.round(r.width * k), Math.round(r.height * k));
        r.cornerRadius = 16;
        f.appendChild(r); n++;
      } catch (e) { /* a picture Figma cannot read: skipped */ }
    }
    f.counterAxisSizingMode = 'AUTO';
    try { f.layoutSizingVertical = 'HUG'; } catch (e) { /* older API: the line above does it */ }
    const c = figma.viewport.center;
    f.x = Math.round(c.x - f.width / 2); f.y = Math.round(c.y - f.height / 2);
    figma.currentPage.appendChild(f);
    figma.currentPage.selection = [f];
    figma.viewport.scrollAndZoomIntoView([f]);
    figma.notify(`Мудборд «${msg.title}»: ${n} картинок`);
    return;
  }
  if (msg.type === 'flow') {
    // a screen-recording flow: the steps in a row inside a section, «Шаг 01 · 0:12» above each, arrows between, and — in
    // Figma design files — a clickable prototype (click → next step, the last back to the first) with a flow start
    try { await flowOnCanvas(msg); } catch (e) { figma.notify('Не удалось собрать сценарий: ' + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'styles') {
    // a picture's palette as colour styles «Oddments/<name>/1 #HEX»; the same name again is updated, not doubled
    try {
      const have = figma.getLocalPaintStylesAsync ? await figma.getLocalPaintStylesAsync() : figma.getLocalPaintStyles();
      let n = 0;
      msg.colors.forEach((hex, i) => {
        const name = `Oddments/${msg.name}/${i + 1} ${hex.toUpperCase()}`;
        const st = have.find((s) => s.name.startsWith(`Oddments/${msg.name}/${i + 1} `)) || figma.createPaintStyle();
        st.name = name;
        const v = parseInt(hex.slice(1), 16);
        st.paints = [{ type: 'SOLID', color: { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 } }];
        n++;
      });
      figma.notify(`Стили цвета «${msg.name}»: ${n}`);
    } catch (e) { figma.notify('Не удалось создать стили: ' + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'icon') {
    // variants from SVG: each a component named «Size=24, Style=Outline», combined into one set named after the icon
    try {
      const comps = [];
      for (const v of msg.variants) {
        const node = figma.createNodeFromSvg(v.svg);
        const c = figma.createComponent();
        c.resize(v.size, v.size);
        c.name = `Size=${v.size}, Style=${v.style}`;
        for (const ch of [...node.children]) c.appendChild(ch);
        node.remove();
        c.fills = [];
        comps.push(c);
      }
      if (!comps.length) { figma.notify('Нет вариантов иконки'); return; }
      // a column per style, a row per size, 24 px apart, as in the library's sheets
      const sizes = [...new Set(msg.variants.map((v) => v.size))].sort((a, b) => a - b);
      const styles = [...new Set(msg.variants.map((v) => v.style))];
      let y = 0;
      for (const sz of sizes) {
        let x = 0;
        for (const s of styles) { const c = comps.find((k) => k.name === `Size=${sz}, Style=${s}`); if (c) { c.x = x; c.y = y; } x += 44 + 24; }
        y += sz + 24;
      }
      const set = figma.combineAsVariants(comps, figma.currentPage);
      set.name = msg.name;
      if (msg.keys) set.description = msg.keys;
      set.layoutMode = 'NONE';
      const cv = figma.viewport.center;
      set.x = Math.round(cv.x - set.width / 2); set.y = Math.round(cv.y - set.height / 2);
      figma.currentPage.selection = [set];
      figma.viewport.scrollAndZoomIntoView([set]);
      figma.notify(`Иконка «${msg.name}»: ${comps.length} вариантов`);
    } catch (e) { figma.notify('Не удалось собрать иконку: ' + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type !== 'send') return;
  const nodes = figma.currentPage.selection.filter((n) => 'exportAsync' in n);
  if (!nodes.length) { figma.notify('Выделите фреймы или слои'); return; }
  const svg = msg.format === 'SVG';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    try {
      const bytes = await n.exportAsync(svg ? { format: 'SVG' } : { format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
      figma.ui.postMessage({ type: 'file', name: safe(n.name) + (svg ? '.svg' : '.png'), bytes, index: i, total: nodes.length });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', text: 'Не удалось экспортировать «' + n.name + '»' });
    }
  }
};
