/**
 * Предметы и рецепты — одна копия правды для клиента и сервера.
 *
 * Сервер по этому файлу проверяет комбинации, клиент по нему рисует подписи.
 * Клиент не может «собрать» то, чего нет здесь: рецепт живёт в данных,
 * а не в коде интерфейса.
 */

export const ITEMS = Object.freeze({
  bottle: { id: 'bottle', name: 'Бутылка воды', short: 'бут.' },
  phone: { id: 'phone', name: 'Телефон', short: 'тел.' },
  candy: { id: 'candy', name: 'Конфеты', short: 'кон.' },
  paper: { id: 'paper', name: 'Бумажка', short: 'бум.' },
  flashlight: { id: 'flashlight', name: 'Фонарик из бутылки', short: 'фон.' },
  medkit: { id: 'medkit', name: 'Аптечка', short: 'апт.' },
  voltmeter: { id: 'voltmeter', name: 'Указатель напряжения', short: 'увн' },
  tube: { id: 'tube', name: 'Тубус с начертом', short: 'туб.' },
  pencil: { id: 'pencil', name: 'Карандаш', short: 'кар.' },
  drawing: { id: 'drawing', name: 'Доделанный начерт', short: 'нач.' },
  splint: { id: 'splint', name: 'Шина из журналов', short: 'шин.' },
});

/** Что с чем соединяется. Порядок в паре не важен. */
export const RECIPES = Object.freeze([
  {
    a: 'bottle',
    b: 'phone',
    result: 'flashlight',
    text: 'Бутылка с водой работает как линза: свет ровнее и ярче.',
  },
  {
    a: 'tube',
    b: 'pencil',
    result: 'drawing',
    text: 'Чертёж доделан. Вагон уважительно замолкает.',
  },
]);

export const SLOT_COUNT = 8;

/** Стартовый набор: чтобы на демо не искать предметы по вагону. */
export const START_INVENTORY = Object.freeze(['bottle', 'phone', 'candy', 'paper', null, null, null, null]);

/**
 * Проверяет пару и возвращает рецепт, если он есть.
 * @param {string} first
 * @param {string} second
 */
export function findRecipe(first, second) {
  return (
    RECIPES.find(
      (r) => (r.a === first && r.b === second) || (r.a === second && r.b === first),
    ) ?? null
  );
}

/** Приводит массив слотов к безопасному виду: только известные предметы. */
export function sanitizeInventory(raw) {
  if (!Array.isArray(raw)) return [...START_INVENTORY];
  const slots = raw.slice(0, SLOT_COUNT).map((id) => (typeof id === 'string' && ITEMS[id] ? id : null));
  while (slots.length < SLOT_COUNT) slots.push(null);
  return slots;
}
