/**
 * Живая поза персонажа: у моделей есть скелет, но нет клипов анимации.
 *
 * Пока клипов нет, «idle» делается процедурно: голова медленно поворачивается,
 * спина еле дышит. Этого хватает, чтобы фигуры не выглядели статуями,
 * и не надо тащить AnimationMixer с пустыми дорожками.
 */

import * as THREE from 'three';

export class CharacterIdle {
  private head: THREE.Bone | null = null;
  private spine: THREE.Bone | null = null;
  private readonly baseHeadY: number;
  private readonly baseSpineX: number;
  private phase: number;

  constructor(root: THREE.Object3D, seed = Math.random()) {
    root.traverse((node) => {
      if (!(node instanceof THREE.Bone)) return;
      if (node.name === 'head') this.head = node;
      if (node.name === 'spine') this.spine = node;
    });

    this.baseHeadY = this.head?.rotation.y ?? 0;
    this.baseSpineX = this.spine?.rotation.x ?? 0;
    this.phase = seed * Math.PI * 2;
  }

  update(dt: number): void {
    this.phase += dt;

    if (this.head) {
      // поворот головы: редко и вяло, как у человека, которому нечего делать
      this.head.rotation.y = this.baseHeadY + Math.sin(this.phase * 0.55) * 0.16;
      this.head.rotation.x = Math.sin(this.phase * 0.9 + 1.3) * 0.03;
    }

    if (this.spine) {
      // дыхание: чуть заметный наклон вперёд-назад
      this.spine.rotation.x = this.baseSpineX + Math.sin(this.phase * 1.7) * 0.012;
    }
  }
}
