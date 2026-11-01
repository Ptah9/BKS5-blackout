/**
 * HUD: рюкзак, пульс, положение и блокнот мыслей.
 *
 * Обычные DOM-элементы поверх canvas: дешевле, чем рисовать текст в 3D,
 * и правится без сборки.
 *
 * Рюкзак открывается кнопкой или клавишей I. Пока он открыт, курсор свободен
 * и слоты выбираются мышью; клавиши 1–8 работают всегда.
 */

import { ITEM_TABLE, type Inventory } from '../game/inventory';
import { itemIcon } from './icons';

export class Hud {
  private readonly invEl = document.getElementById('inv') as HTMLElement;
  private readonly bagEl = document.getElementById('bag') as HTMLElement;
  private readonly bagSlotsEl = document.getElementById('bag-slots') as HTMLElement;
  private readonly bagHintEl = document.getElementById('bag-hint') as HTMLElement;
  private readonly bpmEl = document.getElementById('v-bpm') as HTMLElement;
  private readonly placeEl = document.getElementById('v-place') as HTMLElement;
  private readonly thoughtEl = document.getElementById('thought') as HTMLElement;
  private readonly notesEl = document.getElementById('notes') as HTMLElement;
  private readonly notesListEl = document.getElementById('notes-list') as HTMLElement;

  private readonly slotEls: HTMLElement[] = [];
  private thoughtTimer = 0;
  private notesSignature = '';

  /** Клик по слоту в рюкзаке: решает игра, что с ним делать. */
  onSlot?: (index: number) => void;

  constructor(private readonly inventory: Inventory) {
    this.invEl.innerHTML = '';
    this.bagSlotsEl.innerHTML = '';

    for (let i = 0; i < inventory.slots.length; i++) {
      const strip = document.createElement('button');
      strip.type = 'button';
      strip.className = 'slot';
      strip.dataset.index = String(i);
      this.invEl.appendChild(strip);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'bag-slot';
      cell.dataset.index = String(i);
      cell.addEventListener('click', () => this.onSlot?.(i));
      this.bagSlotsEl.appendChild(cell);

      this.slotEls.push(strip, cell);
    }
    this.renderSlots();
  }

  renderSlots(): void {
    this.inventory.slots.forEach((id, i) => {
      const item = id ? ITEM_TABLE[id] : null;
      const selected = this.inventory.selected.includes(i);

      // нижняя полоска: иконка и номер, выбор одного предмета
      const strip = this.slotEls[i * 2];
      const icon = itemIcon(id);
      strip.innerHTML = '';
      strip.title = item ? item.name : '';
      strip.classList.toggle('filled', Boolean(item));
      strip.classList.toggle('selected', selected);
      strip.dataset.key = String(i + 1);

      if (icon) {
        const img = document.createElement('img');
        img.src = icon;
        img.alt = item?.name ?? '';
        img.draggable = false;
        strip.appendChild(img);
      }

      // слот рюкзака: картинка и название
      const cell = this.slotEls[i * 2 + 1];
      const cellIcon = itemIcon(id);
      cell.innerHTML = '';
      cell.classList.toggle('filled', Boolean(item));
      cell.classList.toggle('selected', selected);
      cell.title = item ? item.name : 'пусто';
      cell.dataset.key = String(i + 1);

      if (cellIcon) {
        const img = document.createElement('img');
        img.src = cellIcon;
        img.alt = item?.name ?? '';
        img.draggable = false;
        cell.appendChild(img);
      }

      const caption = document.createElement('span');
      caption.className = 'bag-caption';
      caption.textContent = item ? item.name : '';
      cell.appendChild(caption);
    });

    const pair = this.inventory.selected.map((i) => this.inventory.slots[i]).filter(Boolean);
    this.bagHintEl.textContent =
      pair.length === 2
        ? 'Нажми, чтобы соединить: ' + pair.join(' + ')
        : pair.length === 1
          ? 'Выбрано: ' + pair[0] + '. Выбери второй предмет'
          : 'Выбери предмет, потом второй — они соединятся';
  }

  /** Открыт ли рюкзак. Пока открыт, мышь принадлежит панели. */
  get bagOpen(): boolean {
    return !this.bagEl.classList.contains('hidden');
  }

  setBagOpen(open: boolean): void {
    this.bagEl.classList.toggle('hidden', !open);
    if (open) this.renderSlots();
  }

  setPulse(bpm: number, level: number): void {
    this.bpmEl.textContent = String(bpm);
    this.bpmEl.classList.toggle('high', level > 0.65);
    this.bpmEl.classList.toggle('mid', level > 0.4 && level <= 0.65);
  }

  setPlace(text: string): void {
    this.placeEl.textContent = text;
  }

  /**
   * Блокнот: мысли висят, пока не потеряют актуальность. Снимает их сервер —
   * по флагу мира, а не по таймеру: «душно» исчезает, когда открыли форточку.
   */
  setNotes(list: Array<{ id: string; text: string }>): void {
    const signature = JSON.stringify(list);
    if (signature === this.notesSignature) return;
    this.notesSignature = signature;

    this.notesListEl.innerHTML = '';
    for (const note of list) {
      const item = document.createElement('li');
      item.textContent = note.text;
      this.notesListEl.appendChild(item);
    }

    this.notesEl.classList.toggle('hidden', list.length === 0);
  }

  /** Мимоходная реплика: сказали и забыли — в блокнот такое не пишется. */
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
