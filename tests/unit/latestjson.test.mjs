// latest.json for the updater (tools/latest-json.mjs): platforms by installer name, download addresses, the version
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, platformsOf } from '../../tools/latest-json.mjs';

test('the Windows installer and the universal Mac app', () => {
  assert.deepEqual(platformsOf('Oddments_1.0.0_x64-setup.exe'), ['windows-x86_64']);
  assert.deepEqual(platformsOf('Oddments.app.tar.gz'), ['darwin-aarch64', 'darwin-x86_64']);
  assert.deepEqual(platformsOf('Oddments_aarch64.app.tar.gz'), ['darwin-aarch64']);
  assert.deepEqual(platformsOf('Oddments_1.0.0_universal.dmg'), []);
});

test('a release becomes latest.json', () => {
  const m = buildManifest({
    tag: 'v1.0.0', body: 'Первый выпуск', publishedAt: '2026-11-01T10:00:00Z', repo: 'peopleskynet-boop/Oddments',
    sigs: { 'Oddments_1.0.0_x64-setup.exe': 'SIGWIN\n', 'Oddments.app.tar.gz': 'SIGMAC' },
  });
  assert.equal(m.version, '1.0.0');
  assert.equal(m.notes, 'Первый выпуск');
  assert.equal(m.platforms['windows-x86_64'].signature, 'SIGWIN');
  assert.equal(m.platforms['windows-x86_64'].url, 'https://github.com/peopleskynet-boop/Oddments/releases/download/v1.0.0/Oddments_1.0.0_x64-setup.exe');
  assert.equal(m.platforms['darwin-x86_64'].url, m.platforms['darwin-aarch64'].url);
});

test('a release without signed installers is refused', () => {
  assert.throws(() => buildManifest({ tag: 'v1.0.0', repo: 'a/b', sigs: {} }), /\.sig/);
});
