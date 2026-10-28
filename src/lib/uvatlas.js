// «Развернуть UV» without Blender: xatlas (MIT, Jonathan Young; WebAssembly build from xatlasjs) in a worker, so the
// window does not freeze. Each mesh is welded by position and normal (hard edges stay split — they become seams),
// segmented into charts, parameterised and packed into the 0–1 square. The wrapper indexes vertices with 16 bits:
// meshes over 65 000 vertices are left as they are (Blender's «Развернуть UV» has no such limit). Skinned meshes keep
// their UVs: their bone weights would not survive the new vertex order.
import { wrap, proxy } from 'comlink';
import workerUrl from 'xatlasjs/dist/xatlas.js?url';
import wasmUrl from 'xatlasjs/dist/xatlas.wasm?url';

let api = null;
async function atlas() {
  if (api) return api;
  const Api = wrap(new Worker(workerUrl));
  const x = await new Api(proxy(() => {}), proxy((path) => (path === 'xatlas.wasm' ? new URL(wasmUrl, location.href).href : null)), proxy(() => {}));
  for (let i = 0; i < 100 && !(await x.loaded); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await x.loaded)) throw new Error('модуль развёртки не загрузился');
  api = x;
  return api;
}

// → { done, skipped: [names], tooBig: [names] }; geometries are replaced in place
export async function unwrapObject(THREE, obj, { mergeVertices }) {
  const x = await atlas();
  const done = [], skipped = [], tooBig = [];
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  for (const o of meshes) {
    const name = o.name || 'меш';
    if (o.isSkinnedMesh) { skipped.push(name); continue; }
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g = mergeVertices(g, 1e-5);
    const pos = g.attributes.position, nor = g.attributes.normal;
    if (pos.count > 65000) { tooBig.push(name); g.dispose(); continue; }
    const index = g.index ? Uint16Array.from(g.index.array) : Uint16Array.from({ length: pos.count }, (_, i) => i);
    await x.createAtlas();
    await x.addMesh(index, Float32Array.from(pos.array), Float32Array.from(nor.array), null, o.uuid, true, false, 1);
    const r = await x.generateAtlas({ maxIterations: 2 }, { padding: 2, resolution: 1024, bilinear: true, blockAlign: true }, true);
    await x.destroyAtlas();
    const m = r.meshes && r.meshes[0];
    g.dispose();
    if (!m) { skipped.push(name); continue; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(m.vertex.vertices, 3));
    if (m.vertex.normals) out.setAttribute('normal', new THREE.BufferAttribute(m.vertex.normals, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(m.vertex.coords1, 2));
    out.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.index), 1));
    // the triangles keep their order: material groups stay valid
    for (const gr of o.geometry.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
    o.geometry.dispose();
    o.geometry = out;
    done.push(name);
  }
  return { done, skipped, tooBig };
}
