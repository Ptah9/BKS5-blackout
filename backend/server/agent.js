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

/**
 * Проверка, что локальная модель доступна: спрашиваем список моделей Ollama.
 * Нужна на старте сервера, чтобы в логе было честно написано, какой мозг включён.
 */
export async function probeLocal(url, model, format = 'ollama', apiKey = null) {
  try {
    const base = url.replace(/\/+$/, '');
    const path = format === 'openai' ? '/v1/models' : '/api/tags';
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;

    const data = await response.json();

    if (format === 'openai') {
      const names = (data.data ?? []).map((item) => String(item.id ?? ''));
      return names.length > 0;
    }

    const names = (data.models ?? []).map((item) => String(item.name ?? ''));
    const family = model.split(':')[0];
    return names.some((name) => name === model || name.startsWith(`${family}:`));
  } catch {
    return false;
  }
}

/** Сколько последних реплик держим в памяти диалога. */
const MEMORY_LIMIT = 12;

export class AgentRuntime {
  /**
   * @param {{ store: any, key: string | null, localUrl?: string | null, localModel?: string, log: (...a: any[]) => void, model?: string }} options
   */
  constructor({ store, key, localUrl = null, localModel = 'qwen2.5:7b-instruct', localFormat = 'ollama', localKey = null, log, model = 'deepseek-chat' }) {
    this.store = store;
    this.key = key;
    this.localUrl = localUrl ? localUrl.replace(/\/+$/, '') : null;
    this.localModel = localModel;
    this.localFormat = localFormat === 'openai' ? 'openai' : 'ollama';
    this.localKey = localKey;
    this.log = log;
    this.model = model;
  }

  /** Заголовки для локального сервера: Strata с --access lan требует ключ. */
  get localHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.localKey) headers.Authorization = `Bearer ${this.localKey}`;
    return headers;
  }

  get mode() {
    if (this.localUrl) return 'local';
    return this.key ? 'deepseek' : 'rules';
  }

  /**
   * Ответ агента кусками. Вызывающий код просто пишет их клиенту.
   * @param {{ npc: any, playerId: number, playerName: string, text: string }} request
   */
  async *reply({ npc, playerId, playerName, text, signal = null }) {
    const history = this.store.recentMemory(npc.id, playerId, MEMORY_LIMIT);

    this.store.addMemory(npc.id, playerId, 'user', text);

    const messages = [
      { role: 'system', content: `${SYSTEM_RULES}\n\n${npc.persona}` },
      ...history.map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: row.text })),
      { role: 'user', content: `${playerName} говорит: ${text}` },
    ];

    let answer = '';

    try {
      if (this.localUrl) {
        const stream = this.localFormat === 'openai'
          ? this.streamOpenAI(messages, signal)
          : this.streamOllama(messages, signal);
        for await (const chunk of stream) {
          answer += chunk;
          yield chunk;
        }
      } else if (this.key) {
        for await (const chunk of this.streamDeepSeek(messages, signal)) {
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
      if (error?.name === 'AbortError') throw error; // игрока оборвал клиент — не переключаемся
      this.log('агент: модель не ответила, переключаюсь —', error?.message ?? error);

      // если локальная не поднялась, пробуем DeepSeek, и только потом правила
      if (!answer && this.localUrl && this.key) {
        try {
          for await (const chunk of this.streamDeepSeek(messages, signal)) {
            answer += chunk;
            yield chunk;
          }
        } catch (deepseekError) {
          this.log('агент: DeepSeek тоже не ответил —', deepseekError?.message ?? deepseekError);
        }
      }

      if (!answer) {
        for await (const chunk of this.streamRules(npc, text, history)) {
          answer += chunk;
          yield chunk;
        }
      }
    }

    this.store.addMemory(npc.id, playerId, 'assistant', answer.trim());
  }

  /** Общий таймаут + внешний сигнал от клиента: прерывает fetch, если игрок ушёл. */
  makeSignal(external) {
    if (!external) return { signal: AbortSignal.timeout(20_000) };
    return { signal: AbortSignal.any([external, AbortSignal.timeout(20_000)]) };
  }

  /**
   * Потоковый вызов локальной модели, формат Ollama: `/api/chat`, NDJSON.
   * Формат ответа — по строке на кусок: {"message":{"content":"…"},"done":false}.
   */
  async *streamOllama(messages, signal = null) {
    const abort = this.makeSignal(signal);

    const response = await fetch(`${this.localUrl}/api/chat`, {
      method: 'POST',
      headers: this.localHeaders,
      body: JSON.stringify({
        model: this.localModel,
        stream: true,
        messages,
        options: { temperature: 0.85, num_predict: 120 },
      }),
      signal: abort.signal,
    });

    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

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
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // неполная строка — дождёмся следующего куска
        }

        const piece = parsed?.message?.content;
        if (piece) yield piece;
        if (parsed?.done) return;
      }
    }
  }

  /**
   * Потоковый вызов OpenAI-совместимого сервера: `/v1/chat/completions`, SSE.
   * Так отвечают llama.cpp server, LM Studio, vLLM и прочие.
   */
  async *streamOpenAI(messages, signal = null) {
    const abort = this.makeSignal(signal);

    const response = await fetch(`${this.localUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.localHeaders,
      body: JSON.stringify({
        model: this.localModel,
        stream: true,
        messages,
        temperature: 0.85,
        max_tokens: 120,
      }),
      signal: abort.signal,
    });

    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

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
          const piece = parsed?.choices?.[0]?.delta?.content;
          if (piece) yield piece;
        } catch {
          // неполный кусок JSON — пропускаем
        }
      }
    }
  }

  /** Потоковый вызов DeepSeek: SSE-строки вида data: {...}. */
  async *streamDeepSeek(messages, signal = null) {
    const abort = this.makeSignal(signal);

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
      signal: abort.signal,
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
