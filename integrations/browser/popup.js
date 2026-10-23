// The extension's popup: pairing (the token from Oddments), the folder and tags that go with every save,
// quick actions on the open tab and the two page options.
const $ = (s) => document.querySelector(s);
const bg = (msg) => chrome.runtime.sendMessage(msg);
const store = chrome.storage.local;

let prefs = await bg({ t: 'prefs' });
const setState = (cls, text) => { $('#st').className = cls; $('#st span').textContent = text; };

async function refresh() {
  const s = await bg({ t: 'status' });
  document.body.classList.toggle('need', s.state === 'token' || s.state === 'bad');
  if (s.state === 'off') { setState('err', 'Oddments не запущен'); disable(true); return; }
  if (s.state === 'token') { setState('', 'нужен токен'); return; }
  if (s.state === 'bad') { setState('err', 'токен не подошёл'); $('#pairHelp').innerHTML = 'Токен не подошёл. В Oddments › Настройки › Интеграции нажмите <b>«Скопировать токен»</b> ещё раз.'; return; }
  setState('ok', 'подключено');
  disable(false);
  fill(s.catalog || { folders: [], tags: [] });
}
const disable = (off) => document.querySelectorAll('[data-do]').forEach((b) => { b.disabled = off; });

// folders as a tree: children under their parent, indented
function fill(cat) {
  const sel = $('#folder');
  sel.length = 1;
  const kids = (p) => cat.folders.filter((f) => (f.parent || null) === p);
  const walk = (p, d) => kids(p).forEach((f) => { sel.add(new Option(' '.repeat(d) + f.name, f.id)); walk(f.id, d + 1); });
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
    c.title = 'Убрать тег';
    c.append(t, Object.assign(document.createElement('span'), { textContent: '×' }));
    c.onclick = () => { prefs.tags = prefs.tags.filter((x) => x !== t); store.set({ tags: prefs.tags }); chips(); };
    box.appendChild(c);
  }
}

$('#folder').onchange = (e) => { prefs.folder = e.target.value; store.set({ folder: prefs.folder }); };
$('#tag').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const t = e.target.value.trim();
  if (t && !prefs.tags.includes(t)) { prefs.tags = [...prefs.tags, t]; store.set({ tags: prefs.tags }); chips(); }
  e.target.value = '';
});
for (const id of ['altClick', 'hoverBtn']) {
  $('#' + id).checked = prefs[id];
  $('#' + id).onchange = (e) => store.set({ [id]: e.target.checked });
}
document.querySelectorAll('[data-do]').forEach((b) => {
  b.onclick = () => { bg({ t: 'popup', do: b.dataset.do }); window.close(); };
});
$('#tokSave').onclick = async () => {
  const token = $('#tok').value.trim();
  if (!token) return;
  await store.set({ token });
  prefs.token = token;
  $('#tok').value = '';
  refresh();
};
$('#tok').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#tokSave').click(); });
$('#unpair').onclick = async () => { await store.set({ token: '' }); prefs.token = ''; refresh(); };

chips();
refresh();
