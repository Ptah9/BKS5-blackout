/**
 * Пассажиры в вагоне.
 *
 * Модели — из charachters/*.glb: сидящие ставятся одной позой, стоящие
 * берутся из небольшого пула, чтобы вагон не выглядел клонированным.
 * Расстановка остаётся в данных (content/passengers.json), здесь только сборка.
 *
 * Если модель не загрузилась, ставим прежний силуэт: пустой вагон хуже,
 * чем грубый.
 */

import * as THREE from 'three';

import type { Characters, CharacterId } from './characters';
import { CharacterIdle } from './characterAnim';

export interface PassengerSpot {
  x: number;
  z: number;
  yaw: number;
  pose: 'sit' | 'stand';
  coat?: string;
}

/** Кто из стоящих стоит в проходе: только обезличенная модель, чтобы не
 *  плодить двойников агентов (Максим Игоревич, Учительница и прочие — по одному). */
const STANDING_POOL: CharacterId[] = ['stand'];

/** Силуэт-заглушка: тот же разворот, что у моделей. */
const SILHOUETTE_FACING = 0;

const SKIN = 0x9a7358;

export class Passengers {
  readonly group = new THREE.Group();
  /** Общий доворот всех фигур в радианах: для подгонки на глаз. */
  turnOffset = 0;
  /** Сдвиг сидящих: чуть вперёд к проходу и чуть вверх с сиденья, метры. */
  seatForward = 0.5;
  seatUp = 0.06;

  private readonly seated: Array<{ object: THREE.Object3D; x: number; z: number; yaw: number }> = [];
  private readonly idles: CharacterIdle[] = [];

  constructor(spots: readonly PassengerSpot[], characters: Characters | null) {
    this.group.name = 'passengers';

    spots.forEach((spot, index) => {
      const id: CharacterId = spot.pose === 'sit' ? 'sidit' : STANDING_POOL[index % STANDING_POOL.length];
      const model = characters?.create(id) ?? null;

      if (!model) {
        const silhouette = this.silhouette(spot);
        silhouette.userData.baseYaw = spot.yaw + SILHOUETTE_FACING;
        silhouette.position.set(spot.x, 0, spot.z);
        this.group.add(silhouette);
        if (spot.pose === 'sit') {
          this.seated.push({ object: silhouette, x: spot.x, z: spot.z, yaw: spot.yaw });
        }
        return;
      }

      // рост ±5%: иначе двадцать одинаковых фигур читаются как копипаста
      const scale = 0.96 + ((index * 7) % 9) * 0.011;
      model.scale.setScalar(scale);
      model.position.set(spot.x, 0, spot.z);
      // модели собраны лицом в +Z, yaw в данных — «лицом в проход»
      model.userData.baseYaw = spot.yaw;
      model.rotation.y = spot.yaw;
      this.group.add(model);
      // пассажир не статуя: голова поворачивается, спина дышит.
      // Сид — не только индекс: у стоящих в разных концах вагона
      // характер (темп дыхания, фаза, тяга к телефону) тоже разный.
      const seed = (index * 0.37 + Math.abs(spot.x) * 0.13 + Math.abs(spot.z) * 0.07) % 1;
      this.idles.push(new CharacterIdle(model, seed));

      if (spot.pose === 'sit') {
        this.seated.push({ object: model, x: spot.x, z: spot.z, yaw: spot.yaw });
      }
    });

    this.applySeatOffsets();
  }

  /** Сидящие садятся не в спинку, а на край сиденья — и чуть выше пола. */
  applySeatOffsets(): void {
    for (const seat of this.seated) {
      seat.object.position.set(
        seat.x + Math.sin(seat.yaw) * this.seatForward,
        this.seatUp,
        seat.z + Math.cos(seat.yaw) * this.seatForward,
      );
    }
  }

  /** Довернуть все фигуры: нужно, когда смотрим на глаз и правим на градусы. */
  applyTurn(): void {
    for (const child of this.group.children) {
      child.rotation.y = Number(child.userData.baseYaw ?? 0) + this.turnOffset;
    }
  }

  /** Запасной вариант: прежний силуэт из капсулы и головы. */
  private silhouette(spot: PassengerSpot): THREE.Group {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.yaw + SILHOUETTE_FACING;
    const color = new THREE.Color(spot.coat ?? '#4a5568');
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, spot.pose === 'sit' ? 0.7 : 1.25, 7),
      new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    );
    body.position.y = spot.pose === 'sit' ? 0.78 : 0.63;
    body.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 7, 5),
      new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.85 }),
    );
    head.position.y = spot.pose === 'sit' ? 1.17 : 1.45;

    group.add(body, head);
    return group;
  }

  /** Оживить пассажиров: вызывается из общего цикла кадров. */
  update(dt: number): void {
    for (const idle of this.idles) idle.update(dt);
  }

  dispose(): void {
    // без этого вышедшие из сцены фигуры остаются целями для соседей
    for (const idle of this.idles) idle.dispose();
    this.idles.length = 0;
    this.group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
  }
}
