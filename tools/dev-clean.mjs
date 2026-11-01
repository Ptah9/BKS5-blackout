import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from '../backend/db/store.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const store = new Store(join(ROOT, 'data', 'game.db'));

try {
  store.clearNpcMemory();
} finally {
  store.close();
}

console.log('Память NPC очищена; запускаю сервер и клиент.');

const children = [
  spawn(process.execPath, [join(ROOT, 'backend/server/index.js'), '--dev'], {
    cwd: ROOT,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [
    join(ROOT, 'node_modules/vite/bin/vite.js'),
    '--config',
    'client/vite.config.ts',
  ], {
    cwd: ROOT,
    stdio: 'inherit',
  }),
];

let stopping = false;

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

for (const child of children) {
  child.on('error', (error) => {
    console.error('Не удалось запустить процесс разработки:', error);
    process.exitCode = 1;
    stop('SIGTERM');
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    if (code !== 0) {
      console.error(`Процесс разработки завершился (${signal ?? code}).`);
      process.exitCode = code ?? 1;
      stop('SIGTERM');
    }
  });
}
