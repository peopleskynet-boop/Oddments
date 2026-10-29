// The team library in the interface (lib/team.js): connecting a shared folder, sending files to the team (personal
// data hidden first — masker.js), taking a team file into one's own library, the team's block in the properties panel.
import { S, ui } from '../state.js';
import { esc, plural } from '../util.js';
import { ic } from './icons.js';
import { toast, ask, choose, busy, busyDone } from './dialogs.js';
import { sfx } from './sound.js';
import { absPath } from '../lib/library.js';
import { t } from '../lib/i18n.js';

const T = () => import('../lib/team.js');
const files = (n) => `${n} ${plural(n, ['файл', 'файла', 'файлов'])}`;

// a folder → a team: new or existing; the person's name is asked once (it signs their additions)
export async function connectFlow() {
  const team = await T();
  if (!window.__TAURI_INTERNALS__ && !window.__oddmentsTeamDir) { toast('Командная библиотека — в приложении Oddments: нужна общая папка на диске'); return null; }
  let dir = window.__oddmentsTeamDir || null; // the web build's tests hand a folder in
  if (!dir) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    dir = await open({ directory: true, recursive: true, title: t('Общая папка команды: сетевой диск, OneDrive, Яндекс Диск') });
  }
  if (!dir) return null;
  let person = team.me();
  if (!person) {
    person = await ask('Как подписывать ваши добавления в команде?', '');
    if (!person) return null;
  }
  let name = '';
  const fs = await import('@tauri-apps/plugin-fs');
  const exists = await fs.exists(dir + (dir.includes('\\') ? '\\' : '/') + 'oddments-team.json').catch(() => false);
  if (!exists) {
    name = await ask('Новая командная библиотека. Как её назвать?', 'Дизайн');
    if (!name) return null;
  }
  try {
    const t = await team.connectTeam(dir, name, person);
    const s = team.teamSummary(t.id);
    sfx('done');
    toast(`Команда «${t.name}»: ${files(s.items)}${s.ro ? ' · только просмотр — записи в папку нет' : ''}`, 5000);
    ui.renderSide && ui.renderSide();
    return t;
  } catch (e) {
    toast('Не удалось подключить папку: ' + ((e && e.message) || e) + '. Проверьте, что она доступна и вы можете в неё писать.', 8000);
    return null;
  }
}

// files → the team. Several teams: which one; pictures with personal data go only with it hidden
export async function sendFlow(items) {
  const team = await T();
  const mine = items.filter((i) => !i.team && !i.trashed && i.file);
  if (!mine.length) { toast('В команду уходят файлы вашей библиотеки'); return; }
  let teams = team.TEAM.teams;
  if (!teams.length) { const t = await connectFlow(); if (!t) return; teams = [t]; }
  let t = teams[0];
  if (teams.length > 1) {
    const id = await choose('В какую команду?', files(mine.length), teams.map((x, i) => ({ label: x.name, value: x.id, pri: i === 0 })));
    if (!id) return;
    t = team.teamById(id);
  }
  if (!team.canWrite(t.id)) { toast(`В папку команды «${t.name}» у вас нет права записи — попросите доступ у владельца папки`, 7000); return; }
  const pii = mine.filter((i) => i.pii && i.pii.length && !i.masked);
  let send = mine, masked = new Map();
  if (pii.length) {
    const v = await choose('Личные данные', `На ${pii.length} из ${mine.length} картинок есть номера карт, телефоны или имена. В команду они уходят только скрытыми.`,
      [{ label: 'Не отправлять их', value: 'skip' }, { label: 'Скрыть и отправить', value: 'hide', pri: true }]);
    if (!v) return;
    if (v === 'skip') send = mine.filter((i) => !pii.includes(i));
    else {
      const { findRegions, maskToBlob } = await import('../lib/masker.js');
      for (let i = 0; i < pii.length; i++) {
        busy(`Скрываю личные данные · ${i + 1} из ${pii.length}`, (i + 1) / pii.length);
        const f = await findRegions(pii[i]);
        try { if (f.regions.length) masked.set(pii[i].id, new Uint8Array(await (await maskToBlob(f.url, f.regions)).arrayBuffer())); } finally { URL.revokeObjectURL(f.url); }
      }
    }
  }
  if (!send.length) { busyDone(''); return; }
  try {
    await team.sendToTeam(t.id, send, { masked, onProgress: (d, n) => busy(`В команду «${t.name}» · ${d} из ${n}`, d / n) });
    busyDone(`В команде: ${send.length}`);
    sfx('done');
    toast(`В команду «${t.name}»: ${files(send.length)}${masked.size ? ` · личные данные скрыты на ${masked.size}` : ''}`, 5000, { label: 'Открыть', fn: () => import('../lib/filter.js').then((m) => m.setView('team', t.id)) });
  } catch (e) {
    busyDone('');
    toast('Не удалось отправить в команду: ' + ((e && e.message) || e), 7000);
  }
}

// a team file → one's own library (a copy: one's own collections, favourites, edits)
export async function takeFlow(items) {
  const team = items.filter((i) => i.team && !i.trashed);
  if (!team.length) return;
  const { addFromBlobs } = await import('../lib/library.js');
  const fs = await import('@tauri-apps/plugin-fs');
  const list = [];
  for (const it of team) list.push({ blob: new Blob([await fs.readFile(absPath(it.file))]), name: it.file.split('/').pop(), source: it.url || '' });
  const added = await addFromBlobs(list, {});
  added.forEach((a, k) => { a.tags = [...new Set([...(a.tags || []), ...(team[k].tags || [])])]; if (team[k].scr) a.scr = team[k].scr; });
  toast(`В вашу библиотеку: ${files(added.length)}`);
}

export { teamBlock } from './teamblock.js';
