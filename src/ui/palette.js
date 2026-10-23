// Command palette (Ctrl+Space), after Arc's command palette (uiarc.dev, MIT, © 2026 Elia Kuratli): one field
// that reaches every action, place, collection, tag and file. Results are grouped; one highlight glides to the
// active row on the morph spring (the pointer and the arrows move the same highlight); the frame follows the
// height of the list; Enter runs, Esc closes. Actions reuse the app's own buttons and functions, so the
// palette never behaves differently from the place the action lives in.
import { S, KINDS } from '../state.js';
import { $, esc, isMac } from '../util.js';
import { ic, KIND_ICONS } from './icons.js';
import { setView } from '../lib/filter.js';
import { assetUrl } from '../lib/library.js';
import { flatFolders } from './sidebar.js';
import { toggleSettings, setLayoutPrefs, settings, closeSettings } from './settings.js';
import { cleanOn, setClean } from './clean.js';
import { motionOn } from './motion.js';
import { SPRINGS } from './spring.js';
import { openDupes, closeOverlays, openTidy, openFeed, openNews } from './lazy.js';
import { sfx } from './sound.js';

let root = null, input, list, frame, hl, rows = [], active = 0, back = null;

const THEMES = [['dark', 'Тёмная'], ['light', 'Светлая'], ['marathon', 'Марафон'], ['calm', 'Тишина'], ['system', 'Как в Windows']];
const click = (sel) => () => { const b = $(sel); if (b) b.click(); };
const go = (type, id) => () => { closeOverlays(); setView(type, id); };

function actions() {
  const a = [
    { icon: 'plus', label: 'Добавить файлы…', keys: 'импорт открыть загрузить', run: click('#addBtn') },
    { icon: 'paste', label: 'Вставить из буфера', hint: 'Ctrl+V', keys: 'скриншот картинка', run: click('#pasteBtn') },
    { icon: 'folderplus', label: 'Добавить папку…', keys: 'импорт каталог', run: click('#addDirBtn') },
    { icon: 'cube', label: 'SVG в 3D…', keys: 'иконка модель конвертер blender', run: click('#svg3dBtn') },
    { icon: 'external', label: 'Плагины: Blender, Figma, браузеры, Claude…', keys: 'plugins плагины интеграции аддон расширение safari chrome figma blender mcp claude токен', run: () => import('./plugins.js').then((m) => m.openPlugins()) },
    { icon: 'flow', label: 'Сценарий из записи экрана…', keys: 'flow сценарий экраны запись видео нарезать скриншоты ux', run: click('#flowBtn') },
    { icon: 'grid', label: 'Конструктор иконок…', keys: 'иконка icon мтс сетка контур заливка', run: click('#ikBtn') },
    { icon: 'sphere', label: 'Материал из текстур…', keys: 'pbr poly haven ambientcg', run: click('#matBtn') },
    { icon: 'palette', label: 'Поиск по цвету', keys: 'цвет палитра', run: click('#filtBtn') },
    { icon: 'scan', label: 'Найти дубликаты', keys: 'повторы копии', run: () => openDupes() },
    { icon: 'trash', label: 'Очистить корзину', keys: 'удалить навсегда корзина стереть', run: () => import('./hero.js').then((m) => m.askEmptyTrash()) },
    { icon: 'folder', label: 'Разобрать: файлы без подборки', keys: 'разобрать подсказки подборка сортировать', run: () => openTidy() },
    { icon: 'play', label: 'Лента новостей', keys: 'новости дизайн рилс feed behance dezeen 3d моушн', run: () => openFeed() },
    { icon: 'sparkle', label: 'Сводка дня', keys: 'новости ии ai дизайн дайджест digest', run: () => openNews('digest') },
    { icon: 'bookmark', label: 'Сохранённые статьи', keys: 'новости читать статьи reader закладки', run: () => openNews('saved') },
    { icon: 'masonry', label: 'Мозаика', keys: 'вид раскладка', run: click('#lyM') },
    { icon: 'grid', label: 'Сетка', keys: 'вид раскладка', run: click('#lyG') },
    { icon: 'sideL', label: cleanOn() ? 'Выключить чистый экран' : 'Чистый экран', hint: '\\', keys: 'интерфейс скрыть панели', run: () => setClean(!cleanOn()) },
    { icon: 'gear', label: 'Настройки', keys: 'параметры', run: toggleSettings },
    { icon: 'info', label: 'Горячие клавиши', hint: '?', keys: 'клавиатура сочетания', run: () => import('./keys.js').then((m) => m.toggleKeys(true)) },
  ];
  // the current theme stays in the list, marked, so you can see what you are on
  THEMES.forEach(([v, n]) => a.push({ icon: v === 'light' || v === 'calm' ? 'sun' : 'moon', label: 'Тема: ' + n, sub: settings.theme === v ? 'сейчас' : '', keys: 'оформление цвет', run: () => setLayoutPrefs({ theme: v }) }));
  return a;
}

// what can be done with the selected file(s), first in the list while something is selected
function forSelection() {
  const ids = Array.from(S.sel), it = ids.length === 1 ? S.byId.get(ids[0]) : null;
  if (!ids.length) return [];
  const a = [];
  if (it) {
    a.push({ icon: 'zoom', label: 'Просмотр: ' + it.name, hint: 'Пробел', keys: 'открыть смотреть', run: () => openFile(it.id) });
    if (it.kind === 'model') a.push({ icon: 'cube', label: 'В Blender', keys: 'blender отправить сцена аддон', run: () => { const b = document.querySelector('.insp [data-act="toblender"], .insp [data-act="open"]'); if (b) b.click(); } });
    if (it.ext === 'svg') a.push({ icon: 'cube', label: 'Сделать 3D из SVG…', keys: 'модель blender', run: () => import('./svg3d.js').then((m) => m.openFromItem(it)) });
    a.push({ icon: 'edit', label: 'Переименовать', hint: 'F2', keys: 'имя', run: () => import('./rename.js').then((m) => m.openRename([it])) });
  }
  a.push({ icon: 'trash', label: ids.length > 1 ? `В корзину: ${ids.length}` : 'В корзину', hint: 'Delete', keys: 'удалить', run: () => { const b = document.querySelector('.insp [data-act="trash"]'); if (b) b.click(); } });
  return a;
}

// the last few commands run from here come first next time (per viewer, a convenience only)
const RECENT = 'perch.cmdk.recent';
const recentLabels = () => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]'); } catch (e) { return []; } };
function remember(label) {
  try { localStorage.setItem(RECENT, JSON.stringify([label, ...recentLabels().filter((x) => x !== label)].slice(0, 4))); } catch (e) { /* private mode */ }
}

function places() {
  const live = S.items.filter((i) => !i.trashed);
  const p = [
    { icon: 'all', label: 'Все файлы', meta: live.length, run: go('all') },
    { icon: 'clock', label: 'Недавние', run: go('recent') },
    { icon: 'heart', label: 'Избранное', run: go('fav') },
    { icon: 'trash', label: 'Корзина', run: go('trash') },
  ];
  const kinds = new Map();
  live.forEach((i) => kinds.set(i.kind, (kinds.get(i.kind) || 0) + 1));
  kinds.forEach((n, k) => { if (KINDS[k]) p.push({ icon: KIND_ICONS[k] || 'file', label: KINDS[k].label, meta: n, keys: 'тип', run: go('kind', k) }); });
  flatFolders().forEach(({ f }) => p.push({ icon: 'folder', label: f.name, keys: 'подборка', sub: 'подборка', run: go('folder', f.id) }));
  const tags = new Map();
  live.forEach((i) => (i.tags || []).forEach((t) => tags.set(t, (tags.get(t) || 0) + 1)));
  tags.forEach((n, t) => p.push({ icon: 'tag', label: '#' + t, meta: n, keys: 'тег', run: go('tag', t) }));
  return p;
}

function files(q) {
  if (!q) return [];
  const out = [];
  for (const it of S.items) {
    if (it.trashed) continue;
    const s = score(it.name + ' ' + (it.tags || []).join(' '), q);
    if (s) out.push([s, it]);
  }
  return out.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([, it]) => ({
    thumb: it.thumb ? assetUrl(it.thumb) : null, icon: KIND_ICONS[it.kind] || 'file', label: it.name, sub: KINDS[it.kind] ? KINDS[it.kind].label : '',
    run: () => openFile(it.id),
  }));
}

function openFile(id) {
  const show = () => import('./preview.js').then((m) => m.openPreview(id));
  if (!S.vis.some((i) => i.id === id)) { setView('all'); setTimeout(show, 60); } else show();
}

// every word of the query has to be found; a match at the start of the text or of a word ranks higher
function score(text, q) {
  const t = text.toLowerCase();
  let s = 0;
  for (const w of q.split(/\s+/)) {
    if (!w) continue;
    const i = t.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : /[\s#«"(_.-]/.test(t[i - 1]) ? 2 : 1;
  }
  return s;
}

function build() {
  const q = input.value.trim().toLowerCase();
  const pick = (arr) => (q ? arr.map((x) => [score(x.label + ' ' + (x.keys || '') + ' ' + (x.sub || ''), q), x]).filter((p) => p[0]).sort((a, b) => b[0] - a[0]).map((p) => p[1]) : arr);
  const acts = actions();
  const recent = q ? [] : recentLabels().map((l) => acts.find((x) => x.label === l)).filter(Boolean);
  const groups = [
    ['Выделенное', pick(forSelection())],
    ['Недавние', recent],
    ['Действия', pick(acts.filter((x) => !recent.includes(x))).slice(0, q ? 6 : 8)],
    ['Перейти', pick(places()).slice(0, q ? 8 : 6)],
    ['Файлы', files(q)],
  ].filter(([, a]) => a.length);
  rows = [];
  let h = '';
  groups.forEach(([name, arr]) => {
    h += `<div class="cmdk-g" role="group" aria-label="${name}"><div class="cmdk-gh" aria-hidden="true">${name}</div>`;
    arr.forEach((x) => {
      const i = rows.push(x) - 1;
      const lead = x.thumb ? `<img src="${x.thumb}" alt="" decoding="async">` : ic(x.icon);
      h += `<div class="cmdk-r" role="option" id="cmdk-${i}" data-i="${i}" aria-selected="false"><span class="cmdk-ic">${lead}</span><span class="cmdk-t"><strong>${esc(x.label)}</strong>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${x.meta != null ? `<span class="cmdk-m">${x.meta}</span>` : ''}${x.hint ? `<kbd>${esc(x.hint)}</kbd>` : ''}</div>`;
    });
    h += '</div>';
  });
  if (!rows.length) h = `<div class="cmdk-empty"><span>${ic('search')}</span><strong>Ничего не нашлось</strong><small>Попробуйте другое слово или #тег</small></div>`;
  list.innerHTML = h;
  list.prepend(hl);
  hl.style.opacity = '0'; hl.dataset.on = '';
  // the frame follows the list height on the smooth spring
  const target = Math.min(list.scrollHeight, 380);
  frame.style.height = target + 'px';
  setActive(0, true);
}

function setActive(i, jump) {
  if (!rows.length) return;
  active = (i + rows.length) % rows.length;
  const el = list.querySelector(`[data-i="${active}"]`);
  list.querySelectorAll('.cmdk-r[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
  el.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', el.id);
  const appear = jump || hl.dataset.on !== '1' || !motionOn();
  if (appear) hl.style.transition = 'none';
  hl.style.translate = `0 ${el.offsetTop}px`;
  hl.style.height = el.offsetHeight + 'px';
  hl.style.opacity = '1';
  if (appear) { void hl.offsetWidth; hl.style.transition = ''; }
  hl.dataset.on = '1';
  const top = el.offsetTop, bot = top + el.offsetHeight;
  if (top < list.scrollTop + 4) list.scrollTop = top - 34;
  else if (bot > list.scrollTop + list.clientHeight - 4) list.scrollTop = bot - list.clientHeight + 6;
}

function run(i) {
  const x = rows[i];
  if (!x) return;
  closePalette(false);
  sfx('click');
  if (!x.thumb && x.run && !x.label.startsWith('Просмотр: ')) remember(x.label);
  setTimeout(() => x.run(), 0);
}

function make() {
  root = document.createElement('div');
  root.className = 'cmdk';
  root.innerHTML = `<div class="cmdk-p glass" role="dialog" aria-modal="true" aria-label="Команды и поиск">
    <label class="cmdk-in">${ic('search')}<input type="text" role="combobox" aria-label="Команда или поиск" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" placeholder="Команда, раздел, подборка, #тег или файл" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
    <div class="cmdk-f"><div class="cmdk-l" id="cmdkList" role="listbox" aria-label="Результаты"></div></div>
    <div class="cmdk-ft" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> выбрать</span><span><kbd>Enter</kbd> выполнить</span><span><kbd>Ctrl</kbd><kbd>Пробел</kbd> открыть отовсюду</span></div>
  </div>`;
  document.body.appendChild(root);
  input = root.querySelector('input'); list = root.querySelector('.cmdk-l'); frame = root.querySelector('.cmdk-f');
  hl = document.createElement('i'); hl.className = 'cmdk-hl'; hl.setAttribute('aria-hidden', 'true');
  input.addEventListener('input', build);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive(active + (e.key === 'ArrowDown' ? 1 : -1)); sfx('tick'); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(true); }
    else if (e.key === 'Tab') e.preventDefault();
    e.stopPropagation();
  });
  list.addEventListener('pointermove', (e) => { const r = e.target.closest('.cmdk-r'); if (r && +r.dataset.i !== active) setActive(+r.dataset.i); });
  list.addEventListener('click', (e) => { const r = e.target.closest('.cmdk-r'); if (r) run(+r.dataset.i); });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) closePalette(true); });
}

export const isPaletteOpen = () => !!root && root.classList.contains('on');

export function openPalette(text = '') {
  if (!root) make();
  if (isPaletteOpen()) return;
  back = document.activeElement;
  // one layer at a time: the palette replaces Settings and the key sheet instead of stacking on them
  closeSettings();
  import('./keys.js').then((m) => { if (m.isKeysOpen()) m.toggleKeys(false); });
  input.value = text;
  root.classList.add('on');
  frame.style.transition = 'none';
  build();
  void frame.offsetWidth; frame.style.transition = '';
  if (motionOn()) root.querySelector('.cmdk-p').animate([{ opacity: 0, scale: '.96', translate: '0 -8px' }, { opacity: 1, scale: '1', translate: '0 0' }], { duration: SPRINGS.smooth.ms, easing: SPRINGS.smooth.easing });
  sfx('open');
  input.focus();
}

export function closePalette(restore = true) {
  if (!isPaletteOpen()) return;
  const p = root.querySelector('.cmdk-p');
  const done = () => root.classList.remove('on');
  if (motionOn()) p.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.97' }], { duration: 140, easing: 'cubic-bezier(.7, 0, .84, 0)' }).onfinish = done;
  else done();
  if (restore) { sfx('close'); if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true }); }
}

export function initPalette() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Space; on a Mac also Cmd+K (Cmd+Space is Spotlight, Ctrl+Space switches the keyboard layout)
    if (((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'Space') || (isMac && e.metaKey && !e.altKey && e.code === 'KeyK')) {
      e.preventDefault(); e.stopPropagation();
      if (isPaletteOpen()) closePalette(true); else openPalette();
    }
  }, true);
}
