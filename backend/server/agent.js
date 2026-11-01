/**
 * Агенты: диалог с памятью и подменяемым «мозгом».
 *
 * Мозг — источник текста: локальная модель (Ollama или OpenAI-совместимая,
 * включая Strata), DeepSeek по ключу, либо правила без сети.
 *
 * Формат ответа задан сценарием (`scenario/ai_characters_promts.md`): модель
 * возвращает JSON с репликой и дельтами доверия/паники. Мы его разбираем,
 * числа отдаём серверу, а игроку показываем только речь — по кускам, чтобы
 * она печаталась, а не появлялась абзацем.
 *
 * Если JSON не разобрался, реплика достаётся из сырого текста, а числа
 * считаются нулевыми: диалог не должен падать из-за формата.
 */

const SYSTEM_RULES = `Ты персонаж игры про застрявший в тоннеле поезд метро.
Отвечай по-русски, коротко: одна-две фразы, не больше 30 слов.
Не описывай эмоции в скобках, не пиши ремарки, только прямую речь.

Верни СТРОГО один JSON-объект без пояснений и без разметки:
{"speech":"реплика персонажа","trust_delta":0,"panic_delta":0,"action_flag":"none","reasoning_internal":"до 8 слов"}

Поля:
- speech — то, что услышит игрок;
- trust_delta — целое от -15 до 15, как реплика меняет доверие к игрокам;
- panic_delta — целое от -15 до 15, как реплика влияет на панику в вагоне;
- action_flag — одно из: none, stay, flee, retreat, cooperate;
- reasoning_internal — короткая мысль персонажа, игроку не показывается.`;

/** Сколько последних реплик держим в памяти диалога. */
const MEMORY_LIMIT = 12;

const clampDelta = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-15, Math.min(15, Math.round(number)));
};

/**
 * Разбирает ответ модели. Возвращает речь и числа; при поломке формата
 * достаёт речь из сырого текста, а числа обнуляет.
 */
export function parseAgentAnswer(raw) {
  const text = String(raw ?? '').trim();
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  try {
    const data = JSON.parse(cleaned);
    const speech = String(data.speech ?? '').trim();
    return {
      speech: speech || '...',
      trustDelta: clampDelta(data.trust_delta),
      panicDelta: clampDelta(data.panic_delta),
      actionFlag: String(data.action_flag ?? 'none'),
    };
  } catch {
    const speech = cleaned
      .replace(/[{}"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);

    return {
      speech: speech || '...',
      trustDelta: 0,
      panicDelta: 0,
      actionFlag: 'none',
    };
  }
}

/**
 * Проверка, что локальная модель доступна: спрашиваем список моделей.
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

export class AgentRuntime {
  /**
   * @param {{ store: any, key: string | null, localUrl?: string | null, localModel?: string,
   *           localFormat?: string, localKey?: string | null, log: (...a: any[]) => void,
   *           model?: string }} options
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

  get mode() {
    if (this.localUrl) return 'local';
    return this.key ? 'deepseek' : 'rules';
  }

  /** Заголовки для локального сервера: Strata с --access lan требует ключ. */
  get localHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.localKey) headers.Authorization = `Bearer ${this.localKey}`;
    return headers;
  }

  /**
   * Ответ агента кусками речи. Числа отдаём через onResult, чтобы сервер
   * применил их к панике и доверию до того, как игрок дочитает реплику.
   */
  async *reply({ npc, playerId, playerName, text, signal = null, onResult = null }) {
    const history = this.store.recentMemory(npc.id, playerId, MEMORY_LIMIT);
    this.store.addMemory(npc.id, playerId, 'user', text);

    // персона из панели главнее файла: правка живёт в базе, переживает рестарт
    // и подхватывается со следующей реплики — перезапускать сервер не надо
    const override = this.store.getPersona(npc.id);
    const persona = override ?? npc.persona;
    const actor = override ? { ...npc, persona, personaOverride: true } : npc;

    const messages = [
      { role: 'system', content: `${SYSTEM_RULES}\n\n${persona}` },
      ...history.map((row) => ({
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.text,
      })),
      { role: 'user', content: `${playerName} говорит: ${text}` },
    ];

    let raw = '';

    try {
      raw = await this.askBrain(messages, signal, actor, text);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      this.log('агент: модель не ответила, переключаюсь —', error?.message ?? error);

      if (this.localUrl && this.key) {
        try {
          raw = await this.collect(this.streamDeepSeek(messages, signal));
        } catch (deepseekError) {
          this.log('агент: DeepSeek тоже не ответил —', deepseekError?.message ?? deepseekError);
        }
      }
    }

    const answer = raw.trim() ? parseAgentAnswer(raw) : parseAgentAnswer(this.rulesAnswer(actor, text));

    if (onResult) onResult(answer);
    this.store.addMemory(npc.id, playerId, 'assistant', answer.speech);

    // отдаём речь кусками: игрок видит, что персонаж «говорит»
    for (let i = 0; i < answer.speech.length; i += 4) {
      yield answer.speech.slice(i, i + 4);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Один вызов активного мозга: собирает текст целиком.
   * Когда мозга нет, отвечают правила — им нужен сам агент и вопрос игрока,
   * иначе правка персоны в офлайне не была бы видна в ответе.
   */
  async askBrain(messages, signal, npc = null, text = '') {
    if (this.localUrl) {
      const stream = this.localFormat === 'openai'
        ? this.streamOpenAI(messages, signal)
        : this.streamOllama(messages, signal);
      return this.collect(stream);
    }
    if (this.key) return this.collect(this.streamDeepSeek(messages, signal));
    return this.rulesAnswer(npc, text);
  }

  async collect(stream) {
    let out = '';
    for await (const chunk of stream) out += chunk;
    return out;
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
        ...(this.localModel.toLowerCase().startsWith('qwen3') ? { think: false } : {}),
        options: { temperature: 0.4, num_predict: 160 },
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
          continue;
        }

        const piece = parsed?.message?.content;
        if (piece) yield piece;
        if (parsed?.done) return;
      }
    }
  }

  /**
   * Потоковый вызов OpenAI-совместимого сервера: `/v1/chat/completions`, SSE.
   * Так отвечают Strata, llama.cpp server, LM Studio, vLLM.
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
        temperature: 0.4,
        max_tokens: 160,
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
        temperature: 0.4,
        max_tokens: 160,
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

  /** Запасной мозг без сети: короткие реплики по теме, с учётом сказанного. */
  rulesAnswer(npc, text) {
    const lower = String(text ?? '').toLowerCase();

    const pick = (variants, said) => {
      const fresh = variants.filter((variant) => !said.has(variant.toLowerCase()));
      const pool = fresh.length > 0 ? fresh : variants;
      return pool[Math.floor(Math.random() * pool.length)];
    };

    const said = new Set();
    let speech;

    if (/свет|темн|фонар/.test(lower)) {
      speech = pick([
        'Света нет с самого тоннеля. Только телефоны и остались.',
        'Фонарь есть у кого-то из пассажиров. Бутылка с водой его разгонит.',
      ], said);
    } else if (/выход|выйти|пути|рельс/.test(lower)) {
      speech = pick([
        'На пути нельзя. Там контактный рельс под напряжением.',
        'Выход есть, но не здесь. И не по путям.',
      ], said);
    } else if (/машинист|кабин/.test(lower)) {
      speech = pick([
        'Кабина открыта, а машиниста нет. Ищу, куда он делся.',
        'В кабине пусто. Дверь нараспашку — это меня и насторожило.',
      ], said);
    } else if (/что.*происход|почему.*встал|случилось/.test(lower)) {
      speech = pick([
        'Состав встал, света нет. Дальше только ждать и не паниковать.',
        'Похоже, обесточило участок. Так бывает, но редко.',
      ], said);
    } else {
      speech = pick([
        'Не знаю. Но стоять без дела хуже, чем искать.',
        'Спроси иначе — я не понял.',
        'Тут темно, а ты спрашиваешь. Давай по делу.',
      ], said);
    }

    // без модели правку персоны иначе не увидеть: берём первую фразу новой
    // персоны как зачин, чтобы ответ менялся и в офлайн-режиме
    if (npc?.personaOverride) {
      const lead = String(npc.persona ?? '').split(/[.!?\n]/)[0].trim().slice(0, 120);
      if (lead) speech = `${lead}. ${speech}`;
    }

    const calm = npc?.id === 'inspector';
    return JSON.stringify({
      speech,
      trust_delta: 0,
      panic_delta: calm ? -5 : 0,
      action_flag: calm ? 'cooperate' : 'none',
      reasoning_internal: 'ответ из правил',
    });
  }
}
