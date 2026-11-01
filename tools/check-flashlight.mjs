// Проверка: лампу ставит только один, у поставившего предмет исчезает.
//
// Рукопожатие идёт текущей версией протокола из shared/protocol.js.
// Отказ сервера или молчание — громкий провал с кодом 1: иначе мёртвый
// прогон печатает null и выглядит зелёным.
import { WebSocket } from 'ws';

import { PROTOCOL_VERSION } from '../shared/protocol.js';

const BASE = 'http://127.0.0.1:8090';
const WS_URL = 'ws://127.0.0.1:8090/ws';
const HELLO_TIMEOUT_MS = 4000;

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

/** Сокет и рукопожатие; отказ или молчание сервера — провал скрипта. */
const connect = async (name) => {
  const token = await login(name);
  const ws = new WebSocket(WS_URL);
  const box = { ws, inventory: null, texts: [], lamps: 0 };

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
      if (m.t === 'event' && m.kind === 'lamp') box.lamps++;
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

  await wait(300);
  return box;
};

const a = await connect('FonA');
const b = await connect('FonB');

a.ws.send(JSON.stringify({ t: 'combine', i: 0, j: 1 }));
await wait(600);
b.ws.send(JSON.stringify({ t: 'combine', i: 0, j: 1 }));
await wait(2600);

console.log('первый игрок, слоты:', JSON.stringify(a.inventory));
console.log('второй игрок, слоты:', JSON.stringify(b.inventory));
console.log('второму сказали:', JSON.stringify(b.texts));
console.log('событий lamp у первого:', a.lamps, '· у второго:', b.lamps);

a.ws.close();
b.ws.close();

if (!Array.isArray(a.inventory) || !Array.isArray(b.inventory)) fail('сервер не прислал инвентарь игрокам');
if (a.lamps === 0) {
  const said = a.texts.join(' ');
  fail(
    said.includes('Свет уже горит')
      ? `лампа в мире уже стоит (has_light в базе), первый игрок получил «${said}» — для чистой проверки нужен сброс базы`
      : 'первый игрок не получил событие lamp: лампа не встала',
  );
}
if (!b.texts.some((text) => text.includes('Свет уже горит'))) {
  fail(`второму игроку не отказали: ${JSON.stringify(b.texts)}`);
}

console.log('\nлампа одна, второй игрок получил отказ');
process.exit(0);
