/**
 * WebSocket на клиенте: рукопожатие с токеном, ввод 20 Гц, дельты мира.
 *
 * Адрес не настраивается: страница пришла с сервера, сокет идёт туда же.
 * Токен не даёт открыть мир: без него сервер закрывает соединение кодом 4403,
 * и клиент возвращается на экран входа, а не «висит в ошибке».
 */

import { CLOSE, MSG, PROTOCOL_VERSION } from '../../../shared/protocol.js';
import type { PlayerView } from './types';

export type SocketState = 'connecting' | 'open' | 'closed';

interface Handlers {
  onState?: (state: SocketState) => void;
  onWelcome?: (you: number, name: string) => void;
  onSnapshot?: (self: PlayerView, players: PlayerView[]) => void;
  onPlayers?: (list: PlayerView[]) => void;
  onPong?: (rttMs: number) => void;
  onAuthFailed?: () => void;
}

export class Net {
  private ws: WebSocket | null = null;
  private retry = 500;
  private pingId = 0;
  private stopped = false;
  private readonly url: string;

  constructor(
    private readonly token: string,
    private readonly handlers: Handlers = {},
  ) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/ws`;
  }

  connect(): void {
    if (this.stopped) return;
    this.handlers.onState?.('connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retry = 500;
      this.handlers.onState?.('open');
      ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token: this.token }));
    });

    ws.addEventListener('message', (event) => this.handle(String(event.data)));

    ws.addEventListener('close', (event) => {
      this.handlers.onState?.('closed');
      if (event.code === CLOSE.FORBIDDEN) {
        // токен не принят — переподключение бессмысленно, нужен новый вход
        this.stopped = true;
        this.handlers.onAuthFailed?.();
        return;
      }
      const wait = this.retry;
      this.retry = Math.min(this.retry * 2, 8000);
      setTimeout(() => this.connect(), wait);
    });

    ws.addEventListener('error', () => ws.close());
  }

  sendInput(x: number, z: number, yaw: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.INPUT, x, z, yaw }));
  }

  ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.PING, id: ++this.pingId, clientTime: performance.now() }));
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private handle(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (msg.t) {
      case MSG.WELCOME:
        this.handlers.onWelcome?.(Number(msg.you), String(msg.name));
        return;

      case MSG.SNAPSHOT:
        this.handlers.onSnapshot?.(
          msg.self as PlayerView,
          (msg.players as PlayerView[]) ?? [],
        );
        return;

      case MSG.PLAYERS:
        this.handlers.onPlayers?.((msg.list as PlayerView[]) ?? []);
        return;

      case MSG.PONG:
        this.handlers.onPong?.(performance.now() - Number(msg.clientTime ?? 0));
        return;

      default:
        return;
    }
  }
}
