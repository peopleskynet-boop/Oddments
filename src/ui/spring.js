// Springs as CSS. The presets come from Arc's motion tokens (uiarc.dev, MIT, © 2026 Elia Kuratli):
// snappy for presses and small indicators, smooth for panels (never overshoots), morph for shared
// highlights and width changes. Each spring is solved once and written to :root as a `linear()` easing
// plus its settle time, so plain CSS transitions and WAAPI get real spring motion without a library:
//   transition: translate var(--sp-morph-t) var(--sp-morph);
const PRESETS = {
  snappy: { visualDuration: 0.26, bounce: 0.12 },
  smooth: { visualDuration: 0.4, bounce: 0 },
  morph: { visualDuration: 0.42, bounce: 0.16 },
};

// motion's conversion from visual duration + bounce to stiffness/damping (mass 1)
function solve({ visualDuration, bounce }) {
  const root = (2 * Math.PI) / (visualDuration * 1.2), k = root * root;
  const zeta = Math.min(1, Math.max(0.05, 1 - bounce)), w0 = Math.sqrt(k);
  let x;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else x = (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  // settle: the last moment the curve is further than 0.1 % from rest
  let end = visualDuration;
  for (let t = 0; t < 4; t += 0.004) if (Math.abs(x(t) - 1) > 0.001) end = t;
  end = Math.max(end, visualDuration);
  const n = 48, pts = [];
  for (let i = 0; i <= n; i++) pts.push(+(i === n ? 1 : x((end * i) / n)).toFixed(4));
  return { easing: `linear(${pts.join(', ')})`, ms: Math.round(end * 1000) };
}

export const SPRINGS = {};
for (const [name, p] of Object.entries(PRESETS)) SPRINGS[name] = solve(p);

export function initSprings() {
  const s = document.documentElement.style;
  for (const [name, v] of Object.entries(SPRINGS)) {
    s.setProperty(`--sp-${name}`, v.easing);
    s.setProperty(`--sp-${name}-t`, v.ms + 'ms');
  }
}
