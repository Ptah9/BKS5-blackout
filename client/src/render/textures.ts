/**
 * Процедурные текстуры 256×256 и дешёвое окружение для металла.
 *
 * Палитра снята с фотографий вагона 81-740 «Русич»: кремовые панели,
 * коричневая ткань сидений, серо-зелёный пол, жёлтые двери.
 *
 * Никаких файлов с картинками: на хакатоне это экономит время и гарантирует,
 * что в офлайне нечего докачивать. Все текстуры детерминированные.
 */

import * as THREE from 'three';

const SIZE = 256;

/** Детерминированный ПСЧ (mulberry32): воспроизводимые текстуры. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTexture(
  seed: number,
  draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void,
  width = SIZE,
  height = SIZE,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('не удалось получить 2d-контекст для текстуры');
  draw(ctx, mulberry32(seed));

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  return tex;
}

export interface Textures {
  panel: THREE.CanvasTexture;
  fabric: THREE.CanvasTexture;
  floor: THREE.CanvasTexture;
  metal: THREE.CanvasTexture;
  ceiling: THREE.CanvasTexture;
}

export function createTextures(): Textures {
  // кремовая панель обшивки: вертикальные швы каждые полметра и лёгкая неоднородность
  const panel = makeTexture(1, (ctx, rnd) => {
    ctx.fillStyle = '#ebe7db';
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = '#d8d3c4';
    for (let x = 0; x < SIZE; x += 64) ctx.fillRect(x, 0, 2, SIZE);

    for (let i = 0; i < 620; i++) {
      const v = 225 + Math.floor(rnd() * 18);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 14})`;
      ctx.fillRect(Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), 2, 2);
    }
  });

  // коричневая ткань подушек
  const fabric = makeTexture(2, (ctx, rnd) => {
    ctx.fillStyle = '#6b4a38';
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#4a3026';
    for (let y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 1);
    ctx.globalAlpha = 1;

    for (let i = 0; i < 1500; i++) {
      const dark = rnd() > 0.5;
      ctx.fillStyle = dark ? '#5d4030' : '#77543f';
      ctx.fillRect(Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), 2, 2);
    }
  });

  // серо-зелёный пол с крапинами
  const floor = makeTexture(3, (ctx, rnd) => {
    ctx.fillStyle = '#8b9285';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let i = 0; i < 2600; i++) {
      const v = 118 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(${v},${v + 6},${v - 4})`;
      ctx.fillRect(Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), 2, 2);
    }
  });

  const metal = makeTexture(4, (ctx, rnd) => {
    ctx.fillStyle = '#a9b0b8';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let x = 0; x < SIZE; x++) {
      const a = 0.05 + rnd() * 0.09;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.fillRect(x, 0, 1, SIZE);
    }
  });

  // потолок: светлее стен, с еле заметными стыками панелей
  const ceiling = makeTexture(5, (ctx, rnd) => {
    ctx.fillStyle = '#f1efe7';
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = '#e2dfd4';
    for (let y = 0; y < SIZE; y += 128) ctx.fillRect(0, y, SIZE, 2);

    for (let i = 0; i < 300; i++) {
      const v = 232 + Math.floor(rnd() * 16);
      ctx.fillStyle = `rgb(${v},${v},${v - 6})`;
      ctx.fillRect(Math.floor(rnd() * SIZE), Math.floor(rnd() * SIZE), 2, 2);
    }
  });

  return { panel, fabric, floor, metal, ceiling };
}

/**
 * Окружение для хрома. Без него металл в Three.js выглядит серой пластмассой.
 * Настоящий cubemap не нужен: шесть градиентных квадратов дают блик,
 * которого достаточно на низком разрешении.
 */
export function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const face = (top: string, bottom: string): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('нет 2d-контекста для окружения');
    const gradient = ctx.createLinearGradient(0, 0, 0, 16);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    return canvas;
  };

  const side = face('#0a0d12', '#1a2028');
  const up = face('#161b22', '#0e1216');
  const down = face('#1c2128', '#0b0e12');

  // порядок граней: +X, -X, +Y, -Y, +Z, -Z
  const cube = new THREE.CubeTexture([side, side, up, down, side, side]);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(cube).texture;
  pmrem.dispose();
  cube.dispose();

  return env;
}
