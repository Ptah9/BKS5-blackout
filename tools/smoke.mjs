/**
 * Дымовой тест: сервер живой, статика отдаётся, сокет здоровается.
 *
 * Запуск: node tools/smoke.mjs   (сервер должен быть уже поднят)
 * Проверяет ровно то, что должен уметь M0, и ничего больше.
 */

import { WebSocket } from 'ws';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // свой же локальный сертификат

const BASE = process.env.BASE ?? 'https://127.0.0.1:8443';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

// 1. статика
const index = await fetch(BASE + '/');
const html = await index.text();
check('GET / — 200', index.status === 200, String(index.status));
check('в html есть canvas', html.includes('<canvas'));

const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
const asset = assetPath ? await fetch(BASE + assetPath) : null;
check('GET бандла — 200', asset?.status === 200, assetPath ?? 'не найден в html');

// 2. сокет: hello → welcome, ping → pong
const ws = new WebSocket(WS_URL);
const welcome = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 5000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token: null })));
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'welcome') {
      clearTimeout(timer);
      resolve(msg);
    }
  });
  ws.on('error', () => {
    clearTimeout(timer);
    resolve(null);
  });
});

check('ws hello → welcome', Boolean(welcome), welcome ? `игрок #${welcome.you}` : 'нет ответа');

const pong = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 5000);
  ws.once('message', (raw) => {
    clearTimeout(timer);
    resolve(JSON.parse(String(raw)));
  });
  ws.send(JSON.stringify({ t: 'ping', id: 1, clientTime: Date.now() }));
});

check('ws ping → pong', pong?.t === 'pong', pong ? `${Date.now() - pong.clientTime} мс` : 'нет ответа');

// 3. незнакомое сообщение не должно ронять сервер
ws.send(JSON.stringify({ t: 'не_существует' }));
const err = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 2000);
  ws.once('message', (raw) => {
    clearTimeout(timer);
    resolve(JSON.parse(String(raw)));
  });
});
check('мусорное сообщение → error, не падение', err?.t === 'error');

ws.terminate();
console.log(failed === 0 ? '\nвсё зелёное' : `\nпровалено: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
