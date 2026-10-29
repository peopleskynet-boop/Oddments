// Good-practice rules for drawing icons, on top of the constructor's own (checks in
// iconkit.js). Collected from open guidelines and adapted to the library's style (filled shapes with soft corners,
// Outline = silhouette with a 2 px inner contour): Lucide's design principles, Material Design system icons,
// Apple HIG / SF Symbols (optical alignment, family weight), IBM Carbon (pixel grid). `advice()` turns the measurable
// ones into soft hints next to the rule check; GUIDE is the short list shown in the constructor and given to the AI.
import * as K from './iconkit.js';
import { EXAMPLES } from './iconai-examples.js';
import { DEC } from '../util.js';

export const GUIDE = [
  ['Силуэт узнаётся с первого взгляда', 'Оставляйте только черты, по которым предмет узнают; мелочь при 16 px сливается.', 'Lucide, Material'],
  ['Вес как у соседей', 'Иконка не светлее и не темнее остальных в библиотеке: прищурьтесь или сравните рядом с кругом и квадратом.', 'Lucide, Apple'],
  ['Масса — по опорным фигурам', 'Квадрат 18, прямоугольники 16×20 и 20×16, круг 20: круг крупнее квадрата, чтобы казаться одного размера.', 'Material'],
  ['Оптический центр', 'Несимметричную иконку центрируют по глазу, а не по рамке: сдвиг на 0,5–1 px к лёгкой стороне.', 'Apple HIG'],
  ['Одна толщина линии', 'Контур и линии модификаторов — толщиной размера (24 px — 2 px), без смешения толщин.', 'Lucide'],
  ['Просвет и деталь не тоньше линии', 'Между отдельными частями — не меньше линии; узкие щели при уменьшении залипают.', 'Lucide'],
  ['Наклоны 45° и 90°', 'Прямые — по горизонтали, вертикали или 45°: так они ровно ложатся на пиксели.', 'Material, Carbon'],
  ['Мягкие углы одного радиуса', 'Большие фигуры — радиус 4–7 px, мелкие — 1,5–2; внутренние углы выреза мягче не делать.', 'Lucide'],
  ['Плавные кривые без изломов', 'У плавной точки ручки на одной прямой; меньше точек — ровнее кривая.', 'Lucide'],
  ['На пиксельной сетке', 'Координаты и размеры кратны 0,5 px на 24; диагонали и центры дуг — тоже по сетке.', 'Carbon'],
  ['Модификаторы одинаково', '«Плюс», «галочка», «перечёркнуто» — одного размера и в одном месте во всей библиотеке.', 'Lucide'],
  ['Без перспективы и текста', 'Предметы — фронтально или в простой проекции; буквы и цифры только если это сам смысл.', 'Material'],
];

/* ---------- measurements ---------- */
const R = 4; // raster scale: 24 px icon → 96 px picture
function raster(d, size = 24) {
  const n = size * R;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n });
  const g = c.getContext('2d');
  g.scale(R, R);
  g.fill(new Path2D(d), 'evenodd');
  const a = g.getImageData(0, 0, n, n).data;
  const ink = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) ink[i] = a[i * 4 + 3] / 255;
  return { ink, n };
}
// ink share, its centre, and the densest 5×5 px patch (Lucide's «blur test»)
function measure(d) {
  const { ink, n } = raster(d);
  let sum = 0, sx = 0, sy = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = ink[y * n + x]; sum += v; sx += v * x; sy += v * y; }
  const W = 5 * R;
  const I = new Float32Array((n + 1) * (n + 1)); // integral image
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) I[(y + 1) * (n + 1) + x + 1] = ink[y * n + x] + I[y * (n + 1) + x + 1] + I[(y + 1) * (n + 1) + x] - I[y * (n + 1) + x];
  let dense = 0;
  for (let y = 0; y + W <= n; y += 2) for (let x = 0; x + W <= n; x += 2) {
    const v = I[(y + W) * (n + 1) + x + W] - I[y * (n + 1) + x + W] - I[(y + W) * (n + 1) + x] + I[y * (n + 1) + x];
    dense = Math.max(dense, v / (W * W));
  }
  return { share: sum / (n * n), cx: sum ? sx / sum / R : 12, cy: sum ? sy / sum / R : 12, dense };
}

// the library's own range, from the hand-built examples (same rules, the same look)
const refs = {};
function reference(style) {
  if (refs[style]) return refs[style];
  const m = EXAMPLES.map((e) => { const r = K.build(e.shapes, 24); return measure(style === 'fill' ? r.fill : r.outline); });
  refs[style] = { lo: Math.min(...m.map((x) => x.share)), hi: Math.max(...m.map((x) => x.share)), dense: Math.max(...m.map((x) => x.dense)) };
  return refs[style];
}

const deg = (v) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

// soft hints: { ok, text } — the rule check says «wrong», these say «look again»
export function advice(shapes, style = 'outline') {
  const r = K.build(shapes, 24);
  if (!r.bounds) return [];
  const out = [];
  const m = measure(style === 'fill' ? r.fill : r.outline), ref = reference(style);
  const pct = (v) => Math.round(v * 100) + ' %';
  if (m.share < ref.lo * 0.75) out.push({ ok: false, text: `Светлее библиотеки: краска ${pct(m.share)}, у образцов ${pct(ref.lo)}–${pct(ref.hi)}`, how: 'Рядом с другими иконками эта будет казаться бледной. Сделайте силуэт крупнее или детали толще.' });
  else if (m.share > ref.hi * 1.25) out.push({ ok: false, text: `Тяжелее библиотеки: краска ${pct(m.share)}, у образцов ${pct(ref.lo)}–${pct(ref.hi)}`, how: 'Рядом с другими иконками эта будет казаться жирной. Уменьшите силуэт или добавьте просветов.' });
  else out.push({ ok: true, text: 'Вес как у библиотеки' });
  const off = Math.hypot(m.cx - 12, m.cy - 12);
  out.push(off > 1.5
    ? { ok: false, text: `Центр тяжести смещён на ${String(off.toFixed(1)).replace('.', DEC)} px — проверьте оптический центр`, how: 'Иконка «съезжает» в сторону, где больше краски. «Привести к правилам» сдвинет её к середине; несимметричным иконкам (стрелка, колокольчик) так и надо — смотрите глазами.' }
    : { ok: true, text: 'Оптически по центру' });
  if (m.dense > Math.max(ref.dense, 0.85) + 0.05) out.push({ ok: false, text: 'Есть слишком плотное место — деталей больше, чем видно при 16 px', how: 'В одном месте сошлось много краски: на маленьком размере оно станет пятном. Уберите мелкую деталь или раздвиньте части.' });
  // straight edges off 45° steps
  let skew = 0;
  const fill = r.fillPath, paths = fill.className === 'CompoundPath' ? fill.children : [fill];
  for (const p of paths) for (const c of p.curves) {
    if (!c.isStraight() || c.length < 1.5) continue;
    const a = ((deg(c.point2.subtract(c.point1)) % 45) + 45) % 45;
    if (Math.min(a, 45 - a) > 1) skew++;
  }
  out.push(skew ? { ok: false, text: `Прямые не под 45°/90°: ${skew}`, how: 'Косые прямые ложатся на пиксели лесенкой и выглядят размыто. Поверните их к горизонтали, вертикали или 45°, если это не часть смысла.' } : { ok: true, text: 'Наклоны кратны 45°' });
  // hand-edited contours: kinks at smooth points, too many points
  let kinks = 0, points = 0;
  for (const s of shapes) {
    if (s.type !== 'path' || s.hidden) continue;
    for (const c of K.contoursOf(s)) for (const q of c) {
      points++;
      const li = Math.hypot(...q.i), lo = Math.hypot(...q.o);
      if (li < 1e-6 || lo < 1e-6) continue;
      let diff = Math.abs(Math.atan2(-q.i[1], -q.i[0]) - Math.atan2(q.o[1], q.o[0])) * 180 / Math.PI;
      diff = Math.min(diff, 360 - diff);
      if (diff > 1 && diff < 25) kinks++;
    }
  }
  if (kinks) out.push({ ok: false, text: `Изломы у плавных точек: ${kinks} — выровняйте ручки`, how: 'Кривая в этой точке чуть ломается — на глаз видна «зазубрина». В правке точек нажмите на точку дважды или выровняйте её ручки в одну линию.' });
  if (points > 40) out.push({ ok: false, text: `Много точек в контурах (${points}) — проще кривая, ровнее линия`, how: 'Лишние точки дают неровный край. Уберите те, без которых форма не меняется.' });
  return out;
}

// the same rules for the AI's system prompt
export const GUIDE_PROMPT = 'GOOD PRACTICE (open icon guidelines: Lucide, Material, Apple HIG, Carbon — adapted to the constructor):\n'
  + GUIDE.map(([t, d]) => `- ${t}: ${d}`).join('\n');
