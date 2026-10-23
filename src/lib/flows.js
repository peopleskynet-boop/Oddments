// Screens out of a screen recording (a phone's or a computer's): the video is looked at frame by frame in a small
// copy; where the picture has stood still for a moment and differs from the last screen taken, that is a new screen —
// its frame is taken at full size. Scrolling, transitions and animations (the picture keeps changing) are skipped. The
// phone's status bar (the clock ticks) and the home indicator are left out of the comparison.
// Tuned on real recordings (banking and payment apps; Android and iPhone, 68–75 s):
// - the frame is taken at the END of a still stretch: slow animations (a chart ring drawing itself) are finished there;
// - a screen seen before (back navigation) comes again marked `dup` (the index of the first one);
// - a screen with almost no detail (a spinner, a skeleton, a splash logo, a black frame) comes marked `empty`.
// The review window keeps both but leaves them unchecked.
// → [{ t, blob, w, h, thumb, dup, empty }] in order
const W = 64;                // the comparison copy's width
const STILL = 0.012;         // mean difference between neighbouring samples under which the picture «stands»
const LEVEL = 40;            // a pixel «changed» when a channel moved more than this (compression noise stays under it)
const NEW = 0.03;            // share of changed pixels against the last taken screen over which it is a new one
const DUP = 0.012;           // and under which an earlier screen counts as «seen before» (stricter: an amount typed in is new)
const HOLD = 0.55;           // seconds the picture has to stand to count as a screen

// colour, not grey: two screens of one template often differ only in the hue of a header (green → blue is nearly the
// same grey)
const pixels = (ctx, w, h) => ctx.getImageData(0, 0, w, h).data;
// without the top 7 % (status bar: the clock ticks) and the bottom 4 % (home indicator)
// mean difference 0..1: does the picture stand (video compression noise keeps it a little above zero)
function diff(a, b, w, h) {
  const y0 = Math.floor(h * 0.07), y1 = Math.ceil(h * 0.96);
  let s = 0, n = 0;
  for (let i = y0 * w * 4; i < y1 * w * 4; i += 4) { s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
  return n ? s / n / 255 : 0;
}
// share of clearly changed pixels 0..1: is it another screen (two screens of one template differ in a few places,
// but a lot there — the mean would hardly notice)
function changed(a, b, w, h) {
  const y0 = Math.floor(h * 0.07), y1 = Math.ceil(h * 0.96);
  let s = 0, n = 0;
  for (let i = y0 * w * 4; i < y1 * w * 4; i += 4) { if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > LEVEL) s++; n++; }
  return n ? s / n : 0;
}

const seek = (v, t) => new Promise((res, rej) => {
  const ok = () => { v.removeEventListener('seeked', ok); v.removeEventListener('error', bad); res(); };
  const bad = () => { v.removeEventListener('seeked', ok); v.removeEventListener('error', bad); rej(new Error('видео не читается')); };
  v.addEventListener('seeked', ok); v.addEventListener('error', bad);
  v.currentTime = t;
});

// how much is drawn: the mean brightness step between neighbouring pixels (text and edges), status bar and home
// indicator left out. A loading screen has a small fraction of a real screen's detail.
function detail(px, w, h) {
  const y0 = Math.floor(h * 0.07), y1 = Math.ceil(h * 0.96);
  const L = (i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  let s = 0, n = 0;
  for (let y = y0; y < y1 - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    s += Math.abs(L(i) - L(i + 4)) + Math.abs(L(i) - L(i + w * 4)); n += 2;
  }
  return n ? s / n : 0;
}
const EMPTY = 0.4; // detail under this share of the recording's typical (median) screen: a loading screen

export async function screensOf(url, onProgress = () => {}, isCancelled = () => false) {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('видео не открылось')); });
  let dur = v.duration;
  if (dur === Infinity) { // a WebM written by a browser (MediaRecorder) has no duration until the end is looked at
    await seek(v, 1e7).catch(() => {});
    dur = v.duration;
    await seek(v, 0).catch(() => {});
  }
  if (!isFinite(dur) || dur <= 0) throw new Error('у видео нет длительности');
  const vw = v.videoWidth, vh = v.videoHeight, h = Math.max(8, Math.round((W * vh) / vw));
  const small = document.createElement('canvas'); small.width = W; small.height = h;
  const sx = small.getContext('2d', { willReadFrequently: true });
  const step = Math.max(0.15, dur / 1200);
  const out = [], kept = []; // kept: the small copies of the taken screens, for «seen before»
  const take = async (t, g) => {
    await seek(v, t);
    const c = document.createElement('canvas'); c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const tc = document.createElement('canvas'); tc.height = 240; tc.width = Math.round((240 * vw) / vh);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const dup = kept.findIndex((k) => changed(g, k, W, h) <= DUP);
    out.push({ t, blob, w: vw, h: vh, thumb: tc.toDataURL('image/jpeg', 0.8), dup, detail: detail(g, W, h) });
    kept.push(g);
  };
  // a still stretch: from `start`, standing since; `endT`/`endG` — its last still sample, where the frame is taken
  let prev = null, last = null, run = null;
  const close = async () => {
    if (!run || run.endT - run.start < HOLD) return;
    if (last && changed(run.endG, last, W, h) <= NEW) return; // the same screen as the one just taken
    last = run.endG;
    await take(run.endT, run.endG);
  };
  for (let t = 0; t <= dur; t += step) {
    if (isCancelled()) return out;
    const at = Math.min(t, dur - 0.01);
    await seek(v, at);
    sx.drawImage(v, 0, 0, W, h);
    const g = pixels(sx, W, h);
    const still = prev && diff(g, prev, W, h) < STILL;
    if (still) {
      if (!run) run = { start: at - step };
      run.endT = at; run.endG = g;
    } else {
      const ended = run;
      run = null;
      if (ended) { run = ended; await close(); run = null; await seek(v, at); }
    }
    prev = g;
    onProgress(Math.min(1, t / dur), out.length);
  }
  await close(); // the recording ends inside a still stretch
  // the end of the recording often ends on a screen that stood less than HOLD: take it if it is new
  if (prev && (!last || changed(prev, last, W, h) > NEW)) await take(Math.max(0, dur - 0.05), prev);
  // loading screens: far less detail than this recording's usual screen
  const ds = out.map((o) => o.detail).sort((a, b) => a - b);
  const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  for (const o of out) { o.empty = med > 0 && o.detail < med * EMPTY; delete o.detail; }
  v.removeAttribute('src'); v.load();
  return out;
}
