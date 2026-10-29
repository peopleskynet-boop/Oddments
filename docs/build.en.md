**Русский:** [build.md](build.md)

# Building Oddments from source

The stack: [Tauri 2](https://tauri.app) + Vite + plain JavaScript (ES modules, no framework). Rust is a thin layer:
the Tauri plugins, a local receiver for the integrations (`src-tauri/src/bridge.rs`), running Blender and AutoRemesher,
MCP, the tray, writing crashes down.

## What to install

- **Node.js 22** — https://nodejs.org
- **Rust** (stable) — https://rustup.rs
- **Windows:** Microsoft C++ Build Tools («Desktop development with C++»), WebView2 (already in Windows 11 and recent
  Windows 10).
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).

## Running

```bash
npm ci
npm run tauri dev
```

The first Rust build takes 5–15 minutes, later ones are faster.

## The browser build for interface work

```bash
npm run web
```

It opens http://127.0.0.1:5173. The `@tauri-apps/*` modules are replaced by stand-ins from `src/web/` (an in-memory
file system, a demo library of procedural pictures, models and materials). The app's code does not know about it.

- `?n=5000` — a big library to check scrolling, `?empty` — an empty one, `?welcome` — the first-run window.
- Whatever you add lives until the page reloads.
- Not in the browser build: Blender, AutoRemesher, the integration receiver, MCP, dragging files out, updates.

## The installer

```bash
npm run tauri build
```

Windows — `src-tauri/target/release/bundle/nsis/*.exe`, Mac — `src-tauri/target/<target>/release/bundle/dmg/*.dmg`.

AutoRemesher (remeshing models, Windows only) is not kept in git: before the build it is unpacked into
`src-tauri/resources/autoremesher/` — CI does that, see the «AutoRemesher» step in `.github/workflows/build-windows.yml`.
Without it the app builds and runs, «Remesh» is just unavailable.

The update files (`.sig`) come only with the updater key:
`npm run tauri build -- --config src-tauri/tauri.updater.conf.json` with `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set ([signing.en.md](signing.en.md)). Without the key the build is the same, it
just cannot be offered to installed copies as an update.

### Building in GitHub Actions

- «Сборка установщика для Windows» and «Сборка для Mac» run by hand (Actions → Run workflow) or on a pushed `v*` tag.
  A tag makes a draft release with the installers — check it and publish it; after publishing, the «Файлы выпуска»
  workflow attaches `latest.json` for the updater and the Blender extension repository.
- The Mac build is universal (Apple Silicon + Intel). When `macos-latest` machines are short, pick `macos-15-intel`
  when starting it.
- Windows and Mac signing turn on with repository secrets — [signing.en.md](signing.en.md). Without them the builds
  are unsigned: SmartScreen and Gatekeeper ask on the first start.
- Before the build CI adds the Rust crates with their licence texts to `THIRD_PARTY_NOTICES.md`
  (`tools/notices.mjs --rust`).

## Third-party licences

`THIRD_PARTY_NOTICES.md` is generated: `node tools/notices.mjs` — after adding or updating an npm package. The lists of
models, programs and the notes are in the script itself.

## Tests

```bash
npm run test:unit
npm run test:e2e
```

- `test:unit` — checks of the pure modules, no browser (`tests/unit`).
- `test:e2e` — Playwright over the browser build in an installed Microsoft Edge (the engine of WebView2). The network is
  blocked in the tests, API answers are mocked. In CI the tests run by hand: Actions → «Тесты интерфейса».

## Layout

```
src/main.js            start-up, events, Ctrl+V, drag and drop, keys
src/state.js           state, file types
src/lib/               the library on disk, import and thumbnails, search, AI, 3D, materials, icons, the feed,
                       updates (updater.js), «Offline» (net.js), the crash report (crashlog.js), Eagle and PureRef
src/ui/                the interface: grid, sidebar, preview, player, icon constructor, feed, plugins, settings,
                       the first run (welcome.js)…
src/web/               Tauri stand-ins for the browser build
src-tauri/             Rust: plugins, the integration receiver, Blender, AutoRemesher, MCP, tray
integrations/blender   the Blender add-on (perch_blender.py)
integrations/figma     the Figma plugin
integrations/browser   the extension for Chrome, Edge and Safari (MV3)
tools/                 NOTICE, latest.json, the English interface dictionary
tests/                 module checks and Playwright E2E tests
```

The library format: `index.json` (folders and files) + `files/<id>/<original>` + thumbnails. New fields in `index.json`
are only ever optional — old libraries open without a migration. The app never changes or deletes the original
files, except by an explicit «Delete forever».

The English interface is the dictionary `src/lib/i18n-en.json` (the strings in the code are Russian):
`python tools/i18n_missing.py` lists what it lacks.

## Helping

A map of the code — [ARCHITECTURE.md](../ARCHITECTURE.md), the code rules and checks —
[CONTRIBUTING.md](../CONTRIBUTING.md). Bugs and ideas — in Issues. Before a pull request, check the change in the browser build, run `npm run test:unit` and,
if it touches the interface, `npm run test:e2e`.
