// The layout grid of «Марафон» and «Тишина» (after haoqi.design): thin lines through the middle of every gutter
// between the columns of the wall, a few rows across the window and a small + at each crossing. It sits under
// the cards (and under the glass panels), so the pictures stand exactly between the lines. In «Марафон» an accent-coloured
// tick on the edges follows the cursor. Drawn on one canvas; redrawn after a relayout, a resize or a theme change.
let canvas = null, geo = null, mx = -1, my = -1, queued = false;

const on = () => { const t = document.documentElement.dataset.theme; return t === 'marathon' || t === 'calm'; };

export function initFrame() {
  canvas = document.createElement('canvas');
  canvas.id = 'frame';
  canvas.setAttribute('aria-hidden', 'true');
  const main = document.getElementById('main');
  main.insertBefore(canvas, main.firstChild);
  addEventListener('resize', redrawFrame);
  addEventListener('pointermove', (e) => {
    if (document.documentElement.dataset.theme !== 'marathon') return;
    mx = e.clientX; my = e.clientY;
    redrawFrame();
  }, { passive: true });
}

// cols / colW / gap come from the masonry layout; host is the grid element, read live on every frame: after a
// relayout the grid may still be sliding into place (the reflow animation), and the lines follow it for a moment
// instead of jumping ahead and leaving the cards off the lines
let follow = 0;
export function setFrameGeometry(g) {
  geo = g; follow = performance.now() + 800;
  const loop = () => { draw(); if (performance.now() < follow) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

export function redrawFrame() {
  if (!canvas || queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; draw(); });
}

// theme colours may be color-mix() of the accent; a probe element turns them into plain rgb for the canvas
let probe = null;
function resolve(v) {
  if (!probe) { probe = document.createElement('i'); probe.style.display = 'none'; document.body.appendChild(probe); }
  probe.style.color = '';
  probe.style.color = `var(${v})`;
  return getComputedStyle(probe).color;
}

function draw() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const x = canvas.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, W, H);
  if (!on() || !geo) return;
  const st = getComputedStyle(document.documentElement);
  const line = resolve('--line'), hud = resolve('--hud') || resolve('--fg');
  const { cols, colW, gap } = geo, left = geo.host ? geo.host.getBoundingClientRect().left : geo.left;
  const xs = [left - gap / 2];
  for (let c = 1; c < cols; c++) xs.push(left + c * (colW + gap) - gap / 2);
  xs.push(left + cols * colW + (cols - 1) * gap + gap / 2);
  const top = parseFloat(st.getPropertyValue('--barh')) + 20;
  const ys = [top, top + (H - top) * 0.36, top + (H - top) * 0.7, H - 40];
  x.lineWidth = 1;
  x.strokeStyle = line;
  x.beginPath();
  xs.forEach((X) => { X = Math.round(X) + 0.5; x.moveTo(X, 0); x.lineTo(X, H); });
  ys.forEach((Y) => { Y = Math.round(Y) + 0.5; x.moveTo(0, Y); x.lineTo(W, Y); });
  x.stroke();
  // the + marks: stronger than the lines, the theme's HUD colour
  x.strokeStyle = hud;
  x.globalAlpha = document.documentElement.dataset.theme === 'calm' ? 0.32 : 0.55;
  // the arms stay inside the gutter, so the cards (and the selection ring) never cover a +
  const arm = Math.max(2.5, Math.min(5, gap / 2 - 2.5));
  x.beginPath();
  xs.forEach((X) => ys.forEach((Y) => { X = Math.round(X) + 0.5; Y = Math.round(Y) + 0.5; x.moveTo(X - arm, Y); x.lineTo(X + arm, Y); x.moveTo(X, Y - 5); x.lineTo(X, Y + 5); }));
  x.stroke();
  x.globalAlpha = 1;
  if (mx >= 0 && document.documentElement.dataset.theme === 'marathon') {
    x.fillStyle = hud; x.globalAlpha = 0.7;
    x.fillRect(Math.round(mx), 0, 1, 7); x.fillRect(Math.round(mx), H - 7, 1, 7); x.fillRect(0, Math.round(my), 7, 1);
    x.globalAlpha = 1;
  }
}
