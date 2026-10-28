// Personal data on screenshots (bank screens nearly always carry some): what the text read off a picture (ocr.js)
// says about card numbers, phones, e-mails, account and passport numbers, names and sums. Pure: no DOM, no I/O.
//   piiTypes(text)          → the kinds found in a picture's text, for the card's mark ('card', 'phone', …)
//   piiRegions(lines, opts) → where to hide them: boxes in the picture's 0..1 coordinates, each with its kind
// Lines come from the OCR worker: { x, y, w, h, text } in 0..1 of the picture. A box covers the matched part of its
// line: the text is assumed evenly spread over the line's width, with half a character of margin each side.

export const PII_V = 1;
import { KINDS } from './piikinds.js';
export { KINDS };

// Luhn: 16 random digits pass one time in ten, a real card number always does
function luhn(d) {
  let s = 0;
  for (let i = 0; i < d.length; i++) {
    let n = +d[d.length - 1 - i];
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    s += n;
  }
  return s % 10 === 0;
}

// first names often seen on bank screens (transfers, cards, chats); with a capitalised word next to them they read as a
// name. Latin ones are for the embossed name on a card picture.
const NAMES = new Set(('александр алексей анатолий андрей антон аркадий арсений артём артем борис вадим валентин валерий василий виктор ' +
  'виталий владимир владислав вячеслав геннадий георгий глеб григорий даниил данил денис дмитрий евгений егор иван игорь илья кирилл ' +
  'константин лев леонид максим марк матвей михаил никита николай олег павел пётр петр роман руслан семён семен сергей станислав степан ' +
  'тимофей тимур фёдор федор филипп эдуард юрий ярослав алёна алена александра алина алиса алла анастасия ангелина анна антонина валентина ' +
  'валерия вера вероника виктория галина дарья диана ева евгения екатерина елена елизавета жанна зоя инна ирина карина кира кристина ксения ' +
  'лариса лидия любовь людмила маргарита марина мария милана надежда наталья наталия нина оксана олеся ольга полина раиса светлана софия ' +
  'софья таисия тамара татьяна ульяна юлия яна ivan alexander alexey andrey anton artem boris denis dmitry egor igor ilya kirill maxim ' +
  'mikhail nikita nikolay oleg pavel roman sergey stanislav timur vladimir yury anna alena alina anastasia daria ekaterina elena irina ' +
  'kristina ksenia maria marina natalia olga polina svetlana tatiana yulia').split(' '));

// what each kind looks like in a line of text; `ok` filters what the pattern alone cannot tell
const RULES = [
  { kind: 'card', re: /(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)/g, ok: (m) => luhn(m.replace(/\D/g, '')) },
  // a masked card keeps its last digits: «•• 4417», «*4417», «Карта ···· 4417» — the number still identifies the person
  { kind: 'card', re: /(?:[•*·●]{1,4}\s?){1,4}\d{4}(?!\d)/g },
  { kind: 'account', re: /(?<!\d)(?:40[5-9]\d{2}|42\d{3}|30\d{3})[ ]?\d{3}[ ]?\d[ ]?\d{4}[ ]?\d{7}(?!\d)/g },
  { kind: 'account', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/g, ok: (m) => /\d{6}/.test(m.replace(/ /g, '')) },
  { kind: 'phone', re: /(?:\+7|(?<![\d+])8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g },
  { kind: 'phone', re: /\+(?!7)\d{1,3}(?:[\s()-]*\d){7,12}(?!\d)/g },
  { kind: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: 'passport', re: /(?<!\d)\d{2} ?\d{2} ?\d{6}(?!\d)/g, ok: (m, line) => /паспорт|серия|passport/i.test(line) || /^\d{2} \d{2} \d{6}$/.test(m) },
  { kind: 'name', re: /[А-ЯЁ][а-яё]{1,15}(?:\s[А-ЯЁ][а-яё]{1,20}|\s[А-ЯЁ]\.){1,2}/g, ok: (m) => nameLike(m) },
  { kind: 'name', re: /\b[A-Z]{3,12} [A-Z]{3,16}\b/g, ok: (m) => NAMES.has(m.split(' ')[0].toLowerCase()) },
  { kind: 'sum', re: /[-−+]?\s?(?:\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d{1,2})?\s?(?:₽|руб\.?|р\.|[РP](?![\p{L}\d])|\$|€|£|¥|₸)/gu }, // the text reader often sees ₽ as Р
  { kind: 'sum', re: /[$€£]\s?\d[\d ,]*(?:\.\d{1,2})?/g },
];

// «Иван Петров», «Анна С.», «Сергеевич» in a name: a known first name, or a patronymic, among two or three words
function nameLike(m) {
  const w = m.split(/\s/);
  if (NAMES.has(w[0].toLowerCase()) || (w[1] && NAMES.has(w[1].toLowerCase()))) return true;
  return w.some((x) => /(?:вич|вна|ична|оглы|кызы)$/.test(x));
}

function matches(line, { sums = true } = {}) {
  const out = [];
  for (const r of RULES) {
    if (r.kind === 'sum' && !sums) continue;
    r.re.lastIndex = 0;
    for (let m; (m = r.re.exec(line));) {
      const s = m[0].trim();
      if (!s || (r.ok && !r.ok(s, line))) continue;
      const at = m.index + m[0].indexOf(s);
      // a longer find of another kind already covers it (a card number is not also a sum)
      if (out.some((o) => at < o.at + o.len && o.at < at + s.length)) continue;
      out.push({ kind: r.kind, at, len: s.length, text: s });
    }
  }
  return out;
}

// the kinds in a whole text; sums do not count here — nearly every bank screen has one, the mark would be on all of them
export function piiTypes(text) {
  const kinds = new Set();
  for (const line of String(text || '').split('\n')) for (const m of matches(line, { sums: false })) kinds.add(m.kind);
  return [...kinds];
}

// how wide a character is next to others in an ordinary UI font (em): digits, spaces and punctuation are narrower
// than letters, so a sum after a label starts later than an even split says
const WIDE = /[мшщжюыфМШЩЖЮЫФmwMW@%]/, NARROW = /[\s.,:;'"!|il1ijtfr]/;
const cw = (ch) => (NARROW.test(ch) ? 0.3 : /\d/.test(ch) ? 0.56 : WIDE.test(ch) ? 0.82 : /[+\-()]/.test(ch) ? 0.42 : ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 0.68 : 0.55);

export function piiRegions(lines, { sums = true } = {}) {
  const out = [];
  for (const l of lines || []) {
    const pos = [0];
    for (const ch of l.text) pos.push(pos[pos.length - 1] + cw(ch));
    const k = l.w / (pos[pos.length - 1] || 1), at = (i) => l.x + pos[Math.max(0, Math.min(pos.length - 1, i))] * k;
    for (const m of matches(l.text, { sums })) {
      // margins in em: the estimate is rough, and a digit left showing is worse than a letter of the label covered
      const x0 = Math.max(l.x, at(m.at) - 0.5 * k), x1 = Math.min(l.x + l.w, at(m.at + m.len) + 0.35 * k);
      out.push({ kind: m.kind, text: m.text, x: x0, y: l.y, w: x1 - x0, h: l.h, lx: l.x, lw: l.w });
    }
  }
  return out;
}

// The estimate above knows letters only on average: in another font a digit can stay out of the box («Карта 4|…»,
// seen in the exe). With the picture at hand (masker.js) the edges move to the real gaps between words: `ink` says per
// pixel column of the line whether anything is drawn there; the left edge goes to the middle of the gap nearest to it
// on the left (or under it), the right edge to the nearest gap on the right. Columns are in the line's own pixels.
export function snapToGaps(ink, x0, x1, h) {
  const n = ink.length, min = Math.max(2, Math.round(h * 0.18));
  const gaps = [];
  for (let i = 0; i < n;) {
    if (ink[i]) { i++; continue; }
    let j = i;
    while (j < n && !ink[j]) j++;
    if (j - i >= min || i === 0 || j === n) gaps.push([i, j]);
    i = j;
  }
  if (!gaps.length) return [x0, x1];
  const mid = (g) => (g[0] + g[1]) / 2;
  // left: the last gap that starts before the estimate's start plus a little (a digit may hide just inside it)
  const left = gaps.filter((g) => g[0] <= x0 + h * 0.4).pop();
  const right = gaps.find((g) => g[1] >= x1 - h * 0.4 && mid(g) > (left ? mid(left) : -1));
  const a = left ? (left[1] === n ? x0 : Math.max(0, Math.min(mid(left), left[1] - 1))) : x0;
  const b = right ? (right[0] === 0 ? x1 : Math.max(right[0] + 1, Math.min(mid(right), n))) : x1;
  return b > a ? [a, b] : [x0, x1];
}
