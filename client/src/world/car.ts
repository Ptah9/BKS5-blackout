/**
 * Вагон метро 81-740 «Русич» — процедурная геометрия по фотографиям.
 *
 * Габарит: 2.7 × 2.4 × 20 м, пол на y = 0, глаза игрока — 1.6 м.
 *
 * Из фотографий взято: кремовые панели со швами, коричневые подушки и спинки
 * с кремовой окантовкой, жёлтые двери с окнами, серо-зелёный пол, две продольные
 * линии ламп вдоль потолка, хромированные поручни у сидений и торцевая дверь
 * с двумя окнами.
 *
 * Все коробки одного материала собираются в один InstancedMesh: вагон целиком
 * укладывается в десяток draw calls вместо сотни.
 */

import * as THREE from 'three';

import type { Box2 } from './collision';
import type { Textures } from '../render/textures';

export const CAR_HALF_WIDTH = 1.35;
export const CAR_HEIGHT = 2.4;
export const CAR_HALF_LENGTH = 10;

/** Двери: три проёма на борт, как у «Русича». */
const DOORS = [-6.6, 0, 6.6];
const DOOR_WIDTH = 1.5;

/** Сиденья заполняют промежутки между дверями и торцами. */
const SEAT_RUNS: ReadonlyArray<readonly [number, number]> = [
  [-9.9, -7.5],
  [-5.7, -0.8],
  [0.8, 5.7],
  [7.5, 9.9],
];

const WINDOW_CENTERS = [-8.7, -4.4, -2.2, 2.2, 4.4, 8.7];
const WINDOW_W = 1.9;
const WINDOW_H = 1.0;
const WINDOW_Y = 1.62;

const SEAT_PITCH = 0.58;

export interface CarBuild {
  group: THREE.Group;
  colliders: Box2[];
  /** Куда ставить «экраны телефонов» — их свет и есть главный источник в вагоне. */
  phones: THREE.Vector3[];
  /** Потолочные светильники: погашены, но по сценарию включаются. */
  lamps: THREE.Object3D[];
}

interface BoxInstance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
}

function tiled(texture: THREE.Texture, repeatX: number, repeatY: number): THREE.Texture {
  const tex = texture.clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

function buildInstanced(
  boxes: readonly BoxInstance[],
  material: THREE.Material,
  options: { cast?: boolean; receive?: boolean } = {},
): THREE.InstancedMesh | null {
  if (boxes.length === 0) return null;

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, boxes.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  boxes.forEach((b, i) => {
    position.set(b.x, b.y, b.z);
    scale.set(b.sx, b.sy, b.sz);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = options.cast ?? false;
  mesh.receiveShadow = options.receive ?? false;
  return mesh;
}

export function buildCar(
  tex: Textures,
  zFrom = -CAR_HALF_LENGTH - 0.1,
  zTo = CAR_HALF_LENGTH + 0.1,
): CarBuild {
  const group = new THREE.Group();
  group.name = 'car';

  const materials = {
    panel: new THREE.MeshStandardMaterial({ map: tiled(tex.panel, 4, 1), roughness: 0.75, metalness: 0.02 }),
    ceiling: new THREE.MeshStandardMaterial({ map: tiled(tex.ceiling, 3, 6), roughness: 0.85 }),
    seat: new THREE.MeshStandardMaterial({ map: tiled(tex.fabric, 1, 1), roughness: 0.95 }),
    floor: new THREE.MeshStandardMaterial({ map: tiled(tex.floor, 3, 12), roughness: 0.85 }),
    chrome: new THREE.MeshStandardMaterial({ map: tiled(tex.metal, 1, 1), roughness: 0.25, metalness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x090c10,
      roughness: 0.06,
      metalness: 0.85,
      transparent: true,
      opacity: 0.72,
    }),
    door: new THREE.MeshStandardMaterial({ color: 0xe3b81c, roughness: 0.55, metalness: 0.15 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xd9d6cb, emissive: 0x000000, roughness: 0.5 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0d1014, emissive: 0x0a1420, roughness: 0.3 }),
  };

  const buckets: Record<keyof typeof materials, BoxInstance[]> = {
    panel: [],
    ceiling: [],
    seat: [],
    floor: [],
    chrome: [],
    glass: [],
    door: [],
    lamp: [],
    screen: [],
  };

  const push = (
    bucket: keyof typeof materials,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): void => {
    // коробка обрезается по границам чанка: деталь на стыке попадает
    // в оба куска, а не исчезает на шве
    const from = Math.max(z - sz / 2, zFrom);
    const to = Math.min(z + sz / 2, zTo);
    if (to - from < 1e-4) return;
    buckets[bucket].push({ x, y, z: (from + to) / 2, sx, sy, sz: to - from });
  };

  // ── корпус ────────────────────────────────────────────────────────────
  push('floor', 0, -0.04, 0, 2.7, 0.08, 20);
  push('ceiling', 0, CAR_HEIGHT + 0.04, 0, 2.7, 0.08, 20);

  // торцевые стены с дверью и двумя окнами
  for (const zEnd of [-1, 1] as const) {
    const z = zEnd * (CAR_HALF_LENGTH + 0.04);

    if (zEnd === -1) {
      // впереди не стена, а проём в кабину: две части стены и перемычка сверху.
      // Сама дверь — отдельный объект, её открывает сценарий.
      push('panel', -0.95, CAR_HEIGHT / 2, z, 0.8, CAR_HEIGHT, 0.08);
      push('panel', 0.95, CAR_HEIGHT / 2, z, 0.8, CAR_HEIGHT, 0.08);
      push('panel', 0, CAR_HEIGHT - 0.2, z, 1.1, 0.4, 0.08);
      continue;
    }

    push('panel', 0, CAR_HEIGHT / 2, z, 2.7, CAR_HEIGHT, 0.08);
    // дверь в следующий вагон: сдвинута от стены на 12 см, иначе грани совпадают
    // и получается z-fighting (шахматка на двери)
    push('panel', 0, 0.95, z - zEnd * 0.12, 0.86, 1.9, 0.06);
    push('glass', 0, 1.45, z - zEnd * 0.155, 0.34, 0.5, 0.02);
    // окна по бокам от двери
    for (const x of [-0.85, 0.85]) {
      push('glass', x, 1.55, z - zEnd * 0.06, 0.55, 0.7, 0.02);
    }
  }


  // ── борта ─────────────────────────────────────────────────────────────
  for (const side of [-1, 1] as const) {
    const x = side * (CAR_HALF_WIDTH + 0.04);

    push('panel', x, 0.56, 0, 0.08, 1.12, 20); // подоконная часть
    push('panel', x, 1.62, 0, 0.08, 1.0, 20); // полоса окон
    push('panel', x, 2.26, 0, 0.08, 0.28, 20); // над окнами

    // окна: тёмные стёкла стоят ПЕРЕД стеной с зазором 1 см.
    // раньше стекло и внутренняя грань панели были в одной плоскости — z-fighting
    for (const z of WINDOW_CENTERS) {
      push('glass', x - side * 0.06, WINDOW_Y, z, 0.02, WINDOW_H, WINDOW_W);
    }

    // двери: жёлтые створки, тоже с зазором от панели
    for (const z of DOORS) {
      push('door', x - side * 0.07, 1.05, z, 0.05, 2.1, DOOR_WIDTH);
      push('glass', x - side * 0.105, 1.55, z, 0.02, 0.85, 0.9);
    }

    // информационные экраны над сиденьями у дверей
    for (const z of [-2.9, 2.9]) {
      push('screen', x - side * 0.09, 1.95, z, 0.04, 0.2, 0.32);
    }
  }

  // ── сиденья ───────────────────────────────────────────────────────────
  let seatCount = 0;

  for (const side of [-1, 1] as const) {
    for (const [z0, z1] of SEAT_RUNS) {
      const length = z1 - z0;
      const centerZ = (z0 + z1) / 2;

      // кремовая тумба под сиденьями
      push('panel', side * 1.02, 0.22, centerZ, 0.62, 0.44, length);

      const count = Math.floor((length - 0.1) / SEAT_PITCH);
      for (let i = 0; i < count; i++) {
        const z = z0 + SEAT_PITCH / 2 + 0.05 + i * SEAT_PITCH;
        // коричневая подушка
        push('seat', side * 1.0, 0.47, z, 0.52, 0.08, 0.46);
        // коричневая спинка у стены, чуть наклонена вперёд
        push('seat', side * 1.24, 0.98, z, 0.09, 0.55, 0.46);
        seatCount++;
      }

      // хромированный поручень перед сиденьями
      push('chrome', side * 1.06, 1.18, centerZ, 0.04, 0.04, length);
    }
  }

  // ── потолок: две линии светильников и центральная панель ──────────────
  push('ceiling', 0, CAR_HEIGHT - 0.03, 0, 1.15, 0.04, 19.4);
  for (const side of [-1, 1] as const) {
    for (let z = -8.4; z <= 8.4; z += 2.8) {
      push('lamp', side * 0.95, CAR_HEIGHT - 0.06, z, 0.3, 0.05, 2.5);
    }
  }

  const meshes: Array<[keyof typeof materials, THREE.InstancedMesh | null]> = [
    ['floor', buildInstanced(buckets.floor, materials.floor, { receive: true })],
    ['ceiling', buildInstanced(buckets.ceiling, materials.ceiling, { receive: true })],
    ['panel', buildInstanced(buckets.panel, materials.panel, { receive: true })],
    ['seat', buildInstanced(buckets.seat, materials.seat, { cast: true, receive: true })],
    ['chrome', buildInstanced(buckets.chrome, materials.chrome)],
    ['glass', buildInstanced(buckets.glass, materials.glass)],
    ['door', buildInstanced(buckets.door, materials.door, { receive: true })],
    ['lamp', buildInstanced(buckets.lamp, materials.lamp)],
    ['screen', buildInstanced(buckets.screen, materials.screen)],
  ];

  const lamps: THREE.Object3D[] = [];
  for (const [name, mesh] of meshes) {
    if (!mesh) continue;
    mesh.name = name;
    group.add(mesh);
    if (name === 'lamp') lamps.push(mesh);
  }

  // ── поручни ───────────────────────────────────────────────────────────
  // В вагоне их три вида, и все три на фотографии видны:
  //  1) продольный поручень под потолком, на подвесах;
  //  2) стойки от пола до потолка у дверей и на стыках рядов;
  //  3) поручень перед сиденьями на двух коротких стойках.
  for (const side of [-1, 1] as const) {
    push('chrome', side * 0.88, 2.06, 0, 0.04, 0.04, 19); // потолочный, вдоль всего вагона
    for (const [z0, z1] of SEAT_RUNS) {
      push('chrome', side * 1.06, 1.2, (z0 + z1) / 2, 0.04, 0.04, z1 - z0 - 0.3); // перед сиденьями
    }
  }

  interface Tube {
    x: number;
    z: number;
    y0: number;
    y1: number;
  }

  const tubes: Tube[] = [];

  for (const side of [-1, 1] as const) {
    // стойки от пола до потолка
    for (const z of DOORS) tubes.push({ x: side * 0.95, z: z - DOOR_WIDTH / 2 - 0.12, y0: 0, y1: CAR_HEIGHT });
    for (const [z0, z1] of SEAT_RUNS) {
      tubes.push({ x: side * 0.95, z: z0 + 0.14, y0: 0, y1: CAR_HEIGHT });
      tubes.push({ x: side * 0.95, z: z1 - 0.14, y0: 0, y1: CAR_HEIGHT });
    }

    // подвесы потолочного поручня: короткие трубы от него к потолку
    for (let z = -8.4; z <= 8.4; z += 2.4) {
      tubes.push({ x: side * 0.88, z, y0: 2.06, y1: CAR_HEIGHT - 0.02 });
    }

    // короткие стойки поручня перед сиденьями
    for (const [z0, z1] of SEAT_RUNS) {
      tubes.push({ x: side * 1.06, z: z0 + 0.2, y0: 0.42, y1: 1.22 });
      tubes.push({ x: side * 1.06, z: z1 - 0.2, y0: 0.42, y1: 1.22 });
    }
  }

  const tubeGeo = new THREE.CylinderGeometry(0.019, 0.019, 1, 6);
  const visibleTubes = tubes.filter((t) => t.z >= zFrom - 0.4 && t.z <= zTo + 0.4);
  const tubeMesh = new THREE.InstancedMesh(tubeGeo, materials.chrome, Math.max(1, visibleTubes.length));
  const tubeMatrix = new THREE.Matrix4();
  const tubePosition = new THREE.Vector3();
  const tubeScale = new THREE.Vector3();
  const tubeQuaternion = new THREE.Quaternion();

  visibleTubes.forEach((t, i) => {
    const length = t.y1 - t.y0;
    tubePosition.set(t.x, (t.y0 + t.y1) / 2, t.z);
    tubeScale.set(1, length, 1);
    tubeMatrix.compose(tubePosition, tubeQuaternion, tubeScale);
    tubeMesh.setMatrixAt(i, tubeMatrix);
  });
  tubeMesh.count = visibleTubes.length;
  tubeMesh.instanceMatrix.needsUpdate = true;
  tubeMesh.name = 'tubes';
  if (visibleTubes.length > 0) group.add(tubeMesh);

  // ── свет от телефонов пассажиров ──────────────────────────────────────
  // Сами экраны не рисуем: плоские прямоугольники в воздухе выглядели как
  // летающие бумажки. Остался только свет — точки, по которым ставятся лампы.
  const phones: THREE.Vector3[] = [];
  const phoneZ = [-8.3, -7.6, -4.6, -3.4, -2.4, -1.2, 1.2, 2.4, 3.6, 8.1].filter(
    (z) => z >= zFrom && z <= zTo,
  );

  phoneZ.forEach((z, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    phones.push(new THREE.Vector3(side * (CAR_HALF_WIDTH - 0.5), 1.2, z));
  });

  // ── коллизии: сиденья по бортам, обрезанные по границам чанка ─────────
  const colliders: Box2[] = [];
  for (const [runFrom, runTo] of SEAT_RUNS) {
    const from = Math.max(runFrom, zFrom);
    const to = Math.min(runTo, zTo);
    if (to - from < 0.05) continue;
    colliders.push({ minX: -CAR_HALF_WIDTH, maxX: -0.7, minZ: from, maxZ: to });
    colliders.push({ minX: 0.7, maxX: CAR_HALF_WIDTH, minZ: from, maxZ: to });
  }

  group.userData.seatCount = seatCount;

  return { group, colliders, phones, lamps };
}
