/**
 * Мелкие предметы в мире: то, что можно взять руками.
 *
 * Раньше это были только точки взаимодействия — подсказка появлялась,
 * а смотреть было не на что. Здесь каждой вещи рисуется простая фигура
 * по её id; расстановка по-прежнему живёт в content/props.json.
 */

import * as THREE from 'three';

const MATERIALS = {
  paper: new THREE.MeshStandardMaterial({ color: 0xd9d3c2, roughness: 0.95 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8b949e, roughness: 0.45, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb33a3a, roughness: 0.8 }),
  white: new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.8 }),
  cardboard: new THREE.MeshStandardMaterial({ color: 0xa8845a, roughness: 0.9 }),
  pencil: new THREE.MeshStandardMaterial({ color: 0xd8b64a, roughness: 0.6 }),
  candy: new THREE.MeshStandardMaterial({ color: 0xc46a8f, roughness: 0.7 }),
};

/** Простая фигура под конкретный предмет. */
export function createPropMesh(id: string): THREE.Object3D | null {
  const group = new THREE.Group();

  switch (id) {
    case 'cab_paper': {
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.004, 0.22), MATERIALS.paper);
      sheet.rotation.y = 0.4;
      group.add(sheet);
      break;
    }

    case 'cab_tangenta': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.1), MATERIALS.dark);
      const handset = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.22), MATERIALS.dark);
      handset.position.y = 0.05;
      handset.rotation.x = 0.12;
      group.add(base, handset);
      break;
    }

    case 'cab_medkit': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.2), MATERIALS.white);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.005), MATERIALS.red);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.005), MATERIALS.red);
      crossV.position.set(0, 0.04, 0.103);
      crossH.position.set(0, 0.04, 0.103);
      group.add(body, crossV, crossH);
      break;
    }

    case 'cab_voltmeter': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.07), MATERIALS.dark);
      const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), MATERIALS.red);
      probe.position.set(0.09, -0.06, 0);
      probe.rotation.z = 1.1;
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10), MATERIALS.white);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, 0.04, 0.04);
      group.add(body, probe, dial);
      break;
    }

    case 'cab_tube': {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), MATERIALS.cardboard);
      tube.rotation.z = Math.PI / 2;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 12), MATERIALS.dark);
      cap.rotation.z = Math.PI / 2;
      cap.position.x = 0.28;
      group.add(tube, cap);
      break;
    }

    case 'cab_pencil': {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), MATERIALS.pencil);
      shaft.rotation.z = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 6), MATERIALS.dark);
      tip.rotation.z = -Math.PI / 2;
      tip.position.x = 0.09;
      group.add(shaft, tip);
      break;
    }

    case 'cab_candy': {
      for (let i = 0; i < 3; i++) {
        const candy = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), MATERIALS.candy);
        candy.position.set(i * 0.06 - 0.06, 0, (i % 2) * 0.04);
        candy.rotation.y = i * 0.5;
        group.add(candy);
      }
      break;
    }

    default:
      return null;
  }

  group.name = `prop_${id}`;
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return group;
}
