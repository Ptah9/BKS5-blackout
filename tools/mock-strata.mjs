/**
 * Макет Strata для проверки нашего клиента без мака.
 *
 * Поднимает на 127.0.0.1:8091 OpenAI-совместимый сервер: /v1/models и
 * /v1/chat/completions с SSE. Проверяет ключ, если он задан в MOCK_KEY.
 *
 *   node tools/mock-strata.mjs
 *
 * Это обманка только для разработки: в игре используется настоящий сервер.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 8091);
const KEY = process.env.MOCK_KEY ?? 'test-key';
const MODEL = process.env.MOCK_MODEL ?? 'qwen3.8-flash-next';
let counter = 0;

const server = createServer((req, res) => {
  const authorized = !KEY || req.headers.authorization === `Bearer ${KEY}`;
  if (req.url === '/v1/models') {
    if (!authorized) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }));
    return;
  }

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    if (!authorized) {
      res.writeHead(401).end('unauthorized');
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body || '{}');
      // разные ответы на разные вопросы: так видно, что клиент не кэширует
      const n = (counter += 1);
      const answer = `Ответ ${n}: свет погас, но я на месте. Держись рядом и не беги.`;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const pieces = answer.match(/.{1,4}/gs) ?? [answer];
      let index = 0;

      const timer = setInterval(() => {
        if (index >= pieces.length) {
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(timer);
          return;
        }

        const chunk = {
          id: 'mock',
          object: 'chat.completion.chunk',
          model: request.model ?? MODEL,
          choices: [{ index: 0, delta: { content: pieces[index] } }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        index++;
      }, 30);
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`макет Strata слушает http://127.0.0.1:${PORT}, ключ: ${KEY || '(без ключа)'}`);
});
