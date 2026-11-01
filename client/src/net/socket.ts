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
  onSnapshot?: (self: PlayerView, players: PlayerView[], inventory: Array<string | null>) => void;
  onPlayers?: (list: PlayerView[]) => void;
  onInventory?: (slots: Array<string | null>, text: string) => void;
  onEvent?: (kind: string, data: Record<string, unknown>) => void;
  onNpcs?: (list: Array<{ id: string; name: string; pos: number[]; yaw: number; model?: string }>) => void;
  onNpcReply?: (id: string, delta: string, done: boolean) => void;
  onLobby?: (players: string[], started: boolean) => void;
  onPong?: (rttMs: number) => void;
  onAdminState?: (data: Record<string, unknown>) => void;
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

  /** Просим сервер соединить предметы. Решает он, а не клиент. */
  combine(i: number, j: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.COMBINE, i, j }));
  }

  /** Сообщаем серверу, что игрок вошёл в другую часть мира. */
  sendZone(chunk: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.ZONE, chunk }));
  }

  /**
   * Свои fps и ping раз в секунду. Ping — тот же замер, что ходит через
   * PING/PONG: сервер сам его не считает, поэтому прикладываем к fps.
   */
  sendClientStats(fps: number, ping: number): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.CLIENT_STATS, fps: Math.round(fps), ping: Math.round(ping) }));
  }

  /** Панель администратора: попросить срез мира. Ответ — onAdminState. */
  requestAdmin(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.ADMIN }));
  }

  /** Ручка панели: паника/доверие (0–100), свет (0–1), флаг, персона. */
  adminSet(
    kind: string,
    value: number,
    flag?: string,
    code?: string,
    npc?: string,
    text?: string,
  ): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      t: MSG.ADMIN_SET,
      kind,
      value,
      flag: flag ?? null,
      code: code ?? '',
      npc: npc ?? null,
      text: text ?? null,
    }));
  }

  /** Персона агента из панели: отдельное сообщение, текст до 2000 символов. */
  adminPersona(id: string, text: string, code?: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.ADMIN_PERSONA, id, text, code: code ?? '' }));
  }

  /** Объявление в микрофон: сервер оценит слова по ключевым. */
  announce(text: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.ANNOUNCE, text }));
  }

  /** Попытка выйти в тоннель: сервер ответит текстом, если акт 1 не закрыт. */
  exitTry(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.EXIT_TRY }));
  }

  /** «Начать заново» после смерти: оживляет и мягко откатывает толпу. */
  restart(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.RESTART }));
  }

  /** Сказать персонажу. Ответ придёт потоком через onNpcReply. */  say(npcId: string, text: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.SAY, to: npcId, text }));
  }

  /** Действие с предметом мира: дверь, кнопка, люк. Проверяет сервер. */
  interact(id: string, verb: string, item?: string | null): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.INTERACT, id, verb, item: item ?? null }));
  }

  /** Старт игры: сценарий запускается у всех одновременно. */
  start(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: MSG.START }));
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
          (msg.inventory as Array<string | null>) ?? [],
        );
        // список агентов приходит не в каждом снапшоте: пустой ответ не должен
        // стирать уже расставленных
        if (Array.isArray(msg.npcs)) {
          this.handlers.onNpcs?.(
            msg.npcs as Array<{ id: string; name: string; pos: number[]; yaw: number; model?: string }>,
          );
        }
        return;

      case MSG.NPC_REPLY:
        this.handlers.onNpcReply?.(
          String(msg.id ?? ''),
          String(msg.delta ?? ''),
          Boolean(msg.done),
        );
        return;

      case MSG.INVENTORY:
        this.handlers.onInventory?.(
          (msg.slots as Array<string | null>) ?? [],
          String(msg.text ?? ''),
        );
        return;

      case MSG.EVENT:
        this.handlers.onEvent?.(String(msg.kind ?? ''), (msg.data as Record<string, unknown>) ?? {});
        return;

      case MSG.LOBBY:
        this.handlers.onLobby?.((msg.players as string[]) ?? [], Boolean(msg.started));
        return;

      case MSG.ADMIN_STATE:
        this.handlers.onAdminState?.((msg.data as Record<string, unknown>) ?? {});
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
