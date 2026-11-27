// HDRI (.hdr, .exr) and the rasters a browser does not show by itself (.tif, .tga), decoded off the page with Three.js'
// loaders: an 8K EXR takes seconds and would freeze the window during an import. The originals are not touched; the
// worker returns 8-bit pictures — the card's source and the preview — and, for an HDRI, its exposure.
// in: { id, buf, ext, maxSide } · out: { id, w, h, pic: { w, h, buf } (RGBA8, rows from the top), ev?, error? }
import { FloatType, RedFormat, RGFormat } from 'three';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// ACES filmic (Narkowicz' fit) and the sRGB curve: how an HDR value becomes a pixel on screen
const aces = (x) => clamp01((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

async function decodeHdr(buf, ext) {
  if (ext === 'exr') {
    const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
    const r = new EXRLoader().setDataType(FloatType).parse(buf);
    const ch = r.format === RedFormat ? 1 : r.format === RGFormat ? 2 : 4;
    return { w: r.width, h: r.height, data: r.data, ch, up: true }; // EXRLoader writes the rows bottom-up (WebGL order)
  }
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const r = new HDRLoader().setDataType(FloatType).parse(buf);
  return { w: r.width, h: r.height, data: r.data, ch: 4, up: false };
}

async function decodeRaster(buf, ext) {
  const mod = ext === 'tga' ? await import('three/examples/jsm/loaders/TGALoader.js') : await import('three/examples/jsm/loaders/TIFFLoader.js');
  const r = new (ext === 'tga' ? mod.TGALoader : mod.TIFFLoader)().parse(buf);
  return { w: r.width, h: r.height, data: r.data, ch: 4, up: false };
}

// the exposure that puts the picture's log-average brightness at photography's mid-grey (0.18), in stops; a sparse grid
// is enough, the sun's few pixels do not move a log average much
function autoEv(img) {
  const { w, h, data, ch } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  let sum = 0, n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = (y * w + x) * ch;
    const r = data[i], g = ch > 1 ? data[i + 1] : r, b = ch > 2 ? data[i + 2] : r;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l >= 0 && Number.isFinite(l)) { sum += Math.log(l + 1e-4); n++; }
  }
  const avg = n ? Math.exp(sum / n) : 0.18;
  return Math.max(-6, Math.min(6, Math.log2(0.18 / Math.max(avg, 1e-6))));
}

// the picture at maxSide on its long side: each output pixel averages the source pixels under it (a box), so a
// downsized panorama does not sparkle; an HDR picture is exposed and tone-mapped, an 8-bit one is only averaged
function picture(img, maxSide, ev) {
  const { w, h, data, ch, up } = img;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  const out = new Uint8ClampedArray(W * H * 4), hdr = ev != null, gain = hdr ? Math.pow(2, ev) : 1;
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = up ? h - 1 - sy : sy;
        for (let sx = x0; sx < x1; sx++) {
          const i = (row * w + sx) * ch;
          const vr = data[i], vg = ch > 1 ? data[i + 1] : vr, vb = ch > 2 ? data[i + 2] : vr;
          // a value past the sun's brightness or broken (NaN) would swamp the average
          r += Number.isFinite(vr) ? Math.min(vr, 6e4) : 0; g += Number.isFinite(vg) ? Math.min(vg, 6e4) : 0; b += Number.isFinite(vb) ? Math.min(vb, 6e4) : 0;
          a += ch === 4 && !hdr ? data[i + 3] : 255;
          n++;
        }
      }
      const o = (y * W + x) * 4;
      if (hdr) {
        out[o] = 255 * srgb(aces((r / n) * gain)); out[o + 1] = 255 * srgb(aces((g / n) * gain)); out[o + 2] = 255 * srgb(aces((b / n) * gain)); out[o + 3] = 255;
      } else { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n; }
    }
  }
  return { w: W, h: H, buf: out.buffer };
}

self.onmessage = async (e) => {
  const { id, buf, ext, maxSide } = e.data;
  try {
    const hdr = ext === 'hdr' || ext === 'exr';
    const img = hdr ? await decodeHdr(buf, ext) : await decodeRaster(buf, ext);
    if (!img.w || !img.h || !img.data) throw new Error('пустая картинка');
    const ev = hdr ? autoEv(img) : null;
    const pic = picture(img, maxSide, ev);
    self.postMessage({ id, w: img.w, h: img.h, pic, ev }, [pic.buf]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
