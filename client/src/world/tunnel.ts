/**
 * Тоннель кусками: каждый участок строится отдельно, чтобы его можно было
 * загрузить и выгрузить независимо от остальных.
 */

import * as THREE from 'three';

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
