// «Поделиться ссылкой» without network (src/lib/sharecore.js): what a shared card carries and what never leaves, the
// collections around it, change fingerprints, the address, the link's page, the price
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardOf, foldersOf, sliceOf, changesOf, expired, sigOf, diffCount, newId, typeOf, linkOf, linkPage, pageHtml, priceText } from '../../src/lib/sharecore.js';

const item = {
  id: 'a1', name: 'Постер', ext: 'jpg', kind: 'image', size: 1234, added: 1, w: 800, h: 600, ar: 0.75, tags: ['afisha'],
  url: 'https://example.org/p', colors: ['#112233'], folders: ['f1', 'f9'], file: 'files/a1/Постер.jpg', thumb: 'files/a1/thumb.webp',
  preview: null, note: 'личная заметка', notes: [{ t: 'комментарий' }], aiDesc: 'описание ИИ', aiTags: ['кот'], ocr: 'Иванов 4417',
  pii: [{ kind: 'card' }], team: 'mts', fav: true, fresh: true, trashed: false, sha: 'x', phash: 'y',
};

test('a card carries what the viewer shows and nothing private', () => {
  const c = cardOf(item, new Set(['f1']), false);
  assert.deepEqual(Object.keys(c).sort(), ['added', 'ar', 'colors', 'ext', 'file', 'folders', 'h', 'id', 'kind', 'name', 'size', 'tags', 'thumb', 'url', 'w']);
  assert.deepEqual(c.folders, ['f1']);
  assert.equal(c.file, 'files/a1/Постер.jpg');
  for (const k of ['note', 'notes', 'aiDesc', 'aiTags', 'ocr', 'pii', 'team', 'fav', 'fresh', 'sha', 'phash']) assert.ok(!(k in c), k);
  assert.deepEqual(cardOf(item, new Set(), true).notes, [{ t: 'комментарий' }]);
  // a team's file lands under files/<id>/ like any other
  assert.equal(cardOf({ ...item, file: '@mts/files/a1/Постер.jpg' }, new Set(), false).file, 'files/a1/Постер.jpg');
});

test('the shared collection becomes the top, the ones inside it go along, private fields stay', () => {
  const all = [
    { id: 'f1', name: 'Плакаты', parent: 'f0', links: [{ url: 'https://jira' }], cjm: {}, flow: true, order: ['a1'] },
    { id: 'f2', name: 'Внутри', parent: 'f1' }, { id: 'f3', name: 'Ещё глубже', parent: 'f2' }, { id: 'f4', name: 'Сбоку', parent: 'f0' },
  ];
  const { ids, folders } = foldersOf(all, 'f1');
  assert.deepEqual([...ids].sort(), ['f1', 'f2', 'f3']);
  assert.deepEqual(folders[0], { id: 'f1', name: 'Плакаты', parent: null, order: ['a1'], flow: true });
  assert.equal(folders.find((f) => f.id === 'f3').parent, 'f2');
});

test('what goes: a collection with the ones inside it, or the selected files; the trash stays', () => {
  const folders = [{ id: 'f1', name: 'Плакаты', parent: null }, { id: 'f2', name: 'Внутри', parent: 'f1' }, { id: 'f3', name: 'Чужая', parent: null }];
  const items = [{ ...item, id: 'a', folders: ['f1'] }, { ...item, id: 'b', folders: ['f2'] }, { ...item, id: 'c', folders: ['f3'] }, { ...item, id: 'd', folders: ['f1'], trashed: true }];
  const st = { folders, items, byId: new Map(items.map((i) => [i.id, i])) };
  const s = sliceOf(st, { folder: 'f1' });
  assert.equal(s.title, 'Плакаты');
  assert.deepEqual(s.items.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(sliceOf(st, { items: ['a', 'c', 'd'] }).title, '2 файла');
  assert.deepEqual(sliceOf(st, { items: ['a'] }).title, 'Постер');
  assert.deepEqual(sliceOf(st, { items: Array.from({ length: 11 }, () => 'a') }).title, '11 файлов');
  // a link knows when its collection moved on
  const rec = { source: { folder: 'f1' }, sig: sigOf(s.items.map((it) => cardOf(it, s.ids))) };
  assert.equal(changesOf(rec, st), 0);
  items[1].tags = ['новый тег'];
  assert.equal(changesOf(rec, st), 1);
  assert.ok(expired({ expires: Date.now() - 1 }) && !expired({ expires: 0 }));
});

test('fingerprints tell what changed; ids are 22 letters, random', () => {
  const ids = new Set(['f1']);
  const was = sigOf([cardOf(item, ids), cardOf({ ...item, id: 'b2' }, ids)]);
  assert.equal(diffCount(was, was), 0);
  const now = sigOf([cardOf({ ...item, tags: ['new'] }, ids), cardOf({ ...item, id: 'c3' }, ids)]);
  assert.equal(diffCount(was, now), 3); // a1 changed, c3 added, b2 gone
  assert.equal(diffCount(was, sigOf([cardOf({ ...item, note: 'другая заметка' }, ids), cardOf({ ...item, id: 'b2' }, ids)])), 0); // a private field is not a change
  const a = newId(), b = newId();
  assert.match(a, /^[0-9a-zA-Z]{22}$/);
  assert.notEqual(a, b);
});

test('the address, the types, the price', () => {
  assert.equal(linkOf({ preset: 'yandex', bucket: 'odd-x' }, 'ID'), 'https://odd-x.website.yandexcloud.net/s/ID/');
  assert.equal(linkOf({ site: 'https://refs.example.org/', bucket: 'b' }, 'ID'), 'https://refs.example.org/s/ID/');
  assert.equal(typeOf('a/b/index.html'), 'text/html; charset=utf-8');
  assert.equal(typeOf('x.MP4'), 'video/mp4');
  assert.equal(typeOf('x.unknown'), 'application/octet-stream');
  assert.equal(priceText(2e9, 'yandex'), '≈ 4,8 ₽ в месяц');
  assert.equal(priceText(1e8, 'yandex'), 'меньше 1 ₽ в месяц');
  assert.equal(priceText(1e9, 'other'), '');
});

test('the link page: the viewer with its files elsewhere, hidden from search, without the install manifest', () => {
  const viewer = '<!doctype html><html><head><meta charset="utf-8"><title>Oddments Web</title><link rel="manifest" href="./manifest.webmanifest"><script type="module" src="./assets/index-1.js"></script></head><body></body></html>';
  const h = linkPage(viewer, 'v123', 'ID22', 'Плакаты <70-х>');
  assert.match(h, /<head><base href="\/app\/v123\/"><meta name="robots" content="noindex,nofollow"><meta name="odd-share" content="ID22">/);
  assert.ok(!/manifest/.test(h));
  assert.match(h, /<title>Плакаты &lt;70-х&gt; · Oddments<\/title>/);
  assert.match(h, /src="\.\/assets\/index-1\.js"/); // resolved against <base>
  assert.match(pageHtml('Ссылка <нет>', 'а', 'b'), /<h1>Ссылка &lt;нет&gt;<\/h1>/);
});
