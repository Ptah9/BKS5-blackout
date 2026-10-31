# client

Браузерный клиент: Three.js + TypeScript, сборка Vite.

```
src/
  main.ts        точка входа, кадровый цикл
  net/socket.ts  WebSocket: рукопожатие, пинг, реконнект
  style.css      оформление HUD
```

```bash
npm run build        # → ../dist, его отдаёт backend/server
npm run dev:client   # Vite на 5173, проксирует /ws и /api на сервер (8080)
npm run typecheck
```

Правило: адрес сервера нигде не настраивается. Клиент берёт `location.origin`,
поэтому одна сборка работает на любой машине в сети.
