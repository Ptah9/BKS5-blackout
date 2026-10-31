/**
 * Сброс прогресса перед демо: удаляет файл базы вместе с журналом WAL.
 *
 *   npm run db:reset
 *
 * Скрипт ничего не спрашивает — его запускают руками и осознанно.
 * Сервер при этом должен быть остановлен, иначе Windows не отдаст файл.
 */

import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const files = ['game.db', 'game.db-wal', 'game.db-shm'];
let removed = 0;

for (const name of files) {
  const path = join(DATA, name);
  if (!existsSync(path)) continue;
  rmSync(path);
  removed++;
  console.log('удалён', name);
}

console.log(removed === 0 ? 'базы не было — сбрасывать нечего' : `\nготово, удалено файлов: ${removed}`);
console.log('запусти сервер — он создаст пустую базу');
