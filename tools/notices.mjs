// THIRD_PARTY_NOTICES.md — what Oddments is built with and ships, and the full licence texts.
//   node tools/notices.mjs            — write it from package.json and node_modules (the npm part; commit the result)
//   node tools/notices.mjs --rust <cargo-metadata.json>
//                                     — CI, before the release build: put the Rust crates and their licence texts in
//                                       (`cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml`)
// The app shows the file in Settings › О программе › Лицензии, and the installer puts it next to the program.
// Edit the lists below, not the generated file.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRD_PARTY_NOTICES.md');
const RUST_MARK = '<!-- rust-crates -->';

// what each direct dependency does in Oddments (the summary table)
const USE = {
  '@crabnebula/tauri-plugin-drag': 'dragging files out of Oddments into other programs',
  '@fontsource-variable/geist': 'the Geist typeface',
  '@fontsource-variable/geist-mono': 'the Geist Mono typeface',
  '@fontsource-variable/golos-text': 'the Golos Text typeface (the interface)',
  '@fontsource-variable/onest': 'the Onest typeface',
  '@huggingface/tokenizers': 'the text side of AI search (SigLIP 2 tokenizer)',
  '@mozilla/readability': 'the article reader',
  '@phosphor-icons/core': 'interface icons',
  '@sparkjsdev/spark': 'Gaussian splats (viewer and thumbnails)',
  '@tauri-apps/api': 'the desktop app shell',
  '@tauri-apps/plugin-clipboard-manager': 'the clipboard',
  '@tauri-apps/plugin-dialog': 'file and folder dialogs',
  '@tauri-apps/plugin-fs': 'the library on disk',
  '@tauri-apps/plugin-http': 'network requests the person asked for',
  '@tauri-apps/plugin-opener': 'opening files and links',
  '@tauri-apps/plugin-process': 'restarting after an update',
  '@tauri-apps/plugin-updater': 'updates',
  'ag-psd': 'PSD previews',
  'clipper-lib': 'outline offsets in the icon constructor and SVG → 3D',
  comlink: 'background workers',
  dompurify: 'cleaning HTML from other sites',
  'figma-squircle': 'smooth corners',
  'onnxruntime-web': 'running the AI models on this computer',
  paper: 'vector editing in the icon constructor',
  'pdfjs-dist': 'PDF previews and viewing',
  three: '3D viewer, materials, SVG → 3D',
  xatlasjs: 'UV unwrapping',
};
// packages in the tree that never reach the app: type definitions and the Node-only canvas of ag-psd
const SKIP = (name) => name.startsWith('@types/') || name === 'undici-types' || name.startsWith('@napi-rs/');

// not from npm: models and pictures downloaded on first use, a bundled program, behaviour re-written from other projects
const EXTRA = `## Downloaded on first use · Скачивается при первом использовании

Nothing below is in the installer. Each is fetched from its own site only when the person turns the feature on, and
then lives in the app's data folder. With «Без сети» (Settings › О программе) none of it is fetched.

| What | Author | Licence | Source | Used for |
|---|---|---|---|---|
| SigLIP 2 large patch16-256 (ONNX) | Google; ONNX by onnx-community | Apache-2.0 | huggingface.co/onnx-community/siglip2-large-patch16-256-ONNX | AI search on this computer |
| PP-OCRv5 mobile det, eslav rec (ONNX) | PaddlePaddle | Apache-2.0 | huggingface.co/PaddlePaddle | text on pictures |
| Real-ESRGAN x4plus (ONNX) | Xintao Wang et al.; ONNX by imgdesignart | BSD-3-Clause | huggingface.co/imgdesignart/realesrgan-x4-onnx | upscaling ×2 / ×4 |
| BEN2 Base (ONNX) | Prama LLC | MIT | huggingface.co/PramaLLC/BEN2 | background removal |
| HDRI environments | Poly Haven | CC0 | polyhaven.com | lighting in the 3D viewer |

## Bundled program: AutoRemesher (Windows) · Программа в установщике

The Windows installer carries AutoRemesher 1.2.0 (© Jeremy Hu, MIT; github.com/huxingyi/autoremesher), unchanged, as a
separate program in \`autoremesher/\`. Oddments runs it by its command line for quad remeshing; the two are not linked.
Its build includes components under their own licences — among them **GPL-3.0** (CoMISo, libQEx, CGAL), LGPL-3.0 (the
Qt 5 libraries, as replaceable DLLs), MPL-2.0 (libigl, Eigen, OpenVDB), Apache-2.0 (oneTBB), BSD (Geogram, ANGLE,
OpenEXR, c-blosc), MIT (Mesa llvmpipe \`opengl32sw.dll\`, meshoptimizer, tinyobjloader) and the Microsoft Visual C++
runtime. The full texts are in \`autoremesher/LICENSE.txt\` and \`autoremesher/ACKNOWLEDGEMENTS.html\` next to the
program; the source code of that exact version is at github.com/huxingyi/autoremesher/tree/1.2.0. The Mac version
does not include it.

## Behaviour re-written from open components · Поведение по мотивам

Written anew in plain JavaScript after these projects; none of their code is included.

- **Arc** (uiarc.dev, MIT, © 2026 Elia Kuratli) — springs, the shared group highlight, the select list, the toast
  stack, the confirm button, the elastic slider, the command palette. Arc's Pro components were not used.
- **Beautiful UI** (beautifului.dev, MIT) — the pixel loader, the selection bar, the AI work steps.

## Add-ons · Плагины

The Blender add-on, the Figma plugin and the browser extension (\`integrations/\`) are part of Oddments, under its MIT
licence, and contain no third-party code. The Blender add-on runs inside Blender (GPL); MIT is compatible with it.
`;

// packages that ship no licence file: the standard text with the holder from the package or its sources
const MIT = (who) => `MIT License

Copyright (c) ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
const ISC = (who) => `ISC License

Copyright (c) ${who}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;
const BSL = (who) => `Copyright (c) ${who}

Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization obtaining a copy of the software and accompanying documentation covered by this license (the "Software") to use, reproduce, display, distribute, execute, and transmit the Software, and to prepare derivative works of the Software, and to permit third-parties to whom the Software is furnished to do so, all subject to the following:

The copyright notices in the Software and this entire statement, including the above license grant, this restriction and the following disclaimer, must be included in all copies of the Software, in whole or in part, and all derivative works of the Software, unless such copies or derivative works are solely in the form of machine-executable object code generated by a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
const NO_FILE = {
  '@crabnebula/tauri-plugin-drag': { licence: 'MIT OR Apache-2.0', text: MIT('2023 CrabNebula Ltd.') + '\n\n(Dual-licensed MIT OR Apache-2.0; distributed here under MIT.)' },
  'clipper-lib': { licence: 'BSL-1.0', text: BSL('2010-2017 Angus Johnson (Clipper); JavaScript translation by Timo') },
  'guid-typescript': { licence: 'ISC', text: ISC('nicolas (github.com/NicolasDeveloper/guid-typescript)') },
  'onnxruntime-web': { licence: 'MIT', text: MIT('Microsoft Corporation') },
  'onnxruntime-common': { licence: 'MIT', text: MIT('Microsoft Corporation') },
};

const read = (p) => readFileSync(p, 'utf8');
const pkgOf = (name) => JSON.parse(read(join(ROOT, 'node_modules', name, 'package.json')));
const licName = (p) => (typeof p.license === 'string' ? p.license : p.license && p.license.type) || (Array.isArray(p.licenses) ? p.licenses.map((l) => l.type || l).join(' OR ') : '') || 'see text';
const LIC_FILE = /^(licen[cs]e|copying|notice)([._-].*)?$/i;
const NOT_TEXT = /\.(spdx|js|json|html?)$/i;

function licenceTexts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => LIC_FILE.test(f) && !NOT_TEXT.test(f)).sort().map((f) => read(join(dir, f)).replace(/\r\n/g, '\n').trim()).filter(Boolean);
}

// the dependency tree of the app (dependencies, then theirs), as npm installed it
function npmTree() {
  const root = JSON.parse(read(join(ROOT, 'package.json')));
  const seen = new Map(), queue = Object.keys(root.dependencies || {});
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || SKIP(name)) continue;
    let p;
    try { p = pkgOf(name); } catch (e) { continue; } // an optional dependency for another platform
    let texts = licenceTexts(join(ROOT, 'node_modules', name)), licence = licName(p);
    // the Tauri plugins carry only LICENSE.spdx: the texts are those of @tauri-apps/api, from the same project
    if (!texts.length && name.startsWith('@tauri-apps/')) texts = licenceTexts(join(ROOT, 'node_modules', '@tauri-apps/api'));
    if (!texts.length && NO_FILE[name]) { texts = [NO_FILE[name].text]; licence = NO_FILE[name].licence; }
    seen.set(name, { name, version: p.version, licence, direct: name in (root.dependencies || {}), texts, url: repoUrl(p) });
    queue.push(...Object.keys(p.dependencies || {}));
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function repoUrl(p) {
  const r = typeof p.repository === 'string' ? p.repository : p.repository && p.repository.url;
  return (r || p.homepage || '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/');
}

// identical texts once, with every package that carries them
function textsSection(list, title) {
  const groups = new Map();
  for (const p of list) {
    const key = p.texts.join('\n\n---\n\n') || `(${p.licence}; no licence file in the package — see ${p.url || 'its repository'})`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${p.name} ${p.version}`);
  }
  let out = `## ${title}\n\n`;
  for (const [text, names] of groups) out += `### ${names.join(', ')}\n\n\`\`\`text\n${text.replace(/```/g, "'''")}\n\`\`\`\n\n`;
  return out;
}

function writeNpm() {
  const tree = npmTree();
  const direct = tree.filter((p) => p.direct), deps = tree.filter((p) => !p.direct);
  let md = `# Third-party notices · Сторонние компоненты

Oddments is distributed under the MIT licence (see LICENSE). It is built with, and ships, the components below; their
licences stay with their authors.
Сам Oddments распространяется под лицензией MIT (файл LICENSE). Ниже — сторонние библиотеки, модели и ресурсы, на
которых он построен, и полные тексты их лицензий.

This file is generated by \`tools/notices.mjs\` — edit the lists there.

## Libraries in the app · Библиотеки в приложении

| Package | Version | Licence | Used for |
|---|---|---|---|
${direct.map((p) => `| ${p.name} | ${p.version} | ${p.licence} | ${USE[p.name] || ''} |`).join('\n')}

Their own dependencies: ${deps.map((p) => `${p.name} ${p.version} (${p.licence})`).join(', ')}.

${EXTRA}
## Rust crates · Пакеты Rust

The desktop shell (Tauri 2 and its plugins, serde, serde_json and their dependencies) is written in Rust; almost all
of it is MIT or Apache-2.0. The release build lists every crate it contains, with its licence text, below.

${RUST_MARK}
_(In a source checkout this list is empty: it is filled in from Cargo's metadata when the installer is built.)_

${textsSection(tree, 'Licence texts of the npm packages · Тексты лицензий')}`;
  writeFileSync(OUT, md.replace(/\n{3,}/g, '\n\n'));
  console.log(`THIRD_PARTY_NOTICES.md: ${tree.length} npm packages, ${Math.round(md.length / 1024)} KB`);
}

function writeRust(metaFile) {
  const meta = JSON.parse(read(metaFile));
  const list = meta.packages.filter((p) => p.source) // published crates; the app's own package has no source
    .map((p) => {
      const dir = dirname(p.manifest_path);
      const texts = licenceTexts(dir);
      if (!texts.length && p.license_file) try { texts.push(read(join(dir, p.license_file)).trim()); } catch (e) { /* listed by name only */ }
      return { name: p.name, version: p.version, licence: p.license || 'see text', texts, url: p.repository || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const md = read(OUT);
  if (!md.includes(RUST_MARK)) throw new Error('THIRD_PARTY_NOTICES.md: нет метки ' + RUST_MARK + ' — сначала node tools/notices.mjs');
  const table = `| Crate | Version | Licence |\n|---|---|---|\n${list.map((p) => `| ${p.name} | ${p.version} | ${p.licence} |`).join('\n')}\n\n`;
  const out = md.replace(/<!-- rust-crates -->\n_\(In a source checkout[^\n]*\n/, table) + '\n' + textsSection(list, 'Licence texts of the Rust crates · Тексты лицензий Rust');
  writeFileSync(OUT, out);
  console.log(`THIRD_PARTY_NOTICES.md: + ${list.length} Rust crates, ${Math.round(out.length / 1024)} KB`);
}

const i = process.argv.indexOf('--rust');
if (i > 0) writeRust(process.argv[i + 1]); else writeNpm();
