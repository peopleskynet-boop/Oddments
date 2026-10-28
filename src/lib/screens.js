// Screens of apps — our own and competitors' — as a library: which app, platform, kind of screen, UI patterns, when.
// Stored in an optional field `scr: { app, os, type, pat: [], date, ver }` of the item (no migration). Guesses come
// from what is already known about the picture: the text on it (ocr.js), its size (phone resolutions) and its
// colours (brand colours); the person confirms them with a click. Pure: no DOM, no I/O.

// banks and wallets a product designer at a Russian bank compares against; `words` — how they show up in a
// screenshot's text, `rgb` — the brand colour (a weak hint only: half the internet is yellow or red)
export const APPS = [
  { name: 'Т-Банк', words: ['т-банк', 'т банк', 'тинькофф', 'tinkoff', 't-bank', 'tbank'], rgb: [255, 221, 45] },
  { name: 'Сбер', words: ['сбербанк', 'сбер ', 'сбер\n', 'sberbank', 'сберпэй', 'sberpay', 'сбол'], rgb: [33, 160, 56] },
  { name: 'Альфа-Банк', words: ['альфа-банк', 'альфа банк', 'alfa-bank', 'alfa bank', 'альфа-'], rgb: [239, 49, 36] },
  { name: 'ВТБ', words: ['втб', 'vtb'], rgb: [10, 40, 150] },
  { name: 'Озон Банк', words: ['озон банк', 'ozon банк', 'ozon bank', 'озон карта', 'ozon карта'], rgb: [0, 91, 255] },
  { name: 'Яндекс Пэй', words: ['яндекс пэй', 'yandex pay', 'яндекс pay', 'яндекс сплит', 'сплит'], rgb: [255, 204, 0] },
  { name: 'Газпромбанк', words: ['газпромбанк', 'gazprombank'], rgb: [0, 70, 160] },
  { name: 'Райффайзен', words: ['райффайзен', 'raiffeisen'], rgb: [254, 230, 0] },
  { name: 'Совкомбанк', words: ['совкомбанк', 'халва'], rgb: [0, 45, 130] },
  { name: 'Почта Банк', words: ['почта банк'], rgb: [0, 50, 160] },
  { name: 'ЮMoney', words: ['юmoney', 'yoomoney', 'юмани'], rgb: [130, 50, 255] },
  { name: 'Revolut', words: ['revolut'], rgb: [25, 28, 31] },
  { name: 'Monzo', words: ['monzo'], rgb: [255, 77, 86] },
];

// kinds of screens, by the words such a screen nearly always carries
export const TYPES = [
  { name: 'Онбординг', words: ['добро пожаловать', 'пропустить', 'начать', 'давайте знакомиться', 'welcome', 'get started'] },
  { name: 'Вход', words: ['войти', 'пароль', 'код из смс', 'придумайте код', 'введите код', 'face id', 'touch id', 'вход', 'log in', 'sign in'] },
  { name: 'Главная', words: ['все счета', 'мои финансы', 'всего средств', 'баланс', 'главная'] },
  { name: 'Перевод', words: ['перевод', 'получатель', 'по номеру телефона', 'сбп', 'перевести', 'между своими', 'transfer'] },
  { name: 'Оплата', words: ['оплатить', 'к оплате', 'платежи', 'жкх', 'мобильная связь', 'штрафы', 'оплата', 'pay'] },
  { name: 'Выпуск карты', words: ['оформить карту', 'заказать карту', 'выпустить карту', 'выпуск карты', 'доставка карты', 'дизайн карты'] },
  { name: 'Кэшбэк', words: ['кэшбэк', 'кешбэк', 'кешбек', 'баллы', 'категории повышенного', 'cashback'] },
  { name: 'История', words: ['история', 'операции', 'выписка', 'расходы', 'траты'] },
  { name: 'Вклад и накопления', words: ['вклад', 'накопительный', 'копилка', 'ставка', '% годовых'] },
  { name: 'Кредит', words: ['кредит', 'кредитная', 'рассрочка', 'платёж по кредиту', 'одобрен'] },
  { name: 'Профиль и настройки', words: ['профиль', 'настройки', 'безопасность', 'уведомления', 'выйти из приложения'] },
  { name: 'Поддержка', words: ['чат', 'поддержка', 'напишите нам', 'помощь'] },
  { name: 'Ошибка', words: ['что-то пошло не так', 'ошибка', 'не удалось', 'попробуйте позже', 'нет соединения'] },
  { name: 'Успех', words: ['готово', 'успешно', 'перевод отправлен', 'деньги отправлены', 'платёж прошёл'] },
];

// UI patterns a screen shows; chosen by hand (they are about the layout, the text says little)
export const PATTERNS = ['Боттомшит', 'Сторис', 'Пустое состояние', 'Ошибка', 'Скелетон', 'Тост', 'Модальное окно', 'Список', 'Карусель', 'Форма', 'Клавиатура', 'Таббар', 'Поиск', 'Фильтры', 'Чат', 'Виджет'];

import { OSES, screenWords } from './screenwords.js';
export { OSES, screenWords };

// phone screenshot sizes (portrait, px): iPhones by Apple's tables, Android by the commonest panels
const IOS = ['750x1334', '828x1792', '1125x2436', '1242x2688', '1170x2532', '1179x2556', '1284x2778', '1290x2796', '1080x2340', '1206x2622', '1320x2868', '640x1136', '1242x2208'];
const ANDROID = ['1080x2400', '1080x2340', '1080x2412', '1080x2408', '1440x3200', '1440x3088', '1080x2460', '720x1600', '1220x2712', '1260x2800', '1080x2280', '1440x3120'];

// letters that look alike in Latin and Cyrillic fold to one form on both sides: the text reader reads «Т-Банк» as
// «T-Банк» now and then (a lone capital has no neighbours to tell its alphabet by)
const FOLD = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', ё: 'е' };
const lc = (s) => String(s || '').toLowerCase().replace(/[abcehkmoptxyё]/g, (ch) => FOLD[ch]);
const has = (text, w) => text.includes(lc(w));

function colourDist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

// → { app, os, type } with what could be told, each { value, sure } (sure: the text names it; not sure: size or colour)
export function guessScreen(it) {
  const text = lc(it.ocr), out = {};
  // app: the name in the text wins; the brand colour among the picture's first colours is only a «maybe»
  let best = null;
  for (const a of APPS) {
    const n = a.words.reduce((k, w) => k + (has(text, w) ? 1 : 0), 0);
    if (n && (!best || n > best.n)) best = { a, n };
  }
  if (best) out.app = { value: best.a.name, sure: true };
  else {
    const cols = (it.colors || []).slice(0, 4).map(hexRgb).filter(Boolean);
    let near = null;
    for (const a of APPS) for (const c of cols) { const d = colourDist(a.rgb, c); if (d < 40 && (!near || d < near.d)) near = { a, d }; }
    if (near) out.app = { value: near.a.name, sure: false };
  }
  // platform: Apple's «9:41» in the status bar, or a known screen size
  const wh = it.w && it.h ? `${Math.min(it.w, it.h)}x${Math.max(it.w, it.h)}` : '';
  if (/(^|\n)\s*9:41\b/.test(text) || IOS.includes(wh)) out.os = { value: 'ios', sure: /(^|\n)\s*9:41\b/.test(text) };
  else if (ANDROID.includes(wh)) out.os = { value: 'android', sure: false };
  else if (it.w && it.h && it.w > it.h * 1.2) out.os = { value: 'web', sure: false };
  // kind of screen: the most words of one kind (two at least, or one long phrase)
  let tb = null;
  for (const t of TYPES) {
    const hits = t.words.filter((w) => has(text, w));
    const score = hits.reduce((k, w) => k + (w.includes(' ') ? 2 : 1), 0);
    if (score && (!tb || score > tb.score)) tb = { t, score };
  }
  if (tb && tb.score >= 2) out.type = { value: tb.t.name, sure: tb.score >= 3 };
  return out;
}

// one flow (a collection of steps, flows.js) in numbers: steps, seconds of the recording, waits, ways back
// steps: items in order, with optional flowT (second of the recording) and flowSig ([{ k: 'wait', s } | { k: 'back' }])
export function flowStats(steps) {
  const t = steps.map((s) => s.flowT).filter((x) => x != null);
  const sig = steps.flatMap((s) => s.flowSig || []);
  const waits = sig.filter((x) => x.k === 'wait');
  return {
    steps: steps.length,
    seconds: t.length > 1 ? Math.round((t[t.length - 1] - t[0]) * 10) / 10 : null,
    waits: waits.length,
    waitSeconds: Math.round(waits.reduce((a, x) => a + (x.s || 0), 0) * 10) / 10,
    backs: sig.filter((x) => x.k === 'back').length,
  };
}
