// «Поделиться ссылкой», the part without files and network (lib/share.js does the upload): what a shared card carries,
// how a link's page is made from the viewer's, the terms, the price, the address. Pure — the unit tests run it in Node.
import { MIME } from '../state.js';

export const TTL_TAG = 'odd-ttl';
export const TERMS = [7, 30, 0]; // days; 0 — until the link is closed
export const PRESETS = {
  yandex: { label: 'Yandex Cloud', endpoint: 'https://storage.yandexcloud.net', region: 'ru-central1', site: (b) => `https://${b}.website.yandexcloud.net`, rubPerGb: 2.376 },
};

// what a shared card says: what the wall, the search and the preview need — no notes, AI descriptions, recognised text,
// personal-data marks, team or history fields (comments only when asked)
export const FIELDS = ['id', 'name', 'ext', 'kind', 'size', 'added', 'w', 'h', 'ar', 'duration', 'pages', 'tags', 'url', 'colors', 'shares', 'palV', 'verts', 'tris', 'splat', 'splats', 'splatFlip', 'splatCycles'];
export const FILE_FIELDS = ['file', 'thumb', 'preview', 'glb'];
export const FOLDER_FIELDS = ['id', 'name', 'parent', 'order', 'flow', 'color', 'icon'];
export const pick = (o, keys) => { const out = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k]; return out; };
const leaf = (p) => String(p).split(/[\\/]/).pop();

// a card as it goes out: its files under files/<id>/ whatever library it came from (a team's too); its collections only
// those that go with it
export function cardOf(it, ids, comments) {
  const card = pick(it, FIELDS);
  card.folders = (it.folders || []).filter((f) => ids.has(f));
  for (const k of FILE_FIELDS) if (typeof it[k] === 'string' && it[k]) card[k] = `files/${it.id}/${leaf(it[k])}`;
  if (comments && Array.isArray(it.notes) && it.notes.length) card.notes = it.notes;
  return card;
}
// the collections that go: the shared one becomes the top, the ones inside keep their place
export function foldersOf(all, rootId) {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) { grew = false; for (const x of all) if (x.parent && ids.has(x.parent) && !ids.has(x.id)) { ids.add(x.id); grew = true; } }
  return { ids, folders: all.filter((x) => ids.has(x.id)).map((x) => ({ ...pick(x, FOLDER_FIELDS), parent: x.id === rootId ? null : x.parent })) };
}
// what goes: source { folder } | { items: [ids], title } over the library's state ({ folders, items, byId }) → the
// title, the files (not in the trash), the collections around them and their ids
export function sliceOf(st, source) {
  if (source.folder) {
    const f = st.folders.find((x) => x.id === source.folder);
    const { ids, folders } = foldersOf(st.folders, source.folder);
    return { title: f ? f.name : 'Подборка', items: st.items.filter((it) => !it.trashed && (it.folders || []).some((x) => ids.has(x))), folders, ids };
  }
  const items = (source.items || []).map((id) => st.byId.get(id)).filter((it) => it && !it.trashed);
  return { title: source.title || (items.length === 1 ? items[0].name : `${items.length} ${filesWord(items.length)}`), items, folders: [], ids: new Set() };
}
const filesWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'файл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'файла' : 'файлов');
// how far a link is behind its collection: cards added, gone or changed since the last upload
export function changesOf(rec, st) {
  const { items, ids } = sliceOf(st, rec.source);
  return diffCount(rec.sig || {}, sigOf(items.map((it) => cardOf(it, ids, rec.comments))));
}
export const expired = (rec) => !!(rec.expires && Date.now() > rec.expires);
// a short fingerprint of what a card says, to tell later whether it changed (FNV-1a)
export function fp(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
export const sigOf = (cards) => Object.fromEntries(cards.map((c) => [c.id, fp(JSON.stringify(c))]));
// how many cards were added, are gone or changed between two fingerprint sets
export function diffCount(was, now) {
  let n = 0;
  for (const [id, s] of Object.entries(now)) if (was[id] !== s) n++;
  for (const id of Object.keys(was || {})) if (!(id in now)) n++;
  return n;
}

// 22 letters and digits from 128 random bits: the address is the key
export function newId() {
  const A = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = 0n;
  for (const b of crypto.getRandomValues(new Uint8Array(16))) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = A[Number(n % 62n)] + s; n /= 62n; }
  return s.padStart(22, '0');
}

export function typeOf(p) {
  const e = (String(p).match(/\.([a-z0-9]+)$/i) || [])[1];
  const x = e ? e.toLowerCase() : '';
  return { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', wasm: 'application/wasm', svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', txt: 'text/plain', woff2: 'font/woff2', hdr: 'image/vnd.radiance' }[x] || MIME[x] || 'application/octet-stream';
}

export const siteOf = (c) => String(c.site || (PRESETS[c.preset] && c.bucket ? PRESETS[c.preset].site(c.bucket) : '')).replace(/\/+$/, '');
export const linkOf = (c, id) => `${siteOf(c)}/s/${id}/`;

export function priceText(bytes, preset) {
  const p = PRESETS[preset];
  if (!p || !p.rubPerGb) return '';
  const rub = (bytes / 1e9) * p.rubPerGb;
  return rub < 1 ? 'меньше 1 ₽ в месяц' : `≈ ${rub < 10 ? rub.toFixed(1).replace('.', ',') : Math.round(rub)} ₽ в месяц`;
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// a link's own page: the viewer's, with its files at app/<version>/ (base), not for search engines, without the install
// manifest, with the link's id
export function linkPage(viewerHtml, version, id, title) {
  const head = `<base href="/app/${version}/"><meta name="robots" content="noindex,nofollow"><meta name="odd-share" content="${id}">`;
  return viewerHtml.replace(/<link[^>]+rel="manifest"[^>]*>\s*/i, '').replace(/<head>/i, '<head>' + head)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escHtml(title)} · Oddments</title>`);
}

// the plain pages of the site: its root and the one for a link that is gone (both languages, nothing loaded from outside)
export function pageHtml(title, ru, en) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(title)}</title>
<style>:root{--bg:#0b0c10;--fg:#eceef3;--mut:#8a90a0;--line:#232733;--acc:#d7ff63}@media (prefers-color-scheme:light){:root{--bg:#f6f5f2;--fg:#15171c;--mut:#5d6270;--line:#e2e0da;--acc:#4b6b00}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:32px 24px;text-align:center}h1{font-size:22px;margin:0 0 10px}p{margin:0 0 8px;color:var(--mut)}
a{display:inline-block;margin-top:18px;padding:10px 18px;border-radius:99px;border:1px solid var(--line);color:var(--fg);text-decoration:none}a:hover{border-color:var(--acc)}</style></head>
<body><main><h1>${escHtml(title)}</h1><p>${escHtml(ru)}</p><p lang="en">${escHtml(en)}</p><a href="https://github.com/peopleskynet-boop/Oddments">Oddments</a></main></body></html>`;
}
