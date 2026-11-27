// «Как пользоваться»: the extension's own page (opened once after the install and the update to 1.7, and by «?» in
// the popup). Its texts follow the extension's language; the keys are read from the browser as they are now.
await globalThis.oddLangReady;
const gecko = !chrome.offscreen;

// the page is written in Russian; English for whole pieces (a paragraph or a list item with its <b> and <kbd>)
const EN = {
  'Как пользоваться расширением': 'How to use the extension',
  'Всё, что сохраняете, сразу попадает в Oddments на этом компьютере. Приложение должно быть открыто.': 'Everything you save goes straight to Oddments on this computer. The app has to be open.',
  'Картинки': 'Pictures', 'Видео области': 'Area video', 'Снимки': 'Screenshots', 'Страница и вёрстка': 'Page and layout', 'Доски целиком': 'Whole boards', 'Клавиши': 'Keys',
  'Подключение': 'Connecting',
  'В Oddments откройте <b>Настройки › Интеграции</b> и нажмите <b>«Скопировать токен»</b>.': 'In Oddments, open <b>Settings › Integrations</b> and press <b>«Copy the token»</b>.',
  'Нажмите значок Oddments на панели браузера, вставьте токен и нажмите <b>«Подключить»</b>.': 'Click the Oddments icon in the browser toolbar, paste the token and press <b>«Connect»</b>.',
  'Выберите подборку и теги в разделе <b>«Куда»</b>. Они добавятся ко всему, что вы сохраняете.': 'Pick a collection and tags under <b>«Where»</b>. They go with everything you save.',
  'Oddments · подключено': 'Oddments · connected',
  'Картинки и видео со страницы': 'Pictures and videos from a page',
  '<b>Alt+клик</b> по картинке сохраняет её сразу. Срабатывает и сквозь слои, например на Behance.': '<b>Alt+click</b> on a picture saves it at once. It works through overlays too, on Behance for example.',
  'При наведении на картинку появляется кнопка <b>«В Oddments»</b>.': 'Hover over a picture and a <b>«To Oddments»</b> button appears.',
  '<b>Правый клик › Oddments › Картинку в Oddments</b>. Так же сохраняются видео и ссылки.': '<b>Right click › Oddments › Picture to Oddments</b>. Videos and links are saved the same way.',
  'Перетащите картинку или ссылку на <b>док</b>, который появится у правого края.': 'Drag a picture or a link onto the <b>dock</b> that appears at the right edge.',
  '<b>Все картинки страницы</b>: выберите нужные в общем окне и сохраните одним нажатием.': '<b>All pictures on the page</b>: pick the ones you want in one window and save them with one press.',
  'Бросьте сюда — в Oddments': 'Drop here — to Oddments',
  'Записывает выбранный кусок страницы как видео: анимацию, интерфейс, прокрутку.': 'Records a chosen part of the page as a video: an animation, an interface, a scroll.',
  'Нажмите <kbd data-cmd="record-area"></kbd>, или <b>правый клик › Oddments › Видео области</b>, или кнопку <b>«Видео области»</b> в окне расширения.': 'Press <kbd data-cmd="record-area"></kbd>, or <b>right click › Oddments › Area video</b>, or the <b>«Area video»</b> button in the extension window.',
  'Выделите мышью область. Чтобы записать всё окно сайта, нажмите <b>«Вся вкладка»</b>.': 'Drag over the area. To record the whole site window, press <b>«Whole tab»</b>.',
  'Подвиньте рамку или потяните её за точки, затем нажмите <b>«Начать запись»</b> или Enter.': 'Move the frame or drag its dots, then press <b>«Start recording»</b> or Enter.',
  'Под рамкой идут время, «Пауза» и «Стоп». После «Стоп» видео сохраняется в Oddments.': 'Under the frame you get the time, «Pause» and «Stop». After «Stop» the video is saved to Oddments.',
  'В Chrome и Edge видео записывается в MP4 со звуком вкладки, максимум 5 минут. Рамка и кнопки в запись не попадают. Если Oddments закрыт, файл уходит в загрузки браузера.': 'In Chrome and Edge the video is MP4 with the tab\'s sound, up to 5 minutes. The frame and the buttons stay out of the video. If Oddments is closed, the file goes to the browser\'s downloads.',
  '<b>браузер спросит, что показать: выберите окно Zen или весь экран.</b> Расширение само найдёт выделенную область. Видео будет в WebM, без звука. Во время записи не двигайте окно.': '<b>the browser asks what to share: choose the Zen window or the whole screen.</b> The extension finds the chosen area by itself. The video is WebM, without sound. Do not move the window while recording.',
  '<span class="p">Начать запись</span><span>Вся вкладка</span><span>Отмена</span>': '<span class="p">Start recording</span><span>Whole tab</span><span>Cancel</span>',
  '<b>Снимок области</b> <kbd data-cmd="shot-area"></kbd>: выделите область, и снимок сразу уйдёт в Oddments.': '<b>Area screenshot</b> <kbd data-cmd="shot-area"></kbd>: drag over an area and the screenshot goes to Oddments at once.',
  '<b>Снимок всего, что видно</b> <kbd data-cmd="shot-visible"></kbd>: видимая часть страницы целиком.': '<b>Screenshot of what is visible</b> <kbd data-cmd="shot-visible"></kbd>: the whole visible part of the page.',
  '<b>Страницу закладкой</b>: ссылка с обложкой и названием. Ссылки на YouTube, Vimeo и Pinterest становятся карточками ролика.': '<b>Page as a bookmark</b>: a link with a cover and a title. YouTube, Vimeo and Pinterest links become video cards.',
  '<b>Страницу текстом для чтения</b>: статья в том виде, в каком её показывает ваш браузер. Её можно прочитать в <b>Oddments › Новости › Сохранённое</b>.': '<b>Page as text to read</b>: the article as your browser shows it. Read it in <b>Oddments › News › Saved</b>.',
  '<b>Кусок вёрстки</b>: наведите на блок страницы, колесом выберите размер и кликните. Сохранятся снимок блока и его код со стилями и шрифтами.': '<b>Piece of layout</b>: point at a block of the page, pick its size with the wheel and click. A screenshot of the block and its code with styles and fonts are saved.',
  'Страницу закладкой': 'Page as a bookmark', 'Страницу текстом для чтения': 'Page as text to read', 'Кусок вёрстки: картинка и код…': 'Piece of layout: picture and code…',
  'Снимок области': 'Area screenshot', 'Снимок всего, что видно': 'Screenshot of what is visible',
  'Забрать доску целиком': 'Take a whole board',
  'Переносит в Oddments доску, кластер или канал со всеми картинками и видео в исходном качестве.': 'Moves a board, a cluster or a channel to Oddments with all its pictures and videos in their original quality.',
  'Pinterest — доски и их разделы': 'Pinterest — boards and their sections', 'Cosmos — кластеры': 'Cosmos — clusters', 'Are.na — каналы': 'Are.na — channels', 'Savee — доски': 'Savee — boards',
  'Откройте доску в браузере, войдя в свой аккаунт: так забираются и закрытые доски.': 'Open the board in the browser while signed in to your account: that way private boards come along too.',
  'Нажмите значок Oddments и затем <b>«Забрать доску целиком»</b>. То же есть в правом клике. На странице профиля кнопка называется <b>«Забрать доски…»</b>: отметьте нужные доски галочками.': 'Click the Oddments icon and then <b>«Take a whole board»</b>. The right-click menu has it too. On a profile page the button says <b>«Take boards…»</b>: tick the boards you want.',
  'Расширение само прокрутит доску. Это займёт столько же времени, сколько листать её руками. Прервать можно кнопкой <b>«Остановить»</b>.': 'The extension scrolls the board by itself. It takes about as long as scrolling it by hand. <b>«Stop»</b> interrupts it.',
  'В конце появится окно со всем найденным. То, что уже есть в Oddments, не выбрано. Нажмите <b>«Сохранить»</b>.': 'At the end a window shows everything found. What Oddments already has is not ticked. Press <b>«Save»</b>.',
  'В Oddments появится подборка сервиса, например «Pinterest», в ней подборка доски, а разделы доски станут вложенными подборками. Описание пина попадает в поиск. Если забрать ту же доску ещё раз, добавится только новое. Удалённое в Oddments обратно не вернётся. Закрытые каналы Are.na забираются с личным токеном: его можно вставить в окне расширения, в настройках › Are.na. Текстовые блоки Are.na не переносятся.': 'Oddments gets a collection for the service, «Pinterest» for example, with the board\'s collection inside it; the board\'s sections become nested collections. A pin\'s description goes into search. Taking the same board again adds only what is new. What you deleted in Oddments does not come back. Private Are.na channels need your personal token: paste it in the extension window, settings › Are.na. Are.na text blocks are not moved.',
  'Изменить клавиши': 'Change the keys',
  'Браузер даёт расширению только четыре клавиши сразу. Остальным действиям клавишу можно назначить самому кнопкой выше.': 'The browser gives an extension only four keys at first. You can give the other actions a key yourself with the button above.',
  'Oddments — как пользоваться': 'Oddments — how to use it',
  'своя клавиша': 'set your own',
};
const tr = (s) => (oddLang() === 'en' && EN[s] !== undefined ? EN[s] : s);
if (oddLang() === 'en') {
  // the deepest pieces first would split a paragraph: whole elements are matched as they are written
  for (const el of document.querySelectorAll('h1, h2, .lead, li, p, .services span, .toc a, .zen, .go, .menu div, .dock, button, .hov')) {
    const html = el.innerHTML.replace(/\s+/g, ' ').trim();
    if (EN[html] !== undefined) el.innerHTML = EN[html];
    else if (el.childElementCount === 1 && el.firstElementChild.tagName === 'svg') {
      // «В Oddments» next to the prism
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (t) t.nodeValue = T(t.nodeValue.trim());
    }
  }
}
document.documentElement.lang = oddLang();
document.title = tr('Oddments — как пользоваться');

// Zen / Firefox: the note about «show the screen» is theirs; Chrome and Edge do not need it
for (const el of document.querySelectorAll('[data-gecko]')) el.hidden = !gecko;

const NAMES = {
  'shot-area': 'Снимок области', 'record-area': 'Видео области', 'shot-visible': 'Снимок всего, что видно', 'save-all': 'Все картинки страницы',
  'save-page': 'Страницу закладкой', 'save-article': 'Страницу текстом для чтения', 'grab-block': 'Кусок вёрстки: картинка и код…', 'grab-board': 'Забрать доску целиком',
};
const mac = /Mac/i.test(navigator.platform);
const nice = (s) => (mac ? String(s || '').replace(/Alt\+|Option\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/Command\+|MacCtrl\+/g, '⌘') : s || '');
const all = await chrome.commands.getAll().catch(() => []);
const list = document.getElementById('keyList');
for (const name of Object.keys(NAMES)) {
  const c = all.find((x) => x.name === name);
  if (!c) continue;
  const row = document.createElement('div');
  const label = tr(NAMES[name]) !== NAMES[name] ? tr(NAMES[name]) : T(NAMES[name]);
  row.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('kbd'), { textContent: nice(c.shortcut) }));
  list.appendChild(row);
}
for (const k of document.querySelectorAll('kbd[data-cmd]')) {
  const c = all.find((x) => x.name === k.dataset.cmd);
  k.textContent = nice(c && c.shortcut) || tr('своя клавиша');
}
document.getElementById('change').onclick = () => chrome.runtime.sendMessage({ t: 'openShortcuts' });
