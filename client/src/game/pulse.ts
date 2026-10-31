/**
 * Пульс от событий.
 *
 * Настоящего датчика нет — и это надо говорить вслух, а не изображать.
 * Считаем стресс: темнота и бег поднимают, свет и покой опускают.
 * Пульс = 65 + 70 · стресс, то есть от 65 до 135.
 */

export interface PulseContext {
  /** Есть ли рабочий фонарик. */
  lightOn: boolean;
  /** Идёт ли человек. */
  moving: boolean;
  /** Последнее событие напугало (взмах, крик, удар). */
  scared: boolean;
}

export class Pulse {
  private stress = 0.35;

  update(dt: number, ctx: PulseContext): number {
    let target = 0.3;
    if (!ctx.lightOn) target += 0.25;
    if (ctx.moving) target += 0.12;
    if (ctx.scared) target += 0.4;
    target = Math.min(1, target);

    // стресс растёт втрое быстрее, чем спадает: так и ощущается испуг
    const rate = target > this.stress ? 0.9 : 0.28;
    this.stress += (target - this.stress) * Math.min(1, dt * rate);

    return this.bpm;
  }

  scare(): void {
    this.stress = Math.min(1, this.stress + 0.35);
  }

  get bpm(): number {
    return Math.round(65 + 70 * this.stress);
  }

  get level(): number {
    return this.stress;
  }
}
