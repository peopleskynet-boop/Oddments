// Computed-style snapshot of the web build across many screens and themes, to prove a CSS refactor changes nothing.
// node snap.mjs <outdir>   (the dev server must run on 5173)
import { chromium } from 'playwright';
import fs from 'fs';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[3] ? new RegExp(process.argv[3]) : null;
const BASE = 'http://127.0.0.1:5173/';
const QUIET = { v: 3, clean: false, anim: 'none', sound: 0, facts: false, marathonOnce: true };

const imp = (p, fn, ...a) => async (page) => page.evaluate(([p, fn, a]) => import(p).then((m) => m[fn](...a)), [p, fn, a]);
const click = (sel) => async (page) => { await page.locator(sel).first().click(); };
const sel1 = async (page) => { await page.locator('.card').nth(2).click(); };
const STATES = [];
for (const theme of ['marathon', 'dark', 'light', 'calm']) {
  STATES.push({ name: `${theme}-home`, theme });
  STATES.push({ name: `${theme}-sel`, theme, act: [sel1] });
  STATES.push({ name: `${theme}-preview`, theme, act: [sel1, async (p) => p.keyboard.press('Space')] });
  STATES.push({ name: `${theme}-settings`, theme, act: [click('#setBtn')] });
  STATES.push({ name: `${theme}-ctx`, theme, act: [async (p) => p.locator('.card').nth(1).click({ button: 'right' })] });
  STATES.push({ name: `${theme}-palette`, theme, act: [async (p) => p.keyboard.press('Control+Space')] });
}
STATES.push({ name: 'marathon-feed', theme: 'marathon', act: [imp('/src/ui/lazy.js', 'openFeed')] });
STATES.push({ name: 'marathon-news', theme: 'marathon', act: [imp('/src/ui/lazy.js', 'openNews', 'saved')] });
STATES.push({ name: 'marathon-digest', theme: 'marathon', act: [imp('/src/ui/lazy.js', 'openNews', 'digest')] });
STATES.push({ name: 'marathon-plugins', theme: 'marathon', act: [imp('/src/ui/plugins.js', 'openPlugins')] });
STATES.push({ name: 'marathon-iconkit', theme: 'marathon', act: [imp('/src/ui/iconkit.js', 'openIconKit')] });
STATES.push({ name: 'light-iconkit', theme: 'light', act: [imp('/src/ui/iconkit.js', 'openIconKit')] });
STATES.push({ name: 'marathon-dupes', theme: 'marathon', act: [imp('/src/ui/lazy.js', 'openDupes')] });
STATES.push({ name: 'marathon-tidy', theme: 'marathon', act: [imp('/src/ui/lazy.js', 'openTidy')] });
STATES.push({ name: 'marathon-keys', theme: 'marathon', act: [async (p) => p.keyboard.press('Shift+Slash')] });
STATES.push({ name: 'marathon-color', theme: 'marathon', act: [click('#filtBtn')] });
STATES.push({ name: 'marathon-model', theme: 'marathon', act: [async (p) => { await p.locator('.card', { hasText: 'Узел' }).first().click(); await p.keyboard.press('Space'); }] });
STATES.push({ name: 'marathon-svg3d', theme: 'marathon', act: [imp('/src/ui/svg3d.js', 'pickSvgFor3d')] });
STATES.push({ name: 'marathon-narrow', theme: 'marathon', w: 820, h: 720, act: [sel1] });
STATES.push({ name: 'marathon-clean', theme: 'marathon', clean: true });
STATES.push({ name: 'marathon-multi', theme: 'marathon', act: [sel1, async (p) => p.locator('.card').nth(3).click({ modifiers: ['Control'] })] });
STATES.push({ name: 'marathon-trash', theme: 'marathon', act: [async (p) => p.evaluate(() => import('/src/lib/filter.js').then((m) => m.setView && m.setView('trash')))] });

const PROPS = ['display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'color', 'background-color', 'background-image',
  'border-top-color', 'border-top-width', 'border-left-width', 'border-bottom-width', 'border-radius', 'box-shadow', 'opacity', 'visibility',
  'transform', 'translate', 'scale', 'filter', 'backdrop-filter', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-transform',
  'padding-top', 'padding-left', 'padding-right', 'padding-bottom', 'margin-top', 'margin-left', 'margin-right', 'margin-bottom', 'z-index', 'gap',
  'pointer-events', 'outline-style', 'outline-color', 'mask-image', 'transition-property', 'transition-duration', 'animation-name', 'overflow-x',
  'overflow-y', 'mix-blend-mode', 'clip-path', 'cursor', 'line-height', 'text-align', 'justify-content', 'align-items', 'flex-direction',
  'grid-template-columns', 'white-space', 'text-overflow', 'inset', 'content', 'fill', 'stroke', 'object-fit', 'aspect-ratio'];
const PSEUDO = ['content', 'display', 'position', 'background-color', 'background-image', 'opacity', 'mask-image', 'box-shadow', 'filter', 'border-radius', 'width', 'height', 'transform'];

const b = await chromium.launch({ channel: 'msedge', headless: true });
for (const st of STATES) {
  if (ONLY && !ONLY.test(st.name)) continue;
  const ctx = await b.newContext({ viewport: { width: st.w || 1440, height: st.h || 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(([s]) => {
    localStorage.setItem('perch.settings', JSON.stringify(s));
    localStorage.setItem('perch.onboard', JSON.stringify({ done: [], hidden: true, finished: false }));
    localStorage.setItem('perch.lang', 'ru');
    Math.random = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  }, [{ ...QUIET, theme: st.theme, clean: !!st.clean }]);
  await page.goto(BASE);
  await page.waitForSelector('.card', { timeout: 60000 });
  await page.waitForTimeout(2500);
  for (const a of st.act || []) { await a(page); await page.waitForTimeout(900); }
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1800);
  const snap = await page.evaluate(([PROPS, PSEUDO]) => {
    const out = {};
    const keyOf = (el) => {
      const parts = [];
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        let k = e.tagName.toLowerCase();
        if (e.id) { k += '#' + e.id; parts.unshift(k); break; }
        const cls = [...e.classList].filter((c) => !/^(hov|kbd)$/.test(c)).sort().join('.');
        if (cls) k += '.' + cls;
        const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : [];
        if (sib.length > 1) k += ':' + sib.indexOf(e);
        parts.unshift(k);
      }
      return parts.join('>');
    };
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const k = keyOf(el);
      const cs = getComputedStyle(el);
      const v = {};
      for (const p of PROPS) v[p] = cs.getPropertyValue(p);
      for (const ps of ['::before', '::after']) {
        const c = getComputedStyle(el, ps);
        if (c.content && c.content !== 'none' && c.content !== 'normal') for (const p of PSEUDO) v[ps + p] = c.getPropertyValue(p);
      }
      out[k] = v;
    }
    return out;
  }, [PROPS, PSEUDO]);
  await page.screenshot({ path: `${OUT}/${st.name}.png` });
  fs.writeFileSync(`${OUT}/${st.name}.json`, JSON.stringify(snap));
  console.log(st.name, Object.keys(snap).length, errs.length ? 'ERR ' + errs.join('|').slice(0, 200) : '');
  await ctx.close();
}
await b.close();
