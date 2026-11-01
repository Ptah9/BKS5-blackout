/** Статический сервер для проверки рига: отдаёт корень репозитория. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PORT = Number(process.env.PORT ?? 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  // снимок экрана из страницы: POST /__shot с data:image/png;base64,...
  if (request.method === 'POST' && url.pathname === '/__shot') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const base64 = body.replace(/^data:image\/png;base64,/, '');
      const target = path.join(ROOT, 'tools', 'rig', url.searchParams.get('name') ?? 'shot.png');
      fs.writeFileSync(target, Buffer.from(base64, 'base64'));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ saved: target }));
    });
    return;
  }

  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('нельзя');
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    response.writeHead(404).end('нет файла: ' + url.pathname);
    return;
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${PORT}/tools/rig/viewer.html`);
});
