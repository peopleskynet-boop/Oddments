// The start screen: the Oddments prism (cut from the app icon) condenses in a drop of clear glass, the drop lands and
// spreads into the icon's tile, its rim bends the prism into colour while it holds it, then the glass settles into the
// app icon, «Oddments» comes up under it and a light crosses the icon, running its rim through the prism colours.
// When the library is ready the icon flies into the sidebar's mark and the
// screen melts away, so the start leads straight into the app. The glass is ui/glassreveal.js (WebGL2, its own chunk);
// no intro when motion is off, and without WebGL2 the screen just fades.
import './boot.css';
import prismUrl from '../assets/oddments-prism.webp';

let el = null, glass = null, t0 = 0, gone = false, settled = null, settle = () => {};
const MAX = 7000; // never longer than this, whatever happens with the library
const SPEED = 1.2; // the reveal at 1 runs 3.5 s
const PLATE = '#0d1220'; // the tile of the app icon
const LOGO = 0.78; // the prism's size in the tile, as in the icon (the sidebar mark it flies into)
const NAME = 1000; // the name's entrance (boot.css, .8 s) and a moment to read it, ms

// the screen's colour as #rrggbb: the canvas paints the backdrop itself and must match the page around it
function hexOf(css) {
  const m = css.match(/[\d.]+/g);
  if (!m || m.length < 3) return '#0b0c10';
  return '#' + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('');
}

export function bootIntro() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let anim = 'smooth';
  try { anim = (JSON.parse(localStorage.getItem('perch.settings') || '{}').anim) || 'smooth'; } catch (e) { /* defaults */ }
  if (anim === 'none' || (anim === 'system' && reduce) || innerWidth < 2 || innerHeight < 2) return;
  t0 = performance.now();
  gone = false;
  settled = new Promise((res) => { settle = res; });
  el = document.createElement('div');
  el.className = 'boot2';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="b2-gl"></div><div class="b2-word">Oddments</div><div class="b2-tag">дом для любопытных вещей</div>';
  document.body.appendChild(el);
  const background = hexOf(getComputedStyle(el).backgroundColor);
  import('./glassreveal.js').then(({ mountGlassReveal }) => {
    if (!el) return settle();
    // the screen may leave once the glass is at rest and the name has been seen
    let rest = false, named = false;
    const both = () => { if (rest && named) settle(); };
    glass = mountGlassReveal(el.querySelector('.b2-gl'), {
      logo: prismUrl, look: 'dark', speed: SPEED, background, plateColor: PLATE, originalColors: true, keepPlate: true,
      logoScale: LOGO, gleam: 1, onEnd: () => { rest = true; both(); },
    });
    if (!glass) return settle();
    glass.ready.then(() => {
      if (!el) return;
      el.style.setProperty('--b2-h', Math.round(glass.plate(glass.duration).half) + 'px');
      // the name comes up under the tile once the glass has let go of the prism and the icon stands clear — by the
      // reveal itself, not a timer, which a slow first frame would leave behind
      glass.at(glass.letGo, () => {
        if (!el) return;
        el.classList.add('play');
        setTimeout(() => { named = true; both(); }, NAME);
      });
    }, (e) => { console.warn('boot', e); settle(); });
  }, (e) => { console.warn('boot', e); settle(); });
  // a safety net: whatever happens with the library, the screen never stays up
  setTimeout(() => bootDone(), MAX);
}

// the library is open: once the glass has settled into the icon and the name has been seen, the icon flies into the
// sidebar mark and all fades
export function bootDone() {
  if (!el || gone) return;
  gone = true;
  const left = Math.max(0, MAX - (performance.now() - t0));
  Promise.race([settled, new Promise((res) => setTimeout(res, left))]).then(() => setTimeout(leave, 160));
}

function leave() {
  if (!el) return;
  const gl = el.querySelector('.b2-gl'), mark = document.querySelector('.side .mark');
  const p = glass && glass.plate(), b = mark && mark.getBoundingClientRect();
  if (p && b && b.width && getComputedStyle(document.querySelector('.side')).visibility !== 'hidden') {
    // only the tile flies: the canvas around it is the backdrop, which melts with the screen
    const r = gl.getBoundingClientRect(), h = p.half, x = p.x - r.left, y = p.y - r.top;
    gl.style.clipPath = `inset(${y - h}px ${r.width - x - h}px ${r.height - y - h}px ${x - h}px round ${h * 0.46}px)`;
    gl.style.transformOrigin = `${x}px ${y}px`;
    const dx = b.left + b.width / 2 - p.x, dy = b.top + b.height / 2 - p.y, k = b.width / (2 * h);
    gl.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.2 }], { duration: 620, easing: 'cubic-bezier(.6, 0, .2, 1)', fill: 'forwards' });
  } else gl.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.82)', opacity: 0 }], { duration: 480, easing: 'ease-in', fill: 'forwards' });
  el.classList.add('out');
  setTimeout(() => { if (glass) glass.dispose(); glass = null; if (el) el.remove(); el = null; }, 760);
}
