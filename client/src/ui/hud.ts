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
  private readonly cabTimerEl: HTMLDivElement;
  private readonly goalEl: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  private readonly deathTextEl: HTMLDivElement;
  private thoughtTimer = 0;
  private notesSignature = '';

  /** Клик по слоту в рюкзаке: решает игра, что с ним делать. */
  onSlot?: (index: number) => void;
  /** «Начать заново» на экране смерти. */
  onRestart?: () => void;

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

    // таймер резервного света: верхний левый угол, блокнот справа не занят
    this.cabTimerEl = document.createElement('div');
    this.cabTimerEl.id = 'cab-timer';
    this.cabTimerEl.style.cssText = [
      'position:fixed',
      'left:16px',
      'top:16px',
      'z-index:12',
      'display:none',
      'padding:6px 10px',
      'border-radius:6px',
      'background:rgb(8 11 16 / 0.72)',
      'border:1px solid rgb(255 200 140 / 0.35)',
      'color:#ffd9a0',
      'font:18px/1.2 Consolas,monospace',
      'letter-spacing:0.06em',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.cabTimerEl);

    // мини-игра объявления: два крупных числа, пока игрок говорит
    this.goalEl = document.createElement('div');
    this.goalEl.id = 'announce-goal';
    this.goalEl.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:14%',
      'transform:translateX(-50%)',
      'z-index:14',
      'display:none',
      'gap:34px',
      'align-items:flex-end',
      'padding:12px 22px',
      'border-radius:8px',
      'background:rgb(8 11 16 / 0.8)',
      'border:1px solid rgb(120 140 170 / 0.3)',
      'color:#c9d6e6',
      'font:12px/1.3 Consolas,monospace',
      'pointer-events:none',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(this.goalEl);

    // экран смерти: личная, мир продолжается
    this.deathEl = document.createElement('div');
    this.deathEl.id = 'death';
    this.deathEl.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:60',
      'display:none',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:18px',
      'padding:0 12vw',
      'background:rgb(4 5 8 / 0.92)',
      'color:#e7ecf3',
      'font:15px/1.5 Consolas,monospace',
      'text-align:center',
    ].join(';');
    this.deathTextEl = document.createElement('div');
    this.deathTextEl.style.cssText = 'max-width:620px;font-size:18px';
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.textContent = 'Начать заново';
    restart.style.cssText = [
      'margin-top:6px',
      'padding:8px 18px',
      'border-radius:6px',
      'border:1px solid rgb(150 175 210 / 0.45)',
      'background:rgb(20 28 38 / 0.95)',
      'color:#dbe6f3',
      'font:14px Consolas,monospace',
      'cursor:pointer',
    ].join(';');
    restart.addEventListener('click', () => this.onRestart?.());
    this.deathEl.append(this.deathTextEl, restart);
    document.body.appendChild(this.deathEl);

    this.renderSlots();
  }

  /** Цель мини-игры: паника ≤ 30 и доверие ≥ 80. Пока не достигнута — видна. */
  setAnnounceGoal(visible: boolean, panic: number, trust: number): void {
    if (!visible || (panic <= 30 && trust >= 80)) {
      this.goalEl.style.display = 'none';
      this.goalEl.innerHTML = '';
      return;
    }

    const panicColor = panic <= 30 ? '#9fe3a0' : '#ffb27a';
    const trustColor = trust >= 80 ? '#9fe3a0' : '#9ecbff';
    this.goalEl.style.display = 'flex';
    this.goalEl.innerHTML = `
      <div>ПАНИКА ТОЛПЫ<br><b style="font-size:42px;color:${panicColor}">${panic}</b><span style="color:#6f8096"> / 30</span></div>
      <div>ДОВЕРИЕ<br><b style="font-size:42px;color:${trustColor}">${trust}</b><span style="color:#6f8096"> / 80</span></div>
    `;
  }

  /** Экран смерти с текстом сцены и кнопкой «Начать заново». */
  showDeath(text: string): void {
    this.deathTextEl.textContent = text;
    this.deathEl.style.display = 'flex';
  }

  hideDeath(): void {
    this.deathEl.style.display = 'none';
  }

  /** Остаток резервного света в углу; null — света нет, таймер убран. */
  setCabTimer(seconds: number | null): void {
    if (seconds === null || seconds <= 0) {
      this.cabTimerEl.style.display = 'none';
      this.cabTimerEl.textContent = '';
      return;
    }

    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    this.cabTimerEl.textContent = `резерв ${minutes}:${String(rest).padStart(2, '0')}`;
    this.cabTimerEl.style.display = 'block';
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
