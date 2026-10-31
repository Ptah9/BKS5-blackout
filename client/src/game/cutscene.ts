/**
 * Плеер катсцен.
 *
 * Данные — обычный JSON: путь камеры по точкам и дорожка субтитров со светом.
 * Плеер локальный и косметический: сервер только говорит «играй вот эту»,
 * мир в это время не останавливается, а пропуск по Esc ни на кого не влияет.
 *
 * Позицию игрока сцена не меняет — после неё камера возвращается туда, где была.
 */

import * as THREE from 'three';

export interface CameraKey {
  t: number;
  pos: [number, number, number];
  look: [number, number, number];
}

export interface CutsceneTrack {
  t: number;
  sub?: string;
  lights?: number;
}

export interface CutsceneData {
  id: string;
  duration: number;
  skippable?: boolean;
  camera: CameraKey[];
  tracks?: CutsceneTrack[];
}

export interface CutsceneHandlers {
  onSubtitle?: (text: string) => void;
  onLights?: (value: number) => void;
  onEnd?: () => void;
}

const smooth = (k: number): number => k * k * (3 - 2 * k);

export class CutscenePlayer {
  private data: CutsceneData | null = null;
  private time = 0;
  private fired = new Set<number>();

  private readonly savedPosition = new THREE.Vector3();
  private readonly savedQuaternion = new THREE.Quaternion();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly handlers: CutsceneHandlers = {},
  ) {}

  get playing(): boolean {
    return this.data !== null;
  }

  get currentId(): string | null {
    return this.data?.id ?? null;
  }

  start(data: CutsceneData): void {
    this.data = data;
    this.time = 0;
    this.fired.clear();
    this.savedPosition.copy(this.camera.position);
    this.savedQuaternion.copy(this.camera.quaternion);
  }

  /** Пропуск: возвращает камеру на место и сообщает, что сцена кончилась. */
  skip(): void {
    if (!this.data) return;
    this.finish();
  }

  update(dt: number): void {
    const data = this.data;
    if (!data) return;

    this.time += dt;
    this.applyCamera(data, this.time);

    (data.tracks ?? []).forEach((track, index) => {
      if (this.fired.has(index)) return;
      if (track.t > this.time) return;

      this.fired.add(index);
      if (track.sub !== undefined) this.handlers.onSubtitle?.(track.sub);
      if (track.lights !== undefined) this.handlers.onLights?.(track.lights);
    });

    if (this.time >= data.duration) this.finish();
  }

  private finish(): void {
    this.data = null;
    this.camera.position.copy(this.savedPosition);
    this.camera.quaternion.copy(this.savedQuaternion);
    this.handlers.onSubtitle?.('');
    this.handlers.onEnd?.();
  }

  private applyCamera(data: CutsceneData, t: number): void {
    const keys = data.camera;
    if (keys.length === 0) return;
    if (keys.length === 1) {
      this.camera.position.fromArray(keys[0].pos);
      this.camera.lookAt(new THREE.Vector3().fromArray(keys[0].look));
      return;
    }

    let from = keys[0];
    let to = keys[keys.length - 1];

    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        from = keys[i];
        to = keys[i + 1];
        break;
      }
    }

    const span = Math.max(0.001, to.t - from.t);
    const k = smooth(Math.min(1, Math.max(0, (t - from.t) / span)));

    const position = new THREE.Vector3().fromArray(from.pos).lerp(new THREE.Vector3().fromArray(to.pos), k);
    const look = new THREE.Vector3().fromArray(from.look).lerp(new THREE.Vector3().fromArray(to.look), k);

    this.camera.position.copy(position);
    this.camera.lookAt(look);
  }
}
