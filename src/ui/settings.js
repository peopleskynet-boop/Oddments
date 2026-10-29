// Appearance settings. Everything is a CSS variable or a body class, so the whole look
// can be changed live — and "Свой CSS" lets you override anything.
import { $, esc, isDarkColor, DEC } from '../util.js';
import { ui } from '../state.js';
import { ic } from './icons.js';
import { enhanceAll, syncSelect } from './gselect.js';
import { sfx } from './sound.js';
import { getRoot, changeLibrary } from '../lib/library.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { redrawFrame } from './frame.js';
import { MODEL_MB as AI_MB } from '../lib/ai.js';
const OCR_MB = 13; // ocr.js OCR_MB, without loading the module at start
import { LANGS, lang, setLang } from '../lib/i18n.js';

// v2: redesign defaults (dark, monochrome accent, Onest). Older saved looks are reset once.
const VERSION = 3;
export const DEFAULTS = {
  theme: 'marathon', accent: 'mono', radius: 16, gap: 14, density: 'cozy', fontSize: 13, font: 'golos',
  captions: false, hover: true, vplay: 'hover', glass: true, anim: 'smooth', wall: 'ambient', css: '',
  layout: 'masonry', zoom: 220, sideOff: false, inspOff: false, facts: true, blenderPath: '', blenderAuto: true, overlay: true,
  // clean: a first run starts in the normal view — the panels, «Добавить» and «Знакомство» in sight (newbie pass 25.10);
  // the clean screen is one key away (\). (Until 29.10 this comment sat mid-line and swallowed the three keys before it.)
  clean: false,
  aiAutoName: false, // AI through the API: files named like «IMG_2034» get Claude's English name
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
  // an on / off setting reads as a switch (it looks like one — 09-settings.css)
  return `<label class="srow"><span>${label}</span>${control.replace('<input type="checkbox"', '<input type="checkbox" role="switch"')}</label>`;
}

// The drawer in pages (it used to be one long scroll): tabs under the title, a search over every setting. The groups
// of the markup above are sorted into pages by their titles; a search shows matching rows from all pages at once.
const PAGES = [
  ['look', 'Вид', ['Язык · Language', 'Цвета', 'Форма', 'Эффекты', 'Файлы']],
  ['lib', 'Библиотека', ['Библиотека', 'Правила бренда', 'Словарь тегов']],
  ['ai', 'ИИ', ['ИИ', 'Текст на картинках', 'Ключ Anthropic', 'ИИ для иконок']],
  ['apps', 'Blender и плагины', ['Blender', 'Интеграции']],
  ['about', 'О программе', ['Обновления', 'Приватность', 'Отчёт о сбоях', 'Лицензии']],
];
const PAGE_KEY = 'perch.settingsPage';
function paginate(el) {
  const body = el.querySelector('.sp-body');
  const pages = new Map(PAGES.map(([id]) => {
    const sec = document.createElement('section');
    sec.className = 'spage'; sec.dataset.page = id; sec.setAttribute('role', 'tabpanel');
    return [id, sec];
  }));
  let cur = pages.get('look');
  for (const k of Array.from(body.children)) {
    if (k.classList.contains('sgrp')) { const t = k.textContent.trim(); const pg = PAGES.find((x) => x[2].includes(t)); cur = pages.get(pg ? pg[0] : 'look'); }
    if (k.matches('details.adv, #sReset')) { pages.get('look').appendChild(k); continue; }
    cur.appendChild(k);
  }
  const tabs = document.createElement('div');
  tabs.className = 'sp-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = PAGES.map(([id, t]) => `<button type="button" role="tab" data-page="${id}">${t}</button>`).join('');
  const find = document.createElement('input');
  find.type = 'search'; find.className = 'sp-find'; find.placeholder = 'Найти настройку: тема, звук, ключ, Blender…'; find.setAttribute('aria-label', 'Найти настройку');
  body.replaceChildren(find, tabs, ...pages.values());
  const go = (id) => {
    if (!pages.has(id)) id = 'look';
    tabs.querySelectorAll('[data-page]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === id)));
    pages.forEach((sec, k) => { sec.hidden = k !== id; });
    try { localStorage.setItem(PAGE_KEY, id); } catch (e) { /* ignore */ }
    body.scrollTop = 0;
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) { find.value = ''; filter(''); go(b.dataset.page); } });
  const filter = (q) => {
    q = q.trim().toLowerCase();
    body.classList.toggle('finding', !!q);
    const rows = body.querySelectorAll('.spage > :not(.sgrp)');
    if (!q) { rows.forEach((r) => { r.hidden = false; }); body.querySelectorAll('.sgrp').forEach((g) => { g.hidden = false; }); let last = 'look'; try { last = localStorage.getItem(PAGE_KEY) || 'look'; } catch (e) { /* ignore */ } go(last); return; }
    pages.forEach((sec) => { sec.hidden = false; });
    let any = false;
    for (const sec of pages.values()) {
      let grp = null, grpHit = false;
      const flush = () => { if (grp) grp.hidden = !grpHit; };
      for (const k of sec.children) {
        if (k.classList.contains('sgrp')) { flush(); grp = k; grpHit = false; continue; }
        const hit = (k.textContent + ' ' + (grp ? grp.textContent : '')).toLowerCase().includes(q);
        k.hidden = !hit; if (hit) { grpHit = true; any = true; }
      }
      flush();
    }
    body.classList.toggle('nothing', !any);
  };
  find.addEventListener('input', () => filter(find.value));
  let start = 'look';
  try { start = localStorage.getItem(PAGE_KEY) || 'look'; } catch (e) { /* ignore */ }
  go(start);
  return go;
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
      <label class="srow-in"><input type="checkbox" id="sAiName" ${s.aiAutoName ? 'checked' : ''}> Называть по-английски картинки с именами вроде IMG_2034, Screenshot, Снимок экрана — Claude даёт имя вместе с описанием, без доплаты; остальные — F2 › «Названия от ИИ»</label>
      <span>Ключ Voyage (voyageai.com › API keys) — поиск и сортировка по смыслу через API. Без него поиск идёт по описаниям Claude.</span>
      <div class="keyf" id="sVoKey"></div></div>
    <div class="sgrp">Текст на картинках</div>
    <div class="srow col"><span>Oddments читает текст на скриншотах, постерах и экранах приложений — картинку находит поиск по написанному на ней, текст можно скопировать. На компьютере, без интернета; модель — ${OCR_MB} МБ, скачивается один раз.</span>
      <code class="path" id="sOcrSt">…</code>
      <div class="int-acts"><button class="ibtn" id="sOcrOn">Выключить</button><button class="ibtn" id="sOcrDel" hidden>Удалить модель</button></div></div>
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
    <div class="sgrp">Язык · Language</div>
    ${row('Интерфейс · Interface', `<select id="sLang" aria-label="Язык интерфейса · Interface language">${LANGS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>`)}
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
    <div class="srow col" id="sTeams"><span>Командные библиотеки</span><small class="hint">Общая папка команды (сетевой диск, OneDrive, Яндекс Диск): у каждого своя библиотека, общие файлы — рядом. Кто может добавлять, решают права на папку.</small><div class="watch-list"></div><button class="ibtn" id="sTeamAdd">Подключить папку команды…</button></div>
    <div class="srow col" id="sWatch"><span>Забирать новые файлы из папок</span><small class="hint">Новые картинки, видео и модели из этих папок сами попадают в Oddments (копией, оригинал остаётся на месте) — например «Загрузки» или «Снимки экрана».</small><div class="watch-list"></div><button class="ibtn" id="sWatchAdd">Добавить папку…</button></div>
    <div class="sgrp">Правила бренда</div>
    <div class="srow col" id="sBrand"><span>Проверка иллюстраций, рендеров и 3D-моделей: блок «Бренд» в панели свойств и «Проверка» в просмотре модели.</span><small class="hint" id="sBrSrc"></small>
      <div class="br-row"><span>Палитра</span><div class="br-cols" data-list="colors"></div></div>
      <div class="br-row"><span>Фирменный цвет</span><input type="color" id="sBrAcc" aria-label="Фирменный цвет"><span>занимает от</span><input type="number" id="sBrMin" min="0" max="100" aria-label="Не меньше, %"><span>до</span><input type="number" id="sBrMax" min="0" max="100" aria-label="Не больше, %"><span>%</span></div>
      <div class="br-row"><span>Запрещённые</span><div class="br-cols" data-list="forbid"></div></div>
      <div class="br-row"><span>3D-модели</span><span>до</span><input type="number" id="sBrTris" min="100" step="1000" aria-label="Треугольников не больше"><span>треугольников</span><label><input type="checkbox" id="sBrUV"> с UV</label><label><input type="checkbox" id="sBrNames"> имена по смыслу</label></div>
      <div class="int-acts"><button class="ibtn" id="sBrTeam" hidden>Сделать правилами команды</button><button class="ibtn flat" id="sBrReset">Вернуть исходные</button></div></div>
    <div class="sgrp">Словарь тегов</div>
    <div class="srow col" id="sGloss"><span>Одно слово для одного: «онбординг», а не «onboarding», «Онбординг» и «онбординг» рядом. Синонимы сами становятся словом словаря, при вводе тега словарь подсказывает первым.</span><small class="hint" id="sGlSrc"></small>
      <div class="gl-list"></div>
      <form class="gl-add"><input type="text" placeholder="Слово, например «онбординг»" aria-label="Слово словаря"><input type="text" placeholder="синонимы через запятую" aria-label="Синонимы"><button class="ibtn" type="submit">Добавить</button></form>
      <div class="int-acts"><button class="ibtn" id="sGlFind">Найти похожие теги</button><button class="ibtn" id="sGlTeam" hidden>Сделать словарём команды</button></div><div class="gl-merge"></div></div>
    <div class="sgrp" id="sgUpd">Обновления</div>
    <div class="srow col" id="sUpd"><span>Oddments <b id="sVer">…</b></span><small class="hint">Новые версии приходят с GitHub подписанными: файл с чужой подписью не установится. Проверка — один запрос к github.com, без данных о вас и библиотеке.</small>
      <code class="path" id="sUpdSt">…</code>
      <div class="int-acts"><button class="ibtn" id="sUpdNow">Проверить сейчас</button><button class="ibtn pri" id="sUpdGo" hidden>Установить</button><button class="ibtn flat" id="sUpdNotes">Что нового</button></div></div>
    ${row('Проверять обновления раз в день', '<input type="checkbox" id="sUpdAuto">')}
    <div class="sgrp">Приватность</div>
    <div class="srow col" id="sPriv"><span>Библиотека, оригиналы, теги, заметки и отчёты о сбоях не покидают компьютер. В сеть Oddments ходит только за тем, что вы включили сами:</span>
      <ul class="s-list">
        <li>модели ИИ-поиска, текста на картинках, увеличения и удаления фона — один раз с Hugging Face, когда вы их включаете;</li>
        <li>освещение HDRI для 3D — с Poly Haven, при первом выборе;</li>
        <li>лента, сводка дня, статьи и каналы Telegram — с сайтов, на которые вы подписаны, когда открываете ленту;</li>
        <li>обложки и названия ссылок YouTube, Vimeo, Pinterest и Figma — когда вы добавляете ссылку;</li>
        <li>ИИ через API — Anthropic и Voyage по вашему ключу: запросы и уменьшенные копии картинок;</li>
        <li>проверка обновлений — github.com, если она включена.</li>
      </ul>
      <small class="hint">Плагины Blender и Figma, расширение браузера и Claude (MCP) говорят с Oddments только внутри компьютера (127.0.0.1).</small>
      <button class="ibtn flat" id="sPrivDoc">Подробно о приватности</button></div>
    ${row('Без сети: ничего не скачивать и не отправлять', '<input type="checkbox" id="sOffline">')}
    <small class="hint" id="sOffNote">Лента, скачивание моделей, обложки ссылок, ИИ через API и обновления останутся выключенными, пока не снимете галку. Всё, что уже на компьютере, работает.</small>
    <div class="sgrp">Отчёт о сбоях</div>
    <div class="srow col" id="sCrash"><span>Ошибки окна и сбои программы записываются в файл на этом компьютере и никуда не отправляются. Если что-то сломалось, скопируйте отчёт и пришлите его сами — на почту, в Telegram или в Issues на GitHub. Имя пользователя и путь к библиотеке в отчёт не попадают.</span>
      <code class="path" id="sCrashSt">…</code>
      <div class="int-acts"><button class="ibtn" id="sCrashCopy">Скопировать отчёт</button><button class="ibtn" id="sCrashOpen">Открыть папку</button><button class="ibtn flat" id="sCrashClear">Очистить</button></div></div>
    <div class="sgrp">Лицензии</div>
    <div class="srow col"><span>Oddments — свободная программа под лицензией MIT. Внутри — библиотеки, шрифты и модели других авторов под их лицензиями: three.js, Spark, onnxruntime, SigLIP 2, PaddleOCR, Real-ESRGAN, BEN2, AutoRemesher и другие.</span>
      <div class="int-acts"><button class="ibtn" id="sLic">Лицензии и авторы</button></div></div>
    <details class="adv"${s.css ? ' open' : ''}><summary>Для продвинутых: свой CSS</summary>
      <p>Правила CSS поверх оформления Oddments — для того, чего нет в настройках. Например, <code>--acc</code> меняет акцент, <code>.card .ph</code> — карточки.</p>
      <textarea id="sCss" rows="6" spellcheck="false" aria-label="Свой CSS" placeholder=":root { --acc: #ff5a5f; }\n.card .ph { border-radius: 0; }">${esc(s.css)}</textarea>
    </details>
    <button class="ibtn" id="sReset" style="margin-top:14px">Сбросить оформление</button>
  </div>`;
  const goPage = paginate(el);
  el.classList.add('on');
  if (section === 'int') { goPage('apps'); requestAnimationFrame(() => $('#sgInt').scrollIntoView({ block: 'start' })); }
  // straight to a field (e.g. «Подключить ИИ» in the digest → the Anthropic key)
  else if (section && document.getElementById(section)) { goPage(document.getElementById(section).closest('.spage').dataset.page); requestAnimationFrame(() => { const f = document.getElementById(section); f.scrollIntoView({ block: 'center' }); f.focus(); }); }
  $('#sLang').value = lang;
  $('#sLang').onchange = (e) => setLang(e.target.value); // the window reloads in the new language
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
  $('#sAiName').onchange = (e) => upd({ aiAutoName: e.target.checked });
  $('#sTray').onchange = (e) => upd({ tray: e.target.checked });
  // team libraries, the tag dictionary, brand rules: their code loads with the drawer (settingsteam.js), not at start
  import('./settingsteam.js').then((m) => m.bindTeamSettings());
  // «О программе»: updates, privacy and «Без сети», the crash report, licences (settingsabout.js)
  import('./settingsabout.js').then((m) => m.bindAbout());
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
        : `Модель, которая понимает картинки (SigLIP 2, около ${AI_MB} МБ), скачивается один раз, потом работает без интернета и бесплатно.`;
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
      if (r.ms) lines.push(`Тестовый запрос «предмет на фоне»: ${r.ms} мс · ближе всего «${r.bestName}» (${String(r.best).replace('.', DEC)}; у этой модели подходящие картинки обычно 0,05–0,18 — важно не само число, а насколько картинка выделяется среди остальных)`);
      else if (r.status === 'ready' && r.engine === 'api') lines.push('Поиск идёт по описаниям Claude (ключа Voyage нет)');
      if (r.error) lines.push('Последняя ошибка: ' + r.error);
      rep.textContent = lines.join('\n');
    };
    $('#sAiDel').onclick = async () => { await ai.deleteModel(); $('#sAiDel').hidden = true; ui.toast('Модель ИИ удалена с диска'); show(); };
  });
  // text on pictures (ocr.js): on/off, how much is read, the model on disk
  import('../lib/ocr.js').then((o) => {
    const st = $('#sOcrSt');
    if (!st) return;
    const show = () => {
      if (!document.body.contains(st)) { off(); return; }
      const O = o.OCR, on = o.ocrOn();
      st.textContent = !on ? 'Выключено'
        : O.status === 'download' ? 'Скачиваю модель…'
        : O.status === 'loading' ? 'Запускаю…'
        : O.status === 'error' ? 'Ошибка: ' + O.error
        : `Включено${O.device ? ' · ' + (O.device === 'webgpu' ? 'видеокарта' : 'процессор') : ''} · текст найден на ${o.ocrRead()} картинках${O.todo ? ` · осталось прочитать ${O.todo}` : ''}`;
      $('#sOcrOn').textContent = on ? 'Выключить' : 'Включить';
    };
    const off = o.onOcr(show);
    show();
    $('#sOcrOn').onclick = () => { o.setOcrOn(!o.ocrOn()); show(); };
    $('#sOcrDel').hidden = !window.__TAURI_INTERNALS__;
    $('#sOcrDel').onclick = async () => { await o.deleteOcrModel(); ui.toast('Модель распознавания текста удалена с диска'); show(); };
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
