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

/** Форточка в верхней части дверного стекла: вырез, рама и откидная створка. */
const VENT_TOP = 1.93;
const VENT_BOTTOM = 1.63;
const VENT_HALF_W = 0.3;
/** Насколько откидывается створка, рад (≈54°). */
const VENT_ANGLE = 0.95;

/** Дверь кабины: проём 0.86 × 2.05 в торце вагона; сама створка — боковая, в cab.ts. */
const CAB_DOOR_HALF = 0.43;
const CAB_DOOR_HEIGHT = 2.05;
/** Полный ход створки, рад (≈100°). */
const CAB_DOOR_ANGLE = 1.75;

interface VentState {
  /** Точка подвеса створки: верхняя кромка. */
  pivot: THREE.Group;
  /** Борт: +1 правый, −1 левый. Створка откидывается наружу. */
  side: number;
  /** 0 закрыто … 1 открыто. */
  value: number;
  target: number;
}

/** Все построенные створки: setVentOpen переключает их разом. */
const vents: VentState[] = [];
let ventTween: number | null = null;
let ventLast = 0;

/**
 * Открыть/закрыть форточки во всех дверях. Флаг `window_open` приходит
 * с сервера; вызов идемпотентный — повторять каждый кадр безопасно.
 * Створка откидывается за 0.45 с.
 */
export function setVentOpen(open: boolean): void {
  if (vents.length === 0) return;
  for (const vent of vents) vent.target = open ? 1 : 0;
  if (ventTween === null) ventTween = requestAnimationFrame(stepVents);
}

function stepVents(time: number): void {
  const dt = ventLast ? Math.min(0.1, (time - ventLast) / 1000) : 0.016;
  ventLast = time;

  let moving = false;
  for (const vent of vents) {
    const step = dt / 0.45;
    if (vent.value !== vent.target) {
      vent.value =
        vent.value < vent.target
          ? Math.min(vent.target, vent.value + step)
          : Math.max(vent.target, vent.value - step);
    }
    if (vent.value !== vent.target) moving = true;
    const k = vent.value * vent.value * (3 - 2 * vent.value);
    // внутрь салона: наружу створка упиралась в полотно двери
    vent.pivot.rotation.z = -vent.side * VENT_ANGLE * k;
  }

  // выгруженный чанк уносит свои створки с собой: не держим мёртвые ссылки
  for (let i = vents.length - 1; i >= 0; i--) {
    if (!vents[i].pivot.parent) vents.splice(i, 1);
  }

  if (moving) {
    ventTween = requestAnimationFrame(stepVents);
  } else {
    ventTween = null;
    ventLast = 0;
  }
}

/* ─────────────────────────── дверь кабины ─────────────────────────── */

const cabDoor = { value: 0, target: 0 };
const cabDoorPivots: Array<{ pivot: THREE.Group; sign: number }> = [];
let cabDoorBox: Box2 | null = null;
let cabDoorTween: number | null = null;
let cabDoorLast = 0;

/** Колодка проёма: пока дверь закрыта, она перекрывает проход. */
const CAB_DOOR_BLOCK = {
  minX: -CAB_DOOR_HALF - 0.03,
  maxX: CAB_DOOR_HALF + 0.03,
  minZ: -10.16,
  maxZ: -9.84,
};

function applyCabDoor(): void {
  for (let i = cabDoorPivots.length - 1; i >= 0; i--) {
    if (!cabDoorPivots[i].pivot.parent) cabDoorPivots.splice(i, 1);
  }
  for (const entry of cabDoorPivots) {
    entry.pivot.rotation.y = cabDoor.value * CAB_DOOR_ANGLE * entry.sign;
  }

  const box = cabDoorBox;
  if (!box) return;
  if (cabDoor.value > 0.9) {
    // уводим колодку далеко: resolveCircle считает нулевой прямоугольник
    // линией и всё равно не пускал бы
    box.minX = 0;
    box.maxX = 0;
    box.minZ = 500;
    box.maxZ = 500;
  } else {
    box.minX = CAB_DOOR_BLOCK.minX;
    box.maxX = CAB_DOOR_BLOCK.maxX;
    box.minZ = CAB_DOOR_BLOCK.minZ;
    box.maxZ = CAB_DOOR_BLOCK.maxZ;
  }
}

/** Живая створка двери из вагона — первая зарегистрированная. */
export function cabDoorLeaf(): THREE.Group | null {
  return cabDoorPivots[0]?.pivot ?? null;
}

/** Створки кабины (из вагона и боковая) крутятся по одному флагу cab_open. */
export function registerCabDoorPivot(pivot: THREE.Group | null, sign = 1): void {
  if (!pivot) return;
  cabDoorPivots.push({ pivot, sign });
  applyCabDoor();
}

/** Открыть/закрыть дверь кабины по флагу `cab_open`. Идемпотентно. */
export function setCabDoorOpen(open: boolean): void {
  cabDoor.target = open ? 1 : 0;
  if (cabDoorTween === null) cabDoorTween = requestAnimationFrame(stepCabDoor);
}

function stepCabDoor(time: number): void {
  const dt = cabDoorLast ? Math.min(0.1, (time - cabDoorLast) / 1000) : 0.016;
  cabDoorLast = time;

  const step = dt / 0.7;
  if (cabDoor.value !== cabDoor.target) {
    cabDoor.value =
      cabDoor.value < cabDoor.target
        ? Math.min(cabDoor.target, cabDoor.value + step)
        : Math.max(cabDoor.target, cabDoor.value - step);
  }
  applyCabDoor();

  if (cabDoor.value !== cabDoor.target) {
    cabDoorTween = requestAnimationFrame(stepCabDoor);
  } else {
    cabDoorTween = null;
    cabDoorLast = 0;
  }
}

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
    /** Форточка: светлый металл, чтобы её было видно в темноте. */
    vent: new THREE.MeshStandardMaterial({ color: 0xc7ced3, roughness: 0.45, metalness: 0.5 }),
    cabDoor: new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.5, metalness: 0.25 }),
    /** Ночной тоннель за форточкой: почти чёрная плоскость без бликов. */
    night: new THREE.MeshBasicMaterial({ color: 0x04060a }),
    ventGlass: new THREE.MeshStandardMaterial({
      color: 0x40525e,
      roughness: 0.12,
      metalness: 0.7,
      transparent: true,
      opacity: 0.55,
    }),
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
    vent: [],
    // стекло створки — отдельный меш, не инстанс: бакет только для типа
    ventGlass: [],
    // створка двери кабины — отдельный меш, бакет только для типа
    cabDoor: [],
    night: [],
  };

  const colliders: Box2[] = [];

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
      // проём в кабину 0.86 × 2.05: две части стены и перемычка сверху
      const sideWidth = CAR_HALF_WIDTH - CAB_DOOR_HALF;
      push('panel', -(CAR_HALF_WIDTH + CAB_DOOR_HALF) / 2, CAR_HEIGHT / 2, z, sideWidth, CAR_HEIGHT, 0.08);
      push('panel', (CAR_HALF_WIDTH + CAB_DOOR_HALF) / 2, CAR_HEIGHT / 2, z, sideWidth, CAR_HEIGHT, 0.08);
      push('panel', 0, (CAB_DOOR_HEIGHT + CAR_HEIGHT) / 2, z, CAB_DOOR_HALF * 2, CAR_HEIGHT - CAB_DOOR_HEIGHT, 0.08);

      // наличник проёма со стороны вагона
      for (const dir of [-1, 1] as const) {
        buckets.chrome.push({
          x: dir * (CAB_DOOR_HALF + 0.025),
          y: CAB_DOOR_HEIGHT / 2,
          z: z + 0.06,
          sx: 0.05,
          sy: CAB_DOOR_HEIGHT,
          sz: 0.05,
        });
      }
      buckets.chrome.push({
        x: 0,
        y: CAB_DOOR_HEIGHT + 0.025,
        z: z + 0.06,
        sx: CAB_DOOR_HALF * 2 + 0.1,
        sy: 0.05,
        sz: 0.05,
      });

      // створка двери из вагона в кабину: на петлях у левого края проёма,
      // открывается внутрь кабины по флагу cab_open
      if (z >= zFrom && z < zTo) {
        const pivot = new THREE.Group();
        pivot.name = 'cabBackDoor';
        pivot.position.set(-CAB_DOOR_HALF, 0, z + 0.08);

        const leaf = new THREE.Mesh(
          new THREE.BoxGeometry(CAB_DOOR_HALF * 2, CAB_DOOR_HEIGHT, 0.045),
          materials.cabDoor,
        );
        leaf.position.set(CAB_DOOR_HALF, CAB_DOOR_HEIGHT / 2, 0);
        leaf.castShadow = true;

        const window = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.01), materials.glass);
        window.position.set(CAB_DOOR_HALF, 1.5, -0.028);

        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), materials.chrome);
        handle.rotation.x = Math.PI / 2;
        handle.position.set(CAB_DOOR_HALF * 2 - 0.1, 1.02, -0.05);

        pivot.add(leaf, window, handle);
        group.add(pivot);
        registerCabDoorPivot(pivot, 1);

        // пока створка закрыта, проём перекрыт
        const box: Box2 = { ...CAB_DOOR_BLOCK };
        colliders.push(box);
        cabDoorBox = box;
        applyCabDoor();
      }

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

    // двери: жёлтые створки, тоже с зазором от панели.
    // Стекло двери не цельное: в верхней части вырез под форточку, иначе
    // открытая створка ничего не открывала бы.
    for (const z of DOORS) {
      push('door', x - side * 0.07, 1.05, z, 0.05, 2.1, DOOR_WIDTH);

      const glassX = x - side * 0.105;
      const glassBottom = 1.125;
      const glassTop = 1.975;
      const halfGlass = 0.45;

      push('glass', glassX, (glassBottom + VENT_BOTTOM) / 2, z, 0.02, VENT_BOTTOM - glassBottom, halfGlass * 2);
      push('glass', glassX, (VENT_TOP + glassTop) / 2, z, 0.02, glassTop - VENT_TOP, halfGlass * 2);
      for (const dir of [-1, 1] as const) {
        push(
          'glass',
          glassX,
          (VENT_TOP + VENT_BOTTOM) / 2,
          z + dir * (VENT_HALF_W + (halfGlass - VENT_HALF_W) / 2),
          0.02,
          VENT_TOP - VENT_BOTTOM,
          halfGlass - VENT_HALF_W,
        );
      }

      // форточка строится в том чанке, которому принадлежит центр двери:
      // створка поворачивается цельным мешком, резать её по шву нельзя
      if (z >= zFrom && z < zTo) {
        const frameX = glassX - side * 0.012;
        const height = VENT_TOP - VENT_BOTTOM;

        // рама: две планки по z и две по y
        buckets.vent.push({ x: frameX, y: VENT_TOP + 0.015, z, sx: 0.035, sy: 0.03, sz: VENT_HALF_W * 2 + 0.1 });
        buckets.vent.push({ x: frameX, y: VENT_BOTTOM - 0.015, z, sx: 0.035, sy: 0.03, sz: VENT_HALF_W * 2 + 0.1 });
        for (const dir of [-1, 1] as const) {
          buckets.vent.push({
            x: frameX,
            y: (VENT_TOP + VENT_BOTTOM) / 2,
            z: z + dir * (VENT_HALF_W + 0.02),
            sx: 0.035,
            sy: height,
            sz: 0.03,
          });
        }

        // створка: подвес на верхней кромке, откидывается наружу
        const pivot = new THREE.Group();
        pivot.name = 'vent';
        pivot.position.set(frameX - side * 0.03, VENT_TOP, z);

        const sashH = height - 0.02;
        const sashW = VENT_HALF_W * 2 - 0.01;
        const sashFrame = new THREE.Mesh(new THREE.BoxGeometry(0.03, sashH, sashW), materials.vent);
        sashFrame.position.set(0, -sashH / 2, 0);
        const sashPane = new THREE.Mesh(
          new THREE.BoxGeometry(0.01, sashH - 0.05, sashW - 0.05),
          materials.ventGlass,
        );
        sashPane.position.set(-side * 0.022, -sashH / 2, 0);
        pivot.add(sashFrame, sashPane);

        // За проёмом — темнота: иначе в открытой створке видно жёлтое полотно
        // двери. Плоскость на 1.5 см позади стекла, между стеклом (1.285)
        // и полотном (1.320); пока створка закрыта, её закрывает само стекло.
        const night = new THREE.Mesh(
          new THREE.PlaneGeometry(VENT_HALF_W * 2 - 0.02, height - 0.02),
          materials.night,
        );
        night.name = 'ventNight';
        night.position.set(glassX - side * 0.015, (VENT_TOP + VENT_BOTTOM) / 2, z);
        night.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(night);

        group.add(pivot);
        vents.push({ pivot, side, value: 0, target: 0 });
      }
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
    ['vent', buildInstanced(buckets.vent, materials.vent)],
  ];

  const lamps: THREE.Object3D[] = [];
  for (const [name, mesh] of meshes) {
    if (!mesh) continue;
    // рама форточки — инстансы, створки — отдельные группы с тем же именем
    mesh.name = name === 'vent' ? 'ventFrames' : name;
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
  for (const [runFrom, runTo] of SEAT_RUNS) {
    const from = Math.max(runFrom, zFrom);
    const to = Math.min(runTo, zTo);
    if (to - from < 0.05) continue;
    colliders.push({ minX: -CAR_HALF_WIDTH, maxX: -0.7, minZ: from, maxZ: to });
    colliders.push({ minX: 0.7, maxX: CAR_HALF_WIDTH, minZ: from, maxZ: to });
  }

  group.userData.seatCount = seatCount;
  // для отладки и предпросмотра: можно дёрнуть прямо из консоли
  group.userData.ventCount = vents.filter((v) => v.pivot.parent === group).length;
  group.userData.setVentOpen = setVentOpen;

  return { group, colliders, phones, lamps };
}
