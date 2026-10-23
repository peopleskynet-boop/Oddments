// Pixel-grid loader with a shimmering label and the seconds counting up — after «Loading State» from Beautiful UI
// (beautifului.dev, MIT): nine pixels light up in a pattern, the words shimmer, the time ticks. Plain JS on Oddments
// tokens (the pixels take the accent: lime in «Марафон»). Without animations the pixels just stand half lit.
//   pixGrid('drive' | 'orbit' | 'scan')  → markup of the 3×3 grid alone (for rows and buttons)
//   pixLoader(label, { variant, time })   → { el, set(label), stop() } with the elapsed time
const STEP = {
  drive: [0, 1, 2, 1, 2, 3, 2, 3, 4].map((d) => d * 90),      // a diagonal wave
  orbit: [0, 1, 2, 7, -1, 3, 6, 5, 4].map((d) => d < 0 ? -1 : d * 81), // around the edge, the middle stays dark
  scan: [0, 0, 0, 1, 1, 1, 2, 2, 2].map((d) => d * 150),     // row by row, like reading
};

export function pixGrid(variant = 'drive') {
  const d = STEP[variant] || STEP.drive;
  return `<span class="pxl pxl-${variant}" aria-hidden="true">${d.map((ms) => ms < 0 ? '<i class="off"></i>' : `<i style="animation-delay:${ms}ms"></i>`).join('')}</span>`;
}

// «12,4 с», «1 мин 05 с»
export function elapsed(ms) {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1).replace('.', ',') + ' с';
  const m = Math.floor(s / 60);
  return `${m} мин ${String(Math.floor(s % 60)).padStart(2, '0')} с`;
}

export function pixLoader(label, { variant = 'drive', time = true } = {}) {
  const el = document.createElement('span');
  el.className = 'pxload';
  el.setAttribute('role', 'status');
  el.innerHTML = `${pixGrid(variant)}<span class="shim"></span>${time ? '<span class="pxl-t"></span>' : ''}`;
  const lab = el.querySelector('.shim'), t = el.querySelector('.pxl-t');
  const t0 = performance.now();
  let timer = 0;
  const tick = () => { if (t) t.textContent = elapsed(performance.now() - t0); };
  const set = (s) => { lab.textContent = s; };
  set(label);
  if (t) { tick(); timer = setInterval(tick, 100); }
  return { el, set, since: () => performance.now() - t0, stop() { clearInterval(timer); } };
}
