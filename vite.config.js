import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const web = (f) => fileURLToPath(new URL('./src/web/' + f, import.meta.url));

// Tauri expects a fixed dev port and does not want Vite to clear the terminal.
// `--mode web` (npm run web) swaps the Tauri modules for browser stand-ins from src/web,
// so the interface can be worked on in a normal browser with a demo library.
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  // test rigs and the Rust build write lots of files Vite has no business watching (a locked Edge profile file in
  // tests/.ext once crashed the dev server)
  server: { port: mode === 'web' ? 5173 : 1420, strictPort: true, host: mode === 'web' ? '127.0.0.1' : false,
    watch: { ignored: ['**/tests/.ext/**', '**/src-tauri/target/**', '**/dist*/**', '**/test-results/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  // onnxruntime-web finds its .wasm next to itself; pre-bundling would move it (ai.worker.js sets the path anyway)
  optimizeDeps: { exclude: ['onnxruntime-web', 'pdfjs-dist'] },
  worker: { format: 'es' },
  // paper.js: the core build. The default «paper» (paper-full) carries the PaperScript compiler, which calls
  // new Function() while the module loads — the app's CSP (no 'unsafe-eval') kills it, and the icon constructor did
  // not open in the exe (bug #60). The alias is for the whole project.
  resolve: {
    alias: {
      paper: fileURLToPath(new URL('./node_modules/paper/dist/paper-core.js', import.meta.url)),
      ...(mode === 'web' ? WEB : {}),
    },
  },
}));

const WEB = {
      '@tauri-apps/api/path': web('tauri-path.js'),
      '@tauri-apps/api/core': web('tauri-core.js'),
      '@tauri-apps/plugin-fs': web('memfs.js'),
      '@tauri-apps/plugin-dialog': web('tauri-dialog.js'),
      '@tauri-apps/plugin-clipboard-manager': web('tauri-clipboard.js'),
      '@tauri-apps/plugin-http': web('tauri-http.js'),
      '@tauri-apps/plugin-opener': web('tauri-opener.js'),
};
