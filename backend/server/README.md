# backend/server

Сервер игры на Node (ESM, без сборки): отдаёт `dist/` и держит WebSocket.

```bash
node backend/server/index.js         # https://<ip>:8443, если выпущен сертификат
node backend/server/index.js --dev   # http://127.0.0.1:8090 для работы с Vite
```

Сервер уже поддерживает локальные модели Ollama и OpenAI-совместимые API,
а также DeepSeek и встроенные правила как резервные режимы. Подключение Ollama
описано в [`../llm/README.md`](../llm/README.md).

Протокол сообщений — `shared/protocol.js`.
