/**
 * Иконки предметов.
 *
 * Нарезаны из `predmets/icons.jpg` (лист 4 × 3, пиксель-арт на белом) скриптом
 * на System.Drawing: `client/public/icons/<id>.png`, 128 × 128, ближайший сосед.
 * Своих рисунков больше нет — что на листе, то и в рюкзаке.
 */

/** id предмета → файл иконки. Порядок совпадает с листом: 4 + 4 + 3. */
const FILES: Record<string, string> = {
  bottle: 'bottle',
  phone: 'phone',
  candy: 'candy',
  paper: 'paper',
  flashlight: 'flashlight',
  medkit: 'medkit',
  voltmeter: 'voltmeter',
  tube: 'tube',
  pencil: 'pencil',
  drawing: 'drawing',
  splint: 'splint',
};

export const ITEM_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(FILES).map(([id, file]) => [id, `/icons/${file}.png`]),
);

export function itemIcon(id: string | null): string | null {
  if (!id) return null;
  return ITEM_ICONS[id] ?? null;
}
