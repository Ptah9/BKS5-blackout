/**
 * Транслит латинского ника в русское имя.
 *
 * Зачем: логин игрока латиницей (Ptah), а NPC говорят по-русски. «Привет, Ptah»
 * в диалоге читается как ошибка локализации, поэтому имя переводится на входе
 * и хранится в базе рядом с логином.
 *
 * Правила практической транскрипции, без научной точности: важно, чтобы
 * Sasha стало Сашей, а Maxim — Максимом, а не «Максим» через пять правил.
 */

const DIGRAPHS = [
  ['shch', 'щ'],
  ['sch', 'щ'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ts', 'ц'],
  ['ch', 'ч'],
  ['sh', 'ш'],
  ['yu', 'ю'],
  ['ya', 'я'],
  ['yo', 'ё'],
  ['ye', 'е'],
  ['ju', 'ю'],
  ['ja', 'я'],
  ['je', 'е'],
];

const SINGLE = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х',
  i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс',
  y: 'й', z: 'з',
};

const VOWELS = 'aeiouy';

/**
 * Имена, где правила дают «почти правильно»: Игорь вместо Игор, Юрий вместо Юри.
 * Список короткий и явный — так честнее, чем подкручивать правила под каждый случай.
 */
const EXCEPTIONS = {
  igor: 'Игорь',
  yuri: 'Юрий',
  ilya: 'Илья',
  pavel: 'Павел',
  kirill: 'Кирилл',
  artyom: 'Артём',
  artem: 'Артём',
  pyotr: 'Пётр',
  vasily: 'Василий',
  lev: 'Лев',
  andrey: 'Андрей',
};

function isCyrillic(text) {
  return /[а-яё]/i.test(text);
}

/**
 * Переводит латинский ник в русское имя.
 * Если в строке уже есть кириллица — возвращает как есть.
 */
export function toRussianName(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return '';
  if (isCyrillic(input)) return input;

  const lower = input.toLowerCase();

  const exception = EXCEPTIONS[lower];
  if (exception) return exception;

  let out = '';

  for (let i = 0; i < lower.length; i++) {
    const rest = lower.slice(i);

    const digraph = DIGRAPHS.find(([latin]) => rest.startsWith(latin));
    if (digraph) {
      out += digraph[1];
      i += digraph[0].length - 1;
      continue;
    }

    const ch = lower[i];

    if (ch === 'y') {
      const next = lower[i + 1] ?? '';
      const prev = lower[i - 1] ?? '';
      const atStart = i === 0;

      if (atStart && 'aeiou'.includes(next)) {
        out += next === 'o' ? 'йо' : 'й' + (SINGLE[next] ?? '');
        i++;
        continue;
      }
      if (i === lower.length - 1 && prev && !VOWELS.includes(prev)) {
        out += 'ий'; // Dmitry → Дмитрий
        continue;
      }
      out += VOWELS.includes(prev) ? 'й' : 'ы';
      continue;
    }

    if (ch === '-') {
      out += ' ';
      continue;
    }

    out += SINGLE[ch] ?? ch;
  }

  return cleanup(out);
}

function cleanup(text) {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16)
    .replace(/^[а-яё]/, (c) => c.toUpperCase());
}

export default toRussianName;
