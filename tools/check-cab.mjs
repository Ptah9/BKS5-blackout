// Проверка Сцены 2: бумажка, тангента, лут из кабины, темп паники.
import { WebSocket } from 'ws';

const BASE = 'http://127.0.0.1:8090';
const login = async (name) => {
  const r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name + (Date.now() % 100000), password: 'secret123' }),
  });
  return (await r.json()).token;
};

const connect = async () => {
  const token = await login('Cab');
  const ws = new WebSocket('ws://127.0.0.1:8090/ws');
  const box = { ws, inventory: null, texts: [], stats: null };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'inventory') {
      box.inventory = m.slots;
      if (m.text) box.texts.push(m.text);
    }
    if (m.t === 'event' && m.kind === 'stats') box.stats = m.data;
  });
  await new Promise((r) => setTimeout(r, 500));
  return box;
};

const client = await connect();
const act = (id, verb) => client.ws.send(JSON.stringify({ t: 'interact', id, verb }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

client.ws.send(JSON.stringify({ t: 'start' }));
await wait(400);

act('cab_paper', 'cover');
await wait(400);
act('cab_tangenta', 'off');
await wait(400);
act('cab_medkit', 'take');
await wait(400);
act('cab_voltmeter', 'take');
await wait(400);
act('cab_tube', 'take');
await wait(400);
act('cab_candy', 'take');
await wait(400);
act('cab_medkit', 'take'); // второй раз — должно быть «тут уже пусто»

console.log('слоты:', JSON.stringify(client.inventory));
console.log('последние ответы:', JSON.stringify(client.texts.slice(-3)));
console.log('статы:', JSON.stringify(client.stats));

client.ws.close();
process.exit(0);
