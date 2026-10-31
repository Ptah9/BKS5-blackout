/**
 * Тоннель: труба с рёбрами, рельсы и кабели.
 *
 * Виден через стёкла вагона и понадобится, когда игрок выйдет наружу.
 * Геометрия нарочно грубая: десять сегментов на трубу, четыре на ребро.
 */

import * as THREE from 'three';

const TUNNEL_LENGTH = 60;
const TUNNEL_RADIUS = 2.9;
const TUNNEL_Y = 1.1;

export function buildTunnel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tunnel';

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x2b2e33,
    roughness: 1,
    side: THREE.BackSide,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x484d54, roughness: 0.45, metalness: 0.9 });

  // труба: цилиндр боком, рисуем изнутри
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(TUNNEL_RADIUS, TUNNEL_RADIUS, TUNNEL_LENGTH, 10, 1, true),
    concrete,
  );
  tube.rotation.x = Math.PI / 2;
  tube.position.y = TUNNEL_Y;
  tube.receiveShadow = true;
  group.add(tube);

  // рёбра жёсткости каждые три метра
  const ribGeo = new THREE.TorusGeometry(TUNNEL_RADIUS - 0.04, 0.09, 4, 8);
  const ribCount = 20;
  const ribs = new THREE.InstancedMesh(ribGeo, dark, ribCount);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < ribCount; i++) {
    matrix.makeTranslation(0, TUNNEL_Y, -TUNNEL_LENGTH / 2 + 1.5 + i * 3);
    ribs.setMatrixAt(i, matrix);
  }
  ribs.instanceMatrix.needsUpdate = true;
  group.add(ribs);

  // пол тоннеля и рельсы
  const floor = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, TUNNEL_LENGTH), dark);
  floor.position.set(0, -0.62, 0);
  floor.receiveShadow = true;
  group.add(floor);

  for (const x of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, TUNNEL_LENGTH), steel);
    rail.position.set(x, -0.5, 0);
    group.add(rail);
  }

  // кабели по стене
  for (const [x, y] of [[-2.72, 1.6], [2.66, 2.0]] as const) {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, TUNNEL_LENGTH), dark);
    cable.position.set(x, y, 0);
    group.add(cable);
  }

  return group;
}
