// node who.mjs <width> <selector> <prop> [act]  — which rules set prop on the element
import { chromium } from 'playwright';
const [w, sel, prop, act] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await b.newContext({ viewport: { width: +w, height: 720 } })).newPage();
await page.addInitScript(() => { localStorage.setItem('perch.settings', JSON.stringify({ v: 3, clean: false, anim: 'none', sound: 0, facts: false, marathonOnce: true, theme: 'marathon' })); localStorage.setItem('perch.onboard', JSON.stringify({ hidden: true })); });
await page.goto('http://127.0.0.1:5173/'); await page.waitForSelector('.card'); await page.waitForTimeout(3000);
if (act === 'sel') await page.locator('.card').nth(2).click();
if (act === 'pv') { await page.locator('.card').nth(2).click(); await page.keyboard.press('Space'); }
await page.waitForTimeout(1000);
console.log(await page.evaluate(([sel, prop]) => {
  const el = document.querySelector(sel); if (!el) return 'no element';
  const out = [];
  const walk = (rules, ctx, href) => { for (const r of rules) {
    if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules, ctx + (r.name !== undefined ? ' @layer ' + r.name : r.conditionText ? ' @' + r.conditionText : ''), href);
    if (r instanceof CSSStyleRule) { try { if (el.matches(r.selectorText) && r.style.getPropertyValue(prop)) out.push(`${href.split('/').pop()}${ctx} :: ${r.selectorText.slice(0, 140)} → ${r.style.getPropertyValue(prop)}${r.style.getPropertyPriority(prop) ? ' !' : ''}`); } catch {} }
  } };
  for (const s of document.styleSheets) walk(s.cssRules, '', s.href || (s.ownerNode && s.ownerNode.dataset.viteDevId) || 'inline');
  return out.join('\n') + '\n= ' + getComputedStyle(el).getPropertyValue(prop);
}, [sel, prop]));
await b.close();
