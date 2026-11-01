// Прогон актов 2–3: все флаги и реакция толпы.
//
// Рукопожатие идёт текущей версией протокола из shared/protocol.js.
// Отказ сервера или молчание — громкий провал с кодом 1: иначе мёртвый
// прогон печатает null и выглядит зелёным.
import { WebSocket } from 'ws';

import { PROTOCOL_VERSION } from '../shared/protocol.js';

const BASE = 'http://127.0.0.1:8090';
const WS_URL = 'ws://127.0.0.1:8090/ws';
const HELLO_TIMEOUT_MS = 4000;
const STEP_MS = 400;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (text) => {
  console.error(`\n[ПРОВАЛ] ${text}`);
  process.exit(1);
};

/** Расшифровка кодов закрытия из shared/protocol.js. */
const closeHint = (code) => {
  switch (code) {
    case 4400:
      return `сервер отверг версию протокола (4400 BAD_VERSION), а скрипт шлёт v=${PROTOCOL_VERSION} из shared/protocol.js — сервер запущен со старым кодом, его надо перезапустить`;
    case 4401:
      return 'сервер не дождался hello (4401 UNAUTHORIZED)';
    case 4402:
      return 'сервер получил мусор вместо сообщения (4402 BAD_MESSAGE)';
    case 4403:
      return 'сервер не принял токен (4403 FORBIDDEN): сессия не создана или истекла';
    case 4408:
      return 'сервер закрыл соединение за флуд (4408 RATE_LIMITED)';
    default:
      return `сокет закрылся кодом ${code} до welcome`;
  }
};

const login = async (name) => {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name + (Date.now() % 100000), password: 'secret123' }),
  });
  if (!r.ok) fail(`логин не удался: HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  if (!data.token) fail('логин вернул ответ без token');
  return data.token;
};

const token = await login('Act23');
const ws = new WebSocket(WS_URL);
const box = { stats: null, texts: [], inventory: null, objectives: [] };

await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`welcome не пришёл за ${HELLO_TIMEOUT_MS} мс — сервер молчит`)),
    HELLO_TIMEOUT_MS,
  );

  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token })));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'welcome') {
      clearTimeout(timer);
      resolve();
      return;
    }
    if (m.t === 'snapshot') box.inventory = m.inventory;
    if (m.t === 'inventory') box.inventory = m.slots;
    if (m.t === 'event') {
      if (m.kind === 'stats') box.stats = m.data;
      if (m.kind === 'prop' || m.kind === 'say') box.texts.push(m.data.text);
      if (m.kind === 'objective') box.objectives.push(m.data.text);
    }
  });
  ws.on('close', (code) => {
    clearTimeout(timer);
    reject(new Error(closeHint(code)));
  });
  ws.on('error', (err) => {
    clearTimeout(timer);
    reject(new Error(`сокет не открылся: ${err.message}`));
  });
}).catch((error) => fail(error.message));

const act = (id, verb, item = null) => ws.send(JSON.stringify({ t: 'interact', id, verb, item }));

await wait(STEP_MS);
ws.send(JSON.stringify({ t: 'start' }));
await wait(500);

const steps = [
  ['дверь кабины', () => act('cab_door', 'open')],
  ['приём по одному', () => act('people_passage', 'ordered')],
  ['помочь деду', () => act('ded_bike', 'help')],
  ['снять футболку', () => act('dima_shirt', 'take')],
  ['бабка: наклон', () => act('baba', 'lean')],
  ['бабка: в такт', () => act('baba', 'press')],
];

for (const [name, run] of steps) {
  run();
  await wait(STEP_MS);
  console.log(`${name}: паника ${box.stats?.panic} доверие ${box.stats?.trust}`);
}

// конфета должна быть в рюкзаке: девочке отдаём её
const candySlot = box.inventory?.indexOf('candy');
act('girl', 'give_candy', 'candy');
await wait(STEP_MS);
console.log(`девочке конфета (слот ${candySlot}): паника ${box.stats?.panic}`);

act('cab_mic', 'speak');
await wait(STEP_MS);
act('rail_test', 'check', 'voltmeter');
await wait(STEP_MS);

console.log('последние тексты:', JSON.stringify(box.texts.slice(-4)));
console.log('задания:', JSON.stringify(box.objectives.slice(-3)));

ws.close();

if (!box.stats) fail('не пришли статы мира');
if (box.texts.length === 0) fail('сервер не ответил ни на одно действие: похоже, interact не доходит');
if (box.objectives.length === 0) {
  fail('ни одного задания: триггеры сценария не сработали (акты 2–3 не дошли до objective)');
}

console.log('\nакты 2–3 отработали');
process.exit(0);
