/**
 * Мелкие предметы в мире: то, что можно взять руками.
 *
 * Модели — из `predmets/` (копии в `client/public/models/items/`), грузятся
 * асинхронно и подменяют самодельную фигурку, когда придут. До загрузки
 * (и если файла нет) остаётся прежняя простая фигура: предмет не исчезает
 * и не мигает. Расстановка по-прежнему живёт в content/props.json.
 *
 * Масштабы: файлы уже в метрах, подгонка нужна только аптечке (в модели
 * 0.07 м высоты вместо 0.25) и тубусу (0.8 м вместо 0.6).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface ItemModel {
  file: string;
  /** Сдвиг модели в мире: чтобы не вставала в стену. */
  offset?: [number, number, number];
  /** Множитель к метрам из glb, если автор нарисовал не в масштабе. */
  scale?: number;
}

/** Что во что: id предмета в content/props.json → файл модели. */
const ITEMS: Record<string, ItemModel> = {
  // в кабине
  cab_paper: { file: 'drawing.glb' },
  paper: { file: 'drawing.glb' },
  cab_medkit: { file: 'medkit.glb', scale: 2.2, offset: [-0.12, 0, 0] },
  cab_voltmeter: { file: 'voltmeter.glb' },
  cab_tube: { file: 'tube.glb', scale: 0.75 },
  cab_pencil: { file: 'pencil.glb' },
  cab_candy: { file: 'candy.glb', scale: 0.8 },

  // те же вещи по «человеческим» именам — на случай предметов в других локациях
  bottle: { file: 'bottle.glb' },
  phone: { file: 'phone.glb' },
  flashlight: { file: 'flashlight.glb' },
  candy: { file: 'candy.glb' },
  medkit: { file: 'medkit.glb', scale: 2.2 },
  voltmeter: { file: 'voltmeter.glb' },
  tube: { file: 'tube.glb', scale: 0.75 },
  pencil: { file: 'pencil.glb' },
  drawing: { file: 'drawing.glb' },
  splint: { file: 'splint.glb' },
};

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

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Один запрос на файл, сколько бы предметов его ни просило. */
function loadModel(file: string): Promise<THREE.Object3D | null> {
  const cached = cache.get(file);
  if (cached) return cached;

  const promise = loader
    .loadAsync(`/models/items/${file}`)
    .then((gltf) => {
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      return gltf.scene;
    })
    .catch((error) => {
      // нет файла — остаётся самодельная фигурка, игра идёт дальше
      console.info('[предметы] модель не загрузилась:', file, error);
      return null;
    });

  cache.set(file, promise);
  return promise;
}

/** Подменить фигурку моделью, когда она приедет. Группа уже стоит в сцене. */
function swapIn(group: THREE.Group, entry: ItemModel): void {
  void loadModel(entry.file).then((scene) => {
    if (!scene) return;
    const model = scene.clone(true);
    model.scale.setScalar(entry.scale ?? 1);
    if (entry.offset) model.position.set(entry.offset[0], entry.offset[1], entry.offset[2]);
    group.clear();
    group.add(model);
    console.info('[предметы] модель встала:', entry.file);
  });
}

/** Простая фигура под конкретный предмет: заглушка до загрузки модели. */
function createPlaceholder(id: string): THREE.Object3D | null {
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

  return group;
}

/** Файл модели для id: нужен руке от первого лица. */
export function itemModelFile(id: string): string | null {
  return ITEMS[id]?.file ?? null;
}

/** Загрузка модели предмета (кэш общий с предметами в мире). */
export { loadModel as loadItemModel };

/** Предмет в мир: группа с заглушкой, которую заменит модель из predmets/. */
export function createPropMesh(id: string): THREE.Object3D | null {
  const entry = ITEMS[id];
  const placeholder = createPlaceholder(id);
  if (!entry && !placeholder) return null;

  const group = new THREE.Group();
  group.name = `prop_${id}`;
  if (placeholder) group.add(placeholder);
  if (entry) swapIn(group, entry);

  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  return group;
}
