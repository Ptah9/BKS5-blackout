/**
 * Силуэты других игроков и подписи с именами.
 *
 * Настоящих персонажей с анимацией не делаем: в темноте видно силуэт, а имя
 * над головой объясняет, кто это. Держим это дешёвым — по одной капсуле
 * и одной спрайт-подписи на игрока.
 */

import * as THREE from 'three';

import type { RemotePlayer } from '../net/replica';

interface Entry {
  root: THREE.Group;
  label: THREE.Sprite;
  labelTexture: THREE.CanvasTexture;
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

  private readonly entries = new Map<number, Entry>();

  constructor() {
    this.group.name = 'remotePlayers';
  }

  update(players: readonly RemotePlayer[]): void {
    const seen = new Set<number>();

    for (const player of players) {
      seen.add(player.id);
      let entry = this.entries.get(player.id);

      if (!entry) {
        const root = new THREE.Group();
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

        const { sprite, texture } = makeLabel(player.name);

        root.add(body, head, sprite);
        this.group.add(root);

        entry = { root, label: sprite, labelTexture: texture };
        this.entries.set(player.id, entry);
      }

      entry.root.position.set(player.x, 0, player.z);
      // модель смотрит в +Z, а yaw в протоколе — как у камеры (взгляд в -Z)
      entry.root.rotation.y = player.yaw + Math.PI;
    }

    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue;
      this.group.remove(entry.root);
      entry.root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      entry.labelTexture.dispose();
      (entry.label.material as THREE.SpriteMaterial).dispose();
      this.entries.delete(id);
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.entries.clear();
  }
}
