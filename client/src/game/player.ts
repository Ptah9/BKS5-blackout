/**
 * Игрок: движение от первого лица с весом, коллизии и покачиванием камеры.
 *
 * Позиция считается в плоскости XZ, высота глаз постоянная — прыжков у нас нет.
 * Скорость не задаётся напрямую, а подтягивается к целевой: отсюда ощущение
 * массы, а не «мыльницы на льду».
 */

import * as THREE from 'three';

import type { Input } from '../core/input';
import { clampToBounds, resolveCircle, type Bounds, type Box2 } from '../world/collision';

export const EYE_HEIGHT = 1.6;

/** Высота глаз сидя: колени подняты, камера ниже стоячей. */
export const SEAT_EYE_HEIGHT = 1.08;

/** Куда шагнуть из сиденья — в проход, ближе к центру вагона. */
const AISLE_X = 0.42;
const STAND_DURATION = 1.3;

const RADIUS = 0.32;
const WALK_SPEED = 2.3;
const RUN_SPEED = 4.0;
const ACCEL = 14;
const PITCH_LIMIT = 1.35;
const BOB_AMPLITUDE = 0.032;

export class Player {
  readonly position = new THREE.Vector3(0, EYE_HEIGHT, 8.4);

  private readonly velocity = new THREE.Vector2(); // x, z
  private yaw = 0;
  private pitch = 0;
  private bobPhase = 0;
  private bob = 0;
  /** Высота глаз: сидя ниже, вставая — поднимается. */
  private eyeY = EYE_HEIGHT;
  private seated = false;
  /** Анимация подъёма: шаг из сиденья в проход вместе с высотой камеры. */
  private rising: { fromX: number; toX: number; k: number } | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(dt: number, input: Input, colliders: readonly Box2[], bounds: Bounds): void {
    // поднимаемся: движение забрано на время вставания
    if (this.rising) {
      this.rising.k = Math.min(1, this.rising.k + dt / STAND_DURATION);
      const k = smooth(this.rising.k);
      this.position.x = this.rising.fromX + (this.rising.toX - this.rising.fromX) * k;
      this.eyeY = SEAT_EYE_HEIGHT + (EYE_HEIGHT - SEAT_EYE_HEIGHT) * k;
      if (this.rising.k >= 1) this.rising = null;
      this.camera.position.set(this.position.x, this.eyeY, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }

    // сидим: камеру держит катсцена, а ходить нельзя
    if (this.seated) {
      input.consumeLook();
      this.camera.position.set(this.position.x, this.eyeY, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }

    const look = input.consumeLook();
    this.yaw -= look.x * input.sensitivity;
    this.pitch -= look.y * input.sensitivity;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    const forward =
      (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) -
      (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
    const strafe =
      (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) -
      (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0);
    const speed = input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? RUN_SPEED : WALK_SPEED;

    let dirX = 0;
    let dirZ = 0;
    if (forward !== 0 || strafe !== 0) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      dirX = fx * forward + rx * strafe;
      dirZ = fz * forward + rz * strafe;
      const length = Math.hypot(dirX, dirZ);
      dirX /= length;
      dirZ /= length;
    }

    // экспоненциальное сглаживание: не зависит от частоты кадров
    const k = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (dirX * speed - this.velocity.x) * k;
    this.velocity.y += (dirZ * speed - this.velocity.y) * k;

    const wantX = this.position.x + this.velocity.x * dt;
    const wantZ = this.position.z + this.velocity.y * dt;

    const inBounds = clampToBounds(bounds, wantX, wantZ, RADIUS);
    const resolved = resolveCircle(colliders, inBounds.x, inBounds.z, RADIUS);

    // упёрлись в стену — гасим скорость по этой оси, иначе персонаж «дрожит»
    if (Math.abs(resolved.x - wantX) > 1e-4) this.velocity.x = 0;
    if (Math.abs(resolved.z - wantZ) > 1e-4) this.velocity.y = 0;

    this.position.x = resolved.x;
    this.position.z = resolved.z;

    const speedNow = Math.hypot(this.velocity.x, this.velocity.y);
    const intensity = Math.min(speedNow / RUN_SPEED, 1);

    this.bobPhase += dt * (6.5 + intensity * 4.5);
    this.bob += (intensity * BOB_AMPLITUDE - this.bob) * Math.min(1, dt * 8);

    const bobY = Math.sin(this.bobPhase) * this.bob;
    const roll = Math.sin(this.bobPhase * 0.5) * this.bob * 0.4;

    this.eyeY = EYE_HEIGHT;
    this.camera.position.set(this.position.x, EYE_HEIGHT + bobY, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
  }

  /** Нужно катсценам и звуку шагов: идёт человек или стоит. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.y);
  }

  /** Куда смотрит игрок — это уходит на сервер вместе с позицией. */
  get facing(): number {
    return this.yaw;
  }

  /** Сидит или уже встаёт — на это время управление забрано. */
  get isSitting(): boolean {
    return this.seated || this.rising !== null;
  }

  /** Посадить на место: сервер присылает координаты сиденья при старте игры. */
  sitDown(x: number, z: number, yaw: number): void {
    this.teleport(x, z, yaw);
    this.pitch = 0;
    this.seated = true;
    this.rising = null;
    this.eyeY = SEAT_EYE_HEIGHT;
  }

  /** Встать и шагнуть в проход — уже после того, как убрал телефон. */
  standUp(): void {
    if (!this.seated) return;
    this.seated = false;
    this.rising = {
      fromX: this.position.x,
      toX: this.position.x > 0 ? AISLE_X : -AISLE_X,
      k: 0,
    };
  }

  /** Поставить взгляд так, как закончилась катсцена — без рывка на стыке. */
  setView(yaw: number, pitch = 0): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Поставить игрока по данным сервера: при входе и после переподключения. */
  teleport(x: number, z: number, yaw: number): void {
    this.position.x = x;
    this.position.z = z;
    this.yaw = yaw;
    this.velocity.set(0, 0);
  }
}

function smooth(k: number): number {
  return k * k * (3 - 2 * k);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
