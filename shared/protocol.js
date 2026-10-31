/**
 * Общий протокол клиента и сервера.
 *
 * Файл нарочно на чистом JS: его читают обе стороны — сервер (Node, ESM)
 * и клиент (TypeScript + Vite, с allowJs). Одна копия правды.
 */

export const PROTOCOL_VERSION = 1;

/** Имена сообщений. Меняться могут только вместе с версией протокола. */
export const MSG = Object.freeze({
  HELLO: 'hello',
  WELCOME: 'welcome',
  READY: 'ready',
  PING: 'ping',
  PONG: 'pong',
  ECHO: 'echo',
  ERROR: 'error',
});

/** Коды закрытия WebSocket. 4xxx — наши, прикладные. */
export const CLOSE = Object.freeze({
  BAD_VERSION: 4400,   // клиент говорит не на той версии протокола
  UNAUTHORIZED: 4401,  // не прислал hello за отведённое время
  FORBIDDEN: 4403,     // токен неверный или истёк
  BAD_MESSAGE: 4402,   // прислал мусор
});

/** Сколько ждём hello, прежде чем закрыть соединение. */
export const HELLO_TIMEOUT_MS = 5000;

/**
 * @typedef {{ t: string }} AnyMessage
 * @typedef {{ t: 'hello', v: number, token: string | null }} HelloMessage
 * @typedef {{ t: 'welcome', you: number, tick: number, serverTime: number }} WelcomeMessage
 * @typedef {{ t: 'ping', id: number, clientTime: number }} PingMessage
 * @typedef {{ t: 'pong', id: number, clientTime: number, serverTime: number }} PongMessage
 */
