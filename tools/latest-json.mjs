// latest.json for the app's updater (tauri-plugin-updater) from a published GitHub release:
//   node tools/latest-json.mjs <release.json> <dir with the downloaded *.sig files> > latest.json
// release.json is `gh release view <tag> --json tagName,body,publishedAt`; the repository comes from GITHUB_REPOSITORY.
// Every installer the builds attached has its .sig next to it (signed with the project's updater key): the Windows
// setup.exe and the Mac Oddments.app.tar.gz (universal — the same file for Apple Silicon and Intel).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// which updater platforms a file serves, by its name
export function platformsOf(name) {
  if (/-setup\.exe$/i.test(name)) return ['windows-x86_64'];
  if (/\.app\.tar\.gz$/i.test(name)) {
    if (/aarch64|arm64/i.test(name)) return ['darwin-aarch64'];
    if (/x86_64|x64/i.test(name)) return ['darwin-x86_64'];
    return ['darwin-aarch64', 'darwin-x86_64'];
  }
  return [];
}

// sigs: { '<installer file name>': '<content of its .sig>' }
export function buildManifest({ tag, body = '', publishedAt = '', repo, sigs }) {
  const platforms = {};
  for (const [name, signature] of Object.entries(sigs)) {
    for (const p of platformsOf(name)) {
      platforms[p] = { signature: signature.trim(), url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}` };
    }
  }
  if (!Object.keys(platforms).length) throw new Error('в выпуске нет подписанных установщиков (*.sig) — собран без ключа обновлений?');
  return { version: String(tag).replace(/^v/, ''), notes: body, pub_date: publishedAt || new Date().toISOString(), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [relFile, dir] = process.argv.slice(2);
  const rel = JSON.parse(readFileSync(relFile, 'utf8'));
  const sigs = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.sig')) sigs[f.slice(0, -4)] = readFileSync(join(dir, f), 'utf8');
  const out = buildManifest({ tag: rel.tagName, body: rel.body, publishedAt: rel.publishedAt, repo: process.env.GITHUB_REPOSITORY, sigs });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
