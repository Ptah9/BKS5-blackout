/**
 * Сервер игры: статика клиента, HTTP-API входа и WebSocket-мир.
 *
 * M2: логин с паролем, токен сессии, состояние в SQLite, снапшот при входе
 * и дельты позиций 20 раз в секунду.
 *
 * Запуск:
 *   node backend/server/index.js          — https://<ip>:8443 (если есть сертификат)
 *   node backend/server/index.js --dev    — http://127.0.0.1:8080 (для Vite dev-сервера)
 */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { Store } from '../db/store.js';
import { hashPassword, hashToken, newToken, verifyPassword } from './auth.js';
import { AgentRuntime, probeLocal } from './agent.js';
import { Scenario } from './scenario.js';
import { START_INVENTORY, findRecipe, sanitizeInventory } from '../../shared/items.js';
import { toRussianName } from '../../shared/translit.js';
import { AUTH, CLOSE, HELLO_TIMEOUT_MS, MSG, PROTOCOL_VERSION, TICK, WORLD } from '../../shared/protocol.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const CERTS = join(ROOT, 'certs');
const DB_FILE = join(ROOT, 'data', 'game.db');

const DEV = process.argv.includes('--dev');
// 8080 на этой машине занят отладочным сервером браузера, поэтому dev — на 8090
const DEV_PORT = 8090;
const PORT = DEV ? DEV_PORT : 8443;

const log = (...args) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}]`, ...args);

/**
 * Читаем .env без зависимостей. Файл в .gitignore: ключи в историю не попадают.
 * Уже выставленные переменные окружения не перетираем.
 */
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(join(ROOT, '.env'));

/* ───────────────────────────── база ───────────────────────────── */

const store = new Store(DB_FILE);
log('база:', DB_FILE);

// Персонажи и их характеры — в данных, а не в коде сервера.
const npcs = JSON.parse(readFileSync(join(ROOT, 'content', 'npcs.json'), 'utf8')).npcs;
  // Предметы мира: двери, кнопки, люки — с вербами и условиями.
const props = JSON.parse(readFileSync(join(ROOT, 'content', 'props.json'), 'utf8')).props;
// Места в вагоне, на которые садятся игроки при старте: у каждого своё.
const seats = JSON.parse(readFileSync(join(ROOT, 'content', 'seats.json'), 'utf8')).seats;

/**
 * Два числа, которые двигают сюжет: паника и доверие (0–100).
 * Живут в базе, чтобы перезапуск сервера не обнулял состояние толпы.
 */
const stats = {
  panic: Number(store.getFlag('panic') ?? 20),
  trust: Number(store.getFlag('trust') ?? 50),
  air: Number(store.getFlag('air') ?? 100),
};

/** Состояние лобби: кто в сети и началась ли игра. */
function broadcastLobby() {
  const payload = JSON.stringify({
    t: MSG.LOBBY,
    players: [...clients.values()].map((client) => client.name),
    started: scenario.running,
  });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}

/** Старт игры: сценарий запускается один раз, для всех сразу. */
function startGame(byName) {
  if (scenario.running) return;
  scenario.start();
  seatPlayers();
  log(`игра начата (${byName})`);
  broadcast({ kind: 'game_start', data: {} });
  broadcastLobby();
}

/**
 * Рассаживаем всех по местам до начала сцены: иначе игроки появляются
 * в одной точке прохода и стоят друг в друге. Место закрепляется за игроком
 * по порядку входа и уходит ему отдельным событием — сервер и клиент должны
 * одинаково понимать, где он сидит.
 */
function seatPlayers() {
  [...clients.values()].forEach((client, index) => {
    const seat = seats[index % seats.length];
    client.x = seat.x;
    client.z = seat.z;
    client.yaw = seat.yaw;
    store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);

    if (client.ws.readyState !== client.ws.OPEN) return;
    client.ws.send(JSON.stringify({
      t: MSG.EVENT,
      kind: 'spawn',
      data: { x: seat.x, z: seat.z, yaw: seat.yaw, seat: index },
    }));
  });
}

/**
 * Блокнот мыслей. Мысль висит на экране не по таймеру, а пока она верна:
 * у каждой есть условие снятия — флаг мира. Взаимодействие с форточкой
 * ставит window_open, и мысль про духоту снимается сама.
 */
const notes = new Map();
const noteUntil = new Map();

/** Насколько вагон светлеет от лампы и через сколько секунд она появляется. */
const LAMP_LIGHT = 0.9;
const LAMP_DELAY_MS = 2200;

/**
 * Лампа из бутылки и телефона. Ставится в мире одна: точка нужна всем
 * клиентам, поэтому она уходит событием, а координаты живут в базе —
 * чтобы поздний игрок увидел свет там, где его оставили.
 */
function placeLamp(x, z) {
  store.setFlag('lamp_x', x);
  store.setFlag('lamp_z', z);
  scenario.state.lights = LAMP_LIGHT;
  broadcast({ kind: 'lamp', data: { x, z } });
  broadcast({ kind: 'lights', data: { value: LAMP_LIGHT } });
  log(`лампа поставлена: ${x.toFixed(2)}, ${z.toFixed(2)}`);
}

function broadcastNotes() {
  broadcast({ kind: 'notes', data: { list: [...notes].map(([id, text]) => ({ id, text })) } });
}

function addNote({ id, text, until }) {
  const key = String(id ?? text);
  if (!text) return;
  // свет уже собрали — мысль про темноту устарела раньше, чем её показали
  if (until && store.getFlag(String(until)) === '1') return;

  const same = notes.get(key) === text && (!until || noteUntil.get(key) === until);
  if (same) return;

  notes.set(key, String(text));
  if (until) noteUntil.set(key, String(until));
  broadcastNotes();
}

function dropNote(id) {
  if (!notes.delete(String(id))) return;
  noteUntil.delete(String(id));
  broadcastNotes();
}

/** Флаг сработал — мысли, которые на него опирались, больше не актуальны. */
function dropNotesByFlag(flag) {
  let changed = false;
  for (const [id, until] of noteUntil) {
    if (until !== flag) continue;
    notes.delete(id);
    noteUntil.delete(id);
    changed = true;
  }
  if (changed) broadcastNotes();
}

function clearNotes() {
  notes.clear();
  noteUntil.clear();
  broadcastNotes();
}

/** Рассылка события всем подключённым; действия со статистикой не пересылаются. */
function broadcast(event) {
  if (event.kind === 'stat') {
    changeStat(event.data.key, event.data.delta);
    return;
  }

  if (event.kind === 'radio') {
    startRadio(event.data);
    return;
  }

  // мысль героя — это строка в блокноте, а не всплывающая подсказка
  if (event.kind === 'thought') {
    addNote(event.data);
    return;
  }

  if (event.kind === 'unthought') {
    dropNote(event.data.id);
    return;
  }

  const payload = JSON.stringify({ t: MSG.EVENT, kind: event.kind, data: event.data });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}

/**
 * Объявление по вагону. Играет несколько раз: на втором герой понимает,
 * что это запись, с четвёртого толпа начинает паниковать.
 */
const radioTimers = [];

function startRadio({ text, repeats = 4, interval = 4 }) {
  for (let i = 1; i <= repeats; i++) {
    radioTimers.push(setTimeout(() => {
      // сама реплика — мгновенная: она звучит и затихает
      broadcast({ kind: 'say', data: { text: `По вагону: «${text}»` } });

      if (i === 2) {
        setTimeout(() => broadcast({
          kind: 'thought',
          data: {
            id: 'radio_record',
            text: 'Похоже, это запись. Машинист сам на связь не выйдет.',
            until: 'announcer_off',
          },
        }), 600);
      }

      if (i === 4) {
        changeStat('panic', 12);
        // толпа поняла, что машинист сам не выйдет: с этого момента паника
        // растёт сама, пока её не собьют бумажкой, тангентой и словами
        store.setFlag('panic_running', '1');
      }
    }, i * interval * 1000));
  }
}

function stopRadio() {
  while (radioTimers.length > 0) clearTimeout(radioTimers.pop());
}

function changeStat(key, delta) {
  if (key !== 'panic' && key !== 'trust' && key !== 'air') return;

  const next = Math.max(0, Math.min(100, Math.round(stats[key] + Number(delta ?? 0))));
  if (next === stats[key]) return;

  stats[key] = next;
  store.setFlag(key, next);
  log(`мир: ${key} → ${next}`);
  broadcast({ kind: 'stats', data: { panic: stats.panic, trust: stats.trust, air: stats.air } });
}
const agents = new AgentRuntime({
  store,
  key: process.env.DEEPSEEK_API_KEY ?? null,
  localUrl: process.env.LOCAL_LLM_URL ?? null,
  localModel: process.env.LOCAL_LLM_MODEL ?? 'qwen2.5:7b-instruct',
  localFormat: process.env.LOCAL_LLM_FORMAT ?? 'ollama',
  localKey: process.env.LOCAL_LLM_KEY ?? null,
  log,
});

// Приоритет мозгов: локальная модель → DeepSeek → правила.
// Проверяем доступность локальной на старте и говорим вслух, что включилось.
if (agents.mode === 'local') {
  probeLocal(agents.localUrl, agents.localModel, agents.localFormat, agents.localKey).then((ok) => {
    log(ok
      ? `агенты: локальная модель ${agents.localModel} (${agents.localUrl})`
      : `агенты: локальная модель недоступна, откат на ${agents.key ? 'DeepSeek' : 'правила'}`);
  });
} else {
  log('агенты:', agents.key ? 'DeepSeek по API' : 'правила (ключа нет)');
}

// Сценарий читается один раз на старте. Флаги мира живут в базе,
// поэтому перезапуск сервера не откатывает «найден фонарь» и подобное.
const scenario = Scenario.load(join(ROOT, 'content', 'scenario', 'metro_tunnel.json'), {
  store,
  log,
  broadcast,
});

/* ───────────────────────────── HTTP ───────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req, limit = 4096) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too_large');
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

const loginRateLimit = new Map();

/** До 12 попыток входа в минуту с одного IP: scrypt иначе можно зафлудить. */
function isLoginRateLimited(ip) {
  const now = Date.now();
  const entry = loginRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    loginRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (loginRateLimit.size > 10_000) loginRateLimit.clear(); // не копим мёртвые IP
  return entry.count > 12;
}

async function handleLogin(req, res) {
  const ip = req.socket?.remoteAddress ?? 'unknown';
  if (isLoginRateLimited(ip)) {
    return json(res, 429, {
      error: { code: 'too_many_requests', message: 'Слишком много попыток входа, подождите минуту' },
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: { code: 'bad_json', message: 'ожидался JSON' } });
  }

  const login = String(body.login ?? '').trim();
  const password = String(body.password ?? '');

  if (!AUTH.LOGIN_RE.test(login)) {
    return json(res, 400, {
      error: { code: 'bad_login', message: 'логин: латиница, цифры и _, от 3 до 16 символов' },
    });
  }
  if (password.length < AUTH.PASSWORD_MIN || password.length > AUTH.PASSWORD_MAX) {
    return json(res, 400, {
      error: { code: 'bad_password', message: `пароль от ${AUTH.PASSWORD_MIN} до ${AUTH.PASSWORD_MAX} символов` },
    });
  }

  let player = store.playerByLogin(login);

  if (player) {
    const ok = await verifyPassword(password, player.pass_salt, player.pass_hash);
    if (!ok) {
      log('вход: неверный пароль для', login);
      return json(res, 401, { error: { code: 'bad_credentials', message: 'неверный пароль' } });
    }
  } else {
    const { hash, salt } = await hashPassword(password);
    try {
      player = store.createPlayer(login, toRussianName(login), hash, salt);
      log('вход: создан игрок', login, '→', player.name);
    } catch (insertError) {
      // параллельный запрос мог создать такого же игрока на секунду раньше
      player = store.playerByLogin(login);
      if (!player) {
        log('вход: ошибка создания игрока —', insertError?.message ?? insertError);
        return json(res, 500, { error: { code: 'server_error', message: 'ошибка регистрации' } });
      }
      const ok = await verifyPassword(password, player.pass_salt, player.pass_hash);
      if (!ok) {
        return json(res, 409, { error: { code: 'login_taken', message: 'логин уже занят другим паролем' } });
      }
    }
  }

  const token = newToken();
  store.createSession(hashToken(token), player.id, Date.now() + AUTH.SESSION_HOURS * 3600_000);

  return json(res, 200, { token, playerId: player.id, name: player.name });
}

function handleMe(req, res) {
  const token = bearer(req);
  if (!token) return json(res, 401, { error: { code: 'bad_token', message: 'нет токена' } });

  const session = store.session(hashToken(token));
  if (!session || session.expires_at < Date.now()) {
    return json(res, 401, { error: { code: 'bad_token', message: 'сессия истекла' } });
  }

  const player = store.playerById(session.player_id);
  if (!player) return json(res, 401, { error: { code: 'bad_token', message: 'игрок не найден' } });

  return json(res, 200, { playerId: player.id, name: player.name, login: player.login });
}

function serveStatic(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return notFound(res);
  }

  if (pathname === '/') pathname = '/index.html';

  const target = normalize(join(DIST, pathname.replace(/^\/+/, '')));
  if (!target.startsWith(DIST + sep)) return notFound(res); // выход за пределы dist

  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!pathname.startsWith('/api/') && existsSync(join(DIST, 'index.html'))) {
      return sendFile(res, join(DIST, 'index.html'));
    }
    return notFound(res);
  }
  return sendFile(res, target);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function sendFile(res, file) {
  const stream = createReadStream(file);
  stream.on('error', (err) => {
    log('ошибка отдачи статики:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('internal server error');
    }
  });
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  stream.pipe(res);
}

async function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // содержимое (сценарий, катсцены, персонажи) отдаём из папки content,
  // чтобы тексты правились без пересборки клиента
  if (url.pathname.startsWith('/api/content/')) {
    const CONTENT = join(ROOT, 'content');
    const relative = decodeURIComponent(url.pathname.slice('/api/content/'.length));
    const file = normalize(join(CONTENT, relative));

    if (!file.startsWith(CONTENT + sep)) {
      return json(res, 404, { error: { code: 'not_found', message: 'выход за пределы content' } });
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      return json(res, 404, { error: { code: 'not_found', message: relative } });
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/login') return handleLogin(req, res);
  if (req.method === 'GET' && url.pathname === '/api/me') return handleMe(req, res);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, players: clients.size, uptime: Math.round(process.uptime()) });
  }
  if (url.pathname.startsWith('/api/')) {
    return json(res, 404, { error: { code: 'not_found', message: url.pathname } });
  }

  return serveStatic(req, res);
}

/* ───────────────────────────── мир ───────────────────────────── */

/** Подключённые клиенты: id игрока → запись. */
const clients = new Map();

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function inWorld(x, z) {
  return {
    x: clamp(x, WORLD.minX + 0.25, WORLD.maxX - 0.25),
    z: clamp(z, WORLD.minZ + 0.3, WORLD.maxZ - 0.3),
  };
}

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    let client = null;
    let messageCount = 0;
    let windowStart = Date.now();

    const helloTimer = setTimeout(() => {
      if (!client) {
        ws.close(CLOSE.UNAUTHORIZED, 'hello timeout');
      }
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
      // простая защита от флуда: больше 80 сообщений в секунду — закрываем
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        messageCount = 0;
      }
      if (++messageCount > 80) {
        log('ws: флуд от игрока', client?.playerId ?? '—');
        ws.close(CLOSE.RATE_LIMITED, 'rate limited');
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(CLOSE.BAD_MESSAGE, 'json expected');
        return;
      }

      switch (msg?.t) {
        case MSG.HELLO: {
          if (msg.v !== PROTOCOL_VERSION) {
            ws.close(CLOSE.BAD_VERSION, 'protocol version mismatch');
            return;
          }

          const session = typeof msg.token === 'string' ? store.session(hashToken(msg.token)) : null;
          if (!session || session.expires_at < Date.now()) {
            log('ws: отказ, токен не принят', ip);
            ws.close(CLOSE.FORBIDDEN, 'bad token');
            return;
          }

          const player = store.playerById(session.player_id);
          if (!player) {
            ws.close(CLOSE.FORBIDDEN, 'no player');
            return;
          }

          clearTimeout(helloTimer);

          const saved = store.loadState(player.id);
          let inventory = [...START_INVENTORY];
          if (saved?.inventory) {
            try {
              const parsed = JSON.parse(saved.inventory);
              if (Array.isArray(parsed) && parsed.some(Boolean)) inventory = sanitizeInventory(parsed);
            } catch {
              // битый json в базе — начинаем со стартового набора, но не падаем
            }
          }

          client = {
            ws,
            playerId: player.id,
            name: player.name,
            x: saved?.x ?? WORLD.spawnX,
            z: saved?.z ?? WORLD.spawnZ,
            yaw: saved?.yaw ?? 0,
            inventory,
          };

          // одно соединение на игрока: старое закрываем
          const previous = clients.get(player.id);
          if (previous && previous.ws !== ws) previous.ws.close(CLOSE.FORBIDDEN, 'replaced');

          clients.set(player.id, client);
          log(`ws: игрок ${player.name} (#${player.id}) вошёл, ${clients.size} в сети`);

          ws.send(JSON.stringify({
            t: MSG.WELCOME,
            you: player.id,
            name: player.name,
            serverTime: Date.now(),
          }));

          ws.send(JSON.stringify({
            t: MSG.SNAPSHOT,
            you: player.id,
            self: { id: player.id, name: player.name, x: client.x, z: client.z, yaw: client.yaw },
            players: [...clients.values()].map(toView),
            inventory: client.inventory,
            npcs: npcs.map((npc) => ({
              id: npc.id,
              name: npc.name,
              pos: npc.pos,
              yaw: npc.yaw,
              model: npc.model,
            })),
          }));

          // догоняем сюжет: свет и задание, которые уже случились без нас
          for (const event of scenario.stateEvents()) {
            ws.send(JSON.stringify({ t: MSG.EVENT, kind: event.kind, data: event.data }));
          }
          // и текущее состояние толпы
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'stats',
            data: { panic: stats.panic, trust: stats.trust, air: stats.air },
          }));

          // блокнот: мысли, которые висят у всех, нужны и опоздавшему
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'notes',
            data: { list: [...notes].map(([id, text]) => ({ id, text })) },
          }));

          // свет уже собрали — поздний игрок должен увидеть лампу на месте
          if (store.getFlag('has_light') === '1' && store.getFlag('lamp_x') !== null) {
            scenario.state.lights = LAMP_LIGHT;
            ws.send(JSON.stringify({
              t: MSG.EVENT,
              kind: 'lamp',
              data: { x: Number(store.getFlag('lamp_x')), z: Number(store.getFlag('lamp_z')) },
            }));
          }

          // состояние лобби: кто ещё в сети и началась ли игра
          broadcastLobby();
          return;
        }

        case MSG.COMBINE: {
          if (!client) return;

          const i = Number(msg.i);
          const j = Number(msg.j);
          if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) return;
          if (i < 0 || j < 0 || i >= client.inventory.length || j >= client.inventory.length) return;

          const first = client.inventory[i];
          const second = client.inventory[j];

          if (!first || !second) {
            sendInventory(ws, client.inventory, 'Пустой слот');
            return;
          }

          const recipe = findRecipe(first, second);
          if (!recipe) {
            sendInventory(ws, client.inventory, 'Из этого ничего не выходит');
            return;
          }

          // лампа в мире одна: второй фонарик не нужен и не собирается
          if (recipe.result === 'flashlight' && store.getFlag('has_light') === '1') {
            sendInventory(ws, client.inventory, 'Свет уже горит: вторая лампа не нужна.');
            return;
          }

          client.inventory[i] = recipe.result;
          client.inventory[j] = null;
          log(`игрок ${client.name}: ${first} + ${second} → ${recipe.result}`);

          store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
          sendInventory(ws, client.inventory, recipe.text);

          if (recipe.result === 'flashlight') {
            store.setFlag('has_light', '1');
            dropNotesByFlag('has_light');
            scenario.fire('flag', { flag: 'has_light' });

            // тот, кто собрал, видит, как ставит телефон на пол; остальные —
            // как вагон светлеет, когда лампа уже стоит
            ws.send(JSON.stringify({ t: MSG.EVENT, kind: 'cutscene', data: { id: 'craft_light' } }));
            const lampX = client.x - Math.sin(client.yaw) * 0.75;
            const lampZ = client.z - Math.cos(client.yaw) * 0.75;
            setTimeout(() => {
              placeLamp(lampX, lampZ);

              // предмет ушёл в мир: из рюкзака он пропадает
              client.inventory = client.inventory.map((slot) => (slot === 'flashlight' ? null : slot));
              store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
              if (ws.readyState === ws.OPEN) sendInventory(ws, client.inventory, '');
            }, LAMP_DELAY_MS);

            // свет успокаивает толпу и добавляет доверия к тому, кто его нашёл
            changeStat('panic', -8);
            changeStat('trust', 4);
          }
          return;
        }

        case MSG.ZONE: {
          if (!client) return;
          const chunk = String(msg.chunk ?? '');
          if (!chunk) return;
          scenario.fire('zone', { chunk });
          return;
        }

        case MSG.START: {
          if (!client) return;
          startGame(client.name);
          return;
        }

        case MSG.INTERACT: {
          if (!client) return;

          const prop = props.find((item) => item.id === String(msg.id ?? ''));
          if (!prop) return;

          const verb = prop.verbs.find((item) => item.id === String(msg.verb ?? ''));
          if (!verb) return;

          // условие задаётся флагом: например, люк без лома не открыть
          if (verb.requiresFlag && store.getFlag(verb.requiresFlag) !== '1') {
            ws.send(JSON.stringify({
              t: MSG.EVENT,
              kind: 'prop',
              data: { id: prop.id, verb: verb.id, text: 'Пока нечем это сделать.' },
            }));
            return;
          }

          if (verb.flag) {
            store.setFlag(verb.flag, verb.value ? '1' : '0');
            // мысль, которая опиралась на этот флаг, устарела — снимаем до новых
            dropNotesByFlag(verb.flag);
            // сценарий должен узнать о флаге, иначе триггеры на него не сработают
            scenario.fire('flag', { flag: verb.flag });

            // запись выключили — она больше не играет
            if (verb.flag === 'announcer_off') stopRadio();
          }

          // предмет из мира: если в рюкзаке есть место, вещь уходит в слот
          if (verb.item) {
            const takenKey = `taken_${prop.id}`;
            const taken = store.getFlag(takenKey) === '1';
            const free = client.inventory.indexOf(null);

            if (taken || free === -1) {
              ws.send(JSON.stringify({
                t: MSG.EVENT,
                kind: 'prop',
                data: {
                  id: prop.id,
                  verb: verb.id,
                  text: taken ? 'Тут уже пусто.' : 'В рюкзаке нет места.',
                },
              }));
              return;
            }

            client.inventory[free] = verb.item;
            store.setFlag(takenKey, '1');
            store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
            sendInventory(ws, client.inventory, verb.text ?? '');
          }

          // открытая дверь кабины пугает: там никого нет, и это заметно
          if (verb.id === 'open') changeStat('panic', 4);
          // открытая форточка возвращает воздух
          if (verb.air) changeStat('air', Number(verb.air));
          // тубус бьёт по нервам, конфеты наоборот
          if (verb.panic) changeStat('panic', Number(verb.panic));

          // у верба может быть своя мини-сцена — проигрываем её всем
          if (verb.cutscene) {
            broadcast({ kind: 'cutscene', data: { id: verb.cutscene } });
          }

          log(`игрок ${client.name}: ${prop.id} → ${verb.id}`);
          ws.send(JSON.stringify({
            t: MSG.EVENT,
            kind: 'prop',
            data: { id: prop.id, verb: verb.id, text: verb.text },
          }));
          scenario.fire('interact', { id: prop.id, verb: verb.id });
          return;
        }

        case MSG.SAY: {
          if (!client) return;

          const to = String(msg.to ?? '');
          const text = String(msg.text ?? '').trim().slice(0, 300);
          const npc = npcs.find((item) => item.id === to);
          if (!npc || !text) return;

          // не больше одного вопроса в секунду с человека: модель не бесплатная
          const now = Date.now();
          if (client.lastAsk && now - client.lastAsk < 1200) return;
          client.lastAsk = now;

          void respond(ws, client, npc, text);
          return;
        }

        case MSG.INPUT: {
          if (!client) return;
          const x = Number(msg.x);
          const z = Number(msg.z);
          const yaw = Number(msg.yaw);
          if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;

          // защита от телепорта: прыжок больше двух метров — возвращаем игрока
          // на серверную позицию, иначе клиент продолжит слать дальше и навсегда
          // разойдётся с остальными
          if (Math.hypot(x - client.x, z - client.z) > 2) {
            ws.send(JSON.stringify({
              t: MSG.SNAPSHOT,
              you: client.playerId,
              self: { id: client.playerId, name: client.name, x: client.x, z: client.z, yaw: client.yaw },
              players: [...clients.values()].map(toView),
              inventory: client.inventory,
              npcs: npcs.map((npc) => ({
                id: npc.id,
                name: npc.name,
                pos: npc.pos,
                yaw: npc.yaw,
                model: npc.model,
              })),
            }));
            return;
          }

          const clamped = inWorld(x, z);
          client.x = clamped.x;
          client.z = clamped.z;
          client.yaw = yaw;
          return;
        }

        case MSG.PING: {
          ws.send(JSON.stringify({
            t: MSG.PONG,
            id: msg.id,
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          }));
          return;
        }

        case MSG.READY: {
          return;
        }

        default:
          ws.send(JSON.stringify({ t: MSG.ERROR, code: 'unknown_message', message: String(msg?.t) }));
      }
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      if (!client) return;
      if (clients.get(client.playerId) === client) clients.delete(client.playerId);
      store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
      log(`ws: игрок ${client.name} (#${client.playerId}) вышел, код ${code}, ${clients.size} в сети`);

      // все ушли — сценарий и состояние толпы начинаются заново
      if (clients.size === 0) {
        scenario.reset();
        stopRadio();
        clearNotes();
        stats.panic = 20;
        stats.trust = 50;
        stats.air = 100;
        store.setFlag('panic', 20);
        store.setFlag('trust', 50);
        store.setFlag('air', 100);
      }

      broadcastLobby();
    });

    ws.on('error', (err) => log('ws: ошибка', err.message));
  });
}

function toView(client) {
  return { id: client.playerId, name: client.name, x: client.x, z: client.z, yaw: client.yaw };
}

function sendInventory(ws, slots, text = '') {
  ws.send(JSON.stringify({ t: MSG.INVENTORY, slots, text }));
}

/** Отправляем ответ агента по кускам: видно, что он думает, а не молчит. */
async function respond(ws, client, npc, text) {
  // если игрок ушёл, пока модель думает, запрос к ней надо оборвать
  const controller = new AbortController();
  const onClose = () => controller.abort();
  ws.once('close', onClose);

  try {
    for await (const delta of agents.reply({
      npc,
      playerId: client.playerId,
      playerName: client.name,
      text,
      signal: controller.signal,
      onResult: (answer) => {
        // числа из ответа агента меняют состояние мира — это его влияние на толпу
        if (answer.trustDelta) changeStat('trust', answer.trustDelta);
        if (answer.panicDelta) changeStat('panic', answer.panicDelta);
        if (answer.actionFlag && answer.actionFlag !== 'none') {
          log(`агент ${npc.id}: ${answer.actionFlag}`);
        }
      },
    })) {
      if (ws.readyState !== ws.OPEN || controller.signal.aborted) break;
      ws.send(JSON.stringify({ t: MSG.NPC_REPLY, id: npc.id, delta }));
    }
    if (ws.readyState === ws.OPEN && !controller.signal.aborted) {
      ws.send(JSON.stringify({ t: MSG.NPC_REPLY, id: npc.id, done: true }));
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      log('агент: сбой ответа —', error?.message ?? error);
    }
  } finally {
    ws.off('close', onClose);
  }
}

/* ───────────────────────────── запуск ───────────────────────────── */

function createServer() {
  if (DEV) {
    return { server: createHttpServer(handleHttp), scheme: 'http' };
  }

  const keyPath = join(CERTS, 'key.pem');
  const certPath = join(CERTS, 'cert.pem');

  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      server: createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handleHttp),
      scheme: 'https',
    };
  }

  log('! сертификата нет — поднимаю http. Сделай `npm run cert`, иначе шифрования нет.');
  return { server: createHttpServer(handleHttp), scheme: 'http' };
}

const { server, scheme } = createServer();
attachWebSocket(server);

// дельты позиций 20 раз в секунду
setInterval(() => {
  if (clients.size === 0) return;
  const list = [...clients.values()].map(toView);
  const payload = JSON.stringify({ t: MSG.PLAYERS, list });
  for (const client of clients.values()) {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(payload);
  }
}, 1000 / TICK.STATE_HZ);

// запись состояния в базу: раз в секунду
setInterval(() => {
  for (const client of clients.values()) {
    store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
  }
}, TICK.PERSIST_MS);

// сценарий: четыре раза в секунду проверяем, не пришло ли время очередному шагу
setInterval(() => scenario.tick(), 250);

// духота: начинается после того, как нашли свет, и прекращается, когда открыли форточку
let airTick = 0;
setInterval(() => {
  if (!scenario.running || clients.size === 0) return;
  if (store.getFlag('has_light') !== '1') return;
  if (store.getFlag('window_open') === '1') return;

  airTick++;
  if (airTick % 2 === 0 && stats.air > 0) changeStat('air', -1);
}, 1000);

// паника после записи растёт сама: бумажка на двери и выключенная тангента
// замедляют её, но не останавливают — толпу надо ещё и успокоить словами
let panicAccumulator = 0;
setInterval(() => {
  if (!scenario.running || clients.size === 0) return;
  if (store.getFlag('panic_running') !== '1') return;

  let rate = 1;
  if (store.getFlag('cab_papered') === '1') rate *= 0.6;
  if (store.getFlag('announcer_off') === '1') rate *= 0.5;
  if (store.getFlag('crowd_calmed') === '1') rate = 0;

  panicAccumulator += rate;
  if (panicAccumulator >= 1) {
    const step = Math.floor(panicAccumulator);
    panicAccumulator -= step;
    changeStat('panic', step);
  }
}, 3000);

if (!existsSync(join(DIST, 'index.html'))) {
  log('! dist/ не собран — сначала `npm run build`');
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, ip: addr.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  log(`сервер слушает ${scheme}://0.0.0.0:${PORT}`);
  if (DEV) {
    log('режим разработки: клиент открывать через Vite (npm run dev:client)');
  } else {
    for (const { name, ip } of lanAddresses()) log(`  ${scheme}://${ip}:${PORT}   (${name})`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('остановка: сохраняю состояние');
    for (const client of clients.values()) {
      store.saveState(client.playerId, client.x, client.z, client.yaw, client.inventory);
    }
    store.close();
    process.exit(0);
  });
}
