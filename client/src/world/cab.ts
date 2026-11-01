/**
 * Кабина машиниста — комната за передней дверью вагона.
 *
 * Простые коробки: пол, стены, потолок, пульт, кресло, маслёнка на полу.
 * Внутрь можно зайти: проём в торце вагона, за ним комната 2.6 × 3.2 м.
 * В дальней стене — тёмный проём наружу, в тоннель (его строит отдельная задача).
 */

import * as THREE from 'three';

import type { Textures } from '../render/textures';
import type { Box2 } from './collision';

/** Кабина примыкает к торцу вагона: от z = −10 и дальше в темноту. */
const FRONT = -10;
const DEPTH = 3.2;
const HALF_WIDTH = 1.3;
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
  const backZ = FRONT - DEPTH;

  // пол и потолок
  box(floor, 0, -0.04, centerZ, HALF_WIDTH * 2, 0.08, DEPTH);
  box(wall, 0, HEIGHT + 0.04, centerZ, HALF_WIDTH * 2, 0.08, DEPTH);

  // борта
  box(wall, -HALF_WIDTH - 0.04, HEIGHT / 2, centerZ, 0.08, HEIGHT, DEPTH);
  box(wall, HALF_WIDTH + 0.04, HEIGHT / 2, centerZ, 0.08, HEIGHT, DEPTH);

  // дальняя стена: справа сплошная, слева проём наружу в тоннель
  box(wall, 0.55, HEIGHT / 2, backZ, 1.5, HEIGHT, 0.08);
  box(wall, -0.95, HEIGHT - 0.25, backZ, 0.7, 0.5, 0.08);

  // пульт: у дальней стены, наклонная панель
  box(metal, 0.5, 0.5, backZ + 0.45, 1.6, 0.85, 0.45);
  box(metal, 0.5, 0.95, backZ + 0.42, 1.7, 0.14, 0.55);

  // кнопки на пульте: два ряда мелких шляпок
  for (let i = 0; i < 6; i++) {
    const button = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8),
      new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x9a4a3a : 0x3f5f7a, roughness: 0.6 }),
    );
    button.position.set(0.05 + i * 0.16, 1.04, backZ + 0.38);
    group.add(button);
  }

  // тангента на пульте
  const tangent = box(metal, 0.85, 1.1, backZ + 0.45, 0.16, 0.1, 0.26);
  tangent.name = 'cab_tangent';

  // кресло машиниста
  box(seat, 0.5, 0.45, backZ + 1.0, 0.6, 0.14, 0.55);
  box(seat, 0.5, 0.78, backZ + 0.78, 0.6, 0.62, 0.12);
  box(metal, 0.5, 0.22, backZ + 1.0, 0.12, 0.44, 0.12);

  // красный стул для третьего игрока
  const red = new THREE.MeshStandardMaterial({ color: 0x8f2323, roughness: 0.9 });
  box(red, -0.85, 0.25, FRONT - 1.3, 0.42, 0.5, 0.42);
  box(red, -0.85, 0.55, FRONT - 1.5, 0.42, 0.6, 0.08);

  // маслёнка на приборной панели: светит сама, независимо от вагонного света
  const lampBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.1, 0.15, 10),
    new THREE.MeshStandardMaterial({ color: 0x6b5a3c, roughness: 0.55, metalness: 0.5 }),
  );
  lampBody.position.set(1.1, 1.09, backZ + 0.45);
  lampBody.castShadow = true;
  group.add(lampBody);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc477 }),
  );
  flame.position.set(1.1, 1.2, backZ + 0.45);
  flame.name = 'cabFlame';
  group.add(flame);
  lamps.push(flame);

  const flameLight = new THREE.PointLight(0xffb063, 5.5, 8, 2);
  flameLight.position.set(1.1, 1.28, backZ + 0.45);
  group.add(flameLight);

  // ── коллайдеры ────────────────────────────────────────────────────────
  const z0 = backZ;
  const z1 = FRONT;

  colliders.push({ minX: -HALF_WIDTH - 0.12, maxX: -HALF_WIDTH, minZ: z0, maxZ: z1 });
  colliders.push({ minX: HALF_WIDTH, maxX: HALF_WIDTH + 0.12, minZ: z0, maxZ: z1 });
  colliders.push({ minX: -HALF_WIDTH, maxX: HALF_WIDTH, minZ: z0 - 0.1, maxZ: z0 });
  // пульт и кресло: в них не пройти
  colliders.push({ minX: -0.35, maxX: 1.35, minZ: z0 + 0.15, maxZ: z0 + 0.75 });
  colliders.push({ minX: 0.15, maxX: 0.85, minZ: z0 + 0.7, maxZ: z0 + 1.3 });
  // красный стул
  colliders.push({ minX: -1.1, maxX: -0.6, minZ: FRONT - 1.55, maxZ: FRONT - 1.05 });

  // торец вагона: две части стены, между ними проём в кабину
  colliders.push({ minX: -1.4, maxX: -0.55, minZ: FRONT - 0.06, maxZ: FRONT + 0.06 });
  colliders.push({ minX: 0.55, maxX: 1.4, minZ: FRONT - 0.06, maxZ: FRONT + 0.06 });

  // пока дверь закрыта — проход перекрыт
  const blocker: Box2 = { minX: -0.6, maxX: 0.6, minZ: FRONT - 0.08, maxZ: FRONT + 0.08 };

  // дверь в вагоне: стоит в проёме, открывается поворотом вокруг петли
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.95, 0.05), wall);
  doorMesh.name = 'cabDoorLeaf';
  doorMesh.castShadow = true;
  doorMesh.position.set(0.55, 0, 0);

  const doorHinge = new THREE.Group();
  doorHinge.position.set(-0.55, 0.98, FRONT + 0.02);
  doorHinge.add(doorMesh);
  group.add(doorHinge);

  return { group, colliders, blocker, doorHinge, lamps };
}
