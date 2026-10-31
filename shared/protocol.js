/**
 * Общий протокол клиента и сервера.
 *
 * Файл нарочно на чистом JS: его читают обе стороны — сервер (Node, ESM)
 * и клиент (TypeScript + Vite, с allowJs). Одна копия правды.
 */

export const PROTOCOL_VERSION = 1;

/** Имена сообщений. Меняться могут только вместе с версией протокола. */
export const MSG = Object.freeze({
  // рукопожатие
  HELLO: 'hello',
  WELCOME: 'welcome',
  READY: 'ready',
  // связь
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  ECHO: 'echo',
  // мир
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  PLAYERS: 'players',
});

/** Коды закрытия WebSocket. 4xxx — наши, прикладные. */
export const CLOSE = Object.freeze({
  BAD_VERSION: 4400,   // клиент говорит не на той версии протокола
  UNAUTHORIZED: 4401,  // не прислал hello за отведённое время
  BAD_MESSAGE: 4402,   // прислал мусор
  FORBIDDEN: 4403,     // токен неверный или истёк
  RATE_LIMITED: 4408,  // слишком часто шлёт сообщения
});

/** Сколько ждём hello, прежде чем закрыть соединение. */
export const HELLO_TIMEOUT_MS = 5000;

/** Частоты. Меняются только вместе с интерполяцией на клиенте. */
export const TICK = Object.freeze({
  INPUT_HZ: 20,     // ввод клиента
  STATE_HZ: 20,     // дельты позиций
  PERSIST_MS: 1000, // запись в базу
});

/** Радиус, в котором игрок видит других. */
export const SEE_RADIUS = 40;

/** Пределы мира: пока это один вагон. */
export const WORLD = Object.freeze({
  minX: -1.35,
  maxX: 1.35,
  minZ: -10,
  maxZ: 10,
  spawnX: 0,
  spawnZ: 8.4,
});

/** Правила логина и пароля — и на сервере, и в подсказках на экране входа. */
export const AUTH = Object.freeze({
  LOGIN_RE: /^[A-Za-z0-9_]{3,16}$/,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 128,
  SESSION_HOURS: 8,
});

/**
 * @typedef {{ t: 'hello', v: number, token: string | null }} HelloMessage
 * @typedef {{ t: 'welcome', you: number, name: string, serverTime: number }} WelcomeMessage
 * @typedef {{ t: 'snapshot', you: number, self: PlayerView, players: PlayerView[] }} SnapshotMessage
 * @typedef {{ t: 'players', list: PlayerView[] }} PlayersMessage
 * @typedef {{ t: 'input', seq: number, x: number, z: number, yaw: number }} InputMessage
 * @typedef {{ id: number, name: string, x: number, z: number, yaw: number }} PlayerView
 */
