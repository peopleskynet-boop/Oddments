// Interface sounds, character «Воздух»: soft, warm, with a little room
// around them. Everything is synthesised with Web Audio — no audio files. Volume is settings.sound (0–100,
// 0 = off). The AudioContext is created on the first sound, which always follows a click or a key press.
import { settings } from './settings.js';

let ac = null, master = null, rev = null, noiseBuf = null;

function ctx() {
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp); comp.connect(ac.destination);
    // a short synthetic room: decaying noise as the impulse response
    rev = ac.createConvolver();
    const len = Math.floor(ac.sampleRate * 1.4), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    rev.buffer = b; rev.connect(master);
  }
  if (ac.state === 'suspended') ac.resume();
  master.gain.value = (settings.sound / 100) * 1.1;
  return ac;
}

function out(node, wet) {
  node.connect(master);
  if (wet) { const s = ac.createGain(); s.gain.value = wet; node.connect(s); s.connect(rev); }
}
function env(g, t0, o) {
  const a = o.a || 0.002, d = o.d || 0.08;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(o.g, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  return t0 + a + d + 0.05;
}
function tone(o) {
  const t0 = ac.currentTime + 0.005 + (o.t || 0);
  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(o.f, t0);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.glide || (o.a || 0.002) + (o.d || 0.08)));
  const g = ac.createGain();
  const end = env(g, t0, o);
  osc.connect(g); out(g, o.wet);
  osc.start(t0); osc.stop(end);
}
function noise(o) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t0 = ac.currentTime + 0.005 + (o.t || 0);
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = o.ft || 'bandpass'; f.Q.value = o.q || 1;
  f.frequency.setValueAtTime(o.f, t0);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.a || 0.002) + (o.d || 0.08));
  const g = ac.createGain();
  const end = env(g, t0, o);
  src.connect(f); f.connect(g); out(g, o.wet);
  src.start(t0); src.stop(end);
}
const notes = (fs, step, o) => fs.forEach((f, i) => tone({ ...o, f, t: (o.t || 0) + i * step }));

const SOUNDS = {
  hover: () => tone({ f: 1200, a: .004, d: .02, g: .025, wet: .3 }),
  tick:  () => tone({ f: 880, d: .04, g: .06, wet: .3 }),
  click: () => { tone({ f: 523, a: .004, d: .12, g: .1, wet: .4 }); tone({ f: 784, d: .1, g: .04 }); },
  fav:   () => tone({ f: 784, f2: 1047, a: .01, d: .25, g: .08, wet: .5, glide: .06 }),
  unfav: () => tone({ f: 784, f2: 587, a: .01, d: .2, g: .06, wet: .4, glide: .06 }),
  add:   () => { noise({ f: 400, f2: 1600, ft: 'lowpass', a: .05, d: .35, g: .06 }); notes([523, 784], .08, { t: .08, d: .4, g: .05, wet: .5 }); },
  trash: () => noise({ f: 1200, f2: 300, q: 1.2, a: .02, d: .35, g: .25, wet: .4 }),
  undo:  () => { noise({ f: 300, f2: 1200, q: 1.2, a: .02, d: .3, g: .3, wet: .4 }); tone({ f: 784, t: .18, d: .25, g: .04, wet: .5 }); },
  open:  () => tone({ f: 392, f2: 587, a: .03, d: .35, g: .07, wet: .5, glide: .12 }),
  close: () => tone({ f: 587, f2: 392, a: .01, d: .25, g: .06, wet: .4, glide: .1 }),
  on:    () => { tone({ f: 659, a: .005, d: .15, g: .07, wet: .4 }); tone({ f: 988, t: .07, a: .005, d: .18, g: .07, wet: .4 }); },
  off:   () => { tone({ f: 988, a: .005, d: .15, g: .06, wet: .4 }); tone({ f: 659, t: .07, a: .005, d: .18, g: .06, wet: .4 }); },
  orbit: () => notes([262, 392, 523, 659], .05, { a: .08, d: .9, g: .035, wet: .6 }),
  done:  () => notes([523, 659, 784, 1047], .06, { d: .35, g: .05, wet: .5 }),
  error: () => { tone({ f: 311, d: .2, g: .07, wet: .3 }); tone({ f: 233, t: .12, d: .3, g: .07, wet: .3 }); },
  // after the categories of bencho.dev/sounds, synthesised in the same «Воздух» character:
  // whisk — a toast thrown away; latch — a destructive button arms; drift — a slider let go past its end
  whisk: () => noise({ f: 900, f2: 3800, q: .8, a: .03, d: .16, g: .14, wet: .25 }),
  latch: () => { tone({ f: 330, a: .002, d: .05, g: .09 }); noise({ f: 2400, q: 3, a: .001, d: .03, g: .08, t: .012 }); tone({ f: 247, t: .03, d: .12, g: .05, wet: .3 }); },
  drift: () => tone({ f: 660, f2: 520, a: .01, d: .14, g: .035, wet: .5, glide: .1 }),
};

let lastAt = 0;
const recent = new Map();
// Plays one interface sound. The same sound twice within 90 ms plays once (e.g. «Отменить» in a toast
// that also restores files from the trash).
export function sfx(name) {
  if (!settings.sound || document.hidden || !SOUNDS[name]) return;
  // hover never starts audio by itself: browsers only allow it after a click or a key press
  if (name === 'hover' && (!ac || ac.state !== 'running')) return;
  const now = performance.now();
  if (now - (recent.get(name) || 0) < 90) return;
  recent.set(name, now);
  lastAt = now;
  try { ctx(); SOUNDS[name](); } catch (e) { /* audio unavailable: stay silent */ }
}

// Default sounds for plain controls. A click gets a «tick» (tabs, lists, menus) or a «click» (buttons) —
// unless the action itself already played its own sound (opening the preview, trash, favourites…).
const TICK = '.tabs .chip, .nav, [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="option"], [role="radio"], .accs button';
export function initSound() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target : null;
    if (!t || t.closest('#grid')) return; // cards: selecting is too frequent to be voiced
    const start = performance.now();
    setTimeout(() => {
      if (lastAt >= start) return; // the action had its own sound
      if (t.closest(TICK)) sfx('tick');
      else if (t.closest('button, [role="button"]')) sfx('click');
    }, 0);
  }, true);
  // checkboxes and switches: on / off
  document.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') sfx(e.target.checked ? 'on' : 'off');
  }, true);
  // hover: barely audible, only on buttons and list rows, once per element
  let hov = null;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = e.target.closest && e.target.closest('button, .nav, [role="menuitem"], [role="option"]');
    if (b && b !== hov && !b.closest('#grid') && !b.disabled) sfx('hover');
    hov = b;
  }, { passive: true });
}
