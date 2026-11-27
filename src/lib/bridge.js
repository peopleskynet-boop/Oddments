// Frontend side of the local receiver (src-tauri/src/bridge.rs): files sent by the Blender add-on, the Figma
// plugin or the browser extension arrive in the inbox and are imported like any other file; the current selection
// is mirrored to Rust so the Blender add-on can "insert from Oddments".
import { invoke } from '@tauri-apps/api/core';
import * as fs from '@tauri-apps/plugin-fs';
import { S } from '../state.js';
import { absPath, getRoot } from './library.js';
import { uid } from '../util.js';
import { boardMeta, boardFolder as folderOf } from './importfmt.js';
import { lang } from './i18n.js';

const known = (src) => !!src && S.items.some((i) => i.src === src);

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

export async function integrationInfo() {
  if (!inApp()) return null;
  try { const [port, token, running] = await invoke('integration_info'); return { port, token, running }; } catch (e) { return null; }
}

// importPaths(paths, ctx, meta) is the app's own import (with the "where to put it" pill)
// importLink(url, ctx) takes a link the extension sent as a .url (a Pinterest pin → its video or picture);
// it returns null for links that stay link cards
export async function initBridge(importPaths, importLink) {
  if (!inApp()) return;
  const { listen } = await import('@tauri-apps/api/event');
  // Files that arrive together (the browser extension's «save all», a batch from Figma) are imported in one
  // go, so they share one «where to put it» pill. The extension names its folder and tags; others follow the view.
  let batch = new Map(), timer = null;
  const flush = async () => {
    const groups = batch; batch = new Map(); timer = null;
    for (const g of groups.values()) {
      const rest = [];
      // a board's files are plain files: no article, splat or pin-link handling (a pin link would be fetched again)
      for (const p of g.board ? [] : g.paths) {
        let done = null;
        // an article from the browser extension («Сохранить статью в Oddments»): to «Новости», not to the library
        if (/\.perch-article\.html$/i.test(p)) {
          try { const html = await fs.readTextFile(p); done = await (await import('../ui/news.js')).saveFromBrowser(html, g.ctx.url || ''); } catch (e) { done = null; }
          if (!done) { fs.remove(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {}); continue; }
        }
        // «Сплат (Cycles)» from the Blender add-on: renders + cameras + geometry → a splat in the library, not the zip
        if (/\.oddsplatviews$/i.test(p)) {
          done = !!(await (await import('./splatviews.js')).splatFromViews(p, g.ctx));
          fs.remove(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
          continue;
        }
        if (importLink && !done && /\.url$/i.test(p)) {
          try {
            const url = ((await fs.readTextFile(p)).match(/^URL=(.+)$/m) || [])[1];
            if (url) done = await importLink(url.trim(), g.ctx);
          } catch (e) { done = null; }
        }
        if (done) fs.remove(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
        else rest.push(p);
      }
      if (!g.board) g.paths = rest;
      if (!g.paths.length) continue;
      // a board import: the collections are made now (not when the first file only arrived), each file keeps its id
      if (g.board) {
        g.paths = g.paths.filter((p) => {
          const m = g.metas.get(p);
          if (m && known(m.src)) { fs.remove(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {}); return false; }
          return true;
        });
        if (!g.paths.length) continue;
        g.ctx.folder = folderOf(g.board, S.folders, uid);
        g.ctx.meta = (p) => { const m = g.metas.get(p); return m ? { url: m.url, ...(m.src ? { src: m.src } : {}), ...(m.note ? { note: m.note } : {}) } : {}; };
      }
      try { await importPaths(g.paths, g.ctx); }
      finally {
        // the copies now live in the library; drop the inbox folders they came in
        for (const p of g.paths) fs.remove(p.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {});
      }
    }
  };
  await listen('perch-import', (e) => {
    let p;
    try { p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload; } catch (er) { return; }
    if (!p || !p.path) return;
    let ctx;
    const board = boardMeta(p.folder);
    if (board) {
      // the source link differs file by file: the batch keeps them per path, like the board's ids and notes
      ctx = { folder: null, tags: (p.tags || '').split('\n').map((t) => t.trim()).filter(Boolean) };
    } else if ('folder' in p || 'tags' in p) {
      const folder = p.folder && S.folders.some((f) => f.id === p.folder) ? p.folder : null;
      ctx = { folder, tags: (p.tags || '').split('\n').map((t) => t.trim()).filter(Boolean), url: p.source || '' };
    } else {
      const v = S.view;
      ctx = v.type === 'folder' ? { folder: v.id } : v.type === 'tag' ? { tag: v.id } : {};
      if (p.source) ctx.url = p.source;
    }
    const key = JSON.stringify([board ? board.path.map((x) => x[0]) : ctx.folder || ctx.tag || '', ctx.tags || []]);
    if (!batch.has(key)) batch.set(key, { ctx, paths: [], ...(board ? { board: board.path, metas: new Map() } : {}) });
    const g = batch.get(key);
    g.paths.push(p.path);
    if (board) g.metas.set(p.path, { src: board.src, note: board.note, url: p.source || '' });
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  });
}

// Folders and tags for the browser extension's picker (GET /library), and the files for the Figma plugin's library
// (GET /items, GET /file): pushed a second after the library changes, and only when something did change.
let lastCatalog = '', lastItems = '', catT = null;
export function pushCatalog() {
  if (!inApp()) return;
  clearTimeout(catT);
  catT = setTimeout(() => {
    const count = new Map();
    for (const it of S.items) if (!it.trashed) for (const t of it.tags || []) count.set(t, (count.get(t) || 0) + 1);
    const tags = [...count].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([t]) => t);
    const folders = S.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent || null, ...(f.flow ? { flow: true, order: f.order || [], ...(f.cjm ? { cjm: f.cjm } : {}) } : {}) }));
    // lang: the extension speaks the app's language (1.7); boards: what the extension already brought in, trash too
    // (a second «Забрать доску целиком» skips them, and something deleted on purpose does not come back)
    const boards = S.items.filter((it) => it.src).map((it) => it.src);
    const json = JSON.stringify({ folders, tags, lang, boards });
    const items = JSON.stringify(S.items.filter((it) => !it.trashed).map((it) => ({
      id: it.id, name: it.name, kind: it.kind, ext: it.ext, w: Math.round(it.w || 0), h: Math.round(it.h || 0),
      tags: it.tags, ai: it.aiTags || [], folders: it.folders, fav: !!it.fav, added: it.added,
      colors: (it.colors || []).slice(0, 5), thumb: it.thumb || '', file: it.file, url: it.url || '', ...(it.flowT != null ? { flowT: it.flowT } : {}), ...(it.notes && it.notes.length ? { notes: it.notes } : {}),
    })));
    if (json === lastCatalog && items === lastItems) return;
    lastCatalog = json; lastItems = items;
    invoke('set_catalog', { json, items, root: getRoot() }).catch(() => {});
  }, 1000);
}

// «В Blender»: the add-on (1.2+, «Принимать из Oddments») polls /outbox and imports what arrives.
// Resolves to 'sent' (Blender is listening), 'queued' (no add-on polled lately) or 'web' (no app).
export async function sendToBlender(paths) {
  if (!inApp()) return 'web';
  try { return (await invoke('send_to_blender', { paths })) ? 'sent' : 'queued'; } catch (e) { return 'queued'; }
}

let pushTimer = null;
export function pushSelection() {
  if (!inApp()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const paths = Array.from(S.sel).map((id) => S.byId.get(id)).filter(Boolean).map((it) => absPath(it.file));
    invoke('set_selection', { paths }).catch(() => {});
  }, 150);
}
