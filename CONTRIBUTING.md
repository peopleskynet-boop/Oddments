# Contributing to Oddments

Thank you for wanting to help. Bugs and ideas go to [Issues](https://github.com/peopleskynet-boop/Oddments/issues); code
comes as a pull request. Where things live is in [ARCHITECTURE.md](ARCHITECTURE.md), how installers are built — in
[docs/build.en.md](docs/build.en.md).

## Running it

You need Node.js 22. For the desktop app also Rust (stable) and, on Windows, the Microsoft C++ Build Tools; on the Mac,
the Xcode Command Line Tools.

```bash
npm ci
npm run web          # the browser build: http://127.0.0.1:5173, a demo library, no Rust needed
npm run tauri dev    # the desktop app, with hot reload
```

The browser build is where the interface is worked on: the Tauri modules are replaced by stand-ins from `src/web/`
(an in-memory file system, a demo library). `?n=5000` gives a big library, `?empty` an empty one, `?welcome` the
first-run window. What needs the desktop — Blender, AutoRemesher, the plugin receiver, MCP, updates, dragging files out
— is checked in `npm run tauri dev` or a built installer.

## Before a pull request

```bash
node --check src/path/to/changed-file.js   # each changed .js file
npm run test:unit                          # checks of the pure modules, no browser
npm run test:e2e                           # Playwright over the browser build, if the interface changed
```

- A new pure module (no DOM, no Tauri) gets its own `tests/unit/<name>.test.mjs`.
- A style change that must not change the look: `node tests/perf/snap.mjs <before>` → the change →
  `node tests/perf/snap.mjs <after>` → `node tests/perf/diff.mjs <before> <after>` must say `total 0` (the browser build
  has to be running on 5173). Which rule sets a property: `node tests/perf/who.mjs <width> <selector> <property>`.
- Look at the change in the browser build with your own eyes: both the dark («Марафон») and the light theme, a narrow
  window (860 px and less) and an empty library (`?empty`).
- Rust is checked by building it (`npm run tauri dev` or CI).

## Adding a string to the interface

The strings in the code are **Russian**; English comes from the dictionary `src/lib/i18n-en.json`. When you add or
change a visible string:

1. Write it in Russian in the code, as the rest of the file does (or ask in the pull request and we will word it).
2. Run `python tools/i18n_missing.py` (on Windows: `PYTHONIOENCODING=utf-8 python tools/i18n_missing.py`) — it lists the
   strings without English and the file each comes from.
3. Add the English to `src/lib/i18n-en.json` (UTF-8, LF line ends). A string with values is a pattern: `"Шаг {0} из {1}":
   "Step {0} of {1}"`.
4. Text that never reaches the DOM (a file name the app creates, a system dialog's title, a canvas drawing) goes through
   `t()` from `src/lib/i18n.js`.

The person's own content — file names, tags, collections — is never put in the dictionary.

## Rules of the code

Before writing something new, find how the same thing is already done nearby and do it the same way. A new shared
helper only when the same code appears for the third time. Comments are in English and say why, not what; every file
starts with a comment saying what it is for.

### Styles

- Cascade layers `tokens → base → components → screens → themes` (`src/styles.css` is the table of contents). A part of
  the window has its file in `src/styles/NN-*.css`; a screen has its file next to its module (`src/ui/x.css`), with the
  layer order on the first line and everything inside `@layer screens { … }`, loaded with the screen.
- A theme overrides a component by the order of its layer, not by a longer selector: a «Марафон» rule goes to
  `18-marathon.css` (the themes layer), without chains like `:root[data-theme] body.glass-on .x:not(.y)`.
- Classes carry the module's prefix (`ik-`, `plg-`, `nw-`, `sb-`, `wz-`…). Shared classes (`.busy`, `.on`, `.open`,
  `.glass`, `.pill`) are not put on someone else's element just for their look.
- `!important` only for `[hidden]` and for turning animations off.
- Colours are tokens (`--fg`, `--mut`, `--acc`, `--line`, `--panel`, `--hover`…), never HEX in components. Shapes are
  pills and large radii; no square plates.
- Animate only `transform`, `opacity`, `filter`, `clip-path` — not `left` / `top` / `width` / `height`, and no blur on
  large panels. All motion stops under `body:not(.motion)` / `body.no-anim`.

### Layers and keys

- A full-screen layer calls `pushLayer({ el, title, close, onKey })` when it opens and `popLayer(el)` when it closes
  (`src/ui/layers.js`). It does not add its own `document` key handler: the top layer gets the keys first, Esc closes
  only it, everything under it is `inert`.
- A key of the wall is a row `hotkey({ group, keys, what, hit, run })` in `main.js` (`src/ui/hotkeys.js`); the «?» sheet
  is built from that table. Keys of a layer go to its `onKey` and a line in `LAYER_KEYS` (`keys.js`).
- Letters are matched by `e.code` (`KeyF`, `KeyA`) so they work in every keyboard layout; symbols (`/`, `?`) by
  `e.key`. In a text field the wall's keys stay silent.

### Data, network, errors

- Settings only through `readPref(key, defaults)` / `writePref` (`src/lib/prefs.js`). The `perch.*` keys are never
  renamed — they are people's data.
- `index.json` gets only optional fields, never a migration; it is written only through `saveIndex` (atomic, with
  backups). The original files are never changed.
- A background thread is a worker called through `workerRpc` (`src/lib/workerrpc.js`); a big download goes through
  `downloadFile` (`src/lib/download.js`: pieces, resuming, a size check).
- An error of something the person did is a toast «Не удалось …: the reason. What to do.» — never silence or only the
  console. A cancelled action (`AbortError`) stays silent. A promise from a handler always has a `catch`.
- The app goes online only through `@tauri-apps/plugin-http` (it passes the «Offline» check in `src/lib/nethttp.js`);
  pictures and clips from sites go through `src/lib/remote.js`; the CSP is not loosened. Nothing leaves the computer
  without the person's action, and API keys are never printed to the log or a toast.
- The person's text goes into HTML through `esc()`; HTML from elsewhere through DOMPurify. Paths from outside (the
  receiver, the extension, MCP) are refused if they contain `..`, `\` or `:` and must stay inside `files/`.

### Speed

- Heavy things (screens, Three.js, AI models, dictionaries) load lazily through `import()`; the start-up code does not
  grow (`tests/perf/measure.mjs` measures it).
- The grid is virtual: no DOM per file, no `ui.refresh()` in a loop. Targets on 5000 files: a redraw ≤ 16 ms, a search
  ≤ 5 ms, a click on a card ≤ 16 ms.
- Long work runs when the window is idle (`requestIdleCallback`) or in a worker, with progress in the busy pill and a
  way to stop it.
- A closed screen removes its listeners, timers and observers and lets go of big lists; `URL.createObjectURL` is
  revoked; WebGL uses one shared context.

### Usability

- A button has a label or an `aria-label`, and a `title` with its key; focus is visible from the keyboard; Tab reaches
  everything; menus have the arrows and Esc.
- An error says the reason and the next step; something long shows progress; a deletion offers «Undo» in its toast;
  an empty state says what to do.

## Product rules

- No ratings — they were removed on purpose.
- The library is a folder of ordinary files; the originals are never changed and nothing is deleted without an explicit
  «Delete forever».
- No telemetry and no account. Anything that goes online is listed in [docs/privacy.en.md](docs/privacy.en.md) and
  stops in «Offline» mode.

## Commits and licence

Small commits with a message saying what changed and why. A new npm dependency means running `node tools/notices.mjs`
so its licence lands in `THIRD_PARTY_NOTICES.md`; check that its licence is compatible with MIT. By sending a pull
request you agree that your contribution is published under the project's [MIT licence](LICENSE).
