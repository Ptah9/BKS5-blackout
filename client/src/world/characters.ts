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
    return prototype ? cloneSkeleton(prototype) : null;
  }
}
