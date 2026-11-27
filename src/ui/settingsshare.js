// Настройки › Ссылки («Поделиться ссылкой», lib/share.js): where the links live — the storage (Yandex Cloud or any S3),
// its key, «Подготовить хранилище» — and every link made from this computer: copy, open, update, close.
import './share.css';
import { ui } from '../state.js';
import { $, esc, fmtSize, plural } from '../util.js';
import { toast, arm } from './dialogs.js';
import { lang } from '../lib/i18n.js';
import * as sh from '../lib/share.js';

const when = (t) => new Date(t).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });
const suggestBucket = () => 'oddments-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

export function bindShareSettings() {
  const box = $('#sShare');
  if (!box) return;
  let c = sh.shareCfg();
  if (!c.bucket) c = sh.saveCfg({ bucket: suggestBucket() });
  const other = c.preset !== 'yandex';
  box.innerHTML = `<span>Ссылки на подборки открываются в браузере на любом устройстве — без Oddments. Файлы лежат в вашем облачном хранилище S3: Oddments только выгружает их туда по вашей кнопке.</span>
    <label class="srow-in">Хранилище <select id="shPreset" aria-label="Хранилище"><option value="yandex">Yandex Cloud — Object Storage</option><option value="other">Другое S3-хранилище</option></select></label>
    <div class="sh-grid">
      <label>Бакет<input id="shBucket" type="text" spellcheck="false" autocomplete="off" value="${esc(c.bucket)}"></label>
      <label>Идентификатор ключа<input id="shKeyId" type="text" spellcheck="false" autocomplete="off" value="${esc(c.accessKey)}" placeholder="YCAJ…"></label>
      <label ${other ? '' : 'hidden'}>Адрес API<input id="shEndpoint" type="text" spellcheck="false" autocomplete="off" value="${esc(c.endpoint)}" placeholder="https://s3.example.com"></label>
      <label ${other ? '' : 'hidden'}>Регион<input id="shRegion" type="text" spellcheck="false" autocomplete="off" value="${esc(c.region)}" placeholder="us-east-1"></label>
      <label ${other ? '' : 'hidden'}>Адрес сайта бакета<input id="shSite" type="text" spellcheck="false" autocomplete="off" value="${esc(c.site)}" placeholder="https://bucket.example.com"></label>
    </div>
    <span>Секретный ключ</span><div class="keyf" id="shSecret"></div>
    <span class="snote">Имя бакета — латиница, цифры и дефис, одно на всё облако. Ключ — статический ключ доступа сервисного аккаунта с ролью storage.admin; хранится в настройках Oddments на этом компьютере.</span>
    <code class="path" id="shState"></code>
    <div class="int-acts"><button class="ibtn pri" id="shPrep">Подготовить хранилище</button></div>
    <div class="sh-links" id="shLinks"></div>`;
  $('#shPreset').value = other ? 'other' : 'yandex';
  const field = (id, key) => { $(id).onchange = (e) => { sh.saveCfg({ [key]: e.target.value.trim() }); state(); }; };
  field('#shBucket', 'bucket'); field('#shKeyId', 'accessKey'); field('#shEndpoint', 'endpoint'); field('#shRegion', 'region'); field('#shSite', 'site');
  $('#shPreset').onchange = (e) => {
    const y = e.target.value === 'yandex', p = sh.PRESETS.yandex;
    sh.saveCfg(y ? { preset: 'yandex', endpoint: p.endpoint, region: p.region, site: '' } : { preset: 'other' });
    bindShareSettings();
  };
  import('./keyfield.js').then((kf) => kf.mountKeyField($('#shSecret'), {
    service: 's3', name: 'хранилища', placeholder: 'Секретный ключ',
    get: () => sh.shareCfg().secretKey, set: (v) => { sh.saveCfg({ secretKey: v }); state(); },
    test: async () => { try { return { ok: true, msg: await sh.checkStorage() }; } catch (e) { return { ok: false, msg: sh.explain(e) }; } },
  }));
  const prep = $('#shPrep');
  prep.onclick = async () => {
    if (!sh.hasKeys()) { toast('Впишите бакет, идентификатор и секретный ключ'); return; }
    prep.disabled = true;
    try {
      await sh.prepareStorage((step) => { $('#shState').textContent = `Готовлю хранилище · ${step}…`; });
      toast('Хранилище готово — можно делиться подборками');
    } catch (e) { toast(`Не удалось подготовить хранилище: ${sh.explain(e)}.`, 9000); }
    prep.disabled = false;
    state();
  };
  state();
  drawLinks();
}

function state() {
  const c = sh.shareCfg(), el = $('#shState');
  if (!el) return;
  el.textContent = !sh.hasKeys(c) ? 'Не настроено' : c.ready ? `Готово · ссылки на ${sh.siteOf(c)}` : 'Ключ вписан — нажмите «Подготовить хранилище»';
  $('#shPrep').textContent = c.ready ? 'Подготовить заново' : 'Подготовить хранилище';
}

function drawLinks() {
  const box = $('#shLinks');
  if (!box) return;
  const list = Object.values(sh.listShares()).sort((a, b) => b.updated - a.updated);
  if (!list.length) { box.innerHTML = '<span class="snote">Ссылок пока нет. «Поделиться…» — в меню подборки или выделенных файлов.</span>'; return; }
  box.innerHTML = `<span class="sh-h">Ссылки (${list.length})</span>` + list.map((r) => {
    const gone = sh.expired(r), n = gone ? 0 : sh.changesOf(r);
    const life = gone ? 'срок вышел' : r.expires ? `до ${when(r.expires)}` : 'бессрочно';
    return `<div class="sh-row${gone ? ' gone' : ''}" data-id="${esc(r.id)}"><div class="sh-t"><b>${esc(r.title)}</b><span>${r.count} ${plural(r.count, ['файл', 'файла', 'файлов'])} · ${fmtSize(r.bytes)} · ${life}${n ? ` · <i class="sh-dot" aria-hidden="true"></i>изменилось ${n}` : ''}</span></div>
      <div class="sh-acts">${gone ? '<button class="ibtn" data-l="forget">Убрать</button>' : '<button class="ibtn" data-l="copy">Копировать</button><button class="ibtn" data-l="edit">Открыть…</button><button class="ibtn danger" data-l="close">Закрыть</button>'}</div></div>`;
  }).join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-l]'), row = b && b.closest('[data-id]');
    if (!row) return;
    const rec = sh.listShares()[row.dataset.id];
    if (!rec) return;
    const a = b.dataset.l;
    if (a === 'copy') import('./share.js').then((m) => m.copyLink(rec));
    else if (a === 'edit') import('./share.js').then((m) => m.openShare(rec.source.folder ? rec.source : { ...rec.source, id: rec.id }));
    else if (a === 'forget') { sh.forgetShare(rec.id); drawLinks(); if (ui.renderSide) ui.renderSide(); }
    else if (a === 'close') arm(b, async () => {
      try { await sh.closeShare(rec.id); toast('Ссылка закрыта, файлы удалены из хранилища'); } catch (err) { toast(`Не удалось закрыть ссылку: ${sh.explain(err)}.`, 9000); }
      drawLinks(); if (ui.renderSide) ui.renderSide();
    }, 'Закрыта');
  };
}
