// «Проверка по бренду»: an illustration or a 3D render against the team's palette (the share of the brand colour,
// colours that are not the brand's, forbidden ones), and a 3D model against the team's rules (polygons, size, UV,
// names). Like the icon rules — soft where taste decides, firm where the team decided. Rules are the team's own
// (Настройки › Правила бренда): what is here is a starting point — Oddments' own lime and void — not a brand book.
// Pure: palettes (item.colors + item.shares, palette.js) and model facts in, findings out.
import { okDist } from './palette.js';

export const DEFAULT_RULES = {
  colors: ['#d7ff63', '#0b0c10', '#ffffff', '#a7c7ff', '#d6b4ff'], // lime, void, white, sky, lavender (Oddments)
  accent: '#d7ff63',
  accentMin: 3, // % of the picture the brand colour takes at least…
  accentMax: 45, // …and at most (a lime wall is not on-brand either)
  forbid: [], // colours that must not appear (a competitor's, an old palette's)
  near: 0.09, // OKLab distance at which a colour counts as one of the palette's
  model: { maxTris: 150000, needUV: true, minSize: 0.01, maxSize: 50, maxMaterials: 6, names: true },
};

// a colour without hue (white, greys, black) is never «off-brand»: backgrounds and shadows are made of it
const neutral = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 28;
};
const pct = (x) => `${Math.round(x * 100)} %`;

// → [{ level: 'err' | 'warn' | 'ok', text, how }]
export function checkPalette(colors, shares, rules = DEFAULT_RULES) {
  const out = [], push = (level, text, how = '') => out.push({ level, text, how });
  if (!colors || !colors.length) return [{ level: 'warn', text: 'У картинки нет палитры', how: 'Палитра считается при добавлении; у старых файлов — в фоне.' }];
  const sh = shares && shares.length === colors.length ? shares : colors.map(() => 1 / colors.length);
  const accent = colors.reduce((a, c, i) => a + (okDist(c, rules.accent) < rules.near ? sh[i] : 0), 0) * 100;
  if (accent < rules.accentMin) push('warn', `Фирменного цвета мало: ${Math.round(accent)} %`, `По правилам — от ${rules.accentMin} %. Добавьте акцент цветом ${rules.accent.toUpperCase()}.`);
  else if (accent > rules.accentMax) push('warn', `Фирменного цвета слишком много: ${Math.round(accent)} %`, `По правилам — до ${rules.accentMax} %: больше воздуха и нейтральных.`);
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const bad = (rules.forbid || []).find((f) => okDist(c, f) < rules.near);
    if (bad && sh[i] > 0.01) { push('err', `Запрещённый цвет ${c.toUpperCase()} — ${pct(sh[i])} картинки`, `Близок к ${bad.toUpperCase()} из запрещённых. Замените цветом из палитры.`); continue; }
    if (sh[i] >= 0.08 && !neutral(c) && !rules.colors.some((p) => okDist(c, p) < rules.near * 1.4)) push('warn', `Цвет не из палитры: ${c.toUpperCase()} — ${pct(sh[i])}`, `Ближайший из палитры: ${nearest(c, rules.colors).toUpperCase()}.`);
  }
  if (!out.length) push('ok', `По палитре всё хорошо: фирменного цвета ${Math.round(accent)} %`);
  return out;
}
const nearest = (c, list) => list.reduce((a, p) => (okDist(c, p) < okDist(c, a) ? p : a), list[0]);

// a model's facts (item.tris, item.verts, and when known: size in metres, materials, uvless meshes, names of
// objects and materials) against the team's limits
const DEFAULT_NAME = /^(Cube|Sphere|Cylinder|Plane|Circle|Cone|Torus|Suzanne|Object|Mesh|Material|Material\.\d+|.*\.\d{3})$/i;
export function checkModelRules(m, rules = DEFAULT_RULES.model) {
  const out = [], push = (level, text, how = '') => out.push({ level, text, how });
  const n = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  if (m.tris > rules.maxTris) push('err', `Треугольников ${n(m.tris)} — лимит команды ${n(rules.maxTris)}`, 'Децимация или ретопология; «Ремеш…» в меню модели.');
  if (m.size) {
    const big = Math.max(...m.size);
    if (big > rules.maxSize) push('warn', `Размер ${big.toFixed(1)} м — больше ${rules.maxSize} м`, 'Проверьте единицы: похоже на сантиметры вместо метров.');
    else if (big < rules.minSize) push('warn', `Размер ${(big * 100).toFixed(1)} см — меньше ${rules.minSize * 100} см`, 'Проверьте масштаб при экспорте.');
  }
  if (rules.needUV && m.uvless) push('err', `Без UV: ${m.uvless}`, 'Командные модели — с развёрткой: «Развернуть UV» в просмотре модели.');
  if (m.materials > rules.maxMaterials) push('warn', `Материалов ${m.materials} — больше ${rules.maxMaterials}`, 'Объедините похожие материалы или атлас.');
  if (rules.names) {
    const bad = [...(m.objects || []), ...(m.materialNames || [])].filter((x) => DEFAULT_NAME.test(x));
    if (bad.length) push('warn', `Имена по умолчанию: ${bad.slice(0, 4).join(', ')}${bad.length > 4 ? ` и ещё ${bad.length - 4}` : ''}`, 'Назовите объекты и материалы по смыслу — в общей библиотеке их ищут по имени.');
  }
  if (!out.length) push('ok', 'Модель по правилам команды');
  return out;
}
