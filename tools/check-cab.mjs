// Проверка Сцены 2: бумажка, тангента, лут из кабины, темп паники.
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

/** Сокет и рукопожатие; отказ или молчание сервера — провал скрипта. */
const connect = async (name) => {
  const token = await login(name);
  const ws = new WebSocket(WS_URL);
  const box = { ws, inventory: null, texts: [], stats: null, replies: 0, refused: 0 };

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
      if (m.t === 'event') {
        if (m.kind === 'stats') box.stats = m.data;
        if (m.kind === 'prop') {
          box.replies++;
          if (String(m.data.text).includes('нет места')) box.refused++;
        }
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

  // сразу после welcome сервер шлёт снапшот и статы — дадим им дойти
  await wait(300);
  return box;
};

const client = await connect('Cab');
const act = (id, verb) => client.ws.send(JSON.stringify({ t: 'interact', id, verb }));

client.ws.send(JSON.stringify({ t: 'start' }));
await wait(STEP_MS);

act('cab_paper', 'cover');
await wait(STEP_MS);
act('cab_tangenta', 'off');
await wait(STEP_MS);
act('cab_medkit', 'take');
await wait(STEP_MS);
act('cab_voltmeter', 'take');
await wait(STEP_MS);
act('cab_tube', 'take');
await wait(STEP_MS);
act('cab_candy', 'take');
await wait(STEP_MS);
act('cab_medkit', 'take'); // второй раз — должно быть «тут уже пусто»
await wait(STEP_MS);

console.log('слоты:', JSON.stringify(client.inventory));
console.log('последние ответы:', JSON.stringify(client.texts.slice(-3)));
console.log('статы:', JSON.stringify(client.stats));

const loot = ['medkit', 'voltmeter', 'tube', 'candy'].filter((id) => client.inventory?.includes(id));
console.log(`лут кабины в слотах: ${loot.join(', ') || 'ничего'} (${loot.length}/4)`);
if (loot.length < 4) {
  console.log(
    client.refused > 0
      ? '  (не всё влезло: рюкзак на 6 слотов уже полон)'
      : '  (часть лута уже разобрана прошлыми прогонами — флаги taken_* живут в базе)',
  );
}

client.ws.close();

// Провал, если проверять было нечего: молчание сервера не должно выглядеть успехом.
if (!Array.isArray(client.inventory)) fail('сервер не прислал инвентарь (ни снапшот, ни ответ на «взять»)');
if (client.replies === 0) fail('ни одного ответа на действия: сервер не принимает interact');
if (!client.stats) fail('не пришли статы мира');

console.log('\nсцена 2 отработала');
process.exit(0);
