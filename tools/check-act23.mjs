// Прогон актов 2–3: все флаги и реакция толпы.
import { WebSocket } from 'ws';

const login = async (name) => {
  const r = await fetch('http://127.0.0.1:8090/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name + (Date.now() % 100000), password: 'secret123' }),
  });
  return (await r.json()).token;
};

const token = await login('Act23');
const ws = new WebSocket('ws://127.0.0.1:8090/ws');
const box = { stats: null, texts: [], inventory: null, objectives: [] };

ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === 'inventory') box.inventory = m.slots;
  if (m.t === 'event') {
    if (m.kind === 'stats') box.stats = m.data;
    if (m.kind === 'prop' || m.kind === 'say') box.texts.push(m.data.text);
    if (m.kind === 'objective') box.objectives.push(m.data.text);
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (id, verb, item = null) => ws.send(JSON.stringify({ t: 'interact', id, verb, item }));

await wait(600);
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
  await wait(400);
  console.log(`${name}: паника ${box.stats?.panic} доверие ${box.stats?.trust}`);
}

// конфета должна быть в рюкзаке: девочке отдаём её
const candySlot = box.inventory?.indexOf('candy');
act('girl', 'give_candy', 'candy');
await wait(400);
console.log(`девочке конфета (слот ${candySlot}): паника ${box.stats?.panic}`);

act('cab_mic', 'speak');
await wait(400);
act('rail_test', 'check', 'voltmeter');
await wait(400);

console.log('последние тексты:', JSON.stringify(box.texts.slice(-4)));
console.log('задания:', JSON.stringify(box.objectives.slice(-3)));

ws.close();
process.exit(0);
