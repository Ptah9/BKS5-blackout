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
import { toRussianName } from '../../shared/translit.js';
import { AUTH, CLOSE, HELLO_TIMEOUT_MS, MSG, PROTOCOL_VERSION, TICK, WORLD } from '../../shared/protocol.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const CERTS = join(ROOT, 'certs');
const DB_FILE = join(ROOT, 'data', 'game.db');

const DEV = process.argv.includes('--dev');
const PORT = DEV ? 8080 : 8443;

const log = (...args) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}]`, ...args);

/* ───────────────────────────── база ───────────────────────────── */

const store = new Store(DB_FILE);
log('база:', DB_FILE);

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

async function handleLogin(req, res) {
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
    player = store.createPlayer(login, toRussianName(login), hash, salt);
    log('вход: создан игрок', login, '→', player.name);
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
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

async function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');

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
          client = {
            ws,
            playerId: player.id,
            name: player.name,
            x: saved?.x ?? WORLD.spawnX,
            z: saved?.z ?? WORLD.spawnZ,
            yaw: saved?.yaw ?? 0,
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
          }));
          return;
        }

        case MSG.INPUT: {
          if (!client) return;
          const x = Number(msg.x);
          const z = Number(msg.z);
          const yaw = Number(msg.yaw);
          if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;

          // защита от телепорта: за один пакет больше двух метров — игнор
          if (Math.hypot(x - client.x, z - client.z) > 2) return;

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
      store.saveState(client.playerId, client.x, client.z, client.yaw);
      log(`ws: игрок ${client.name} (#${client.playerId}) вышел, код ${code}, ${clients.size} в сети`);
    });

    ws.on('error', (err) => log('ws: ошибка', err.message));
  });
}

function toView(client) {
  return { id: client.playerId, name: client.name, x: client.x, z: client.z, yaw: client.yaw };
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
    store.saveState(client.playerId, client.x, client.z, client.yaw);
  }
}, TICK.PERSIST_MS);

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
      store.saveState(client.playerId, client.x, client.z, client.yaw);
    }
    store.close();
    process.exit(0);
  });
}
