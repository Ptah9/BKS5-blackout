/**
 * Иконки предметов.
 *
 * Рисуются как SVG прямо в коде: на демо нет интернета, а тащить пять png
 * ради рюкзака — лишние файлы. Стиль нарочно грубый, под PS1-картинку.
 */

const wrap = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${body}</svg>`,
  )}`;

const BOTTLE = wrap(`
  <g fill="none" stroke="#9ecbff" stroke-width="3" stroke-linejoin="round">
    <path d="M27 12h10v8l6 8v24a4 4 0 0 1-4 4H25a4 4 0 0 1-4-4V28l6-8z" fill="#1d3350"/>
    <path d="M24 34h16" stroke="#5f9bd6"/>
  </g>
`);

const PHONE = wrap(`
  <g>
    <rect x="20" y="10" width="24" height="44" rx="5" fill="#0d131c" stroke="#8fa8c4" stroke-width="3"/>
    <rect x="24" y="16" width="16" height="30" rx="2" fill="#3f6ea8"/>
    <circle cx="32" cy="50" r="1.6" fill="#8fa8c4"/>
  </g>
`);

const CANDY = wrap(`
  <g fill="none" stroke="#ffb28a" stroke-width="3" stroke-linejoin="round">
    <rect x="22" y="24" width="20" height="16" rx="6" fill="#5a2a22"/>
    <path d="M22 26l-9-6v24l9-6M42 26l9-6v24l-9-6" fill="#7d3a2c"/>
  </g>
`);

const PAPER = wrap(`
  <g fill="none" stroke="#d8d2c0" stroke-width="3" stroke-linejoin="round">
    <path d="M18 10h22l8 8v36H18z" fill="#2a2a26"/>
    <path d="M40 10v8h8"/>
    <path d="M24 28h18M24 36h18M24 44h12" stroke="#8e8a7c"/>
  </g>
`);

const LAMP = wrap(`
  <g>
    <circle cx="32" cy="30" r="16" fill="#1d3557" opacity="0.55"/>
    <rect x="16" y="42" width="32" height="8" rx="3" fill="#0d131c" stroke="#8fa8c4" stroke-width="2"/>
    <path d="M26 42V24a6 6 0 0 1 12 0v18" fill="none" stroke="#bcd8ff" stroke-width="3"/>
    <circle cx="32" cy="30" r="6" fill="#dff0ff" opacity="0.85"/>
  </g>
`);

export const ITEM_ICONS: Record<string, string> = {
  bottle: BOTTLE,
  phone: PHONE,
  candy: CANDY,
  paper: PAPER,
  flashlight: LAMP,
  medkit: wrap(`
    <g fill="none" stroke="#f0a9a9" stroke-width="3" stroke-linejoin="round">
      <rect x="14" y="20" width="36" height="26" rx="4" fill="#3a1d1d"/>
      <path d="M32 26v14M25 33h14" stroke="#ffd7d7"/>
      <path d="M26 20v-5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5"/>
    </g>
  `),
  voltmeter: wrap(`
    <g fill="none" stroke="#a9d6c8" stroke-width="3" stroke-linejoin="round">
      <rect x="16" y="18" width="32" height="30" rx="4" fill="#183028"/>
      <path d="M24 26l8 8 8-8"/>
      <path d="M32 34v6"/>
      <circle cx="32" cy="44" r="2" fill="#a9d6c8"/>
    </g>
  `),
  tube: wrap(`
    <g fill="none" stroke="#d6c9a8" stroke-width="3" stroke-linejoin="round">
      <rect x="20" y="8" width="24" height="46" rx="6" transform="rotate(12 32 32)" fill="#332f24"/>
      <path d="M24 16h16" stroke="#8f8a72"/>
    </g>
  `),
  pencil: wrap(`
    <g stroke-linejoin="round">
      <path d="M18 46l4-12 24-24 8 8-24 24z" fill="#4a4230" stroke="#d7c17a" stroke-width="3"/>
      <path d="M46 10l8 8" stroke="#efe3b0" stroke-width="3"/>
      <path d="M22 34l8 8" stroke="#d7c17a" stroke-width="3"/>
    </g>
  `),
  drawing: wrap(`
    <g fill="none" stroke="#bcd0e8" stroke-width="3" stroke-linejoin="round">
      <rect x="12" y="12" width="40" height="40" rx="3" fill="#1b2634"/>
      <path d="M18 44l10-14 8 8 10-16"/>
      <path d="M18 20h10M18 26h6" stroke="#7f93ad"/>
    </g>
  `),
};

export function itemIcon(id: string | null): string | null {
  if (!id) return null;
  return ITEM_ICONS[id] ?? null;
}
