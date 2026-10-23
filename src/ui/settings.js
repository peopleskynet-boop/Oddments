// Appearance settings. Everything is a CSS variable or a body class, so the whole look
// can be changed live — and "Свой CSS" lets you override anything.
import { $, esc, isDarkColor } from '../util.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { enhanceAll, syncSelect } from './gselect.js';
import { sfx } from './sound.js';
import { getRoot, changeLibrary } from '../lib/library.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { redrawFrame } from './frame.js';
import { MODEL_MB as AI_MB } from '../lib/ai.js';

// v2: redesign defaults (dark, monochrome accent, Onest). Older saved looks are reset once.
const VERSION = 3;
export const DEFAULTS = {
  theme: 'marathon', accent: 'mono', radius: 16, gap: 14, density: 'cozy', fontSize: 13, font: 'golos',
  captions: false, hover: true, vplay: 'hover', glass: true, anim: 'smooth', wall: 'ambient', css: '',
  layout: 'masonry', zoom: 220, sideOff: false, inspOff: false, clean: true, facts: true, blenderPath: '', blenderAuto: true, overlay: true,
  sound: 40, // interface sounds, 0–100; 0 = off
  tray: true, // the window's close button hides Oddments to the tray (the receiver keeps working)
  rough: 45, // how frosted the glass panels are, 0–100 (the blur under them)
  rim: 'prism', // the rim light of the glass in «Марафон»: 'prism' | 'accent' | 'mist' | '#hex'
};
const LOOK = ['theme', 'accent', 'rough', 'rim', 'radius', 'gap', 'font', 'fontSize', 'captions', 'glass', 'wall', 'zoom', 'layout', 'sideOff', 'inspOff'];
export const settings = { ...DEFAULTS };

const FONTS = {
  golos: "'Golos Text Variable','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif",
  geist: "'Geist Variable','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif",
  onest: "'Onest Variable','Segoe UI Variable Text','Segoe UI',system-ui,sans-serif",
  segoe: "'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif",
  bahn: "Bahnschrift,'Segoe UI',sans-serif",
  consolas: "Consolas,'Cascadia Mono',ui-monospace,monospace",
  georgia: "Georgia,'Times New Roman',serif",
  system: 'system-ui,sans-serif',
};
const PAD = { compact: 3, cozy: 5, roomy: 8 };
// 'mono' follows the text colour: white on dark, black on light (like Cosmos).
const ACCENTS = ['mono', '#c8f169', '#ff6b3d', '#ffd23f', '#3ddc97', '#5b8cff', '#ff5fa2', '#7fd4ff'];

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('perch.settings') || '{}');
    if (raw.v !== VERSION) LOOK.forEach((k) => delete raw[k]);
    Object.assign(settings, DEFAULTS, raw);
    // «Марафон» is Oddments' face (the user, 21.10.2026): once, whoever had another theme gets it; choosing another
    // theme afterwards sticks
    if (!raw.marathonOnce) { settings.theme = 'marathon'; settings.marathonOnce = true; persist(); }
  } catch (e) { Object.assign(settings, DEFAULTS); }
}
const persist = () => { try { localStorage.setItem('perch.settings', JSON.stringify({ ...settings, v: VERSION })); } catch (e) { /* ignore */ } };

// «Закрывать в трей» lives in Rust (tray.rs): the close request is decided there
function syncTray(on) {
  if (!window.__TAURI_INTERNALS__) return;
  import('@tauri-apps/api/core').then(({ invoke }) => invoke('set_close_to_tray', { on: !!on })).catch(() => {});
}

export function applySettings() {
  const r = document.documentElement, s = settings;
  syncTray(s.tray);
  if (s.theme === 'system') delete r.dataset.theme; else r.dataset.theme = s.theme;
  if (s.accent === 'mono') {
    r.dataset.accent = 'mono';
    r.style.removeProperty('--acc'); r.style.removeProperty('--acc-fg');
  } else {
    delete r.dataset.accent;
    r.style.setProperty('--acc', s.accent);
    r.style.setProperty('--acc-fg', isDarkColor(s.accent) ? '#ffffff' : '#0b0d0f');
  }
  r.style.setProperty('--r', s.radius + 'px');
  r.style.setProperty('--cg', s.gap + 'px'); // the gap between cards: the «Марафон» brackets stay inside its half
  r.style.setProperty('--fs', s.fontSize + 'px');
  r.style.setProperty('--font-ui', FONTS[s.font] || FONTS.golos);
  r.style.setProperty('--navpad', PAD[s.density] + 'px');
  document.body.classList.toggle('glass-on', !!s.glass);
  r.style.setProperty('--gblur', Math.round(4 + (s.rough ?? 45) * 0.5) + 'px');
  // the rim light: three stops of one gradient (the bloom takes the first and the last)
  const RIMS = { prism: ['#D6B4FF', '#A7C7FF', '#FFC7E8'], accent: ['var(--acc)', 'color-mix(in srgb, var(--acc) 55%, #fff)', 'var(--acc)'], mist: ['#ffffff', '#dfe6ff', '#ffffff'] };
  const rim = RIMS[s.rim] || [s.rim, `color-mix(in srgb, ${s.rim} 55%, #fff)`, s.rim];
  ['a', 'b', 'c'].forEach((k, i) => r.style.setProperty('--rim-' + k, rim[i]));
  redrawFrame();
  document.body.classList.toggle('aurora', s.wall === 'aurora');
  document.body.classList.toggle('ambient', s.wall === 'ambient');
  document.body.classList.toggle('side-off', !!s.sideOff);
  document.body.classList.toggle('clean', !!s.clean);
  document.body.classList.toggle('insp-off', !!s.inspOff);
  document.body.classList.toggle('overlay', !!s.overlay);
  const reducedSys = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = s.anim === 'smooth' || (s.anim === 'system' && !reducedSys); // as motion.js animOn
  document.body.classList.toggle('no-anim', !anim);
  document.body.classList.toggle('motion', anim);
  let st = document.getElementById('user-css');
  if (!st) { st = document.createElement('style'); st.id = 'user-css'; document.head.appendChild(st); }
  st.textContent = s.css || '';
  $('#lyM').classList.toggle('on', s.layout === 'masonry');
  $('#lyG').classList.toggle('on', s.layout === 'grid');
  $('#lyM').setAttribute('aria-pressed', s.layout === 'masonry');
  $('#lyG').setAttribute('aria-pressed', s.layout === 'grid');
  $('#zoom').value = s.zoom;
}

function row(label, control) {
  return `<label class="srow"><span>${label}</span>${control}</label>`;
}

export const isSettingsOpen = () => $('#settings').classList.contains('on');
export function closeSettings() { $('#settings').classList.remove('on'); }
// the gear opens and closes the drawer
export function toggleSettings() { if (isSettingsOpen()) closeSettings(); else openSettings(); }

export function openSettings(section) {
  const s = settings, el = $('#settings');
  el.innerHTML = `
  <div class="sp-head"><h2>Настройки</h2><button class="ibtn" id="spX" aria-label="Закрыть">${ic('x')}</button></div>
  <div class="sp-body">
    <!-- the product's own links come first: AI search, Blender and the add-ons, then the look -->
    <div class="sgrp">ИИ</div>
    <div class="srow col"><span>Поиск по смыслу («рука с наушниками», «персонаж с голубыми волосами»), ИИ-теги и сортировка «По смыслу».</span>
      <select id="sAiEng" aria-label="Где работает ИИ"><option value="local">На компьютере — бесплатно, без интернета</option><option value="api">Через API — Claude и Voyage, платно</option></select>
      <span class="snote" id="sAiNote"></span>
      <code class="path" id="sAiSt">…</code>
      <div class="int-acts"><button class="ibtn" id="sAiOn">Включить</button><button class="ibtn" id="sAiPause" hidden>Пауза</button><button class="ibtn" id="sAiTest" hidden>Проверить ИИ</button><button class="ibtn" id="sAiDel" hidden>Удалить модель</button></div>
      <code class="path" id="sAiRep" hidden></code></div>
    <div class="srow col" id="sAiApi"><span>Claude описывает каждую картинку и ставит теги — модель:</span>
      <select id="sAcModel" aria-label="Модель для тегов"></select>
      <span>Ключ Voyage (voyageai.com › API keys) — поиск и сортировка по смыслу через API. Без него поиск идёт по описаниям Claude.</span>
      <div class="keyf" id="sVoKey"></div></div>
    <div class="sgrp">Ключ Anthropic</div>
    <div class="srow col"><span>Для ИИ через API и для иконок по описанию (console.anthropic.com › API keys). Хранится в настройках Oddments на этом компьютере; в облако уходят только запросы и уменьшенные копии картинок, оригиналы и библиотека — нет.</span>
      <div class="keyf" id="sIaKey"></div></div>
    <div class="sgrp">ИИ для иконок</div>
    <div class="srow col"><span>Модель, которая собирает варианты иконок в конструкторе:</span>
      <select id="sIaModel" aria-label="Модель"></select></div>
    <div class="sgrp">Blender</div>
    <div class="srow col"><span>Программа Blender — открывает .blend и Alembic внутри Oddments</span><code class="path" id="sBl">ищу…</code><button class="ibtn" id="sBlPick">Указать blender.exe…</button></div>
    ${row('Готовить сцены сразу после импорта', `<input type="checkbox" id="sBlAuto" ${s.blenderAuto ? 'checked' : ''}>`)}
    <div class="sgrp" id="sgInt">Интеграции</div>
    <div class="srow col"><span>Blender, Figma, Chrome и Edge, Safari и Claude (MCP) связываются с Oddments на этом компьютере. Установка, статус и шаги — в «Плагинах».</span>
      <code class="path" id="sIntSt">проверяю…</code>
      <div class="int-acts"><button class="ibtn pri" id="sPlug">Плагины…</button><button class="ibtn" id="sTok">Скопировать токен</button></div>
    </div>
    <div class="sgrp">Цвета</div>
    ${row('Тема', `<select id="sTheme"><option value="system">Как в Windows</option><option value="light">Светлая</option><option value="dark">Тёмная</option><option value="marathon">Марафон</option><option value="calm">Тишина</option></select>`)}
    <div class="srow"><span>Акцент</span><div class="accs">${ACCENTS.map((c) => `<button data-acc="${c}" style="background:${c === 'mono' ? 'var(--fg)' : c}" class="${c === s.accent ? 'on' : ''}" aria-label="${c === 'mono' ? 'Монохром' : c}" title="${c === 'mono' ? 'Монохром' : c}"></button>`).join('')}<label class="own${ACCENTS.includes(s.accent) ? '' : ' on'}" title="Свой цвет"><input type="color" id="sAcc" value="${esc(s.accent === 'mono' ? '#ededed' : s.accent)}" aria-label="Свой цвет акцента"></label></div></div>
    <div class="sgrp">Форма</div>
    ${row('Скругление: <b id="vR">' + s.radius + '</b>', `<input type="range" id="sRadius" min="0" max="22" value="${s.radius}">`)}
    ${row('Отступы между файлами: <b id="vG">' + s.gap + '</b>', `<input type="range" id="sGap" min="2" max="32" value="${s.gap}">`)}
    ${row('Плотность списка', `<select id="sDens"><option value="compact">Компактная</option><option value="cozy">Обычная</option><option value="roomy">Свободная</option></select>`)}
    ${row('Размер текста: <b id="vF">' + s.fontSize + '</b>', `<input type="range" id="sFs" min="11" max="17" value="${s.fontSize}">`)}
    ${row('Шрифт', `<select id="sFont"><option value="golos">Golos Text</option><option value="geist">Geist</option><option value="onest">Onest</option><option value="segoe">Segoe UI</option><option value="bahn">Bahnschrift</option><option value="consolas">Consolas</option><option value="georgia">Georgia</option><option value="system">Системный</option></select>`)}
    <div class="sgrp">Эффекты</div>
    ${row('Звуки интерфейса: <b id="vS">' + (s.sound ? s.sound : 'выкл') + '</b>', `<input type="range" id="sSound" min="0" max="100" step="5" value="${s.sound}" aria-label="Громкость звуков интерфейса">`)}
    ${row('Анимации', `<select id="sAnim"><option value="smooth">Плавные</option><option value="system">Как в системе</option><option value="none">Выключены</option></select>`)}
    ${matchMedia('(prefers-reduced-motion: reduce)').matches ? '<small class="hint">Система просит меньше движения (Windows: Параметры › Специальные возможности › Эффекты анимации). «Плавные» всё равно анимируют, «Как в системе» — слушаются её.</small>' : ''}
    ${row('Фон', `<select id="sWall"><option value="ambient">Свет от картинок</option><option value="aurora">Свет акцента</option><option value="none">Без свечения</option></select>`)}
    ${row('Матовое стекло на панелях', `<input type="checkbox" id="sGlass" ${s.glass ? 'checked' : ''}>`)}
    ${row('Матовость стекла: <b id="vRough">' + s.rough + '</b>', `<input type="range" id="sRough" min="0" max="100" step="5" value="${s.rough}" aria-label="Матовость стеклянных панелей">`)}
    <div class="srow"><span>Ободок стекла <small class="hint">(тема «Марафон»)</small></span><div class="accs">${[['prism', 'Призма'], ['accent', 'Как акцент'], ['mist', 'Белый']].map(([k, t]) => `<button data-rim="${k}" style="background:${k === 'accent' ? 'var(--acc)' : '#f4f2fa'}" class="${s.rim === k ? 'on' : ''}" aria-label="${t}" title="${t}"></button>`).join('')}<label class="own${['prism', 'accent', 'mist'].includes(s.rim) ? '' : ' on'}" title="Свой цвет"><input type="color" id="sRim" value="${esc(/^#/.test(s.rim) ? s.rim : '#d6b4ff')}" aria-label="Свой цвет ободка"></label></div></div>
    ${row('Панель свойств поверх сетки', `<input type="checkbox" id="sOver" ${s.overlay ? 'checked' : ''}>`)}
    ${row('Чистый экран: только референсы (\\)', `<input type="checkbox" id="sClean" ${s.clean ? 'checked' : ''}>`)}
    ${row('Сведения о файле при наведении', `<input type="checkbox" id="sFacts" ${s.facts ? 'checked' : ''}>`)}
    <div class="sgrp">Файлы</div>
    ${row('Подписи под превью', `<input type="checkbox" id="sCap" ${s.captions ? 'checked' : ''}>`)}
    ${row('Анимация GIF и видео при наведении', `<input type="checkbox" id="sHov" ${s.hover ? 'checked' : ''}>`)}
    ${row('Видео в сетке', `<select id="sVplay"><option value="hover">При наведении</option><option value="always">Всегда</option></select>`)}
    <div class="sgrp">Библиотека</div>
    ${row('Крестик окна убирает Oddments в трей', `<input type="checkbox" id="sTray" ${s.tray ? 'checked' : ''}>`)}
    <div class="srow"><span>Знакомство с Oddments</span><button class="ibtn" id="sOnb">Показать</button></div>
    <div class="srow col"><span>Папка с файлами</span><code class="path">${esc(getRoot())}</code><button class="ibtn" id="sRoot">Выбрать другую папку…</button></div>
    <div class="srow col" id="sWatch"><span>Забирать новые файлы из папок</span><small class="hint">Новые картинки, видео и модели из этих папок сами попадают в Oddments (копией, оригинал остаётся на месте) — например «Загрузки» или «Снимки экрана».</small><div class="watch-list"></div><button class="ibtn" id="sWatchAdd">Добавить папку…</button></div>
    <details class="adv"${s.css ? ' open' : ''}><summary>Для продвинутых: свой CSS</summary>
      <p>Правила CSS поверх оформления Oddments — для того, чего нет в настройках. Например, <code>--acc</code> меняет акцент, <code>.card .ph</code> — карточки.</p>
      <textarea id="sCss" rows="6" spellcheck="false" aria-label="Свой CSS" placeholder=":root { --acc: #ff5a5f; }\n.card .ph { border-radius: 0; }">${esc(s.css)}</textarea>
    </details>
    <button class="ibtn" id="sReset" style="margin-top:14px">Сбросить оформление</button>
  </div>`;
  // in the browser build Blender and the integrations can only say «available in the desktop app»: they go to
  // the end there, so the drawer opens on settings that work
  if (!window.__TAURI_INTERNALS__) {
    const body = el.querySelector('.sp-body'), kids = Array.from(body.children);
    const from = kids.findIndex((k) => k.classList.contains('sgrp') && k.textContent.trim() === 'Blender'), to = kids.findIndex((k) => k.classList.contains('sgrp') && k.textContent.trim() === 'Цвета');
    if (from >= 0 && to > from) { const reset = $('#sReset'); kids.slice(from, to).forEach((k) => body.insertBefore(k, reset)); }
  }
  el.classList.add('on');
  if (section === 'int') requestAnimationFrame(() => $('#sgInt').scrollIntoView({ block: 'start' }));
  // straight to a field (e.g. «Подключить ИИ» in the digest → the Anthropic key)
  else if (section && document.getElementById(section)) requestAnimationFrame(() => { const f = document.getElementById(section); f.scrollIntoView({ block: 'center' }); f.focus(); });
  $('#sTheme').value = s.theme; $('#sDens').value = s.density; $('#sFont').value = s.font; $('#sAnim').value = s.anim; $('#sWall').value = s.wall; $('#sVplay').value = s.vplay;
  enhanceAll(el);

  const upd = (patch, relayout) => { Object.assign(settings, patch); persist(); applySettings(); if (relayout) ui.relayout(); };
  $('#spX').onclick = () => el.classList.remove('on');
  $('#sTheme').onchange = (e) => upd({ theme: e.target.value });
  $('#sDens').onchange = (e) => upd({ density: e.target.value });
  $('#sFont').onchange = (e) => upd({ font: e.target.value });
  $('#sAnim').onchange = (e) => upd({ anim: e.target.value });
  $('#sSound').oninput = (e) => { $('#vS').textContent = +e.target.value ? e.target.value : 'выкл'; upd({ sound: +e.target.value }); };
  $('#sSound').onchange = () => sfx('tick'); // a sample at the new volume
  $('#sWall').onchange = (e) => upd({ wall: e.target.value });
  $('#sGlass').onchange = (e) => upd({ glass: e.target.checked });
  $('#sRough').oninput = (e) => { $('#vRough').textContent = e.target.value; upd({ rough: +e.target.value }); };
  const rimOwn = $('#sRim').closest('.own');
  $('#sRim').oninput = (e) => { upd({ rim: e.target.value }); el.querySelectorAll('[data-rim]').forEach((b) => b.classList.remove('on')); rimOwn.classList.add('on'); };
  el.querySelectorAll('[data-rim]').forEach((b) => { b.onclick = () => { upd({ rim: b.dataset.rim }); el.querySelectorAll('[data-rim]').forEach((x) => x.classList.toggle('on', x === b)); rimOwn.classList.remove('on'); }; });
  $('#sOver').onchange = (e) => upd({ overlay: e.target.checked }, true);
  $('#sFacts').onchange = (e) => upd({ facts: e.target.checked });
  $('#sClean').onchange = (e) => import('./clean.js').then((m) => m.setClean(e.target.checked));
  $('#sCap').onchange = (e) => upd({ captions: e.target.checked }, true);
  $('#sHov').onchange = (e) => upd({ hover: e.target.checked });
  $('#sVplay').onchange = (e) => upd({ vplay: e.target.value }, true);
  $('#sRadius').oninput = (e) => { $('#vR').textContent = e.target.value; upd({ radius: +e.target.value }); };
  $('#sGap').oninput = (e) => { $('#vG').textContent = e.target.value; upd({ gap: +e.target.value }, true); };
  $('#sFs').oninput = (e) => { $('#vF').textContent = e.target.value; upd({ fontSize: +e.target.value }, true); };
  $('#sAcc').oninput = (e) => { upd({ accent: e.target.value }); el.querySelectorAll('[data-acc]').forEach((b) => b.classList.remove('on')); el.querySelector('.own').classList.add('on'); };
  el.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = () => { upd({ accent: b.dataset.acc }); $('#sAcc').value = b.dataset.acc; el.querySelectorAll('[data-acc]').forEach((x) => x.classList.toggle('on', x === b)); el.querySelector('.own').classList.remove('on'); }; });
  $('#sCss').oninput = (e) => upd({ css: e.target.value });
  $('#sRoot').onclick = () => changeLibrary();
  $('#sOnb').onclick = () => import('./onboard.js').then((m) => { m.showOnboard(); closeSettings(); });
  // Blender: shows the found or chosen executable; picking one overrides the automatic search
  import('../lib/blender.js').then(async (b) => {
    const show = async () => { const p = await b.blenderPath(); const el = $('#sBl'); if (el) el.textContent = p || (window.__TAURI_INTERNALS__ ? 'Не найден — укажите вручную' : 'Доступно в приложении для компьютера'); };
    await show();
    $('#sBlPick').onclick = async () => {
      const f = await openDialog({ multiple: false, title: 'Где установлен Blender', filters: [{ name: 'Blender', extensions: ['exe'] }] });
      if (!f) return;
      upd({ blenderPath: Array.isArray(f) ? f[0] : f }); b.forgetBlender(); show();
    };
  });
  $('#sBlAuto').onchange = (e) => upd({ blenderAuto: e.target.checked });
  $('#sTray').onchange = (e) => upd({ tray: e.target.checked });
  // watch folders (watch.js): the list, add, remove
  const drawWatch = () => import('../lib/watch.js').then((m) => {
    const box = $('#sWatch .watch-list');
    if (!box) return;
    box.innerHTML = m.watchedDirs().map((d) => `<div class="watch-row"><code class="path">${esc(d)}</code><button class="ibtn flat" data-unwatch="${esc(d)}">Убрать</button></div>`).join('');
  });
  drawWatch();
  $('#sWatchAdd').onclick = async () => {
    if (!window.__TAURI_INTERNALS__) { import('./dialogs.js').then((d) => d.toast('Папки-наблюдатели — в приложении Oddments')); return; }
    const m = await import('../lib/watch.js');
    const d = await m.addWatchDir();
    if (d) { drawWatch(); import('./dialogs.js').then((t) => t.toast('Смотрю за папкой: новые файлы придут сами')); }
  };
  $('#sWatch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unwatch]');
    if (b) import('../lib/watch.js').then((m) => { m.removeWatchDir(b.dataset.unwatch); drawWatch(); });
  });
  // AI for icons: the API key and the model (iconai.js)
  import('../lib/iconai.js').then((ia) => {
    const k = $('#sIaKey'), m = $('#sIaModel');
    if (!k) return;
    const p = ia.aiPrefs();
    Promise.all([import('./keyfield.js'), import('../lib/aicloud.js')]).then(([kf, ac]) => kf.mountKeyField(k, {
      service: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-…',
      get: () => ia.aiPrefs().key, set: (v) => ia.setAiPrefs({ key: v }), test: (v) => ac.testKey('anthropic', v),
    }));
    m.innerHTML = ia.MODELS.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
    m.value = p.model;
    syncSelect(m);
    m.onchange = () => ia.setAiPrefs({ model: m.value });
  });
  // AI: where it runs (on this computer / through the API), on / off, pause, delete the model; the status line follows
  // the AI state while the drawer is open
  Promise.all([import('../lib/ai.js'), import('../lib/aicloud.js')]).then(([ai, ac]) => {
    const st = $('#sAiSt');
    if (!st) return;
    const eng = $('#sAiEng'), note = $('#sAiNote'), vo = $('#sVoKey'), tm = $('#sAcModel');
    tm.innerHTML = ac.TAG_MODELS.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
    const cp = ac.cloudPrefs();
    tm.value = cp.tagModel;
    syncSelect(tm);
    import('./keyfield.js').then((kf) => kf.mountKeyField(vo, {
      service: 'voyage', name: 'Voyage', placeholder: 'pa-…',
      get: () => ac.cloudPrefs().voyageKey, set: (v) => ac.setCloudPrefs({ voyageKey: v }), test: (v) => ac.testKey('voyage', v), onChange: () => showEng(),
    }));
    const showEng = () => {
      const api = ai.aiEngine() === 'api';
      eng.value = ai.aiEngine();
      syncSelect(eng);
      $('#sAiApi').hidden = !api;
      note.textContent = api
        ? `В облако уходят уменьшенные копии картинок (512 px), не оригиналы. Оплата один раз за картинку: ≈ ${ac.usd(ac.estimate(1000, ac.hasVoyage() ? 1000 : 0))} за 1000 картинок с выбранной моделью. Перед большим проходом Oddments покажет сумму и спросит.`
        : `Модель SigLIP 2 (около ${AI_MB} МБ) скачивается один раз, потом работает без интернета и бесплатно.`;
    };
    showEng();
    eng.onchange = async () => { await ai.setEngine(eng.value); showEng(); show(); };
    tm.onchange = () => { ac.setCloudPrefs({ tagModel: tm.value }); showEng(); };
    const dev = () => (ai.AI.device === 'webgpu' ? 'видеокарта' : 'процессор');
    const show = () => {
      if (!document.body.contains(st)) { off(); return; }
      const A = ai.AI, on = ai.aiOn();
      st.textContent = A.status === 'download' ? `Скачиваю модель: ${Math.round(A.got / 1e6)} из ${Math.round(A.total / 1e6)} МБ`
        : A.status === 'loading' ? 'Запускаю…'
        : A.status === 'error' ? 'Ошибка: ' + A.error
        : A.status === 'ready' && A.confirm ? `Ждёт «Начать» в плашке ИИ: ${A.confirm.n} картинок ≈ ${ac.usd(A.confirm.usd)}`
        : A.status === 'ready' ? `Включён · ${A.device === 'api' ? 'через API' : dev()} · изучено ${A.done} из ${A.done + A.todo}${A.paused && A.todo ? ' · на паузе' : ''}`
        : 'Выключен';
      $('#sAiOn').textContent = on ? 'Выключить' : 'Включить';
      $('#sAiPause').hidden = !(on && A.status === 'ready' && A.todo);
      $('#sAiPause').textContent = A.paused ? 'Продолжить' : 'Пауза';
      $('#sAiTest').hidden = !on;
    };
    const off = ai.onAi(show);
    show();
    ai.modelOnDisk().then((has) => { $('#sAiDel').hidden = !has || ai.aiEngine() === 'api'; });
    $('#sAiOn').onclick = () => { if (ai.aiOn()) ai.turnOff(); else ai.turnOn(); show(); };
    $('#sAiPause').onclick = () => ai.setPaused(!ai.AI.paused);
    // «Проверить ИИ»: a test phrase through the model, what is studied, the last error — in plain words (bug #48)
    $('#sAiTest').onclick = async () => {
      const rep = $('#sAiRep');
      rep.hidden = false; rep.textContent = 'Проверяю…';
      const r = await ai.selfTest();
      const where = r.engine === 'api' ? 'через API' : r.device === 'webgpu' ? 'на видеокарте' : r.device ? 'на процессоре' : '';
      const lines = [
        r.status === 'ready' ? `Работает ${where}` : `Не запущен (${r.status})`,
        `Изучено: ${r.done} из ${r.total} (векторов: ${r.vectors})${r.failed ? ` · не изучилось: ${r.failed}` : ''}`,
        `ИИ-теги есть у ${r.tagged}${r.engine === 'api' ? ` · описаний: ${r.described}` : ''}`,
      ];
      if (r.ms) lines.push(`Тестовый запрос «предмет на фоне»: ${r.ms} мс · ближе всего «${r.bestName}» (${String(r.best).replace('.', ',')}; у этой модели подходящие картинки обычно 0,05–0,18 — важно не само число, а насколько картинка выделяется среди остальных)`);
      else if (r.status === 'ready' && r.engine === 'api') lines.push('Поиск идёт по описаниям Claude (ключа Voyage нет)');
      if (r.error) lines.push('Последняя ошибка: ' + r.error);
      rep.textContent = lines.join('\n');
    };
    $('#sAiDel').onclick = async () => { await ai.deleteModel(); $('#sAiDel').hidden = true; ui.toast('Модель ИИ удалена с диска'); show(); };
  });
  // integrations: status of the local receiver, the token, and saving the add-on / plugin files
  import('../lib/bridge.js').then(async (br) => {
    const info = await br.integrationInfo();
    const st = $('#sIntSt');
    if (!st) return;
    st.textContent = !info ? 'Доступно в приложении для компьютера' : info.running ? `Приёмник работает: 127.0.0.1:${info.port}` : 'Приёмник не запустился: порты 47215–47219 заняты';
    $('#sTok').disabled = !info;
    $('#sTok').onclick = async () => {
      try { await navigator.clipboard.writeText(info.token); ui.toast('Токен скопирован'); } catch (e) { ui.toast('Токен: ' + info.token, 8000); }
    };
  });
  $('#sPlug').onclick = () => import('./plugins.js').then((m) => { closeSettings(); m.openPlugins(); });
  $('#sReset').onclick = () => { Object.assign(settings, DEFAULTS); persist(); applySettings(); ui.relayout(); openSettings(); };
}

export function setLayoutPrefs(patch) { Object.assign(settings, patch); persist(); applySettings(); }
