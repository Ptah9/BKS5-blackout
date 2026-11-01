/**
 * Кабина машиниста — комната за передней дверью вагона.
 *
 * Сделана простыми коробками: пол, стены, потолок, пульт, кресло.
 * Снаружи, за распахнутой дверью, начинается тоннель — пока это тёмный проём
 * с переборкой, дальше его строит отдельная задача.
 *
 * Возвращает коллайдеры и границы, чтобы игрок мог зайти внутрь и не пройти
 * сквозь стену.
 */

import * as THREE from 'three';

import type { Textures } from '../render/textures';
import type { Box2 } from './collision';

/** Кабина примыкает к торцу вагона: от z = −10 и дальше в темноту. */
const FRONT = -10;
const DEPTH = 2.4;
const HALF_WIDTH = 1.2;
const HEIGHT = 2.2;

export interface Cab {
  group: THREE.Group;
  colliders: Box2[];
  /** Дверь в вагон: пока закрыта, проход перекрыт коллайдером. */
  blocker: Box2;
  /** Петля двери: поворот вокруг неё открывает проход. */
  doorHinge: THREE.Group;
  lamps: THREE.Object3D[];
}

export function buildCab(textures: Textures): Cab {
  const group = new THREE.Group();
  group.name = 'cab';

  const colliders: Box2[] = [];
  const lamps: THREE.Object3D[] = [];

  const wall = new THREE.MeshStandardMaterial({ map: textures.panel, roughness: 0.85 });
  const floor = new THREE.MeshStandardMaterial({ map: textures.floor, roughness: 0.95 });
  const metal = new THREE.MeshStandardMaterial({ map: textures.metal, roughness: 0.6, metalness: 0.35 });
  const seat = new THREE.MeshStandardMaterial({ map: textures.fabric, roughness: 0.95 });

  const box = (
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const centerZ = FRONT - DEPTH / 2;

  // пол и потолок
  box(floor, 0, -0.04, centerZ, HALF_WIDTH * 2, 0.08, DEPTH);
  box(wall, 0, HEIGHT + 0.04, centerZ, HALF_WIDTH * 2, 0.08, DEPTH);

  // борта
  box(wall, -HALF_WIDTH - 0.04, HEIGHT / 2, centerZ, 0.08, HEIGHT, DEPTH);
  box(wall, HALF_WIDTH + 0.04, HEIGHT / 2, centerZ, 0.08, HEIGHT, DEPTH);

  // задняя стенка — с проёмом наружу: две части и перемычка
  const backZ = FRONT - DEPTH;
  box(wall, -0.8, HEIGHT / 2, backZ, 0.8, HEIGHT, 0.08);
  box(wall, 0.8, HEIGHT / 2, backZ, 0.8, HEIGHT, 0.08);
  box(wall, 0, HEIGHT - 0.15, backZ, 0.8, 0.3, 0.08);

  // пульт: наклонная панель у лобовой части
  box(metal, 0.15, 0.55, FRONT - 0.55, 1.5, 0.9, 0.5);
  box(metal, 0.15, 1.02, FRONT - 0.5, 1.5, 0.12, 0.55);

  // тангента на пульте — за неё игрок и берётся
  const tangent = box(metal, 0.55, 1.14, FRONT - 0.45, 0.16, 0.1, 0.26);
  tangent.name = 'cab_tangent';

  // кресло машиниста
  box(seat, -0.55, 0.45, FRONT - 1.1, 0.55, 0.14, 0.55);
  box(seat, -0.55, 0.78, FRONT - 1.32, 0.55, 0.6, 0.12);
  box(metal, -0.55, 0.22, FRONT - 1.1, 0.12, 0.44, 0.12);

  // красный стул: третий игрок садится сюда
  box(new THREE.MeshStandardMaterial({ color: 0x8f2323, roughness: 0.9 }), 0.62, 0.25, FRONT - 1.5, 0.42, 0.5, 0.42);
  box(new THREE.MeshStandardMaterial({ color: 0x7a1d1d, roughness: 0.9 }), 0.62, 0.55, FRONT - 1.7, 0.42, 0.6, 0.08);

  // тусклая лампа над пультом
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.04, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x2a2a22, emissive: 0x353020 }),
  );
  lamp.position.set(0.15, HEIGHT - 0.06, FRONT - 0.6);
  lamp.name = 'lamp';
  group.add(lamp);
  lamps.push(lamp);

  // ── коллайдеры ────────────────────────────────────────────────────────
  const z0 = FRONT - DEPTH;
  const z1 = FRONT;

  colliders.push({ minX: -HALF_WIDTH - 0.1, maxX: -HALF_WIDTH, minZ: z0, maxZ: z1 });
  colliders.push({ minX: HALF_WIDTH, maxX: HALF_WIDTH + 0.1, minZ: z0, maxZ: z1 });
  colliders.push({ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minZ: z0 - 0.1, maxZ: z0 });
  // пульт и кресло: в них не пройти
  colliders.push({ minX: -0.6, maxX: 0.9, minZ: FRONT - 0.8, maxZ: FRONT - 0.3 });

  // торец вагона: две части стены, между ними проём в кабину
  colliders.push({ minX: -1.4, maxX: -0.45, minZ: FRONT - 0.06, maxZ: FRONT + 0.06 });
  colliders.push({ minX: 0.45, maxX: 1.4, minZ: FRONT - 0.06, maxZ: FRONT + 0.06 });

  // пока дверь закрыта — проход перекрыт
  const blocker: Box2 = { minX: -0.5, maxX: 0.5, minZ: FRONT - 0.08, maxZ: FRONT + 0.08 };

  // дверь в вагоне: стоит в проёме, открывается поворотом вокруг петли
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.95, 0.05), wall);
  doorMesh.name = 'cabDoorLeaf';
  doorMesh.castShadow = true;
  doorMesh.position.set(0.45, 0, 0);

  const doorHinge = new THREE.Group();
  doorHinge.position.set(-0.45, 0.98, FRONT + 0.02);
  doorHinge.add(doorMesh);
  group.add(doorHinge);

  return { group, colliders, blocker, doorHinge, lamps };
}
