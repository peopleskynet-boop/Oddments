// The first-run window: language, where the library lives (and «перенести из Eagle»), AI and the network. Shown once,
// before the library opens, on a computer where Oddments has never run (no settings yet); `?welcome` shows it in the
// browser build. Nothing is downloaded or checked here: the choices are kept, and the app acts on them once it is up
// (after() — AI on, the Eagle import). Choosing English reloads the window (i18n.js) and the window comes back on the
// next step. Everything here is in Settings later; «Знакомство» in the sidebar takes over from here.
import './welcome.css';
import { esc } from '../util.js';
import { ic } from './icons.js';
import { pushLayer, popLayer } from './layers.js';
import { sfx } from './sound.js';
import { readPref, writePref, readText, writeText } from '../lib/prefs.js';
import { lang, setLang } from '../lib/i18n.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { documentDir, join } from '@tauri-apps/api/path';
import { MODEL_MB as AI_MB } from '../lib/ai.js';
import { setOffline } from '../lib/net.js';

const KEY = 'perch.welcome';
const STEPS = ['lang', 'lib', 'ai', 'done'];
const OCR_MB = 13;

export function runWelcome() {
  const st = readPref(KEY, { step: 0, eagle: false, ai: false, ocr: true, updates: true, offline: false });
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'wz';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Добро пожаловать в Oddments');
    el.innerHTML = '<div class="wz-glow" aria-hidden="true"><i></i><i></i><i></i></div><div class="wz-card glass"></div>';
    document.body.appendChild(el);
    const card = el.querySelector('.wz-card');
    const save = () => writePref(KEY, st);
    let root = readText('perch.root');
    const finish = () => {
      st.done = true; save();
      writePref('perch.ocr', { ...readPref('perch.ocr', {}), on: !st.offline && st.ocr });
      writePref('perch.updates', { ...readPref('perch.updates', {}), auto: !st.offline && st.updates, offered: true });
      if (st.offline) setOffline(true);
      popLayer(el);
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
      sfx('done');
      resolve(st);
    };
    const go = (i) => { st.step = Math.max(0, Math.min(STEPS.length - 1, i)); save(); draw(); };
    async function draw() {
      const s = STEPS[st.step];
      const dots = `<div class="wz-dots" aria-label="Шаг ${st.step + 1} из ${STEPS.length}">${STEPS.map((_, i) => `<i class="${i <= st.step ? 'on' : ''}"></i>`).join('')}</div>`;
      const nav = (next = 'Дальше') => `<div class="wz-nav">${st.step ? '<button type="button" class="ibtn flat" data-wz="back">Назад</button>' : '<span></span>'}<button type="button" class="ibtn pri" data-wz="next">${next}</button></div>`;
      if (s === 'lang') {
        card.innerHTML = `${dots}<h2>Добро пожаловать в Oddments</h2><p class="wz-p">Библиотека референсов для дизайнеров: картинки, видео, 3D, шрифты и PDF — в обычной папке на вашем диске.</p>
          <div class="wz-sub">Язык · Language</div>
          <div class="wz-langs" role="radiogroup" aria-label="Язык · Language">${[['ru', 'Русский'], ['en', 'English']].map(([k, n]) => `<button type="button" role="radio" class="wz-lang${lang === k ? ' on' : ''}" aria-checked="${lang === k}" data-lang="${k}">${n}</button>`).join('')}</div>${nav()}`;
      } else if (s === 'lib') {
        if (!root) { try { root = await join(await documentDir(), 'Oddments Library'); } catch (e) { root = 'Документы/Oddments Library'; } }
        card.innerHTML = `${dots}<h2>Где хранить библиотеку</h2><p class="wz-p">Обычная папка: оригиналы файлов не меняются, рядом — index.json с тегами и подборками. Папку можно держать в облаке или на сетевом диске команды.</p>
          <code class="wz-path">${esc(root)}</code>
          <button type="button" class="ibtn" data-wz="pick">${ic('folder')}<span>Выбрать другую папку…</span></button>
          <label class="wz-row"><span><b>Перенести файлы из Eagle</b><small>Сразу после запуска: папки станут подборками, теги и заметки сохранятся. Библиотека Eagle не изменится.</small></span><input type="checkbox" class="switch" data-k="eagle" ${st.eagle ? 'checked' : ''}></label>${nav()}`;
      } else if (s === 'ai') {
        const off = st.offline;
        card.innerHTML = `${dots}<h2>ИИ и сеть</h2><p class="wz-p">Всё работает на этом компьютере. В сеть Oddments выходит только за тем, что вы включите.</p>
          <label class="wz-row"><span><b>Поиск по смыслу</b><small>«рука с наушниками», «персонаж с голубыми волосами» — модель SigLIP 2, около ${(AI_MB / 1000).toFixed(1).replace('.', ',')} ГБ, скачается один раз с Hugging Face.</small></span><input type="checkbox" class="switch" data-k="ai" ${st.ai && !off ? 'checked' : ''} ${off ? 'disabled' : ''}></label>
          <label class="wz-row"><span><b>Текст на картинках</b><small>Поиск по написанному на скриншотах и постерах — модель ${OCR_MB} МБ.</small></span><input type="checkbox" class="switch" data-k="ocr" ${st.ocr && !off ? 'checked' : ''} ${off ? 'disabled' : ''}></label>
          <label class="wz-row"><span><b>Проверять обновления</b><small>Раз в день — один запрос к GitHub, без данных о вас.</small></span><input type="checkbox" class="switch" data-k="updates" ${st.updates && !off ? 'checked' : ''} ${off ? 'disabled' : ''}></label>
          <label class="wz-row"><span><b>Без сети</b><small>Ничего не скачивать и не отправлять: ни моделей, ни ленты, ни обложек ссылок.</small></span><input type="checkbox" class="switch" data-k="offline" ${off ? 'checked' : ''}></label>
          <p class="wz-hint">Всё это меняется потом в Настройках: «ИИ» и «О программе».</p>${nav()}`;
      } else {
        card.innerHTML = `${dots}<h2>Готово</h2><p class="wz-p">Скопируйте картинку где угодно и нажмите ${/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'} V в Oddments — она уже в библиотеке. Остальное подскажет «Знакомство» слева внизу, клавиши — по «?».</p>
          ${st.eagle ? '<p class="wz-hint">Сейчас откроется выбор библиотеки Eagle — папки, которая кончается на .library.</p>' : ''}${nav('Открыть Oddments')}`;
      }
      const first = card.querySelector('.wz-lang.on, [data-wz="next"]');
      if (first) first.focus({ preventScroll: true });
    }
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-wz], [data-lang]');
      if (!b) return;
      if (b.dataset.lang) {
        if (b.dataset.lang === lang) { go(1); return; }
        st.step = 1; save();
        setLang(b.dataset.lang); // reloads; the window comes back on the next step in that language
        return;
      }
      const a = b.dataset.wz;
      if (a === 'back') go(st.step - 1);
      else if (a === 'next') { if (STEPS[st.step] === 'done') finish(); else go(st.step + 1); }
      else if (a === 'pick') {
        let dir = null;
        try { dir = await openDialog({ directory: true, recursive: true, multiple: false, title: 'Папка библиотеки Oddments' }); } catch (err) { /* the dialog did not open: the default stays */ }
        if (Array.isArray(dir)) dir = dir[0];
        if (dir) { root = dir; writeText('perch.root', dir); draw(); }
      }
    });
    card.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      st[k] = e.target.checked; save();
      if (k === 'offline') draw(); // the network switches follow it
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.wz-card, body')) card.querySelector('[data-wz="next"]').click();
      e.stopPropagation(); // nothing behind it runs yet
    });
    pushLayer({ el, title: 'Oddments', close: () => {} }); // no Esc: the window ends with a choice
    draw();
  });
}

// once the library is open: what the person chose that needs the app running
export async function after(st) {
  if (!st) return;
  if (st.ai && !st.offline) import('../lib/ai.js').then((m) => m.turnOn()).catch(() => {});
  if (st.eagle) setTimeout(() => import('../lib/importers.js').then((m) => m.importEagle()), 600);
}
