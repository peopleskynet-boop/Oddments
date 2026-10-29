// «Сплат (Cycles)» from the Blender add-on: «<name>.oddsplatviews» — a zip with the selection as GLB (geometry only, in
// glTF's frame), cameras.json (the 64 cameras: pos / target / up, fov) and one Cycles render per camera (PNG with
// transparency). The splat is built like «Сплат из модели» (splat.js bakeSplats), but its colours are those renders:
// the scene's own materials and light, at Cycles quality. The result lands in the library («<name> — сплат (Cycles)»,
// PLY or SPZ as chosen in «Сплат из модели») and opens. The zip itself is not kept.
import * as fs from '@tauri-apps/plugin-fs';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { addFromBlobs, saveIndex } from './library.js';
import { readPref } from './prefs.js';
import { t } from './i18n.js';
import { LOC } from '../util.js';

export const isSplatViews = (path) => /\.oddsplatviews$/i.test(path);

async function pixelsOf(png) {
  const bm = await createImageBitmap(new Blob([png], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bm, 0, 0);
  const data = x.getImageData(0, 0, bm.width, bm.height).data;
  bm.close();
  return { data, w: c.width, h: c.height };
}

// path: the zip in the inbox; ctx: where the import was going (folder / tags). Returns the new library item.
export async function splatFromViews(path, ctx = {}) {
  const { busy, busyDone, toast } = await import('../ui/dialogs.js');
  busy('Сплат из Blender: читаю рендеры…');
  try {
    const files = unzipSync(new Uint8Array(await fs.readFile(path)));
    const meta = JSON.parse(strFromU8(files['cameras.json']));
    if (!meta.views || !meta.views.length || !files['model.glb']) throw new Error('в архиве нет камер или модели');
    const [{ loadThree, parseModel, disposeObject }, { bakeSplats }] = await Promise.all([import('./model3d.js'), import('./splat.js')]);
    const T = await loadThree();
    const glb = files['model.glb'];
    const obj = await parseModel(T, 'glb', glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
    const pref = readPref('perch.splatmk', { count: 500000, sh: true, fmt: 'ply' });
    const renderer = new T.THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    let r;
    try {
      const shots = meta.views.map((v) => ({ pos: v.pos, target: v.target, up: v.up, pixels: () => pixelsOf(files[v.file]) }));
      r = await bakeSplats(T, obj, { count: pref.count, sh: pref.sh, renderer, shots, fov: meta.fov || 35, name: meta.name }, (p) => {
        if (p.phase === 'view') busy(`Сплат из Blender: ракурс ${p.done} из ${p.total}`, p.done / p.total);
        else if (p.phase === 'fit') busy('Сплат из Blender: цвет точек…');
      });
    } finally {
      disposeObject(obj);
      renderer.dispose(); renderer.forceContextLoss();
    }
    let bytes = r.ply, fmt = 'ply';
    if (pref.fmt === 'spz') { bytes = await (await import('./splat.js')).toSpz(r.ply, 'ply'); fmt = 'spz'; }
    const [it] = await addFromBlobs([{ blob: new Blob([bytes]), name: `${meta.name || 'Blender'} — ${t('сплат (Cycles)')}.${fmt}` }], { folder: ctx.folder || null, tags: ctx.tags });
    if (!it) throw new Error('файл не добавился');
    it.splatCycles = true; // optional field: the colours are Cycles renders from Blender
    saveIndex();
    busyDone(`Сплат из Blender: ${r.n.toLocaleString(LOC)} точек`);
    toast(`Сплат из Blender готов: «${it.name}»`, 6000, { label: 'Открыть', fn: () => import('../ui/preview.js').then((m) => m.openPreview(it.id)) });
    return it;
  } catch (e) {
    busyDone();
    toast('Не удалось собрать сплат из Blender: ' + ((e && e.message) || e), 8000);
    return null;
  }
}
