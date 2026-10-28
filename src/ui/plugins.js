// «Плагины»: one place for every integration — Blender, Figma, Chrome/Edge, Safari, Claude (MCP). Each card says what
// it does, whether it is talking to Oddments right now (the receiver remembers who called and when:
// integration_seen in bridge.rs), installs it in one click and folds out the steps. The files of the add-on, the Figma
// plugin and the browser extension live inside the app and are written only when someone saves them.
import './plugins.css';
import { pushLayer, popLayer } from './layers.js';
import { esc, isMac } from '../util.js';
import { ic } from './icons.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const addonPy = () => import('../../integrations/blender/perch_blender.py?raw').then((m) => m.default);
const FIGMA = import.meta.glob('../../integrations/figma/*.{json,js,html}', { query: '?raw', import: 'default' });
const figmaFiles = () => Promise.all(['manifest.json', 'code.js', 'ui.html'].map((f) => FIGMA['../../integrations/figma/' + f]().then((t) => [f, t])));
const extText = import.meta.glob('../../integrations/browser/*.{json,js,html}', { query: '?raw', import: 'default' });
const extIcons = import.meta.glob('../../integrations/browser/*.png', { query: '?inline', import: 'default' });
const extLocales = import.meta.glob('../../integrations/browser/_locales/*/messages.json', { query: '?raw', import: 'default' });

const errText = (e) => (e && e.message ? e.message : String(e));
async function dialogs() { return import('@tauri-apps/plugin-dialog'); }
async function fsMod() { return import('@tauri-apps/plugin-fs'); }

export async function saveAddon() {
  try {
    const f = await (await dialogs()).save({ title: 'Сохранить аддон Oddments для Blender', defaultPath: 'perch_blender.py', filters: [{ name: 'Аддон Blender', extensions: ['py'] }] });
    if (!f) return false;
    await (await fsMod()).writeTextFile(f, await addonPy());
    toast('Аддон сохранён — установите его в Blender');
    return true;
  } catch (e) { toast('Не удалось сохранить: ' + errText(e)); return false; }
}
async function saveFolder(title, folder, write) {
  try {
    const dir = await (await dialogs()).open({ directory: true, recursive: true, title });
    if (!dir) return false;
    const { join } = await import('@tauri-apps/api/path');
    const base = await join(Array.isArray(dir) ? dir[0] : dir, folder);
    await (await fsMod()).mkdir(base, { recursive: true });
    await write(base, join);
    return true;
  } catch (e) { toast('Не удалось сохранить: ' + errText(e)); return false; }
}
export const saveFigma = () => saveFolder('Куда положить плагин Oddments для Figma', 'Oddments for Figma', async (base, join) => {
  const fs = await fsMod();
  for (const [name, text] of await figmaFiles()) await fs.writeTextFile(await join(base, name), text);
  toast('Плагин сохранён в папку «Oddments for Figma»');
});
export const saveExtension = () => saveFolder('Куда положить расширение Oddments для Chrome и Edge', 'Oddments for Browser', async (base, join) => {
  const fs = await fsMod();
  const name = (p) => p.split('/').pop();
  for (const [p, load] of Object.entries(extText)) await fs.writeTextFile(await join(base, name(p)), await load());
  for (const [p, load] of Object.entries(extIcons)) {
    const bytes = Uint8Array.from(atob((await load()).split(',')[1]), (c) => c.charCodeAt(0)); // a data: URL
    await fs.writeFile(await join(base, name(p)), bytes);
  }
  // the store name and the key descriptions in both languages: _locales/<lang>/messages.json
  for (const [p, load] of Object.entries(extLocales)) {
    const dir = await join(base, '_locales', p.split('/').slice(-2, -1)[0]);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeTextFile(await join(dir, 'messages.json'), await load());
  }
  toast('Расширение сохранено в папку «Oddments for Browser»');
});
// Safari: the container app built in CI lies inside Oddments.app (Resources/safari); opening it registers the extension
async function installSafari() {
  try {
    const { resolveResource } = await import('@tauri-apps/api/path');
    const p = await resolveResource('safari/Oddments for Safari.app');
    const fs = await fsMod();
    if (!(await fs.exists(p).catch(() => false))) { toast('В этой сборке нет расширения для Safari — возьмите «oddments-safari» из сборки для Mac'); return; }
    await (await import('@tauri-apps/plugin-opener')).openPath(p);
    toast('Откроется «Oddments for Safari» — дальше включите расширение в Safari › Настройки › Расширения', 7000);
  } catch (e) { toast('Не удалось открыть: ' + errText(e)); }
}

async function info() {
  if (!inApp()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const [port, token, running] = await invoke('integration_info');
  const exe = await invoke('app_exe').catch(() => '');
  return { port, token, running, exe };
}
async function seen() {
  if (!inApp()) return {};
  try { return await (await import('@tauri-apps/api/core')).invoke('integration_seen'); } catch (e) { return {}; }
}
async function copy(textValue, done) {
  try { await navigator.clipboard.writeText(textValue); toast(done); } catch (e) { toast(textValue, 12000); }
}
const claudeDesktop = (i) => JSON.stringify({ mcpServers: { oddments: { command: i ? i.exe : 'C:\\Program Files\\Oddments\\Oddments.exe', args: ['--mcp'] } } }, null, 2);
const claudeCode = (i) => `claude mcp add --transport http oddments http://127.0.0.1:${i ? i.port : 47215}/mcp --header "Authorization: Bearer ${i ? i.token : '<токен>'}"`;

const CARDS = [
  {
    id: 'blender', seen: 'blender', title: 'Blender', icon: 'cube', ver: 'Аддон 1.12',
    what: 'Модели и материалы из Oddments — в сцену, выделенное — обратно; браузер Oddments поверх 3D-вида и своя библиотека материалов.',
    acts: [{ a: 'addon', label: 'Сохранить аддон…', pri: true }],
    steps: ['Сохраните аддон (файл perch_blender.py — имя прежнее, чтобы токен и настройки остались).', 'Blender › Edit › Preferences › Add-ons › Install from Disk — выберите файл.', 'В панели N › Oddments нажмите «Вставить токен…» — токен копируется кнопкой вверху этого окна.', 'Включите «Принимать из Oddments», чтобы кнопка «В Blender» работала одним нажатием.'],
  },
  {
    id: 'figma', seen: 'figma', title: 'Figma', icon: 'figma', ver: 'Плагин 2.1',
    what: 'Библиотека Oddments внутри Figma: поиск, картинка на холст, мудборд из подборки, палитра — в стили, иконки — в компоненты.',
    acts: [{ a: 'figma', label: 'Сохранить плагин…', pri: true }],
    steps: ['Сохраните плагин в папку.', 'Figma › Plugins › Development › Import plugin from manifest — выберите manifest.json в этой папке.', 'Откройте плагин и вставьте токен.'],
  },
  {
    id: 'browser', seen: 'browser', title: 'Chrome и Edge', icon: 'external', ver: 'Расширение 1.4',
    what: 'Картинки, видео, ссылки и снимки экрана — в Oddments: правый клик, Alt+клик, все картинки страницы, блоки интерфейса со снимком и кодом, статьи — читать здесь.',
    acts: [{ a: 'ext', label: 'Сохранить расширение…', pri: true }],
    steps: ['Сохраните расширение в папку.', 'Откройте chrome://extensions (или edge://extensions) и включите «Режим разработчика».', '«Загрузить распакованное» — папка «Oddments for Browser».', 'В окне расширения вставьте токен.'],
  },
  {
    id: 'safari', seen: 'browser', title: 'Safari', icon: 'link', ver: 'Расширение 1.4 · Mac',
    what: 'То же расширение для Safari на Mac: правый клик, Alt+клик, все картинки страницы.',
    acts: [{ a: 'safari', label: isMac ? 'Установить в Safari' : 'Только на Mac', pri: true, off: !isMac }],
    steps: ['Нажмите «Установить в Safari» — откроется маленькое приложение «Oddments for Safari».', 'Safari › Настройки › Дополнения: включите «Показывать меню разработки», затем в меню «Разработка» — «Разрешить неподписанные расширения» (Safari спрашивает это после каждого перезапуска).', 'Safari › Настройки › Расширения — включите Oddments и разрешите его на всех сайтах.', 'В окне расширения вставьте токен.'],
  },
  {
    id: 'claude', seen: 'mcp', title: 'Claude (MCP)', icon: 'sparkle', ver: 'MCP-сервер',
    what: 'Claude ищет в вашей библиотеке («найди референсы со стеклом и фиолетовым светом»), смотрит картинки, сохраняет новые в нужную подборку.',
    acts: [{ a: 'mcp-desktop', label: 'Для Claude Desktop', pri: true }, { a: 'mcp-code', label: 'Для Claude Code' }],
    steps: ['Claude Desktop: «Для Claude Desktop» копирует настройку. Claude › Settings › Developer › Edit Config — вставьте её в claude_desktop_config.json (или добавьте «oddments» в уже существующий mcpServers) и перезапустите Claude.', 'Claude Code: «Для Claude Code» копирует команду — выполните её в терминале.', 'Oddments должен быть открыт (можно свёрнутым в трей); Claude Desktop откроет его сам, если он закрыт.'],
  },
];

let el = null, timer = 0, last = null;
export const isPluginsOpen = () => !!(el && !el.hidden);

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 15) return 'на связи';
  if (s < 3600) return `был на связи ${Math.max(1, Math.round(s / 60))} мин назад`;
  if (s < 86400) return `был на связи ${Math.round(s / 3600)} ч назад`;
  return 'давно не подключался';
}

function draw(i, seenMap) {
  const head = !i ? 'Работает в приложении для компьютера' : i.running ? `Приёмник работает · 127.0.0.1:${i.port}` : 'Приёмник не запустился: порты 47215–47219 заняты';
  el.querySelector('.plg-st').textContent = head;
  el.querySelector('.plg-st').classList.toggle('ok', !!(i && i.running));
  el.querySelector('[data-pl="token"]').disabled = !i;
  el.querySelector('.plg-grid').innerHTML = CARDS.map((c) => {
    const t = seenMap[c.seen];
    const live = t && Date.now() - t < 15000;
    const status = t ? ago(t) : 'ещё не подключался';
    return `<article class="plg-c glass" data-id="${c.id}">
      <div class="plg-h"><span class="plg-i">${ic(c.icon)}</span><div><h3>${esc(c.title)}</h3><span class="plg-v">${esc(c.ver)}</span>
        <span class="plg-s${live ? ' on' : t ? ' was' : ''}"><i></i>${esc(status)}</span></div></div>
      <p class="plg-w">${esc(c.what)}</p>
      <div class="plg-a">${c.acts.map((a) => `<button type="button" class="ibtn${a.pri ? ' pri' : ''}" data-pl="${a.a}"${a.off || (!i && a.a !== 'mcp-desktop' && a.a !== 'mcp-code') ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}
        <button type="button" class="ibtn ghost" data-pl="steps" aria-expanded="false">Как установить</button></div>
      <ol class="plg-steps" hidden>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </article>`;
  }).join('');
}

function build() {
  el = document.createElement('section');
  el.className = 'plg';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Плагины');
  el.innerHTML = `<div class="plg-sheet"><header class="plg-top"><h2>Плагины <span class="plg-n">(${CARDS.length})</span></h2><span class="plg-st cap-sm"></span>
      <button type="button" class="ibtn" data-pl="token">Скопировать токен</button>
      <button type="button" class="ib" data-pl="close" aria-label="Закрыть" title="Закрыть (Esc)">${ic('x')}</button></header>
    <p class="plg-lead">Связь с другими программами — только на этом компьютере. Каждому плагину нужен токен: он один на все и копируется кнопкой вверху.</p>
    <div class="plg-grid"></div></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', async (e) => {
    if (e.target === el) { closePlugins(); return; }
    const b = e.target.closest('[data-pl]');
    if (!b || b.disabled) return;
    const a = b.dataset.pl;
    if (a === 'close') closePlugins();
    else if (a === 'token') { if (last) copy(last.token, 'Токен скопирован'); }
    else if (a === 'steps') { const ol = b.closest('.plg-c').querySelector('.plg-steps'); ol.hidden = !ol.hidden; b.setAttribute('aria-expanded', String(!ol.hidden)); }
    else if (a === 'addon') saveAddon();
    else if (a === 'figma') saveFigma();
    else if (a === 'ext') saveExtension();
    else if (a === 'safari') installSafari();
    else if (a === 'mcp-desktop') copy(claudeDesktop(last), 'Настройка для Claude Desktop скопирована — вставьте её в claude_desktop_config.json');
    else if (a === 'mcp-code') copy(claudeCode(last), 'Команда для Claude Code скопирована — выполните её в терминале');
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePlugins(); } else e.stopPropagation(); });
}

export async function openPlugins() {
  if (!el) build();
  el.hidden = false;
  document.body.classList.add('plg-on');
  pushLayer({ el, title: 'Плагины', close: closePlugins });
  sfx('open');
  last = await info().catch(() => null);
  const refresh = async () => {
    if (!isPluginsOpen()) return;
    const open = [...el.querySelectorAll('.plg-steps')].map((o) => !o.hidden);
    draw(last, await seen());
    el.querySelectorAll('.plg-steps').forEach((o, k) => { o.hidden = !open[k]; o.closest('.plg-c').querySelector('[data-pl="steps"]').setAttribute('aria-expanded', String(!o.hidden)); });
  };
  draw(last, await seen());
  clearInterval(timer);
  timer = setInterval(refresh, 4000);
  el.querySelector('[data-pl="close"]').focus({ preventScroll: true });
}

export function closePlugins() {
  if (!el || el.hidden) return;
  clearInterval(timer);
  el.hidden = true;
  document.body.classList.remove('plg-on');
  popLayer(el);
  sfx('close');
}
