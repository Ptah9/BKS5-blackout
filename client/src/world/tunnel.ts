/**
 * Тоннель кусками: каждый участок строится отдельно, чтобы его можно было
 * загрузить и выгрузить независимо от остальных.
 *
 * Ниже — вторая, цельная версия: `buildTunnel` строит весь участок от кабины
 * до тупика одной локацией с проёмом под платформу, замурованным проходом
 * и светофором с телефоном. Старая `buildTunnelSlice` остаётся: по ней сейчас
 * живёт chunks.ts, и ломать её нельзя.
 */

import * as THREE from 'three';

import type { Box2 } from './collision';
import type { Textures } from '../render/textures';
import { envTextures } from '../render/env-textures';
import { BoxBatch, TubeBatch, decal, tiled, type LightSpot, type Location } from './location';

const TUNNEL_RADIUS = 2.9;
const TUNNEL_Y = 1.1;
const RIB_STEP = 3;

export function buildTunnelSlice(zFrom: number, zTo: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tunnel';
  const length = zTo - zFrom;
  if (length <= 0.01) return group;

  const center = (zFrom + zTo) / 2;

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x2b2e33,
    roughness: 1,
    side: THREE.BackSide,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x484d54, roughness: 0.45, metalness: 0.9 });

  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, length, 10, 1, true),
    concrete,
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, TUNNEL_Y, center);
  tube.receiveShadow = true;
  group.add(tube);

  // рёбра жёсткости: только те, что попали в этот участок
  const ribPositions: number[] = [];
  for (let z = Math.ceil(zFrom / RIB_STEP) * RIB_STEP; z < zTo; z += RIB_STEP) {
    ribPositions.push(z);
  }

  if (ribPositions.length > 0) {
    const ribGeo = new THREE.TorusGeometry(TUNNEL_RADIUS - 0.04, 0.09, 4, 8);
    const ribs = new THREE.InstancedMesh(ribGeo, dark, ribPositions.length);
    const matrix = new THREE.Matrix4();
    ribPositions.forEach((z, i) => {
      matrix.makeTranslation(0, TUNNEL_Y, z);
      ribs.setMatrixAt(i, matrix);
    });
    ribs.instanceMatrix.needsUpdate = true;
    group.add(ribs);
  }

  const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, length), dark);
  floor.position.set(0, -0.62, center);
  floor.receiveShadow = true;
  group.add(floor);

  for (const x of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, length), steel);
    rail.position.set(x, -0.5, center);
    group.add(rail);
  }

  for (const [x, y] of [[-2.72, 1.6], [2.66, 2.0]] as const) {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, length), dark);
    cable.position.set(x, y, center);
    group.add(cable);
  }

  return group;
}

/* ────────────────────────────────────────────────────────────────────────
 * Цельный тоннель от кабины до тупика.
 *
 * Сечение — круг R = 2,75 с центром на y = 1,35, пол срезает низ на y = 0.
 * Такой радиус выбран не наугад: на высоте 2,4 м (рост вагона) стена уходит
 * на 1,35 м от оси, то есть поезд проходит в тоннеле с запасом.
 *
 * Стена — своя геометрия, а не CylinderGeometry: в левой стене нужен проём
 * на платформу, а вырезать дырку в готовом цилиндре нельзя. Поэтому обшивка
 * собирается кусками по углу и по z (`boreWall`).
 * ──────────────────────────────────────────────────────────────────────── */

export const TUNNEL = {
  /** Начало — лобовая стена кабины, конец — тупик. */
  zStart: -12.6,
  zEnd: -36.6,
  radius: 2.75,
  centerY: 1.35,
  /** Проём в левой стене на платформу. */
  arch: { z0: -33.4, z1: -28.4, height: 2.3 },
  /** Замурованный проход в правой стене. */
  niche: { z0: -25.6, z1: -23.9, height: 2.2 },
  bounds: { minX: -2.3, maxX: 2.3, minZ: -36.6, maxZ: -12.6 },
} as const;

const R = TUNNEL.radius;
const CY = TUNNEL.centerY;
const FLOOR = 2.45;

/** Угол на окружности по высоте: y = CY + R·sin(a). */
const angleAtY = (y: number): number => Math.asin(Math.max(-1, Math.min(1, (y - CY) / R)));

/**
 * Полоса обшивки: участок поверхности от z0 до z1 и от угла a0 до a1.
 * UV — в метрах, поэтому текстура не растягивается на длинном участке.
 */
function boreWall(z0: number, z1: number, a0: number, a1: number, segments: number): THREE.BufferGeometry {
  const cols = segments + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const arc = Math.abs(a1 - a0) * R;

  for (let j = 0; j < 2; j++) {
    const z = j === 0 ? z0 : z1;
    for (let i = 0; i < cols; i++) {
      const a = a0 + ((a1 - a0) * i) / segments;
      const x = Math.cos(a) * R;
      const y = CY + Math.sin(a) * R;
      positions.push(x, y, z);
      normals.push(-Math.cos(a), -Math.sin(a), 0);
      uvs.push((arc * i) / segments / 2.2, Math.abs(z - z0) / 2.2);
    }
  }

  for (let i = 0; i < segments; i++) {
    const a = i;
    const b = i + 1;
    const c = cols + i;
    const d = cols + i + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Кривая наклейка по стене: мелу нужна поверхность, повторяющая изгиб. */
function wallPatch(
  side: 1 | -1,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  material: THREE.Material,
): THREE.Mesh {
  const a0 = angleAtY(y0);
  const a1 = angleAtY(y1);
  const segments = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cols = segments + 1;

  // отступ 2 см внутрь: наклейка не должна спорить со стеной за плоскость
  const r = R - 0.02;

  for (let j = 0; j < 2; j++) {
    const z = j === 0 ? z0 : z1;
    for (let i = 0; i < cols; i++) {
      const a = a0 + ((a1 - a0) * i) / segments;
      positions.push(side * Math.cos(a) * r, CY + Math.sin(a) * r, z);
      uvs.push(i / segments, j);
    }
  }

  for (let i = 0; i < segments; i++) {
    const a = i;
    const b = i + 1;
    const c = cols + i;
    const d = cols + i + 1;
    if (side > 0) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}

function chalkMaterial(texture: THREE.Texture): THREE.Material {
  return new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.95,
    metalness: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}

export function buildTunnel(textures: Textures): Location {
  const env = envTextures();
  const group = new THREE.Group();
  group.name = 'tunnel';

  /* ── материалы ─────────────────────────────────────────────────────── */

  // DoubleSide: обшивка собрана своей геометрией, и порядок обхода вершин
  // тут не главное — важно, чтобы стена не исчезла при неверной намотке.
  const concrete = new THREE.MeshStandardMaterial({
    map: tiled(env.concrete, 1, 1),
    roughness: 1,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const concreteFloor = new THREE.MeshStandardMaterial({
    map: tiled(env.concrete, 2, 10),
    roughness: 1,
    color: 0x9a9da1,
  });
  const ballast = new THREE.MeshStandardMaterial({ map: tiled(env.ballast, 3, 26), roughness: 1 });
  const brick = new THREE.MeshStandardMaterial({ map: tiled(env.brick, 1, 1.4), roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({
    map: tiled(textures.metal, 2, 6),
    color: 0x9aa1a8,
    roughness: 0.42,
    metalness: 0.85,
  });
  const rail = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.28, metalness: 0.95 });
  const sleeper = new THREE.MeshStandardMaterial({ color: 0x3b3a37, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x463325, roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.8, metalness: 0.3 });
  const paintWhite = new THREE.MeshStandardMaterial({ color: 0x8d8a7c, roughness: 0.95 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xc4c0b4, emissive: 0x000000, roughness: 0.5 });
  // линзы светофора горят сами: они не часть общего света, а сигнал
  const signalRed = new THREE.MeshStandardMaterial({ color: 0x2a0503, emissive: 0xd41a10, emissiveIntensity: 1.4 });
  const signalGreen = new THREE.MeshStandardMaterial({ color: 0x03130a, emissive: 0x08220f, roughness: 0.4 });
  const chalkWindows = chalkMaterial(env.chalkWindows);

  /* ── обшивка ───────────────────────────────────────────────────────── */

  const top = Math.PI / 2;
  const leftAboveArch = Math.PI - angleAtY(TUNNEL.arch.height); // верх левой стены над проёмом
  const bottomLeft = -Math.PI / 2;

  // до проёма — целое кольцо, дальше участок с вырезом в левой стене
  const before = new THREE.Mesh(boreWall(TUNNEL.zStart, TUNNEL.arch.z1, bottomLeft, top + Math.PI, 22), concrete);
  const aroundArch = new THREE.Mesh(
    boreWall(TUNNEL.arch.z1, TUNNEL.arch.z0, bottomLeft, leftAboveArch, 18),
    concrete,
  );
  const after = new THREE.Mesh(
    boreWall(TUNNEL.arch.z0, TUNNEL.zEnd, bottomLeft, top + Math.PI, 22),
    concrete,
  );

  for (const part of [before, aroundArch, after]) {
    part.receiveShadow = true;
    group.add(part);
  }

  /* ── кольца тюбингов ───────────────────────────────────────────────── */

  const ringZ: number[] = [];
  for (let z = TUNNEL.zStart - 1.2; z > TUNNEL.zEnd; z -= 1.5) ringZ.push(z);

  const rings = new THREE.InstancedMesh(
    new THREE.TorusGeometry(R - 0.03, 0.055, 4, 26),
    new THREE.MeshStandardMaterial({ color: 0x63666b, roughness: 0.95 }),
    ringZ.length,
  );
  ringZ.forEach((z, i) => {
    rings.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, CY, z));
  });
  rings.instanceMatrix.needsUpdate = true;
  rings.name = 'tunnel-rings';
  group.add(rings);

  /* ── пол, путь, контактный рельс ───────────────────────────────────── */

  const floorBox = new BoxBatch(concreteFloor);
  floorBox.span(-FLOOR, FLOOR, -0.16, 0, TUNNEL.zEnd, TUNNEL.zStart);

  // балласт между рельсами: чуть темнее бетона, чтобы путь читался
  const ballastBox = new BoxBatch(ballast);
  ballastBox.span(-1.35, 1.35, 0, 0.02, TUNNEL.zEnd, TUNNEL.zStart);

  // шпалы утоплены в балласт — по ним ходят, а не спотыкаются
  const sleeperBatch = new BoxBatch(sleeper);
  for (let z = TUNNEL.zStart - 0.4; z > TUNNEL.zEnd; z -= 0.62) {
    sleeperBatch.box(0, 0.015, z, 2.5, 0.07, 0.24);
  }

  const railBatch = new BoxBatch(rail);
  for (const x of [-0.76, 0.76]) {
    railBatch.span(x - 0.035, x + 0.035, 0.02, 0.17, TUNNEL.zEnd, TUNNEL.zStart);
  }

  // контактный рельс справа: изоляторы, сам рельс и деревянный кожух сверху
  const contactBatch = new BoxBatch(steel);
  for (let z = TUNNEL.zStart - 0.6; z > TUNNEL.zEnd; z -= 1.1) {
    contactBatch.box(1.36, 0.3, z, 0.12, 0.2, 0.16);
  }
  contactBatch.span(1.33, 1.41, 0.4, 0.5, TUNNEL.zEnd, TUNNEL.zStart);
  const contactCover = new BoxBatch(wood);
  contactCover.span(1.16, 1.56, 0.5, 0.545, TUNNEL.zEnd, TUNNEL.zStart);

  /* ── банкетка вдоль левой стены ────────────────────────────────────── */

  // невысокий бортик-ходовая часть: по нему ходят обходчики
  const ledge = new BoxBatch(concreteFloor);
  ledge.span(-FLOOR, -1.45, 0, 0.12, TUNNEL.zEnd, TUNNEL.zStart);
  const line = new BoxBatch(paintWhite);
  line.span(-1.47, -1.42, 0.12, 0.13, TUNNEL.zEnd, TUNNEL.zStart);

  // сама банкетка: узкая доска на стальных ногах
  const benchZ0 = -23.4;
  const benchZ1 = -19.6;
  const benchX = -1.78;
  const benchTop = new BoxBatch(wood);
  benchTop.span(benchX - 0.19, benchX + 0.19, 0.44, 0.48, benchZ0, benchZ1);
  const benchSteel = new TubeBatch(steel);
  for (let z = benchZ0 + 0.25; z < benchZ1; z += 1.27) {
    benchSteel.cyl(benchX - 0.16, 0.12, z, benchX - 0.16, 0.44, z, 0.022);
    benchSteel.cyl(benchX + 0.16, 0.12, z, benchX + 0.16, 0.44, z, 0.022);
    benchSteel.cyl(benchX - 0.17, 0.3, z, benchX + 0.17, 0.3, z, 0.012);
  }

  /* ── кабельные лотки ───────────────────────────────────────────────── */

  const trayBatch = new BoxBatch(steel);
  const cableBatch = new TubeBatch(dark);

  // правый борт: два лотка на высоте 2,2 и 2,55
  for (const y of [2.2, 2.55]) {
    const x = Math.sqrt(R * R - (y - CY) * (y - CY)) - 0.16;
    trayBatch.span(x - 0.16, x + 0.16, y, y + 0.04, TUNNEL.zEnd, TUNNEL.zStart);
    for (const dx of [-0.08, 0.08]) {
      cableBatch.cyl(x + dx, y + 0.08, TUNNEL.zEnd, x + dx, y + 0.08, TUNNEL.zStart, 0.025);
    }
    // кронштейны
    for (let z = TUNNEL.zStart - 1.5; z > TUNNEL.zEnd; z -= 1.8) {
      trayBatch.box(x + 0.2, y + 0.02, z, 0.34, 0.05, 0.05);
    }
  }

  // левый борт: один лоток, выше — там меньше кабеля
  trayBatch.span(-2.3, -1.98, 2.62, 2.66, TUNNEL.zEnd, TUNNEL.zStart);
  cableBatch.cyl(-2.2, 2.7, TUNNEL.zEnd, -2.2, 2.7, TUNNEL.zStart, 0.028);
  cableBatch.cyl(-2.08, 2.7, TUNNEL.zEnd, -2.08, 2.7, TUNNEL.zStart, 0.022);

  /* ── светильники ───────────────────────────────────────────────────── */

  const lampBox = new BoxBatch(dark);
  const lamps: THREE.Object3D[] = [];
  const lightSpots: LightSpot[] = [];

  const lampZ = [-15.6, -19.8, -24.0, -28.2, -32.4, -35.4];
  lampZ.forEach((z, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * 2.42;
    // кронштейн и защитный кожух
    lampBox.box(side * 2.55, 2.56, z, 0.3, 0.06, 0.12);
    lampBox.box(x, 2.5, z, 0.16, 0.18, 0.55);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.46), lampMat);
    tube.position.set(x, 2.42, z);
    tube.name = 'lamp';
    group.add(tube);
    lamps.push(tube);

    lightSpots.push({ x: side * 2.0, y: 2.3, z, color: 0xc9d8e4, intensity: 30, distance: 13 });
  });

  /* ── светофор с трубкой телефона ───────────────────────────────────── */

  // Светофор на ноге у правой стены. Рядом — ящик поездной связи с трубкой:
  // по сценарию с неё проверяют, под напряжением ли контактный рельс.
  const signalZ = -30.6;
  const signalX = 2.12;

  const signalPost = new BoxBatch(steel);
  signalPost.span(signalX - 0.045, signalX + 0.045, 0, 2.05, signalZ - 0.045, signalZ + 0.045);

  const head = new BoxBatch(dark);
  head.box(signalX, 2.15, signalZ, 0.26, 0.62, 0.2);
  // козырьки над линзами: короткие трубы, чтобы свет не слепил сбоку
  head.box(signalX - 0.2, 2.34, signalZ, 0.14, 0.02, 0.26);
  head.box(signalX - 0.2, 1.96, signalZ, 0.14, 0.02, 0.26);

  const lensRed = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10), signalRed);
  lensRed.rotation.z = Math.PI / 2;
  lensRed.position.set(signalX - 0.14, 2.26, signalZ);
  lensRed.name = 'tunnel-signal-red';
  group.add(lensRed);

  const lensGreen = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10), signalGreen);
  lensGreen.rotation.z = Math.PI / 2;
  lensGreen.position.set(signalX - 0.14, 2.02, signalZ);
  group.add(lensGreen);

  // ящик связи на ноге светофора, трубка висит сбоку
  const phoneBox = new BoxBatch(new THREE.MeshStandardMaterial({ color: 0x38463a, roughness: 0.7, metalness: 0.3 }));
  phoneBox.span(signalX - 0.02, signalX + 0.22, 1.15, 1.55, signalZ + 0.2, signalZ + 0.5);

  const phoneBody = new THREE.Group();
  phoneBody.name = 'tunnel-phone';
  phoneBody.position.set(signalX - 0.01, 1.32, signalZ + 0.35);
  const handset = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.07), dark);
  phoneBody.add(handset);
  for (const dy of [-0.12, 0.12]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, 0.09), dark);
    ear.position.set(0, dy, 0);
    phoneBody.add(ear);
  }
  phoneBody.rotation.z = -0.08;
  group.add(phoneBody);

  const cord = new TubeBatch(dark);
  for (let i = 0; i < 8; i++) {
    const a = i * 0.9;
    cord.cyl(
      signalX + Math.cos(a) * 0.05,
      1.2 - i * 0.03,
      signalZ + 0.35 + Math.sin(a) * 0.05,
      signalX + Math.cos(a + 0.9) * 0.05,
      1.2 - (i + 1) * 0.03,
      signalZ + 0.35 + Math.sin(a + 0.9) * 0.05,
      0.007,
    );
  }

  /* ── замурованный проход ───────────────────────────────────────────── */

  // Проход не вырезан в стене, а стоит перед ней рамкой: так его видно
  // с обеих сторон и не нужно резать обшивку ещё в одном месте.
  const nz0 = TUNNEL.niche.z0;
  const nz1 = TUNNEL.niche.z1;
  const frame = new BoxBatch(concreteFloor);
  frame.span(2.3, 2.86, 0, TUNNEL.niche.height, nz0, nz0 + 0.26);
  frame.span(2.3, 2.86, 0, TUNNEL.niche.height, nz1 - 0.26, nz1);
  frame.span(2.3, 2.86, TUNNEL.niche.height, TUNNEL.niche.height + 0.26, nz0, nz1);

  // сама кладка: свежая, раствор ещё тёмный
  const infill = new BoxBatch(brick);
  infill.span(2.66, 2.82, 0, TUNNEL.niche.height, nz0 + 0.26, nz1 - 0.26);

  // мел: «выход» со стрелкой внизу кладки
  const exitChalk = decal(env.chalkExit, { width: 1.24, height: 1.24, lit: true });
  exitChalk.rotation.y = -Math.PI / 2;
  exitChalk.position.set(2.65, 1.1, (nz0 + nz1) / 2);
  group.add(exitChalk);

  // рядом, уже на бетоне, — окна, нарисованные тем же мелом
  group.add(wallPatch(1, -23.6, -21.9, 1.2, 2.2, chalkWindows));

  /* ── проём на платформу ────────────────────────────────────────────── */

  const archH = TUNNEL.arch.height;
  const portal = new BoxBatch(concreteFloor);
  portal.span(-2.72, -2.28, 0, archH + 0.3, TUNNEL.arch.z1 - 0.3, TUNNEL.arch.z1);
  portal.span(-2.72, -2.28, 0, archH + 0.3, TUNNEL.arch.z0, TUNNEL.arch.z0 + 0.3);
  portal.span(-2.72, -2.28, archH, archH + 0.3, TUNNEL.arch.z0, TUNNEL.arch.z1);

  /* ── тупик ─────────────────────────────────────────────────────────── */

  const deadEnd = new BoxBatch(concreteFloor);
  deadEnd.span(-2.9, 2.9, 0, 4.1, TUNNEL.zEnd - 0.3, TUNNEL.zEnd);

  /* ── торцевая стена со стороны кабины ─────────────────────────────── */

  // Поезда в этом модуле нет, а тоннель кончается ровно у лобовой стены
  // кабины. Без этой стены смотришь назад — и видишь, как кабина висит
  // светлой коробкой в пустоте. Стена заполняет кольцо вокруг кабины,
  // а проём в ней — ровно габарит кабины, поэтому из кабины вид не режется.
  const bulkhead = new BoxBatch(concreteFloor);
  bulkhead.span(-2.9, -1.18, 0, 4.1, TUNNEL.zStart - 0.08, TUNNEL.zStart);
  bulkhead.span(1.18, 2.9, 0, 4.1, TUNNEL.zStart - 0.08, TUNNEL.zStart);
  bulkhead.span(-1.18, 1.18, 2.46, 4.1, TUNNEL.zStart - 0.08, TUNNEL.zStart);

  /* ── сборка ────────────────────────────────────────────────────────── */

  const batches: Array<[string, ReturnType<BoxBatch['build']>]> = [
    ['tunnel-floor', floorBox.build('tunnel-floor', { receive: true })],
    ['tunnel-ballast', ballastBox.build('tunnel-ballast', { receive: true })],
    ['tunnel-sleepers', sleeperBatch.build('tunnel-sleepers', { receive: true })],
    ['tunnel-rails', railBatch.build('tunnel-rails')],
    ['tunnel-contact', contactBatch.build('tunnel-contact')],
    ['tunnel-contact-cover', contactCover.build('tunnel-contact-cover')],
    ['tunnel-ledge', ledge.build('tunnel-ledge', { receive: true })],
    ['tunnel-line', line.build('tunnel-line')],
    ['tunnel-bench', benchTop.build('tunnel-bench', { cast: true })],
    ['tunnel-bench-steel', benchSteel.build('tunnel-bench-steel')],
    ['tunnel-trays', trayBatch.build('tunnel-trays')],
    ['tunnel-cables', cableBatch.build('tunnel-cables')],
    ['tunnel-lamp-bodies', lampBox.build('tunnel-lamp-bodies')],
    ['tunnel-signal-post', signalPost.build('tunnel-signal-post', { cast: true })],
    ['tunnel-signal-head', head.build('tunnel-signal-head')],
    ['tunnel-phone-box', phoneBox.build('tunnel-phone-box')],
    ['tunnel-portal', portal.build('tunnel-portal', { cast: true })],
    ['tunnel-frame', frame.build('tunnel-frame', { cast: true })],
    ['tunnel-brick', infill.build('tunnel-brick', { receive: true })],
    ['tunnel-dead-end', deadEnd.build('tunnel-dead-end', { receive: true })],
    ['tunnel-bulkhead', bulkhead.build('tunnel-bulkhead', { receive: true })],
    ['tunnel-cord', cord.build('tunnel-cord')],
  ];

  for (const [name, mesh] of batches) {
    if (!mesh) continue;
    mesh.name = name;
    group.add(mesh);
  }

  lightSpots.push({
    x: -1.6,
    y: 1.5,
    z: -34.2,
    color: 0x8ea6bd,
    intensity: 8,
    distance: 7,
  });

  /* ── границы и коллизии ────────────────────────────────────────────── */

  const colliders: Box2[] = [
    // левая стена: два куска, между ними проём на платформу
    { minX: -3.2, maxX: -2.42, minZ: TUNNEL.zEnd, maxZ: TUNNEL.arch.z0 },
    { minX: -3.2, maxX: -2.42, minZ: TUNNEL.arch.z1, maxZ: TUNNEL.zStart },
    // правая стена
    { minX: 2.42, maxX: 3.2, minZ: TUNNEL.zEnd, maxZ: TUNNEL.zStart },
    // тупик
    { minX: -2.9, maxX: 2.9, minZ: TUNNEL.zEnd - 0.4, maxZ: TUNNEL.zEnd },
    // банкетка
    { minX: benchX - 0.22, maxX: benchX + 0.22, minZ: benchZ0, maxZ: benchZ1 },
    // светофор
    { minX: signalX - 0.08, maxX: signalX + 0.25, minZ: signalZ - 0.1, maxZ: signalZ + 0.55 },
    // рамка замурованного прохода
    { minX: 2.28, maxX: 2.88, minZ: nz0, maxZ: nz0 + 0.26 },
    { minX: 2.28, maxX: 2.88, minZ: nz1 - 0.26, maxZ: nz1 },
  ];

  group.userData.lightSpots = lightSpots;
  group.userData.interactive = { phone: phoneBody, handset, signal: lensRed };
  group.userData.arch = TUNNEL.arch;

  return {
    group,
    colliders,
    bounds: { ...TUNNEL.bounds },
    lamps,
  };
}
