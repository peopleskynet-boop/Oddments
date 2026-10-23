// MCP (Model Context Protocol): Oddments' library as tools for Claude (Claude Desktop, Claude Code) and other MCP
// clients. The transport lives in Rust (bridge.rs: POST /mcp on the local receiver, and `Oddments --mcp` over stdio,
// which forwards to it); every JSON-RPC message is handed to the window (event «perch-mcp») and answered here, so the
// tools use the same search (words, AI by meaning), import and views as the app itself.
// handleMcp(text) → the JSON-RPC answer as text, or '' for a notification.
import { S, ui, folderById, descend } from '../state.js';
import { absPath, addFromBlobs, addFromPaths, saveIndex } from './library.js';
import { hayOf, stemsHit } from './filter.js';
import { uid } from '../util.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

const TOOLS = [
  {
    name: 'search_library',
    description: 'Search the Oddments reference library (pictures, videos, 3D models, fonts, PDFs, icons) by words — names, tags, AI tags and descriptions — and, when the local AI is on, by what is in the picture («grey headphones», «a hand holding a phone»). Russian and English both work. Returns the closest files first.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'What to look for. Empty — the newest files.' },
      kind: { type: 'string', enum: ['image', 'gif', 'video', 'audio', 'font', 'pdf', 'psd', 'model', 'material', 'link', 'figma', 'block'], description: 'Only this type of file' },
      collection: { type: 'string', description: 'Only inside this collection (name or id), sub-collections included' },
      limit: { type: 'number', description: 'How many to return, 1–50 (20 by default)' },
    } },
  },
  {
    name: 'get_item',
    description: 'One file of the library: its details (name, type, size, tags, collections, palette, source link, path on disk) and a preview picture, so you can look at it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The id from search_library' } }, required: ['id'] },
  },
  {
    name: 'list_collections',
    description: 'The collections (folders) of the library with their nesting and file counts, and the most used tags.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_selection',
    description: 'The files the person has selected in Oddments right now.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_from_url',
    description: 'Save a picture from the web into the library. A page link works too: its main picture (og:image) is taken.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' },
      collection: { type: 'string', description: 'Put it into this collection (name or id); a new name creates the collection' },
      tags: { type: 'array', items: { type: 'string' } },
    }, required: ['url'] },
  },
  {
    name: 'add_file',
    description: 'Copy a file from this computer into the library (the original stays where it is).',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string', description: 'Absolute path to the file' },
      collection: { type: 'string', description: 'Collection name or id; a new name creates it' },
      tags: { type: 'array', items: { type: 'string' } },
    }, required: ['path'] },
  },
  {
    name: 'open_item',
    description: 'Show a file in the Oddments window (opens its preview).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

const live = () => S.items.filter((i) => !i.trashed);
const folderNames = (it) => (it.folders || []).map((f) => (folderById(f) || {}).name).filter(Boolean);
function summary(it, score) {
  const o = {
    id: it.id, name: it.name, kind: it.kind, ext: it.ext,
    size: it.w && it.h ? `${Math.round(it.w)}×${Math.round(it.h)}` : undefined,
    tags: it.tags, ai_tags: it.aiTags && it.aiTags.length ? it.aiTags : undefined, description: it.aiDesc || undefined,
    collections: folderNames(it), favorite: it.fav || undefined, added: new Date(it.added).toISOString().slice(0, 10),
    source: it.url || undefined, path: absPath(it.file),
  };
  if (score != null) o.match = score;
  return o;
}
function findCollection(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return S.folders.find((f) => f.id === v) || S.folders.find((f) => f.name.toLowerCase() === s) || null;
}
function collectionFor(v) {
  if (!v) return null;
  let f = findCollection(v);
  if (!f) { f = { id: uid(), name: String(v).trim(), parent: null, open: true }; S.folders.push(f); saveIndex(); }
  return f.id;
}
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

async function search({ query = '', kind, collection, limit = 20 }) {
  limit = Math.max(1, Math.min(50, Math.round(+limit || 20)));
  let a = live();
  if (kind) a = a.filter((i) => i.kind === kind);
  if (collection) {
    const f = findCollection(collection);
    if (!f) return fail(`Нет подборки «${collection}». Подборки: ${S.folders.map((x) => x.name).join(', ')}`);
    const ids = descend(f.id);
    a = a.filter((i) => i.folders.some((x) => ids.has(x)));
  }
  const q = String(query).trim().toLowerCase();
  if (!q) return text({ found: a.length, items: a.sort((x, y) => y.added - x.added).slice(0, limit).map((i) => summary(i)) });
  const parts = q.split(/\s+/).filter(Boolean);
  let sem = null;
  try { sem = await (await import('./ai.js')).scoreText(q); } catch (e) { /* no AI */ }
  const hits = [];
  for (const i of a) {
    const words = parts.every((p) => hayOf(i).includes(p)) || (i.aiDesc && stemsHit(parts, (i.aiDesc + ' ' + (i.aiTags || []).join(' ')).toLowerCase()));
    const s = sem ? sem.scores.get(i.id) : undefined;
    const meant = sem && s != null && s >= sem.min;
    if (words || meant) hits.push({ i, rank: (words ? 1 : 0) + (s ?? 0), score: s != null ? Math.round(s * 1000) / 1000 : undefined, by: words && meant ? 'words+meaning' : words ? 'words' : 'meaning' });
  }
  hits.sort((x, y) => y.rank - x.rank || y.i.added - x.i.added);
  return text({
    found: hits.length,
    ai: sem ? 'on (search by meaning included)' : 'off (words only; turn on AI search in Oddments settings to search by what is in the pictures)',
    items: hits.slice(0, limit).map((h) => ({ ...summary(h.i), matched_by: h.by })),
  });
}

async function getItem({ id }) {
  const it = S.byId.get(id);
  if (!it) return fail('Нет файла с таким id');
  const o = summary(it);
  o.palette = (it.colors || []).slice(0, 6);
  if (it.note) o.note = it.note;
  const content = [{ type: 'text', text: JSON.stringify(o, null, 1) }];
  const rel = it.thumb || (it.kind === 'image' && /^(png|jpe?g|webp|gif)$/.test(it.ext) ? it.file : null);
  if (rel) {
    try {
      const fs = await import('@tauri-apps/plugin-fs');
      const bytes = await fs.readFile(absPath(rel));
      if (bytes.length < 4 * 1024 * 1024) {
        let bin = '';
        for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
        const ext = rel.split('.').pop().toLowerCase();
        content.push({ type: 'image', data: btoa(bin), mimeType: ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg' });
      }
    } catch (e) { /* details only */ }
  }
  return { content };
}

function collections() {
  const count = new Map();
  for (const i of live()) for (const f of i.folders) count.set(f, (count.get(f) || 0) + 1);
  const tags = new Map();
  for (const i of live()) for (const t of i.tags) tags.set(t, (tags.get(t) || 0) + 1);
  return text({
    collections: S.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent ? (folderById(f.parent) || {}).name : undefined, files: count.get(f.id) || 0, flow: f.flow || undefined })),
    top_tags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t, n]) => `${t} (${n})`),
    files: live().length,
  });
}

async function addUrl({ url, collection, tags }) {
  if (!/^https?:\/\//i.test(url || '')) return fail('Нужна ссылка http(s)');
  const { fetchImage } = await import('./clipboard.js');
  let e;
  try { e = await fetchImage(url); } catch (err) { return fail('Не удалось скачать: ' + (err.message || err)); }
  const added = await addFromBlobs([e], { folder: collectionFor(collection), tags: tags || [] });
  ui.refresh();
  return text({ added: added.map((i) => summary(i)) });
}

async function addFile({ path, collection, tags }) {
  if (!inApp()) return fail('Добавление файлов с диска работает в приложении Oddments');
  const { invoke } = await import('@tauri-apps/api/core');
  const ok = await invoke('allow_dropped', { paths: [path] }).catch(() => []);
  if (!ok.length) return fail('Файл не найден или это папка: ' + path);
  const added = await addFromPaths(ok, { folder: collectionFor(collection), tags: tags || [] });
  ui.refresh();
  return text({ added: (added || []).map((i) => summary(i)) });
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'search_library': return search(args);
    case 'get_item': return getItem(args);
    case 'list_collections': return collections();
    case 'get_selection': return text({ items: [...S.sel].map((id) => S.byId.get(id)).filter(Boolean).map((i) => summary(i)) });
    case 'add_from_url': return addUrl(args);
    case 'add_file': return addFile(args);
    case 'open_item': {
      if (!S.byId.get(args.id)) return fail('Нет файла с таким id');
      (await import('../ui/preview.js')).openPreview(args.id);
      return text('Открыто в Oddments');
    }
    default: return null;
  }
}

async function one(msg) {
  const { id, method, params = {} } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid Request');
  if (id === undefined) return null; // a notification (initialized, cancelled…): nothing to answer
  try {
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'oddments', title: 'Oddments', version: '1.0.0' },
          instructions: 'Oddments is the person\'s visual reference library. Use search_library to find references (words or what is in the picture), get_item to look at one, add_from_url / add_file to save new ones into a collection.',
        });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        const r = await callTool(params.name, params.arguments || {});
        return r ? ok(r) : err(-32602, 'Unknown tool: ' + params.name);
      }
      case 'resources/list': return ok({ resources: [] });
      case 'prompts/list': return ok({ prompts: [] });
      default: return err(-32601, 'Method not found: ' + method);
    }
  } catch (e) {
    return ok(fail('Ошибка Oddments: ' + (e && e.message ? e.message : e)));
  }
}

export async function handleMcp(body) {
  let msg;
  try { msg = JSON.parse(body); } catch (e) { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(one))).filter(Boolean);
    return out.length ? JSON.stringify(out) : '';
  }
  const r = await one(msg);
  return r ? JSON.stringify(r) : '';
}

// the window side of the transport: Rust emits «perch-mcp» {id, body} and waits for mcp_reply(id, body)
export async function initMcp() {
  if (typeof window !== 'undefined') window.__oddmentsMcp = handleMcp; // for the browser build and tests
  if (!inApp()) return;
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  await listen('perch-mcp', async (e) => {
    const { id, body } = e.payload || {};
    let out = '';
    try { out = await handleMcp(body); } catch (err) { out = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: String(err) } }); }
    invoke('mcp_reply', { id, body: out }).catch(() => {});
  });
}
