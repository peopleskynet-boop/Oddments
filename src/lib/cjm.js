// Customer Journey Map from a flow collection (a screen recording cut into screens, flows.js). Designers at the demo
// said the flow is what a CJM starts from: the steps are the journey's touchpoints in order, with real timing.
// Kept as an optional field of the collection — `cjm: { stages: [{ name, from }], steps: { [itemId]: { act, goal,
// feel, pain, idea } } }` — the library's format stays as it was. `feel` is the emotion curve: −2 … +2.
// What the recording itself says (no AI): the wait on a loading screen before a step, going back to a screen seen
// before (`flowSig` of the step's file), a step that took much longer than the others — offered as pains, never added
// by themselves.
import { S, folderById } from '../state.js';
import { assetUrl } from './library.js';
import { t } from './i18n.js';

export const LANES = [
  ['act', 'Действие', 'Что человек делает на этом шаге'],
  ['goal', 'Цель', 'Чего он хочет добиться'],
  ['feel', 'Эмоция', 'Как он себя чувствует: от раздражения до радости'],
  ['pain', 'Боли', 'Что мешает, злит, путает'],
  ['idea', 'Возможности', 'Что можно улучшить'],
];
export const FEELS = [[2, 'Радость'], [1, 'Хорошо'], [0, 'Ровно'], [-1, 'Неприятно'], [-2, 'Раздражение']];

export function stepsOf(fid) {
  const f = folderById(fid);
  if (!f || !f.flow) return [];
  return (f.order || []).map((id) => S.byId.get(id)).filter((it) => it && !it.trashed);
}
export function cjmOf(f) {
  if (!f.cjm) f.cjm = { stages: [], steps: {} };
  if (!Array.isArray(f.cjm.stages)) f.cjm.stages = [];
  if (!f.cjm.steps || typeof f.cjm.steps !== 'object') f.cjm.steps = {};
  return f.cjm;
}
export const cell = (c, id) => c.steps[id] || (c.steps[id] = {});
// a map with nothing written in it yet (no stages named, no cells) — the collection does not need the field
export const blank = (c) => !c || (!c.stages.length && !Object.values(c.steps).some((v) => v && Object.values(v).some((x) => x !== '' && x != null)));

// stages as runs of steps: [{ name, from, to }] (to exclusive); without stages — one stage over all
export function stagesOf(c, n) {
  const st = c.stages.filter((s) => s.from > 0 && s.from < n).sort((a, b) => a.from - b.from);
  const first = c.stages.find((s) => s.from === 0);
  const list = [{ name: (first && first.name) || '', from: 0 }, ...st.filter((s, i, a) => !i || s.from !== a[i - 1].from)];
  return list.map((s, i) => ({ name: s.name || '', from: s.from, to: i + 1 < list.length ? list[i + 1].from : n }));
}
export function splitAt(c, from) { if (from > 0 && !c.stages.some((s) => s.from === from)) c.stages.push({ name: '', from }); }
export function mergeAt(c, from) { c.stages = c.stages.filter((s) => s.from !== from); }
export function nameStage(c, from, name) {
  const s = c.stages.find((x) => x.from === from);
  if (s) s.name = name; else c.stages.push({ name, from });
}

const sec = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
// hints from the recording, per step: [{ text }]
export function hints(steps) {
  const dw = steps.map((it, i) => (it.flowT != null && steps[i + 1] && steps[i + 1].flowT != null ? steps[i + 1].flowT - it.flowT : null));
  const known = dw.filter((x) => x != null).sort((a, b) => a - b);
  const med = known.length ? known[Math.floor(known.length / 2)] : 0;
  return steps.map((it, i) => {
    const out = [];
    for (const g of it.flowSig || []) {
      if (g.k === 'wait' && g.s >= 1) out.push({ text: `Ожидание ${sec(g.s)} с перед этим экраном` });
      else if (g.k === 'back') out.push({ text: g.to ? `Вернулся назад, к шагу ${g.to}` : 'Вернулся к экрану, который уже видел' });
    }
    if (dw[i] != null && med > 0 && dw[i] >= Math.max(8, med * 2.5)) out.push({ text: `Долго на этом шаге: ${sec(dw[i])} с (обычно ${sec(med)} с)` });
    return out;
  });
}
export const dwell = (steps, i) => (steps[i].flowT != null && steps[i + 1] && steps[i + 1].flowT != null ? steps[i + 1].flowT - steps[i].flowT : null);

/* ---------- stages proposed by the screens themselves ---------- */
const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
const pic = (it) => assetUrl(it.kind === 'image' ? it.file : it.thumb || it.file);
// where the look changes most between neighbours (another section of the app) — there a new stage starts;
// about one stage per four steps, two to six, no stage shorter than two steps
export async function proposeStages(steps) {
  const n = steps.length;
  if (n < 4) return [0];
  const W = 24, H = 48, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const px = [];
  for (const it of steps) {
    const im = await load(pic(it));
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    if (im) g.drawImage(im, 0, 0, W, H);
    px.push(g.getImageData(0, 0, W, H).data.slice());
  }
  const d = [];
  for (let i = 1; i < n; i++) {
    let s = 0;
    for (let j = 0; j < px[i].length; j += 4) s += Math.abs(px[i][j] - px[i - 1][j]) + Math.abs(px[i][j + 1] - px[i - 1][j + 1]) + Math.abs(px[i][j + 2] - px[i - 1][j + 2]);
    // the time gap counts too: a long pause before a step often is a new part of the task
    const gap = dwell(steps, i - 1) || 0;
    d.push({ at: i, v: s / (px[i].length * 0.75 * 255) + Math.min(gap, 20) / 200 });
  }
  const k = Math.max(2, Math.min(6, Math.round(n / 4)));
  const cuts = [];
  for (const x of d.slice().sort((a, b) => b.v - a.v)) {
    if (cuts.length >= k - 1) break;
    if (x.at < 2 || n - x.at < 2 || cuts.some((c2) => Math.abs(c2 - x.at) < 2)) continue;
    cuts.push(x.at);
  }
  return [0, ...cuts.sort((a, b) => a - b)];
}

/* ---------- PNG: the whole map as one picture ---------- */
function wrap(g, text, w) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + word : word;
      if (g.measureText(t).width > w && line) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}
export async function renderPng(title, steps, c) {
  const colW = 260, labW = 150, pad = 40, imgH = 340, laneH = { act: 120, goal: 110, feel: 150, pain: 140, idea: 120 };
  const n = steps.length, st = stagesOf(c, n);
  const W = pad * 2 + labW + n * colW;
  const H = pad + 70 + 46 + imgH + 30 + LANES.reduce((a, [k]) => a + laneH[k], 0) + pad;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const BG = '#0e0f12', FG = '#f2f2f0', MUT = '#9a9aa0', LINE = 'rgba(255,255,255,.12)', ACC = '#c6ff00';
  const font = (sz, wt = 400) => `${wt} ${sz}px "Geist Variable", "Segoe UI", sans-serif`;
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  g.fillStyle = FG; g.font = font(30, 700); g.fillText(title, pad, pad + 30);
  g.fillStyle = MUT; g.font = font(15); g.fillText(t(`Customer Journey Map · ${n} шагов · из Oddments`), pad, pad + 56); // canvas text: translated here, i18n.js sees only the DOM
  let y = pad + 70;
  const x0 = pad + labW;
  // stages
  st.forEach((s, i) => {
    const x = x0 + s.from * colW, w = (s.to - s.from) * colW - 10;
    g.fillStyle = i % 2 ? 'rgba(198,255,0,.10)' : 'rgba(198,255,0,.18)';
    g.beginPath(); g.roundRect(x, y, w, 36, 18); g.fill();
    g.fillStyle = FG; g.font = font(15, 650); g.fillText(s.name || t(`Этап ${i + 1}`), x + 16, y + 23);
  });
  y += 46;
  // screens
  for (let i = 0; i < n; i++) {
    const im = await load(pic(steps[i]));
    const x = x0 + i * colW;
    g.fillStyle = MUT; g.font = font(13, 600); g.fillText(t(`Шаг ${String(i + 1).padStart(2, '0')}`), x, y + 14);
    if (im) {
      const k = Math.min((colW - 30) / im.width, (imgH - 26) / im.height), w = im.width * k, h = im.height * k;
      g.save(); g.beginPath(); g.roundRect(x, y + 24, w, h, 14); g.clip(); g.drawImage(im, x, y + 24, w, h); g.restore();
    }
  }
  y += imgH + 30;
  // lanes
  for (const [k, label] of LANES) {
    const h = laneH[k];
    g.strokeStyle = LINE; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
    g.fillStyle = MUT; g.font = font(14, 650); g.fillText(t(label), pad, y + 26);
    if (k === 'feel') {
      const yy = (v) => y + 20 + ((2 - v) / 4) * (h - 40);
      g.strokeStyle = 'rgba(255,255,255,.08)';
      for (let v = -2; v <= 2; v++) { g.beginPath(); g.moveTo(x0, yy(v)); g.lineTo(x0 + n * colW - 30, yy(v)); g.stroke(); }
      const pts = steps.map((it, i) => [x0 + i * colW + (colW - 30) / 2, c.steps[it.id] && c.steps[it.id].feel != null ? c.steps[it.id].feel : null]).filter((p) => p[1] != null);
      g.strokeStyle = ACC; g.lineWidth = 3; g.beginPath();
      pts.forEach(([x, v], i) => (i ? g.lineTo(x, yy(v)) : g.moveTo(x, yy(v)))); g.stroke(); g.lineWidth = 1;
      for (const [x, v] of pts) { g.fillStyle = v < 0 ? '#ff5d6c' : ACC; g.beginPath(); g.arc(x, yy(v), 7, 0, Math.PI * 2); g.fill(); }
    } else {
      g.font = font(14); g.fillStyle = FG;
      steps.forEach((it, i) => {
        const t = c.steps[it.id] && c.steps[it.id][k];
        if (!t) return;
        const lines = wrap(g, t, colW - 40).slice(0, Math.floor((h - 18) / 19));
        lines.forEach((l, j) => g.fillText(l, x0 + i * colW, y + 26 + j * 19));
      });
    }
    y += h;
  }
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
