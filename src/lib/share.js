// «Поделиться ссылкой» (CLAUDE.md, 17.11.2026): a collection (with the ones inside it) or the selected files go up to the
// person's own S3 storage as a small library of their own — s/<id>/lib/index.json + files/ — next to Oddments Web in view
// mode (the viewer: the lite build, put into the app under /viewer/ and uploaded once per version to app/<version>/), so
// the link opens on any device without Oddments. A snapshot: «Обновить» sends what changed and starts the term over;
// «Закрыть ссылку» removes it at once; what outlives its term the storage removes by itself (lifecycle rules on the tag
// odd-ttl). Nothing leaves without the person's click. The keys stay in this computer's settings, never in a message.
// What a card carries, the pages and the address: lib/sharecore.js.
import * as fs from '@tauri-apps/plugin-fs';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { S } from '../state.js';
import { readPref, writePref } from './prefs.js';
import { absPath } from './library.js';
import { s3Client, S3Error } from './s3.js';
import { TTL_TAG, TERMS, PRESETS, FILE_FIELDS, cardOf, sliceOf, sigOf, changesOf as behind, expired, newId, typeOf, siteOf, linkOf, priceText, linkPage, pageHtml } from './sharecore.js';

export { TERMS, PRESETS, siteOf, expired };
const CFG = 'perch.shareCfg', LIST = 'perch.shares';
const PART = 16 * 1024 * 1024, BIG = 64 * 1024 * 1024; // files over BIG go up in PART pieces
const CFG_DEFAULTS = { preset: 'yandex', endpoint: PRESETS.yandex.endpoint, region: PRESETS.yandex.region, bucket: '', site: '', accessKey: '', secretKey: '', ready: 0, viewer: '' };

export const shareCfg = () => readPref(CFG, CFG_DEFAULTS);
export function saveCfg(c) {
  const cur = shareCfg(), next = { ...cur, ...c };
  // another bucket or key: the set-up and the uploaded viewer belong to the old one
  if (next.bucket !== cur.bucket || next.endpoint !== cur.endpoint || next.accessKey !== cur.accessKey) { next.ready = 0; next.viewer = ''; }
  writePref(CFG, next);
  return next;
}
export const hasKeys = (c = shareCfg()) => !!(c.endpoint && c.region && c.bucket && c.accessKey && c.secretKey);
export const configured = (c = shareCfg()) => hasKeys(c) && !!c.ready;
const client = (c) => s3Client({ ...c, fetch: httpFetch });

export const listShares = () => readPref(LIST, {});
const saveList = (l) => writePref(LIST, l);
export const shareUrl = (rec) => linkOf(shareCfg(), rec.id);
export const shareOfFolder = (fid) => Object.values(listShares()).find((r) => r.source && r.source.folder === fid) || null;
export const price = (bytes) => priceText(bytes, shareCfg().preset);

// what a failure means for the person: the cause and what to do (no keys in it)
export function explain(e) {
  if (e && e.name === 'AbortError') return '';
  if (e instanceof S3Error) {
    if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AccessDenied', 'InvalidToken'].includes(e.code)) return 'хранилище не приняло ключ. Проверьте ключ и роль storage.admin в «Настройки › Ссылки»';
    if (e.code === 'NoSuchBucket') return 'бакета нет. Нажмите «Подготовить хранилище» в «Настройки › Ссылки»';
    if (e.code === 'BucketAlreadyExists') return 'имя бакета уже занято кем-то другим. Впишите другое имя';
    if (e.status === 403) return 'хранилище не приняло ключ. Проверьте ключ и роль storage.admin в «Настройки › Ссылки»';
    return 'хранилище ответило ' + e.message;
  }
  return ((e && e.message) || String(e)) + '. Проверьте сеть и VPN';
}

// «Проверить» of the key: a signed request to the bucket (an empty listing) — what it says, or the error
export async function checkStorage() {
  try { await client(shareCfg()).list('s/~check/'); return 'работает'; }
  catch (e) { if (e instanceof S3Error && e.code === 'NoSuchBucket') return 'ключ принят, бакета ещё нет'; throw e; }
}

/* ---------- the storage once: the bucket, the site, the terms, the pages around the links ---------- */
export async function prepareStorage(onStep = () => {}) {
  const c = shareCfg();
  if (!hasKeys(c)) throw new Error('Впишите бакет и ключ');
  const s3 = client(c);
  onStep('Бакет'); await s3.createBucket();
  onStep('Сайт'); await s3.putWebsite('index.html', '404.html');
  onStep('Сроки'); await s3.putLifecycle(TERMS.filter(Boolean).map((d) => ({ id: `odd-${d}d`, tag: [TTL_TAG, String(d)], days: d })));
  onStep('Страницы');
  const page = { acl: 'public-read', cache: 'max-age=300', type: 'text/html; charset=utf-8' };
  await s3.put('index.html', pageHtml('Oddments', 'Здесь лежат подборки, которыми поделились из Oddments.', 'Collections shared from Oddments live here.'), page);
  await s3.put('404.html', pageHtml('Ссылка больше не работает', 'Её закрыли или вышел её срок. Попросите прислать новую.', 'This link no longer works: it was closed or its time ran out.'), page);
  await s3.put('robots.txt', 'User-agent: *\nDisallow: /\n', { ...page, type: 'text/plain' });
  saveCfg({ ready: Date.now() });
}

/* ---------- the viewer: Oddments Web in view mode, built into the app (vite.config.js, /viewer/files.json) ---------- */
const viewerUrl = (p) => new URL('/viewer/' + p, location.href).href;
async function viewerInfo() {
  const r = await fetch(viewerUrl('files.json')).catch(() => null);
  if (!r || !r.ok) throw new Error('В этой сборке Oddments нет смотрелки для ссылок (npm run build:viewer)');
  return r.json(); // { version, files: [...] }
}
async function ensureViewer(s3, info, onProgress) {
  if (shareCfg().viewer === info.version && (await s3.head(`app/${info.version}/index.html`))) return;
  let i = 0;
  for (const f of info.files) {
    const r = await fetch(viewerUrl(f));
    if (!r.ok) throw new Error('Смотрелка не читается: ' + f);
    await s3.put(`app/${info.version}/${f}`, new Uint8Array(await r.arrayBuffer()), { type: typeOf(f), acl: 'public-read', cache: /\.html$|sw\.js$|\.webmanifest$|files\.json$/.test(f) ? 'max-age=300' : 'max-age=31536000, immutable' });
    onProgress(++i, info.files.length);
  }
  saveCfg({ viewer: info.version });
}

/* ---------- the snapshot ---------- */
export const itemsOf = (source) => sliceOf(S, source);

// before the dialog: how many, how big, what to warn about
export function survey(source) {
  const { title, items } = itemsOf(source);
  const bytes = items.reduce((a, it) => a + (it.size || 0) + 60000, 0); // + the card's picture
  return { title, count: items.length, bytes, pii: items.filter((i) => i.pii && i.pii.length && !i.masked), team: [...new Set(items.filter((i) => i.team).map((i) => i.team))] };
}

export const changesOf = (rec) => behind(rec, S);

/* ---------- the upload ---------- */
// a file of the library, up in one go or in pieces
async function putFile(s3, key, local, size, o, onBytes, signal) {
  if (size <= BIG) { await s3.put(key, await fs.readFile(local), o); onBytes(size); return; }
  const fh = await fs.open(local, { read: true });
  const uploadId = await s3.startParts(key, o);
  const etags = [];
  try {
    for (let off = 0; off < size; off += PART) {
      if (signal && signal.aborted) throw abortError();
      const buf = new Uint8Array(Math.min(PART, size - off));
      let got = 0;
      while (got < buf.length) { const n = await fh.read(buf.subarray(got)); if (!n) break; got += n; }
      etags.push(await s3.putPart(key, uploadId, etags.length + 1, got === buf.length ? buf : buf.subarray(0, got)));
      onBytes(got);
    }
    await s3.endParts(key, uploadId, etags);
  } catch (e) { await s3.abortParts(key, uploadId).catch(() => {}); throw e; } finally { await fh.close().catch(() => {}); }
}
const abortError = () => { const e = new Error('Отменено'); e.name = 'AbortError'; return e; };

// a picture's card for the hidden-data copy (the library's own card would show the data)
async function cardPicture(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  return new Uint8Array(await (await cv.convertToBlob({ type: 'image/webp', quality: 0.85 })).arrayBuffer());
}

// opts: { source, term, note, comments, hide, id (to update) }; onProgress({ label, done, total }) → the record
export async function publish(opts, onProgress = () => {}, signal = null) {
  const c = shareCfg();
  if (!configured(c)) throw new Error('Хранилище не настроено: «Настройки › Ссылки»');
  const s3 = client(c);
  const old = opts.id ? listShares()[opts.id] : null;
  const id = old ? old.id : newId(), prefix = `s/${id}/`;
  const { title, items, folders, ids } = itemsOf(opts.source);
  if (!items.length) throw new Error('В подборке нет файлов');
  const say = (label, done = 0, total = 0) => onProgress({ label, done, total });

  // the files: the library's own, or a hidden-data copy and its card picture in their place
  say('Готовлю файлы');
  const masked = opts.hide ? await (await import('./exporter.js')).maskedFiles(items.filter((i) => i.pii && i.pii.length && !i.masked), (d, t) => say(`Скрываю личные данные · ${d} из ${t}`)) : new Map();
  const cards = [], files = [];
  for (const it of items) {
    const card = cardOf(it, ids, opts.comments);
    const m = masked.get(it.id);
    if (m) {
      Object.assign(card, { file: `files/${it.id}/${String(it.name).replace(/[\\/:*?"<>|]/g, '_')}.png`, ext: 'png', kind: 'image', size: m.length, thumb: `files/${it.id}/thumb.webp` });
      delete card.preview;
      const pic = await cardPicture(m);
      files.push({ key: prefix + 'lib/' + card.file, bytes: m, size: m.length }, { key: prefix + 'lib/' + card.thumb, bytes: pic, size: pic.length });
    } else {
      for (const k of FILE_FIELDS) if (card[k]) {
        const local = absPath(it[k]);
        const st = await fs.stat(local).catch(() => null);
        if (st) files.push({ key: prefix + 'lib/' + card[k], local, size: st.size }); else delete card[k];
      }
    }
    cards.push(card);
  }

  // the viewer first (once per version), then what changed, then the pages that make the link work
  const info = await viewerInfo();
  await ensureViewer(s3, info, (d, t) => say(`Смотрелка · ${d} из ${t}`));
  const term = TERMS.includes(+opts.term) ? +opts.term : 30;
  const o = (key) => ({ type: typeOf(key), acl: 'public-read', tags: term ? { [TTL_TAG]: String(term) } : null, cache: /\.(json|html)$/.test(key) ? 'max-age=60' : 'max-age=3600' });
  const remote = old ? new Map((await s3.list(prefix)).map((x) => [x.key, x.size])) : new Map();
  const send = files.filter((f) => f.bytes || remote.get(f.key) !== f.size);
  const keep = files.filter((f) => !send.includes(f));
  const total = send.reduce((a, f) => a + f.size, 0) || 1;
  const sent = [];
  let done = 0;
  try {
    let next = 0;
    const worker = async () => {
      while (next < send.length) {
        if (signal && signal.aborted) throw abortError();
        const f = send[next++];
        if (f.bytes) { await s3.put(f.key, f.bytes, o(f.key)); done += f.size; } else await putFile(s3, f.key, f.local, f.size, o(f.key), (n) => { done += n; say('Выгружаю', done, total); }, signal);
        sent.push(f.key);
        say('Выгружаю', done, total);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // what stays as it was is written again in place: its term starts over
    for (let i = 0; i < keep.length; i++) {
      if (signal && signal.aborted) throw abortError();
      await s3.copySelf(keep[i].key, o(keep[i].key));
      say(`Продлеваю срок · ${i + 1} из ${keep.length}`, i + 1, keep.length);
    }
    const bytes = files.reduce((a, f) => a + f.size, 0);
    const note = String(opts.note || '').slice(0, 280);
    await s3.put(prefix + 'lib/index.json', JSON.stringify({ version: 1, folders, items: cards }), o('index.json'));
    await s3.put(prefix + 'share.json', JSON.stringify({ v: 1, title, note, count: cards.length, bytes, updated: Date.now(), term }), o('share.json'));
    await s3.put(prefix + 'index.html', linkPage(await (await fetch(viewerUrl('index.html'))).text(), info.version, id, title), o('index.html'));
    // what the collection no longer has goes away
    const live = new Set([...files.map((f) => f.key), prefix + 'lib/index.json', prefix + 'share.json', prefix + 'index.html']);
    const gone = [...remote.keys()].filter((k) => !live.has(k));
    if (gone.length) await s3.delMany(gone);
    const now = Date.now();
    const rec = { id, title, source: opts.source, term, note, comments: !!opts.comments, hide: !!opts.hide,
      created: old ? old.created : now, updated: now, expires: term ? now + term * 864e5 : 0, count: cards.length, bytes, sig: sigOf(cards) };
    saveList({ ...listShares(), [id]: rec });
    return rec;
  } catch (e) {
    if (!old && sent.length) await s3.delMany(sent).catch(() => {}); // a new link half up: nothing of it is left
    throw e;
  }
}

export async function closeShare(id) {
  if (!listShares()[id]) return;
  const s3 = client(shareCfg());
  const keys = (await s3.list(`s/${id}/`)).map((x) => x.key);
  if (keys.length) await s3.delMany(keys);
  forgetShare(id);
}
// a link the storage already removed (its term ran out): only the record goes
export function forgetShare(id) { const l = listShares(); delete l[id]; saveList(l); }
