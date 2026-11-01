/**
 * Платформа в конце тоннеля — короткий кусок станции за проёмом в левой стене.
 *
 * География простая: тоннель идёт по оси Z, в его левой стене на z ≈ −31
 * проём, за проёмом зал 6,8 × 8,8 м с плиткой, колоннами, лавками и выходом
 * в дальнем торце. Пути здесь нет: платформа примыкает к тоннелю боком,
 * как служебный зал, а не как станция с путём у края.
 *
 * Всё, что за проёмом, лежит в тех же координатах, что и тоннель, — модуль
 * просто продолжает мир влево по X.
 */

import * as THREE from 'three';

import type { Box2 } from './collision';
import type { Textures } from '../render/textures';
import { envTextures } from '../render/env-textures';
import { BoxBatch, TubeBatch, decal, tiled, type LightSpot, type Location } from './location';
import { TUNNEL } from './tunnel';

export const PLATFORM = {
  minX: -9.2,
  maxX: -2.42,
  minZ: -35.4,
  maxZ: -26.6,
  height: 3.4,
} as const;

const WALL = 0.16;
const BACK_X = PLATFORM.minX - WALL;
const Z_MID = (PLATFORM.minZ + PLATFORM.maxZ) / 2;

export function buildPlatform(textures: Textures): Location {
  const env = envTextures();
  const group = new THREE.Group();
  group.name = 'platform';

  /* ── материалы ─────────────────────────────────────────────────────── */

  const granite = new THREE.MeshStandardMaterial({ map: tiled(env.granite, 6.5, 8.5), roughness: 0.62, metalness: 0.05 });
  // плитка 20 см: в текстуре 8 плиток, значит один повтор — 1,6 м
  const faience = new THREE.MeshStandardMaterial({ map: tiled(env.faience, 4.25, 2.1), roughness: 0.45, metalness: 0.02 });
  const columnTile = new THREE.MeshStandardMaterial({ map: tiled(env.faience, 0.33, 2.1), roughness: 0.45 });
  const base = new THREE.MeshStandardMaterial({ color: 0x2f3a34, roughness: 0.55, metalness: 0.1 });
  const cornice = new THREE.MeshStandardMaterial({ map: tiled(env.faience, 4.25, 1), color: 0x7f9ab4, roughness: 0.5 });
  const concrete = new THREE.MeshStandardMaterial({ map: tiled(env.concrete, 2, 2), roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d5238, roughness: 0.88 });
  const castIron = new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.55, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x51565c, roughness: 0.4, metalness: 0.8 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xd6d3c6, emissive: 0x000000, roughness: 0.5 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x8a8270, emissive: 0xd9c9a2, emissiveIntensity: 0.35, roughness: 0.9 });

  /* ── стены, пол, потолок ───────────────────────────────────────────── */

  const floorBox = new BoxBatch(granite);
  floorBox.span(PLATFORM.minX, PLATFORM.maxX, -0.14, 0, PLATFORM.minZ - WALL, PLATFORM.maxZ);

  const faienceBox = new BoxBatch(faience);
  const baseBox = new BoxBatch(base);
  const concreteBox = new BoxBatch(concrete);

  // задняя стена и дальний торец — плитка, как на станции
  faienceBox.span(BACK_X, BACK_X + WALL, 0, PLATFORM.height, PLATFORM.minZ - WALL, PLATFORM.maxZ + WALL);
  faienceBox.span(PLATFORM.minX, PLATFORM.maxX, 0, PLATFORM.height, PLATFORM.maxZ, PLATFORM.maxZ + WALL);

  // тёмный цоколь и синий карниз — станция читается по поясам, а не по цвету
  baseBox.span(BACK_X + WALL, BACK_X + WALL + 0.02, 0, 0.9, PLATFORM.minZ, PLATFORM.maxZ);
  baseBox.span(PLATFORM.minX, PLATFORM.maxX, 0, 0.9, PLATFORM.minZ, PLATFORM.minZ + 0.02);
  baseBox.span(PLATFORM.minX, PLATFORM.maxX, 0, 0.9, PLATFORM.maxZ - 0.02, PLATFORM.maxZ);

  const corniceBox = new BoxBatch(cornice);
  corniceBox.span(BACK_X + WALL, BACK_X + WALL + 0.02, 2.85, 3.05, PLATFORM.minZ, PLATFORM.maxZ);
  corniceBox.span(PLATFORM.minX, PLATFORM.maxX, 2.85, 3.05, PLATFORM.minZ, PLATFORM.minZ + 0.02);
  corniceBox.span(PLATFORM.minX, PLATFORM.maxX, 2.85, 3.05, PLATFORM.maxZ - 0.02, PLATFORM.maxZ);

  // потолок: кессоны полосами, чтобы не было одной серой плиты
  const ceilingBox = new BoxBatch(new THREE.MeshStandardMaterial({ map: tiled(textures.ceiling, 4, 5), roughness: 0.9 }));
  ceilingBox.span(PLATFORM.minX, PLATFORM.maxX, PLATFORM.height, PLATFORM.height + 0.2, PLATFORM.minZ, PLATFORM.maxZ);
  for (let z = PLATFORM.minZ + 1.1; z < PLATFORM.maxZ; z += 2.2) {
    concreteBox.span(PLATFORM.minX, PLATFORM.maxX, PLATFORM.height - 0.12, PLATFORM.height, z - 0.08, z + 0.08);
  }

  // стена со стороны тоннеля: два куска, между ними — арка
  const sideWall = new BoxBatch(faience);
  sideWall.span(PLATFORM.maxX - 0.1, PLATFORM.maxX, 0, PLATFORM.height, PLATFORM.minZ, TUNNEL.arch.z0);
  sideWall.span(PLATFORM.maxX - 0.1, PLATFORM.maxX, 0, PLATFORM.height, TUNNEL.arch.z1, PLATFORM.maxZ);
  sideWall.span(PLATFORM.maxX - 0.1, PLATFORM.maxX, TUNNEL.arch.height, PLATFORM.height, TUNNEL.arch.z0, TUNNEL.arch.z1);
  const sideBase = new BoxBatch(base);
  sideBase.span(PLATFORM.maxX - 0.11, PLATFORM.maxX - 0.09, 0, 0.9, PLATFORM.minZ, TUNNEL.arch.z0);
  sideBase.span(PLATFORM.maxX - 0.11, PLATFORM.maxX - 0.09, 0, 0.9, TUNNEL.arch.z1, PLATFORM.maxZ);

  /* ── колонны ───────────────────────────────────────────────────────── */

  const columnZ = [-34.1, -30.9, -27.7];
  const columnX = -5.0;
  const columnBox = new BoxBatch(columnTile);
  const columnBase = new BoxBatch(base);
  const columnCap = new BoxBatch(cornice);

  for (const z of columnZ) {
    // ствол, база и капитель: три части, как у настоящей станции
    columnBase.span(columnX - 0.32, columnX + 0.32, 0, 0.5, z - 0.32, z + 0.32);
    columnBox.span(columnX - 0.26, columnX + 0.26, 0.5, 2.9, z - 0.26, z + 0.26);
    columnCap.span(columnX - 0.32, columnX + 0.32, 2.9, PLATFORM.height, z - 0.32, z + 0.32);
  }

  /* ── лавки и урна ──────────────────────────────────────────────────── */

  const benchRuns: Array<[number, number]> = [
    [-33.9, -32.5],
    [-29.9, -28.5],
  ];

  const benchWood = new BoxBatch(wood);
  const benchIron = new TubeBatch(castIron);

  for (const [z0, z1] of benchRuns) {
    // сиденье из трёх досок
    for (let i = 0; i < 3; i++) {
      benchWood.span(-9.0 + i * 0.15, -8.87 + i * 0.15, 0.44, 0.47, z0, z1);
    }
    // спинка у стены, выше сиденья на 20 см: без отступа назад лавка
    // читается столом, а не лавкой
    for (let i = 0; i < 2; i++) {
      benchWood.span(-9.15, -9.07, 0.66 + i * 0.16, 0.72 + i * 0.16, z0, z1);
    }
    // чугунные ноги и стойки спинки
    for (const z of [z0 + 0.2, z1 - 0.2]) {
      benchIron.cyl(-8.92, 0, z, -8.92, 0.44, z, 0.025);
      benchIron.cyl(-8.62, 0, z, -8.62, 0.44, z, 0.025);
      benchIron.cyl(-9.1, 0.44, z, -9.1, 0.9, z, 0.02);
      benchIron.cyl(-8.66, 0.44, z, -9.1, 0.44, z, 0.018);
    }
  }

  // урна: тёмный цилиндр у стены
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 12), castIron);
  bin.position.set(-8.8, 0.31, -30.9);
  bin.name = 'platform-bin';
  group.add(bin);

  /* ── табло и указатели ─────────────────────────────────────────────── */

  const sign = decal(env.sign, { width: 1.9, height: 0.59, lit: true });
  sign.rotation.y = Math.PI / 2;
  sign.position.set(BACK_X + WALL + 0.02, 2.3, Z_MID);
  group.add(sign);

  // рама табло
  const frame = new BoxBatch(steel);
  frame.span(BACK_X + WALL, BACK_X + WALL + 0.03, 1.94, 1.99, Z_MID - 1.0, Z_MID + 1.0);
  frame.span(BACK_X + WALL, BACK_X + WALL + 0.03, 2.62, 2.67, Z_MID - 1.0, Z_MID + 1.0);
  frame.span(BACK_X + WALL, BACK_X + WALL + 0.03, 1.94, 2.67, Z_MID - 1.0, Z_MID - 0.97);
  frame.span(BACK_X + WALL, BACK_X + WALL + 0.03, 1.94, 2.67, Z_MID + 0.97, Z_MID + 1.0);

  /* ── выход ─────────────────────────────────────────────────────────── */

  // Проём в дальнем торце: за ним короткий световой карман, чтобы не было
  // видно пустоты. Дальше идёт сценарий, геометрией это не заканчивается.
  const exitMinX = -6.9;
  const exitMaxX = -4.5;
  const exitHeight = 2.5;

  faienceBox.span(PLATFORM.minX, exitMinX, 0, PLATFORM.height, PLATFORM.minZ - WALL, PLATFORM.minZ);
  faienceBox.span(exitMaxX, PLATFORM.maxX, 0, PLATFORM.height, PLATFORM.minZ - WALL, PLATFORM.minZ);
  faienceBox.span(exitMinX, exitMaxX, exitHeight, PLATFORM.height, PLATFORM.minZ - WALL, PLATFORM.minZ);

  // карман за проёмом: стены, потолок и светлая плитка на дальней стене
  const pocketBox = new BoxBatch(concrete);
  pocketBox.span(exitMinX - 0.4, exitMinX, 0, exitHeight, PLATFORM.minZ - 1.6, PLATFORM.minZ - WALL);
  pocketBox.span(exitMaxX, exitMaxX + 0.4, 0, exitHeight, PLATFORM.minZ - 1.6, PLATFORM.minZ - WALL);
  pocketBox.span(exitMinX - 0.4, exitMaxX + 0.4, exitHeight, exitHeight + 0.3, PLATFORM.minZ - 1.6, PLATFORM.minZ - WALL);
  pocketBox.span(exitMinX - 0.4, exitMaxX + 0.4, 0, exitHeight, PLATFORM.minZ - 1.6, PLATFORM.minZ - 1.44);
  const pocketFloor = new BoxBatch(granite);
  pocketFloor.span(exitMinX - 0.4, exitMaxX + 0.4, -0.14, 0, PLATFORM.minZ - 1.6, PLATFORM.minZ - WALL);

  // светящаяся панель в глубине кармана: «там светло и есть выход»
  const glowPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), glow);
  glowPanel.position.set((exitMinX + exitMaxX) / 2, 1.25, PLATFORM.minZ - 1.43);
  glowPanel.name = 'platform-exit-glow';
  group.add(glowPanel);

  // портал выхода: рамка и небольшой козырёк
  const exitFrame = new BoxBatch(steel);
  exitFrame.span(exitMinX - 0.1, exitMinX, 0, exitHeight + 0.1, PLATFORM.minZ - 0.02, PLATFORM.minZ + 0.14);
  exitFrame.span(exitMaxX, exitMaxX + 0.1, 0, exitHeight + 0.1, PLATFORM.minZ - 0.02, PLATFORM.minZ + 0.14);
  exitFrame.span(exitMinX - 0.1, exitMaxX + 0.1, exitHeight, exitHeight + 0.12, PLATFORM.minZ - 0.02, PLATFORM.minZ + 0.14);

  /* ── свет ──────────────────────────────────────────────────────────── */

  const lampBox = new BoxBatch(steel);
  const lamps: THREE.Object3D[] = [];
  const lightSpots: LightSpot[] = [];

  for (const x of [-4.2, -7.6]) {
    for (let z = PLATFORM.minZ + 1.4; z < PLATFORM.maxZ; z += 2.2) {
      lampBox.span(x - 0.16, x + 0.16, PLATFORM.height - 0.06, PLATFORM.height, z - 0.5, z + 0.5);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.94), lampMat);
      tube.position.set(x, PLATFORM.height - 0.08, z);
      tube.name = 'lamp';
      group.add(tube);
      lamps.push(tube);
    }
  }

  lightSpots.push(
    { x: -4.2, y: 3.0, z: -34.0, color: 0xf0e4c8, intensity: 16, distance: 14 },
    { x: -7.6, y: 3.0, z: -33.4, color: 0xf0e4c8, intensity: 14, distance: 13 },
    { x: -7.6, y: 3.0, z: -30.0, color: 0xf0e4c8, intensity: 16, distance: 14 },
    { x: -4.2, y: 3.0, z: -28.0, color: 0xf0e4c8, intensity: 14, distance: 12 },
    { x: (exitMinX + exitMaxX) / 2, y: 1.6, z: PLATFORM.minZ - 1.1, color: 0xfff2d6, intensity: 10, distance: 9 },
  );

  /* ── сборка ────────────────────────────────────────────────────────── */

  const batches: Array<[string, ReturnType<BoxBatch['build']>]> = [
    ['platform-floor', floorBox.build('platform-floor', { receive: true })],
    ['platform-faience', faienceBox.build('platform-faience', { receive: true })],
    ['platform-base', baseBox.build('platform-base')],
    ['platform-cornice', corniceBox.build('platform-cornice')],
    ['platform-ceiling', ceilingBox.build('platform-ceiling', { receive: true })],
    ['platform-concrete', concreteBox.build('platform-concrete')],
    ['platform-side-wall', sideWall.build('platform-side-wall', { receive: true })],
    ['platform-side-base', sideBase.build('platform-side-base')],
    ['platform-columns', columnBox.build('platform-columns', { cast: true })],
    ['platform-column-bases', columnBase.build('platform-column-bases')],
    ['platform-column-caps', columnCap.build('platform-column-caps')],
    ['platform-bench-wood', benchWood.build('platform-bench-wood', { cast: true })],
    ['platform-bench-iron', benchIron.build('platform-bench-iron')],
    ['platform-frame', frame.build('platform-frame')],
    ['platform-pocket', pocketBox.build('platform-pocket', { receive: true })],
    ['platform-pocket-floor', pocketFloor.build('platform-pocket-floor', { receive: true })],
    ['platform-exit-frame', exitFrame.build('platform-exit-frame')],
    ['platform-lamp-bodies', lampBox.build('platform-lamp-bodies')],
  ];

  for (const [name, mesh] of batches) {
    if (!mesh) continue;
    mesh.name = name;
    group.add(mesh);
  }

  /* ── границы и коллизии ────────────────────────────────────────────── */

  const colliders: Box2[] = [
    // задняя стена
    { minX: BACK_X - 0.2, maxX: BACK_X + WALL, minZ: PLATFORM.minZ, maxZ: PLATFORM.maxZ },
    // торцы
    { minX: BACK_X, maxX: PLATFORM.maxX, minZ: PLATFORM.minZ - WALL, maxZ: PLATFORM.minZ },
    { minX: BACK_X, maxX: PLATFORM.maxX, minZ: PLATFORM.maxZ, maxZ: PLATFORM.maxZ + WALL },
    // стена со стороны тоннеля, кроме арки
    { minX: PLATFORM.maxX - 0.12, maxX: PLATFORM.maxX, minZ: PLATFORM.minZ, maxZ: TUNNEL.arch.z0 },
    { minX: PLATFORM.maxX - 0.12, maxX: PLATFORM.maxX, minZ: TUNNEL.arch.z1, maxZ: PLATFORM.maxZ },
    // карман выхода: две боковые стенки и задняя
    { minX: exitMinX - 0.4, maxX: exitMinX, minZ: PLATFORM.minZ - 1.6, maxZ: PLATFORM.minZ },
    { minX: exitMaxX, maxX: exitMaxX + 0.4, minZ: PLATFORM.minZ - 1.6, maxZ: PLATFORM.minZ },
    { minX: exitMinX, maxX: exitMaxX, minZ: PLATFORM.minZ - 1.6, maxZ: PLATFORM.minZ - 1.3 },
    // колонны
    ...columnZ.map((z) => ({ minX: columnX - 0.34, maxX: columnX + 0.34, minZ: z - 0.34, maxZ: z + 0.34 })),
    // лавки
    ...benchRuns.map(([z0, z1]) => ({ minX: -9.18, maxX: -8.55, minZ: z0, maxZ: z1 })),
    // урна
    { minX: -9.0, maxX: -8.6, minZ: -31.1, maxZ: -30.7 },
  ];

  group.userData.lightSpots = lightSpots;
  group.userData.interactive = { exit: glowPanel };
  group.userData.exit = { x: (exitMinX + exitMaxX) / 2, z: PLATFORM.minZ - 1.0 };

  return {
    group,
    colliders,
    bounds: {
      minX: PLATFORM.minX,
      maxX: TUNNEL.bounds.minX + 0.8,
      minZ: PLATFORM.minZ - 1.5,
      maxZ: PLATFORM.maxZ,
    },
    lamps,
  };
}
