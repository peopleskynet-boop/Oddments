# Architecture

A map of the Oddments code for people who want to read or change it. How to run it and the rules for changes are in
[CONTRIBUTING.md](CONTRIBUTING.md); building installers — in [docs/build.en.md](docs/build.en.md).

Oddments is a [Tauri 2](https://tauri.app) desktop app. Almost everything lives in the web view: plain JavaScript ES
modules built by Vite, no framework, no TypeScript. Rust is a thin shell around it — the Tauri plugins and a few
native bridges (Blender, AutoRemesher, a local receiver for the plugins, MCP, the tray). Every source file starts with
a comment saying what it is for; this page is the overview.

```
src/main.js        start-up, events, ui.refresh()
src/state.js       shared state S, file kinds, the ui hooks
src/util.js        small helpers ($, esc, plural, sizes, dates)
src/lib/           data and logic: the library on disk, import, search, AI, formats, network
src/ui/            screens and panels, each heavy screen with its own .css next to it
src/styles/        the window's styles, NN-*.css, in cascade layers
src/web/           stand-ins for the Tauri modules in the browser build
src-tauri/         the Rust shell: plugins and native bridges
integrations/      the Blender add-on, the Figma plugin, the browser extension
tools/             generators and checks run by hand or in CI
tests/             unit checks, Playwright E2E, style and speed tools
docs/              user and maintainer documentation (each page in Russian and English)
```

## Start-up and the main loop

`src/main.js` is the entry point. `boot()` runs in this order:

1. `lockWindow()` (lib/net.js) — in «Offline» mode the window gets a stricter CSP before anything loads.
2. `initCrashLog()` (lib/crashlog.js) — window errors start going to the local log.
3. Settings (`ui/settings.js loadSettings / applySettings`), then the interface language (`lib/i18n.js initI18n`).
4. On a computer where Oddments never ran — the first-run window (`ui/welcome.js`), before the library opens.
5. The start screen (`ui/boot.js`), the window frame, the grid, then `initLibrary()` (lib/library.js) reads
   `index.json`.
6. `ui.refresh()` draws everything; the rest starts lazily: AI (lib/ai.js), text recognition (lib/ocr.js, after 5 s),
   team libraries, MCP, the receiver for the plugins (lib/bridge.js), the update check (lib/updater.js, after 15 s and
   only if the person allowed it).

`main.js` also owns the events of the wall: paste (Ctrl/⌘+V), drag and drop, the «Add» menu, the window buttons and
the tray, and the table of the wall's keys (below).

**State.** `src/state.js` holds `S` — items, folders (collections), `byId`, the current view, the search, the
selection — and `ui`, a set of hooks (`ui.refresh`, `ui.renderSide`, `ui.toast`…) that main.js fills in. Logic modules
call `ui.refresh()` after a change without importing interface code. `ui.refresh()` recomputes what is visible
(lib/filter.js) and redraws the grid, the sidebar, the header and the properties panel; it is never called in a loop.

## src/lib — data and logic

| Area | Modules |
|---|---|
| The library on disk | `library.js` (index.json, adding files, trash, saving), `ingest.js` (thumbnails and metadata per file kind), `psd.worker.js`, `fonts.js`, `pdf.js`, `palette.js` / `repalette.js` (colours of a picture), `watch.js` (watched folders), `exporter.js`, `dupes.js`, `similar.js` |
| What the wall shows | `filter.js` (views, search, sorting), `screenwords.js` |
| Getting files in | `clipboard.js` (paste, pictures from sites), `importers.js` + `importfmt.js` (Eagle and PureRef), `figma.js`, `videolink.js`, `block.js` (page blocks from the extension), `dragout.js` (dragging files out) |
| AI on the computer | `ai.js` + `ai.worker.js` (SigLIP 2 search by meaning), `aitags.js`, `ocr.js` + `ocr.worker.js` + `ocrcore.js` + `ocrdict.js` (PaddleOCR), `upscale.js` + worker (Real-ESRGAN), `cutout.js` + worker + `matte.js` (BEN2 background removal) |
| AI through an API | `aicloud.js` (Claude and Voyage), `anthropickey.js`, `iconai.js` + `iconai-examples.js`, `digest.js` |
| 3D | `model3d.js` (Three.js, loaded lazily), `material.js` (`.perchmat`), `svg3d.js` (SVG → 3D mesh), `svgfix.js`, `modelcheck.js`, `uvatlas.js` (xatlas), `remesh.js` (AutoRemesher), `splat.js` / `splatviews.js` (Gaussian splats), `blender.js`, `meshjob.js` |
| Icons | `iconkit.js` (geometry of the constructor), `iconrules.js`, `iconlike.js`, `offset.js` |
| Screens and research | `screens.js`, `flows.js` (screens from a screen recording), `cjm.js`, `study.js`, `pii.js` / `piikinds.js` / `masker.js` (hiding personal data) |
| Team | `team.js`, `teamconf.js`, `teamlog.js`, `glossary.js` (tag dictionary), `brand.js` / `brandrules.js`, `worklinks.js` |
| Reading | `feed.js`, `people.js`, `telegram.js`, `news.js`, `remote.js` (pictures from sites as blob URLs) |
| Network and the outside | `net.js` + `nethttp.js` («Offline»), `download.js` (big downloads, resumable), `bridge.js` (the local receiver's frontend side), `mcp.js` (the library as MCP tools), `updater.js` |
| Infrastructure | `prefs.js` (settings storage), `i18n.js` + `i18n-en.json` (English), `workerrpc.js` (promises over workers), `crashlog.js` (the local crash report), `fmp4.js` |

Heavy work runs in workers (`*.worker.js`) called through `workerrpc.js`; models and Three.js load only when needed.

## src/ui — screens and panels

- **The main window:** `grid.js` (virtualised masonry and grid; the pure maths in `layout.js`), `sidebar.js`,
  `hero.js` (the header), `inspector.js` + `inspextra.js` + `scrfields.js` + `notesblock.js` + `teamblock.js` (the
  properties panel), `selbar.js`, `marquee.js`, `ctxmenu.js`, `quickfile.js`, `colorpick.js`, `aibar.js`, `matshelf.js`,
  `clean.js` (the clean screen), `onboard.js` («Getting started»), `welcome.js` (the first run), `boot.js`, `frame.js`.
- **Full-screen layers:** `preview.js` + `player.js` + `embedmedia.js` + `viewer3d.js` + `splatview.js` +
  `blockview.js` + `loupe.js`, `feed.js`, `news.js`, `plugins.js`, `iconkit.js`, `svg3d.js`, `svgfix.js`,
  `splatmaker.js`, `flows.js` + `storyboard.js` + `cjm.js` + `studyview.js`, `screens.js`, `show.js`, `notes.js`,
  `mask.js`, `cutout.js`, `upscale.js`, `dupes.js`, `tidy.js`, `rename.js`, `materials.js`, `pick.js`, `licenses.js`.
- **Shared pieces:** `dialogs.js` (toasts, the busy pill, ask / choose), `layers.js`, `hotkeys.js`, `keys.js` (the «?»
  sheet), `palette.js` (the command palette), `icons.js` (Phosphor icons), `gselect.js`, `keyfield.js`, `sound.js`,
  `motion.js`, `spring.js`, `glide.js`, `elastic.js`, `pixel.js`, `pixload.js`, `media.js`, `toblender.js`, `teamui.js`.
- **Settings:** `settings.js` (the drawer and its pages), `settingsteam.js`, `settingsabout.js` (About: updates,
  privacy, crash report, licences).
- `lazy.js` loads the rarely used screens on first use. A screen that is not needed at start is reached through
  `import()`, so the start-up code stays small.

A heavy screen has its own stylesheet next to it (`src/ui/<screen>.css`, imported by the module), so its styles load
with it.

## Styles

`src/styles.css` is the table of contents. Styles live in cascade layers, declared in this order:

```
@layer tokens, base, components, screens, themes;
```

- `tokens` — `src/styles/00-tokens.css`: every colour, radius and size as a CSS variable (`--fg`, `--mut`, `--acc`,
  `--line`, `--panel`, `--hover`…), with a block per theme («Марафон», «Тишина», light, dark).
- `base` — `01-base.css`: the glass, buttons, fields.
- `components` — `02-…` to `22-…`: one file per part of the window (sidebar, toolbar, header, cards, dock, properties
  panel, preview, settings, overlays, narrow window, motion, focus…).
- `screens` — the `src/ui/*.css` files; each declares the layer order on its first line and puts everything inside
  `@layer screens { … }`.
- `themes` — theme overrides such as `18-marathon.css`. A theme wins over a component by its layer, not by a longer
  selector.

## Layers, keys, settings

**Layers** (`src/ui/layers.js`). A full-screen layer calls `pushLayer({ el, title, close, onKey })` when it opens and
`popLayer(el)` when it closes. The top layer gets the keys first, Esc closes only it, everything under it is `inert`,
and the window strip shows its `title`. A layer never adds its own document-wide key handler.

**Keys** (`src/ui/hotkeys.js`). A key of the wall is one row, `hotkey({ group, keys, what, hit, run })`, in `main.js`;
the «?» sheet (`keys.js`) is built from the same table, so a key cannot exist without being listed. Keys of a layer go
to its `onKey` and a line in `LAYER_KEYS` (keys.js). Letters are matched by `e.code` (`KeyF`), so they work in any
keyboard layout; symbols (`/`, `?`) by `e.key`. In a text field the wall's keys are silent.

**Settings** (`src/lib/prefs.js`). Everything in `localStorage` goes through `readPref(key, defaults)` / `writePref`
(and `readText` / `writeText` for plain strings): a read never throws and always comes back in the shape of its
defaults, a failed write keeps the value for the session. Keys are named `perch.*` (the app's old name) and are not
renamed — they are the person's data. The look itself (`perch.settings`) is applied as CSS variables and body classes
by `ui/settings.js`.

## The interface language

The strings in the code are Russian. English is a dictionary, `src/lib/i18n-en.json` (Russian → English), loaded only
when English is chosen. `src/lib/i18n.js` translates what the interface shows as it appears in the DOM — text and the
`title`, `aria-label`, `placeholder` and `alt` attributes. A string with values (`«Шаг {0} из {1}»`) is a pattern: its
words are translated, its values carried over. Text that never reaches the DOM — names of files the app creates, the
titles of system dialogs, canvas drawings, the tray menu — goes through `t()`. The person's own content (file names,
tags, collections, feed posts) is never in the dictionary, so it is never translated.

`python tools/i18n_missing.py` lists the Russian strings that have no English yet, with the file each comes from.

## The library on disk

A library is an ordinary folder (by default `Documents/Oddments Library`):

```
index.json                 { version, folders: [...], items: [...] }
index.json.bak             the last index that read fine
backups/index-YYYY-MM-DD.json   one copy a day, the last 7 days
files/<id>/<original name> the original, never changed
files/<id>/thumb.webp      the grid's thumbnail
files/<id>/preview.png     a full-size render (PSD)
```

- A folder (a collection) is `{ id, name, parent, open }`; an item has `id, name, ext, kind, size, added, file, thumb,
  w, h, tags, folders, note, url, colors, trashed, fav` and more.
- New fields are always **optional**, so an older library opens without a migration (for example `eagle` on items
  imported from Eagle, `verts` / `tris` on 3D models, `splats`, `scr` on app screens, `links`).
- `index.json` is written only through `saveIndex()` / `flushIndex()`: atomically (a temporary file, then a rename),
  debounced, with the backups above. A broken index is set aside and the library opens from the newest copy that reads.
- The originals are never changed or deleted, except by an explicit «Delete forever».
- Settings, AI models, HDRIs, the integration token and crash logs live outside the library, in the app's data folder.

## src/web — the browser build

`npm run web` builds the same app for a normal browser, for working on the interface. `vite.config.js` swaps the
`@tauri-apps/*` modules for the stand-ins in `src/web/`: `memfs.js` (an in-memory file system), `seed.js`, `seed3d.js`,
`seedblock.js` (a demo library), `tauri-dialog.js` (an `<input type=file>`), `tauri-http.js` (`fetch`), and the rest.
The app's own code does not know which build it runs in, except for a few `window.__TAURI_INTERNALS__` checks for
things that exist only in the desktop app.

`vite.config.js` also points `@tauri-apps/plugin-http` at `src/lib/nethttp.js` in both builds, so every request the app
makes passes the «Offline» check (`net.js`).

## src-tauri — the Rust shell

| File | What it does |
|---|---|
| `lib.rs` | registers the plugins (fs, dialog, http, clipboard, opener, persisted-scope, drag, single-instance, updater, process), the commands, the panic log |
| `bridge.rs` | the local receiver on `127.0.0.1:47215–47219` for the plugins and the extension: `/ping`, `/import`, `/selection`, `/library`, `/items`, `/file`, `/outbox`, `/mesh`, `/mcp`; every call except `/ping` needs the token |
| `blender.rs` | finds an installed Blender and runs it without a window (`.blend` → GLB, UV unwrapping with `smart_uv.py`) |
| `remesher.rs` | runs the bundled AutoRemesher without a window, with progress |
| `mcp.rs` | `Oddments --mcp`: an MCP server over stdio for Claude Desktop, forwarding to the running window |
| `tray.rs` | the tray icon and close-to-tray |

`tauri.conf.json` holds the CSP, the file access scope, the updater's public key and the bundle;
`tauri.macos.conf.json` the Mac differences; `capabilities/default.json` the permissions of the window.

## integrations

- `integrations/blender/perch_blender.py` — the Blender add-on (one file): send and insert models and materials, SVG
  sets to 3D, the material library, smart UV, splats. It talks to the receiver on 127.0.0.1 only.
- `integrations/figma/` — the Figma plugin (`code.js`, `ui.html`): the library inside Figma, moodboards, icons.
- `integrations/browser/` — the extension for Chrome, Edge and Safari (Manifest V3): saving pictures and page blocks.

The app hands these files out itself (Sidebar › Tools › «Plugins»), so they ship inside it.

## tools and tests

- `tools/notices.mjs` — writes `THIRD_PARTY_NOTICES.md` (npm packages with their licence texts; `--rust` adds the Rust
  crates in CI).
- `tools/latest-json.mjs` — the updater's `latest.json` from a published release (the release-manifest workflow).
- `tools/i18n_missing.py` — Russian strings without English.
- `tools/blender_extension.py` — packs the Blender add-on as a Blender extension and checks it with an installed Blender.
- `tools/blender-repo.mjs` — the same package without Blender, plus the extension repository's `index.json` (CI).
- `tests/unit/*.test.mjs` — `node --test` checks of the pure modules (`npm run test:unit`).
- `tests/e2e/` — Playwright over the browser build in Microsoft Edge (`npm run test:e2e`), with page objects in
  `tests/pages/` and fixtures in `tests/fixtures/`.
- `tests/perf/` — `snap.mjs` / `diff.mjs` (computed styles before and after a change), `who.mjs` (which rule sets a
  property), `measure.mjs` (start-up size and timings), `keys-check.mjs`, `layers-check.mjs`.

## CI

`.github/workflows/`: `build-windows.yml` and `build-macos.yml` (installers; on a `v*` tag a draft release),
`release-manifest.yml` (when a release is published: `latest.json`, the Blender extension package and its repository
`index.json`), `tests.yml` (unit and E2E, run by hand). Signing
and the updater key are explained in [docs/signing.en.md](docs/signing.en.md).
