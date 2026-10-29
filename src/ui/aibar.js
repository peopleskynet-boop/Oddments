// The AI pill: while the model is downloading or the library is being studied, a small glass pill in the
// corner says so — «ИИ изучает библиотеку · 120 из 187 · ~2 мин» — with a pause. A click opens what the AI is
// doing step by step (after «Thinking» and «Task Rows» from Beautiful UI, beautifului.dev, MIT): the model,
// studying, tags, search — each running (pixel loader), done, waiting or failed. When the work ends the pill says
// «ИИ готов» for a few seconds and goes; an error stays with «Повторить».
import { AI, onAi, setPaused, turnOn, aiOn, approveCloud, declineCloud, clearAiError } from '../lib/ai.js';
import { S } from '../state.js';
import { cloudPrefs, hasVoyage, usd } from '../lib/aicloud.js';
import { ic } from './icons.js';
import { pixGrid } from './pixload.js';
import { plural } from '../util.js';

let el = null, row = null, steps = null, txt = null, icon = null, act = null;
let iconKind = '', actKind = '', wasBusy = false, doneUntil = 0, doneTimer = 0, open = false, pinned = false;
const WHERE = { tags: 'ИИ-теги не подобрались', search: 'Поиск по смыслу не сработал', save: 'Не сохранились векторы', study: 'Картинка не изучилась' };

const mb = (b) => Math.round(b / 1e6);
const eta = (ms) => {
  const m = Math.round(ms / 60000);
  return ms < 60000 ? 'меньше минуты' : m < 60 ? `~${m} мин` : `~${Math.floor(m / 60)} ч ${m % 60} мин`;
};
const ICON = { run: () => pixGrid('drive'), done: () => ic('check'), err: () => ic('warnC'), pause: () => ic('pause'), wait: () => '<i class="ai-wait"></i>' };
const setIcon = (node, kind, cur) => { if (cur !== kind) node.innerHTML = ICON[kind](); return kind; };

// the four steps of the AI, each { k, label, state, value }
function stepList() {
  const ready = AI.status === 'ready', all = AI.done + AI.todo;
  const api = AI.device === 'api';
  const dev = AI.device === 'webgpu' ? 'на видеокарте' : AI.device ? 'на процессоре' : '';
  const apiName = () => cloudPrefs().tagModel.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase()) + (hasVoyage() ? ' + Voyage' : '');
  const model = AI.status === 'download' ? ['run', `скачиваю · ${mb(AI.got)} из ${mb(AI.total)} МБ`]
    : AI.status === 'loading' ? ['run', 'запускаю']
    : AI.status === 'error' ? ['err', AI.error || 'ошибка']
    : ready ? ['done', api ? 'API · ' + apiName() : 'SigLIP 2 ' + dev] : ['wait', 'выключен'];
  let study = !ready ? ['wait', 'после запуска']
    : AI.confirm ? ['pause', `ждёт «Начать» · ≈ ${usd(AI.confirm.usd)}`]
    : AI.todo > 0 ? [AI.paused ? 'pause' : 'run', `${AI.done} из ${all}${AI.paused ? ' · пауза' : AI.rate ? ' · ' + eta(AI.rate * AI.todo) : ''}`]
    : ['done', `${AI.done} ${plural(AI.done, ['картинка', 'картинки', 'картинок'])}`];
  let tags = AI.phase === 'words' ? ['run', `словарь · ${AI.tagging} из ${AI.tagTotal}`]
    : AI.phase === 'tags' ? ['run', `${AI.tagging} из ${AI.tagTotal}`]
    : api && ready && AI.todo > 0 && !AI.confirm ? ['run', 'вместе с изучением']
    : !ready || AI.todo > 0 ? ['wait', 'после изучения']
    : ['done', AI.tagged >= 0 ? `новые теги у ${AI.tagged}` : 'готово'];
  const le = AI.lastError;
  const search = le && le.where === 'search' ? ['err', le.msg] : ready ? ['done', AI.searching ? 'ищу…' : 'опишите картинку в поиске'] : ['wait', ''];
  if (le && le.where === 'tags') tags.splice(0, 2, 'err', le.msg);
  if (le && (le.where === 'study' || le.where === 'save') && study[0] === 'done') study.splice(0, 2, 'err', le.msg);
  return [
    { k: 'model', label: 'Модель', s: model },
    { k: 'study', label: 'Изучение библиотеки', s: study },
    { k: 'tags', label: 'ИИ-теги', s: tags },
    { k: 'search', label: 'Поиск по смыслу', s: search },
  ];
}

function drawSteps() {
  if (!open) return;
  for (const st of stepList()) {
    let r = steps.querySelector(`[data-k="${st.k}"]`);
    if (!r) {
      r = document.createElement('div');
      r.className = 'ai-step';
      r.dataset.k = st.k;
      r.innerHTML = `<span class="ai-si"></span><span class="ai-sl"></span><span class="ai-sv"></span>`;
      r.querySelector('.ai-sl').textContent = st.label;
      steps.appendChild(r);
    }
    const [state, value] = st.s;
    const si = r.querySelector('.ai-si');
    si.dataset.kind = setIcon(si, state, si.dataset.kind);
    r.className = 'ai-step ' + state;
    r.querySelector('.ai-sv').textContent = value;
  }
}

function render() {
  if (!el) return;
  let body = '', a = '', kind = 'run';
  const all = AI.done + AI.todo;
  if (AI.status === 'download') {
    body = `Скачиваю модель ИИ · ${mb(AI.got)} из ${mb(AI.total)} МБ`;
    el.style.setProperty('--p', (AI.total ? AI.got / AI.total : 0).toFixed(3));
  } else if (AI.status === 'loading') {
    body = 'Запускаю ИИ…';
    el.style.setProperty('--p', '0');
  } else if (AI.status === 'error') {
    body = 'ИИ-поиск не запустился: ' + AI.error;
    a = 'retry'; kind = 'err';
  } else if (AI.status === 'ready' && AI.lastError && !AI.todo && !AI.phase) {
    // a failure after the start: said, not swallowed (the exe has no console)
    body = (WHERE[AI.lastError.where] || 'Ошибка ИИ') + ': ' + AI.lastError.msg;
    a = 'ack'; kind = 'err';
  } else if (AI.status === 'ready' && AI.confirm) {
    // a pass through the API costs money: it starts when the person agrees to the estimate
    const c = AI.confirm;
    body = `ИИ через API: ${c.n} ${plural(c.n, ['картинка', 'картинки', 'картинок'])} ≈ ${usd(c.usd)}`;
    a = 'confirm'; kind = 'pause';
    el.style.setProperty('--p', '0');
  } else if (AI.status === 'ready' && AI.phase) {
    body = AI.phase === 'words' ? `ИИ готовит словарь тегов · ${AI.tagging} из ${AI.tagTotal}` : `ИИ подбирает теги · ${AI.tagging} из ${AI.tagTotal}`;
    el.style.setProperty('--p', (AI.tagTotal ? AI.tagging / AI.tagTotal : 0).toFixed(3));
  } else if (AI.status === 'ready' && AI.todo > 0) {
    body = AI.paused
      ? `Изучение на паузе · ${AI.done} из ${all}`
      : `ИИ изучает библиотеку · ${AI.done} из ${all}${AI.rate ? ' · ' + eta(AI.rate * AI.todo) : ''}`;
    a = AI.paused ? 'go' : 'pause';
    el.style.setProperty('--p', (AI.done / all).toFixed(3));
    if (AI.paused) kind = 'pause';
  } else if (AI.status === 'ready' && (wasBusy || Date.now() < doneUntil)) {
    // the work just ended: say so for a moment instead of vanishing mid-sentence
    if (wasBusy) { doneUntil = Date.now() + 5000; clearTimeout(doneTimer); doneTimer = setTimeout(render, 5100); }
    wasBusy = false;
    body = `ИИ готов · изучено ${AI.done}${AI.tagged > 0 ? ' · новые теги у ' + AI.tagged : ''}`;
    el.style.setProperty('--p', '1');
    kind = 'done';
  } else if (pinned) {
    // opened from the «ИИ» chip in the search box while there is nothing to do: the steps, all done
    body = AI.status === 'ready' ? `ИИ работает · изучено ${AI.done}` : 'ИИ выключен — включите в Настройках › «ИИ»';
    kind = AI.status === 'ready' ? 'done' : 'pause';
  } else {
    if (open && el.matches(':hover')) { drawSteps(); return; } // the person is reading the steps
    el.classList.remove('on');
    el.inert = true; // faded out, it is not a Tab stop either (audit 29.10)
    return;
  }
  if (kind === 'run') wasBusy = true;
  el.inert = false; // before the text changes: the status is read out
  iconKind = setIcon(icon, kind, iconKind);
  txt.textContent = body;
  txt.className = kind === 'run' ? 'ai-txt shim' : 'ai-txt';
  if (a !== actKind) {
    actKind = a;
    act.innerHTML = a === 'confirm' ? '<button type="button" data-ai="no">Не сейчас</button><button type="button" class="pri" data-ai="ok">Начать</button>'
      : a ? `<button type="button" data-ai="${a}">${a === 'retry' ? 'Повторить' : a === 'go' ? 'Продолжить' : a === 'ack' ? 'Понятно' : 'Пауза'}</button>` : '';
  }
  el.title = AI.confirm ? 'В облако уходят уменьшенные копии картинок (512 px), оплата за каждую — один раз. Сумма примерная.' : AI.status === 'ready' ? 'Oddments один раз изучает каждую картинку, чтобы находить её по смыслу. Это идёт в фоне и не мешает работе.' : '';
  el.classList.toggle('err', kind === 'err');
  el.classList.toggle('fin', kind === 'done');
  el.classList.add('on');
  drawSteps();
}

function toggle(v = !open) {
  open = v;
  el.classList.toggle('open', open);
  el.querySelector('.ai-chev').setAttribute('aria-expanded', String(open));
  steps.hidden = !open;
  if (open) drawSteps();
}

export function initAiBar() {
  el = document.createElement('div');
  el.className = 'aibar glass';
  el.inert = true; // until it has something to say
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="ai-steps" hidden></div>
    <div class="ai-row"><span class="ai-ic"></span><span class="ai-txt"></span><span class="ai-act"></span><button type="button" class="ai-chev" aria-expanded="false" aria-label="Что делает ИИ" title="Что делает ИИ">${ic('caretD')}</button></div>
    <b class="ai-track"></b>`;
  document.body.appendChild(el);
  row = el.querySelector('.ai-row'); steps = el.querySelector('.ai-steps');
  txt = el.querySelector('.ai-txt'); icon = el.querySelector('.ai-ic'); act = el.querySelector('.ai-act');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ai]');
    if (!b) { if (e.target.closest('.ai-row')) toggle(); return; }
    if (b.dataset.ai === 'pause') setPaused(true);
    else if (b.dataset.ai === 'go') setPaused(false);
    else if (b.dataset.ai === 'retry' && aiOn()) turnOn();
    else if (b.dataset.ai === 'ok') approveCloud();
    else if (b.dataset.ai === 'ack') { clearAiError(); if (aiOn()) turnOn(); }
    else if (b.dataset.ai === 'no') declineCloud();
  });
  el.addEventListener('pointerleave', () => { if (!el.querySelector(':focus')) setTimeout(render, 400); });
  // a click anywhere else lets go of a pill opened from the chip
  document.addEventListener('pointerdown', (e) => { if (pinned && !el.contains(e.target) && !e.target.closest('#aiChip')) { pinned = false; toggle(false); render(); } }, true);
  chip = document.getElementById('aiChip');
  if (chip) chip.addEventListener('click', (e) => { e.preventDefault(); pinned = !pinned; toggle(pinned); render(); });
  let raf = 0;
  // the search box says what it can do: with AI on, describe the picture in your own words
  const q = document.getElementById('q'), plain = q ? q.placeholder : '';
  onAi(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { render(); updateAiChip(); });
    if (q) q.placeholder = AI.status === 'ready' ? 'Найти: название, #тег или что на картинке — «рука с наушниками»' : plain;
  });
}

// The «ИИ» chip in the search box (bug #48): is the AI on, busy, broken — and how much of this search it found.
let chip = null, chipKey = '';
export function updateAiChip() {
  if (!chip) return;
  const on = aiOn() || AI.status !== 'off';
  chip.hidden = !on;
  if (!on) return;
  const q = S.q.trim(), ready = AI.status === 'ready';
  const busy = AI.status === 'download' || AI.status === 'loading' || (ready && (AI.todo > 0 && !AI.paused && !AI.confirm || !!AI.phase)) || (q && AI.searching);
  const bad = AI.status === 'error' || !!AI.lastError;
  const text = bad ? 'ИИ !' : q && ready ? (AI.searching ? 'по смыслу…' : S.aiHits ? `по смыслу: ${S.aiHits}` : 'ИИ') : 'ИИ';
  const key = [busy, bad, text].join('|');
  chip.title = bad ? 'ИИ: ошибка — нажмите, чтобы посмотреть'
    : q && S.aiHits ? `ИИ добавил ${S.aiHits} ближайших по смыслу — не по словам, а по тому, что на картинке`
    : AI.status === 'download' ? 'ИИ: скачиваю модель' : ready && AI.todo ? `ИИ изучает библиотеку: ${AI.done} из ${AI.done + AI.todo}` : ready ? 'ИИ включён: опишите, что на картинке' : 'ИИ запускается';
  chip.setAttribute('aria-label', chip.title);
  if (key === chipKey) return;
  chipKey = key;
  chip.className = 'ai-chip' + (bad ? ' err' : '') + (busy ? ' busy' : '');
  chip.innerHTML = (busy ? pixGrid('drive') : bad ? ic('warnC') : ic('sparkle')) + '<span></span>';
  chip.querySelector('span').textContent = text;
}
