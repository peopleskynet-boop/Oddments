// The browser extension for Zen and Firefox (Gecko) is the same folder as for Chrome and Edge (integrations/browser);
// only its manifest differs: Gecko runs the background as an event page (background.scripts), has no offscreen pages
// and no tabCapture (the area video goes through «show the screen» there — content.js recLocal), and wants its own id.
// Pure functions: the plugin hub (ui/plugins.js) packs the .xpi with them, tools/ext-gecko.mjs builds it for testing.
export const GECKO_ID = 'browser@oddments.app';

export function geckoManifest(chrome) {
  const m = JSON.parse(JSON.stringify(chrome));
  m.background = { scripts: ['background.js'], type: 'module' };
  m.permissions = (m.permissions || []).filter((p) => p !== 'offscreen' && p !== 'tabCapture');
  delete m.minimum_chrome_version;
  // 128: scripting in the page's own world (Vimeo players); no data leaves the computer — the receiver is 127.0.0.1
  m.browser_specific_settings = { gecko: { id: GECKO_ID, strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } } };
  return m;
}

// the files of the Chrome folder that Gecko does not need
export const geckoSkips = (path) => /(^|\/)offscreen\.(html|js)$/.test(path);
