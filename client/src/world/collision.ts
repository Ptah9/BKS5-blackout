/**
 * Коллизии: круг (игрок) против прямоугольников в плоскости XZ.
 *
 * Полноценная физика тут не нужна: персонаж ходит, не прыгает, мир состоит
 * из коробок. Двумерная проверка дешевле и предсказуемее — сквозь стену
 * не провалиться даже на низком fps.
 */

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const EPS = 1e-6;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Выталкивает круг из пересечений с коробками.
 * Возвращает скорректированные координаты — исходные не меняются.
 */
export function resolveCircle(
  boxes: readonly Box2[],
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } {
  let px = x;
  let pz = z;

  for (const box of boxes) {
    const nearestX = clamp(px, box.minX, box.maxX);
    const nearestZ = clamp(pz, box.minZ, box.maxZ);

    const dx = px - nearestX;
    const dz = pz - nearestZ;
    const dist2 = dx * dx + dz * dz;

    if (dist2 > radius * radius) continue;

    if (dist2 > EPS) {
      // центр снаружи: выталкиваем по нормали от ближайшей точки
      const dist = Math.sqrt(dist2);
      const push = (radius - dist) / dist;
      px += dx * push;
      pz += dz * push;
      continue;
    }

    // центр внутри коробки: выдавливаем через ближайшую грань
    const toMinX = px - box.minX;
    const toMaxX = box.maxX - px;
    const toMinZ = pz - box.minZ;
    const toMaxZ = box.maxZ - pz;
    const smallest = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);

    if (smallest === toMinX) px = box.minX - radius;
    else if (smallest === toMaxX) px = box.maxX + radius;
    else if (smallest === toMinZ) pz = box.minZ - radius;
    else pz = box.maxZ + radius;
  }

  return { x: px, z: pz };
}

/** Держит точку внутри прямоугольной области (границы мира). */
export function clampToBounds(bounds: Bounds, x: number, z: number, margin: number): { x: number; z: number } {
  return {
    x: clamp(x, bounds.minX + margin, bounds.maxX - margin),
    z: clamp(z, bounds.minZ + margin, bounds.maxZ - margin),
  };
}
