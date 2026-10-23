// AI through an API instead of the local model (Settings › «ИИ», «Через API»). Two services, each optional on top of
// the other:
// - Claude (Anthropic, the key also used by the icon constructor) looks at each picture once and writes a short
//   description and 3–6 tags in Russian — tags in any words, not the 129 of the local vocabulary; the search finds
//   pictures by these descriptions on this computer, for free.
// - Voyage (voyageai.com, voyage-multimodal-3) turns pictures and search phrases into vectors, as the local model
//   does: search and «По смыслу» work the same way, with no model on the disk.
// What leaves the computer: a small copy of each picture (512 px JPEG), never the original, and the search phrase
// (Voyage only). Paid per picture, once; the cost is shown before a big pass starts (estimate()).
import { aiPrefs as iconPrefs } from './iconai.js';
import { assetUrl } from './library.js';

export const TAG_MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — дешевле всего, для тегов хватает' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — точнее описания, ~в 3 раза дороже' },
];
// $ per million tokens (in, out); approximate — for the estimate only
const PRICE = { 'claude-haiku-5-5': [1, 5], 'claude-sonnet-5-5': [3, 15], 'claude-opus-5-5': [5, 25] };
export const VOYAGE = { id: 'voyage-multimodal-3', dim: 1024, price: 0.12 };
const SIDE = 512, PER_CALL = 6;

const STORE = 'perch.aicloud';
export const cloudPrefs = () => { try { return { voyageKey: '', tagModel: TAG_MODELS[0].id, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (e) { return { voyageKey: '', tagModel: TAG_MODELS[0].id }; } };
export const setCloudPrefs = (p) => { try { localStorage.setItem(STORE, JSON.stringify({ ...cloudPrefs(), ...p })); } catch (e) { /* private mode */ } };
export const claudeKey = () => iconPrefs().key;
export const hasVoyage = () => !!cloudPrefs().voyageKey;

// ≈ cost of describing n pictures (and embedding them, with Voyage): a 512×384 copy is ~262 image tokens for Claude
// (w·h/750), the instructions shared by 6 pictures, ~70 tokens of answer each; Voyage counts 560 pixels as a token
export function estimate(nDescribe, nEmbed) {
  const [pin, pout] = PRICE[cloudPrefs().tagModel] || PRICE['claude-haiku-5-5'];
  const claude = nDescribe * ((262 + 80) * pin + 70 * pout) / 1e6;
  const voyage = nEmbed * (SIDE * 384 / 560) * VOYAGE.price / 1e6;
  return claude + voyage;
}
export const usd = (x) => (x < 0.01 ? '< $0,01' : '$' + x.toFixed(2).replace('.', ','));

const inApp = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
async function post(url, headers, body) {
  let r;
  if (inApp()) {
    const { fetch: tfetch } = await import('@tauri-apps/plugin-http');
    r = await tfetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } else r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error)) || j.detail || 'HTTP ' + r.status;
    // which service said it, and its own reason — «ключ не подошёл» alone did not say which key (bug #110)
    const who = /voyageai/.test(url) ? 'Voyage' : 'Anthropic';
    const why = r.status === 401 || r.status === 403 ? `ключ не подошёл (${String(msg).slice(0, 140)})` : r.status === 429 ? 'слишком много запросов — продолжу через минуту' : r.status === 402 ? 'на счёте закончились деньги' : String(msg);
    const e = new Error(who + ': ' + why);
    e.status = r.status;
    throw e;
  }
  return j;
}

// the thumbnail as a small JPEG, base64 (SVG drawn on white, as the eye sees an icon)
export async function smallCopy(it) {
  const url = assetUrl(it.thumb);
  let src;
  if (/\.svg$/i.test(it.thumb)) { src = new Image(); src.src = url; await src.decode(); }
  else src = await createImageBitmap(await (await fetch(url)).blob());
  const w0 = src.width || SIDE, h0 = src.height || SIDE, k = Math.min(1, SIDE / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

const SYSTEM = `Ты подписываешь референсы дизайнера, чтобы он находил их поиском своими словами.
Для каждой картинки дай:
- "desc": одно-два предложения по-русски — что изображено: предметы, люди и что они делают, цвета (в том числе волос,
  одежды, фона), материал, техника и стиль (3D-рендер, фото, иллюстрация, интерфейс, иконка, типографика, плакат…).
- "tags": 3–6 коротких тегов по-русски в нижнем регистре: главные предметы и стиль («наушники», «3d-рендер»,
  «голубые волосы»). Без общих слов вроде «картинка», «изображение», «дизайн».
Ответ — только JSON: {"items":[{"n":1,"desc":"…","tags":["…"]}]}`;

// → [{ desc, tags }] in the order of the pictures, and the tokens used
export async function describe(pics) {
  const key = claudeKey();
  if (!key) throw Object.assign(new Error('нет ключа Anthropic'), { status: 401 });
  const content = [];
  pics.forEach((b64, i) => {
    content.push({ type: 'text', text: `Картинка ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  });
  content.push({ type: 'text', text: `Опиши все ${pics.length} картинки.` });
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  // always: the exe's HTTP plugin adds an Origin header like a browser, and the API then wants this opt-in too —
  // without it the exe got «ключ не подошёл» while the web build worked (bug #110)
  headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const j = await post('https://api.anthropic.com/v1/messages', headers, { model: cloudPrefs().tagModel, max_tokens: 200 + pics.length * 160, system: SYSTEM, messages: [{ role: 'user', content }] });
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  let items = [];
  try { items = JSON.parse(m ? m[0] : '{}').items || []; } catch (e) { /* answered badly: described nothing */ }
  return pics.map((_, i) => {
    const x = items.find((y) => +y.n === i + 1) || items[i] || {};
    const tags = (Array.isArray(x.tags) ? x.tags : []).map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter((t) => t && t.length < 40).slice(0, 6);
    return { desc: String(x.desc || '').slice(0, 400), tags };
  });
}

async function voyage(inputs, type) {
  const j = await post('https://api.voyageai.com/v1/multimodalembeddings',
    { 'content-type': 'application/json', authorization: 'Bearer ' + cloudPrefs().voyageKey },
    { model: VOYAGE.id, inputs, input_type: type });
  return (j.data || []).sort((a, b) => a.index - b.index).map((d) => {
    const v = Float32Array.from(d.embedding);
    let l = 0; for (const x of v) l += x * x; l = Math.sqrt(l) || 1;
    return v.map((x) => x / l);
  });
}
export const PER_REQUEST = PER_CALL;
export const embedPictures = (pics) => voyage(pics.map((b64) => ({ content: [{ type: 'image_base64', image_base64: 'data:image/jpeg;base64,' + b64 }] })), 'document');
export const embedText = async (q) => (await voyage([{ content: [{ type: 'text', text: q }] }], 'query'))[0];

// «Проверить» next to a key in Settings (bug #110): a tiny request to the service with exactly this key — no tokens spent
// on Anthropic (the model list), a two-word vector on Voyage. → { ok, msg } in plain words
export async function testKey(service, key) {
  key = String(key || '').trim();
  if (!key) return { ok: false, msg: 'ключа нет' };
  const anthropic = service === 'anthropic';
  const url = anthropic ? 'https://api.anthropic.com/v1/models?limit=1' : 'https://api.voyageai.com/v1/multimodalembeddings';
  const init = anthropic
    ? { method: 'GET', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }
    : { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ model: VOYAGE.id, inputs: [{ content: [{ type: 'text', text: 'проверка' }] }], input_type: 'query' }) };
  let r;
  try {
    if (inApp()) { const { fetch: tfetch } = await import('@tauri-apps/plugin-http'); r = await tfetch(url, init); } else r = await fetch(url, init);
  } catch (e) { return { ok: false, msg: 'нет связи с сервисом: ' + (e.message || e) }; }
  if (r.ok) return { ok: true, msg: 'работает' };
  const j = await r.json().catch(() => ({}));
  const said = String((j.error && (j.error.message || j.error)) || j.detail || '').slice(0, 160);
  const msg = r.status === 401 ? (anthropic && !/^sk-ant-/.test(key) ? 'это не ключ Anthropic (они начинаются с sk-ant-)' : !anthropic && /^sk-ant-/.test(key) ? 'это ключ Anthropic, а нужен ключ Voyage (pa-…)' : 'ключ не принят — неверный, удалён или истёк')
    : r.status === 403 ? 'у ключа нет доступа' : r.status === 429 ? 'слишком много запросов — ключ рабочий, попробуйте позже'
      : r.status === 400 && /workspace/i.test(said) ? 'ключу нужен ID workspace — создайте ключ для одного workspace' : 'ответ ' + r.status;
  return { ok: r.status === 429, msg: said ? msg + ` (${said})` : msg };
}
