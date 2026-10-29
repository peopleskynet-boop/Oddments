// A team file's block in the properties panel (team.js): whose it is, and «В мою библиотеку». Small, for the start-up.
import { S } from '../state.js';
import { esc, LOC } from '../util.js';
import { ic } from './icons.js';

// the properties panel of a team file: whose it is, and what one can do with it
export function teamBlock(it) {
  if (!it.team) return '';
  const t = (S.teams || []).find((x) => x.id === it.team);
  const when = it.added ? new Date(it.added).toLocaleDateString(LOC, { day: 'numeric', month: 'short' }) : '';
  return `<div class="team-blk">${ic('team')}<span>Команда «${esc(t ? t.name : '')}»${it.by ? ` · добавил(а) ${esc(it.by)}` : ''}${when ? `, ${when}` : ''}</span>` +
    `<button class="lnk" data-act="teamtake">В мою библиотеку</button></div>`;
}
