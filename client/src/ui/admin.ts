/**
 * Панель администратора: оверлей поверх игры, только чтение.
 *
 * Зачем отдельный модуль: main.ts и так отвечает за кадр, ввод и сцену, а тут
 * чистый DOM. Данные приходят с сервера (у него ping и fps всех клиентов,
 * аптайм, база, флаги); панель их только показывает.
 */

export interface AdminClient {
  name: string;
  ping: number;
  fps: number;
}

export interface AdminState {
  server: {
    uptime: number;
    players: number;
    ticks: number;
    rssMb: number;
    dbKb: number;
  };
  clients: AdminClient[];
  stats: { panic: number; trust: number; air: number };
  lights: number;
  npcs: Array<{ id: string; name: string }>;
  flags: Array<{ key: string; value: string }>;
}

/** Что панель умеет трогать. Сервер всё равно проверяет значения сам. */
export type AdminKind = 'panic' | 'trust' | 'lights' | 'flag';

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });

export class AdminPanel {
  private readonly root: HTMLDivElement;
  private opened = false;
  /** Пока тянем слайдер, панель не перерисовываем — иначе ползунок прыгает. */
  private dragging = false;
  /** Раз не чаще 120 мс: иначе сервер посчитает поток сообщений флудом. */
  private readonly lastSent = new Map<string, number>();
  private state: AdminState | null = null;

  constructor(private readonly onCommand: (kind: AdminKind, value: number, flag?: string) => void) {
    this.root = document.createElement('div');
    this.root.id = 'admin-panel';
    this.root.style.cssText = [
      'position:fixed',
      'inset:20px',
      'z-index:40',
      'display:none',
      'padding:14px 18px',
      'background:rgba(8,12,18,0.92)',
      'border:1px solid #3a4a5e',
      'color:#c9d6e6',
      'font:12px/1.45 Consolas,monospace',
      'overflow:auto',
      'white-space:pre-wrap',
    ].join(';');
    document.body.appendChild(this.root);

    // обработчики живут на контейнере: разметка перерисовывается, а они нет
    this.root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      const kind = input.dataset.admin;
      if (kind !== 'panic' && kind !== 'trust') return;

      const now = performance.now();
      if ((this.lastSent.get(kind) ?? 0) + 120 > now) return;
      this.lastSent.set(kind, now);
      this.onCommand(kind, Number(input.value));
    });

    this.root.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const kind = input.dataset.admin;
      if (kind !== 'panic' && kind !== 'trust') return;
      // отпустили ползунок — отправляем точное значение
      this.onCommand(kind, Number(input.value));
    });

    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-admin]') as HTMLButtonElement | null;
      if (!button) return;

      const kind = button.dataset.admin;
      if (kind === 'lights') {
        this.onCommand('lights', (this.state?.lights ?? 0) > 0 ? 0 : 0.9);
        return;
      }

      if (kind === 'flag') {
        const flag = button.dataset.flag ?? '';
        if (!flag) return;
        const on = button.dataset.next === '1';
        this.onCommand('flag', on ? 1 : 0, flag);
      }
    });

    this.root.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).matches('input[type="range"]')) this.dragging = true;
    });
    addEventListener('pointerup', () => {
      this.dragging = false;
    });
  }

  get open(): boolean {
    return this.opened;
  }

  setOpen(open: boolean): void {
    if (open === this.opened) {
      if (!open) this.root.innerHTML = '';
      return;
    }
    this.opened = open;
    this.root.style.display = open ? 'block' : 'none';
    if (!open) this.root.innerHTML = '';
  }

  toggle(): boolean {
    this.setOpen(!this.opened);
    return this.opened;
  }

  close(): void {
    this.setOpen(false);
  }

  render(state: AdminState): void {
    if (!this.opened) return;
    this.state = state;
    // пока тянут ползунок, не перерисовываем: иначе он прыгает под рукой
    if (this.dragging) return;

    const s = state.server;
    const clients = state.clients.length === 0
      ? '<tr><td colspan="3">никого нет</td></tr>'
      : state.clients
          .map(
            (client) =>
              `<tr><td>${escape(client.name)}</td><td>${client.ping} мс</td><td>${client.fps} fps</td></tr>`,
          )
          .join('');

    const npcs = state.npcs.length === 0
      ? '<li>нет</li>'
      : state.npcs.map((npc) => `<li>${escape(npc.name)} <span style="color:#6f8096">${escape(npc.id)}</span></li>`).join('');

    const flags = state.flags.length === 0
      ? '<li>пусто</li>'
      : state.flags
          .map((flag) => {
            const on = flag.value === '1';
            return `<li><span style="color:${on ? '#9ecbff' : '#6f8096'}">${escape(flag.key)}</span> = ${escape(flag.value)}
              <button data-admin="flag" data-flag="${escape(flag.key)}" data-next="${on ? '0' : '1'}"
                style="margin-left:6px;background:#1d2733;color:#c9d6e6;border:1px solid #3a4a5e;font:11px Consolas,monospace">${on ? 'снять' : 'поставить'}</button></li>`;
          })
          .join('');

    const lights = state.lights > 0;

    this.root.innerHTML = `
      <div style="font-size:14px;color:#ffffff">Панель администратора <span style="color:#6f8096">· F3 — закрыть</span></div>
      <div style="margin-top:8px">
        аптайм ${Math.floor(s.uptime / 60)} мин ${s.uptime % 60} с ·
        игроков ${s.players} · тиков ${s.ticks}/с ·
        память ${s.rssMb} МБ · база ${s.dbKb} КБ
      </div>
      <div style="margin-top:10px;display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <label>паника
          <input type="range" min="0" max="100" step="1" value="${state.stats.panic}" data-admin="panic" style="width:140px;vertical-align:middle">
          <b>${state.stats.panic}</b>
        </label>
        <label>доверие
          <input type="range" min="0" max="100" step="1" value="${state.stats.trust}" data-admin="trust" style="width:140px;vertical-align:middle">
          <b>${state.stats.trust}</b>
        </label>
        <span>свет в вагоне <b>${state.lights.toFixed(2)}</b>
          <button data-admin="lights"
            style="margin-left:6px;background:#1d2733;color:#c9d6e6;border:1px solid #3a4a5e;font:12px Consolas,monospace">${lights ? 'выключить' : 'включить'}</button>
        </span>
      </div>
      <div style="display:flex;gap:26px;margin-top:12px;align-items:flex-start">
        <div>
          <div style="color:#ffffff">Клиенты</div>
          <table style="border-collapse:collapse;margin-top:4px">
            <thead><tr><th style="text-align:left;padding:2px 16px 2px 0">имя</th><th style="text-align:left;padding:2px 16px 2px 0">ping</th><th style="text-align:left">fps</th></tr></thead>
            <tbody>${clients}</tbody>
          </table>
          <div style="margin-top:14px;color:#ffffff">NPC</div>
          <ul style="margin:4px 0 0 16px;padding:0">${npcs}</ul>
        </div>
        <div>
          <div style="color:#ffffff">Флаги мира</div>
          <ul style="margin:4px 0 0 16px;padding:0">${flags}</ul>
        </div>
      </div>
    `;
  }
}
