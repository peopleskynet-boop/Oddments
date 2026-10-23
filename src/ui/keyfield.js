// A service key in Settings as a state row, not a password box (bug #110): «Ключ сохранён · …a1b2 · ✓ работает»,
// «✗ не принят: …» or «Ключа нет», with Проверить / Заменить / Удалить. A password box blanked its dots on a click and kept
// the key on blur, so one could not tell whether a key was there, which one, or whether it worked.
import { esc } from '../util.js';
import { toast } from './dialogs.js';

const checked = new Map(); // service → { tail, ok, msg, at } for this session

export function mountKeyField(box, { service, name, placeholder, get, set, test, onChange }) {
  let editing = false;
  const draw = () => {
    const key = get() || '';
    const tail = key ? key.slice(-4) : '';
    const st = checked.get(service);
    const fresh = st && st.tail === tail ? st : null;
    if (editing) {
      box.innerHTML = `<div class="kf-edit"><input type="password" class="kf-in" placeholder="${esc(placeholder)}" autocomplete="off" aria-label="Новый ключ ${esc(name)}">
        <button type="button" class="ibtn pri" data-kf="save">Сохранить</button><button type="button" class="ibtn" data-kf="cancel">Отмена</button></div>`;
      const inp = box.querySelector('.kf-in');
      inp.focus();
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(inp.value); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; draw(); } };
      return;
    }
    const state = !key ? '<span class="kf-st none">Ключа нет</span>'
      : `<span class="kf-st">Сохранён · <code>…${esc(tail)}</code>${fresh ? (fresh.pending ? ' · проверяю…' : fresh.ok ? ` · <b class="ok">✓ ${esc(fresh.msg)}</b>` : ` · <b class="bad">✗ ${esc(fresh.msg)}</b>`) : ' · не проверен'}</span>`;
    box.innerHTML = `<div class="kf-row">${state}<span class="kf-acts">${key ? '<button type="button" class="ibtn" data-kf="test">Проверить</button><button type="button" class="ibtn" data-kf="edit">Заменить</button><button type="button" class="ibtn" data-kf="del">Удалить</button>' : '<button type="button" class="ibtn pri" data-kf="edit">Добавить ключ</button>'}</span></div>`;
  };
  const run = async () => {
    const key = get() || '';
    if (!key) return;
    checked.set(service, { tail: key.slice(-4), pending: true });
    draw();
    const r = await test(key);
    checked.set(service, { tail: key.slice(-4), ok: r.ok, msg: r.msg });
    draw();
  };
  const save = (v) => {
    v = String(v || '').trim();
    editing = false;
    if (!v) { draw(); return; }
    set(v);
    toast(`Ключ ${name} сохранён`);
    if (onChange) onChange();
    run(); // checked right after saving
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kf]');
    if (!b) return;
    const a = b.dataset.kf;
    if (a === 'edit') { editing = true; draw(); }
    else if (a === 'cancel') { editing = false; draw(); }
    else if (a === 'save') save(box.querySelector('.kf-in').value);
    else if (a === 'test') run();
    else if (a === 'del') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Точно удалить?'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = 'Удалить'; } }, 3000); return; }
      set(''); checked.delete(service); toast(`Ключ ${name} удалён`); if (onChange) onChange(); draw();
    }
  });
  draw();
}
