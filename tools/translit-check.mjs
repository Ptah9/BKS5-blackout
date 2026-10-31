/**
 * Проверка транслита: node tools/translit-check.mjs
 * Список ников — реальные варианты, которые встретятся в игре.
 */

import { toRussianName } from '../shared/translit.js';

const cases = [
  ['Ptah', 'Птах'],
  ['Sasha', 'Саша'],
  ['Maxim', 'Максим'],
  ['Max', 'Макс'],
  ['Katya', 'Катя'],
  ['Anton', 'Антон'],
  ['Veronika', 'Вероника'],
  ['Dmitry', 'Дмитрий'],
  ['Sergey', 'Сергей'],
  ['Alexey', 'Алексей'],
  ['Nikolay', 'Николай'],
  ['Petya', 'Петя'],
  ['Ivan', 'Иван'],
  ['Oleg', 'Олег'],
  ['Anna', 'Анна'],
  ['Igor', 'Игорь'],
  ['Zhenya', 'Женя'],
  ['Shura', 'Шура'],
  ['Сергей', 'Сергей'],
  ['', ''],
];

let failed = 0;

for (const [input, expected] of cases) {
  const actual = toRussianName(input);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(input)} → ${JSON.stringify(actual)}${ok ? '' : ` (ждали ${JSON.stringify(expected)})`}`);
}

console.log(failed === 0 ? '\nвсё сходится' : `\nпровалено: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
