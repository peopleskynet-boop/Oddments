// The clip behind a link, so it plays in Oddments' own player instead of on the site.
// Pinterest: a video pin's MP4 (720p) — from the public widgets API, or from the data inside the pin page when the
// API refuses (it limits requests); an image pin's original picture. Other sites: the page's og:video when it is
// a video file. YouTube and Vimeo are not here: they play in their own embedded players (preview.js).
import { fetch as tfetch } from '@tauri-apps/plugin-http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const get = (url, accept = '*/*') => tfetch(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: accept } });

// the best MP4 among a pin's video variants ({V_720P: {url, width}, V_HLSV4: …} or the camelCase GraphQL shape);
// an HLS-only pin has its MP4 next to the playlist: …/hls/ab/cd/ef/x.m3u8 → …/720p/ab/cd/ef/x.mp4
function bestMp4(list) {
  const v = Object.values(list || {}).filter((x) => x && x.url);
  const mp4 = v.filter((x) => /\.mp4(\?|$)/i.test(x.url)).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (mp4) return { url: mp4.url, w: mp4.width || 0, h: mp4.height || 0 };
  const hls = v.find((x) => /\/hls\/.+\.m3u8/i.test(x.url));
  return hls ? { url: hls.url.replace('/hls/', '/720p/').replace(/\.m3u8.*$/i, '.mp4'), w: 0, h: 0 } : null;
}

// the clip of one pin object; only the pin's own fields are read, never related pins elsewhere on the page
function pinClip(p) {
  if (!p) return null;
  const lists = [];
  const vid = p.videos || null;
  if (vid) lists.push(vid.video_list || vid.videoList);
  const story = p.story_pin_data || p.storyPinData;
  for (const page of (story && story.pages) || []) {
    for (const b of page.blocks || []) {
      const v = b.video || b.videoDataV2 || b.videoData;
      if (v) lists.push(v.video_list || v.videoList, v.videoList720P);
    }
  }
  for (const l of lists) { const c = bestMp4(l); if (c) return c; }
  return null;
}
const pinTitle = (p) => {
  const s = p && (p.title || p.grid_title || p.gridTitle || (p.story_pin_data && p.story_pin_data.metadata && p.story_pin_data.metadata.pin_title) || p.description || p.seo_title);
  return (s || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
};
// the original picture: the widgets API lists only small sizes, but every size lives under the same path
// (…/564x/de/99/… → …/originals/de/99/…)
const pinImage = (p) => {
  const im = (p && p.images) || {};
  const own = (im.orig || im.originals || {}).url;
  if (own) return own;
  const big = Object.values(im).filter((x) => x && x.url).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return big ? big.url.replace(/\/\d+x\//, '/originals/') : '';
};

const pinId = async (url) => {
  let m = url.match(/pinterest\.[a-z.]+\/pin\/(?:[^/]*--)?(\d+)/i);
  if (m) return m[1];
  // pin.it short links redirect to the pin
  if (/^https?:\/\/pin\.it\//i.test(url)) {
    try { const r = await get(url, 'text/html'); m = (r.url || '').match(/\/pin\/(?:[^/]*--)?(\d+)/); if (m) return m[1]; } catch (e) { /* offline */ }
  }
  return '';
};

// pin page fallback: the pin's own object, found by its id in the page's JSON (old JSON scripts and Relay
// requests both)
function pinFromPage(html, id) {
  const blobs = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) blobs.push(m[1]);
  for (const m of html.matchAll(/__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\(\s*"([^"]+)"/g)) { try { blobs.push(decodeURIComponent(m[1])); } catch (e) { /* skip */ } }
  for (const m of html.matchAll(/__PWS_RELAY_REGISTER_COMPLETED_REQUEST__\([^,]+,\s*(\{[\s\S]*?\})\s*\)\s*;?\s*<\/script>/g)) blobs.push(m[1]);
  let found = null;
  const walk = (o, depth) => {
    if (found || !o || typeof o !== 'object' || depth > 40) return;
    if (!Array.isArray(o) && (o.entityId === id || o.id === id) && (o.videos !== undefined || o.storyPinData !== undefined || o.story_pin_data !== undefined || o.images)) {
      if (pinClip(o) || !found) found = o;
      if (pinClip(o)) return;
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  for (const b of blobs) { try { walk(JSON.parse(b), 0); } catch (e) { /* not JSON */ } if (found && pinClip(found)) break; }
  return found;
}

// → { kind: 'video' | 'image', url, title, w, h } or null
export async function pinterestMedia(url) {
  const id = await pinId(url);
  if (!id) return null;
  let pin = null;
  try {
    const r = await get(`https://widgets.pinterest.com/v3/pidgets/pins/info/?pin_ids=${id}`, 'application/json');
    if (r.ok) { const j = await r.json(); pin = j && j.data && j.data[0]; if (pin && pin.error) pin = null; }
  } catch (e) { /* rate limited or offline: the page */ }
  if (!pin || (!pinClip(pin) && (pin.is_video || !pinImage(pin)))) {
    try { const r = await get(`https://www.pinterest.com/pin/${id}/`, 'text/html'); if (r.ok) pin = pinFromPage(await r.text(), id) || pin; } catch (e) { /* offline */ }
  }
  if (!pin) return null;
  const clip = pinClip(pin);
  if (clip) return { kind: 'video', ...clip, title: pinTitle(pin) };
  const img = pinImage(pin);
  return img ? { kind: 'image', url: img, title: pinTitle(pin), w: 0, h: 0 } : null;
}

// any other page: og:video / twitter:player:stream when it points to a video file
export async function pageVideo(url) {
  try {
    const r = await get(url, 'text/html');
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (type.startsWith('video/')) return { kind: 'video', url, title: '', w: 0, h: 0 };
    if (type !== 'text/html') return null;
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const meta = (n) => { const e = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`); return e ? e.getAttribute('content') : ''; };
    const v = meta('og:video:secure_url') || meta('og:video:url') || meta('og:video') || meta('twitter:player:stream');
    const vt = meta('og:video:type') || meta('twitter:player:stream:content_type');
    if (!v || !(/^video\//.test(vt) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(v))) return null;
    return { kind: 'video', url: new URL(v, url).href, title: meta('og:title') || doc.title || '', w: +meta('og:video:width') || 0, h: +meta('og:video:height') || 0 };
  } catch (e) { return null; }
}

export async function mediaFor(url) {
  return /pinterest\.|^https?:\/\/pin\.it\//i.test(url) ? pinterestMedia(url) : pageVideo(url);
}

// the file itself, for the player (blob: URL) or for the library
export async function downloadMedia(m) {
  let r = await get(m.url, m.kind === 'video' ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8');
  // a Pinterest original that is not there (rare): the largest resized copy
  if (!r.ok && /\/originals\//.test(m.url)) r = await get(m.url.replace('/originals/', '/736x/'), 'image/*,*/*;q=0.8');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const blob = await r.blob();
  const ext = m.kind === 'video' ? ((m.url.match(/\.(mp4|webm|mov|m4v)(\?|$)/i) || [])[1] || 'mp4') : ((m.url.match(/\.(jpe?g|png|gif|webp)(\?|$)/i) || [])[1] || 'jpg');
  return { blob: blob.type ? blob : new Blob([blob], { type: m.kind === 'video' ? 'video/' + ext : 'image/' + ext }), ext: ext.toLowerCase() };
}
