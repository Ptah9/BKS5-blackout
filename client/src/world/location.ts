/**
 * Общее для всех локаций за вагоном: интерфейс, повторение текстур и батчи.
 *
 * Интерфейс `Location` — договор с основным агентом: он подключает модули
 * к main.ts и чанкам и менять эту форму не должен. Всё, что нужно сверх
 * неё (подсказки по свету, имена интерактивных предметов), кладётся
 * в `group.userData` — это дополнение, а не изменение формы.
 *
 * Почему батчи, а не меши: кабина — это сотни мелких коробок (кнопки, лампы,
 * петли). Каждый Mesh — отдельный draw call, а у нас и так низкое разрешение
 * и дешёвый рендер. Коробки с одним материалом собираются в InstancedMesh.
 */

import * as THREE from 'three';

import type { Box2, Bounds } from './collision';

export interface Location {
  group: THREE.Group;
  colliders: Box2[];
  bounds: Bounds;
  /** Что загорается вместе с общим светом. У мешей имя `lamp`. */
  lamps: THREE.Object3D[];
}

/**
 * Куда поставить лампу. Модуль сам свет не создаёт: в игре светом управляет
 * сценарий (main.ts), а в предпросмотре — страница. Формат один на всех.
 */
export interface LightSpot {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export function tiled(texture: THREE.Texture, repeatX: number, repeatY: number): THREE.Texture {
  const tex = texture.clone();
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Основа батча: копит матрицы и один раз собирает InstancedMesh.
 * Геометрия создаётся своя на каждый батч, а не общая на модуль:
 * chunks.ts при выгрузке чанка диспозит геометрию каждого меша,
 * и общая геометрия умерла бы вместе с первым выгруженным куском.
 */
abstract class InstanceBatch {
  private readonly matrices: THREE.Matrix4[] = [];
  protected readonly material: THREE.Material;

  protected constructor(material: THREE.Material, private readonly geometry: THREE.BufferGeometry) {
    this.material = material;
  }

  protected push(matrix: THREE.Matrix4): void {
    this.matrices.push(matrix);
  }

  build(name: string, options: { cast?: boolean; receive?: boolean } = {}): THREE.InstancedMesh | null {
    if (this.matrices.length === 0) {
      this.geometry.dispose();
      return null;
    }

    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.matrices.length);
    this.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = options.cast ?? false;
    mesh.receiveShadow = options.receive ?? true;
    return mesh;
  }
}

const IDENTITY = new THREE.Quaternion();

/** Коробки: одна единичная геометрия, размер задаётся масштабом. */
export class BoxBatch extends InstanceBatch {
  constructor(material: THREE.Material) {
    super(material, new THREE.BoxGeometry(1, 1, 1));
  }

  box(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotation: THREE.Quaternion = IDENTITY,
  ): this {
    const position = new THREE.Vector3(x, y, z);
    const scale = new THREE.Vector3(sx, sy, sz);
    this.push(new THREE.Matrix4().compose(position, rotation, scale));
    return this;
  }

  /** Коробка по двум углам — для стен и плит удобнее, чем центр с размером. */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): this {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** Трубы и стойки: единичный цилиндр вдоль Y, растягивается на отрезок. */
export class TubeBatch extends InstanceBatch {
  constructor(material: THREE.Material) {
    super(material, new THREE.CylinderGeometry(1, 1, 1, 8, 1, false));
  }

  /** Отрезок от a до b толщиной radius. */
  tube(a: THREE.Vector3, b: THREE.Vector3, radius: number): this {
    const direction = new THREE.Vector3().subVectors(b, a);
    const length = direction.length();
    if (length < 1e-5) return this;

    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
    const position = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const scale = new THREE.Vector3(radius, length, radius);
    this.push(new THREE.Matrix4().compose(position, quaternion, scale));
    return this;
  }

  cyl(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number): this {
    return this.tube(new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), radius);
  }
}

/** Плоская декаль (мел, табло): чуть впереди стены, без записи в глубину. */
export function decal(
  texture: THREE.Texture,
  options: { width: number; height: number; lit?: boolean } = { width: 1, height: 1 },
): THREE.Mesh {
  const material = options.lit
    ? new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        roughness: 0.95,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.width, options.height), material);
  mesh.renderOrder = 2;
  return mesh;
}
