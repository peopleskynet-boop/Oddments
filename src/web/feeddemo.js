// Demo RSS for the browser build: the real feeds are not readable from a web page (CORS), so the http stub answers
// for them with a few generated items — pictures are drawn SVGs, so the feed works offline and is the same every time.
const PALETTES = [['#ff5f6d', '#ffc371'], ['#2b5876', '#4e4376'], ['#c6ff00', '#0a0b09'], ['#8360c3', '#2ebf91'], ['#ee0979', '#ff6a00'], ['#1d2b64', '#f8cdda'], ['#00c6ff', '#0072ff'], ['#f7971e', '#ffd200']];
const WORDS = {
  design: ['Brand identity for a Nordic bakery', 'Poster series in Swiss style', 'Packaging that folds into a lamp', 'A type foundry rethinks Cyrillic'],
  '3d': ['Hard-surface robot in Blender 5', 'Stylised forest environment breakdown', 'Procedural rocks with geometry nodes', 'Character lookdev: glass and fur'],
  motion: ['Loop: liquid chrome title sequence', 'Short film made with paper cut-outs', 'Kinetic type for a music festival', 'Behind the titles: night city'],
  ux: ['Designing calm interfaces', 'Micro-interactions that explain themselves', 'A case for bigger touch targets', 'Dark mode colour systems'],
  art: ['Sculptures made of folded steel', 'Murals that change with the light', 'Embroidered maps of rivers', 'Ceramics inspired by coral'],
  ai: ['A new open model writes 3D scenes from text', 'Image models learn consistent characters', 'Design tools add AI layout suggestions', 'Researchers show faster on-device diffusion'],
};

function picture(seed, w = 1200, h = 900) {
  const [a, b] = PALETTES[seed % PALETTES.length];
  const r = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const shapes = Array.from({ length: 6 }, (_, i) => `<circle cx="${Math.round(r(i) * w)}" cy="${Math.round(r(i + 9) * h)}" r="${Math.round(60 + r(i + 3) * 260)}" fill="${i % 2 ? a : b}" opacity="${(0.25 + r(i + 5) * 0.5).toFixed(2)}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

const VIMEO_IDS = ['1236356268', '1235421735', '1236047508', '1205819775'];
export function demoFeed(url) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; } })();
  const topic = /hnrss|theverge|techcrunch|technologyreview|arstechnica|openai|blog\.google|huggingface|simonwillison/.test(host) ? 'ai' : /80\.lv|cgchannel|blendernation/.test(host) ? '3d' : /vimeo|motionographer/.test(host) ? 'motion' : /smashing|uxdesign|awwwards/.test(host) ? 'ux' : /colossal/.test(host) ? 'art' : 'design';
  let seed = [...host].reduce((s, c) => s + c.charCodeAt(0), 0);
  const now = Date.now();
  const items = WORDS[topic].map((title, i) => {
    seed += 7;
    const vimeo = host.includes('vimeo');
    const link = vimeo ? `https://vimeo.com/channels/staffpicks/${VIMEO_IDS[i]}` : `https://${host}/demo/${seed}`;
    const date = new Date(now - (i * 7 + (seed % 5)) * 3600000).toUTCString();
    const img = picture(seed, i % 2 ? 900 : 1200, i % 2 ? 1200 : 800);
    return `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[<img src="${img}"/> A demo item from ${host}: the real feed is read by the app, not by a web page. ${title} — notes on the process, the references and the tools behind it.]]></description></item>`;
  }).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${host}</title>${items}</channel></rss>`;
}

// a demo article page for «Сохранить статью» (Readability reads it like a real one)
export function demoArticle(url) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'site'; } })();
  const seed = [...url].reduce((s, c) => s + c.charCodeAt(0), 0);
  const para = (n) => `<p>${['The project started with a simple question: how should a reference library feel when it has ten thousand pictures in it?', 'We sketched the grid first, then the motion: cards scatter when one opens, and gather back when it closes.', 'Most of the work went into the details nobody notices — the spacing of the captions, the way a tag chip springs when you tap it.', 'The colour system is built on a single accent and a warm near-black, so pictures always stay the loudest thing on screen.'][n % 4]}</p>`;
  return `<!doctype html><html><head><title>Demo article · ${host}</title><meta property="og:image" content="${picture(seed)}"><meta property="og:site_name" content="${host}"></head><body><header>Menu · Subscribe</header>
    <article><h1>Designing a calm library for references</h1><p class="byline">By Demo Author</p>${para(0)}${para(1)}<h2>Motion with a purpose</h2>${para(2)}<figure><img src="${picture(seed + 3)}" width="1200" height="800"><figcaption>The grid at rest.</figcaption></figure>${para(3)}${para(1)}${para(2)}<blockquote>Pictures first, interface second.</blockquote>${para(0)}</article><footer>© ${host}</footer></body></html>`;
}

// a demo Telegram channel page (t.me/s/<name>) in the same markup as the real one: photo posts, a text post, a video
// post with a file, and an ad post marked by law (erid) that the feed must leave out
export function demoTelegram(url) {
  const name = (url.match(/t\.me\/s\/([\w]+)/) || [])[1] || 'channel';
  let seed = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  const now = Date.now();
  const post = (i, body) => `<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="${name}/${100 + i}">${body}<div class="tgme_widget_message_footer"><span class="tgme_widget_message_views">${[1200, 3400, 980, 15600, 2100][i % 5] / (i === 3 ? 1 : 1)}</span><a class="tgme_widget_message_date" href="https://t.me/${name}/${100 + i}"><time datetime="${new Date(now - (5 - i) * 3600000).toISOString()}"></time></a></div></div></div>`;
  const photo = (k) => `<a class="tgme_widget_message_photo_wrap" href="https://t.me/${name}/1" style="width:800px;background-image:url('${picture(seed + k)}')"></a>`;
  const text = (t) => `<div class="tgme_widget_message_text js-message_text" dir="auto">${t}</div>`;
  seed += 3;
  const html = [
    post(0, photo(1) + text(`Свежий референс: стеклянные персонажи<br/><br/>Мягкий свет, розовые рефлексы, всё в Blender.`)),
    post(1, text(`Реклама. ООО «Курсы» erid: 2Vtzqx7Abc<br/>Курс по моушену со скидкой по ссылке`) + photo(2)),
    post(2, text(`Подборка шрифтов недели<br/>Пять гротесков с хорошей кириллицей.`)),
    post(3, `<a class="tgme_widget_message_video_player"><i class="tgme_widget_message_video_thumb" style="background-image:url('${picture(seed + 5)}')"></i><video class="tgme_widget_message_video" src="data:video/mp4;base64," ></video></a>` + text(`Как мы делали заставку в Cinema 4D<br/>Разбор по шагам.`)),
    post(4, photo(3) + photo(4) + text(`Айдентика для кофейни — альбом из двух картинок`)),
  ].join('');
  return `<!doctype html><html><head><meta property="og:title" content="Демо: ${name}"></head><body><section class="tgme_channel_history">${html}</section></body></html>`;
}
