/**
 * Кабина машиниста — комната за торцевой дверью вагона.
 *
 * Габарит 2,2 × 2,4 × 2,6 м: светлые стены с зелёным низом, пульт с приборами
 * и микрофоном, кресло, красный стул, распахнутая боковая дверь на путь и
 * открытая дверь в тоннель в торце.
 *
 * Задняя стена сведена к наличнику проёма: торцевая дверь вагона — дело
 * вагона (её режет `car.ts`), а кабина только приставляет раму, чтобы шов
 * между модулями не читался. Дверь из кабины в вагон тоже распахнута внутрь
 * кабины — так её видно с обеих сторон.
 *
 * Что здесь для сценария: микрофон (в него говорят в вагон) и тангента
 * на пульте — оба лежат в `group.userData.interactive`, чтобы main.ts мог
 * навесить на них подсветку и взаимодействие, не трогая геометрию.
 */

import * as THREE from 'three';

import { cabDoorLeaf, registerCabDoorPivot } from './car';
import type { Box2 } from './collision';
import type { Textures } from '../render/textures';
import { envTextures } from '../render/env-textures';
import { BoxBatch, TubeBatch, tiled, type LightSpot, type Location } from './location';

/** Габарит кабины. Торцевая дверь вагона на z = −9,55 — сразу за задней рамой. */
export const CAB = {
  minX: -1.1,
  maxX: 1.1,
  zFront: -12.6,
  zBack: -10,
  height: 2.4,
} as const;

const WALL = 0.08;
const WALL_X = CAB.maxX + WALL / 2;

/** Проём из вагона: 0,86 × 2,05 по центру. */
const BACK_DOOR = { half: 0.43, height: 2.05 };

/** Проём в тоннель: смещён влево, чтобы справа встал пульт. */
const FRONT_DOOR = { minX: -0.98, maxX: -0.32, height: 1.95 };

/** Боковая дверь на путь — в левой стене, ближе к лобовой. */
const SIDE_DOOR = { z0: -12.28, z1: -11.63, height: 1.95 };

/** Лобовое стекло справа от двери. */
const WINDSHIELD = { minX: -0.2, maxX: 0.92, y0: 1.14, y1: 1.9 };

// пульт наклонён НА машиниста: нормаль панели смотрит в салон (+Z),
// раньше знак был отрицательным и приборы смотрели в лобовую стену
const PANEL_SLOPE = 0.58;
const PANEL_CENTER = new THREE.Vector3(0.42, 1.015, -12.47);

export function buildCab(textures: Textures): Location {
  const env = envTextures();
  const group = new THREE.Group();
  group.name = 'cab';

  /* ── материалы ─────────────────────────────────────────────────────── */

  const paint = new THREE.MeshStandardMaterial({
    map: tiled(env.cabPaint, 2, 1.4),
    roughness: 0.82,
    metalness: 0.04,
  });
  // нижняя часть стен — тёмно-зелёный пластик, как в 81-й серии
  const paintLow = new THREE.MeshStandardMaterial({ map: tiled(env.cabPaint, 2, 0.5), color: 0x8e9a86, roughness: 0.72 });
  const floor = new THREE.MeshStandardMaterial({
    map: tiled(env.plate, 3, 4),
    roughness: 0.55,
    metalness: 0.55,
  });
  const ceiling = new THREE.MeshStandardMaterial({ map: tiled(textures.ceiling, 2, 3), roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.62, metalness: 0.35 });
  const desk = new THREE.MeshStandardMaterial({ color: 0x4c535a, roughness: 0.48, metalness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ map: tiled(textures.metal, 1, 1), roughness: 0.24, metalness: 0.95 });
  const vinyl = new THREE.MeshStandardMaterial({ map: tiled(env.vinyl, 1, 1), roughness: 0.85, metalness: 0.05 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x06090d,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.62,
  });
  const red = new THREE.MeshStandardMaterial({ color: 0xa8241c, roughness: 0.45 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd9d5c8, roughness: 0.65 });
  const face = new THREE.MeshStandardMaterial({ color: 0xd8d3c2, roughness: 0.6 });
  // плафон: гаснет и загорается вместе с вагонными — имя меша `lamp`
  const lamp = new THREE.MeshStandardMaterial({ color: 0xbfbcb2, emissive: 0x000000, roughness: 0.45 });

  /* ── батчи ─────────────────────────────────────────────────────────── */

  const paintBox = new BoxBatch(paint);
  const lowBox = new BoxBatch(paintLow);
  const floorBox = new BoxBatch(floor);
  const ceilingBox = new BoxBatch(ceiling);
  const darkBox = new BoxBatch(dark);
  const deskBox = new BoxBatch(desk);
  const chromeBox = new BoxBatch(chrome);
  const chromeTube = new TubeBatch(chrome);
  const darkTube = new TubeBatch(dark);
  const vinylBox = new BoxBatch(vinyl);
  const glassBox = new BoxBatch(glass);
  const redBox = new BoxBatch(red);
  const redTube = new TubeBatch(red);
  const whiteBox = new BoxBatch(white);
  const faceBox = new BoxBatch(face);

  /* ── оболочка: пол, потолок, стены ─────────────────────────────────── */

  // пол и потолок выходят за стены на их толщину — иначе на стыке щель
  floorBox.span(-WALL_X, WALL_X, -0.1, 0, CAB.zFront - WALL, CAB.zBack + 0.06);
  ceilingBox.span(-WALL_X, WALL_X, CAB.height, CAB.height + 0.06, CAB.zFront - WALL, CAB.zBack + 0.06);

  // правая стена — цельная
  paintBox.span(WALL_X - WALL, WALL_X, 0, CAB.height, CAB.zFront - WALL, CAB.zBack);

  // левая стена: два куска и перемычка над боковой дверью
  paintBox.span(-WALL_X, -WALL_X + WALL, 0, CAB.height, CAB.zFront - WALL, SIDE_DOOR.z0);
  paintBox.span(-WALL_X, -WALL_X + WALL, 0, CAB.height, SIDE_DOOR.z1, CAB.zBack);
  paintBox.span(-WALL_X, -WALL_X + WALL, SIDE_DOOR.height, CAB.height, SIDE_DOOR.z0, SIDE_DOOR.z1);

  // зелёный низ стен: накладка в 1,5 см от обшивки, чтобы не спорить за плоскость
  lowBox.span(WALL_X - WALL - 0.015, WALL_X - WALL, 0, 0.92, CAB.zFront - WALL, CAB.zBack);
  lowBox.span(-WALL_X + WALL, -WALL_X + WALL + 0.015, 0, 0.92, CAB.zFront - WALL, SIDE_DOOR.z0);
  lowBox.span(-WALL_X + WALL, -WALL_X + WALL + 0.015, 0, 0.92, SIDE_DOOR.z1, CAB.zBack);

  // лобовая стена (z = zFront − WALL/2): дверь, стекло, мясо между ними
  const zf = CAB.zFront - WALL / 2;
  paintBox.span(-WALL_X, FRONT_DOOR.minX, 0, CAB.height, zf - WALL / 2, zf + WALL / 2); // левее двери
  paintBox.span(FRONT_DOOR.minX, FRONT_DOOR.maxX, FRONT_DOOR.height, CAB.height, zf - WALL / 2, zf + WALL / 2);
  paintBox.span(FRONT_DOOR.maxX, WINDSHIELD.minX, 0, CAB.height, zf - WALL / 2, zf + WALL / 2); // между дверью и стеклом
  paintBox.span(WINDSHIELD.minX, WINDSHIELD.maxX, 0, WINDSHIELD.y0, zf - WALL / 2, zf + WALL / 2); // под стеклом
  paintBox.span(WINDSHIELD.minX, WINDSHIELD.maxX, WINDSHIELD.y1, CAB.height, zf - WALL / 2, zf + WALL / 2); // над стеклом
  paintBox.span(WINDSHIELD.maxX, WALL_X, 0, CAB.height, zf - WALL / 2, zf + WALL / 2); // правее стекла

  // лобовое стекло: утоплено в проём, внутрь смотрит тёмной плоскостью
  glassBox.box(
    (WINDSHIELD.minX + WINDSHIELD.maxX) / 2,
    (WINDSHIELD.y0 + WINDSHIELD.y1) / 2,
    CAB.zFront - 0.045,
    WINDSHIELD.maxX - WINDSHIELD.minX,
    WINDSHIELD.y1 - WINDSHIELD.y0,
    0.012,
  );

  // дворник: тяга по стеклу и поводок к мотору под ним
  chromeTube.cyl(0.78, 1.34, CAB.zFront - 0.065, 0.1, 1.78, CAB.zFront - 0.065, 0.008);
  chromeTube.cyl(0.78, 1.34, CAB.zFront - 0.065, 0.78, 1.22, CAB.zFront - 0.065, 0.014);

  // рама проёма из вагона: наличник, который закрывает стык двух модулей
  darkBox.span(-BACK_DOOR.half - 0.05, -BACK_DOOR.half, 0, BACK_DOOR.height + 0.05, CAB.zBack - 0.02, CAB.zBack + 0.08);
  darkBox.span(BACK_DOOR.half, BACK_DOOR.half + 0.05, 0, BACK_DOOR.height + 0.05, CAB.zBack - 0.02, CAB.zBack + 0.08);
  darkBox.span(-BACK_DOOR.half - 0.05, BACK_DOOR.half + 0.05, BACK_DOOR.height, BACK_DOOR.height + 0.05, CAB.zBack - 0.02, CAB.zBack + 0.08);
  // и такой же наличник со стороны торца кабины — там, где она уходит в вагон
  darkBox.span(-BACK_DOOR.half - 0.05, -BACK_DOOR.half, 0, BACK_DOOR.height + 0.05, CAB.zBack - 0.1, CAB.zBack - 0.02);
  darkBox.span(BACK_DOOR.half, BACK_DOOR.half + 0.05, 0, BACK_DOOR.height + 0.05, CAB.zBack - 0.1, CAB.zBack - 0.02);
  darkBox.span(-BACK_DOOR.half - 0.05, BACK_DOOR.half + 0.05, BACK_DOOR.height, BACK_DOOR.height + 0.05, CAB.zBack - 0.1, CAB.zBack - 0.02);

  // Створки из вагона здесь больше нет: настоящая дверь на петлях живёт
  // в car.ts (setCabDoorOpen). Две створки в одном проёме — это и была
  // «вторая дверь», которую видно в кабине.

  /* ── боковая дверь на путь ─────────────────────────────────────────── */

  const sideDoor = new THREE.Group();
  sideDoor.name = 'cab-side-door';
  sideDoor.position.set(-WALL_X + WALL, 0, SIDE_DOOR.z1);
  // Дверь кабины — эта, боковая. Закрыта, открывается наружу по флагу cab_open.
  sideDoor.rotation.y = 0;
  const sideLeafW = SIDE_DOOR.z1 - SIDE_DOOR.z0;
  const sideLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, SIDE_DOOR.height - 0.02, sideLeafW), paint);
  sideLeaf.position.set(0, (SIDE_DOOR.height - 0.02) / 2, -sideLeafW / 2);
  sideDoor.add(sideLeaf);
  const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.34), glass);
  sideGlass.position.set(0, 1.42, -0.4);
  sideDoor.add(sideGlass);
  group.add(sideDoor);
  // car.ts крутит её тем же setCabDoorOpen, что и прочие двери
  registerCabDoorPivot(sideDoor, -1);

  // петли и ручка
  chromeTube.cyl(-WALL_X + WALL + 0.04, 0.35, SIDE_DOOR.z1, -WALL_X + WALL + 0.04, 1.55, SIDE_DOOR.z1, 0.02);
  chromeTube.cyl(-WALL_X - 0.03, 1.05, SIDE_DOOR.z1 + 0.3, -WALL_X - 0.14, 1.05, SIDE_DOOR.z1 + 0.3, 0.016);

  // наличники проёма: без них край обшивки выглядит срезом картона
  darkBox.span(-WALL_X - 0.01, -WALL_X + WALL + 0.01, 0, SIDE_DOOR.height + 0.04, SIDE_DOOR.z0 - 0.04, SIDE_DOOR.z0);
  darkBox.span(-WALL_X - 0.01, -WALL_X + WALL + 0.01, 0, SIDE_DOOR.height + 0.04, SIDE_DOOR.z1, SIDE_DOOR.z1 + 0.04);
  darkBox.span(-WALL_X - 0.01, -WALL_X + WALL + 0.01, SIDE_DOOR.height, SIDE_DOOR.height + 0.04, SIDE_DOOR.z0 - 0.04, SIDE_DOOR.z1 + 0.04);

  /* ── проём в тоннель ───────────────────────────────────────────────── */
  // Дверь в переднем торце убрана: двери в начале поезда не бывает.
  // Остаётся голый проём — служебный лаз в тоннель, без наличника, петель
  // и ручки, чтобы он не читался как вторая дверь.

  /* ── пульт ─────────────────────────────────────────────────────────── */

  // тумба: от пола до столешницы, справа под стеклом
  deskBox.span(-0.18, 1.02, 0, 0.9, -12.6, -12.1);
  // столешница
  deskBox.span(-0.2, 1.04, 0.9, 0.94, -12.6, -12.1);
  // наклонная приборная панель
  const panelQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(PANEL_SLOPE, 0, 0));
  deskBox.box(0.42, 1.015, -12.47, 1.16, 0.03, 0.3, panelQ);

  /** Точка на наклонной панели: u — вдоль борта, v — вверх по панели. */
  const onPanel = (u: number, v: number, lift = 0.02): THREE.Vector3 =>
    new THREE.Vector3(u, lift, v).applyQuaternion(panelQ).add(PANEL_CENTER);

  // приборы: два круглых индикатора скорости и давления
  const gauges = [
    { u: -0.44, v: 0.0 },
    { u: -0.26, v: 0.0 },
  ];
  for (const g of gauges) {
    const p = onPanel(g.u, g.v, 0);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(panelQ);
    const to = p.clone().addScaledVector(normal, -0.018);
    const from = p.clone().addScaledVector(normal, 0.012);
    chromeTube.cyl(from.x, from.y, from.z, to.x, to.y, to.z, 0.062); // обечайка
    faceBox.box(to.x, to.y, to.z, 0.1, 0.004, 0.1, panelQ); // светящееся поле
    // стрелка: короткая риска под углом
    const needleQ = panelQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.9));
    darkBox.box(
      to.x + Math.cos(-0.9) * 0.018,
      to.y + 0.004,
      to.z - Math.sin(-0.9) * 0.018,
      0.05,
      0.002,
      0.004,
      needleQ,
    );
  }

  // кнопки: три ряда по одиннадцать
  const buttonColours = [redBox, darkBox, whiteBox];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 11; i++) {
      const p = onPanel(-0.02 + i * 0.052, -0.04 + row * 0.05);
      buttonColours[(i + row) % 3].box(p.x, p.y, p.z, 0.032, 0.016, 0.026, panelQ);
    }
  }

  // табло состояния: тусклая зелёная полоска
  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.05, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x0a1410, emissive: 0x0d2418, roughness: 0.4 }),
  );
  const displayAt = onPanel(0.08, 0.09, 0.045);
  display.position.copy(displayAt);
  display.quaternion.copy(panelQ);
  display.name = 'cab-display';
  group.add(display);

  // реверсор: чёрный рычаг с шаром
  darkTube.cyl(0.95, 0.94, -12.22, 0.92, 1.16, -12.16, 0.02);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), dark);
  knob.position.set(0.92, 1.18, -12.16);
  knob.name = 'cab-knob';
  group.add(knob);

  // тубус с начертом — та самая картонная труба из сценария
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.52, 10), face);
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0.68, 0.97, -12.24);
  group.add(tube);

  /* ── микрофон и тангента ───────────────────────────────────────────── */

  // микрофон на гибкой стойке: пять коротких колен, чтобы читался изгиб
  const micBase = new THREE.Vector3(0.16, 0.95, -12.42);
  const micPoints = [
    new THREE.Vector3(0.16, 0.95, -12.42),
    new THREE.Vector3(0.15, 1.05, -12.4),
    new THREE.Vector3(0.12, 1.16, -12.34),
    new THREE.Vector3(0.07, 1.24, -12.26),
    new THREE.Vector3(0.02, 1.28, -12.18),
  ];
  for (let i = 0; i < micPoints.length - 1; i++) {
    darkTube.tube(micPoints[i], micPoints[i + 1], 0.011);
  }
  const micHead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.075, 8), dark);
  micHead.position.set(0.0, 1.3, -12.15);
  micHead.rotation.x = Math.PI / 2.2;
  micHead.name = 'cab-microphone';
  group.add(micHead);
  darkBox.box(micBase.x, 0.945, micBase.z, 0.07, 0.03, 0.07);

  // тангента: трубка на крючке справа от пульта, шнур уходит в столешницу
  const handset = new THREE.Group();
  handset.name = 'cab-tangent';
  handset.position.set(1.0, 0.78, -12.18);
  const handsetBody = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.05), dark);
  handsetBody.position.y = 0;
  handset.add(handsetBody);
  for (const dy of [-0.1, 0.1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.055), dark);
    ear.position.set(0, dy, 0);
    handset.add(ear);
  }
  handset.rotation.z = 0.06;
  group.add(handset);
  // крючок
  chromeTube.cyl(1.0, 0.86, -12.18, 1.0, 0.9, -12.18, 0.008);
  // шнур: спираль из коротких колен
  for (let i = 0; i < 9; i++) {
    const a = i * 0.9;
    const y = 0.72 - i * 0.032;
    chromeTube.cyl(
      1.0 + Math.cos(a) * 0.045,
      y,
      -12.18 + Math.sin(a) * 0.045,
      1.0 + Math.cos(a + 0.9) * 0.045,
      y - 0.032,
      -12.18 + Math.sin(a + 0.9) * 0.045,
      0.006,
    );
  }

  /* ── кресло машиниста ──────────────────────────────────────────────── */

  const seatX = 0.42;
  // тумба и стойка
  darkBox.box(seatX, 0.05, -11.8, 0.32, 0.1, 0.3);
  chromeTube.cyl(seatX, 0.08, -11.8, seatX, 0.42, -11.8, 0.07);
  // подушка, спинка и подголовник: между подушкой и спинкой оставлен зазор,
  // иначе кресло читается одним кубом
  vinylBox.box(seatX, 0.44, -11.76, 0.5, 0.09, 0.42);
  const backQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16, 0, 0));
  vinylBox.box(seatX, 0.84, -11.5, 0.48, 0.5, 0.09, backQ);
  // подголовник
  vinylBox.box(seatX, 1.14, -11.45, 0.26, 0.13, 0.09, backQ);
  // подлокотники
  for (const dx of [-0.26, 0.26]) {
    vinylBox.box(seatX + dx, 0.63, -11.7, 0.055, 0.045, 0.26);
    chromeTube.cyl(seatX + dx, 0.46, -11.6, seatX + dx, 0.63, -11.6, 0.012);
  }
  // рама спинки — стальной каркас за винилом
  chromeTube.cyl(seatX - 0.23, 0.47, -11.58, seatX - 0.23, 1.05, -11.48, 0.011);
  chromeTube.cyl(seatX + 0.23, 0.47, -11.58, seatX + 0.23, 1.05, -11.48, 0.011);

  /* ── красные стулья ─────────────────────────────────────────────────── */

  // Обычные кухонные табуреты, принесённые из дома. Второй собран, но
  // спрятан: по сценарию он «появляется», когда в кабину заходят третьим.
  const stoolX = 0.72;
  const stoolZ = -11.05;

  const makeSeat = (x: number, z: number, name: string): THREE.Mesh => {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12), red);
    top.position.set(x, 0.45, z);
    top.name = name;
    return top;
  };

  const stoolLegs = (x: number, z: number, legs: TubeBatch): void => {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      legs.cyl(x + sx * 0.1, 0.43, z + sz * 0.1, x + sx * 0.17, 0, z + sz * 0.17, 0.014);
    }
    // нижний раскос: без него табурет кажется парящим
    legs.cyl(x - 0.13, 0.16, z - 0.13, x + 0.13, 0.16, z + 0.13, 0.01);
    legs.cyl(x - 0.13, 0.16, z + 0.13, x + 0.13, 0.16, z - 0.13, 0.01);
  };

  const stoolTop = makeSeat(stoolX, stoolZ, 'cab-stool');
  group.add(stoolTop);
  stoolLegs(stoolX, stoolZ, redTube);

  const secondStool = new THREE.Group();
  secondStool.name = 'cab-stool-2';
  secondStool.visible = false;
  const secondX = -0.72;
  const secondZ = -11.2;
  secondStool.add(makeSeat(secondX, secondZ, 'cab-stool-2-seat'));
  const secondLegs = new TubeBatch(red);
  stoolLegs(secondX, secondZ, secondLegs);
  const secondLegMesh = secondLegs.build('cab-stool-2-legs');
  if (secondLegMesh) secondStool.add(secondLegMesh);
  group.add(secondStool);

  /* ── шкаф, аптечка, мелочи на стенах ───────────────────────────────── */

  // шкаф с аппаратурой у правой стены: серая коробка с ручкой
  darkBox.span(0.9, 1.1, 0, 1.75, -10.72, -10.34);
  chromeTube.cyl(0.89, 1.05, -10.51, 0.89, 1.12, -10.51, 0.008);
  // аптечка (в сценарии её забирают): белая коробка с крестом
  whiteBox.span(1.06, 1.1, 1.32, 1.6, -11.0, -10.72);
  redBox.span(1.055, 1.06, 1.44, 1.49, -10.9, -10.82);
  redBox.span(1.055, 1.06, 1.4, 1.53, -10.88, -10.84);
  // щиток с тумблерами у двери в вагон
  darkBox.span(-1.1, -1.08, 1.5, 1.78, -10.5, -10.16);
  for (let i = 0; i < 3; i++) {
    whiteBox.span(-1.075, -1.07, 1.58 + i * 0.06, 1.6 + i * 0.06, -10.42, -10.34);
  }
  // поручень у боковой двери, чтобы держаться на ходу
  chromeTube.cyl(-0.9, 1.55, -11.5, -0.55, 1.55, -11.5, 0.015);
  chromeTube.cyl(-0.9, 1.55, -11.5, -0.9, 1.75, -11.5, 0.015);
  chromeTube.cyl(-0.55, 1.55, -11.5, -0.55, 1.75, -11.5, 0.015);

  /* ── свет ──────────────────────────────────────────────────────────── */

  // один плафон над пультом: в кабине не должно быть светло, как днём
  darkBox.span(-0.2, 0.2, 2.34, 2.38, -11.75, -10.85);
  const cabLamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.8), lamp);
  cabLamp.position.set(0, 2.33, -11.3);
  cabLamp.name = 'lamp';
  group.add(cabLamp);

  /* ── сборка ────────────────────────────────────────────────────────── */

  const lamps: THREE.Object3D[] = [cabLamp];
  const batches: Array<[string, ReturnType<BoxBatch['build']>]> = [
    ['cab-floor', floorBox.build('cab-floor', { receive: true })],
    ['cab-ceiling', ceilingBox.build('cab-ceiling', { receive: true })],
    ['cab-paint', paintBox.build('cab-paint', { cast: true, receive: true })],
    ['cab-low', lowBox.build('cab-low')],
    ['cab-dark', darkBox.build('cab-dark')],
    ['cab-desk', deskBox.build('cab-desk', { cast: true })],
    ['cab-chrome', chromeBox.build('cab-chrome')],
    ['cab-chrome-tubes', chromeTube.build('cab-chrome-tubes')],
    ['cab-dark-tubes', darkTube.build('cab-dark-tubes')],
    ['cab-vinyl', vinylBox.build('cab-vinyl', { cast: true })],
    ['cab-glass', glassBox.build('cab-glass')],
    ['cab-red', redBox.build('cab-red')],
    ['cab-red-tubes', redTube.build('cab-red-tubes')],
    ['cab-white', whiteBox.build('cab-white')],
    ['cab-face', faceBox.build('cab-face')],
  ];

  for (const [name, mesh] of batches) {
    if (!mesh) continue;
    mesh.name = name;
    group.add(mesh);
  }

  /* ── границы и коллизии ────────────────────────────────────────────── */

  const colliders: Box2[] = [
    // пульт
    { minX: -0.2, maxX: 1.04, minZ: -12.6, maxZ: -12.1 },
    // кресло
    { minX: seatX - 0.3, maxX: seatX + 0.3, minZ: -12.0, maxZ: -11.44 },
    // табурет
    { minX: stoolX - 0.19, maxX: stoolX + 0.19, minZ: stoolZ - 0.19, maxZ: stoolZ + 0.19 },
    // шкаф
    { minX: 0.88, maxX: 1.1, minZ: -10.74, maxZ: -10.32 },
  ];

  const lightSpots: LightSpot[] = [
    { x: 0, y: 2.1, z: -11.3, color: 0xdfe8ff, intensity: 7, distance: 8 },
    // подсветка от стены: без неё спинка кресла, повёрнутая к двери, стоит
    // чёрным силуэтом — отражённого света в рендере нет, его приходится добавлять
    { x: 0.35, y: 1.15, z: -10.5, color: 0xcfd8e4, intensity: 4.5, distance: 5 },
    // холод снаружи боковой двери: сам источник за стеной, светит в проём
    { x: -2.0, y: 1.4, z: -11.9, color: 0x9fc4e8, intensity: 4, distance: 5 },
  ];

  group.userData.lightSpots = lightSpots;
  group.userData.interactive = { microphone: micHead, tangent: handset, tube };
  group.userData.stools = [stoolTop, secondStool];
  group.userData.door = {
    // створка из вагона — в car.ts, тут отдаём её живую ссылку
    get back(): THREE.Group | null {
      return cabDoorLeaf();
    },
    side: sideDoor,
  };

  return {
    group,
    colliders,
    bounds: { minX: CAB.minX, maxX: CAB.maxX, minZ: CAB.zFront, maxZ: CAB.zBack },
    lamps,
  };
}
