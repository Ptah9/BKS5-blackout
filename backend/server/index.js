/**
 * Сервер игры: отдаёт собранный клиент и держит WebSocket.
 *
 * M0 — только каркас: статика, рукопожатие, пинг. Авторизация, состояние
 * и сценарий приезжают на следующих вехах, но структура уже здесь.
 *
 * Запуск:
 *   node backend/server/index.js          — https://<ip>:8443 (если есть сертификат)
 *   node backend/server/index.js --dev    — http://127.0.0.1:8080 (для Vite dev-сервера)
 */

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

import { CLOSE, HELLO_TIMEOUT_MS, MSG, PROTOCOL_VERSION } from '../../shared/protocol.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DIST = join(ROOT, 'dist');
const CERTS = join(ROOT, 'certs');

const DEV = process.argv.includes('--dev');
const DEV_PORT = 8080;
const PORT = DEV ? DEV_PORT : 8443;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const log = (...args) => console.log(`[${new Date().toLocaleTimeString('ru-RU')}]`, ...args);

/* ───────────────────────────── статика ───────────────────────────── */

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function notFound(res) {
  send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
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
    // SPA-фолбэк: всё, что не файл и не /api, отдаём как index.html
    if (!pathname.startsWith('/api/') && existsSync(join(DIST, 'index.html'))) {
      return sendFile(res, join(DIST, 'index.html'));
    }
    return notFound(res);
  }
  return sendFile(res, target);
}

function sendFile(res, file) {
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

/* ───────────────────────────── WebSocket ──────────────────────────── */

let nextPlayerId = 1;

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    let playerId = null;

    log('ws: соединение с', ip);

    const helloTimer = setTimeout(() => {
      if (playerId === null) {
        log('ws: нет hello за', HELLO_TIMEOUT_MS, 'мс — закрываю', ip);
        ws.close(CLOSE.UNAUTHORIZED, 'hello timeout');
      }
    }, HELLO_TIMEOUT_MS);

    ws.on('message', (raw) => {
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
            log('ws: версия протокола', msg.v, '≠', PROTOCOL_VERSION);
            ws.close(CLOSE.BAD_VERSION, 'protocol version mismatch');
            return;
          }
          // Авторизация появится на M2. Пока пускаем всех, но говорим вслух.
          playerId = nextPlayerId++;
          clearTimeout(helloTimer);
          log('ws: игрок', playerId, 'вошёл', msg.token ? '(с токеном)' : '(без токена — auth ещё не подключён)');
          ws.send(JSON.stringify({
            t: MSG.WELCOME,
            you: playerId,
            tick: Date.now(),
            serverTime: Date.now(),
          }));
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

        case MSG.ECHO: {
          ws.send(JSON.stringify({ t: MSG.ECHO, payload: msg.payload ?? null }));
          return;
        }

        default:
          ws.send(JSON.stringify({ t: MSG.ERROR, code: 'unknown_message', message: String(msg?.t) }));
      }
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      log('ws: игрок', playerId ?? '—', 'отключился, код', code);
    });

    ws.on('error', (err) => log('ws: ошибка', err.message));
  });

  return wss;
}

/* ───────────────────────────── запуск ─────────────────────────────── */

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, ip: addr.address });
    }
  }
  return out;
}

function createServer() {
  const handler = (req, res) => serveStatic(req, res);

  if (DEV) {
    return { server: createHttpServer(handler), scheme: 'http', friendly: 'http://localhost:' + PORT };
  }

  const keyPath = join(CERTS, 'key.pem');
  const certPath = join(CERTS, 'cert.pem');

  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      server: createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handler),
      scheme: 'https',
    };
  }

  log('! сертификата нет — поднимаю http.', 'Сделай `npm run cert`, иначе шифрования нет.');
  return { server: createHttpServer(handler), scheme: 'http' };
}

const { server, scheme } = createServer();
attachWebSocket(server);

if (!existsSync(join(DIST, 'index.html'))) {
  log('! dist/ не собран — сначала `npm run build`');
}

server.listen(PORT, '0.0.0.0', () => {
  log(`сервер слушает ${scheme}://0.0.0.0:${PORT}`);
  if (DEV) {
    log('режим разработки: клиент открывать через Vite (npm run dev:client)');
  } else {
    for (const { name, ip } of lanAddresses()) {
      log(`  ${scheme}://${ip}:${PORT}   (${name})`);
    }
  }
});
