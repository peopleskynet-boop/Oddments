// Startup and feature-opening timings of the built browser version (not the dev server: there every module is a
// separate request). Usage: npx vite build --mode web --outDir dist-web && npx vite preview --mode web --outDir dist-web
// --port 4180 & node tests/perf/measure.mjs http://127.0.0.1:4180  — median of N runs. BUDGET_KB=360 fails above it.
import { chromium } from '@playwright/test';
const BASE = process.argv[2] || 'http://127.0.0.1:4180', RUNS = +(process.argv[3] || 5);
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const b = await chromium.launch({ channel: 'msedge' });
const res = {};
const add = (k, v) => (res[k] ||= []).push(v);
for (let r = 0; r < RUNS; r++) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('m')) { sessionStorage.setItem('m', 1); localStorage.setItem('perch.settings', JSON.stringify({ v: 3, clean: false, sound: 0, anim: 'none' })); localStorage.setItem('perch.onboard', '{"hidden":true,"done":[]}'); } });
  const p = await ctx.newPage();
  let js = 0;
  p.on('response', async (resp) => { if (/\.js$/.test(resp.url()) && resp.request().resourceType() === 'script') { try { js += (await resp.body()).length; } catch (e) { /* */ } } });
  await p.goto(BASE + '/?empty');
  await p.getByRole('heading', { name: 'Соберите первые референсы' }).waitFor();
  const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
  add('script KB at start (empty library)', Math.round(js / 1024));
  add('DOMContentLoaded ms', Math.round(nav.dcl));
  add('first screen ms (empty library)', Math.round(await p.evaluate(() => performance.now())));
  await p.goto(BASE + '/');
  await p.getByRole('option').first().waitFor();
  if (process.env.SETTLE) await p.waitForTimeout(+process.env.SETTLE); // as in real use: a feature opened a few seconds after start
  const t = async (name, open, ready, close) => { const a = Date.now(); await open(); await ready(); add(name, Date.now() - a); if (close) await close(); };
  const esc = () => p.keyboard.press('Escape');
  await t('settings ms', () => p.getByRole('button', { name: 'Настройки' }).first().click(), () => p.getByRole('dialog', { name: 'Настройки' }).getByRole('heading').waitFor(), esc);
  await t('palette ms', () => p.keyboard.press('Control+Space'), () => p.getByRole('dialog', { name: 'Команды и поиск' }).waitFor(), esc);
  await p.getByRole('option').first().click();
  await t('preview ms', () => p.keyboard.press('Space'), () => p.locator('#pv.on').waitFor(), esc);
  await t('rename F2 ms', () => p.keyboard.press('F2'), () => p.getByRole('dialog').filter({ hasText: /Переимен/ }).first().waitFor(), esc);
  await t('icon constructor ms', async () => { await p.keyboard.press('Control+Space'); await p.getByRole('dialog', { name: 'Команды и поиск' }).getByRole('combobox').fill('Конструктор иконок'); await p.keyboard.press('Enter'); }, () => p.getByRole('dialog', { name: 'Конструктор иконок' }).waitFor(), esc);
  await ctx.close();
}
await b.close();
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(38), med(v), '  (' + v.join(', ') + ')');
// BUDGET_KB: the start-up code must stay under this (CI fails the build when a change makes the start heavier)
const budget = +(process.env.BUDGET_KB || 0), kb = med(res['script KB at start (empty library)'] || [0]);
if (budget && kb > budget) { console.error(`Код при запуске ${kb} КБ — больше бюджета ${budget} КБ`); process.exit(1); }
