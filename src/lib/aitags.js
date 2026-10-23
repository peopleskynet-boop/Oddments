// AI tags: after the library is studied, every picture gets up to four tags from a Russian vocabulary of
// design-reference words, chosen by the same SigLIP vectors as the search. Raw similarity favours a few «hub» words
// for every picture (3D-рендер, пиксель-арт…), so each word is judged against how it scores across the whole
// library (a z-score from a sample), and must also pass an absolute floor. Tuned on the user's own 187 pictures:
// «лебедь, птица», «японский текст», «камера, объектив», «кресло, оранжевый», «игральные карты», «горы».
// The tags live apart from the person's own (it.aiTags), are searchable, and each can be dropped (it.aiNo keeps it
// from coming back) or pinned, which makes it an ordinary tag.
export const VOCAB_V = 1;
export const VOCAB = [
  'фото', '3D-рендер', 'иллюстрация', 'аниме', 'комикс', 'плакат', 'типографика', 'интерфейс', 'мобильное приложение',
  'логотип', 'иконка', 'паттерн', 'коллаж', 'скриншот', 'книжная обложка', 'журнальный разворот', 'инфографика',
  'пиксель-арт', 'абстракция', 'минимализм', 'ретро', 'глитч', 'чёрно-белое', 'неон', 'градиент',
  'человек', 'лицо', 'портрет', 'рука', 'глаза', 'волосы', 'девушка', 'мужчина', 'ребёнок', 'модель', 'мода',
  'показ мод', 'одежда', 'платье', 'обувь', 'украшения', 'персонаж', 'робот', 'животное', 'кошка', 'собака', 'птица',
  'цветок', 'растение', 'дерево', 'еда', 'фрукты', 'напиток', 'машина', 'мотоцикл', 'самолёт', 'здание', 'архитектура',
  'интерьер', 'спальня', 'кухня', 'мебель', 'кресло', 'лампа', 'город', 'улица', 'природа', 'горы', 'море', 'вода',
  'небо', 'облака', 'закат', 'ночь', 'огонь', 'молния', 'космос', 'пустыня', 'снег', 'стекло', 'металл', 'хром',
  'пластик', 'ткань', 'камень', 'жидкость', 'пузыри', 'дым', 'свет', 'отражение', 'гаджет', 'наушники', 'камера',
  'объектив', 'телефон', 'компьютер', 'экран', 'часы', 'бутылка', 'флакон духов', 'косметика', 'игральные карты',
  'книга', 'японский текст', 'карта', 'схема', 'чертёж', 'упаковка', 'продукт', 'реклама', 'спорт', 'флаг', 'игрушка',
  'фигурка', 'скульптура', 'кукла', 'маска', 'музыка', 'музыкальный инструмент',
  'синий', 'красный', 'зелёный', 'жёлтый', 'фиолетовый', 'розовый', 'оранжевый', 'чёрный', 'белый', 'пастельные цвета',
];
export const Z_MIN = 1.6, RAW_MIN = 0.055, MAX_TAGS = 4;

const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };

// per-word mean and spread over a sample of the library's vectors
export function wordStats(words, vectors) {
  const sample = vectors.length > 400 ? Array.from({ length: 400 }, (_, i) => vectors[Math.floor((i * vectors.length) / 400)]) : vectors;
  return words.map((w) => {
    const s = sample.map((v) => dot(v, w));
    const mu = s.reduce((a, x) => a + x, 0) / (s.length || 1);
    const sd = Math.sqrt(s.reduce((a, x) => a + (x - mu) ** 2, 0) / (s.length || 1)) || 1;
    return { mu, sd };
  });
}

export function tagsFor(vec, words, stats, no = []) {
  const out = [];
  words.forEach((w, j) => {
    const raw = dot(vec, w), z = (raw - stats[j].mu) / stats[j].sd;
    if (z >= Z_MIN && raw >= RAW_MIN && !no.includes(VOCAB[j])) out.push([z, VOCAB[j]]);
  });
  return out.sort((a, b) => b[0] - a[0]).slice(0, MAX_TAGS).map((x) => x[1]);
}
