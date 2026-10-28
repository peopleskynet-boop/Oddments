// Oddments — Figma plugin. Two ways:
// «Библиотека»: Oddments' library inside Figma — the UI (ui.html) finds pictures through Oddments' local receiver and
// hands the bytes here; this side puts them on the canvas, one at a time or a whole collection as a moodboard frame.
// «Отправить»: the selected frames/layers exported as PNG (2x) or SVG go to Oddments.
// A flow collection: «Сценарий» (screens, arrows, a prototype) or «CJM» (a Customer Journey Map board).
// «Иконки»: icons made in Oddments' icon constructor («Name — Size=24, Style=Outline» SVGs) become one component set
// with the Size and Style properties, as design-system icon libraries publish them. A picture's palette can become colour styles.
// The network requests are made by ui.html (plugin code has no fetch to localhost).
figma.showUI(__html__, { width: 380, height: 560, themeColors: true });

// The language: the UI decides (the person's choice or Figma's own language) and tells this side ({ type: 'lang' }).
// Texts stay Russian in the code; T() takes the English one, {name} is filled from the second argument.
let LANG = 'ru';
const EN = {
  ' · из Oddments': ' · from Oddments', ' · прототип: Present, клик — следующий шаг': ' · prototype: Present, click — next step',
  ' · разметка': ' · markup', ' записи': ' of recording', ', этапов {n}': ', stages: {n}', 'CJM «{t}»: ': 'CJM «{t}»: ',
  'Figma не прочитала ни одного экрана': 'Figma could not read any screen', '{lane} · шаг ': '{lane} · step ',
  'В файле нет компонентов-иконок': 'No icon components in this file', 'Все {n} иконок уже в Oddments': 'All {n} icons are already in Oddments',
  'Из Oddments: ': 'From Oddments: ', 'Иконка «{t}»: {n} вариантов': 'Icon «{t}»: {n} variants', 'Мудборд «{t}»: {n} картинок': 'Moodboard «{t}»: {n} pictures',
  'Не удалось поставить картинку: ': 'Could not place the picture: ', 'Не удалось сделать слайды: ': 'Could not make the slides: ',
  'Не удалось собрать CJM: ': 'Could not build the CJM: ', 'Не удалось собрать иконки: ': 'Could not collect the icons: ',
  'Не удалось собрать иконку: ': 'Could not build the icon: ', 'Не удалось собрать сценарий: ': 'Could not build the flow: ',
  'Не удалось создать стили: ': 'Could not create the styles: ', 'Не удалось экспортировать «': 'Could not export «', 'Нет вариантов иконки': 'The icon has no variants',
  'Подборка': 'Collection', 'Рамка ': 'Frame ', 'Слайды «{t}»: {n}': 'Slides «{t}»: {n}', 'Стили цвета «{t}»: {n}': 'Colour styles «{t}»: {n}', 'Стрелка ': 'Arrow ',
  'Сценарий «{t}»: ': 'Flow «{t}»: ', 'Сценарий · ': 'Flow · ', 'Сценарий': 'Flow', 'Точка ': 'Point ', 'Шаг {n}': 'Step {n}', 'Этап {n}': 'Stage {n}', 'Этап · ': 'Stage · ',
  'Выделите фреймы или слои': 'Select frames or layers',
  'Иконки в Figma: {n}': 'Icons in Figma: {n}', ' · уже были в файле: {n}': ' · already in the file: {n}',
  'Действие': 'Action', 'Цель': 'Goal', 'Эмоция': 'Emotion', 'Боли': 'Pains', 'Возможности': 'Opportunities',
};
const T = (s, v) => {
  const out = LANG === 'en' && EN[s] !== undefined ? EN[s] : s;
  return v ? out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : out;
};

(async () => {
  const token = (await figma.clientStorage.getAsync('perchToken')) || '';
  const format = (await figma.clientStorage.getAsync('perchFormat')) || 'PNG';
  const lang = (await figma.clientStorage.getAsync('oddLang')) || '';
  figma.ui.postMessage({ type: 'init', token, format, lang, count: figma.currentPage.selection.length });
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

async function withNotes(r, notes) {
  const LIME = { r: 0.84, g: 1, b: 0.39 }, INK = { r: 0.07, g: 0.07, b: 0.09 };
  await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Bold' }), figma.loadFontAsync({ family: 'Inter', style: 'Regular' })]);
  const W = r.width, H = r.height, nodes = [r];
  notes.forEach((n, i) => {
    if (n.kind === 'box') {
      const b = figma.createRectangle();
      b.x = r.x + Math.min(n.x, n.x2) * W; b.y = r.y + Math.min(n.y, n.y2) * H;
      b.resize(Math.max(1, Math.abs(n.x2 - n.x) * W), Math.max(1, Math.abs(n.y2 - n.y) * H));
      b.fills = []; b.strokes = [{ type: 'SOLID', color: LIME }]; b.strokeWeight = 3; b.cornerRadius = 8; b.name = T('Рамка ') + (i + 1);
      nodes.push(b);
    } else if (n.kind === 'arrow') {
      const v = figma.createVector();
      v.vectorPaths = [{ windingRule: 'NONE', data: `M ${n.x * W} ${n.y * H} L ${n.x2 * W} ${n.y2 * H}` }];
      v.x = r.x; v.y = r.y; v.strokes = [{ type: 'SOLID', color: LIME }]; v.strokeWeight = 3;
      v.vectorNetwork = { ...v.vectorNetwork, vertices: v.vectorNetwork.vertices.map((x, k) => (k === v.vectorNetwork.vertices.length - 1 ? { ...x, strokeCap: 'ARROW_LINES' } : x)) };
      v.name = T('Стрелка ') + (i + 1);
      nodes.push(v);
    }
    const at = n.kind === 'box' ? { x: Math.min(n.x, n.x2), y: Math.min(n.y, n.y2) } : { x: n.x, y: n.y };
    const pin = figma.createEllipse();
    pin.resize(28, 28); pin.x = r.x + at.x * W - 14; pin.y = r.y + at.y * H - 14; pin.fills = [{ type: 'SOLID', color: LIME }]; pin.name = T('Точка ') + (i + 1);
    const num = figma.createText();
    num.fontName = { family: 'Inter', style: 'Bold' }; num.fontSize = 12; num.characters = String(i + 1); num.fills = [{ type: 'SOLID', color: INK }];
    num.textAlignHorizontal = 'CENTER'; num.resize(28, 16); num.x = pin.x; num.y = pin.y + 6;
    nodes.push(pin, num);
  });
  const list = figma.createText();
  list.fontName = { family: 'Inter', style: 'Regular' }; list.fontSize = 14;
  list.characters = notes.map((n, i) => `${i + 1}. ${n.text}${n.by ? ` — ${n.by}` : ''}`).join('\n');
  list.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.92 } }];
  list.x = r.x + W + 32; list.y = r.y; list.resize(320, list.height); list.textAutoResize = 'HEIGHT';
  nodes.push(list);
  const g = figma.group(nodes, figma.currentPage);
  g.name = (r.name || 'Oddments') + T(' · разметка');
  return g;
}

// a deck: frames 1920×1080 in a row, the picture fitted, its name at the bottom, comments in a column on the right
async function slidesOnCanvas(msg) {
  const W = 1920, H = 1080, GAP = 200, BG = { r: 0.043, g: 0.047, b: 0.063 }, INK = { r: 0.95, g: 0.95, b: 0.96 }, MUT = { r: 0.55, g: 0.55, b: 0.6 }, LIME = { r: 0.84, g: 1, b: 0.39 };
  await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }), figma.loadFontAsync({ family: 'Inter', style: 'Regular' }), figma.loadFontAsync({ family: 'Inter', style: 'Bold' })]);
  const text = (chars, size, style, color) => { const t = figma.createText(); t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = chars; t.fills = [{ type: 'SOLID', color }]; return t; };
  const vc = figma.viewport.center, frames = [];
  msg.items.forEach((p, i) => {
    const f = figma.createFrame();
    f.name = `${String(i + 1).padStart(2, '0')} · ${p.name}`;
    f.resize(W, H); f.fills = [{ type: 'SOLID', color: BG }];
    f.x = Math.round(vc.x - W / 2) + i * (W + GAP); f.y = Math.round(vc.y - H / 2);
    const side = p.notes && p.notes.length ? 520 : 0, pad = 70, bw = W - pad * 2 - side, bh = H - pad - 150;
    const img = figma.createImage(p.bytes), k = Math.min(bw / (p.w || 800), bh / (p.h || 600));
    const r = figma.createRectangle();
    r.resize(Math.max(1, Math.round((p.w || 800) * k)), Math.max(1, Math.round((p.h || 600) * k)));
    r.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }]; r.cornerRadius = 12; r.name = p.name;
    r.x = pad + (bw - r.width) / 2; r.y = pad / 1.4 + (bh - r.height) / 2;
    f.appendChild(r);
    (p.notes || []).forEach((n, j) => {
      const at = n.kind === 'box' ? { x: Math.min(n.x, n.x2), y: Math.min(n.y, n.y2) } : n;
      if (n.kind === 'box') { const b = figma.createRectangle(); b.resize(Math.max(1, Math.abs(n.x2 - n.x) * r.width), Math.max(1, Math.abs(n.y2 - n.y) * r.height)); b.x = r.x + at.x * r.width; b.y = r.y + at.y * r.height; b.fills = []; b.strokes = [{ type: 'SOLID', color: LIME }]; b.strokeWeight = 4; b.cornerRadius = 10; f.appendChild(b); }
      const dot = figma.createEllipse(); dot.resize(40, 40); dot.x = r.x + at.x * r.width - 20; dot.y = r.y + at.y * r.height - 20; dot.fills = [{ type: 'SOLID', color: LIME }]; f.appendChild(dot);
      const num = text(String(j + 1), 18, 'Bold', BG); num.textAlignHorizontal = 'CENTER'; num.resize(40, 22); num.x = dot.x; num.y = dot.y + 9; f.appendChild(num);
      const note = text(`${j + 1}. ${n.text}`, 26, 'Regular', INK); note.x = W - side + 10; note.y = pad + j * 110; note.resize(side - 80, note.height); note.textAutoResize = 'HEIGHT'; f.appendChild(note);
    });
    const name = text(p.name.replace(/\.[^.]+$/, ''), 44, 'Semi Bold', INK); name.x = pad; name.y = H - 125; f.appendChild(name);
    const sub = text(`${msg.title || ''} · ${i + 1} / ${msg.items.length}`, 26, 'Regular', MUT); sub.x = pad; sub.y = H - 62; f.appendChild(sub);
    frames.push(f);
  });
  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);
  figma.notify(T('Слайды «{t}»: {n}', { t: msg.title || '', n: frames.length }));
}

const steps = (n) => n + ' ' + (LANG === 'en' ? (n === 1 ? 'step' : 'steps') : n % 10 === 1 && n % 100 !== 11 ? 'шаг' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'шага' : 'шагов');
const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
async function flowOnCanvas(msg) {
  const W = 360, GAP = 150, PAD = 80, TOP = 150, title = msg.title || T('Сценарий');
  const LIME = { r: 0.84, g: 1, b: 0.39 }, INK = { r: 0.93, g: 0.92, b: 0.95 }, MUT = { r: 0.55, g: 0.55, b: 0.6 };
  await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }), figma.loadFontAsync({ family: 'Inter', style: 'Regular' })]);
  const text = (chars, size, style, color) => {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = chars;
    t.fills = [{ type: 'SOLID', color }];
    return t;
  };
  const sec = figma.createSection();
  sec.name = T('Сценарий · ') + title;
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
    const lab = text(T('Шаг {n}', { n }), 20, 'Semi Bold', LIME);
    sec.appendChild(lab); lab.x = x; lab.y = TOP - 44;
    if (p.t != null) { const tm = text(fmtT(p.t), 16, 'Regular', MUT); sec.appendChild(tm); tm.x = x + W - tm.width; tm.y = TOP - 40; }
    frames.push(fr);
    maxH = Math.max(maxH, h);
    x += W + GAP;
  }
  if (!frames.length) { sec.remove(); figma.notify(T('Figma не прочитала ни одного экрана'), { error: true }); return; }
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
  const sub = text(`${steps(frames.length)}${msg.items.length && msg.items[msg.items.length - 1].t != null ? ' · ' + fmtT(msg.items[msg.items.length - 1].t) + T(' записи') : ''}${T(' · из Oddments')}`, 18, 'Regular', MUT);
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
  figma.notify(T('Сценарий «{t}»: ', { t: title }) + steps(frames.length) + (proto ? T(' · прототип: Present, клик — следующий шаг') : ''));
}

// a Customer Journey Map of a flow collection: stages over the steps, the screens, then the lanes (action, goal,
// the emotion curve, pains, opportunities). The map's text comes from Oddments (the collection's cjm); an empty cell is
// still drawn — a place to write in during a workshop.
const LANES = [['act', 'Действие'], ['goal', 'Цель'], ['feel', 'Эмоция'], ['pain', 'Боли'], ['idea', 'Возможности']];
async function cjmOnCanvas(msg) {
  const COL = 300, CW = 260, PAD = 80, LAB = 180, title = msg.title || T('Сценарий');
  const LIME = { r: 0.84, g: 1, b: 0.39 }, INK = { r: 0.93, g: 0.92, b: 0.95 }, MUT = { r: 0.55, g: 0.55, b: 0.6 }, RED = { r: 1, g: 0.36, b: 0.42 };
  const BG = { r: 0.043, g: 0.047, b: 0.063 }, CARD = { r: 0.1, g: 0.105, b: 0.13 };
  await Promise.all([figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' }), figma.loadFontAsync({ family: 'Inter', style: 'Regular' })]);
  const text = (chars, size, style, color) => {
    const t = figma.createText();
    t.fontName = { family: 'Inter', style }; t.fontSize = size; t.characters = chars;
    t.fills = [{ type: 'SOLID', color }];
    return t;
  };
  const c = msg.cjm || { stages: [], steps: {} };
  const cellOf = (p, k) => (c.steps && c.steps[p.id] ? c.steps[p.id][k] : undefined);
  const items = msg.items.filter((p) => { try { p.img = figma.createImage(p.bytes); return true; } catch (e) { return false; } });
  const n = items.length;
  if (!n) { figma.notify(T('Figma не прочитала ни одного экрана'), { error: true }); return; }
  const sec = figma.createSection();
  sec.name = 'CJM · ' + title;
  sec.fills = [{ type: 'SOLID', color: BG }];
  const x0 = PAD + LAB, colX = (i) => x0 + i * COL;
  const head = text(title, 40, 'Semi Bold', INK);
  sec.appendChild(head); head.x = PAD; head.y = 36;
  const sub = text(`Customer Journey Map · ${steps(n)}${T(' · из Oddments')}`, 18, 'Regular', MUT);
  sec.appendChild(sub); sub.x = PAD + head.width + 20; sub.y = 52;
  let y = 130;
  // stages: a pill over its run of steps
  const cuts = [...new Set((c.stages || []).map((s) => s.from).filter((f) => f > 0 && f < n))].sort((a, b) => a - b);
  const runs = [0, ...cuts].map((from, i, a) => ({ from, to: i + 1 < a.length ? a[i + 1] : n, name: ((c.stages || []).find((s) => s.from === from) || {}).name || T('Этап {n}', { n: i + 1 }) }));
  runs.forEach((r, i) => {
    const pill = figma.createFrame();
    pill.name = T('Этап · ') + r.name;
    pill.resize((r.to - r.from) * COL - 40, 48);
    pill.cornerRadius = 24;
    pill.fills = [{ type: 'SOLID', color: LIME, opacity: i % 2 ? 0.1 : 0.18 }];
    sec.appendChild(pill); pill.x = colX(r.from); pill.y = y;
    const t = text(r.name, 18, 'Semi Bold', INK);
    pill.appendChild(t); t.x = 20; t.y = 13;
  });
  y += 80;
  // the screens
  let maxH = 0;
  items.forEach((p, i) => {
    const h = Math.round(CW * (p.h || 780) / (p.w || 360));
    const lab = text(T('Шаг {n}', { n: String(i + 1).padStart(2, '0') }) + (p.t != null ? '  ' + fmtT(p.t) : ''), 15, 'Semi Bold', LIME);
    sec.appendChild(lab); lab.x = colX(i); lab.y = y;
    const fr = figma.createFrame();
    fr.name = `${String(i + 1).padStart(2, '0')} · ${title}`;
    fr.resize(CW, h); fr.cornerRadius = 22; fr.clipsContent = true;
    fr.fills = [{ type: 'IMAGE', imageHash: p.img.hash, scaleMode: 'FILL' }];
    fr.setPluginData('perchId', p.id || '');
    sec.appendChild(fr); fr.x = colX(i); fr.y = y + 30;
    maxH = Math.max(maxH, h);
  });
  y += 30 + maxH + 50;
  // the lanes
  for (const [k, ru] of LANES) {
    const label = T(ru);
    const lt = text(label, 18, 'Semi Bold', MUT);
    sec.appendChild(lt); lt.x = PAD; lt.y = y + 14;
    if (k === 'feel') {
      const H = 200, yy = (v) => y + 20 + ((2 - v) / 4) * (H - 40);
      for (let v = -2; v <= 2; v++) {
        const ln = figma.createLine(); ln.resize(n * COL - 40, 0);
        ln.strokes = [{ type: 'SOLID', color: INK, opacity: v === 0 ? 0.25 : 0.1 }]; ln.strokeWeight = 1;
        if (v === 0) ln.dashPattern = [6, 6];
        sec.appendChild(ln); ln.x = x0; ln.y = yy(v);
      }
      const pts = items.map((p, i) => [colX(i) + CW / 2, cellOf(p, 'feel')]).filter((q) => q[1] != null);
      if (pts.length > 1) {
        const vx = figma.createVector();
        const ox = pts[0][0], oy = Math.min(...pts.map((q) => yy(q[1])));
        vx.vectorPaths = [{ windingRule: 'NONE', data: pts.map(([px, v], i) => `${i ? 'L' : 'M'} ${px - ox} ${yy(v) - oy}`).join(' ') }];
        vx.strokes = [{ type: 'SOLID', color: LIME }]; vx.strokeWeight = 4; vx.strokeJoin = 'ROUND'; vx.strokeCap = 'ROUND';
        vx.fills = [];
        sec.appendChild(vx); vx.x = ox; vx.y = oy;
      }
      for (const [px, v] of pts) {
        const d = figma.createEllipse(); d.resize(16, 16);
        d.fills = [{ type: 'SOLID', color: v < 0 ? RED : LIME }];
        sec.appendChild(d); d.x = px - 8; d.y = yy(v) - 8;
      }
      y += H + 30;
      continue;
    }
    let laneH = 0;
    items.forEach((p, i) => {
      const card = figma.createFrame();
      card.name = T('{lane} · шаг ', { lane: label }) + (i + 1);
      card.layoutMode = 'VERTICAL'; card.primaryAxisSizingMode = 'AUTO'; card.counterAxisSizingMode = 'FIXED';
      card.resize(CW, 40);
      card.paddingLeft = card.paddingRight = 18; card.paddingTop = card.paddingBottom = 16;
      card.cornerRadius = 20;
      card.fills = [{ type: 'SOLID', color: k === 'pain' ? RED : k === 'idea' ? LIME : CARD, opacity: k === 'pain' ? 0.14 : k === 'idea' ? 0.1 : 1 }];
      const t = text(cellOf(p, k) || ' ', 15, 'Regular', INK);
      card.appendChild(t);
      t.layoutAlign = 'STRETCH'; t.textAutoResize = 'HEIGHT';
      sec.appendChild(card); card.x = colX(i); card.y = y;
      laneH = Math.max(laneH, card.height, 84);
    });
    // one height per lane: the row reads as a row
    for (const ch of sec.children) if (ch.name && ch.name.startsWith(T('{lane} · шаг ', { lane: label }))) { ch.primaryAxisSizingMode = 'FIXED'; ch.resize(CW, laneH); }
    y += laneH + 30;
  }
  sec.resizeWithoutConstraints(x0 + n * COL - 40 + PAD, y + PAD - 30);
  const vc = figma.viewport.center;
  sec.x = Math.round(vc.x - sec.width / 2); sec.y = Math.round(vc.y - sec.height / 2);
  figma.currentPage.selection = [sec];
  figma.viewport.scrollAndZoomIntoView([sec]);
  figma.notify(T('CJM «{t}»: ', { t: title }) + steps(n) + T(', этапов {n}', { n: runs.length }));
}

// an icon from the constructor («Name — Size=24, Style=Outline» SVGs) → one component set named after the icon, each
// variant a component «Size=24, Style=Outline»; a column per style and a row per size, as in the library's sheets
function iconSet(icon) {
  const comps = [];
  for (const v of icon.variants) {
    const node = figma.createNodeFromSvg(v.svg);
    const c = figma.createComponent();
    c.resize(v.size, v.size);
    c.name = `Size=${v.size}, Style=${v.style}`;
    for (const ch of [...node.children]) c.appendChild(ch);
    node.remove();
    c.fills = [];
    comps.push(c);
  }
  if (!comps.length) return null;
  const sizes = [...new Set(icon.variants.map((v) => v.size))].sort((a, b) => a - b);
  const styles = [...new Set(icon.variants.map((v) => v.style))];
  let y = 0;
  for (const sz of sizes) {
    let x = 0;
    for (const st of styles) { const c = comps.find((k) => k.name === `Size=${sz}, Style=${st}`); if (c) { c.x = x; c.y = y; } x += 44 + 24; }
    y += sz + 24;
  }
  const set = figma.combineAsVariants(comps, figma.currentPage);
  set.name = icon.name;
  if (icon.keys) set.description = icon.keys;
  set.layoutMode = 'NONE';
  return set;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'lang') {
    LANG = msg.lang === 'en' ? 'en' : 'ru';
    if (msg.save) await figma.clientStorage.setAsync('oddLang', msg.choice || '');
    return;
  }
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
      // comments made in Oddments («Разметка»): numbered points, frames and arrows over the picture, the texts beside it
      const marked = msg.notes && msg.notes.length ? await withNotes(r, msg.notes) : r;
      figma.currentPage.selection = [marked];
      figma.notify(T('Из Oddments: ') + r.name);
    } catch (e) { figma.notify(T('Не удалось поставить картинку: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'slides') {
    try { await slidesOnCanvas(msg); } catch (e) { figma.notify(T('Не удалось сделать слайды: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'board') {
    // a moodboard: a wrapping auto-layout frame with every picture of the collection
    const f = figma.createFrame();
    f.name = 'Oddments · ' + (msg.title || T('Подборка'));
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
    figma.notify(T('Мудборд «{t}»: {n} картинок', { t: msg.title, n }));
    return;
  }
  if (msg.type === 'flow') {
    // a screen-recording flow: the steps in a row inside a section, «Шаг 01 · 0:12» above each, arrows between, and — in
    // Figma design files — a clickable prototype (click → next step, the last back to the first) with a flow start
    try { await flowOnCanvas(msg); } catch (e) { figma.notify(T('Не удалось собрать сценарий: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'cjm') {
    try { await cjmOnCanvas(msg); } catch (e) { figma.notify(T('Не удалось собрать CJM: ') + (e && e.message ? e.message : e), { error: true }); }
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
      figma.notify(T('Стили цвета «{t}»: {n}', { t: msg.name, n }));
    } catch (e) { figma.notify(T('Не удалось создать стили: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'icon') {
    try {
      const set = iconSet(msg);
      if (!set) { figma.notify(T('Нет вариантов иконки')); return; }
      const cv = figma.viewport.center;
      set.x = Math.round(cv.x - set.width / 2); set.y = Math.round(cv.y - set.height / 2);
      figma.currentPage.selection = [set];
      figma.viewport.scrollAndZoomIntoView([set]);
      figma.notify(T('Иконка «{t}»: {n} вариантов', { t: msg.name, n: set.children.length }));
    } catch (e) { figma.notify(T('Не удалось собрать иконку: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'icons') {
    // a batch: every icon its own component set, in rows of eight from the viewport's centre; an icon whose set is
    // already on this page is left alone (no duplicates on a second run)
    try {
      const have = new Set(figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET'] }).map((n) => n.name));
      const made = [];
      let skipped = 0;
      for (const icon of msg.icons) {
        if (have.has(icon.name)) { skipped++; continue; }
        const set = iconSet(icon);
        if (set) made.push(set);
      }
      if (made.length) {
        const cv = figma.viewport.center, GAP = 48, PER = 8;
        const colW = Math.max(...made.map((n) => n.width)) + GAP;
        let x0 = Math.round(cv.x - Math.min(PER, made.length) * colW / 2), y = Math.round(cv.y), rowH = 0;
        made.forEach((n, i) => {
          if (i && i % PER === 0) { y += rowH + GAP; rowH = 0; }
          n.x = x0 + (i % PER) * colW; n.y = y; rowH = Math.max(rowH, n.height);
        });
        figma.currentPage.selection = made;
        figma.viewport.scrollAndZoomIntoView(made);
      }
      figma.notify(T('Иконки в Figma: {n}', { n: made.length }) + (skipped ? T(' · уже были в файле: {n}', { n: skipped }) : ''));
      figma.ui.postMessage({ type: 'note', text: T('Иконки в Figma: {n}', { n: made.length }) + (skipped ? T(' · уже были в файле: {n}', { n: skipped }) : ''), kind: 'ok' });
    } catch (e) { figma.notify(T('Не удалось собрать иконки: ') + (e && e.message ? e.message : e), { error: true }); }
    return;
  }
  if (msg.type === 'examples') {
    // every icon of the file as an example for the constructor's AI: a component set gives its 24 Outline variant
    // (or the first one), a lone component itself; the description's words ride in the name («Lock — замок, защита»).
    // What was sent from this file is remembered, so the next press sends only new icons.
    try {
      await figma.loadAllPagesAsync();
      const seenKey = 'sentExamples:' + (figma.root.id || '') + ':' + figma.root.name;
      const seen = new Set((await figma.clientStorage.getAsync(seenKey)) || []);
      const nodes = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
        .filter((n) => n.type === 'COMPONENT_SET' || !(n.parent && n.parent.type === 'COMPONENT_SET'));
      const fresh = nodes.filter((n) => !seen.has(n.id)).slice(0, 2000);
      if (!nodes.length) { figma.ui.postMessage({ type: 'note', text: T('В файле нет компонентов-иконок'), kind: 'err' }); return; }
      if (!fresh.length) { figma.ui.postMessage({ type: 'note', text: T('Все {n} иконок уже в Oddments', { n: nodes.length }), kind: 'ok' }); return; }
      for (let i = 0; i < fresh.length; i++) {
        const n = fresh[i];
        const pick = n.type === 'COMPONENT_SET'
          ? (n.children.find((c) => /Size=24(?!\d)/.test(c.name) && /Style=Outline/i.test(c.name)) || n.children.find((c) => /24/.test(c.name)) || n.children[0])
          : n;
        if (!pick) continue;
        try {
          const bytes = await pick.exportAsync({ format: 'SVG' });
          const base = n.name.split('/').pop().trim();
          const desc = (n.description || '').replace(/\s+/g, ' ').trim();
          figma.ui.postMessage({ type: 'file', name: safe(desc ? `${base} — ${desc}` : base).slice(0, 90) + '.svg', bytes, tags: 'пример иконки', index: i, total: fresh.length });
          seen.add(n.id);
        } catch (e) { /* a broken icon is skipped */ }
      }
      await figma.clientStorage.setAsync(seenKey, [...seen]);
    } catch (e) { figma.ui.postMessage({ type: 'note', text: T('Не удалось собрать иконки: ') + (e && e.message ? e.message : e), kind: 'err' }); }
    return;
  }
  if (msg.type !== 'send') return;
  const nodes = figma.currentPage.selection.filter((n) => 'exportAsync' in n);
  if (!nodes.length) { figma.notify(T('Выделите фреймы или слои')); return; }
  const svg = msg.format === 'SVG';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    try {
      const bytes = await n.exportAsync(svg ? { format: 'SVG' } : { format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
      figma.ui.postMessage({ type: 'file', name: safe(n.name) + (svg ? '.svg' : '.png'), bytes, index: i, total: nodes.length });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', text: T('Не удалось экспортировать «') + n.name + '»' });
    }
  }
};
