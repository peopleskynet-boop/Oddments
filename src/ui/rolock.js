// «Только просмотр» (lib/liblock.js): the library's folder is open in another Oddments — the desktop app or another tab
// of Oddments Web. A strip says where; the wall, the search and the preview work, nothing is written. Now and then it
// looks again: once the other one has closed, it offers to work here (a reload takes the folder).
import './rolock.css';
import { esc } from '../util.js';
import { holderText, lockFree } from '../lib/liblock.js';
import { toast } from './dialogs.js';

let el = null, timer = 0, lockNow = null;

export function showReadOnly(lock) {
  lockNow = lock;
  if (!el) {
    el = document.createElement('div');
    el.className = 'ro-strip glass';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ro]');
      if (!b) return;
      if (b.dataset.ro === 'go') location.reload();
      else check(true);
    });
  }
  el.classList.remove('free');
  el.innerHTML = `<span class="ro-dot" aria-hidden="true"></span><span>Библиотека открыта ${esc(holderText(lock))} — здесь только смотреть</span><button type="button" class="ibtn" data-ro="check">Проверить снова</button>`;
  clearInterval(timer);
  timer = setInterval(() => check(false), 30000);
}

async function check(asked) {
  if (await lockFree()) {
    clearInterval(timer);
    el.classList.add('free');
    el.innerHTML = '<span class="ro-dot" aria-hidden="true"></span><span>Там библиотеку закрыли — можно работать здесь</span><button type="button" class="ibtn pri" data-ro="go">Открыть для работы</button>';
  } else if (asked) toast(`Библиотека всё ещё открыта ${holderText(lockNow)}. Закройте её там — метка снимется сама.`, 6000);
}
