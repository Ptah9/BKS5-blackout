/**
 * HUD: слоты инвентаря, пульс, положение и плашка мыслей.
 *
 * Обычные DOM-элементы поверх canvas: дешевле, чем рисовать текст в 3D,
 * и правится без сборки.
 *
 * Пока инвентарь открыт всегда и управляется цифрами 1–6, а комбинирование —
 * клавишей C. Мышь занята камерой, поэтому кликать по слотам нельзя.
 */

import { ITEM_TABLE, type Inventory } from '../game/inventory';

export class Hud {
  private readonly invEl = document.getElementById('inv') as HTMLElement;
  private readonly bpmEl = document.getElementById('v-bpm') as HTMLElement;
  private readonly placeEl = document.getElementById('v-place') as HTMLElement;
  private readonly thoughtEl = document.getElementById('thought') as HTMLElement;

  private readonly slotEls: HTMLElement[] = [];
  private thoughtTimer = 0;

  constructor(private readonly inventory: Inventory) {
    this.invEl.innerHTML = '';
    for (let i = 0; i < inventory.slots.length; i++) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'slot';
      slot.dataset.index = String(i);
      this.invEl.appendChild(slot);
      this.slotEls.push(slot);
    }
    this.renderSlots();
  }

  renderSlots(): void {
    this.inventory.slots.forEach((id, i) => {
      const el = this.slotEls[i];
      const item = id ? ITEM_TABLE[id] : null;
      el.textContent = item ? item.short : '';
      el.title = item ? item.name : '';
      el.classList.toggle('filled', Boolean(item));
      el.classList.toggle('selected', this.inventory.selected.includes(i));
      el.dataset.key = String(i + 1);
    });
  }

  setPulse(bpm: number, level: number): void {
    this.bpmEl.textContent = String(bpm);
    this.bpmEl.classList.toggle('high', level > 0.65);
    this.bpmEl.classList.toggle('mid', level > 0.4 && level <= 0.65);
  }

  setPlace(text: string): void {
    this.placeEl.textContent = text;
  }

  /** Плашка мыслей: показывается на несколько секунд и гаснет сама. */
  say(text: string, seconds = 5): void {
    this.thoughtEl.textContent = text;
    this.thoughtEl.classList.remove('hidden');
    this.thoughtTimer = seconds;
  }

  tick(dt: number): void {
    if (this.thoughtTimer <= 0) return;
    this.thoughtTimer -= dt;
    if (this.thoughtTimer <= 0) this.thoughtEl.classList.add('hidden');
  }
}
