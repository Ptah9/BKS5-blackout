/**
 * Другие игроки и агенты: модель (или силуэт) и подпись с именем.
 *
 * Модели приходят из charachters/*.glb: агент носит свою (поле model в данных),
 * игроку достаётся модель из пула по id. Если файл ещё не загрузился или
 * не открылся — остаётся прежняя капсула, а когда модель появится,
 * силуэт заменится сам.
 */

import * as THREE from 'three';

import type { RemotePlayer } from '../net/replica';
import type { Characters, CharacterId } from '../world/characters';
import { CharacterIdle } from '../world/characterAnim';

interface Entry {
  root: THREE.Group;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
  /** Капсула вместо модели: заменим, как только модель загрузится. */
  fallback: boolean;
  modelId: CharacterId;
  /** Процедурное «дыхание»: у ригованных моделей нет клипов. */
  idle: CharacterIdle | null;
}

/** Живым игрокам — одна общая модель; всё именное закреплено за агентами. */
const PLAYER_MODEL: CharacterId = 'stand';

function modelFor(player: RemotePlayer): CharacterId {
  return (player.model as CharacterId | undefined) ?? PLAYER_MODEL;
}

function makeLabel(name: string): { sprite: THREE.Sprite; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('нет 2d-контекста для подписи');

  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 34px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillText(name, 128, 33);
  ctx.fillStyle = '#cfd8e6';
  ctx.fillText(name, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.1, 0.28, 1);
  sprite.position.y = 2.02;

  return { sprite, texture };
}

/** Цвет корпуса зависит от id: двое не будут одинаковыми случайно. */
function hueFor(id: number): number {
  return (id * 137.508) % 360;
}

export class RemotePlayers {
  readonly group = new THREE.Group();
  /** Общий доворот моделей в радианах: подгонка направления на глаз. */
  turnOffset = 0;

  private readonly entries = new Map<number, Entry>();

  constructor(private readonly characters: Characters | null = null) {
    this.group.name = 'remotePlayers';
    // пока загружаются модели — подпись над капсулой никому не мешает
  }

  update(players: readonly RemotePlayer[], dt = 0): void {
    const seen = new Set<number>();

    for (const player of players) {
      seen.add(player.id);
      const modelId = modelFor(player);
      let entry = this.entries.get(player.id);

      // была капсула, а модель уже загрузилась — пересобираем
      if (entry && entry.fallback && this.characters?.has(modelId)) {
        this.drop(player.id, entry);
        entry = undefined;
      }

      if (!entry) {
        entry = this.create(player, modelId);
        this.entries.set(player.id, entry);
      }

      entry.root.position.set(player.x, 0, player.z);
      // у агента yaw из данных («лицом в проход»), у живого игрока — как у камеры:
      // модели собраны лицом в +Z, поэтому игроку нужен разворот на пол-оборота
      entry.root.rotation.y = (player.model ? player.yaw : player.yaw + Math.PI) + this.turnOffset;
      entry.idle?.update(dt);
    }

    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.drop(id, entry);
    }
  }

  private create(player: RemotePlayer, modelId: CharacterId): Entry {
    const root = new THREE.Group();
    const model = this.characters?.create(modelId) ?? null;

    if (model) {
      root.add(model);
    } else {
      const hue = hueFor(player.id);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue / 360, 0.35, 0.45),
        roughness: 0.9,
        metalness: 0.05,
        emissive: new THREE.Color().setHSL(hue / 360, 0.4, 0.06),
      });

      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.35, 7), bodyMaterial);
      body.position.y = 0.72;
      body.castShadow = true;

      const headMaterial = new THREE.MeshStandardMaterial({ color: 0x8d6f5a, roughness: 0.85 });
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), headMaterial);
      head.position.y = 1.58;

      root.add(body, head);
    }

    const { sprite, texture } = makeLabel(player.name);
    // у НПС имени над головой нет: у них id начиная с 1000, это не игроки
    if (player.id >= 1000) sprite.visible = false;
    root.add(sprite);
    this.group.add(root);

    return {
      root,
      label: sprite,
      labelTexture: texture,
      fallback: model === null,
      modelId,
      idle: model ? new CharacterIdle(model, Math.random()) : null,
    };
  }

  private drop(id: number, entry: Entry): void {
    this.group.remove(entry.root);
    entry.root.traverse((object) => {
      // геометрия и материал моделей общие — их не освобождаем
      if (object instanceof THREE.Mesh && object.userData.own) {
        object.geometry.dispose();
      }
    });
    entry.labelTexture.dispose();
    (entry.label.material as THREE.SpriteMaterial).dispose();
    this.entries.delete(id);
  }

  dispose(): void {
    for (const [id, entry] of [...this.entries]) this.drop(id, entry);
  }
}
