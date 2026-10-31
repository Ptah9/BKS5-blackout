import { MSG, PROTOCOL_VERSION } from '../../../shared/protocol.js';

export type SocketState = 'connecting' | 'open' | 'closed';

interface Handlers {
  onState?: (state: SocketState) => void;
  onWelcome?: (you: number) => void;
  onPong?: (rttMs: number) => void;
}

/**
 * Один WebSocket на клиента. Адрес не настраивается: страница пришла с сервера,
 * значит и сокет идёт на тот же origin. Одна сборка работает на любой машине.
 *
 * M0: рукопожатие и пинг. Реконнект простой (backoff 0.5 → 8 с), токен появится на M2.
 */
export class Net {
  private ws: WebSocket | null = null;
  private retry = 500;
  private token: string | null = null;
  private pingId = 0;
  private readonly url: string;

  constructor(private readonly h: Handlers = {}) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/ws`;
  }

  connect(token: string | null = null): void {
    this.token = token;
    this.h.onState?.('connecting');

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retry = 500;
      this.h.onState?.('open');
      ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION, token }));
    });

    ws.addEventListener('message', (ev) => this.handle(String(ev.data)));

    ws.addEventListener('close', () => {
      this.h.onState?.('closed');
      const wait = this.retry;
      this.retry = Math.min(this.retry * 2, 8000);
      setTimeout(() => this.connect(this.token), wait);
    });

    ws.addEventListener('error', () => ws.close());
  }

  ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.PING, id: ++this.pingId, clientTime: performance.now() }));
  }

  private handle(raw: string): void {
    let msg: { t?: string; you?: number; clientTime?: number };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.t === MSG.WELCOME) this.h.onWelcome?.(msg.you ?? 0);
    else if (msg.t === MSG.PONG) this.h.onPong?.(performance.now() - (msg.clientTime ?? 0));
  }
}
