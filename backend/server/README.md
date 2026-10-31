# backend/server

Сервер игры на Node (ESM, без сборки): отдаёт `dist/` и держит WebSocket.

```bash
node backend/server/index.js         # https://<ip>:8443, если выпущен сертификат
node backend/server/index.js --dev   # http://127.0.0.1:8080 для работы с Vite
```

Что уже есть (M0): статика, `/ws`, рукопожатие `hello → welcome`, `ping → pong`.

Что приедет дальше: авторизация и токены (M2), снапшоты и дельты состояния (M2),
таймлайн сценария и флаги мира (M5), прокси к локальной модели (M5).

Протокол сообщений — `shared/protocol.js`, описание — `Flaude/ПРОТОКОЛ.md`.
