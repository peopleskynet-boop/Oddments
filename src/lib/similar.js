// "Similar" without AI: shared palette, tags, folders and kind. Cheap enough to run over
// thousands of items on every refresh; a visual model can replace it later.
import { colorDist } from '../util.js';

// below this score two files are not considered similar
export const SIM_MIN = 0.4;

export function similarity(a, b) {
  if (a === b) return 1;
  let s = 0;
  if (a.colors.length && b.colors.length) {
    let sum = 0;
    for (const c of a.colors.slice(0, 4)) sum += Math.min(...b.colors.slice(0, 4).map((d) => colorDist(c, d)));
    s += Math.max(0, 1 - sum / Math.min(4, a.colors.length) / 120) * 0.6;
  }
  if (a.tags.length && b.tags.length) s += (a.tags.filter((t) => b.tags.includes(t)).length / Math.max(a.tags.length, b.tags.length)) * 0.25;
  if (a.folders.some((f) => b.folders.includes(f))) s += 0.1;
  if (a.kind === b.kind) s += 0.05;
  return s;
}

export function similarTo(it, items, n = 8, min = SIM_MIN) {
  return items.filter((x) => x !== it && !x.trashed)
    .map((x) => [x, similarity(it, x)]).filter((p) => p[1] > min)
    .sort((p, q) => q[1] - p[1]).slice(0, n).map((p) => p[0]);
}
