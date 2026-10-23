// Glass dropdowns instead of the native Windows <select> popup, which ignores the app's theme.
// The real <select> stays in the DOM (hidden) and keeps its value and "change" events, so the code
// that reads it does not change. The list is attached to <body>: inside a .glass parent,
// backdrop-filter would turn position: fixed into "relative to the panel".
// The list grows out of its trigger like Arc's morph select (uiarc.dev, MIT, © 2026 Elia Kuratli): it opens
// over the button with a lid row that repeats the value, and its clip grows from the button's shape to the
// whole list on the morph spring; closing shrinks it back into the button.
import { ic } from './icons.js';
import { SPRINGS } from './spring.js';
import { motionOn } from './motion.js';

let open = null; // { sel, btn, list, idx, up }

function labelOf(sel) {
  const o = sel.options[sel.selectedIndex];
  return o ? o.textContent : '';
}

// The accessible name is the field's own caption plus the current value ("Тема: Тёмная"). The caption is the
// <span> of the surrounding settings row, not the whole label, whose text also holds every hidden <option>.
function nameOf(sel) {
  const own = sel.getAttribute('aria-label');
  if (own) return own;
  const lab = sel.closest('label'), cap = lab && lab.querySelector(':scope > span');
  return cap ? cap.textContent.trim() : 'Выбор';
}

export function syncSelect(sel) {
  const btn = sel.nextElementSibling;
  if (!btn || !btn.classList.contains('gsel')) return;
  btn.querySelector('.gsel-t').textContent = labelOf(sel);
  btn.setAttribute('aria-label', `${nameOf(sel)}: ${labelOf(sel)}`);
}

// the clip that makes the list look exactly like its trigger button
function btnClip(list, btn, up) {
  const l = list.getBoundingClientRect(), b = btn.getBoundingClientRect();
  const t = Math.max(0, b.top - l.top), r = Math.max(0, l.right - b.right), bo = Math.max(0, l.bottom - b.bottom), le = Math.max(0, b.left - l.left);
  return `inset(${up ? l.height - b.height : t}px ${r}px ${up ? 0 : bo}px ${le}px round ${b.height / 2}px)`;
}

function close(focusBtn) {
  if (!open) return;
  const { list, btn, up } = open;
  btn.setAttribute('aria-expanded', 'false');
  if (focusBtn) btn.focus();
  open = null;
  if (!motionOn() || !list.isConnected) { list.remove(); return; }
  list.style.pointerEvents = 'none';
  list.classList.add('shut');
  // shrink back into the button and fade over the last stretch: the real button is underneath by then, so the
  // list never lingers as a second copy of it
  const from = getComputedStyle(list).clipPath === 'none' ? 'inset(0 round 20px)' : getComputedStyle(list).clipPath;
  const a = list.animate([{ clipPath: from, opacity: 1 }, { opacity: 1, offset: 0.6 }, { clipPath: btnClip(list, btn, up), opacity: 0 }],
    { duration: SPRINGS.smooth.ms * 0.8, easing: SPRINGS.smooth.easing, fill: 'forwards' });
  a.onfinish = () => list.remove();
}

function choose(i) {
  const { sel } = open;
  if (sel.selectedIndex !== i) {
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  syncSelect(sel);
  const lid = open.list.querySelector('.gsel-lid span');
  if (lid) lid.textContent = labelOf(sel);
  close(true);
}

function mark(i) {
  open.idx = i;
  open.list.querySelectorAll('.mi').forEach((m, k) => m.classList.toggle('kb', k === i));
  const m = open.list.querySelector(`[data-i="${i}"]`);
  if (m) m.scrollIntoView({ block: 'nearest' });
}

function show(sel, btn) {
  close();
  const list = document.createElement('div');
  list.className = 'menu glass gsel-list open';
  list.setAttribute('role', 'listbox');
  if (btn.closest('.bar, .tabrow')) list.dataset.top = '1'; // the clean mode keeps the top panel up meanwhile
  const r = btn.getBoundingClientRect();
  const morph = motionOn();
  const opts = Array.from(sel.options).map((o, i) =>
    `<button type="button" class="mi${i === sel.selectedIndex ? ' on' : ''}" role="option" aria-selected="${i === sel.selectedIndex}" data-i="${i}"><span>${o.textContent}</span>${i === sel.selectedIndex ? ic('check') : ''}</button>`).join('');
  // the lid: the trigger row repeated inside the list, so the button seems to open in place
  // the lid repeats the button exactly where the button is: the list is right-aligned with it, so the value and
  // the chevron sit at the right with the button's own padding, gap and type (not at the list's left edge)
  const bs = getComputedStyle(btn);
  const lid = morph ? `<div class="gsel-lid" aria-hidden="true" style="height:${r.height}px;padding-right:${bs.paddingRight};gap:${bs.columnGap};font-family:${bs.fontFamily.replace(/"/g, "'")};font-size:${bs.fontSize};font-weight:${bs.fontWeight};letter-spacing:${bs.letterSpacing};text-transform:${bs.textTransform}"><span>${labelOf(sel)}</span>${ic('chev')}</div>` : '';
  list.innerHTML = opts;
  document.body.appendChild(list);
  list.style.minWidth = Math.max(r.width, 200) + 'px';
  const h = list.offsetHeight;
  const below = window.innerHeight - r.bottom > h + 16;
  if (morph) {
    list.classList.add('morph');
    if (below) list.insertAdjacentHTML('afterbegin', lid); else list.insertAdjacentHTML('beforeend', lid);
    list.style.top = (below ? r.top : r.bottom - list.offsetHeight) + 'px';
    list.style.left = Math.min(window.innerWidth - list.offsetWidth - 8, Math.max(8, r.right - list.offsetWidth)) + 'px';
    list.animate([{ clipPath: btnClip(list, btn, !below) }, { clipPath: 'inset(0 round 20px)' }],
      { duration: SPRINGS.morph.ms, easing: SPRINGS.morph.easing });
  } else {
    list.style.top = (below ? r.bottom + 8 : r.top - h - 8) + 'px';
    list.style.left = Math.min(window.innerWidth - list.offsetWidth - 8, Math.max(8, r.right - list.offsetWidth)) + 'px';
  }
  btn.setAttribute('aria-expanded', 'true');
  open = { sel, btn, list, idx: sel.selectedIndex, up: !below };
  mark(sel.selectedIndex);
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) choose(+b.dataset.i); else if (e.target.closest('.gsel-lid')) close(true);
  });
}

export function enhanceSelect(sel) {
  if (!sel || sel.dataset.g) return;
  sel.dataset.g = '1';
  sel.classList.add('gsel-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gsel';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', `${nameOf(sel)}: ${labelOf(sel)}`);
  btn.innerHTML = `<span class="gsel-t">${labelOf(sel)}</span>${ic('chev')}`;
  sel.after(btn);
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (open && open.btn === btn) close(); else show(sel, btn); });
  btn.addEventListener('keydown', (e) => {
    if (!open || open.btn !== btn) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(sel, btn); }
      return;
    }
    const n = sel.options.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); mark((open.idx + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark((open.idx - 1 + n) % n); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(open.idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  });
  sel.addEventListener('change', () => syncSelect(sel));
}

export function enhanceAll(root = document) {
  root.querySelectorAll('select:not([data-g])').forEach(enhanceSelect);
}

// clicks elsewhere, scrolling and resizing close the open list
document.addEventListener('pointerdown', (e) => { if (open && !open.list.contains(e.target) && !open.btn.contains(e.target)) close(); }, true);
window.addEventListener('resize', () => close());
document.addEventListener('scroll', (e) => { if (open && !open.list.contains(e.target)) close(); }, true);
