/**
 * Ввод: клавиатура и мышь с захватом курсора.
 *
 * Отдаёт не «нажата ли W сейчас», а накопленный сдвиг мыши, который игрок
 * забирает раз в кадр. Так мышь не теряет движение между кадрами и не зависит
 * от того, с какой частотой её опрашивают.
 */

export class Input {
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private locked = false;

  /** Чувствительность мыши, радианы на пиксель. */
  sensitivity = 0.0022;

  constructor(private readonly canvas: HTMLCanvasElement) {
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('blur', this.releaseAll);
    canvas.addEventListener('click', this.requestLock);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** Сдвиг мыши с прошлого вызова. Сбрасывается при чтении. */
  consumeLook(): { x: number; y: number } {
    const out = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('blur', this.releaseAll);
    this.canvas.removeEventListener('click', this.requestLock);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  private requestLock = (): void => {
    if (!this.locked) void this.canvas.requestPointerLock();
  };

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.releaseAll();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // если фокус в поле ввода (чат с персонажем), клавиатура принадлежит ему:
    // иначе пробел «съедался» и текст писался без пробелов
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    // Space и стрелки иначе скроллят страницу под игрой
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.pressed.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    this.pressed.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // Причина сброса накопленного сдвига: если вкладка теряла фокус,
    // первое движение может прийти огромным и развернуть камеру.
    const limit = 200;
    this.lookX += Math.max(-limit, Math.min(limit, e.movementX));
    this.lookY += Math.max(-limit, Math.min(limit, e.movementY));
  };

  private releaseAll = (): void => {
    this.pressed.clear();
    this.lookX = 0;
    this.lookY = 0;
  };
}
