// Проверка порядка Сцены 2: дверь кабины открывается, бумажка — только внутри.
//
// Рукопожатие идёт текущей версией протокола из shared/protocol.js.
// Отказ сервера или молчание — громкий провал с кодом 1: иначе мёртвый
// прогон печатает undefined и выглядит зелёным.
import { readFileSync } from 'node:fs';

import { WebSocket } from 'ws';

import { PROTOCOL_VERSION } from '../shared/protocol.js';

const BASE = 'http://127.0.0.1:8090';
const WS_URL = 'ws://127.0.0.1:8090/ws';
const HELLO_TIMEOUT_MS = 4000;
const STEP_MS = 400;

// ожидаемые тексты берём из данных, а не из головы
const props = JSON.parse(readFileSync(new URL('../content/props.json', import.meta.url), 'utf8')).props;
const verbText = (propId, verbId) =>
  props.find((p) => p.id === propId)?.verbs.find((v) => v.id === verbId)?.text ?? '';

const DOOR_OPEN = verbText('cab_door', 'open');
const PAPER_COVER = verbText('cab_paper', 'cover');

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

const token = await login('Door');
const ws = new WebSocket(WS_URL);
const box = { inventory: null, texts: [] };

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
    if (m.t === 'inventory') {
      box.inventory = m.slots;
      if (m.text) box.texts.push(m.text);
    }
    if (m.t === 'event' && m.kind === 'prop') box.texts.push(m.data.text);
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

// 1. бумажку в закрытую дверь не зажать
act('cab_paper', 'cover');
await wait(STEP_MS);
const before = box.texts.at(-1);
console.log('до открытия двери:', before);

// 2. дверь кабины открывается
act('cab_door', 'open');
await wait(500);
const door = box.texts.at(-1);
console.log('дверь:', door);

// 3. теперь бумажка зажимается
act('cab_paper', 'cover');
await wait(STEP_MS);
const after = box.texts.at(-1);
console.log('после открытия:', after);

// 4. карандаш и тубус
act('cab_pencil', 'take');
await wait(STEP_MS);
act('cab_tube', 'take');
await wait(STEP_MS);
console.log('слоты:', JSON.stringify(box.inventory));

ws.close();

if (box.texts.length === 0) fail('сервер не ответил ни на одно действие: похоже, interact не доходит');
if (before === PAPER_COVER) {
  fail('бумажка зажалась до открытия двери — либо сломан requiresFlag, либо дверь уже открыта (флаг cab_open в базе), нужен сброс');
}
if (door !== DOOR_OPEN) fail(`дверь кабины не открылась: «${door}»`);
if (after !== PAPER_COVER) fail(`бумажка не зажалась после открытия: «${after}»`);
if (!Array.isArray(box.inventory)) fail('сервер не прислал инвентарь');

console.log('\nпорядок сцены 2 в порядке');
process.exit(0);
