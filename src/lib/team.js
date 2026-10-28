// Team libraries: a shared folder (a network drive, OneDrive / SharePoint, Яндекс Диск) that several people connect to
// next to their own library. No server: the folder is the whole thing, and its Windows permissions are the access rights
// (who can only look, who can add).
//
//   <folder>/oddments-team.json      { v: 1, name, created }
//   <folder>/files/<id>/<file>        originals, thumb.webp, preview.png — as in a personal library
//   <folder>/changes/<person>.jsonl   each person's journal: one event per line, only that person writes it
//
// Nobody rewrites a shared index, so two people never overwrite each other: the library is the journals folded
// together in time order. Events: { t, by, op: 'add', item } · { t, by, op: 'set', id, f: { field: value } } ·
// { t, by, op: 'del', id }. A field set later wins. The person's own items stay in index.json; team items live in
// S.teamItems (found by id like any other — the preview and the properties panel just work) and their files are
// «@<team>/files/…» (library.js absPath).
import * as fs from '@tauri-apps/plugin-fs';
import { S, ui } from '../state.js';
import { uid } from '../util.js';
import { absPath, setTeamRoot, setTeamHook, reindex, saveIndex, SEP } from './library.js';
import { readPref, writePref } from './prefs.js';
import { fold, SHARED } from './teamlog.js';
import { setTeamRules } from './brandrules.js';
import { setTeamConf } from './teamconf.js';
export { SHARED };

const PREF = 'perch.teams';
const MANIFEST = 'oddments-team.json';

export const TEAM = { teams: [], status: {} }; // status[id]: { ro, error, people, at }
const snap = new Map(); // item id → JSON of its shared fields as last read or written
const sizes = new Map(); // journal path → size at the last read
let pollT = 0;

const prefs = () => readPref(PREF, { teams: [], me: '' });
const keep = (p) => writePref(PREF, p);
export const me = () => prefs().me;
export const teamById = (id) => TEAM.teams.find((t) => t.id === id) || null;
export const isTeamItem = (it) => !!(it && it.team);
export const canWrite = (id) => !!(TEAM.status[id] && !TEAM.status[id].ro);
const join = (...p) => p.join(SEP);
const slug = (s) => String(s || 'person').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'person';
const shared = (it) => JSON.stringify(SHARED.map((k) => it[k] ?? null));

/* ---------- connecting ---------- */
// a folder → a team: an existing one is read, an empty one becomes a new team with this name
export async function connectTeam(dir, name, person) {
  const p = prefs();
  if (person) p.me = person;
  const man = join(dir, MANIFEST);
  let m = null;
  try { m = JSON.parse(await fs.readTextFile(man)); } catch (e) { m = null; }
  if (!m) {
    m = { v: 1, name: name || 'Команда', created: Date.now() };
    await fs.mkdir(join(dir, 'changes'), { recursive: true });
    await fs.mkdir(join(dir, 'files'), { recursive: true });
    await fs.writeTextFile(man, JSON.stringify(m, null, 1));
  }
  if (p.teams.some((t) => t.dir === dir)) return p.teams.find((t) => t.dir === dir);
  const t = { id: 't' + uid().slice(0, 8), dir, name: m.name };
  p.teams.push(t);
  keep(p);
  TEAM.teams = p.teams; S.teams = p.teams;
  await loadTeam(t);
  return t;
}
export function disconnectTeam(id) {
  const p = prefs();
  p.teams = p.teams.filter((t) => t.id !== id);
  keep(p);
  TEAM.teams = p.teams; S.teams = p.teams;
  S.teamItems = S.teamItems.filter((i) => i.team !== id);
  setTeamRoot(id, null);
  delete TEAM.status[id];
  reindex();
  if (S.view.type === 'team' && S.view.id === id) S.view = { type: 'all', id: null };
  ui.refresh();
}

/* ---------- reading: the journals folded together ---------- */
async function readEvents(t) {
  const dir = join(t.dir, 'changes');
  const list = await fs.readDir(dir);
  const events = [];
  for (const e of list) {
    if (!e.name || !e.name.endsWith('.jsonl')) continue;
    const p = join(dir, e.name);
    let text = '';
    try { text = await fs.readTextFile(p); } catch (err) { continue; } // one unreadable journal does not hide the rest
    sizes.set(p, text.length);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { const ev = JSON.parse(line); if (ev && ev.op && ev.t) events.push(ev); } catch (err) { /* a line cut off mid-write: skipped */ }
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

async function canWriteDir(t) {
  const probe = join(t.dir, 'changes', '.write-test-' + slug(me()));
  try { await fs.writeTextFile(probe, String(Date.now())); await fs.remove(probe); return true; } catch (e) { return false; }
}

export async function loadTeam(t) {
  setTeamRoot(t.id, t.dir);
  try {
    // the team's brand rules (brand.js) travel in its manifest: everyone checks against the same palette
    try {
      const m = JSON.parse(await fs.readTextFile(join(t.dir, MANIFEST)));
      if (m.brand) setTeamRules(m.brand, m.name || t.name);
      if (m.glossary) setTeamConf('glossary', m.glossary, m.name || t.name);
    } catch (e) { /* no manifest change */ }
    const events = await readEvents(t);
    const items = fold(events, t.id);
    for (const it of items) {
      // paths point into the team folder; old local fields never leak in
      for (const k of ['file', 'thumb', 'preview']) if (it[k] && it[k][0] !== '@') it[k] = `@${t.id}/${it[k]}`;
      snap.set(it.id, shared(it));
    }
    S.teamItems = [...S.teamItems.filter((i) => i.team !== t.id), ...items];
    TEAM.status[t.id] = { ro: !(await canWriteDir(t)), error: '', people: new Set(events.map((e) => e.by)).size, at: Date.now() };
  } catch (e) {
    TEAM.status[t.id] = { ro: true, error: (e && e.message) || String(e), people: 0, at: Date.now() };
  }
  reindex();
}

export async function initTeams() {
  const p = prefs();
  TEAM.teams = p.teams; S.teams = p.teams;
  for (const t of p.teams) await loadTeam(t);
  setTeamHook(flushTeam);
  if (p.teams.length) ui.refresh();
  clearInterval(pollT);
  pollT = setInterval(poll, 15000); // others' additions come in by themselves
  window.addEventListener('focus', poll);
}

// a journal grew (someone added or changed something): that team is read again
async function poll() {
  if (document.hidden || !TEAM.teams.length) return;
  let changed = false;
  for (const t of TEAM.teams) {
    try {
      const dir = join(t.dir, 'changes');
      for (const e of await fs.readDir(dir)) {
        if (!e.name || !e.name.endsWith('.jsonl')) continue;
        const p = join(dir, e.name), st = await fs.stat(p);
        if (sizes.get(p) !== st.size) { await loadTeam(t); changed = true; break; }
      }
    } catch (e) { /* the drive is away for a moment: next time */ }
  }
  if (changed) ui.refresh();
}

/* ---------- writing: only one's own journal ---------- */
async function append(t, events) {
  if (!me()) throw new Error('не указано, как вас подписывать');
  const p = join(t.dir, 'changes', slug(me()) + '.jsonl');
  await fs.writeTextFile(p, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { append: true });
  try { sizes.set(p, (await fs.stat(p)).size); } catch (e) { /* the next poll reads it again */ }
}

// called with every save (library.js): what changed in team items' shared fields goes to the journal; on a team one
// may only look at, the change is undone
let warned = false;
function flushTeam() {
  const by = new Map();
  for (const it of S.teamItems) {
    const now = shared(it);
    if (snap.get(it.id) === now) continue;
    if (!canWrite(it.team)) {
      const old = JSON.parse(snap.get(it.id));
      SHARED.forEach((k, i) => { if (old[i] == null) delete it[k]; else it[k] = old[i]; });
      if (!warned) { warned = true; ui.toast && ui.toast('Командная библиотека открыта только для просмотра: изменения не сохраняются', 5000); }
      continue;
    }
    const before = JSON.parse(snap.get(it.id) || '[]'), f = {};
    SHARED.forEach((k, i) => { if (JSON.stringify(it[k] ?? null) !== JSON.stringify(before[i] ?? null)) f[k] = it[k] ?? null; });
    snap.set(it.id, now);
    if (!by.has(it.team)) by.set(it.team, []);
    by.get(it.team).push({ t: Date.now(), by: me(), op: 'set', id: it.id, f });
  }
  for (const [id, events] of by) {
    const t = teamById(id);
    if (t) append(t, events).catch((e) => ui.toast && ui.toast('Не удалось записать в командную папку: ' + ((e && e.message) || e), 6000));
  }
}

// files of one's library → the team: copied into its folder, one «add» per file. Masked bytes (personal data hidden,
// masker.js) go instead of the original where given: masked: id → Uint8Array (PNG)
export async function sendToTeam(teamId, items, { masked = new Map(), onProgress = () => {} } = {}) {
  const t = teamById(teamId);
  if (!t) throw new Error('команда не подключена');
  if (!canWrite(teamId)) throw new Error('в эту командную папку у вас нет права записи');
  const events = [], sent = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i], id = uid(), dir = join(t.dir, 'files', id);
    await fs.mkdir(dir, { recursive: true });
    const m = masked.get(it.id);
    const name = m ? it.file.split('/').pop().replace(/\.[^.]+$/, '') + '.png' : it.file.split('/').pop();
    if (m) await fs.writeFile(join(dir, name), m); else await fs.copyFile(absPath(it.file), join(dir, name));
    const rel = (p) => `files/${id}/${p.split('/').pop()}`;
    let thumb = null, preview = null;
    if (it.thumb) { try { await fs.copyFile(absPath(it.thumb), join(dir, it.thumb.split('/').pop())); thumb = rel(it.thumb); } catch (e) { thumb = null; } }
    if (it.preview && !m) { try { await fs.copyFile(absPath(it.preview), join(dir, it.preview.split('/').pop())); preview = rel(it.preview); } catch (e) { preview = null; } }
    const item = {
      id, name: it.name, ext: m ? 'png' : it.ext, kind: it.kind, size: it.size, w: it.w, h: it.h, ar: it.ar, duration: it.duration, pages: it.pages,
      colors: it.colors, shares: it.shares, palV: it.palV, tags: it.tags, url: it.url || '', scr: it.scr, ocr: m ? '' : it.ocr, ocrV: m ? undefined : it.ocrV,
      file: `files/${id}/${name}`, thumb, preview, masked: !!(m || it.masked), verts: it.verts, tris: it.tris, added: Date.now(), from: it.id,
    };
    events.push({ t: Date.now(), by: me(), op: 'add', item: JSON.parse(JSON.stringify(item)) });
    sent.push(item);
    onProgress(i + 1, items.length);
  }
  await append(t, events);
  await loadTeam(t);
  ui.refresh();
  return sent;
}

// the brand rules → the team's manifest (whoever may write to the folder decides them for everyone)
export async function saveTeamRules(teamId, rules) {
  const m = await saveTeamField(teamId, 'brand', rules);
  setTeamRules(rules, m.name);
}
export async function saveTeamGlossary(teamId, g) {
  const m = await saveTeamField(teamId, 'glossary', g);
  setTeamConf('glossary', g, m.name);
}
async function saveTeamField(teamId, key, value) {
  const t = teamById(teamId);
  if (!t || !canWrite(teamId)) throw new Error('в папку команды нет права записи');
  const p = join(t.dir, MANIFEST), m = JSON.parse(await fs.readTextFile(p));
  m[key] = value;
  await fs.writeTextFile(p, JSON.stringify(m, null, 1));
  return { name: m.name || t.name };
}

// how a person is named in the journal: asked once, kept
export function setMe(name) { const p = prefs(); p.me = name; keep(p); }
// for tests and the settings page
export const teamSummary = (id) => ({ items: S.teamItems.filter((i) => i.team === id && !i.trashed).length, ...(TEAM.status[id] || {}) });
export { saveIndex };
