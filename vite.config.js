import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const web = (f) => fileURLToPath(new URL('./src/web/' + f, import.meta.url));
const src = (f) => fileURLToPath(new URL('./src/' + f, import.meta.url));

// Tauri expects a fixed dev port and does not want Vite to clear the terminal.
// `--mode web` (npm run web) swaps the Tauri modules for browser stand-ins from src/web,
// so the interface can be worked on in a normal browser with a demo library.
// `--mode lite` (npm run lite / build:lite) is Oddments Web: the browser build for collecting references (src/lib/lite.js).
export default defineConfig(({ mode }) => {
  const lite = mode === 'lite';
  return {
    clearScreen: false,
    // the lite build runs from any folder (GitHub Pages serves it under /Oddments/)
    base: lite ? './' : '/',
    define: { __ODD_LITE__: JSON.stringify(lite) },
    // test rigs and the Rust build write lots of files Vite has no business watching (a locked Edge profile file in
    // tests/.ext once crashed the dev server)
    server: { port: mode === 'web' ? 5173 : lite ? 5184 : 1420, strictPort: true, host: mode === 'web' || lite ? '127.0.0.1' : false,
      watch: { ignored: ['**/tests/.ext/**', '**/src-tauri/target/**', '**/dist*/**', '**/test-results/**'] } },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000, ...(lite ? { outDir: 'dist-lite', emptyOutDir: true } : {}) },
    // onnxruntime-web finds its .wasm next to itself; pre-bundling would move it (ai.worker.js sets the path anyway)
    // plugin-http is the app's own src/lib/nethttp.js (the alias below): pre-bundling it would bundle app code
    optimizeDeps: { exclude: ['onnxruntime-web', 'pdfjs-dist', '@tauri-apps/plugin-http'] },
    worker: { format: 'es' },
    // the lite build drops what it does not have; the others drop the lite build's own screens (never loaded there)
    plugins: lite ? [stubbed(LITE_OFF), litePwa()] : [stubbed(['ui/liteui.js']), viewerDev()],
    // paper.js: the core build. The default «paper» (paper-full) carries the PaperScript compiler, which calls
    // new Function() while the module loads — the app's CSP (no 'unsafe-eval') kills it, and the icon constructor did
    // not open in the exe (bug #60). The alias is for the whole project.
    resolve: {
      alias: {
        paper: fileURLToPath(new URL('./node_modules/paper/dist/paper-core.js', import.meta.url)),
        ...(mode === 'web' ? WEB : lite ? LITE : {}),
        // «Без сети»: every import of plugin-http gets the guarded fetch (src/lib/nethttp.js), which calls the real one
        '@tauri-apps/plugin-http': fileURLToPath(new URL('./src/lib/nethttp.js', import.meta.url)),
        'tauri-http-real': mode === 'web' ? web('tauri-http.js') : lite ? web('lite-http.js') : fileURLToPath(new URL('./node_modules/@tauri-apps/plugin-http/dist-js/index.js', import.meta.url)),
      },
    },
  };
});

const WEB = {
      '@tauri-apps/api/path': web('tauri-path.js'),
      '@tauri-apps/api/core': web('tauri-core.js'),
      '@tauri-apps/plugin-fs': web('memfs.js'),
      '@tauri-apps/plugin-dialog': web('tauri-dialog.js'),
      '@tauri-apps/plugin-clipboard-manager': web('tauri-clipboard.js'),
      '@tauri-apps/plugin-opener': web('tauri-opener.js'),
      '@tauri-apps/plugin-updater': web('tauri-updater.js'),
      '@tauri-apps/plugin-process': web('tauri-updater.js'),
};

// Oddments Web: files live in OPFS or a folder the person opened (lite-fs.js), not in memory, and there is no demo
const LITE = {
  '@tauri-apps/api/path': web('lite-path.js'),
  '@tauri-apps/api/core': web('lite-core.js'),
  '@tauri-apps/plugin-fs': web('lite-fs.js'),
  '@tauri-apps/plugin-dialog': web('lite-dialog.js'),
  '@tauri-apps/plugin-clipboard-manager': web('tauri-clipboard.js'),
  '@tauri-apps/plugin-opener': web('lite-opener.js'),
  '@tauri-apps/plugin-updater': web('tauri-updater.js'),
  '@tauri-apps/plugin-process': web('tauri-updater.js'),
};

// What Oddments Web does not have (the decisions of 15.11.2026, CLAUDE.md): each module is replaced by a stub with the
// same exports — functions that do nothing — so neither its code nor what it pulls in gets into the build. The
// interface hides the ways in (src/lib/lite.js); a stub that is called anyway stays quiet.
const LITE_OFF = [
  // AI, text on pictures, picture tools
  'lib/ai.js', 'lib/aicloud.js', 'lib/aitags.js', 'lib/ocr.js', 'lib/cutout.js', 'lib/upscale.js', 'lib/effects.js',
  'lib/fxgl.js', 'lib/masker.js', 'lib/pii.js', 'ui/aibar.js', 'ui/cutout.js', 'ui/upscale.js', 'ui/effects.js', 'ui/mask.js',
  // icons, SVG → 3D, remesh, splats, materials, Blender
  'lib/iconai.js', 'lib/iconkit.js', 'lib/iconlike.js', 'lib/iconrules.js', 'lib/offset.js', 'lib/svg3d.js', 'lib/svgfix.js',
  'lib/remesh.js', 'lib/meshjob.js', 'lib/splat.js', 'lib/splatviews.js', 'lib/material.js', 'lib/uvatlas.js', 'lib/blender.js',
  'ui/iconkit.js', 'ui/svg3d.js', 'ui/svgfix.js', 'ui/splatmaker.js', 'ui/splatview.js', 'ui/materials.js', 'ui/matshelf.js',
  'ui/toblender.js',
  // plugins, the receiver, MCP, the extension's blocks
  'lib/bridge.js', 'lib/mcp.js', 'lib/block.js', 'ui/plugins.js', 'ui/blockview.js',
  // team, brand, app screens, flows, CJM, studies, the show
  'lib/team.js', 'lib/teamlog.js', 'lib/screens.js', 'lib/flows.js', 'lib/cjm.js', 'lib/study.js', 'ui/teamui.js',
  'ui/teamblock.js', 'ui/settingsteam.js', 'ui/screens.js', 'ui/scrfields.js', 'ui/flows.js', 'ui/storyboard.js',
  'ui/cjm.js', 'ui/studyview.js', 'ui/show.js',
  // the feed, news, people, Telegram
  'lib/feed.js', 'lib/news.js', 'lib/digest.js', 'lib/people.js', 'lib/telegram.js', 'ui/feed.js', 'ui/news.js',
  // the desktop's own: updates, watch folders, dragging out, Eagle / PureRef import, the first-run window
  'lib/updater.js', 'lib/watch.js', 'lib/dragout.js', 'lib/importers.js', 'ui/welcome.js',
  // «Поделиться ссылкой» is sent from the desktop app (Oddments Web only shows a link)
  'lib/share.js', 'lib/s3.js', 'ui/share.js', 'ui/settingsshare.js',
];

function stubbed(list) {
  const off = new Set(list.map((f) => path.normalize(src(f)).toLowerCase()));
  const PREFIX = '\0lite-off:';
  return {
    name: 'oddments-lite-off',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || source.startsWith('\0') || !/\.js(\?|$)/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || r.external) return null;
      const file = path.normalize(r.id.split('?')[0]).toLowerCase();
      return off.has(file) ? PREFIX + r.id.split('?')[0] : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      const ast = this.parse(fs.readFileSync(file, 'utf8'));
      const names = new Set();
      const ids = (p) => (p.type === 'Identifier' ? [p.name] : p.type === 'ObjectPattern' ? p.properties.flatMap((q) => ids(q.value || q.argument))
        : p.type === 'ArrayPattern' ? p.elements.filter(Boolean).flatMap(ids) : p.type === 'AssignmentPattern' ? ids(p.left) : p.type === 'RestElement' ? ids(p.argument) : []);
      for (const n of ast.body) {
        if (n.type === 'ExportDefaultDeclaration') names.add('default');
        if (n.type !== 'ExportNamedDeclaration') continue;
        const d = n.declaration;
        if (d && d.declarations) d.declarations.forEach((x) => ids(x.id).forEach((k) => names.add(k)));
        else if (d && d.id) names.add(d.id.name);
        for (const s of n.specifiers || []) names.add(s.exported.name || s.exported.value);
      }
      return `// Oddments Web: ${path.basename(file)} is not in this build (vite.config.js LITE_OFF)\nconst off = () => undefined;\n` +
        [...names].map((k) => (k === 'default' ? 'export default off;' : `export const ${k} = off;`)).join('\n') + '\n';
    },
  };
}

// The installable app (PWA): the manifest with the prism icon, the service worker (src/web/lite-sw.js: the app offline,
// the library's files by address — lite-core.js convertFileSrc), the page's head. In dev the worker has nothing to keep
// offline; it still serves the library's files.
const ICONS = ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
const MANIFEST = {
  name: 'Oddments Web', short_name: 'Oddments', lang: 'ru', dir: 'ltr',
  description: 'Oddments в браузере: стена референсов — Ctrl+V, перетаскивание, подборки, теги, поиск по цвету',
  start_url: './', scope: './', display: 'standalone', display_override: ['window-controls-overlay', 'standalone'],
  background_color: '#0b0c10', theme_color: '#0b0c10',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
function litePwa() {
  const sw = (files, version) => fs.readFileSync(web('lite-sw.js'), 'utf8')
    .replace("'__ODD_VERSION__'", JSON.stringify(version)).replace('/*__ODD_PRECACHE__*/[]', JSON.stringify(files));
  const head = '<link rel="manifest" href="./manifest.webmanifest" />\n    <meta name="theme-color" content="#0b0c10" />\n' +
    '    <meta name="mobile-web-app-capable" content="yes" />\n    <link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />\n';
  return {
    name: 'oddments-lite-pwa',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace('<title>Oddments</title>', '<title>Oddments Web</title>').replace('</head>', '    ' + head + '  </head>');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = (req.url || '').split('?')[0];
        if (u === '/sw.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(sw([], 'dev')); return; }
        if (u === '/manifest.webmanifest') { res.setHeader('Content-Type', 'application/manifest+json'); res.end(JSON.stringify(MANIFEST)); return; }
        const ico = u.startsWith('/icons/') && ICONS.find((n) => u === '/icons/' + n);
        if (ico) { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(web('lite-icons/' + ico))); return; }
        next();
      });
    },
    generateBundle(_, bundle) {
      for (const n of ICONS) this.emitFile({ type: 'asset', fileName: 'icons/' + n, source: fs.readFileSync(web('lite-icons/' + n)) });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(MANIFEST, null, 2) });
      // everything the app needs offline: the page, the code, the styles, the fonts, the icons
      const files = [...new Set(['./', 'index.html', 'manifest.webmanifest', ...ICONS.map((n) => 'icons/' + n), ...Object.keys(bundle)])]
        .filter((f) => !f.endsWith('.map')).sort();
      // the worker's own code counts too: a change in it is a new version with its own cache
      const version = crypto.createHash('sha256').update(files.join('\n') + fs.readFileSync(web('lite-sw.js'), 'utf8')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw(files, version) });
      // «Поделиться ссылкой» (lib/share.js): the app keeps this build under /viewer/ and uploads these files, once per version
      this.emitFile({ type: 'asset', fileName: 'files.json', source: JSON.stringify({ version, files: files.filter((f) => f !== './') }) });
    },
  };
}

// The viewer of shared links in `npm run web` and `tauri dev`: the lite build in dist/viewer (npm run build:viewer), at
// /viewer/ as in the built app
function viewerDev() {
  const dir = fileURLToPath(new URL('./dist/viewer/', import.meta.url));
  return {
    name: 'oddments-viewer-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const u = decodeURIComponent((req.url || '').split('?')[0]);
        if (!u.startsWith('/viewer/')) return next();
        const f = path.join(dir, u.slice('/viewer/'.length));
        if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; res.end(); return; }
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
        res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
        res.end(fs.readFileSync(f));
      });
    },
  };
}
