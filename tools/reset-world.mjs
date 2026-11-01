/**
 * Сброс состояния мира перед новым прогоном сценария.
 *
 * Чистит world_flags (флаги сценария и статы толпы), память персонажей и
 * сохранённые инвентари игроков. Логины и пароли не трогает.
 *
 *   node tools/reset-world.mjs          показать, что сейчас в базе
 *   node tools/reset-world.mjs --reset  сбросить мир
 *   node tools/reset-world.mjs --full   стереть всё, включая аккаунты
 *
 * После сброса сервер надо перезапустить: игроки в его памяти остаются.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const file = path.join(import.meta.dirname, '..', 'data', 'game.db');
const db = new DatabaseSync(file);

const flags = db.prepare('SELECT key, value FROM world_flags ORDER BY key').all();
const memory = db.prepare('SELECT COUNT(*) AS n FROM npc_memory').get().n;
const players = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;

console.log(`база: ${file}`);
console.log(`флагов мира: ${flags.length}`);
for (const row of flags) console.log(`  ${row.key} = ${row.value}`);
console.log(`записей в памяти персонажей: ${memory}`);
console.log(`аккаунтов: ${players}, сессий: ${sessions}`);

if (process.argv.includes('--full')) {
  db.exec('DELETE FROM players');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM state');
  db.exec('DELETE FROM world_flags');
  db.exec('DELETE FROM npc_memory');
  console.log('\nстёрто всё: аккаунты, сессии, позиции, флаги, память персонажей');
  db.close();
  process.exit(0);
}

if (!process.argv.includes('--reset')) {
  console.log('\nэто только осмотр. сбросить мир: --reset, стереть всё: --full');
  process.exit(0);
}

db.exec('DELETE FROM world_flags');
db.exec('DELETE FROM npc_memory');
db.exec('UPDATE state SET inventory = ?', '[]');

console.log('\nсброшено: флаги, память персонажей, инвентари');
db.close();
