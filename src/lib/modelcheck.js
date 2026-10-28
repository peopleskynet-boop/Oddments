// «Проверка модели» in the 3D viewer: what breaks a model on its way to a render, a game engine or a print, measured on
// the loaded three.js scene (the add-on's «Проверить модель» does the same inside Blender, with fixes). Loaders split
// vertices at UV seams and hard edges, so vertices are welded by position before edges are counted.
// → [{ level: 'err' | 'warn' | 'ok', text, how }]
const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function edgesOf(g) {
  const pos = g.attributes.position, idx = g.index;
  const n = idx ? idx.count : pos.count;
  const key = new Map(), weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getX(i).toFixed(5) + ',' + pos.getY(i).toFixed(5) + ',' + pos.getZ(i).toFixed(5);
    let w = key.get(k);
    if (w === undefined) { w = key.size; key.set(k, w); }
    weld[i] = w;
  }
  const vi = (j) => weld[idx ? idx.getX(j) : j];
  const edges = new Map(); // "a,b" (a < b) → [count, forward count]
  let degen = 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = vi(t), b = vi(t + 1), c = vi(t + 2);
    if (a === b || b === c || a === c) { degen++; continue; }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p < q ? p + ',' + q : q + ',' + p;
      const e = edges.get(k) || [0, 0];
      e[0]++; if (p < q) e[1]++;
      edges.set(k, e);
    }
  }
  let open = 0, nonman = 0, flip = 0;
  for (const [c, f] of edges.values()) {
    if (c === 1) open++;
    else if (c > 2) nonman++;
    else if (f !== 1) flip++; // two faces walking the shared edge the same way: their normals disagree
  }
  return { open, nonman, flip, degen };
}

// UV: outside 0–1, and overlap (a 128² raster of the UV triangles: cells covered twice)
function uvOf(g) {
  const uv = g.attributes.uv;
  if (!uv) return null;
  const idx = g.index, n = idx ? idx.count : uv.count, N = 128, cov = new Uint8Array(N * N);
  let outside = 0, over = 0, covered = 0;
  const at = (j) => (idx ? idx.getX(j) : j);
  for (let t = 0; t + 2 < n; t += 3) {
    const p = [at(t), at(t + 1), at(t + 2)].map((i) => [uv.getX(i), uv.getY(i)]);
    if (p.some(([u, v]) => u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001)) { outside++; continue; }
    // the triangle's cells, by their centres
    const xs = p.map((q) => q[0] * N), ys = p.map((q) => q[1] * N);
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(N - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(N - 1, Math.ceil(Math.max(...ys)));
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const w0 = ((xs[1] - cx) * (ys[2] - cy) - (xs[2] - cx) * (ys[1] - cy)) / area;
      const w1 = ((xs[2] - cx) * (ys[0] - cy) - (xs[0] - cx) * (ys[2] - cy)) / area;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const c = y * N + x;
      if (cov[c] === 1) over++;
      if (cov[c] < 2) cov[c]++;
    }
  }
  for (let i = 0; i < cov.length; i++) if (cov[i]) covered++;
  return { outside, overlap: covered ? over / covered : 0, used: covered / (N * N) };
}

export function checkModel(THREE, obj, info) {
  const out = [];
  const push = (level, text, how = '') => out.push({ level, text, how });
  const big = info.size ? Math.max(...info.size) : 0;
  if (big > 500) push('warn', `Огромная: ${Math.round(big)} единиц по большей стороне`, 'Похоже на сантиметры вместо метров — в Blender модель окажется в 100 раз больше. Масштаб 0,01 при импорте или в Blender.');
  else if (big > 0 && big < 0.005) push('warn', 'Крошечная: меньше 5 мм', 'Похоже на неверные единицы. Проверьте масштаб при экспорте.');
  let open = 0, nonman = 0, flip = 0, degen = 0, uvless = 0, outside = 0, overlapMeshes = 0, negative = 0, skipped = 0;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (o.matrixWorld.determinant() < 0) negative++;
    const g = o.geometry;
    const tris = Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
    if (tris > 1.5e6) { skipped++; return; } // too heavy to walk on the main thread
    const e = edgesOf(g);
    open += e.open; nonman += e.nonman; flip += e.flip; degen += e.degen;
    const u = uvOf(g);
    if (!u) uvless++;
    else { outside += u.outside; if (u.overlap > 0.03) overlapMeshes++; }
  });
  if (negative) push('err', `Отрицательный масштаб у ${negative} ${negative === 1 ? 'меша' : 'мешей'}`, 'Нормали вывернутся при применении масштаба. В Blender: Apply › Scale и пересчёт нормалей (аддон: «Исправить, что можно»).');
  if (nonman) push('err', `Неманифолдные рёбра: ${fmtN(nonman)}`, 'На ребре больше двух граней — такая сетка не печатается и плохо сглаживается. Ищите в Blender: Select › All by Trait › Non Manifold.');
  if (flip) push('err', `Нормали смотрят в разные стороны: ${fmtN(flip)} рёбер`, 'Часть граней вывернута — в рендере будут тёмные пятна. В Blender: Mesh › Normals › Recalculate Outside (аддон: «Исправить, что можно»).');
  if (degen) push('warn', `Вырожденные треугольники: ${fmtN(degen)}`, 'Грани без площади ломают сглаживание и запекание. В Blender: Mesh › Clean Up › Degenerate Dissolve.');
  if (open) push('warn', `Открытые края: ${fmtN(open)} рёбер`, 'Если модель должна быть замкнутой (печать, симуляция) — это дырки. Для плоских деталей это нормально.');
  if (uvless) push('warn', `Без UV: ${uvless} ${uvless === 1 ? 'меш' : 'меша'}`, 'Текстура ляжет одним цветом. «Развернуть UV» ниже.');
  if (outside) push('warn', `UV за квадратом 0–1: ${fmtN(outside)} треугольников`, 'Для тайлящихся текстур это нормально, для запекания и атласов — нет.');
  if (overlapMeshes) push('warn', `UV-острова наложены друг на друга: ${overlapMeshes} ${overlapMeshes === 1 ? 'меш' : 'меша'}`, 'Зеркальные половинки — обычный приём, но для запекания нужна развёртка без наложений.');
  if (info.tris > 1e6) push('warn', `Тяжёлая: ${fmtN(info.tris)} треугольников`, 'Для игр и веба нужен ретоп или децимация. «Ремеш…» в меню модели.');
  if (info.materials > 8) push('warn', `Много материалов: ${info.materials}`, 'Каждый материал — отдельный вызов отрисовки. Объедините в атлас, если модель для движка.');
  const texs = new Set();
  obj.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && Object.values(m).forEach((v) => { if (v && v.isTexture && v.image) texs.add(v.image); })); });
  const pot = (n) => n > 0 && (n & (n - 1)) === 0;
  let huge = 0, npot = 0;
  for (const im of texs) { const w = im.width || 0, h = im.height || 0; if (w > 4096 || h > 4096) huge++; if (w && h && (!pot(w) || !pot(h))) npot++; }
  if (huge) push('warn', `Текстуры больше 4K: ${huge}`, 'Тяжело для видеопамяти; для большинства задач хватает 2K.');
  if (npot) push('warn', `Текстуры не степени двойки: ${npot}`, 'Движки любят 512, 1024, 2048 — иначе масштабируют сами и мылят.');
  if (skipped) push('warn', `${skipped} очень больших мешей не проверены целиком`, '');
  if (!out.length) push('ok', 'Всё в порядке', '');
  return out;
}
