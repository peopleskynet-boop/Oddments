// «Поделиться…» (lib/share.js; CLAUDE.md, 17.11.2026): one window for a collection or the selected files. A new link —
// how much goes and what it costs, what to warn about (a team's files, personal data), a note, the term, «Создать
// ссылку»; while it goes up — the progress and «Отмена»; a link that is there — the address, how long it lives, how far it
// is behind the collection, «Обновить» and «Закрыть ссылку». Nothing is sent before the button.
import './share.css';
import { ui, folderById } from '../state.js';
import { esc, fmtSize, plural } from '../util.js';
import { ic } from './icons.js';
import { toast, arm } from './dialogs.js';
import { pushLayer, popLayer } from './layers.js';
import { lang } from '../lib/i18n.js';
import * as sh from '../lib/share.js';

let el = null, back = null, job = null;

// source: { folder } | { items: [ids], title } | either with id — a link made before (Настройки › Ссылки)
export function openShare(source) {
  back = document.activeElement;
  if (!el) {
    el = document.createElement('div');
    el.className = 'modal shr';
    el.addEventListener('pointerdown', (e) => { if (e.target === el && !job) closeShare(); });
    document.body.appendChild(el);
  }
  const rec = source.id ? sh.listShares()[source.id] || null : source.folder ? sh.shareOfFolder(source.folder) : null;
  if (!sh.configured()) drawSetup();
  else if (rec && !sh.expired(rec)) drawLink(rec);
  else drawForm(source, rec);
  el.classList.add('on');
  pushLayer({ el, title: 'Поделиться ссылкой', close: closeShare });
  requestAnimationFrame(() => { const f = el.querySelector('[autofocus], .pri'); if (f) f.focus(); });
}

export function closeShare() {
  if (!el || !el.classList.contains('on')) return;
  if (job) job.abort();
  el.classList.remove('on');
  popLayer(el);
  if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
  back = null;
}

const when = (t) => new Date(t).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });
const files = (n) => `${n} ${plural(n, ['файл', 'файла', 'файлов'])}`;
const termChips = (cur) => `<div class="shr-terms" role="radiogroup" aria-label="Срок ссылки">${sh.TERMS.map((d) => `<button type="button" role="radio" class="shr-chip" data-term="${d}" aria-checked="${d === cur}">${d ? `${d} дней` : 'Бессрочно'}</button>`).join('')}</div>`;
const pickTerm = (box) => box.addEventListener('click', (e) => {
  const b = e.target.closest('[data-term]');
  if (!b) return;
  box.querySelectorAll('[data-term]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
});
const termOf = (box) => +(box.querySelector('[data-term][aria-checked="true"]') || { dataset: { term: 30 } }).dataset.term;

/* ---------- no storage yet ---------- */
function drawSetup() {
  el.innerHTML = `<div class="dlg shr-dlg" role="dialog" aria-modal="true" aria-labelledby="shrT">
    <h2 id="shrT">Поделиться ссылкой</h2>
    <p class="shr-txt">Ссылка открывается в браузере на любом устройстве, Oddments для этого не нужен. Файлы лежат в вашем облачном хранилище — его нужно один раз подключить: бакет и ключ доступа в «Настройки › Ссылки».</p>
    <div class="row"><button type="button" class="ibtn" data-sh="cancel">Отмена</button><button type="button" class="ibtn pri" data-sh="setup">Настроить хранилище</button></div>
  </div>`;
  el.querySelector('[data-sh="cancel"]').onclick = closeShare;
  el.querySelector('[data-sh="setup"]').onclick = () => { closeShare(); import('./settings.js').then((m) => m.openSettings('sgShare')); };
}

/* ---------- a new link (or a gone one made again) ---------- */
function drawForm(source, old) {
  const sv = sh.survey(source);
  const hasNotes = sh.itemsOf(source).items.some((i) => Array.isArray(i.notes) && i.notes.length);
  const price = sh.price(sv.bytes);
  el.innerHTML = `<form class="dlg shr-dlg" role="dialog" aria-modal="true" aria-labelledby="shrT">
    <h2 id="shrT">Поделиться «${esc(sv.title)}»</h2>
    <p class="shr-sum">${files(sv.count)} · ≈ ${fmtSize(sv.bytes)}${price ? ` · ${price}` : ''}</p>
    ${old ? '<p class="shr-txt">Срок прошлой ссылки вышел, хранилище её удалило. Будет новая ссылка.</p>' : ''}
    ${sv.team.length ? `<label class="shr-warn"><input type="checkbox" id="shrTeam"> <span>В подборке файлы команды (${esc(sv.team.join(', '))}) — они тоже уйдут по ссылке. Делиться ими можно?</span></label>` : ''}
    ${sv.pii.length ? `<label class="shr-warn"><input type="checkbox" id="shrHide" checked> <span>На ${sv.pii.length} ${plural(sv.pii.length, ['картинке', 'картинках', 'картинках'])} есть номера карт, телефоны или имена — скрыть их в ссылке (библиотека не меняется)</span></label>` : ''}
    <label class="shr-l" for="shrNote">Подпись для получателя — необязательно</label>
    <input id="shrNote" type="text" maxlength="280" autocomplete="off" placeholder="Например: референсы к обложке, выберите три" autofocus>
    <span class="shr-l">Срок</span>
    ${termChips(30)}
    ${hasNotes ? '<label class="shr-opt"><input type="checkbox" id="shrNotes"> <span>С комментариями на картинках</span></label>' : ''}
    <p class="shr-note">Уйдут оригиналы, имена, теги, цвета и ссылки на источник. Заметки, ИИ-описания и распознанный текст остаются у вас.</p>
    <div class="row"><button type="button" class="ibtn" data-sh="cancel">Отмена</button><button type="submit" class="ibtn pri" id="shrGo">Создать ссылку</button></div>
  </form>`;
  const form = el.querySelector('form');
  pickTerm(form.querySelector('.shr-terms'));
  form.querySelector('[data-sh="cancel"]').onclick = closeShare;
  const team = form.querySelector('#shrTeam'), go = form.querySelector('#shrGo');
  if (team) { go.disabled = true; team.onchange = () => { go.disabled = !team.checked; }; }
  form.onsubmit = (e) => {
    e.preventDefault();
    const hide = form.querySelector('#shrHide');
    const notes = form.querySelector('#shrNotes');
    run({ source, term: termOf(form), note: form.querySelector('#shrNote').value.trim(), comments: !!(notes && notes.checked), hide: !!(hide && hide.checked) }, sv.title, () => drawForm(source, old));
  };
}

/* ---------- going up ---------- */
function run(opts, title, onFail) {
  job = new AbortController();
  el.innerHTML = `<div class="dlg shr-dlg" role="dialog" aria-modal="true" aria-labelledby="shrT" aria-busy="true">
    <h2 id="shrT">${opts.id ? 'Обновляю' : 'Выгружаю'} «${esc(title)}»</h2>
    <p class="shr-sum" id="shrSt" aria-live="polite">Готовлю файлы</p>
    <div class="shr-bar"><i></i></div>
    <div class="row"><button type="button" class="ibtn" data-sh="stop">Отмена</button></div>
  </div>`;
  const st = el.querySelector('#shrSt'), bar = el.querySelector('.shr-bar i');
  el.querySelector('[data-sh="stop"]').onclick = () => job && job.abort();
  sh.publish(opts, ({ label, done, total }) => {
    st.textContent = total > 1 && label === 'Выгружаю' ? `Выгружаю · ${fmtSize(done)} из ${fmtSize(total)}` : label;
    bar.style.transform = `scaleX(${total ? Math.min(1, done / total) : 0})`;
  }, job.signal).then((rec) => {
    job = null;
    if (!el.classList.contains('on')) return;
    drawLink(rec, true);
    copyLink(rec, true);
    if (ui.renderSide) ui.renderSide();
  }).catch((e) => {
    job = null;
    const why = sh.explain(e);
    if (!why) { if (el.classList.contains('on')) onFail(); return; } // cancelled
    toast(`Не удалось поделиться: ${why}.`, 9000);
    if (el.classList.contains('on')) onFail();
  });
}

/* ---------- a link that is there ---------- */
function drawLink(rec, fresh = false) {
  const url = sh.shareUrl(rec), changed = sh.changesOf(rec);
  const life = rec.expires ? `Действует до ${when(rec.expires)}` : 'Действует, пока не закроете';
  el.innerHTML = `<div class="dlg shr-dlg" role="dialog" aria-modal="true" aria-labelledby="shrT">
    <h2 id="shrT">${fresh ? 'Ссылка готова' : `Ссылка на «${esc(rec.title)}»`}</h2>
    <p class="shr-sum">${files(rec.count)} · ${fmtSize(rec.bytes)} · ${life}</p>
    <div class="shr-url"><input id="shrUrl" type="text" readonly value="${esc(url)}" aria-label="Ссылка"><button type="button" class="ibtn" data-sh="copy">${ic('copy')}<span>Копировать</span></button><button type="button" class="ibtn" data-sh="open" title="Открыть в браузере">${ic('external')}</button></div>
    ${changed ? `<p class="shr-chg"><i aria-hidden="true"></i>После выгрузки изменилось: ${files(changed)}. «Обновить» отправит изменения.</p>` : ''}
    <span class="shr-l">Срок — меняется вместе с «Обновить»</span>
    ${termChips(rec.term)}
    <label class="shr-l" for="shrNote">Подпись для получателя</label>
    <input id="shrNote" type="text" maxlength="280" autocomplete="off" value="${esc(rec.note || '')}">
    <div class="row"><button type="button" class="ibtn danger" data-sh="close">Закрыть ссылку</button><span class="sp"></span><button type="button" class="ibtn" data-sh="done">Готово</button><button type="button" class="ibtn${changed ? ' pri' : ''}" data-sh="update">Обновить</button></div>
  </div>`;
  const box = el.querySelector('.dlg');
  pickTerm(box.querySelector('.shr-terms'));
  box.querySelector('#shrUrl').onfocus = (e) => e.target.select();
  box.querySelector('[data-sh="copy"]').onclick = () => copyLink(rec);
  box.querySelector('[data-sh="open"]').onclick = () => import('@tauri-apps/plugin-opener').then((m) => m.openUrl(url)).catch(() => window.open(url, '_blank'));
  box.querySelector('[data-sh="done"]').onclick = closeShare;
  box.querySelector('[data-sh="update"]').onclick = () => run({ id: rec.id, source: rec.source, term: termOf(box), note: box.querySelector('#shrNote').value.trim(), comments: rec.comments, hide: rec.hide }, rec.title, () => drawLink(rec));
  const cl = box.querySelector('[data-sh="close"]');
  cl.onclick = () => arm(cl, async () => {
    try { await sh.closeShare(rec.id); toast('Ссылка закрыта, файлы удалены из хранилища'); if (ui.renderSide) ui.renderSide(); closeShare(); }
    catch (e) { toast(`Не удалось закрыть ссылку: ${sh.explain(e)}.`, 9000); }
  }, 'Закрыта');
}

export async function copyLink(rec, quiet = false) {
  const url = sh.shareUrl(rec);
  try { const { writeText } = await import('@tauri-apps/plugin-clipboard-manager'); await writeText(url); }
  catch (e) { try { await navigator.clipboard.writeText(url); } catch (e2) { toast(url, 12000); return; } }
  toast(quiet ? 'Ссылка готова и скопирована' : 'Ссылка скопирована');
}

// the collection's name for a menu item: what goes
export const shareTitleOf = (fid) => { const f = folderById(fid); return f ? f.name : ''; };
