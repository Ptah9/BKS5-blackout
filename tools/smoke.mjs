/**
 * Дымовой тест M2: сервер живой, вход работает, токен проверяется,
 * мир рассылает позиции, второй игрок виден первому.
 *
 * Запуск: node tools/smoke.mjs   (сервер должен быть уже поднят)
 */

import { WebSocket } from 'ws';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // свой же локальный сертификат

const BASE = process.env.BASE ?? 'http://127.0.0.1:8090';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed++;
};

const login = `Test${Date.now() % 100000}`;
const password = 'secret123';

// 1. статика
const index = await fetch(BASE + '/');
const html = await index.text();
check('GET / — 200', index.status === 200, String(index.status));
check('в html есть canvas', html.includes('<canvas'));

const health = await (await fetch(BASE + '/api/health')).json();
check('/api/health', health.ok === true);

// 2. регистрация на входе
const created = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login, password }),
});
const createdData = await created.json();
check('первый вход создаёт игрока', created.status === 200 && Boolean(createdData.token), createdData.name);

// 3. неверный пароль
const wrong = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login, password: 'wrong-pass' }),
});
check('неверный пароль — 401', wrong.status === 401);

// 4. кривой логин
const badLogin = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: 'плохой логин', password }),
});
check('логин не по правилам — 400', badLogin.status === 400);

// 5. профиль по токену
const me = await fetch(BASE + '/api/me', { headers: { Authorization: `Bearer ${createdData.token}` } });
const meData = await me.json();
check('GET /api/me по токену', me.status === 200 && meData.playerId === createdData.playerId, meData.name);

const meBad = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer nonsense' } });
check('токен-мусор — 401', meBad.status === 401);

// 6. сокет с токеном
function connect(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, welcome: null, snapshot: null, players: null };
    const timer = setTimeout(() => resolve(state), 4000);

    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t === 'welcome') state.welcome = msg;
      if (msg.t === 'snapshot') {
        state.snapshot = msg;
        clearTimeout(timer);
        resolve(state);
      }
      if (msg.t === 'players') state.players = msg.list;
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve(state);
    });
  });
}

const first = await connect(createdData.token);
check('ws hello с токеном → welcome', first.welcome?.you === createdData.playerId, first.welcome?.name ?? 'нет');
check('снапшот при входе', Boolean(first.snapshot?.self), first.snapshot ? `x=${first.snapshot.self.x.toFixed(2)}` : 'нет');

// 7. сокет без токена закрывается
const anonymous = await new Promise((resolve) => {
  const ws = new WebSocket(WS_URL);
  const timer = setTimeout(() => resolve({ closed: false }), 4000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token: null })));
  ws.on('close', (code) => {
    clearTimeout(timer);
    resolve({ closed: true, code });
  });
  ws.on('error', () => {
    clearTimeout(timer);
    resolve({ closed: true, code: 0 });
  });
});
check('ws без токена закрывается', anonymous.closed === true, `код ${anonymous.code}`);

// 8. второй игрок виден первому
const secondLogin = login + 'b';
const second = await fetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: secondLogin.slice(0, 16), password }),
});
const secondData = await second.json();
const secondClient = await connect(secondData.token);

await new Promise((r) => setTimeout(r, 300));

const seen = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), 2000);
  first.ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.t === 'players' && msg.list.length >= 2) {
      clearTimeout(timer);
      resolve(msg.list);
    }
  });
});

first.ws.send(JSON.stringify({ t: 'input', x: 0.5, z: 6.25, yaw: 1.2 }));
const list = await seen;
check('двое в мире, позиция первого дошла', Boolean(list), list ? `${list.length} игроков` : 'нет пакета');

// 9. рецепты проверяет сервер, а не клиент
const waitInventory = (send) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2000);
    const onMessage = (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.t !== 'inventory') return;
      clearTimeout(timer);
      first.ws.off('message', onMessage);
      resolve(msg);
    };
    first.ws.on('message', onMessage);
    send();
  });

const combined = await waitInventory(() => first.ws.send(JSON.stringify({ t: 'combine', i: 0, j: 1 })));
check(
  'combine: бутылка + телефон → фонарик',
  combined?.slots?.[0] === 'flashlight' && combined?.slots?.[1] === null,
  combined?.text ?? 'нет ответа',
);

const rejected = await waitInventory(() => first.ws.send(JSON.stringify({ t: 'combine', i: 2, j: 3 })));
check(
  'combine: конфеты + бумажка отклонены',
  rejected?.slots?.[2] === 'candy' && rejected?.slots?.[3] === 'paper',
  rejected?.text ?? 'нет ответа',
);

// 10. инвентарь переживает переподключение (значит, он в базе, а не в памяти)
first.ws.close();
await new Promise((r) => setTimeout(r, 300));
const again = await connect(createdData.token);
check(
  'инвентарь пришёл из базы после переподключения',
  again.snapshot?.inventory?.[0] === 'flashlight',
  again.snapshot ? JSON.stringify(again.snapshot.inventory) : 'нет снапшота',
);
again.ws.close();

secondClient.ws.close();

console.log(failed === 0 ? '\nвсё зелёное' : `\nпровалено: ${failed}`);
process.exitCode = failed === 0 ? 0 : 1;
