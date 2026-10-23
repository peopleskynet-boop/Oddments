// Parses PSD files off the main thread so a large Photoshop file does not freeze the window.
// ag-psd draws into OffscreenCanvas here; the composite goes back as a transferable ImageBitmap.
import { readPsd, initializeCanvas } from 'ag-psd';

initializeCanvas(
  (w, h) => new OffscreenCanvas(w, h),
  undefined,
  (w, h) => new ImageData(w, h),
);

self.onmessage = (e) => {
  const { id, buf } = e.data;
  try {
    const psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true });
    const c = psd.canvas;
    const bitmap = c && c.width ? c.transferToImageBitmap() : null;
    self.postMessage({ id, w: psd.width, h: psd.height, bitmap }, bitmap ? [bitmap] : []);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
