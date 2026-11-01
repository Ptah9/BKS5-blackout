/**
 * Модели персонажей.
 *
 * Все файлы — по одному мешу без скелета и анимаций, рост в метрах, ноги
 * на y = 0. Поэтому клон дешевле, чем инстанс: геометрия и материал общие,
 * а каждый персонаж — своя группа с поворотом.
 *
 * Модель смотрит в +Z: в протоколе yaw как у камеры (взгляд в −Z),
 * поэтому при расстановке поворот считается с поправкой на пол-оборота.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/** Сидящие модели: у них лицо нарисовано на общей текстуре, и оно пугает.
 *  Им ставим плоский материал в тон вагону. */



/** Имя модели → файл. Имена короткие: так они же лежат в данных сценария. */
const FILES = {
  vladimir: 'vladimir.glb',
  obhodchik: 'obhodchik.glb',
  ganvest: 'ganvest.glb',
  rabochii: 'rabochii.glb',
  teacher: 'teacher.glb',
  altyshka: 'altyshka.glb',
  maksim: 'maksim.glb',
  mashinist: 'mashinist.glb',
  dima: 'dima_red_t-shirt.glb',
  sidit: 'npc_sidit.glb',
  /** Связист: чёрная футболка, золотые кроссовки. */
  svyazi_def: 'svyazi_def.glb',
  /** Модель игроков: у живых игроков своей нет, все ходят в одной. */
  stand: 'npc_stand.glb',
  velosiped: 'velosiped.glb',
} as const;

export type CharacterId = keyof typeof FILES;

/** Вещь в вагоне: модель плюс её место. Логики у таких объектов нет. */
export interface SceneryItem {
  model: string;
  x: number;
  z: number;
  y?: number;
  yaw?: number;
}

/**
 * Накладки без скина (плоское лицо, шеврон, фонарь в руке) — если такие
 * в модели есть — привязываем к ближайшей кости. Иначе они стоят на месте,
 * пока тело и голова двигаются: ровно тот баг «текстура лица не едет».
 * В нынешних 18 моделях таких мешей нет (один скиннинг-меш), вызов пустой.
 */
function bindLooseMeshes(root: THREE.Object3D): number {
  const bones: THREE.Bone[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Bone) bones.push(node);
  });
  if (bones.length === 0) return 0;

  const loose: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !(node instanceof THREE.SkinnedMesh)) loose.push(node);
  });
  if (loose.length === 0) return 0;

  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const bonePoint = new THREE.Vector3();

  for (const mesh of loose) {
    mesh.getWorldPosition(point);
    let nearest: THREE.Bone | null = null;
    let nearestDistance = Infinity;
    for (const bone of bones) {
      bone.getWorldPosition(bonePoint);
      const distance = bonePoint.distanceToSquared(point);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = bone;
      }
    }
    // attach сохраняет мировую позу: накладка не прыгает в момент привязки
    if (nearest) nearest.attach(mesh);
  }

  console.info('[модели] накладки без скина привязаны к костям:', loose.length);
  return loose.length;
}

export class Characters {
  private readonly prototypes = new Map<CharacterId, THREE.Object3D>();
  private readonly loader = new GLTFLoader();

  /** Грузит всё разом: 1.4 МБ на LAN — быстрее, чем подгружать по одному. */
  async load(): Promise<void> {
    const entries = Object.entries(FILES) as Array<[CharacterId, string]>;
    await Promise.all(
      entries.map(async ([id, file]) => {
        try {
          const gltf = await this.loader.loadAsync(`/models/${file}`);
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          this.prototypes.set(id, gltf.scene);
        } catch (error) {
          console.info('[модели] не загрузилась:', file, error);
        }
      }),
    );
  }

  has(id: CharacterId): boolean {
    return this.prototypes.has(id);
  }

  /** Копия модели. Геометрия и материал общие — это не утечка, а экономия.
   *  Скелет копируется отдельно: обычный clone() дал бы общую ссылку
   *  на кости, и все персонажи дёргались бы синхронно. */
  create(id: CharacterId): THREE.Object3D | null {
    const prototype = this.prototypes.get(id);
    if (!prototype) return null;
    const model = cloneSkeleton(prototype);
    bindLooseMeshes(model);
    return model;
  }
}
