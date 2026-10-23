// Oddments' own video player for the preview, in place of the browser's controls. A glass capsule at the bottom:
// play, timecode with the frame number, a scrub track with a small preview of the frame under the pointer,
// speed 0.25–2×, loop (the whole clip or an A–B part), frame steps, sound, «Кадр — в библиотеку» and
// «Копировать кадр», full screen. Keys while it is open: K play/pause, J / L ±5 s, , / . a frame back/forward,
// < / > speed, M sound, F full screen (Space and the arrows keep their preview meaning: close, next file).
// The capsule hides after 2 s without the pointer moving while the clip plays.
import { ic } from './icons.js';
import { assetUrl } from '../lib/library.js';
import { toast } from './dialogs.js';
import { sfx } from './sound.js';
import { embedMedia, embedSrc } from './embedmedia.js';

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const PREFS = 'perch.player';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { return {}; } })();
const keep = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

let active = null; // { v, el, it, onKey }

// «1:52:11», not «112:11» (bug #103)
const tc = (t) => {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

// src: play this URL instead of the item's file (a clip from the web, as a blob: URL);
// extras: more buttons for the bar, [{ icon, label, fn(button) }];
// embed: { site: 'YouTube' | 'Vimeo', id, ar } — the site's player under the same capsule (embedmedia.js)
export function mountPlayer(holder, it, onError, src, extras = [], embed = null) {
  unmountPlayer();
  // an embedded clip: the site's iframe, and a clear layer over it so a click pauses like on our own clips
  const surface = embed
    ? `<div class="vp-v vp-embed" style="--ar:${embed.ar || 16 / 9}"><iframe src="${embedSrc(embed.site, embed.id)}" title="${it.name.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe><i class="vp-shield"></i></div>`
    : `<video class="vp-v" autoplay playsinline ${it.thumb ? `poster="${assetUrl(it.thumb)}"` : ''} src="${src || assetUrl(it.file)}"></video>`;
  // pixels of another site cannot be read: no frame preview, frame steps or frame grabs for embeds
  const own = !embed;
  holder.innerHTML = `<div class="vp${embed ? ' embed' : ''}">
    ${surface}
    <div class="vp-bar glass" role="group" aria-label="Видео">
      <button type="button" class="ib" data-vp="play" aria-label="Пауза" title="Пауза (K)">${ic('pause')}</button>
      <span class="vp-tc"><b data-vp-t>0:00</b> / <span data-vp-d>0:00</span><i data-vp-f></i></span>
      <div class="vp-track" data-vp="track" role="slider" tabindex="0" aria-label="Перемотка" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <i class="vp-buf"></i><i class="vp-ab" hidden></i><i class="vp-fill"></i><i class="vp-knob"></i>
        <div class="vp-peek" hidden>${own ? `<video muted preload="auto" src="${src || assetUrl(it.file)}"></video>` : ''}<b></b></div>
      </div>
      <button type="button" class="vp-pill" data-vp="speed" title="Скорость (< >)">1×</button>
      <button type="button" class="ib" data-vp="loop" aria-pressed="true" title="Повтор: весь ролик / фрагмент A–B">${ic('restore')}<em></em></button>
${own ? `
      <span class="vp-sep"></span>
      <button type="button" class="ib" data-vp="prev" aria-label="Кадр назад" title="Кадр назад ( , )">${ic('left')}</button>
      <button type="button" class="ib" data-vp="next" aria-label="Кадр вперёд" title="Кадр вперёд ( . )">${ic('right')}</button>
      <span class="vp-sep"></span>
      <button type="button" class="ib" data-vp="frame" aria-label="Кадр — в библиотеку" title="Кадр — в библиотеку">${ic('image')}</button>
      <button type="button" class="ib" data-vp="copy" aria-label="Копировать кадр" title="Копировать кадр">${ic('copy')}</button>` : ''}
      <span class="vp-sep"></span>
      <button type="button" class="ib" data-vp="mute" aria-label="Звук" title="Звук (M)">${ic('music')}</button>
      <input type="range" class="vp-vol" min="0" max="1" step="0.05" aria-label="Громкость">
 ${extras.map((x, i) => `<button type="button" class="ib" data-vx="${i}" aria-label="${x.label}" title="${x.label}">${ic(x.icon)}</button>`).join('')}
      <span class="vp-opts" hidden></span>
      <button type="button" class="ib" data-vp="full" aria-label="Во весь экран" title="Во весь экран (F)">${ic('zoom')}</button>
    </div></div>`;
  const el = holder.querySelector('.vp'), bar = el.querySelector('.vp-bar');
  const v = embed ? embedMedia(embed.site, el.querySelector('iframe')) : el.querySelector('.vp-v');
  const clickTarget = embed ? el.querySelector('.vp-shield') : v;
  const track = el.querySelector('.vp-track'), fill = el.querySelector('.vp-fill'), knob = el.querySelector('.vp-knob');
  const buf = el.querySelector('.vp-buf'), abEl = el.querySelector('.vp-ab'), peek = el.querySelector('.vp-peek'), pv = peek.querySelector('video');
  const $ = (s) => el.querySelector(s);
  let fps = 30, ab = null, abStage = 0; // A–B: 0 whole clip, 1 A set, 2 looping A–B
  v.loop = true;
  v.volume = prefs.volume ?? 0.8;
  v.muted = prefs.muted ?? false;
  v.playbackRate = prefs.speed ?? 1;
  $('.vp-vol').value = v.volume;

  // the frame rate, read from the frames themselves while the clip plays (30 until then)
  if (v.requestVideoFrameCallback) {
    let last = null, n = 0, sum = 0;
    const tick = (now, meta) => {
      if (last != null && meta.mediaTime > last && n < 40) { sum += meta.mediaTime - last; n++; if (n >= 8) fps = Math.min(120, Math.max(6, Math.round(n / sum))); }
      last = meta.mediaTime;
      if (active && active.v === v) v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
  }

  const frac = () => (v.duration ? v.currentTime / v.duration : 0);
  const draw = () => {
    const f = frac();
    fill.style.width = f * 100 + '%';
    knob.style.left = f * 100 + '%';
    track.setAttribute('aria-valuenow', Math.round(f * 100));
    $('[data-vp-t]').textContent = tc(v.currentTime);
    $('[data-vp-f]').textContent = own ? ' · кадр ' + Math.floor(v.currentTime * fps + 1e-3) : '';
    if (v.buffered.length && v.duration) buf.style.width = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100 + '%';
    if (ab && abStage === 2 && v.currentTime >= ab[1]) v.currentTime = ab[0];
  };
  const drawState = () => {
    const p = $('[data-vp="play"]');
    p.innerHTML = ic(v.paused ? 'play' : 'pause');
    p.setAttribute('aria-label', v.paused ? 'Воспроизвести' : 'Пауза');
    $('[data-vp="speed"]').textContent = String(v.playbackRate).replace('.', ',') + '×';
    $('[data-vp="mute"]').classList.toggle('off', v.muted || v.volume === 0);
    const lp = $('[data-vp="loop"]');
    lp.querySelector('em').textContent = abStage === 1 ? 'A' : abStage === 2 ? 'A–B' : '';
    lp.setAttribute('aria-label', abStage === 0 ? 'Повтор всего ролика. Нажмите, чтобы отметить A' : abStage === 1 ? 'Точка A отмечена. Нажмите, чтобы отметить B' : 'Повтор A–B. Нажмите, чтобы снять');
    abEl.hidden = !(ab && v.duration);
    if (ab && v.duration) { abEl.style.left = (ab[0] / v.duration) * 100 + '%'; abEl.style.width = ((ab[1] - (abStage === 2 ? ab[0] : ab[0])) / v.duration) * 100 + '%'; }
  };
  v.addEventListener('loadedmetadata', () => { $('[data-vp-d]').textContent = tc(v.duration); draw(); drawState(); });
  v.addEventListener('timeupdate', draw);
  v.addEventListener('seeked', draw);
  v.addEventListener('progress', draw);
  ['play', 'pause', 'ratechange', 'volumechange'].forEach((e) => v.addEventListener(e, drawState));
  v.addEventListener('error', () => { if (onError) onError(); }, { once: true });
  // smooth knob while playing (timeupdate fires only ~4× a second)
  const loop = () => { if (!active || active.v !== v) return; if (!v.paused) draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  const step = (d) => { if (!own) return; v.pause(); v.currentTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + d / fps)); };
  const seek = (d) => { v.currentTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + d)); };
  const speed = (d) => {
    const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v.playbackRate) + d));
    v.playbackRate = SPEEDS[i < 0 ? 2 : i]; prefs.speed = v.playbackRate; keep();
  };
  const toggle = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const loopAb = () => {
    if (abStage === 0) { ab = [v.currentTime, v.currentTime]; abStage = 1; }
    else if (abStage === 1) {
      const t = v.currentTime;
      ab = t > ab[0] ? [ab[0], t] : [t, ab[0]];
      if (ab[1] - ab[0] < 0.05) { ab = null; abStage = 0; } else { abStage = 2; v.currentTime = ab[0]; }
    } else { ab = null; abStage = 0; }
    sfx('tick'); drawState();
  };
  const frameAction = async (save) => {
    v.pause();
    try {
      const m = await import('./media.js');
      if (save) { const n = await m.saveFrame(it, v.currentTime, src); (await import('../state.js')).ui.refresh(); if (n.length) toast('Кадр сохранён: ' + n[0].name); }
      else { await m.copyFrame(it, v.currentTime, src); toast('Кадр скопирован'); }
    } catch (e) { toast(save ? 'Не удалось сохранить кадр.' : 'Не удалось скопировать кадр.'); }
  };

  // quality and subtitles — only where the site offers them (bug #68): a Vimeo clip whose owner allows quality
  // choice, a clip with subtitle tracks, YouTube's captions switch; never for our own files
  const opts = $('.vp-opts');
  const drawOpts = () => {
    const q = (v.qualities || []).length > 1 ? v.qualities : [], t = v.tracks || [];
    opts.hidden = !q.length && !t.length;
    const qa = q.find((x) => x.active);
    opts.innerHTML = (q.length ? `<button type="button" class="vp-pill" data-vo="q" aria-haspopup="menu" title="Качество">${qa ? qa.label.replace(/^Авто$/, 'Авто') : 'HD'}</button>` : '')
      + (t.length ? `<button type="button" class="vp-pill${t.some((x) => x.active) ? ' on' : ''}" data-vo="t" aria-haspopup="menu" title="Субтитры">CC</button>` : '');
  };
  if (v.addEventListener && 'qualities' in v) { v.addEventListener('qualitieschange', drawOpts); v.addEventListener('trackschange', drawOpts); drawOpts(); }
  const menu = (btn, kind) => {
    const open = el.querySelector('.vp-menu');
    // the button toggles its menu: a second click closes it instead of opening it again (bug #101)
    if (open) { const same = open.dataset.kind === kind; open.remove(); if (same) return; }
    const list = kind === 'q' ? v.qualities : v.tracks;
    const m = document.createElement('div');
    m.className = 'vp-menu glass';
    m.dataset.kind = kind;
    m.setAttribute('role', 'menu');
    const rows = kind === 't' && v.embedded !== 'YouTube' ? [{ id: '', label: 'Выключить', active: !list.some((x) => x.active) }, ...list] : kind === 't' ? [{ id: list[0].active ? '' : 'on', label: list[0].active ? 'Выключить субтитры' : 'Включить субтитры', active: false }] : list;
    m.innerHTML = rows.map((r) => `<button type="button" role="menuitemradio" aria-checked="${!!r.active}" data-id="${r.id}">${r.label}${r.active ? ic('check') : ''}</button>`).join('');
    bar.appendChild(m);
    const r = btn.getBoundingClientRect(), br = bar.getBoundingClientRect();
    m.style.left = Math.max(0, r.left - br.left + r.width / 2 - m.offsetWidth / 2) + 'px';
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      e.stopPropagation();
      if (kind === 'q') v.setQuality(b.dataset.id); else v.setTrack(b.dataset.id || null);
      m.remove();
    });
    const off = (e) => { if (!m.isConnected) { document.removeEventListener('pointerdown', off, true); return; } if (!m.contains(e.target) && !btn.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  };
  // CC is a switch (bug #102): on → off in one click; off → the only track on, or the language menu when there are several
  opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vo]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.vo === 't') {
      const t = v.tracks || [];
      el.querySelector('.vp-menu')?.remove();
      if (t.some((x) => x.active)) { v.setTrack(null); sfx('off'); return; }
      if (t.length === 1 || v.embedded === 'YouTube') { v.setTrack(t[0].id || 'on'); sfx('on'); return; }
    }
    menu(b, b.dataset.vo);
  });

  bar.addEventListener('click', (e) => {
    const x = e.target.closest('[data-vx]');
    if (x) { e.stopPropagation(); extras[+x.dataset.vx].fn(x); return; }
    const b = e.target.closest('[data-vp]');
    if (!b) return;
    const a = b.dataset.vp;
    if (a === 'play') toggle();
    else if (a === 'speed') speed(SPEEDS.indexOf(v.playbackRate) === SPEEDS.length - 1 ? -(SPEEDS.length - 1) : 1);
    else if (a === 'loop') loopAb();
    else if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'frame') frameAction(true);
    else if (a === 'copy') frameAction(false);
    else if (a === 'mute') { v.muted = !v.muted; prefs.muted = v.muted; keep(); }
    else if (a === 'full') { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen().catch(() => {}); }
  });
  $('.vp-vol').addEventListener('input', (e) => { v.volume = +e.target.value; v.muted = v.volume === 0; prefs.volume = v.volume; prefs.muted = v.muted; keep(); });
  clickTarget.addEventListener('click', toggle);

  // scrubbing: press and drag on the track; hovering shows the frame there (a second, muted video seeks to it)
  const at = (x) => { const r = track.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - r.left) / r.width)); };
  let peekT = 0;
  track.addEventListener('pointermove', (e) => {
    if (!v.duration) return;
    const f = at(e.clientX), t = f * v.duration;
    peek.hidden = false;
    peek.style.left = f * 100 + '%';
    peek.querySelector('b').textContent = tc(t);
    const now = performance.now();
    if (pv && now - peekT > 60) { peekT = now; pv.currentTime = t; }
  });
  track.addEventListener('pointerleave', () => { peek.hidden = true; });
  track.addEventListener('pointerdown', (e) => {
    if (!v.duration) return;
    track.setPointerCapture(e.pointerId);
    const was = !v.paused; v.pause();
    const go = (ev) => { v.currentTime = at(ev.clientX) * v.duration; draw(); };
    go(e);
    const up = () => { track.removeEventListener('pointermove', go); track.removeEventListener('pointerup', up); if (was) v.play().catch(() => {}); };
    track.addEventListener('pointermove', go); track.addEventListener('pointerup', up);
  });
  // the wheel over the track: ±5 s per notch — fine seeking on a long video (bug #103)
  track.addEventListener('wheel', (e) => { if (!v.duration) return; e.preventDefault(); e.stopPropagation(); seek((e.deltaY || e.deltaX) > 0 ? 5 : -5); }, { passive: false });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(e.key === 'ArrowLeft' ? -5 : 5); }
  });

  // the capsule rests out of the way while the clip plays and the pointer is still
  let idleT = 0;
  const wake = () => { el.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (!v.paused && !bar.matches(':hover') && !bar.contains(document.activeElement)) el.classList.add('idle'); }, 2000); };
  el.addEventListener('pointermove', wake);
  v.addEventListener('pause', wake);
  wake();

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.closest && t.closest('input:not(.vp-vol), textarea, [contenteditable]')) return;
    const k = e.key;
    const map = { k: toggle, K: toggle, л: toggle, j: () => seek(-5), о: () => seek(-5), l: () => seek(5), д: () => seek(5), ',': () => step(-1), б: () => step(-1), '.': () => step(1), ю: () => step(1), '<': () => speed(-1), '>': () => speed(1), m: () => { v.muted = !v.muted; prefs.muted = v.muted; keep(); }, ь: () => { v.muted = !v.muted; prefs.muted = v.muted; keep(); }, f: () => $('[data-vp="full"]').click(), а: () => $('[data-vp="full"]').click() };
    // in fullscreen the arrows seek (outside it they step through the files)
    if (document.fullscreenElement === el && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); seek(k === 'ArrowLeft' ? -5 : 5); wake(); return; }
    const fn = map[k] || map[k.toLowerCase()];
    if (!fn) return;
    e.preventDefault(); e.stopPropagation();
    fn(); wake();
  };
  document.addEventListener('keydown', onKey, true);
  active = { v, el, it, onKey };
  drawState();
  return v;
}

export function unmountPlayer() {
  if (!active) return;
  document.removeEventListener('keydown', active.onKey, true);
  try { active.v.pause(); } catch (e) { /* gone */ }
  if (active.v.destroy) active.v.destroy();
  if (document.fullscreenElement && active.el.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
  active = null;
}
