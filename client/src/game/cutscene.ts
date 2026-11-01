/**
 * Плеер катсцен.
 *
 * Данные — обычный JSON: путь камеры по точкам и дорожка событий (субтитры,
 * свет, телефон в руках). Плеер локальный и косметический: сервер только
 * говорит «играй вот эту», мир в это время не останавливается, а пропуск
 * по Esc ни на кого не влияет.
 *
 * Позицию игрока сцена не меняет — после неё камера возвращается туда, где была,
 * а игрок встаёт сам, уже под управлением игры.
 */

import * as THREE from 'three';

export interface CameraKey {
  t: number;
  /** Мировые координаты или, при anchor: 'player', — [вправо, вверх, вперёд] от игрока. */
  pos: [number, number, number];
  look: [number, number, number];
}

/** Что делать с телефоном в руках. */
export type PhoneAction = 'play' | 'freeze' | 'net' | 'lower' | 'hide';

export interface CutsceneTrack {
  t: number;
  sub?: string;
  lights?: number;
  phone?: PhoneAction;
  /** Для phone: 'play' — файл видео. */
  src?: string;
}

export interface CutsceneData {
  id: string;
  duration: number;
  skippable?: boolean;
  /** 'player' — камера задана относительно игрока: так сцена садится на любое место. */
  anchor?: 'player';
  camera: CameraKey[];
  tracks?: CutsceneTrack[];
}

export interface CutsceneAnchor {
  x: number;
  z: number;
  yaw: number;
}

export interface CutsceneHandlers {
  onSubtitle?: (text: string) => void;
  onLights?: (value: number) => void;
  onPhone?: (action: PhoneAction, src?: string) => void;
  /** yaw и pitch камеры на последнем кадре: игра продолжает с этого взгляда. */
  onEnd?: (yaw: number, pitch: number) => void;
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
    private readonly anchor?: () => CutsceneAnchor,
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
      if (track.phone !== undefined) this.handlers.onPhone?.(track.phone, track.src);
    });

    if (this.time >= data.duration) this.finish();
  }

  private finish(): void {
    // куда смотрела камера на последнем кадре — оттуда продолжит игрок
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const yaw = Math.atan2(-direction.x, -direction.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));

    this.data = null;
    this.handlers.onPhone?.('hide');
    this.camera.position.copy(this.savedPosition);
    this.camera.quaternion.copy(this.savedQuaternion);
    this.handlers.onSubtitle?.('');
    this.handlers.onEnd?.(yaw, pitch);
  }

  /** Локальная точка [вправо, вверх, вперёд] → мировые координаты. */
  private toWorld(data: CutsceneData, p: [number, number, number], out = new THREE.Vector3()): THREE.Vector3 {
    if (data.anchor !== 'player' || !this.anchor) return out.fromArray(p);

    const a = this.anchor();
    const [right, up, forward] = p;
    const sin = Math.sin(a.yaw);
    const cos = Math.cos(a.yaw);
    return out.set(
      a.x + right * cos - forward * sin,
      up,
      a.z - right * sin - forward * cos,
    );
  }

  private applyCamera(data: CutsceneData, t: number): void {
    const keys = data.camera;
    if (keys.length === 0) return;
    if (keys.length === 1) {
      this.camera.position.copy(this.toWorld(data, keys[0].pos));
      this.camera.lookAt(this.toWorld(data, keys[0].look));
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

    const position = this.toWorld(data, from.pos).lerp(this.toWorld(data, to.pos, new THREE.Vector3()), k);
    const look = this.toWorld(data, from.look).lerp(this.toWorld(data, to.look, new THREE.Vector3()), k);

    this.camera.position.copy(position);
    this.camera.lookAt(look);
  }
}
