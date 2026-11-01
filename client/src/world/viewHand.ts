/**
 * Рука от первого лица.
 *
 * Висит на камере, поэтому второй проход рендера не нужен. Материалы
 * неосвещённые (`MeshBasicMaterial`): в тёмном вагоне PBR-рука уходила
 * в чёрный. Объём читается не светом, а разными тонами кожи на ладони,
 * пальцах и рукаве.
 *
 * Две позы:
 *  - предмет в руке (`setItem`) — кисть снизу-справа, предмет стоит в ладони;
 *  - телефон в интро (`holdPhone`) — отдельная кисть с пальцами, обхватившими
 *    низ трубки, и большим пальцем на экране. Телефон держится в правой
 *    нижней четверти кадра, чтобы не перекрывать субтитры по центру.
 *
 * Покачивание: ходьба 6 мм, дыхание 1.5 мм, без инерции — прицел не плывёт.
 */

import * as THREE from 'three';

import { itemModelFile, loadItemModel } from './propMeshes';

/** Поза руки с предметом в системе камеры: справа-снизу, чуть к центру. */
const HAND_POSITION = new THREE.Vector3(0.21, -0.2, -0.62);
const HAND_ROTATION = new THREE.Euler(-0.12, -0.38, 0.12, 'YXZ');

/** Телефон в интро: правая нижняя четверть, экран к лицу. */
const PHONE_POSITION = new THREE.Vector3(0.15, -0.13, -0.46);
const PHONE_ROTATION = new THREE.Euler(-0.28, -0.16, 0.1, 'YXZ');

/** Тона: кожа светлее вагона, иначе рука сливается с темнотой. */
const SKIN = 0xb98a6b;
const SKIN_LIGHT = 0xcda083;
const SKIN_DARK = 0x9c7057;
const SLEEVE = 0x2f3d4f;
const CUFF = 0x22303f;

function viewMaterial(color: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color });
  // рука рисуется поверх мира: ствол не должен её протыкать
  material.depthTest = false;
  material.depthWrite = false;
  return material;
}

export class ViewHand {
  /** Вся рука: её и вешаем на камеру. */
  readonly root = new THREE.Group();
  /** Кисть с предметом. */
  private readonly hand = new THREE.Group();
  /** Кисть, держащая телефон: своя геометрия и своя поза. */
  private readonly phoneHand = new THREE.Group();
  private readonly grip = new THREE.Group();
  private readonly phoneGrip = new THREE.Group();

  private item: THREE.Object3D | null = null;
  private itemId: string | null = null;
  private phone = false;
  private time = 0;
  /** Сглаженная скорость камеры 0..1: по ней амплитуда покачивания. */
  private step = 0;
  private readonly lastPosition = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.root.name = 'viewHand';
    this.root.renderOrder = 900;
    this.root.visible = false;

    this.hand.renderOrder = 900;
    this.hand.position.copy(HAND_POSITION);
    this.hand.rotation.copy(HAND_ROTATION);
    this.hand.scale.setScalar(0.72);

    const skin = viewMaterial(SKIN);
    const skinLight = viewMaterial(SKIN_LIGHT);
    const skinDark = viewMaterial(SKIN_DARK);
    const sleeve = viewMaterial(SLEEVE);
    const cuff = viewMaterial(CUFF);

    const box = (
      parent: THREE.Object3D,
      w: number,
      h: number,
      d: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 900;
      parent.add(mesh);
      return mesh;
    };

    // ── кисть с предметом: предплечье, ладонь, согнутые пальцы ──────────
    box(this.hand, 0.07, 0.07, 0.24, skin, 0, -0.01, 0.16);
    box(this.hand, 0.085, 0.085, 0.05, cuff, 0, -0.01, 0.29);
    box(this.hand, 0.1, 0.1, 0.12, sleeve, 0, -0.02, 0.37);
    box(this.hand, 0.085, 0.05, 0.1, skinLight, 0, 0.005, 0.0);
    box(this.hand, 0.08, 0.045, 0.075, skin, 0, 0.02, -0.075);
    const thumbItem = box(this.hand, 0.032, 0.032, 0.07, skinDark, -0.045, 0.02, -0.03);
    thumbItem.rotation.y = 0.5;

    this.grip.position.set(0, 0.03, -0.05);
    this.grip.rotation.set(0.12, -0.3, 0.08);
    this.hand.add(this.grip);

    // ── кисть с телефоном ───────────────────────────────────────────────
    this.phoneHand.renderOrder = 900;
    this.phoneHand.visible = false;

    // предплечье уходит вправо-вниз, к краю кадра
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.052, 0.3, 10), skin);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(0.03, -0.06, 0.16);
    forearm.renderOrder = 900;
    this.phoneHand.add(forearm);

    const cuffMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.05, 10), cuff);
    cuffMesh.rotation.x = Math.PI / 2;
    cuffMesh.position.set(0.03, -0.065, 0.29);
    cuffMesh.renderOrder = 900;
    this.phoneHand.add(cuffMesh);

    const sleeveMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.14, 10), sleeve);
    sleeveMesh.rotation.x = Math.PI / 2;
    sleeveMesh.position.set(0.03, -0.07, 0.38);
    sleeveMesh.renderOrder = 900;
    this.phoneHand.add(sleeveMesh);

    // ладонь — плоская коробка за телефоном, чуть повёрнута
    const palm = box(this.phoneHand, 0.085, 0.1, 0.032, skin, 0.01, -0.005, 0.045);
    palm.rotation.z = -0.08;

    // четыре пальца обхватывают низ трубки: видно подушечки с лицевой стороны
    for (let i = 0; i < 4; i++) {
      const finger = box(
        this.phoneHand,
        0.019,
        0.055,
        0.021,
        i % 2 === 0 ? skin : skinLight,
        -0.028 + i * 0.022,
        -0.075,
        0.012,
      );
      finger.rotation.x = -0.5;
      finger.rotation.z = (i - 1.5) * 0.06;
    }

    // большой палец лежит на экране слева
    const thumb = box(this.phoneHand, 0.022, 0.075, 0.02, skinDark, -0.045, -0.02, -0.012);
    thumb.rotation.set(-0.35, 0, 0.5);

    this.phoneGrip.position.set(0.005, -0.005, -0.02);
    this.phoneGrip.rotation.set(1.35, 0, 0);
    this.phoneHand.add(this.phoneGrip);

    this.root.add(this.hand, this.phoneHand);
    camera.add(this.root);
    camera.updateMatrixWorld(true);
    this.lastPosition.setFromMatrixPosition(camera.matrixWorld);
  }

  /** Выбранный предмет: id из инвентаря. null — руку убрать. */
  setItem(id: string | null): void {
    if (id === this.itemId) return;
    this.itemId = id;

    if (this.item && this.item.parent === this.grip) {
      this.grip.remove(this.item);
      this.item = null;
    }

    if (!id) {
      this.refreshVisible();
      return;
    }

    const file = itemModelFile(id);
    if (!file) {
      this.refreshVisible();
      return;
    }

    void loadItemModel(file).then((scene) => {
      if (this.itemId !== id || !scene) return;
      const model = scene.clone(true);
      this.dressModel(model);
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

    this.hand.visible = !on;
    this.phoneHand.visible = on;

    if (on) {
      this.phoneHand.position.copy(PHONE_POSITION);
      this.phoneHand.rotation.copy(PHONE_ROTATION);
      this.setPhoneModel();
      this.refreshVisible();
    } else {
      this.phoneGrip.clear();
      this.item = null;
      this.refreshVisible();
    }
  }

  private setPhoneModel(): void {
    void loadItemModel('phone.glb').then((scene) => {
      if (!this.phone || !scene) return;
      const model = scene.clone(true);
      this.dressModel(model);

      // модель лежит в XZ; ставим её на ребро и центрируем в группе
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);

      const holder = new THREE.Group();
      holder.add(model);
      holder.rotation.x = -0.12;
      this.phoneGrip.clear();
      this.phoneGrip.add(holder);
      this.refreshVisible();
    });
  }

  /** Материалы модели: копии для руки, рисуются поверх мира и светлее. */
  private dressModel(model: THREE.Object3D): void {
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.material = Array.isArray(node.material)
        ? node.material.map((m) => this.overlay(m))
        : this.overlay(node.material);
      node.renderOrder = 901;
    });
  }

  private overlay(source: THREE.Material): THREE.Material {
    const material = source.clone();
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = false;
    const standard = material as THREE.MeshStandardMaterial;
    if (standard.color) standard.color.multiplyScalar(1.7);
    if (standard.emissive) standard.emissive.setRGB(0.16, 0.14, 0.12);
    return material;
  }

  private refreshVisible(): void {
    this.root.visible = this.phone || this.item !== null;
  }

  /** Кадр. Скорость ходьбы берём из движения камеры, от main.ts нужен только вызов. */
  update(dt: number): void {
    if (!this.root.visible) return;
    this.time += dt;

    const position = this.tmp.setFromMatrixPosition(this.camera.matrixWorld);
    const speed = position.distanceTo(this.lastPosition) / Math.max(0.001, dt);
    this.lastPosition.copy(position);

    const target = Math.min(1, speed / 1.8);
    this.step += (target - this.step) * Math.min(1, dt * 6);

    const swayX = Math.sin(this.time * 7.2) * 0.006 * this.step;
    const swayY = Math.cos(this.time * 3.6) * 0.004 * this.step;
    const breathY = Math.sin(this.time * 1.25) * 0.0015;

    const base = this.phone ? PHONE_POSITION : HAND_POSITION;
    const active = this.phone ? this.phoneHand : this.hand;
    active.position.set(
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
