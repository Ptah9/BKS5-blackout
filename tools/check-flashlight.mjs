// Проверка: лампу ставит только один, у поставившего предмет исчезает.
import { WebSocket } from 'ws';

const login = async (name) => {
  const r = await fetch('http://127.0.0.1:8090/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name + (Date.now() % 100000), password: 'secret123' }),
  });
  return (await r.json()).token;
};

const connect = async (name) => {
  const token = await login(name);
  const ws = new WebSocket('ws://127.0.0.1:8090/ws');
  const box = { ws, inventory: null, texts: [], lamps: 0 };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'inventory') {
      box.inventory = m.slots;
      if (m.text) box.texts.push(m.text);
    }
    if (m.t === 'event' && m.kind === 'lamp') box.lamps++;
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  return box;
};

const a = await connect('FonA');
const b = await connect('FonB');

a.ws.send(JSON.stringify({ t: 'combine', i: 0, j: 1 }));
await new Promise((r) => setTimeout(r, 600));
b.ws.send(JSON.stringify({ t: 'combine', i: 0, j: 1 }));
await new Promise((r) => setTimeout(r, 2600));

console.log('первый игрок, слоты:', JSON.stringify(a.inventory));
console.log('второй игрок, слоты:', JSON.stringify(b.inventory));
console.log('второму сказали:', JSON.stringify(b.texts));
console.log('событий lamp у первого:', a.lamps, '· у второго:', b.lamps);

a.ws.close();
b.ws.close();
process.exit(0);
