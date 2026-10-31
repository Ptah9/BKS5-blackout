/**
 * Кадровый цикл: фиксированный шаг симуляции, свободная частота отрисовки.
 *
 * Зачем фиксированный шаг: физика и коллизии должны вести себя одинаково
 * на 60 и на 144 Гц. Зачем ограничение dt: после сворачивания вкладки браузер
 * отдаёт один огромный кадр, и без зажима игрок телепортируется сквозь стены.
 */

const STEP = 1 / 60;
const MAX_FRAME = 0.1;
const MAX_STEPS_PER_FRAME = 5;

export interface LoopHandle {
  stop(): void;
  /** Средняя частота кадров за последнюю секунду — для панели отладки. */
  fps(): number;
}

export function startLoop(
  update: (dt: number) => void,
  render: (alpha: number, elapsed: number) => void,
): LoopHandle {
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let elapsed = 0;

  let frames = 0;
  let fpsAt = performance.now();
  let currentFps = 0;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);

    const dt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    elapsed += dt;

    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    // Если не успели — не копим долг, иначе цикл никогда не догонит
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;

    render(acc / STEP, elapsed);

    frames++;
    if (now - fpsAt >= 500) {
      currentFps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
    }
  };

  raf = requestAnimationFrame(frame);

  return {
    stop: () => cancelAnimationFrame(raf),
    fps: () => currentFps,
  };
}
