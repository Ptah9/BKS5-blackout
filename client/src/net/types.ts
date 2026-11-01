/** Типы состояния, которые приходят с сервера. */

export interface PlayerView {
  id: number;
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Модель персонажа: агенты приходят из content/npcs.json, у игроков её нет. */
  model?: string;
}
