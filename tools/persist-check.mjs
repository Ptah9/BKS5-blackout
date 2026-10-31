/**
 * Проверка того, ради чего вообще база: состояние переживает перезапуск сервера.
 *
 *   node tools/persist-check.mjs set     — входит, отходит в точку, отключается,
 *                                          сохраняет токен в файл
 *   <перезапустить сервер>
 *   node tools/persist-check.mjs check   — входит тем же токеном и сверяет позицию
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const FILE = join(tmpdir(), 'bks5-persist.json');

const phase = process.argv[2] ?? 'set';
const TARGET = { x: 0.55, z: 4.75, yaw: 2.1 };

function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => resolve({ ws, snapshot: null }), 4000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'snapshot') {
        clearTimeout(timer);
        resolve({ ws, snapshot: msg });
      }
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve({ ws, snapshot: null });
    });
  });
}

if (phase === 'set') {
  const login = `Persist${Date.now() % 100000}`;
  const response = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: 'secret123' }),
  });
  const data = await response.json();

  const { ws } = await connect(data.token);

  // идём к цели мелкими шагами: сервер отбрасывает пакеты с прыжком больше
  // двух метров — это защита от телепорта, и тест обязан её уважать
  const from = { x: 0, z: 8.4 };
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    ws.send(JSON.stringify({
      t: 'input',
      x: from.x + (TARGET.x - from.x) * k,
      z: from.z + (TARGET.z - from.z) * k,
      yaw: TARGET.yaw,
    }));
    await new Promise((r) => setTimeout(r, 60));
  }

  // ждём цикл записи в базу и отключаемся
  await new Promise((r) => setTimeout(r, 1300));
  ws.close();

  writeFileSync(FILE, JSON.stringify({ token: data.token, login, name: data.name, target: TARGET }));
  console.log(`игрок ${data.name} отведён в x=${TARGET.x} z=${TARGET.z} и отключён`);
  console.log('теперь перезапусти сервер и запусти: node tools/persist-check.mjs check');
  process.exit(0);
}

const saved = JSON.parse(readFileSync(FILE, 'utf8'));
const { ws, snapshot } = await connect(saved.token);

if (!snapshot) {
  console.log('FAIL  не удалось подключиться после перезапуска');
  process.exitCode = 1;
  process.exit(1);
}

const self = snapshot.self;
const dx = Math.abs(self.x - saved.target.x);
const dz = Math.abs(self.z - saved.target.z);
const ok = dx < 0.05 && dz < 0.05;

console.log(`${ok ? 'ok  ' : 'FAIL'}  позиция после перезапуска: x=${self.x.toFixed(2)} z=${self.z.toFixed(2)}`);
console.log(`      ждали x=${saved.target.x} z=${saved.target.z}, расхождение ${dx.toFixed(3)} / ${dz.toFixed(3)}`);
console.log(`      имя из базы: ${self.name}`);

ws.close();
process.exitCode = ok ? 0 : 1;
