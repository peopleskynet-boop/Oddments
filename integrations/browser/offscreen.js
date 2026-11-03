// Oddments for Chrome and Edge: the recorder of «Видео области», a hidden (offscreen) page of the extension. The
// service worker hands over a stream id of the tab (tabCapture) and the frame drawn on the page; every frame of the
// tab is cropped to it (VideoFrame visibleRect: no copy, and no timers, which a hidden page would slow down) and
// recorded with the tab's sound, which keeps playing for the person. When it stops, the file goes back to the
// service worker as a blob: URL of this page, and from there to Oddments. Only chrome.runtime exists here.

const MAX = 5 * 60 * 1000; // a recording stops by itself after this long (the page's bar stops it too)
// MP4 first (Chrome and Edge record H.264 since 126): Figma, Telegram and players take it; WebM otherwise
const TYPES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
let job = null;

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    if (msg.t === 'recStart') return start(msg);
    if (msg.t === 'recCtl') return control(msg.do);
    if (msg.t === 'recState') return job ? { on: true, tabId: job.tabId, rect: job.rect, elapsed: elapsed(), paused: job.rec.state === 'paused', max: MAX } : { on: false };
  })().then(reply, (e) => reply({ error: (e && e.message) || String(e) }));
  return true;
});

const even = (v) => Math.max(0, Math.floor(v / 2) * 2);
const elapsed = () => (job ? (job.pausedAt || performance.now()) - job.started - job.pausedFor : 0);

async function start({ streamId, pick, tabId, name, page }) {
  if (job) return { error: 'busy' };
  // the capture at the viewport's own size: the frame's CSS pixels map onto it without letterboxing
  const dpr = pick.dpr || 1;
  const W = Math.round(pick.vw * dpr), H = Math.round(pick.vh * dpr);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, minWidth: W, maxWidth: W, minHeight: H, maxHeight: H, maxFrameRate: 30 } },
  });
  // a captured tab goes quiet for the person: its sound is played on here
  let ac = null;
  if (stream.getAudioTracks().length) { ac = new AudioContext(); ac.createMediaStreamSource(stream).connect(ac.destination); }

  const [track] = stream.getVideoTracks();
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  let crop = null; // fixed on the first frame: an encoder wants one size
  new MediaStreamTrackProcessor({ track }).readable.pipeThrough(new TransformStream({
    transform(frame, ctl) {
      const v = frame.visibleRect, k = v.width / pick.vw;
      if (!crop) {
        const w = even(Math.min(pick.w * k, v.width)), h = even(Math.min(pick.h * k, v.height));
        crop = { w, h };
      }
      const x = v.x + even(Math.min(pick.x * k, v.width - crop.w)), y = v.y + even(Math.min(pick.y * k, v.height - crop.h));
      if (crop.w < 2 || crop.h < 2 || x + crop.w > v.x + v.width || y + crop.h > v.y + v.height) { frame.close(); return; }
      const out = new VideoFrame(frame, { visibleRect: { x, y, width: crop.w, height: crop.h }, displayWidth: crop.w, displayHeight: crop.h });
      frame.close();
      ctl.enqueue(out);
    },
  })).pipeTo(gen.writable).catch(() => {});

  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  // about 0.1 bit per pixel per frame: crisp UI text, a sane file
  const bits = Math.min(16e6, Math.max(2e6, pick.w * dpr * pick.h * dpr * 30 * 0.1));
  const rec = new MediaRecorder(new MediaStream([gen, ...stream.getAudioTracks()]), { mimeType: type, videoBitsPerSecond: bits, audioBitsPerSecond: 128e3 });
  job = { rec, stream, ac, tabId, name, page, rect: pick, parts: [], type: type || rec.mimeType, started: performance.now(), pausedFor: 0, pausedAt: 0, cancel: false };
  rec.ondataavailable = (e) => { if (e.data.size && job) job.parts.push(e.data); };
  rec.onstop = finish;
  rec.start(1000);
  // the tab was closed: what was recorded is kept
  track.addEventListener('ended', () => control('stop'));
  job.limit = setTimeout(() => control('stop'), MAX);
  return { ok: true, type: job.type };
}

function control(what) {
  if (!job) return { on: false };
  const r = job.rec;
  if (what === 'pause' && r.state === 'recording') { r.pause(); job.pausedAt = performance.now(); }
  else if (what === 'resume' && r.state === 'paused') { r.resume(); job.pausedFor += performance.now() - job.pausedAt; job.pausedAt = 0; }
  else if ((what === 'stop' || what === 'cancel') && r.state !== 'inactive') { job.cancel = what === 'cancel'; r.stop(); }
  return { on: true, paused: r.state === 'paused', elapsed: elapsed() };
}

function finish() {
  const j = job;
  job = null;
  if (!j) return;
  clearTimeout(j.limit);
  j.stream.getTracks().forEach((t) => t.stop());
  if (j.ac) j.ac.close().catch(() => {});
  if (j.cancel) { chrome.runtime.sendMessage({ t: 'recDone', cancelled: true, tabId: j.tabId }).catch(() => {}); return; }
  const blob = new Blob(j.parts, { type: (j.type || 'video/webm').split(';')[0] });
  const url = URL.createObjectURL(blob);
  chrome.runtime.sendMessage({ t: 'recDone', url, size: blob.size, type: blob.type, name: j.name, page: j.page, tabId: j.tabId }).catch(() => {});
}
