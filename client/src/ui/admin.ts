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

/**
 * Агент в панели: имя, id и текущий текст персоны.
 * `custom` — персона правилась из панели и лежит в базе, иначе она из content/npcs.json.
 */
export interface AdminPersona {
  id: string;
  name: string;
  /** Новое имя поля — text; старое persona тоже читаем, чтобы не ломать старый сервер. */
  text?: string;
  persona?: string;
  custom: boolean;
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
  /** Список агентов: сервер отдаёт personas, старый ключ npcs тоже принимаем. */
  personas?: AdminPersona[];
  npcs?: AdminPersona[];
  flags: Array<{ key: string; value: string }>;
}

/** Сколько символов персоны пускаем: тот же предел режет и сервер. */
const PERSONA_MAX = 2000;

/** Что панель умеет трогать. Сервер всё равно проверяет значения сам. */
export type AdminKind = 'panic' | 'trust' | 'lights' | 'flag' | 'persona';

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
  /** Код администратора из окружения сервера: без него панель только читает. */
  private code = '';
  /**
   * Недосохранённый текст персоны по id агента. Панель перерисовывается раз в
   * секунду с сервера; без черновика набранное затиралось бы ответом с сервера.
   */
  private readonly drafts = new Map<string, string>();

  constructor(
    private readonly onCommand: (
      kind: AdminKind,
      value: number,
      flag?: string,
      code?: string,
      npc?: string,
      text?: string,
    ) => void,
    /**
     * Отдельный канал персоны (сообщение admin_persona). Не задан — уходим
     * старым путём через admin_set kind='persona', чтобы ничего не сломать.
     */
    private readonly onPersona?: (id: string, text: string, code: string) => void,
  ) {
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
      if (kind === 'code') {
        this.code = input.value;
        // поля персоны разблокируются сразу, без ожидания перерисовки
        this.syncCodeControls();
        return;
      }
      // набранный текст персоны держим отдельно: снапшот с сервера его не затрёт
      if (kind === 'persona') {
        const npcId = input.dataset.npc ?? '';
        if (!npcId) return;
        this.drafts.set(npcId, input.value);
        // счётчик символов обновляем на месте: перерисовка выбила бы курсор
        const counter = this.root.querySelector(`span[data-counter="${npcId}"]`);
        if (counter) counter.textContent = `${input.value.length} / ${PERSONA_MAX}`;
        return;
      }
      if (kind !== 'panic' && kind !== 'trust') return;

      const now = performance.now();
      if ((this.lastSent.get(kind) ?? 0) + 120 > now) return;
      this.lastSent.set(kind, now);
      this.onCommand(kind, Number(input.value), undefined, this.code);
    });

    this.root.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const kind = input.dataset.admin;
      if (kind !== 'panic' && kind !== 'trust') return;
      // отпустили ползунок — отправляем точное значение
      this.onCommand(kind, Number(input.value), undefined, this.code);
    });

    this.root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button[data-admin]') as HTMLButtonElement | null;
      if (!button) return;

      const kind = button.dataset.admin;
      if (kind === 'lights') {
        this.onCommand('lights', (this.state?.lights ?? 0) > 0 ? 0 : 0.9, undefined, this.code);
        return;
      }

      if (kind === 'flag') {
        const flag = button.dataset.flag ?? '';
        if (!flag) return;
        const on = button.dataset.next === '1';
        this.onCommand('flag', on ? 1 : 0, flag, this.code);
        return;
      }

      if (kind === 'persona-save' || kind === 'persona-reset') {
        const npcId = button.dataset.npc ?? '';
        if (!npcId) return;

        // сброс — это пустой текст: сервер вернёт персону из content/npcs.json
        const raw = kind === 'persona-save'
          ? (this.root.querySelector(`textarea[data-npc="${npcId}"]`) as HTMLTextAreaElement | null)?.value ?? ''
          : '';
        const text = raw.trim().slice(0, PERSONA_MAX);

        if (text) this.drafts.set(npcId, text);
        else this.drafts.delete(npcId);

        if (this.onPersona) this.onPersona(npcId, text, this.code);
        else this.onCommand('persona', 0, undefined, this.code, npcId, text);
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

  /**
   * Без кода админа персона только читается. Переключаем атрибуты прямо в DOM,
   * а не перерисовкой: иначе слетал бы фокус с поля, куда человек только что ввёл код.
   */
  private syncCodeControls(): void {
    const locked = this.code.length === 0;
    for (const area of this.root.querySelectorAll('textarea[data-admin="persona"]')) {
      (area as HTMLTextAreaElement).readOnly = locked;
    }
    for (const button of this.root.querySelectorAll('button[data-admin^="persona-"]')) {
      (button as HTMLButtonElement).disabled = locked;
    }
  }

  /** Приводит строку к тому виду, в каком её хранит сервер: trim и потолок 2000. */
  private static canonical(text: string): string {
    return text.trim().slice(0, PERSONA_MAX);
  }

  render(state: AdminState): void {
    if (!this.opened) return;
    this.state = state;
    // пока тянут ползунок или вводят код, не перерисовываем: иначе прыгает под рукой
    if (this.dragging) return;
    if (document.activeElement instanceof HTMLInputElement && this.root.contains(document.activeElement)) return;
    // персона набирается в textarea: перерисовка выбила бы курсор на середине слова
    if (document.activeElement instanceof HTMLTextAreaElement && this.root.contains(document.activeElement)) return;

    const s = state.server;
    const clients = state.clients.length === 0
      ? '<tr><td colspan="3">никого нет</td></tr>'
      : state.clients
          .map(
            (client) =>
              `<tr><td>${escape(client.name)}</td><td>${client.ping} мс</td><td>${client.fps} fps</td></tr>`,
          )
          .join('');

    const npcs = state.npcs ?? [];
    const personas = (state.personas ?? npcs).map((agent) => {
      const id = String(agent.id ?? '');
      const text = String(agent.text ?? agent.persona ?? '');
      // черновик важнее снапшота; как только сервер вернул ровно то, что мы
      // отправили, черновик больше не нужен
      const draft = this.drafts.get(id);
      if (draft !== undefined && AdminPanel.canonical(draft) === text) this.drafts.delete(id);
      return {
        id,
        name: String(agent.name ?? id),
        text: this.drafts.get(id) ?? text,
        custom: Boolean(agent.custom),
      };
    });

    const locked = this.code.length === 0;
    const personaList = personas.length === 0
      ? '<li>нет агентов</li>'
      : personas
          .map(
            (agent) => `
        <li style="border-top:1px solid #25313f;padding-top:8px">
          <div>
            <b style="color:#ffffff">${escape(agent.name)}</b>
            <span style="color:#6f8096">${escape(agent.id)}${agent.custom ? ' · своя' : ' · из файла'}</span>
          </div>
          <textarea data-admin="persona" data-npc="${escape(agent.id)}" rows="4" maxlength="${PERSONA_MAX}"
            ${locked ? 'readonly' : ''}
            style="width:min(660px,100%);margin-top:4px;background:#1d2733;color:#c9d6e6;border:1px solid #3a4a5e;font:11px Consolas,monospace;resize:vertical">${escape(agent.text)}</textarea>
          <div style="margin-top:3px;display:flex;gap:6px;align-items:center">
            <button data-admin="persona-save" data-npc="${escape(agent.id)}" ${locked ? 'disabled' : ''}
              style="background:#1d2733;color:#c9d6e6;border:1px solid #3a4a5e;font:11px Consolas,monospace">сохранить</button>
            <button data-admin="persona-reset" data-npc="${escape(agent.id)}" ${locked ? 'disabled' : ''}
              style="background:#1d2733;color:#6f8096;border:1px solid #3a4a5e;font:11px Consolas,monospace">сбросить</button>
            <span data-counter="${escape(agent.id)}" style="color:#6f8096">${agent.text.length} / ${PERSONA_MAX}</span>
          </div>
        </li>`,
          )
          .join('');

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
      <div style="font-size:14px;color:#ffffff">Панель администратора <span style="color:#6f8096">· F3 — закрыть</span>
        <span style="margin-left:14px;color:#6f8096">код
          <input data-admin="code" type="password" value="${escape(this.code)}"
            style="width:110px;background:#1d2733;color:#c9d6e6;border:1px solid #3a4a5e;font:12px Consolas,monospace">
        </span>
      </div>
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
          <div style="margin-top:14px;color:#6f8096">агенты — ниже</div>
        </div>
        <div>
          <div style="color:#ffffff">Флаги мира</div>
          <ul style="margin:4px 0 0 16px;padding:0">${flags}</ul>
        </div>
      </div>
      <div style="margin-top:16px">
        <div style="color:#ffffff">Агенты
          <span style="color:#6f8096">· промпт правится на ходу, пустой текст = вернуть из файла${locked ? ' · нужен код' : ''}</span>
        </div>
        <ul style="margin:6px 0 0 0;padding:0;list-style:none">${personaList}</ul>
      </div>
    `;
  }
}
