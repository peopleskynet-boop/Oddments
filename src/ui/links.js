// Link covers in the window: the links saved before covers are read once a little after the start, any links again from
// the menu («Обновить обложку»), and a picture from the clipboard becomes a link's cover (Ctrl+V onto a selected link,
// «Обложка из буфера»). The reading itself is library.js refreshLinks → ingest.js genLink → linkpage.js.
import { S, ui } from '../state.js';
import { refreshLinks, setLinkCover, saveIndex } from '../lib/library.js';
import { busy, busyDone, toast } from './dialogs.js';
import { isOffline } from '../lib/net.js';
import { plural } from '../util.js';

let running = false;

// One at a time, the wall redrawn at most every 1.5 s (not per link); the pill counts and its × stops between links.
export async function refreshLinksNow(list, { auto = false } = {}) {
  list = list.filter((it) => it.kind === 'link' && !it.trashed && !it.team);
  if (!list.length) return 0;
  if (running) { if (!auto) toast('Обложки ссылок уже обновляются — дождитесь конца или остановите их в плашке сверху.'); return 0; }
  if (isOffline()) { if (!auto) toast('Не удалось обновить обложки: включён режим «Без сети» (Настройки › О программе).', 6000); return 0; }
  running = true;
  let stop = false, drawn = 0;
  const end = () => { stop = true; };
  const total = list.length;
  const say = (done) => busy(total > 1 ? `Обложки ссылок: ${done} из ${total}` : 'Обновляю обложку ссылки…', total > 1 ? done / total : -1, end);
  say(0);
  try {
    const n = await refreshLinks(list, {
      stop: () => stop,
      step: (done, all, it) => {
        say(Math.min(all, list.indexOf(it) + 1));
        if (Date.now() - drawn > 1500) { drawn = Date.now(); saveIndex(); ui.refresh(); }
      },
    });
    saveIndex();
    ui.refresh();
    const bare = list.filter((it) => it.page && !it.page.cover).length;
    busyDone(stop ? `Остановлено: обновлено ${n}` : total > 1 ? `Обложки ссылок: ${n} из ${total}` : n ? 'Обложка обновлена' : '');
    if (!auto && n && bare) toast(bare === 1 && total === 1
      ? 'Сайт не отдал картинку: на карточке название. Скопируйте картинку и нажмите Ctrl V на выбранной ссылке — она станет обложкой.'
      : `${bare} ${plural(bare, ['сайт', 'сайта', 'сайтов'])} не отдали картинку: на карточках названия. Обложку можно поставить самому — Ctrl V с картинкой на выбранной ссылке.`, 8000);
    if (!auto && !n) toast('Не удалось обновить обложку: сайт не ответил. Проверьте интернет и попробуйте ещё раз.', 6000);
    return n;
  } catch (e) {
    busyDone('');
    toast(`Не удалось обновить обложки: ${(e && e.message) || e}. Попробуйте ещё раз из меню ссылки.`, 7000);
    return 0;
  } finally { running = false; }
}

// at the start: the links that have never been read (saved before covers, or while «Без сети» was on)
export function coverOldLinks() {
  const old = S.items.filter((it) => it.kind === 'link' && !it.trashed && !it.page).sort((a, b) => b.added - a.added);
  return refreshLinksNow(old, { auto: true });
}

// the picture becomes the cover; «Отменить» brings the old card back
export async function coverFrom(it, blob) {
  try {
    const undo = await setLinkCover(it, blob);
    if (!undo) return false;
    ui.refresh();
    toast('Обложка ссылки заменена', 6000, { fn: () => { undo(); ui.refresh(); } });
    return true;
  } catch (e) {
    toast('Не удалось поставить обложку: картинка не открылась. Скопируйте её ещё раз (в браузере — «Копировать картинку»).', 7000);
    return false;
  }
}

// «Обложка из буфера» in the menu: the clipboard's picture, read by the app (the paste event is not there)
export async function coverFromClipboard(it) {
  const { readNativeClipboardImage } = await import('../lib/clipboard.js');
  const list = await readNativeClipboardImage();
  if (!list.length) { toast('В буфере обмена нет картинки. Скопируйте картинку (в браузере — «Копировать картинку») и выберите «Обложка из буфера» ещё раз.', 7000); return; }
  await coverFrom(it, list[0].blob);
}
