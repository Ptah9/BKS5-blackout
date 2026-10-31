/**
 * Инвентарь на клиенте — только отображение и выбор.
 *
 * Правду о содержимом слотов держит сервер: он проверяет рецепты и присылает
 * результат сообщением `inventory`. Клиент ничего не создаёт сам, поэтому
 * подделать предмет правкой в консоли нельзя.
 */

import { ITEMS, SLOT_COUNT } from '../../../shared/items.js';

export type Slots = Array<string | null>;

export interface ItemDef {
  id: string;
  name: string;
  short: string;
}

export const ITEM_TABLE = ITEMS as Record<string, ItemDef>;

export class Inventory {
  slots: Slots = new Array<string | null>(SLOT_COUNT).fill(null);

  private selectedSlots: number[] = [];

  get selected(): readonly number[] {
    return this.selectedSlots;
  }

  /** Применить состояние с сервера. Выделение чистим только для пустых слотов. */
  apply(slots: Slots): void {
    this.slots = [...slots];
    this.selectedSlots = this.selectedSlots.filter((i) => Boolean(this.slots[i]));
  }

  toggle(index: number): void {
    if (index < 0 || index >= this.slots.length) return;
    if (!this.slots[index]) return;

    const at = this.selectedSlots.indexOf(index);
    if (at >= 0) {
      this.selectedSlots.splice(at, 1);
      return;
    }

    this.selectedSlots.push(index);
    if (this.selectedSlots.length > 2) this.selectedSlots.shift();
  }

  /** Пара слотов для комбинирования — или null, если выбрано не два. */
  get pair(): [number, number] | null {
    if (this.selectedSlots.length !== 2) return null;
    return [this.selectedSlots[0], this.selectedSlots[1]];
  }

  has(id: string): boolean {
    return this.slots.includes(id);
  }
}
