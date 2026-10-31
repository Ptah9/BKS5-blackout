/** Типы состояния, которые приходят с сервера. */

export interface PlayerView {
  id: number;
  name: string;
  x: number;
  z: number;
  yaw: number;
}
