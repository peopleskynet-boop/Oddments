// SVG → 3D for the Blender add-on: the add-on posts {svg, name, style} to the bridge (/mesh), Rust hands it to the
// window (event «perch-mesh») and waits for mcp_reply. The mesh is built here by the same generator as the app's own
// «SVG в 3D» window, in the drawing's frame (viewBox): every icon of a set gets one scale, depth and bevel.
// Answer: {ok, name, kind, notes, mesh: {v, f, p, uv, parts}} or {error}.
const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

// the style of a set: the same keys and defaults as the app's window (ui/svg3d.js)
export const STYLE_DEF = { fix: true, depth: 0.24, bevel: 0.04, round: 0, bseg: 3, sseg: 1, dens: 18, corner: 32, inner: 12, loops: 3, cap: 'quad' };
const clamp = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
function styleOf(s = {}) {
  const D = STYLE_DEF;
  return {
    depth: clamp(s.depth, 0.02, 1, D.depth), bevel: clamp(s.bevel, 0, 0.12, D.bevel), round: clamp(s.round, 0, 0.3, D.round),
    bseg: Math.round(clamp(s.bseg, 1, 8, D.bseg)), sseg: Math.round(clamp(s.sseg, 1, 6, D.sseg)), dens: Math.round(clamp(s.dens, 4, 60, D.dens)),
    corner: clamp(s.corner, 10, 80, D.corner), inner: Math.round(clamp(s.inner, 4, 40, D.inner)), loops: Math.round(clamp(s.loops, 0, 8, D.loops)),
    cap: ['quad', 'ngon', 'tri'].includes(s.cap) ? s.cap : D.cap, fix: s.fix !== false,
  };
}

export async function meshForAddon(req) {
  const lib = await import('./svg3d.js');
  if (!req || typeof req.svg !== 'string' || !req.svg.trim()) return { error: 'no svg' };
  const P = styleOf(req.style);
  // «Исправлять SVG» (on unless the set's style switches it off): the drawing's points mended first (lib/svgfix.js)
  let text = req.svg, fixed = null;
  if (P.fix) {
    try { const fx = await import('./svgfix.js'); const f = fx.fixSvg(req.svg); text = f.svg; fixed = fx.reportLines(f.report); } catch (e) { fixed = null; }
  }
  const r = lib.parseSvg(text);
  if (!r.shapes.length) return { error: r.strokesOnly ? 'strokes' : 'empty' };
  // «frame: false» — the shape fills the box (a one-off model), as in the app's window
  const frame = req.frame === false ? null : r.view;
  const mesh = lib.build(lib.contours(r.shapes, 2 / P.dens, P.corner, P.round, frame), { ...P, step: 2 / P.dens });
  const check = lib.checkMesh(mesh.verts, mesh.faces);
  const notes = [];
  if (mesh.bevel != null) notes.push('bevel ' + mesh.bevel.toFixed(4));
  if (fixed && fixed.length) notes.push('svg fixed: ' + fixed.join('; '));
  if (!check.ok) notes.push('mesh errors ' + (check.open + check.degenerate + check.flipped));
  return { ok: check.ok, name: req.name || 'Icon', kind: mesh.kind, notes, style: P, mesh: lib.toMeshJSON(mesh) };
}

export async function initMeshJobs() {
  if (typeof window !== 'undefined') window.__oddmentsMesh = meshForAddon; // for the browser build and tests
  if (!inApp()) return;
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  await listen('perch-mesh', async (e) => {
    const { id, body } = e.payload || {};
    let out;
    try { out = JSON.stringify(await meshForAddon(JSON.parse(body))); } catch (err) { out = JSON.stringify({ error: String(err && err.message ? err.message : err) }); }
    invoke('mcp_reply', { id, body: out }).catch(() => {});
  });
}
