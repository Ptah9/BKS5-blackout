// РџСЂРѕРІРµСЂРєР° РїРѕСЂСЏРґРєР° РЎС†РµРЅС‹ 2: РґРІРµСЂСЊ РєР°Р±РёРЅС‹ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ, Р±СѓРјР°Р¶РєР° вЂ” С‚РѕР»СЊРєРѕ РІРЅСѓС‚СЂРё.
import { WebSocket } from 'ws';

const login = async (name) => {
  const r = await fetch('http://127.0.0.1:8090/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: name + (Date.now() % 100000), password: 'secret123' }),
  });
  return (await r.json()).token;
};

const token = await login('Door');
const ws = new WebSocket('ws://127.0.0.1:8090/ws');
const box = { inventory: null, texts: [] };

ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === 'inventory') {
    box.inventory = m.slots;
    if (m.text) box.texts.push(m.text);
  }
  if (m.t === 'event' && m.kind === 'prop') box.texts.push(m.data.text);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (id, verb, item = null) => ws.send(JSON.stringify({ t: 'interact', id, verb, item }));

await wait(600);
ws.send(JSON.stringify({ t: 'start' }));
await wait(500);

// 1. Р±СѓРјР°Р¶РєСѓ РІ Р·Р°РєСЂС‹С‚СѓСЋ РґРІРµСЂСЊ РЅРµ Р·Р°Р¶Р°С‚СЊ
act('cab_paper', 'cover');
await wait(400);
console.log('РґРѕ РѕС‚РєСЂС‹С‚РёСЏ РґРІРµСЂРё:', box.texts.at(-1));

// 2. РґРІРµСЂСЊ РєР°Р±РёРЅС‹ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ
act('cab_door', 'open');
await wait(500);
console.log('РґРІРµСЂСЊ:', box.texts.at(-1));

// 3. С‚РµРїРµСЂСЊ Р±СѓРјР°Р¶РєР° Р·Р°Р¶РёРјР°РµС‚СЃСЏ
act('cab_paper', 'cover');
await wait(400);
console.log('РїРѕСЃР»Рµ РѕС‚РєСЂС‹С‚РёСЏ:', box.texts.at(-1));

// 4. РєР°СЂР°РЅРґР°С€ Рё С‚СѓР±СѓСЃ
act('cab_pencil', 'take');
await wait(400);
act('cab_tube', 'take');
await wait(400);
console.log('СЃР»РѕС‚С‹:', JSON.stringify(box.inventory));

ws.close();
process.exit(0);

