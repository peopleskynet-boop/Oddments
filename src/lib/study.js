// Usability studies: several recordings of one scenario (one flow collection per respondent, flows.js) joined into a
// study, with notes at the steps — a problem, a quote, an insight. What comes out: per step, how many respondents
// waited, went back, lingered, and what they said; the sentences a CJM and a report need («3 из 5 вернулись назад на
// шаге 4»). Steps of different respondents are matched by their number — the same scenario goes the same way.
// Stored on the flow collections (optional fields): `study: { id, resp }`, `rnotes: [{ id, step (item id), kind, text,
// t (second of the recording) }]`. Pure: give it the flows with their steps.

export const NOTE_KINDS = [['problem', 'Проблема'], ['quote', 'Цитата'], ['insight', 'Инсайт']];
const plural = (n, f) => f[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];

// flows: [{ name, resp, steps: [{ id, flowT, flowSig }], notes: [{ step, kind, text, t }] }]
export function aggregate(flows) {
  const n = flows.length, len = Math.max(0, ...flows.map((f) => f.steps.length));
  const per = Array.from({ length: len }, (_, i) => ({ step: i + 1, reached: 0, backs: 0, waits: 0, slow: 0, notes: [] }));
  for (const f of flows) {
    const t = f.steps.map((s) => s.flowT);
    const dw = t.map((x, i) => (x != null && t[i + 1] != null ? t[i + 1] - x : null)).filter((x) => x != null).sort((a, b) => a - b);
    const med = dw.length ? dw[Math.floor(dw.length / 2)] : 0;
    f.steps.forEach((s, i) => {
      const p = per[i];
      p.reached++;
      const sig = s.flowSig || [];
      if (sig.some((g) => g.k === 'back')) p.backs++;
      if (sig.some((g) => g.k === 'wait' && g.s >= 1)) p.waits++;
      const d = t[i] != null && t[i + 1] != null ? t[i + 1] - t[i] : null;
      if (d != null && med > 0 && d >= Math.max(8, med * 2.5)) p.slow++;
    });
    for (const nt of f.notes || []) {
      const i = f.steps.findIndex((s) => s.id === nt.step);
      if (i >= 0) per[i].notes.push({ ...nt, resp: f.resp || f.name });
    }
  }
  return { n, steps: per, sentences: sentences(per, n) };
}

// the findings, worst first: what most respondents ran into
export function sentences(per, n) {
  const out = [];
  const who = (k) => `${k} из ${n}`;
  for (const p of per) {
    if (p.backs) out.push({ w: p.backs, step: p.step, text: `${who(p.backs)} вернулись назад на шаге ${p.step}` });
    if (p.waits) out.push({ w: p.waits * 0.8, step: p.step, text: `${who(p.waits)} ждали загрузку перед шагом ${p.step}` });
    if (p.slow) out.push({ w: p.slow * 0.9, step: p.step, text: `${who(p.slow)} задержались на шаге ${p.step}` });
    const pr = p.notes.filter((x) => x.kind === 'problem').length;
    if (pr) out.push({ w: pr * 1.1, step: p.step, text: `Шаг ${p.step}: ${pr} ${plural(pr, ['проблема', 'проблемы', 'проблем'])} в заметках` });
  }
  const full = per.length ? per[per.length - 1].reached : 0;
  if (n > 1 && full < n) out.push({ w: n - full + 0.5, step: per.length, text: `${who(full)} дошли до последнего шага` });
  return out.sort((a, b) => b.w - a.w || a.step - b.step);
}

const fmtT = (t) => (t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

// the report: Markdown, ready for Confluence, a chat or a doc
export function reportMd(title, flows, agg = aggregate(flows)) {
  const L = [`# ${title}`, '', `Респондентов: ${agg.n}. Шагов в сценарии: ${agg.steps.length}.`, ''];
  L.push('## Главное', '');
  if (agg.sentences.length) agg.sentences.slice(0, 10).forEach((s) => L.push(`- ${s.text}`)); else L.push('- Заметных затруднений запись не показала.');
  L.push('', '## По шагам', '', '| Шаг | Дошли | Назад | Ждали | Задержались | Заметки |', '|---|---|---|---|---|---|');
  for (const p of agg.steps) L.push(`| ${p.step} | ${p.reached} | ${p.backs} | ${p.waits} | ${p.slow} | ${p.notes.length} |`);
  for (const [k, name] of NOTE_KINDS) {
    const all = agg.steps.flatMap((p) => p.notes.filter((x) => x.kind === k).map((x) => ({ ...x, at: p.step })));
    if (!all.length) continue;
    L.push('', `## ${name === 'Цитата' ? 'Цитаты' : name === 'Проблема' ? 'Проблемы' : 'Инсайты'}`, '');
    all.forEach((x) => L.push(`- Шаг ${x.at}${x.t != null ? `, ${fmtT(x.t)}` : ''} — ${x.resp}: ${k === 'quote' ? `«${x.text}»` : x.text}`));
  }
  L.push('', '## Респонденты', '');
  flows.forEach((f) => L.push(`- ${f.resp || f.name}: ${f.steps.length} ${plural(f.steps.length, ['шаг', 'шага', 'шагов'])}${f.steps.length && f.steps[f.steps.length - 1].flowT != null ? `, ${fmtT(f.steps[f.steps.length - 1].flowT)} записи` : ''}`));
  return L.join('\n') + '\n';
}

// for the CJM (cjm.js): per step index, what the study says — shown in the «Из записи» lane
export function studyHints(agg) {
  return agg.steps.map((p) => {
    const out = [];
    if (p.backs) out.push({ text: `${p.backs} из ${agg.n} вернулись назад` });
    if (p.waits) out.push({ text: `${p.waits} из ${agg.n} ждали загрузку` });
    if (p.slow) out.push({ text: `${p.slow} из ${agg.n} задержались` });
    p.notes.filter((x) => x.kind === 'problem').slice(0, 3).forEach((x) => out.push({ text: `${x.resp}: ${x.text}` }));
    return out;
  });
}
