// A team library's journals folded into its items (team.js reads and writes them; this part is pure, for tests).
// Events in time order: { t, by, op: 'add', item } adds a file (the first add of an id wins), { op: 'set', id, f }
// changes shared fields (a later set wins), { op: 'del', id } takes it out for everyone.

// what a team item shares with everyone; the rest (collections, favourites, «new») is each person's own
export const SHARED = ['name', 'tags', 'scr', 'url', 'notes', 'trashed', 'pii', 'piiNo', 'masked'];

// a file of the team is «files/<id>/<name>» and nothing else: a journal is anyone's text, a «../» in it must not reach
// outside the team folder
const SAFE = /^files\/[\w-]{1,64}\/[^/\\:*?"<>|]{1,200}$/;
export const safeRel = (p) => typeof p === 'string' && SAFE.test(p) && !p.includes('..');

export function fold(events, teamId) {
  const items = new Map();
  for (const ev of [...events].sort((a, b) => a.t - b.t)) {
    if (ev.op === 'add' && ev.item && ev.item.id && safeRel(ev.item.file)) {
      for (const k of ['thumb', 'preview']) if (ev.item[k] && !safeRel(ev.item[k])) ev.item = { ...ev.item, [k]: null };
      if (!items.has(ev.item.id)) items.set(ev.item.id, { tags: [], ...ev.item, team: teamId, by: ev.by, added: ev.item.added || ev.t, folders: [], fav: false, fresh: false, trashed: false });
    } else if (ev.op === 'set' && items.has(ev.id)) {
      const it = items.get(ev.id);
      for (const [k, v] of Object.entries(ev.f || {})) if (SHARED.includes(k)) { if (v == null) delete it[k]; else it[k] = v; }
    } else if (ev.op === 'del' && items.has(ev.id)) items.get(ev.id).trashed = true;
  }
  return [...items.values()];
}
