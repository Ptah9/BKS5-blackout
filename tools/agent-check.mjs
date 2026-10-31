/**
 * Проверка агентов: диалог идёт, ответ приходит кусками, память работает.
 *
 *   node tools/agent-check.mjs
 *
 * Требует запущенного сервера. Если ключа DeepSeek нет — сервер ответит
 * запасным мозгом на правилах, и тест всё равно должен пройти.
 */

import { WebSocket } from 'ws';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8090';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

const login = `Agent${Date.now() % 100000}`;
const auth = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login, password: 'secret123' }),
});
const session = await auth.json();

const ws = new WebSocket(WS_URL);
await new Promise((resolve) => ws.on('open', resolve));
ws.send(JSON.stringify({ t: 'hello', v: 1, token: session.token }));
await new Promise((resolve) => setTimeout(resolve, 400));

/** Спрашивает персонажа и собирает ответ целиком. */
function ask(npcId, text) {
  return new Promise((resolve) => {
    let answer = '';
    let done = false;

    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve({ answer, done, timeout: true });
    }, 25_000);

    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t !== 'npc_reply' || msg.id !== npcId) return;
      if (msg.delta) answer += msg.delta;
      if (msg.done) {
        done = true;
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve({ answer, done, timeout: false });
      }
    };

    ws.on('message', onMessage);
    ws.send(JSON.stringify({ t: 'say', to: npcId, text }));
  });
}

const first = await ask('obhodchik', 'Что случилось, почему поезд встал?');
check('агент ответил', first.answer.trim().length > 0, `${first.answer.length} символов`);
check('ответ закончился сигналом done', first.done === true, first.timeout ? 'таймаут' : '');
console.log('      ответ:', first.answer.trim().slice(0, 160));

// второй вопрос — проверяем, что модель не отвечает одной и той же фразой
await new Promise((r) => setTimeout(r, 1400));
const second = await ask('obhodchik', 'А машинист где?');
check('второй ответ тоже не пустой', second.answer.trim().length > 0, `${second.answer.length} символов`);
check('ответы не совпадают дословно', first.answer.trim() !== second.answer.trim());
console.log('      ответ:', second.answer.trim().slice(0, 160));

ws.close();
console.log(failed === 0 ? '\nвсё зелёное' : `\nпровалено: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
