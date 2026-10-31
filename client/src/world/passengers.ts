/**
 * Пассажиры в вагоне.
 *
 * Пока это низкополигональные силуэты: торс, голова, у сидящих — на сиденье.
 * Задача — чтобы вагон не выглядел пустым, пока делаются модели. Когда придут
 * .glb, здесь меняется только сборка меша, расстановка останется в данных.
 *
 * Всё ставится инстансами: два вызова отрисовки на весь вагон, а не сорок.
 */

import * as THREE from 'three';

export interface PassengerSpot {
  x: number;
  z: number;
  yaw: number;
  pose: 'sit' | 'stand';
  coat?: string;
}

const SKIN = 0x9a7358;

export class Passengers {
  readonly group = new THREE.Group();

  constructor(spots: readonly PassengerSpot[]) {
    this.group.name = 'passengers';

    const seated = spots.filter((spot) => spot.pose === 'sit');
    const standing = spots.filter((spot) => spot.pose === 'stand');

    this.buildSeated(seated);
    this.buildStanding(standing);
  }

  private buildSeated(spots: readonly PassengerSpot[]): void {
    if (spots.length === 0) return;

    // торс сидящего: чуть наклонён к проходу, поэтому просто коробка на сиденье
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.62, 0.34);
    const torsoMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 });
    const torsos = new THREE.InstancedMesh(torsoGeo, torsoMat, spots.length);
    torsos.castShadow = true;
    torsos.receiveShadow = true;

    const headGeo = new THREE.SphereGeometry(0.115, 7, 5);
    const headMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const color = new THREE.Color();

    spots.forEach((spot, index) => {
      quaternion.setFromEuler(new THREE.Euler(0, spot.yaw, 0));

      position.set(spot.x, 0.78, spot.z);
      matrix.compose(position, quaternion, scale);
      torsos.setMatrixAt(index, matrix);
      torsos.setColorAt(index, color.set(spot.coat ?? '#4a5568'));

      position.set(spot.x, 1.17, spot.z);
      matrix.compose(position, quaternion, scale);
      heads.setMatrixAt(index, matrix);
    });

    torsos.instanceMatrix.needsUpdate = true;
    if (torsos.instanceColor) torsos.instanceColor.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;

    this.group.add(torsos, heads);
  }

  private buildStanding(spots: readonly PassengerSpot[]): void {
    if (spots.length === 0) return;

    const bodyGeo = new THREE.CylinderGeometry(0.17, 0.21, 1.25, 7);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 });
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, spots.length);
    bodies.castShadow = true;

    const headGeo = new THREE.SphereGeometry(0.115, 7, 5);
    const headMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const rotation = new THREE.Quaternion();
    const color = new THREE.Color();

    spots.forEach((spot, index) => {
      rotation.setFromEuler(new THREE.Euler(0, spot.yaw, 0));

      position.set(spot.x, 0.63, spot.z);
      matrix.compose(position, rotation, scale);
      bodies.setMatrixAt(index, matrix);
      bodies.setColorAt(index, color.set(spot.coat ?? '#4a5568'));

      position.set(spot.x, 1.45, spot.z);
      matrix.compose(position, quaternion, scale);
      heads.setMatrixAt(index, matrix);
    });

    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;

    this.group.add(bodies, heads);
  }

  dispose(): void {
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });
  }
}
