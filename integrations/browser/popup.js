// The extension's popup: pairing (the token from Oddments), the actions on the open tab in two groups («Снять»,
// «Забрать»), «Забрать доску целиком» on a board the extension knows, the folder and tags that go with every save,
// and the settings behind the gear (Alt+click, the hover button, the language, the Are.na token, the keys).
const $ = (s) => document.querySelector(s);
const bg = (msg) => chrome.runtime.sendMessage(msg);
const store = chrome.storage.local;
const gecko = !chrome.offscreen; // Zen, Firefox: no offscreen pages, the recording goes through «show the screen»

let prefs = await bg({ t: 'prefs' });

// the popup's own texts: every text node, placeholder, title and aria-label that has an English version
await globalThis.oddLangReady;
function translate() {
  // folder and tag names are the person's own: left as they are
  const own = (n) => (n.parentElement.closest('#folder option:not([value=""]), #tags, #tagList, #boardName, [data-en]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT);
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: own });
  for (let n; (n = walk.nextNode());) {
    const raw = n.__ru || (n.__ru = n.nodeValue), key = raw.trim();
    if (key) n.nodeValue = raw.replace(key, T(key));
  }
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      el['__' + attr] = el['__' + attr] || el.getAttribute(attr);
      el.setAttribute(attr, T(el['__' + attr]));
    }
  }
  // a word with two meanings in Russian gets its English by hand («Снять» — to capture here, to untick elsewhere)
  for (const el of document.querySelectorAll('[data-en]')) {
    el.__ru = el.__ru || el.textContent;
    el.textContent = oddLang() === 'en' ? el.dataset.en : el.__ru;
  }
  document.documentElement.lang = oddLang();
}
if (gecko) $('#recHint').textContent = 'рамка, «Начать запись», окно Zen';
translate();
$('#ver').textContent = chrome.runtime.getManifest().version.replace(/\.0$/, '');

const setState = (cls, text) => { $('#st').className = cls; $('#st span').textContent = text; };
async function refresh() {
  const s = await bg({ t: 'status' });
  document.body.classList.toggle('need', s.state === 'token' || s.state === 'bad');
  if (s.state === 'off') { setState('err', T('Oddments не запущен')); disable(true); return; }
  if (s.state === 'token') { setState('', T('нужен токен')); return; }
  if (s.state === 'bad') { setState('err', T('токен не подошёл')); $('#pairHelp').innerHTML = T('Токен не подошёл. В Oddments › Настройки › Интеграции нажмите <b>«Скопировать токен»</b> ещё раз.'); return; }
  setState('ok', T('подключено'));
  disable(false);
  fill(s.catalog || { folders: [], tags: [] });
}
const disable = (off) => document.querySelectorAll('[data-do], #board').forEach((b) => { b.disabled = off; });

// folders as a tree: children under their parent, indented
function fill(cat) {
  const sel = $('#folder');
  sel.length = 1;
  const kids = (p) => cat.folders.filter((f) => (f.parent || null) === p);
  const walk = (p, d) => kids(p).forEach((f) => { sel.add(new Option(' '.repeat(d) + f.name, f.id)); walk(f.id, d + 1); });
  walk(null, 0);
  // a folder deleted in Oddments is forgotten
  if (prefs.folder && !cat.folders.some((f) => f.id === prefs.folder)) { prefs.folder = ''; store.set({ folder: '' }); }
  sel.value = prefs.folder || '';
  $('#tagList').innerHTML = '';
  for (const t of cat.tags) $('#tagList').appendChild(new Option(t));
}

function chips() {
  const box = $('#tags');
  box.innerHTML = '';
  for (const t of prefs.tags) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.type = 'button';
    c.title = T('Убрать тег');
    c.append(t, Object.assign(document.createElement('span'), { textContent: '×' }));
    c.onclick = () => { prefs.tags = prefs.tags.filter((x) => x !== t); store.set({ tags: prefs.tags }); chips(); };
    box.appendChild(c);
  }
}

// the keys as the browser has them now (the person may have changed them)
async function keys() {
  const all = await chrome.commands.getAll().catch(() => []);
  const mac = /Mac/i.test(navigator.platform);
  for (const k of document.querySelectorAll('kbd[data-cmd]')) {
    const c = all.find((x) => x.name === k.dataset.cmd);
    let s = (c && c.shortcut) || '';
    if (mac) s = s.replace(/Alt\+|Option\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/Command\+|MacCtrl\+/g, '⌘');
    k.textContent = s;
  }
}

// «Забрать доску целиком»: what the open tab is (a board, a channel, a profile) — asked from its address only
async function board() {
  const b = await bg({ t: 'boardHere' }).catch(() => null);
  const btn = $('#board');
  btn.hidden = !b;
  if (!b) return;
  $('#boardWhat').textContent = T(b.kind === 'profile' ? 'Забрать доски…' : b.service === 'Are.na' ? 'Забрать канал целиком' : 'Забрать доску целиком');
  $('#boardName').textContent = b.service + (b.name ? ' · ' + b.name : '');
}

$('#folder').onchange = (e) => { prefs.folder = e.target.value; store.set({ folder: prefs.folder }); };
$('#tag').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const t = e.target.value.trim();
  if (t && !prefs.tags.includes(t)) { prefs.tags = [...prefs.tags, t]; store.set({ tags: prefs.tags }); chips(); }
  e.target.value = '';
});
document.querySelectorAll('[data-do]').forEach((b) => {
  b.onclick = () => { bg({ t: 'popup', do: b.dataset.do }); window.close(); };
});
$('#board').onclick = () => { bg({ t: 'popup', do: 'board' }); window.close(); };
$('#help').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('help.html') }); window.close(); };

// pairing
$('#tokSave').onclick = async () => {
  const token = $('#tok').value.trim();
  if (!token) return;
  await store.set({ token });
  prefs.token = token;
  $('#tok').value = '';
  refresh();
};
$('#tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#tokSave').click(); });

// settings
$('#gear').onclick = () => document.body.classList.add('set-on');
$('#back').onclick = () => document.body.classList.remove('set-on');
for (const id of ['altClick', 'hoverBtn']) {
  $('#' + id).checked = prefs[id];
  $('#' + id).onchange = (e) => store.set({ [id]: e.target.checked });
}
const langSel = $('#lang');
langSel.value = (await store.get('lang')).lang || '';
langSel.onchange = async () => { await store.set({ lang: langSel.value }); setTimeout(() => { translate(); refresh(); board(); }, 0); };
$('#arena').value = (await store.get('arenaToken')).arenaToken || '';
$('#arena').onchange = (e) => store.set({ arenaToken: e.target.value.trim() });
$('#keys').onclick = () => { bg({ t: 'openShortcuts' }); window.close(); };
$('#unpair').onclick = async () => { await store.set({ token: '' }); prefs.token = ''; document.body.classList.remove('set-on'); refresh(); };

chips();
keys();
board();
refresh();
