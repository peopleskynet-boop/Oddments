// The crash report, kept on this computer only. Errors of the window (window.onerror, an unhandled promise, a
// console.error of the app) go to <app data>/logs/errors.log; a panic on the Rust side goes to logs/crash.log (lib.rs).
// Settings › О программе › «Отчёт о сбоях» puts both together with the version and the system — «Скопировать отчёт»
// is the only way it leaves, by the person's hand. Nothing is sent anywhere.
// What could name the person is taken out of the report: the home folder becomes ~, the library folder <library>.
import * as fs from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { readPref, writePref } from './prefs.js';

const MAX_FILE = 512 * 1024, MAX_PER_RUN = 200;
let dir = '', queue = Promise.resolve(), written = 0, last = '', repeat = 0;

async function logsDir() {
  if (!dir) dir = await join(await appLocalDataDir(), 'logs');
  return dir;
}
// local time, as on the computer's clock
const stamp = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().replace('T', ' ').slice(0, 19); };
const text = (e) => (e && (e.stack || e.message)) || String(e);

// one line (and its stack) at the end of errors.log, in English whatever the interface (whoever fixes it reads it);
// the same message again only counts
export function logError(kind, err) {
  const msg = `${kind}: ${text(err)}`.slice(0, 4000);
  if (msg === last) { repeat++; return; }
  if (written >= MAX_PER_RUN) return;
  const again = repeat ? `  (repeated ${repeat} more times)\n` : '';
  last = msg; repeat = 0; written++;
  queue = queue.then(async () => {
    const p = await join(await logsDir(), 'errors.log');
    await fs.writeTextFile(p, `${again}[${stamp()}] ${msg}\n`, { append: true });
  }).catch(() => { /* a full or read-only disk: the report is a help, never a new error */ });
}

// at start: the folder, a file that grew too big set aside, and the listeners. Returns whether the Rust side wrote a
// crash since the person last looked (the start then says so once).
export async function initCrashLog() {
  window.addEventListener('error', (e) => logError('error', e.error || `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => { if (!e.reason || e.reason.name !== 'AbortError') logError('promise', e.reason); });
  const ce = console.error.bind(console);
  console.error = (...a) => { ce(...a); logError('console.error', a.map((x) => (x instanceof Error ? text(x) : typeof x === 'string' ? x : safeJson(x))).join(' ')); };
  try {
    const d = await logsDir();
    await fs.mkdir(d, { recursive: true });
    for (const n of ['errors', 'crash']) {
      const p = await join(d, n + '.log');
      const st = await fs.stat(p).catch(() => null);
      if (st && st.size > MAX_FILE) await fs.rename(p, await join(d, n + '.old.log')).catch(() => {});
    }
    const st = await fs.stat(await join(d, 'crash.log')).catch(() => null);
    const t = st && st.mtime ? +new Date(st.mtime) : 0;
    const seen = readPref('perch.crashSeen', 0);
    if (t && t > seen) { writePref('perch.crashSeen', t); return seen > 0 || t > Date.now() - 7 * 864e5; }
  } catch (e) { /* no data folder yet */ }
  return false;
}

const safeJson = (x) => { try { return JSON.stringify(x).slice(0, 500); } catch (e) { return String(x); } };

async function tail(name, lines) {
  try { return (await fs.readTextFile(await join(await logsDir(), name))).trimEnd().split('\n').slice(-lines).join('\n'); } catch (e) { return ''; }
}

export async function logStats() {
  const [a, b] = await Promise.all([tail('errors.log', 100000), tail('crash.log', 100000)]);
  const count = (s, re) => (s.match(re) || []).length;
  return { errors: count(a, /^\[\d{4}-/gm), crashes: count(b, /^--- panic/gm) };
}

function system() {
  const ua = navigator.userAgent;
  const os = /Windows NT 10\.0/.test(ua) ? 'Windows 10 / 11' : (ua.match(/Mac OS X [\d_]+/) || [''])[0].replace(/_/g, '.') || navigator.platform;
  const web = (ua.match(/Edg\/[\d.]+/) || ua.match(/Chrome\/[\d.]+/) || ua.match(/AppleWebKit\/[\d.]+/) || [''])[0];
  return `${os} · ${web} · ${navigator.language} · ${screen.width}×${screen.height} @${devicePixelRatio}`;
}

// the report as text: what it is, where it runs, and the last errors; personal paths taken out. In English whatever the
// interface, like the log lines: it is for whoever fixes the bug
export async function buildReport({ version = '', items = 0, root = '', extra = [] } = {}) {
  const [errs, crash] = await Promise.all([tail('errors.log', 120), tail('crash.log', 80)]);
  let home = '';
  try { const p = await import('@tauri-apps/api/path'); if (p.homeDir) home = await p.homeDir(); } catch (e) { /* the browser build */ }
  const out = [
    `Oddments ${version || '(version unknown)'} — crash report, ${stamp()}`,
    `System: ${system()}`,
    `Library: ${items} files`,
    ...extra,
    '',
    '== Window errors (logs/errors.log) ==',
    errs || '(none)',
    '',
    '== Program crashes (logs/crash.log) ==',
    crash.replace(/unix (\d+)/g, (_, t) => new Date(t * 1000).toLocaleString('en-GB')) || '(none)',
  ].join('\n');
  const strip = (s, path, to) => (path ? s.split(path).join(to).split(path.replace(/\\/g, '/')).join(to) : s);
  return strip(strip(out, root, '<library>'), home, '~');
}

export async function openLogs() {
  const d = await logsDir();
  await fs.mkdir(d, { recursive: true }).catch(() => {});
  return (await import('@tauri-apps/plugin-opener')).openPath(d);
}

export async function clearLogs() {
  const d = await logsDir();
  for (const n of ['errors.log', 'errors.old.log', 'crash.log', 'crash.old.log']) await fs.remove(await join(d, n)).catch(() => {});
  last = ''; repeat = 0;
}
