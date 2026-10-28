// The start screen: the Oddments prism as liquid glass. The brand's colours (Sky, Lavender, Pink, a spark of Lime) flow
// as soft blobs behind and inside the glass — the moving colour field of Apple Music's identity, seen through our own
// mark; a light sweeps across the glass, «Oddments» settles under it. When the library is ready the prism flies into the
// sidebar's mark and the screen melts away, so the start leads straight into the app. No intro when motion is off.
import './boot.css';

let el = null, t0 = 0, gone = false;
const MIN = 1500, MAX = 7000; // shown at least this long (the story needs it), never longer than this

// a rounded triangle (apex up) around (cx, cy) with circumradius R and corner radius r → SVG path
function tri(cx, cy, R, r) {
  const pts = [0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  let d = '';
  for (let i = 0; i < 3; i++) {
    const p = pts[i], prev = pts[(i + 2) % 3], next = pts[(i + 1) % 3];
    const u = (q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    const a = u(prev), b = u(next), k = r / Math.tan(Math.PI / 6); // distance from the corner to the tangent points (60° corners)
    const s = [p[0] + a[0] * k, p[1] + a[1] * k], e = [p[0] + b[0] * k, p[1] + b[1] * k];
    d += (i ? 'L' : 'M') + s[0].toFixed(2) + ' ' + s[1].toFixed(2) + 'Q' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ' ' + e[0].toFixed(2) + ' ' + e[1].toFixed(2);
  }
  return d + 'Z';
}

export function bootIntro() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let anim = 'smooth';
  try { anim = (JSON.parse(localStorage.getItem('perch.settings') || '{}').anim) || 'smooth'; } catch (e) { /* defaults */ }
  if (anim === 'none' || (anim === 'system' && reduce) || innerWidth < 2 || innerHeight < 2) return;
  t0 = performance.now();
  const ring = tri(120, 128, 104, 22) + tri(120, 142, 46, 8); // the prism: an outer triangle with a triangular cut
  el = document.createElement('div');
  el.className = 'boot2';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="b2-field"><i class="b2-blob sky"></i><i class="b2-blob lav"></i><i class="b2-blob pink"></i><i class="b2-blob lime"></i></div>
    <div class="b2-stage">
      <svg class="b2-prism" viewBox="0 0 240 240" width="240" height="240">
        <defs>
          <clipPath id="b2clip"><path d="${ring}" clip-rule="evenodd"/></clipPath>
          <linearGradient id="b2edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#d6b4ff" stop-opacity=".35"/><stop offset="1" stop-color="#a7c7ff" stop-opacity=".8"/></linearGradient>
          <linearGradient id="b2sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
          <filter id="b2blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
        </defs>
        <g clip-path="url(#b2clip)">
          <rect width="240" height="240" fill="#1d2536"/>
          <g filter="url(#b2blur)" class="b2-in">
            <circle class="b2-c c1" cx="58" cy="196" r="58" fill="#a7c7ff"/>
            <circle class="b2-c c2" cx="176" cy="176" r="56" fill="#d6b4ff"/>
            <circle class="b2-c c3" cx="120" cy="54" r="42" fill="#ffc7eb"/>
            <circle class="b2-c c4" cx="196" cy="214" r="16" fill="#d7ff63" opacity=".9"/>
          </g>
          <!-- volume: the glass darkens towards its edges and catches light on the upper ones -->
          <path d="${ring}" fill="none" stroke="#0b0c10" stroke-opacity=".38" stroke-width="10"/>
          <path d="${ring}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" transform="translate(-1.2 -1.6)"/>
          <rect class="b2-sweep" x="-160" y="-40" width="110" height="320" fill="url(#b2sweep)" transform="rotate(24 120 120)"/>
        </g>
        <path d="${ring}" fill-rule="evenodd" fill="none" stroke="url(#b2edge)" stroke-width="2.2"/>
        <path d="${tri(120, 128, 98, 19)}" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1"/>
      </svg>
      <div class="b2-word">Oddments</div>
      <div class="b2-tag">дом для любопытных вещей</div>
    </div>`;
  document.body.appendChild(el);
  // a safety net: whatever happens with the library, the screen never stays up
  setTimeout(() => bootDone(), MAX);
}

// the library is open: once the intro has played long enough, the prism flies into the sidebar mark and all fades
export function bootDone() {
  if (!el || gone) return;
  gone = true;
  const wait = Math.max(0, MIN - (performance.now() - t0));
  setTimeout(() => {
    const prism = el.querySelector('.b2-prism'), mark = document.querySelector('.side .mark');
    const a = prism.getBoundingClientRect(), b = mark && mark.getBoundingClientRect();
    if (b && b.width && getComputedStyle(document.querySelector('.side')).visibility !== 'hidden') {
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), k = b.width / a.width;
      prism.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0.2 }], { duration: 620, easing: 'cubic-bezier(.6, 0, .2, 1)', fill: 'forwards' });
    } else prism.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.82)', opacity: 0 }], { duration: 480, easing: 'ease-in', fill: 'forwards' });
    el.classList.add('out');
    setTimeout(() => { if (el) el.remove(); el = null; }, 760);
  }, wait);
}
