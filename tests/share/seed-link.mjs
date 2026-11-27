// A shared link made by hand, to look at the viewer without the app (CLAUDE.md, 17.11.2026): the files given go up to
// the stand-in storage (tests/share/fakes3.mjs) as a link's library, with the viewer from dist/viewer (npm run build:viewer).
//   node tests/share/seed-link.mjs <api> <site> <file>[=<thumb.webp>] …   → prints the link
// A file's size and picture size come from ffprobe when it is there.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { s3Client } from '../../src/lib/s3.js';
import { linkPage, newId, typeOf } from '../../src/lib/sharecore.js';

const [api, site, ...args] = process.argv.slice(2);
const s3 = s3Client({ endpoint: api, region: 'ru-central1', bucket: 'odd-test', accessKey: 'K', secretKey: 'S', fetch });
const KIND = { mp4: 'video', webm: 'video', mov: 'video', gif: 'gif', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', pdf: 'pdf' };
const probe = (f) => {
  try {
    const [w, h, d] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0', f]).toString().split(/[\s,]+/).filter(Boolean).map(Number);
    return { w, h, duration: d || 0 };
  } catch (e) { return { w: 0, h: 0, duration: 0 }; }
};

await s3.createBucket();
await s3.putWebsite('index.html', '404.html');
const viewer = JSON.parse(fs.readFileSync('dist/viewer/files.json', 'utf8'));
for (const f of viewer.files) await s3.put(`app/${viewer.version}/${f}`, fs.readFileSync(path.join('dist/viewer', f)), { type: typeOf(f), acl: 'public-read' });
await s3.put('404.html', '<!doctype html><h1>Ссылка больше не работает</h1>', { type: 'text/html; charset=utf-8', acl: 'public-read' });

const id = newId(), pre = `s/${id}/`, o = (k) => ({ type: typeOf(k), acl: 'public-read', tags: { 'odd-ttl': '30' } });
const items = [];
for (const [i, a] of args.entries()) {
  const [file, thumb] = a.split('=');
  const name = path.basename(file), ext = path.extname(file).slice(1).toLowerCase(), iid = 'i' + i;
  const p = probe(file);
  const it = { id: iid, name: name.replace(/\.[^.]+$/, ''), ext, kind: KIND[ext] || 'other', size: fs.statSync(file).size, added: Date.now() - i * 6e4,
    w: p.w, h: p.h, ar: p.w ? p.h / p.w : 0.75, duration: p.duration, tags: ['тест', ext], colors: ['#d7ff63', '#1d2536'], folders: ['f1'], file: `files/${iid}/${name}` };
  await s3.put(pre + 'lib/' + it.file, fs.readFileSync(file), o(name));
  if (thumb) { it.thumb = `files/${iid}/thumb.webp`; await s3.put(pre + 'lib/' + it.thumb, fs.readFileSync(thumb), o('thumb.webp')); }
  items.push(it);
}
await s3.put(pre + 'lib/index.json', JSON.stringify({ version: 1, folders: [{ id: 'f1', name: 'Тестовая подборка', parent: null }], items }), o('index.json'));
await s3.put(pre + 'share.json', JSON.stringify({ v: 1, title: 'Тестовая подборка', note: 'Референсы для проверки ссылки', count: items.length, updated: Date.now(), term: 30 }), o('share.json'));
await s3.put(pre + 'index.html', linkPage(fs.readFileSync('dist/viewer/index.html', 'utf8'), viewer.version, id, 'Тестовая подборка'), o('index.html'));
console.log(`${site}/s/${id}/`);
