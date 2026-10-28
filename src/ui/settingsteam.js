// Settings › Библиотека: team libraries (team.js), the tag dictionary (glossary.js), brand rules (brand.js). Loaded when
// the drawer opens, so the start-up does not carry it.
import { $, esc } from '../util.js';
import { ui } from '../state.js';

const renderInspSoon = () => setTimeout(() => ui.renderInsp && ui.renderInsp(), 0);

export function bindTeamSettings() {
  // team libraries (team.js): which are connected, their state, disconnect
  const drawTeams = () => import('../lib/team.js').then((m) => {
    const box = $('#sTeams .watch-list');
    if (!box) return;
    box.innerHTML = m.TEAM.teams.map((t) => {
      const s = m.teamSummary(t.id);
      const st = s.error ? 'не открывается: ' + s.error : `${s.items} файлов · людей: ${s.people || 0}${s.ro ? ' · только просмотр' : ''}`;
      return `<div class="watch-row"><span><b>${esc(t.name)}</b><br><small class="hint">${esc(st)}</small><br><code class="path">${esc(t.dir)}</code></span><button class="ibtn flat" data-unteam="${esc(t.id)}">Отключить</button></div>`;
    }).join('') + (m.me() ? `<small class="hint">Вы подписываете добавления как «${esc(m.me())}».</small>` : '');
  });
  drawTeams();
  // the tag dictionary (glossary.js, teamconf.js): own or the team's; «Найти похожие теги» merges spellings in the library
  Promise.all([import('../lib/teamconf.js'), import('../lib/team.js'), import('../lib/glossary.js'), import('../state.js'), import('../lib/library.js')]).then(([C, T, G, St, L]) => {
    const box = $('#sGloss');
    if (!box) return;
    const writable = T.TEAM.teams.find((t) => T.canWrite(t.id));
    let g = { ...C.glossary() };
    const keep = async () => {
      C.saveOwnGlossary(g);
      if (C.glossarySource().startsWith('команда') && writable) await T.saveTeamGlossary(writable.id, g).catch(() => {});
      draw();
    };
    const draw = () => {
      $('#sGlSrc').textContent = 'Словарь: ' + C.glossarySource() + ` · слов: ${Object.keys(g).length}.`;
      box.querySelector('.gl-list').innerHTML = Object.entries(g).sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([w, syn]) =>
        `<div class="gl-row"><b>${esc(w)}</b><input type="text" data-glsyn="${esc(w)}" value="${esc((syn || []).join(', '))}" aria-label="Синонимы слова ${esc(w)}" placeholder="синонимы"><button type="button" class="ib" data-glrm="${esc(w)}" aria-label="Убрать ${esc(w)}">×</button></div>`).join('');
      $('#sGlTeam').hidden = !writable || C.glossarySource().startsWith('команда');
      if (writable) $('#sGlTeam').textContent = `Сделать словарём команды «${writable.name}»`;
    };
    draw();
    box.querySelector('.gl-add').addEventListener('submit', (e) => {
      e.preventDefault();
      const [w, syn] = e.target.querySelectorAll('input');
      const word = w.value.trim().replace(/^#/, '');
      if (!word) return;
      g = { ...g, [word]: syn.value.split(',').map((x) => x.trim()).filter(Boolean) };
      w.value = ''; syn.value = '';
      keep();
    });
    box.addEventListener('change', (e) => { const t = e.target; if (t.dataset.glsyn) { g = { ...g, [t.dataset.glsyn]: t.value.split(',').map((x) => x.trim()).filter(Boolean) }; keep(); } });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.glrm) { const n = { ...g }; delete n[b.dataset.glrm]; g = n; keep(); }
      else if (b.id === 'sGlTeam' && writable) { await T.saveTeamGlossary(writable.id, g).then(() => import('./dialogs.js').then((d) => d.toast(`Словарь тегов — у всей команды «${writable.name}»`))).catch((err) => import('./dialogs.js').then((d) => d.toast('Не удалось записать словарь в папку команды: ' + ((err && err.message) || err)))); draw(); }
      else if (b.id === 'sGlFind') {
        const counts = new Map();
        St.S.items.forEach((i) => !i.trashed && i.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
        const m = G.similarTags([...counts], g);
        box.querySelector('.gl-merge').innerHTML = m.length ? m.slice(0, 30).map((x, k) => `<div class="gl-row"><span>${x.merge.map(esc).join(', ')} → <b>${esc(x.keep)}</b></span><button type="button" class="ibtn" data-glmerge="${k}">Объединить</button></div>`).join('') : '<small class="hint">Похожих тегов нет — словарь в порядке.</small>';
        box.querySelector('.gl-merge').__m = m;
      } else if (b.dataset.glmerge) {
        const x = box.querySelector('.gl-merge').__m[+b.dataset.glmerge];
        let n = 0;
        St.S.items.forEach((i) => { if (i.tags.some((t) => x.merge.includes(t))) { i.tags = [...new Set(i.tags.map((t) => (x.merge.includes(t) ? x.keep : t)))]; n++; } });
        g = { ...g, [x.keep]: [...new Set([...(g[x.keep] || []), ...x.merge])] }; // the merged spellings become synonyms
        L.saveIndex(); St.ui.refresh(); keep();
        b.closest('.gl-row').remove();
        import('./dialogs.js').then((d) => d.toast(`Теги объединены в «${x.keep}»: ${n} файлов`));
      }
    });
  });
  // brand rules (brand.js, brandrules.js): one's own; a team's when its folder carries them — edits go there too
  Promise.all([import('../lib/brandrules.js'), import('../lib/team.js')]).then(([B, T]) => {
    const box = $('#sBrand');
    if (!box) return;
    let r = B.brandRules();
    const writable = T.TEAM.teams.find((t) => T.canWrite(t.id));
    const keep = async () => {
      B.saveOwnRules(r);
      if (B.rulesSource().startsWith('команда') && writable) await T.saveTeamRules(writable.id, r).catch(() => {});
      draw(); renderInspSoon();
    };
    const chips = (k) => `${r[k].map((c) => `<span class="br-c" style="--c:${c}"><i></i>${c.toUpperCase()}<button type="button" data-brrm="${k}" data-c="${c}" aria-label="Убрать ${c}">×</button></span>`).join('')}<label class="br-add" title="Добавить цвет"><input type="color" data-bradd="${k}" aria-label="Добавить цвет">+</label>`;
    const draw = () => {
      $('#sBrSrc').textContent = 'Действуют правила: ' + B.rulesSource() + '.';
      box.querySelector('[data-list="colors"]').innerHTML = chips('colors');
      box.querySelector('[data-list="forbid"]').innerHTML = chips('forbid');
      $('#sBrAcc').value = r.accent; $('#sBrMin').value = r.accentMin; $('#sBrMax').value = r.accentMax;
      $('#sBrTris').value = r.model.maxTris; $('#sBrUV').checked = r.model.needUV; $('#sBrNames').checked = r.model.names;
      $('#sBrTeam').hidden = !writable || B.rulesSource().startsWith('команда');
      if (writable) $('#sBrTeam').textContent = `Сделать правилами команды «${writable.name}»`;
    };
    draw();
    box.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.bradd) { r = { ...r, [t.dataset.bradd]: [...new Set([...r[t.dataset.bradd], t.value.toLowerCase()])] }; return keep(); }
      if (t.id === 'sBrAcc') r = { ...r, accent: t.value.toLowerCase() };
      else if (t.id === 'sBrMin') r = { ...r, accentMin: +t.value || 0 };
      else if (t.id === 'sBrMax') r = { ...r, accentMax: +t.value || 100 };
      else if (t.id === 'sBrTris') r = { ...r, model: { ...r.model, maxTris: +t.value || r.model.maxTris } };
      else if (t.id === 'sBrUV') r = { ...r, model: { ...r.model, needUV: t.checked } };
      else if (t.id === 'sBrNames') r = { ...r, model: { ...r.model, names: t.checked } };
      else return;
      keep();
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.brrm) { r = { ...r, [b.dataset.brrm]: r[b.dataset.brrm].filter((c) => c !== b.dataset.c) }; keep(); }
      else if (b.id === 'sBrReset') { const { DEFAULT_RULES } = await import('../lib/brand.js'); r = DEFAULT_RULES; keep(); }
      else if (b.id === 'sBrTeam' && writable) { try { await T.saveTeamRules(writable.id, r); import('./dialogs.js').then((d) => d.toast(`Правила бренда — у всей команды «${writable.name}»`)); draw(); } catch (err) { import('./dialogs.js').then((d) => d.toast('Не удалось записать правила в папку команды: ' + ((err && err.message) || err))); } }
    });
  });
  $('#sTeamAdd').onclick = () => import('./teamui.js').then((m) => m.connectFlow()).then(drawTeams);
  $('#sTeams').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unteam]');
    if (b) import('../lib/team.js').then((m) => { m.disconnectTeam(b.dataset.unteam); drawTeams(); import('./dialogs.js').then((d) => d.toast('Команда отключена: её файлы остаются в общей папке')); });
  });
}
