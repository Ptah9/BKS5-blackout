/**
 * Агенты: диалог с памятью и подменяемым «мозгом».
 *
 * Мозг — это одна функция, которая отдаёт текст по кусочкам. Сейчас за ней
 * DeepSeek по API, дальше встанет локальная модель — и весь остальной код
 * (память, промпты, стриминг, интерфейс) менять не придётся.
 *
 * Если ключа нет или сеть отвалилась, включается запасной мозг на правилах:
 * он тоже помнит, о чём говорили, и отвечает по теме. Демо не встаёт.
 */

const SYSTEM_RULES = `Ты персонаж игры про застрявший в тоннеле поезд метро.
Отвечай по-русски, коротко: одна-две фразы, не больше 30 слов.
Не описывай свои эмоции в скобках, не пиши ремарки, только прямую речь.
Не повторяй дословно то, что уже говорил.`;

/** Сколько последних реплик держим в памяти диалога. */
const MEMORY_LIMIT = 12;

export class AgentRuntime {
  /**
   * @param {{ store: any, key: string | null, log: (...a: any[]) => void, model?: string }} options
   */
  constructor({ store, key, log, model = 'deepseek-chat' }) {
    this.store = store;
    this.key = key;
    this.log = log;
    this.model = model;
  }

  get mode() {
    return this.key ? 'deepseek' : 'rules';
  }

  /**
   * Ответ агента кусками. Вызывающий код просто пишет их клиенту.
   * @param {{ npc: any, playerId: number, playerName: string, text: string }} request
   */
  async *reply({ npc, playerId, playerName, text }) {
    const history = this.store.recentMemory(npc.id, playerId, MEMORY_LIMIT);

    this.store.addMemory(npc.id, playerId, 'user', text);

    const messages = [
      { role: 'system', content: `${SYSTEM_RULES}\n\n${npc.persona}` },
      ...history.map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.text })),
      { role: 'user', content: `${playerName} говорит: ${text}` },
    ];

    let answer = '';

    try {
      if (this.key) {
        for await (const chunk of this.streamDeepSeek(messages)) {
          answer += chunk;
          yield chunk;
        }
      } else {
        for await (const chunk of this.streamRules(npc, text, history)) {
          answer += chunk;
          yield chunk;
        }
      }
    } catch (error) {
      this.log('агент: ошибка модели, отвечаю правилами —', error?.message ?? error);
      if (!answer) {
        for await (const chunk of this.streamRules(npc, text, history)) {
          answer += chunk;
          yield chunk;
        }
      }
    }

    this.store.addMemory(npc.id, playerId, 'assistant', answer.trim());
  }

  /** Потоковый вызов DeepSeek: SSE-строки вида data: {...}. */
  async *streamDeepSeek(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          temperature: 0.85,
          max_tokens: 120,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // неполный кусок JSON — пропускаем, следующий чанк его дополнит
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Запасной мозг: короткие ответы по теме и с учётом того, что уже сказано. */
  async *streamRules(npc, text, history) {
    const lower = text.toLowerCase();

    const said = new Set(history.map((row) => row.text.toLowerCase()));

    const pick = (variants) => {
      const fresh = variants.filter((variant) => !said.has(variant.toLowerCase()));
      return (fresh.length > 0 ? fresh : variants)[Math.floor(Math.random() * (fresh.length || variants.length))];
    };

    let answer;

    if (/свет|темн|фонар/.test(lower)) {
      answer = pick([
        'Света нет с самого тоннеля. Только телефоны и остались.',
        'Фонарь есть у кого-то из пассажиров. Бутылка с водой его разгонит.',
      ]);
    } else if (/выход|выйти|пути|рельс/.test(lower)) {
      answer = pick([
        'На пути нельзя. Там контактный рельс под напряжением.',
        'Выход есть, но не здесь. И не по путям.',
      ]);
    } else if (/машинист|кабин/.test(lower)) {
      answer = pick([
        'Кабина открыта, а машиниста нет. Ищу, куда он делся.',
        'В кабине пусто. Дверь нараспашку — это меня и насторожило.',
      ]);
    } else if (/что.*происход|почему.*встал|случилось/.test(lower)) {
      answer = pick([
        'Состав встал, света нет. Дальше только ждать и не паниковать.',
        'Похоже, обесточило участок. Так бывает, но редко.',
      ]);
    } else if (/помо|помочь/.test(lower)) {
      answer = pick([
        'Помоги людям успокоиться. Это сейчас важнее всего.',
        'Держи фонарь ровно и говори тише — толпа смотрит на тебя.',
      ]);
    } else {
      answer = pick([
        'Не знаю. Но стоять без дела хуже, чем искать.',
        'Спроси иначе — я не понял.',
        'Тут темно, а ты спрашиваешь. Давай по делу.',
      ]);
    }

    // отдаём по два-три символа, чтобы клиент показывал поток, а не готовый абзац
    for (let i = 0; i < answer.length; i += 3) {
      yield answer.slice(i, i + 3);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
