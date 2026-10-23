// Every test starts from a fresh demo library (the browser build builds it in memory on each load) and a fresh
// browser context: settings without the clean screen, animations and sound; the «Знакомство» card hidden.
import { test as base } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { LibraryPage } from '../pages/library.page.js';
import { QUIET_SETTINGS } from '../utils/test-data.js';

// The exe's Content-Security-Policy (src-tauri/tauri.conf.json), served with every page in the tests: a module that
// needs eval (paper-full did — bug #60) or a remote picture without remote.js fails here, not first in the exe.
// connect-src is widened to https: here: in the browser build plugin-http is a plain fetch, while the exe sends those
// requests through the app (IPC), past the CSP — what matters for the CSP is scripts (eval), styles and workers.
const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const CSP = Object.entries(conf.app.security.csp)
  .map(([k, v]) => `${k} ${k === 'connect-src' ? v + ' ws://127.0.0.1:5173 http://127.0.0.1:5173 https:' : v}`).join('; ');

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route((url) => url.origin === 'http://127.0.0.1:5173', async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const r = await route.fetch();
      await route.fulfill({ response: r, headers: { ...r.headers(), 'content-security-policy': CSP } });
    });
    const csp = [];
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text()) && /script-src|unsafe-eval|style-src|worker-src/.test(m.text())) csp.push(m.text().slice(0, 200)); });
    await page.addInitScript((s) => {
      if (sessionStorage.getItem('perch.e2e')) return; // only on the first load: a test may change settings and reload
      sessionStorage.setItem('perch.e2e', '1');
      localStorage.setItem('perch.settings', JSON.stringify(s));
      localStorage.setItem('perch.onboard', JSON.stringify({ done: [], hidden: true, finished: false }));
    }, QUIET_SETTINGS);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    // an uncaught exception fails the test even when the screen looked right
    if (errors.length) throw new Error('Ошибки на странице: ' + errors.join(' | '));
    // a script or a connection the exe would refuse
    if (csp.length) throw new Error('Нарушение CSP (в exe не сработает): ' + csp.join(' | '));
  },
  library: async ({ page }, use) => {
    const lib = new LibraryPage(page);
    await lib.goto();
    await use(lib);
  },
});

export { expect } from '@playwright/test';
