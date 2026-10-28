// Warm-up of the dev server before the E2E tests in CI (tests.yml): on a cold runner the first page load transforms
// every module and pre-bundles the dependencies — a minute or more, longer than a test may wait, so every test failed
// by timeout. One full load here (until the cards are on screen, the lazy screens too) and the tests start warm.
//   node tests/perf/warmup.mjs http://127.0.0.1:5173
import { chromium } from '@playwright/test';
const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const t0 = Date.now();
for (;;) { // the server itself first
  try { const r = await fetch(BASE); if (r.ok) break; } catch (e) { /* not up yet */ }
  if (Date.now() - t0 > 180000) { console.error('сервер не поднялся за 3 минуты'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1000));
}
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage();
await p.goto(BASE, { timeout: 240000 });
await p.waitForSelector('.card', { timeout: 240000 });
// the screens tests open lazily: load their modules once too
await p.evaluate(() => Promise.all(['/src/ui/feed.js', '/src/ui/news.js', '/src/ui/iconkit.js', '/src/ui/plugins.js', '/src/ui/rename.js', '/src/ui/palette.js'].map((m) => import(m).catch(() => null))));
console.log(`прогрев: ${Math.round((Date.now() - t0) / 1000)} с`);
await b.close();
