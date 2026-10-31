/**
 * Реплика чужих игроков на клиенте.
 *
 * Сервер присылает позиции 20 раз в секунду, рендер идёт на 60+. Без сглаживания
 * движение выглядело бы рывками, поэтому между пакетами позиция подтягивается
 * экспоненциально — тот же приём, что для скорости персонажа.
 *
 * Если игрок пропал из пакетов дольше чем на пять секунд, он убирается:
 * закрывший вкладку не должен стоять в вагоне призраком.
 */

import type { PlayerView } from './types';

export interface RemotePlayer extends PlayerView {
  targetX: number;
  targetZ: number;
  targetYaw: number;
  lastSeen: number;
}

export class Replica {
  private readonly players = new Map<number, RemotePlayer>();

  apply(list: readonly PlayerView[], selfId: number, now: number): void {
    for (const view of list) {
      if (view.id === selfId) continue;

      const existing = this.players.get(view.id);
      if (existing) {
        existing.name = view.name;
        existing.targetX = view.x;
        existing.targetZ = view.z;
        existing.targetYaw = view.yaw;
        existing.lastSeen = now;
      } else {
        this.players.set(view.id, {
          ...view,
          targetX: view.x,
          targetZ: view.z,
          targetYaw: view.yaw,
          lastSeen: now,
        });
      }
    }
  }

  step(dt: number, now: number, ttl = 5000): RemotePlayer[] {
    const k = 1 - Math.exp(-12 * dt);
    const out: RemotePlayer[] = [];

    for (const [id, player] of this.players) {
      if (now - player.lastSeen > ttl) {
        this.players.delete(id);
        continue;
      }

      player.x += (player.targetX - player.x) * k;
      player.z += (player.targetZ - player.z) * k;

      // угол поворачиваем по кратчайшей дуге, иначе игрок крутится через «ноль»
      let delta = player.targetYaw - player.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      player.yaw += delta * k;

      out.push(player);
    }

    return out;
  }

  clear(): void {
    this.players.clear();
  }
}
