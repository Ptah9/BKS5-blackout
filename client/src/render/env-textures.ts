/**
 * Текстуры окружения: бетон, балласт, кирпич, мел, нескользящий пол кабины,
 * плитка платформы. Отдельным модулем, а не в `textures.ts`, по одной причине:
 * `createTextures()` считает вес текстур в панели «память» по всем своим полям
 * (`measureTextures` в chunks.ts). Текстуры тоннеля к вагону не относятся
 * и не должны попадать в эту цифру.
 *
 * Все картинки процедурные и детерминированные — как и вагонные.
 */

import * as THREE from 'three';

import { makeTexture } from './textures';

export interface EnvTextures {
  /** Серый бетон тюбингов: пятна, потёки, швы опалубки. */
  concrete: THREE.CanvasTexture;
  /** Тёмный гравий под шпалами. */
  ballast: THREE.CanvasTexture;
  /** Кирпичная кладка замурованного прохода. */
  brick: THREE.CanvasTexture;
  /** Мелом «выход» со стрелкой — прозрачная наклейка. */
  chalkExit: THREE.CanvasTexture;
  /** Мелом нарисованные окна — прозрачная наклейка. */
  chalkWindows: THREE.CanvasTexture;
  /** Рифлёный стальной пол кабины. */
  plate: THREE.CanvasTexture;
  /** Светло-зелёная краска стен кабины с потёртостями. */
  cabPaint: THREE.CanvasTexture;
  /** Тёмная виниловая обивка кресла. */
  vinyl: THREE.CanvasTexture;
  /** Белая глазурованная плитка станции. */
  faience: THREE.CanvasTexture;
  /** Серый гранит платформы. */
  granite: THREE.CanvasTexture;
  /** Табло «К ВЫХОДУ» с облупленной краской. */
  sign: THREE.CanvasTexture;
}

let cached: EnvTextures | null = null;

/**
 * Один комплект на всю страницу: локации строятся один раз, а клоны под
 * повторение текстуры (`tiled`) живут уже внутри материалов конкретной локации.
 */
export function envTextures(): EnvTextures {
  cached ??= createEnvTextures();
  return cached;
}

function createEnvTextures(): EnvTextures {
  // ── бетон тюбингов ───────────────────────────────────────────────────
  // Кольца метро корявые: пятна затирки, тёмные потёки сверху вниз, шов
  // опалубки. Без этого цилиндр тоннеля читается как серая труба.
  const concrete = makeTexture(11, (ctx, rnd) => {
    ctx.fillStyle = '#74777b';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 70; i++) {
      const v = 96 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},${(0.06 + rnd() * 0.12).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, rnd() * 256, 12 + rnd() * 40, 8 + rnd() * 26, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // потёки: вертикальные полосы, чуть светлее и темнее основы
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256;
      const dark = rnd() > 0.5;
      ctx.fillStyle = dark ? 'rgba(58,60,64,0.10)' : 'rgba(190,192,196,0.07)';
      ctx.fillRect(x, 0, 1 + rnd() * 4, 256);
    }

    // шов опалубки
    ctx.fillStyle = 'rgba(46,48,52,0.55)';
    ctx.fillRect(0, 0, 256, 2);
    ctx.fillStyle = 'rgba(160,162,166,0.25)';
    ctx.fillRect(0, 2, 256, 1);

    for (let i = 0; i < 2400; i++) {
      const v = 88 + Math.floor(rnd() * 70);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
    }
  });

  // ── балласт ──────────────────────────────────────────────────────────
  const ballast = makeTexture(12, (ctx, rnd) => {
    ctx.fillStyle = '#2f3134';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 900; i++) {
      const v = 52 + Math.floor(rnd() * 46);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 3})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 1 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ── кирпич ───────────────────────────────────────────────────────────
  const brick = makeTexture(13, (ctx, rnd) => {
    ctx.fillStyle = '#8f8a80';
    ctx.fillRect(0, 0, 256, 256);

    const bw = 64;
    const bh = 32;
    for (let row = 0; row < 8; row++) {
      const shift = row % 2 === 0 ? 0 : -bw / 2;
      for (let col = -1; col < 5; col++) {
        const x = col * bw + shift + 3;
        const y = row * bh + 3;
        const warm = 120 + Math.floor(rnd() * 26);
        ctx.fillStyle = `rgb(${warm},${55 + Math.floor(rnd() * 16)},${42 + Math.floor(rnd() * 12)})`;
        ctx.fillRect(x, y, bw - 6, bh - 6);

        // выщербины на кирпиче
        ctx.fillStyle = 'rgba(40,26,20,0.35)';
        for (let k = 0; k < 5; k++) {
          ctx.fillRect(x + rnd() * (bw - 8), y + rnd() * (bh - 8), 2 + rnd() * 5, 2 + rnd() * 3);
        }
      }
    }

    // сырые разводы: кладку замазывали недавно
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(96,94,88,${(0.10 + rnd() * 0.16).toFixed(3)})`;
      ctx.fillRect(rnd() * 256, rnd() * 256, 30 + rnd() * 90, 8 + rnd() * 30);
    }
  });

  // ── мел: «выход» со стрелкой ─────────────────────────────────────────
  // Приём простой: рисуем слово несколько раз с дрожанием и разной
  // прозрачностью, затем выбиваем крошки — получается рука, а не принтер.
  const chalkFont = (px: number): string => `${px}px "Segoe Print", "Comic Sans MS", cursive`;

  const chalk = (
    ctx: CanvasRenderingContext2D,
    rnd: () => number,
    draw: (alpha: number, dx: number, dy: number) => void,
  ): void => {
    for (let pass = 0; pass < 4; pass++) {
      draw(0.16 + rnd() * 0.12, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
    }
    // крошки: там, где мел не прошёл
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${(0.25 + rnd() * 0.5).toFixed(2)})`;
      ctx.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  const chalkExit = makeTexture(
    20,
    (ctx, rnd) => {
      ctx.clearRect(0, 0, 512, 512);
      ctx.fillStyle = '#eae7dc';

      chalk(ctx, rnd, (alpha, dx, dy) => {
        ctx.globalAlpha = alpha;
        ctx.font = chalkFont(150);
        ctx.textBaseline = 'middle';
        ctx.fillText('выход', 40 + dx, 170 + dy);

        // стрелка вправо и вниз: «там проход»
        ctx.lineWidth = 16;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(70 + dx, 350 + dy);
        ctx.lineTo(400 + dx, 350 + dy);
        ctx.moveTo(330 + dx, 295 + dy);
        ctx.lineTo(405 + dx, 352 + dy);
        ctx.lineTo(330 + dx, 408 + dy);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    },
    512,
    512,
  );

  // ── мел: нарисованные окна ───────────────────────────────────────────
  // Их рисуют те, кто очень хочет наружу: два окна, шторки, солнце.
  const chalkWindows = makeTexture(
    21,
    (ctx, rnd) => {
      ctx.clearRect(0, 0, 512, 512);
      ctx.fillStyle = '#eae7dc';
      ctx.lineCap = 'round';

      const frame = (x: number, y: number, w: number, h: number): void => {
        ctx.lineWidth = 9;
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = 6;
        // створки и цветы на подоконнике
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w / 2, y + h);
        ctx.moveTo(x, y + h * 0.62);
        ctx.lineTo(x + w, y + h * 0.62);
        ctx.stroke();
      };

      chalk(ctx, rnd, (alpha, dx, dy) => {
        ctx.globalAlpha = alpha;
        frame(40 + dx, 60 + dy, 150, 190);
        frame(250 + dx, 60 + dy, 150, 190);

        // занавески
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(55 + dx, 75 + dy);
        ctx.quadraticCurveTo(95 + dx, 150 + dy, 62 + dx, 235 + dy);
        ctx.moveTo(385 + dx, 75 + dy);
        ctx.quadraticCurveTo(345 + dx, 150 + dy, 378 + dx, 235 + dy);
        ctx.stroke();

        // солнце в углу
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(430 + dx, 330 + dy, 34, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(430 + dx + Math.cos(a) * 46, 330 + dy + Math.sin(a) * 46);
          ctx.lineTo(430 + dx + Math.cos(a) * 66, 330 + dy + Math.sin(a) * 66);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      });
    },
    512,
    512,
  );

  // ── пол кабины: рифлёный лист ────────────────────────────────────────
  const plate = makeTexture(14, (ctx) => {
    ctx.fillStyle = '#5b5f63';
    ctx.fillRect(0, 0, 256, 256);

    // ромбы противоскольжения в шахматном порядке
    for (let y = 0; y < 256; y += 32) {
      for (let x = 0; x < 256; x += 32) {
        const ox = (y / 32) % 2 === 0 ? 0 : 16;
        ctx.save();
        ctx.translate(x + ox, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(158,164,170,0.55)';
        ctx.fillRect(-5, -2, 10, 4);
        ctx.fillStyle = 'rgba(30,32,34,0.45)';
        ctx.fillRect(-5, 2, 10, 2);
        ctx.restore();
      }
    }
  });

  // ── краска стен кабины ───────────────────────────────────────────────
  const cabPaint = makeTexture(15, (ctx, rnd) => {
    ctx.fillStyle = '#b9c0b3';
    ctx.fillRect(0, 0, 256, 256);

    // выцветшие разводы
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${170 + Math.floor(rnd() * 30)},${176 + Math.floor(rnd() * 26)},${164 + Math.floor(rnd() * 26)},0.35)`;
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, rnd() * 256, 20 + rnd() * 50, 10 + rnd() * 40, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // потёртости: светлые штрихи и тёмные царапины
    for (let i = 0; i < 90; i++) {
      const dark = rnd() > 0.6;
      ctx.strokeStyle = dark ? 'rgba(84,90,80,0.35)' : 'rgba(226,230,220,0.35)';
      ctx.lineWidth = rnd() > 0.8 ? 2 : 1;
      const x = rnd() * 256;
      const y = rnd() * 256;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 12);
      ctx.stroke();
    }
  });

  // ── винил кресла ─────────────────────────────────────────────────────
  const vinyl = makeTexture(16, (ctx, rnd) => {
    ctx.fillStyle = '#4a5462';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 5000; i++) {
      const v = 58 + Math.floor(rnd() * 26);
      ctx.fillStyle = `rgba(${v},${v + 6},${v + 14},0.5)`;
      ctx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), 2, 2);
    }

    // заломы, как на старом дерматине
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = 'rgba(140,148,162,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rnd() * 256, rnd() * 256);
      ctx.bezierCurveTo(rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256, rnd() * 256);
      ctx.stroke();
    }
  });

  // ── белая плитка станции ─────────────────────────────────────────────
  const faience = makeTexture(17, (ctx, rnd) => {
    ctx.fillStyle = '#b6bab2';
    ctx.fillRect(0, 0, 256, 256);

    const t = 32;
    for (let y = 0; y < 256; y += t) {
      for (let x = 0; x < 256; x += t) {
        const v = 218 + Math.floor(rnd() * 14);
        ctx.fillStyle = `rgb(${v},${v + 1},${v - 4})`;
        ctx.fillRect(x + 1, y + 1, t - 2, t - 2);
        // лёгкий блик по верхнему краю плитки — глазурь
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x + 1, y + 1, t - 2, 2);
      }
    }
  });

  // ── гранит платформы ─────────────────────────────────────────────────
  // Шахматка из двух близких серых: в текстуре 2×2 плиты, поэтому повтор
  // на полу задаётся вдвое реже, чем шаг плитки.
  const granite = makeTexture(18, (ctx, rnd) => {
    ctx.fillStyle = '#7f8388';
    ctx.fillRect(0, 0, 256, 256);

    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        if ((tx + ty) % 2 === 0) continue;
        ctx.fillStyle = '#8f9398';
        ctx.fillRect(tx * 128, ty * 128, 128, 128);
      }
    }

    for (let i = 0; i < 5200; i++) {
      const dark = rnd() > 0.55;
      const v = dark ? 40 + Math.floor(rnd() * 40) : 170 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(Math.floor(rnd() * 256), Math.floor(rnd() * 256), rnd() > 0.7 ? 2 : 1, rnd() > 0.7 ? 2 : 1);
    }

    // швы плит
    ctx.fillStyle = 'rgba(52,54,56,0.5)';
    ctx.fillRect(0, 0, 256, 2);
    ctx.fillRect(0, 0, 2, 256);
    ctx.fillRect(0, 128, 256, 2);
    ctx.fillRect(128, 0, 2, 256);
  });

  // ── табло «К ВЫХОДУ» ─────────────────────────────────────────────────
  const sign = makeTexture(
    19,
    (ctx, rnd) => {
      ctx.fillStyle = '#1d2f4c';
      ctx.fillRect(0, 0, 512, 160);
      ctx.strokeStyle = '#c8ccd2';
      ctx.lineWidth = 4;
      ctx.strokeRect(6, 6, 500, 148);

      ctx.fillStyle = '#e6e8e4';
      ctx.font = 'bold 82px "Arial Narrow", Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('К ВЫХОДУ', 46, 84);

      // стрелка
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(400, 84);
      ctx.lineTo(462, 84);
      ctx.moveTo(436, 58);
      ctx.lineTo(466, 84);
      ctx.lineTo(436, 110);
      ctx.stroke();

      // облупленная краска: прорехи в эмали
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(0,0,0,${(0.3 + rnd() * 0.6).toFixed(2)})`;
        ctx.beginPath();
        ctx.ellipse(rnd() * 512, rnd() * 160, 2 + rnd() * 12, 1 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    512,
    160,
  );

  return {
    concrete,
    ballast,
    brick,
    chalkExit,
    chalkWindows,
    plate,
    cabPaint,
    vinyl,
    faience,
    granite,
    sign,
  };
}
