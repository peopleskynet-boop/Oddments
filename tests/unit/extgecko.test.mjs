// The browser extension for Zen and Firefox (src/lib/extgecko.js): the Chrome manifest turned into a Gecko one
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { geckoManifest, geckoSkips, GECKO_ID } from '../../src/lib/extgecko.js';

const chrome = JSON.parse(fs.readFileSync(new URL('../../integrations/browser/manifest.json', import.meta.url), 'utf8'));

test('the Gecko manifest: an event page, its own id, no offscreen or tabCapture', () => {
  const g = geckoManifest(chrome);
  assert.deepEqual(g.background, { scripts: ['background.js'], type: 'module' });
  assert.equal(g.browser_specific_settings.gecko.id, GECKO_ID);
  assert.ok(!g.permissions.includes('offscreen') && !g.permissions.includes('tabCapture'));
  assert.ok(g.permissions.includes('scripting') && g.permissions.includes('downloads'));
  assert.equal('minimum_chrome_version' in g, false);
  assert.equal(g.version, chrome.version);
  assert.deepEqual(g.commands, chrome.commands);
  // the Chrome manifest itself is left as it was
  assert.equal(chrome.background.service_worker, 'background.js');
  assert.ok(chrome.permissions.includes('tabCapture'));
});

test('at most four suggested keys (Chrome and Firefox give no more), none of the ones Chrome keeps for itself', () => {
  const keys = Object.values(chrome.commands).map((c) => c.suggested_key && c.suggested_key.default).filter(Boolean);
  assert.ok(keys.length <= 4);
  for (const k of keys) assert.ok(!/^Alt\+Shift\+[AXZC]$/.test(k), k);
});

test('the offscreen recorder stays out of the .xpi', () => {
  assert.equal(geckoSkips('offscreen.js'), true);
  assert.equal(geckoSkips('offscreen.html'), true);
  assert.equal(geckoSkips('content.js'), false);
  assert.equal(geckoSkips('fonts/golos-latin.woff2'), false);
});
