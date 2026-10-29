// «Чистый экран»: the main screen is the references and nothing else. The glass panels are still there, just out
// of the way: the sidebar slides in at the left edge (or with [), the top bar with search and tabs shows near the
// top edge (or with /, or while it has focus), the dock near the bottom. Four quiet corner labels say where you
// are. \ switches the mode; the setting lives in Settings › Внешний вид.
import { isMac, layerOpen } from '../util.js';
import { S, ui } from '../state.js';
import { setLayoutPrefs } from './settings.js';
import { ic } from './icons.js';
import { markStep } from './onboard.js';

let hud = null, sideT = null;
const body = document.body;
const isOn = () => body.classList.contains('clean');

export function initClean() {
  // top-left: where you are (the top bar slides over it, so it only reads); bottom-left: the ways back to the
  // hidden panels as real buttons, each with its key, so nothing has to be remembered
  hud = document.createElement('div');
  hud.className = 'hud-c';
  hud.innerHTML = `<div class="hud-tl" aria-hidden="true"><b>●</b> ODDMENTS <span id="hudWhere"></span><span class="hud-n" id="hudN"></span></div>
    <nav class="hud-bl" aria-label="Панели чистого экрана">
      <button type="button" data-hud="side"><kbd>[</kbd>Места</button>
      <button type="button" data-hud="find"><kbd>/</kbd>Поиск</button>
      <button type="button" data-hud="cmd"><kbd>${isMac ? '⌘ K' : 'Ctrl Space'}</kbd>Команды</button>
      <button type="button" data-hud="plain"><kbd>\\</kbd>Обычный вид</button>
    </nav>`;
  document.getElementById('app').appendChild(hud);
  hud.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hud]');
    if (!b) return;
    const a = b.dataset.hud;
    if (a === 'side') document.getElementById('sidePin').click();
    else if (a === 'find') { body.classList.add('peek-top'); document.getElementById('q').focus(); }
    else if (a === 'cmd') import('./palette.js').then((m) => m.openPalette());
    else if (a === 'plain') setClean(false);
  });

  // the hint at the left edge is also a handle: a click pins the panel
  const lip = document.createElement('button');
  lip.type = 'button'; lip.className = 'side-lip'; lip.setAttribute('aria-label', 'Закрепить боковую панель'); lip.tabIndex = -1;
  lip.addEventListener('click', () => document.getElementById('sidePin').click());
  document.getElementById('app').appendChild(lip);
  const side = document.querySelector('.side');
  const ZONE = 44; // px from the left edge that call the panel
  let lastX = 0, lastT = 0, intentT = null;
  const open = () => { clearTimeout(intentT); intentT = null; clearTimeout(sideT); sideT = null; body.classList.add('peek-side'); lip.style.setProperty('--near', 0); markStep('edges'); };

  addEventListener('pointermove', (e) => {
    if (!isOn()) return;
    // a layer over the app: the edges under it stay put (the top bar slid out behind «Плагины», bug #111)
    if (layerOpen()) { if (!body.classList.contains('peek-pin')) body.classList.remove('peek-side'); body.classList.remove('peek-top', 'peek-dock'); return; }
    const y = e.clientY, x = e.clientX, H = innerHeight, now = performance.now();
    const vx = (x - lastX) / Math.max(1, now - lastT); // px/ms, negative = towards the left edge
    lastX = x; lastT = now;
    const shown = body.classList.contains('peek-side');
    // the sidebar comes in from a band along the left edge: at once at the very edge or on a quick move
    // towards it, after a short pause otherwise (so passing by does not open it); never over the bar's buttons
    const overCtl = e.target.closest && e.target.closest('.bar, .tabrow, .dock, .insp, .ctx, .menu');
    if (!shown) {
      lip.style.setProperty('--near', overCtl ? 0 : Math.max(0, 1 - x / 110).toFixed(2));
      if (x < ZONE && !overCtl) {
        if (x < 8 || vx < -0.8) open();
        else if (!intentT) intentT = setTimeout(open, 120);
      } else if (intentT) { clearTimeout(intentT); intentT = null; }
    } else if (!body.classList.contains('peek-pin')) {
      // out once the pointer is well past the panel (a moment later, so a slip does not close it)
      const edge = side.getBoundingClientRect().right + 40;
      // focus inside keeps it only while typing there or working from the keyboard: after a click on a collection
      // the focus stayed on that row and the panel hung open until a click elsewhere (bug #45)
      const a = document.activeElement;
      const typing = side.contains(a) && (body.classList.contains('kbd') || (a && a.matches && a.matches('input, textarea, [contenteditable="true"]')));
      if (x > edge && !typing) { if (!sideT) sideT = setTimeout(() => { sideT = null; body.classList.remove('peek-side'); }, 220); }
      else { clearTimeout(sideT); sideT = null; }
    }
    // a menu opened from the top bar or the tabs («Ещё», sorting, «Добавить», the colour search) lives in its own
    // layer: while it is open the panel stays, or it would fade away from under its own menu
    const held = document.querySelector('.kmenu, .gsel-list[data-top]:not(.shut), #addMenu.open, #pop:not([hidden])');
    body.classList.toggle('peek-top', !!held || y < 76 || (body.classList.contains('peek-top') && y < 150));
    if (y < 76) markStep('edges');
    body.classList.toggle('peek-dock', y > H - 84 || (body.classList.contains('peek-dock') && y > H - 140));
  }, { passive: true });
  // the pointer left the window: everything settles back
  document.addEventListener('pointerleave', () => {
    clearTimeout(intentT); intentT = null; lip.style.setProperty('--near', 0);
    if (!body.classList.contains('peek-pin')) body.classList.remove('peek-side');
    body.classList.remove('peek-top', 'peek-dock');
  });
  updateHud();
  syncPin();
}

// [ in the clean mode pins the sidebar; pinned, it takes its column (body.clean.peek-pin sets --pl), so the
// grid, the tabs and the top bar move over instead of running under it
export function toggleCleanSide() {
  const pin = !body.classList.contains('peek-pin');
  body.classList.toggle('peek-pin', pin);
  body.classList.toggle('peek-side', pin);
  syncPin();
}

// the button in the panel's own header: «закрепить», while the panel only peeks in; «скрыть», when pinned
export function syncPin() {
  const b = document.getElementById('sidePin');
  if (!b) return;
  const peekOnly = isOn() && !body.classList.contains('peek-pin');
  if (b.dataset.st !== String(peekOnly)) { b.dataset.st = String(peekOnly); b.innerHTML = ic(peekOnly ? 'pin' : 'sideL'); }
  b.setAttribute('aria-label', peekOnly ? 'Закрепить боковую панель' : 'Скрыть боковую панель');
  b.title = peekOnly ? 'Закрепить панель ( [ )' : 'Скрыть панель ( [ )';
}
export const cleanOn = isOn;

export function updateHud() {
  if (!hud) return;
  const t = document.getElementById('vTitle');
  // the dot and the title as two text nodes: the title is copied before the interface's English reaches it (i18n.js
  // translates text as it appears), and «· Все файлы» in one piece is not a dictionary entry, «Все файлы» is
  hud.querySelector('#hudWhere').replaceChildren(...(t ? ['· ', document.createTextNode(t.textContent)] : []));
  hud.querySelector('#hudN').textContent = `(${S.vis.length})`;
}

export function setClean(on) {
  if (!on) { body.classList.remove('peek-side', 'peek-pin', 'peek-top', 'peek-dock'); markStep('edges'); } // the panels are found
  setLayoutPrefs({ clean: on }); // applySettings toggles body.clean
  syncPin();
  ui.refresh();
}
