// Telegram channels in the feed: a public channel has a public web preview without login — t.me/s/<name> — with
// the latest posts: text, photos, video (a direct mp4 with a short-lived token), date, views. It is read like an RSS
// feed (a few times a day, one page per channel). Private channels and chats are not readable this way.
// Ads are left out: Telegram's own sponsored messages never appear in the preview; channel owners' ads are marked by
// law in Russia (erid, «Реклама», «#реклама», «на правах рекламы», «партнёрский материал») and recognised here.

// the user's channels, checked 20.10.2026 (open preview, fresh posts); topic → the feed's tab
export const CHANNELS = [
  ['denissexy', 'Denis Sexy IT', 'ai'], ['TochkiNadAI', 'Точки над ИИ', 'ai'], ['ai_mind_set', 'AI Mindset', 'ai'], ['strangedalle', 'Ai molodca', 'ai'],
  ['prstpromotion', 'Прост про моушен', 'motion'], ['vladsolovjov', 'Влад Соловьев', 'motion'], ['cg_kungfu', 'CG Kung Fu', 'motion'],
  ['CGango_Unchained', 'Сиджанго Освобождённый', 'motion'], ['tributecg', 'Tribute cg', 'motion'], ['c4d42', 'Method', 'motion'],
  ['ikapustin_c4d', 'iKapustin', 'motion'], ['moinepomoi', 'MNP · CAD & CG Tools', 'motion'], ['VAI_ART', 'VAI', 'motion'],
  ['reference_exhibition', 'Выставка', 'design'], ['refs_hi', 'Рефы, привет', 'design'], ['spottedui', 'Spotted UI', 'ux'],
  ['ZNMA_ULTRA', '3NMA', 'design'], ['portfolio_showcase', 'Витрина портфолио', 'design'], ['designar_ru', 'Designar.ru', 'design'],
  ['martsynovich', 'залезай в робота, синдзи', 'design'], ['thisisnotatable', 'табличный дизайн', 'ux'], ['ayuev', 'ARE YOU EVE', 'design'],
  ['ilyaskopin', 'Скопин', 'design'], ['webdesignbasics', 'основы веб дизайна', 'ux'], ['leonaau', 'Это Лео', 'design'],
  ['antonrepponen', 'Repponen', 'design'], ['data_csv', 'data.csv', 'ux'], ['dra_goy', 'Dragoy Everyday', 'design'],
  ['yandex360design', 'Дизайн Яндекс 360', 'ux'], ['cdrommm', 'cd-rom', 'design'], ['sixtyfourmag', 'f/64', 'design'],
  ['ffdd2d', '#ФФДД2Д', 'design'], ['design_mts', 'МТС Дизайн', 'design'],
].map(([name, title, topic]) => ({ id: 'tg-' + name.toLowerCase(), name: title, url: `https://t.me/s/${name}`, topic, telegram: name }));

// a channel name from a link or «@name»: t.me/name, t.me/s/name, telegram.me/name, @name
export function channelName(raw) {
  const m = String(raw).trim().match(/^@?([A-Za-z][\w]{3,31})$/) || String(raw).match(/(?:t(?:elegram)?\.me)\/(?:s\/)?([A-Za-z][\w]{3,31})(?:[/?#]|$)/i);
  return m && !/^(joinchat|addstickers|share|proxy|iv)$/i.test(m[1]) ? m[1] : '';
}

// the law's ad marks and the usual promo talk
const AD = /\berid\b|erid[:=]|#реклама|(^|[\s.(])реклама[.:\s]|на правах рекламы|рекламн(ая|ый) (пост|интеграци)|партн[её]рск(ий|ая|ое) (пост|материал|публикаци)|по промокоду|промокод[:\s]|скидк[аиу] по ссылке/i;
export const isAd = (text, html = '') => AD.test(text) || /[?&]erid=|erid%3d/i.test(html);
// the site's own «read more» tail (RSS and posts carry it as plain text, nothing to click — bug #99)
export const cutMore = (t) => String(t || '').replace(/\s*(Читать (статью |пост )?(полностью|далее|дальше)|Подробнее|Read more|Continue reading|Read the full (story|article))[.…:!]*\s*(→|»)?\s*$/i, '').replace(/\s*The post .{0,200} appeared first on .{0,120}$/i, '').trim();

const bg = (el) => { const m = el && (el.getAttribute('style') || '').match(/url\(['"]?([^'")]+)/); return m ? m[1] : ''; };
const views = (s) => { const m = String(s || '').trim().match(/^([\d.,]+)\s*([KM]?)/i); if (!m) return 0; const n = parseFloat(m[1].replace(',', '.')); return Math.round(n * (/k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1)); };

// → { items, ads } — the posts of one page of t.me/s/<name>, newest last on the page
export function parseTelegram(html, src) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let ads = 0;
  const items = [];
  doc.querySelectorAll('.tgme_widget_message[data-post]').forEach((m) => {
    const post = m.getAttribute('data-post');
    const textEl = m.querySelector('.tgme_widget_message_text');
    let text = '';
    if (textEl) { textEl.querySelectorAll('br').forEach((br) => br.replaceWith('\n')); text = textEl.textContent.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
    // ads: the text, the hrefs of its links and of the post's buttons (an erid is often only there — bug #106)
    const btns = [...m.querySelectorAll('.tgme_widget_message_inline_button, .tgme_widget_message_inline_keyboard a')].map((b) => (b.textContent || '') + ' ' + (b.getAttribute('href') || '')).join(' ');
    if (isAd(text + ' ' + btns, (textEl ? textEl.innerHTML : '') + ' ' + btns)) { ads++; return; }
    text = cutMore(text);
    // the post's links (Telegram hides most of them behind words): kept to make the words clickable (bug #105)
    const links = textEl ? [...textEl.querySelectorAll('a[href]')].map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') })).filter((l) => l.text && /^https?:/i.test(l.href)).slice(0, 20) : [];
    const photos = [...m.querySelectorAll('.tgme_widget_message_photo_wrap')].map(bg).filter(Boolean);
    const vid = m.querySelector('video.tgme_widget_message_video, video');
    const vthumb = bg(m.querySelector('.tgme_widget_message_video_thumb'));
    const preview = bg(m.querySelector('.link_preview_image, .link_preview_right_image'));
    const date = Date.parse((m.querySelector('.tgme_widget_message_date time') || {}).getAttribute?.('datetime') || '') || Date.now();
    const image = photos[0] || vthumb || preview || '';
    if (!text && !image && !vid) return; // a service message, a poll, a sticker
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    // a post with a picture keeps its first line as the title; a text post has none — its whole text is the card
    // (the first line cut at 160 characters mid-word read as a broken title, bug #104)
    const textOnly = !image && !vid;
    const title = (lines[0] || src.name).replace(/^[#\s]+$/, '').slice(0, 160);
    items.push({
      id: src.id + '-' + post.split('/')[1], source: src.id, sourceName: src.name, topic: src.topic,
      ...(src.person ? { person: src.person } : {}),
      title, text: textOnly ? text.slice(0, 2400) : lines.slice(1).join('\n').slice(0, 900) || (lines[0] && lines[0].length > 160 ? lines[0] : ''),
      ...(links.length ? { links } : {}),
      link: `https://t.me/${post}`, date, image, ...(photos.length > 1 ? { images: photos.slice(0, 10) } : {}),
      views: views((m.querySelector('.tgme_widget_message_views') || {}).textContent),
      video: vid && vid.getAttribute('src') ? { site: 'file', src: vid.getAttribute('src'), poster: vthumb } : null,
      ...(!image && !vid ? { post: true } : {}), telegram: true,
    });
  });
  // how a post did against the channel's usual: views / median views of the page (for the digest's «notable»)
  const vs = items.map((x) => x.views).filter(Boolean).sort((a, b) => a - b);
  const med = vs.length ? vs[Math.floor(vs.length / 2)] : 0;
  if (med) items.forEach((x) => { if (x.views) x.hot = Math.round((x.views / med) * 100) / 100; });
  return { items, ads };
}
