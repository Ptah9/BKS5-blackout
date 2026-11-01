/**
 * Рука от первого лица.
 *
 * Геометрия висит на камере (камера в сцене есть), поэтому второй проход
 * рендера не нужен: рука едет вместе с игроком и не отстаёт от прицела.
 * Материалы руки и предмета рисуются поверх мира (`depthTest: false`,
 * `renderOrder`), иначе ствол/стена протыкают её насквозь — обычный приём
 * для viewmodel.
 *
 * Предмет берётся из `client/public/models/items/` (те же файлы, что и
 * у предметов в мире), размеры реальные: бутылка 0.23 м, тубус 0.6 м.
 * Пока модель грузится или если файла нет — рука остаётся пустой, ошибок нет.
 *
 * Покачивание: ходьба 6 мм и 4 мм по осям, дыхание 1.5 мм. Инерции нет —
 * рука не догоняет камеру, прицеливание не плывёт.
 */

import * as THREE from 'three';

import { itemModelFile, loadItemModel } from './propMeshes';

/** Поза руки в системе камеры: справа-снизу, чуть повёрнута к центру. */
const HAND_POSITION = new THREE.Vector3(0.21, -0.2, -0.62);
const HAND_ROTATION = new THREE.Euler(-0.12, -0.38, 0.12, 'YXZ');

/** Телефон в катсцене: ближе к центру и ниже, экраном к глазу. */
const PHONE_POSITION = new THREE.Vector3(0.04, -0.15, -0.5);
const PHONE_ROTATION = new THREE.Euler(-0.75, -0.25, 0.1, 'YXZ');

const SKIN = 0x9a7358;
const SLEEVE = 0x2b3a4a;
const CUFF = 0x1e2a36;

function viewMaterial(color: number): THREE.MeshBasicMaterial {
  // без света: в темноте вагона PBR-материал уходил в чёрный
  const material = new THREE.MeshBasicMaterial({ color });
  material.depthTest = false;
  material.depthWrite = false;
  return material;
}

export class ViewHand {
  /** Вся рука: её и вешаем на камеру. */
  readonly root = new THREE.Group();
  private readonly hand = new THREE.Group();
  private readonly grip = new THREE.Group();

  private item: THREE.Object3D | null = null;
  private itemId: string | null = null;
  private phone = false;
  private time = 0;
  /** Сглаженная скорость камеры 0..1: по ней амплитуда покачивания. */
  private step = 0;
  private readonly lastPosition = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.root.name = 'viewHand';
    this.root.renderOrder = 900;
    this.root.visible = false;

    this.hand.renderOrder = 900;
    this.hand.position.copy(HAND_POSITION);
    this.hand.rotation.copy(HAND_ROTATION);
    this.hand.scale.setScalar(0.72);

    const skin = viewMaterial(SKIN);
    const sleeve = viewMaterial(SLEEVE);
    const cuff = viewMaterial(CUFF);

    const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 900;
      return mesh;
    };

    // предплечье уходит к камере, манжета и рукав — у края кадра
    this.hand.add(
      box(0.07, 0.07, 0.24, skin, 0, -0.01, 0.16),
      box(0.085, 0.085, 0.05, cuff, 0, -0.01, 0.29),
      box(0.1, 0.1, 0.12, sleeve, 0, -0.02, 0.37),
      // кисть
      box(0.085, 0.05, 0.1, skin, 0, 0.005, 0.0),
      // согнутые пальцы
      box(0.08, 0.045, 0.075, skin, 0, 0.02, -0.075),
      // большой палец
      box(0.032, 0.032, 0.07, skin, -0.045, 0.02, -0.03),
    );

    // кисть под углом: предмет стоит в ладони, а не в кулаке
    const thumb = this.hand.children[5];
    thumb.rotation.y = 0.5;

    this.grip.position.set(0, 0.03, -0.05);
    this.grip.rotation.set(0.12, -0.3, 0.08);
    this.hand.add(this.grip);

    this.root.add(this.hand);
    camera.add(this.root);
    camera.updateMatrixWorld(true);
    this.lastPosition.setFromMatrixPosition(camera.matrixWorld);
  }

  /** Выбранный предмет: id из инвентаря. null — руку убрать. */
  setItem(id: string | null): void {
    if (id === this.itemId) return;
    this.itemId = id;

    if (this.item) {
      this.grip.remove(this.item);
      this.item = null;
    }

    if (!id) {
      this.refreshVisible();
      return;
    }

    const file = itemModelFile(id);
    if (!file) {
      // предмета без модели в руке не показываем: пустая рука честнее
      this.refreshVisible();
      return;
    }

    void loadItemModel(file).then((scene) => {
      if (this.itemId !== id || !scene) return;
      const model = scene.clone(true);
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => this.overlay(m))
          : this.overlay(node.material);
        node.renderOrder = 901;
      });
      model.rotation.set(0.1, -0.25, 0.05);
      this.grip.add(model);
      this.item = model;
      this.refreshVisible();
    });

    this.refreshVisible();
  }

  /** Режим «в руке телефон»: для интро, где персонаж смотрит в трубку. */
  holdPhone(on: boolean): void {
    if (this.phone === on) return;
    this.phone = on;

    if (on) {
      this.hand.position.copy(PHONE_POSITION);
      this.hand.rotation.copy(PHONE_ROTATION);
      this.grip.position.set(0, 0.02, -0.02);
      this.grip.rotation.set(-1.25, 0, 0);
      this.setPhoneModel();
      this.refreshVisible();
    } else {
      this.hand.position.copy(HAND_POSITION);
      this.hand.rotation.copy(HAND_ROTATION);
      this.grip.position.set(0, 0.03, -0.05);
      this.grip.rotation.set(0.12, -0.3, 0.08);
      if (this.item) this.grip.remove(this.item);
      this.itemId = null;
      this.refreshVisible();
    }
  }

  private setPhoneModel(): void {
    void loadItemModel('phone.glb').then((scene) => {
      if (!this.phone || !scene) return;
      if (this.item) this.grip.remove(this.item);
      const model = scene.clone(true);
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => this.overlay(m))
          : this.overlay(node.material);
        node.renderOrder = 901;
      });
      this.grip.add(model);
      this.item = model;
      this.refreshVisible();
    });
  }

  /** Копия материала для руки: свои depthTest и порядок, мир не трогаем. */
  private overlay(source: THREE.Material): THREE.Material {
    const material = source.clone();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    // тёмный вагон: у предмета в руке поднимаем яркость, иначе он чёрный
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.color) standard.color.multiplyScalar(1.6);
    if (standard.emissive) standard.emissive.setRGB(0.12, 0.12, 0.12);
    return material;
  }

  private refreshVisible(): void {
    this.root.visible = this.phone || this.item !== null;
  }

  /**
   * Кадр. `walking` не нужен: скорость берём из самой камеры, чтобы не
   * требовать от main.ts ничего, кроме вызова.
   */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;

    this.root.updateMatrixWorld(true);
    const position = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const speed = position.distanceTo(this.lastPosition) / Math.max(0.001, dt);
    this.lastPosition.copy(position);

    const target = Math.min(1, speed / 1.8);
    this.step += (target - this.step) * Math.min(1, dt * 6);

    // ходьба: восьмёрка поменьше, чтобы не мешать прицелу
    const swayX = Math.sin(this.time * 7.2) * 0.006 * this.step;
    const swayY = Math.cos(this.time * 3.6) * 0.004 * this.step;
    // дыхание: почти незаметно
    const breathY = Math.sin(this.time * 1.25) * 0.0015;

    const base = this.phone ? PHONE_POSITION : HAND_POSITION;
    this.hand.position.set(
      base.x + swayX,
      base.y + swayY + breathY,
      base.z + Math.cos(this.time * 7.2) * 0.002 * this.step,
    );
  }

  dispose(): void {
    this.camera.remove(this.root);
    this.root.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
  }
}
