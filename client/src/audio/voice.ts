/**
 * Голоса персонажей — блипы в духе Undertale.
 *
 * Голос здесь не записан и не собирается в речь: персонаж «говорит» коротким
 * блипом на каждый показанный символ. Характер задаётся не тембром речи, а
 * сэмплом: высота, набор гармоник, длина, зернистость. Так же устроена игра —
 * там у каждого героя свой звук `snd_txt*`, а «разные голоса» вроде Азриэля —
 * это Ториэль, поднятая выше по высоте.
 *
 * Три правила взяты из декомпила (obj_FinalWriter_Alarm_0 в Undertale):
 *
 *   if (tchar != " ") { snd_stop(звук); snd_play(звук); }
 *
 * 1. Каждый символ обрывает предыдущий звук и запускает сэмпл заново. Сэмпл
 *    длиннее шага текста, поэтому он никогда не доигрывает — отсюда «говорок»,
 *    а не череда отдельных щелчков.
 * 2. Пропускается только пробел: запятые и точки тоже пикают.
 * 3. Высота от блипа к блипу не меняется. Раньше я её рандомил «чтобы не
 *    звучало механически» — это совет из фанатских гайдов, в самой игре такого
 *    нет, и вместе с обрывом он даёт сирену вместо голоса.
 *
 * Шаг текста в игре — параметр `rate` в SCR_TEXTSETUP: кадры между символами.
 * При 30 fps `rate = 1` это 33 мс; у медленных и «роботных» персонажей 2–8
 * (Меттатон — 3, «Undying» — 7). Поэтому у пресетов есть собственный rate:
 * обходчик говорит неторопливо, Михалыч — редко.
 *
 * Файлов нет вовсе: сэмпл рисуется один раз в AudioBuffer и дальше играется
 * как обычный звук. Игра ходит по LAN без интернета, тащить сюда ассеты незачем.
 */

export type VoiceWave = 'square' | 'triangle' | 'sawtooth' | 'sine';

export interface VoicePreset {
  /** Высота сэмпла, Гц. */
  pitch: number;
  /** Форма волны: набор гармоник считается из неё. */
  wave: VoiceWave;
  /** Длина сэмпла, мс. Следующий символ обрывает его раньше — так и в игре. */
  ms?: number;
  /** Громкость. */
  gain?: number;
  /** Шаг текста, мс: сколько времени между символами. 33 — как rate 1 при 30 fps. */
  rate?: number;
  /** Сколько бит оставить в сэмпле: меньше — грубее и зернистее. */
  bits?: number;
  /** Щелчок на атаке, доля сигнала. Без него блип мягкий и «мультяшный». */
  click?: number;
  /** Дрожание внутри сэмпла: [Гц, глубина]. Это часть тембра, а не рандом. */
  vibrato?: [number, number];
  /** Играть не на каждом символе, а на каждом N-м. */
  every?: number;
}

/** Шаг текста по умолчанию, мс. В игре 33 (rate 1 при 30 fps) — берём медленнее. */
const DEFAULT_RATE = 45;
/** Сэмпл заметно длиннее шага — именно поэтому он обрывается, а не доигрывает. */
const DEFAULT_MS = 90;
/** Дальше этого вперёд не планируем: иначе после длинной пачки звук отстаёт от текста. */
const LOOKAHEAD = 0.35;

/** Обертоны по форме волны: у квадрата нечётные и резко, у треугольника почти нет. */
const HARMONICS: Record<VoiceWave, number[]> = {
  square: [1, 0, 0.33, 0, 0.2, 0, 0.14],
  triangle: [1, 0, 0.11, 0, 0.04],
  sawtooth: [1, 0.5, 0.33, 0.25, 0.2],
  sine: [1],
};

/** Ключи — id из content/npcs.json. rate — шаг печати и блипов, мс. */
export const PRESETS: Record<string, VoicePreset> = {
  // тихий, неторопливый, отеческий: говорит реже, чем остальные
  inspector: { pitch: 118, wave: 'triangle', ms: 90, gain: 0.1, rate: 80, bits: 7, click: 0.4 },
  // усталый и ровный: без дрожи, чуть быстрее обходчика
  mashinist: { pitch: 96, wave: 'square', gain: 0.12, rate: 60, click: 0.5 },
  // 87 лет, физрук: коротко и рублено, почти без зерна
  vladimir: { pitch: 188, wave: 'square', ms: 70, gain: 0.15, rate: 45, bits: 7, click: 0.7 },
  // самодовольный и до смерти напуганный: дёргается внутри сэмпла
  svyazist: { pitch: 246, wave: 'sawtooth', ms: 80, gain: 0.12, rate: 45, vibrato: [8, 0.06] },
  // выгоревший: низко, редко и глухо — «я привык»
  worker: { pitch: 70, wave: 'sawtooth', ms: 110, gain: 0.1, rate: 120, every: 2, click: 0.3 },
  // математичка: мягко, чуть медленнее обычного
  math_teacher: { pitch: 208, wave: 'triangle', ms: 85, gain: 0.13, rate: 55 },
  // альтушка: высоко и быстро
  altushka: { pitch: 314, wave: 'triangle', ms: 60, gain: 0.11, rate: 45 },
  // ганвест: самый короткий и звонкий блип
  gunwest: { pitch: 150, wave: 'square', ms: 60, gain: 0.16, rate: 45, click: 0.8 },
  // занятой руководитель: сухо и по-деловому
  maksim_igorevich: { pitch: 168, wave: 'square', ms: 80, gain: 0.13, rate: 60 },
  // терпила: мягко и немного виновато
  dima: { pitch: 176, wave: 'triangle', ms: 85, gain: 0.11, rate: 55 },
};

/** Кто ещё не попал в таблицу — получит свой стабильный голос из имени. */
const FALLBACK: VoicePreset = { pitch: 160, wave: 'sine', gain: 0.13, rate: 33 };

/** Высота по имени: одинаковое имя — одинаковый голос, разные — различимые. */
function pitchOf(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return FALLBACK.pitch * (0.7 + (hash / 997) * 0.9);
}

/** Пресет персонажа: по id, а если такого нет — по имени. */
export function presetFor(id?: string, name?: string): VoicePreset {
  const known = id ? PRESETS[id] : undefined;
  if (known) return known;
  return { ...FALLBACK, pitch: pitchOf(name ?? id ?? '') };
}

export class Voices {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Время следующего свободного блипа: пачки из модели растягиваем по нему. */
  private nextAt = 0;
  /** Последний запущенный сэмпл: его обрывает следующий символ. */
  private last: AudioBufferSourceNode | null = null;
  /** Счётчик прозвучавших символов — для пресетов с every. */
  private tick = 0;
  /** Готовые сэмплы: рисуются один раз на пресет и настроение. */
  private readonly cache = new Map<string, AudioBuffer>();
  private muted = false;

  /**
   * Браузер не даёт звук до жеста пользователя — вызывается из клика или нажатия.
   * Повторные вызовы безопасны: контекст создаётся один раз.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Выключить/включить звук целиком. Возвращает новое состояние. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }

  /** Начало новой реплики: старое расписание больше не нужно. */
  reset(): void {
    this.nextAt = 0;
    this.tick = 0;
  }

  /** Шаг в миллисекундах: по нему печатается текст и по нему же идут блипы. */
  step(preset: VoicePreset, mood = 0): number {
    return (preset.rate ?? DEFAULT_RATE) * (1 - 0.3 * mood);
  }

  /**
   * Проговорить кусок текста, пришедший из модели.
   *
   * mood 0..1 — насколько всем страшно: голоса поднимаются и частит.
   */
  speak(text: string, preset: VoicePreset, mood = 0): void {
    if (!this.ctx || !this.master || this.muted) return;

    const every = preset.every ?? 1;
    for (const char of text) {
      // в игре пропускается только пробел: if (tchar != " ")
      if (/\s/.test(char)) continue;
      if (every > 1 && this.tick++ % every !== 0) continue;
      this.blip(preset, mood);
    }
  }

  /** Один блип: запуск сэмпла, который оборвёт следующий символ. */
  private blip(preset: VoicePreset, mood: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const at = Math.max(now + 0.001, this.nextAt);
    if (at - now > LOOKAHEAD) return; // очередь длиннее, чем успевает текст, — лишнее выбрасываем
    this.nextAt = at + this.step(preset, mood) / 1000;

    const buffer = this.sample(preset, mood);
    if (!buffer) return;

    // snd_stop + snd_play: предыдущий обрывается ровно там, где начинается новый
    this.last?.stop(at);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = preset.gain ?? 0.13;
    source.connect(gain).connect(master);
    source.start(at);
    this.last = source;
  }

  /** Рисуем сэмпл персонажа: гармоники, щелчок, затухание и округление до бит. */
  private sample(preset: VoicePreset, mood: number): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;

    // настроение квантуем: иначе кэш распухнет на каждое случайное значение
    const step = Math.round(mood * 4) / 4;
    const pitch = preset.pitch * (1 + 0.25 * step);
    const key = [
      pitch.toFixed(1),
      preset.wave,
      preset.ms ?? DEFAULT_MS,
      preset.bits ?? 6,
      preset.click ?? 0.5,
      preset.vibrato?.join(':') ?? '',
    ].join('|');

    const cached = this.cache.get(key);
    if (cached) return cached;

    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(((preset.ms ?? DEFAULT_MS) / 1000) * rate));
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);

    const harmonics = HARMONICS[preset.wave];
    const norm = harmonics.reduce((sum, weight) => sum + Math.abs(weight), 0) || 1;
    const levels = 2 ** ((preset.bits ?? 6) - 1);
    const [vibratoRate, vibratoDepth] = preset.vibrato ?? [0, 0];
    const click = preset.click ?? 0.5;

    for (let i = 0; i < length; i++) {
      const t = i / rate;
      // атака 1.5 мс, спад около 45 мс: хвост длиннее шага текста — в этом весь смысл
      const envelope = Math.min(1, t / 0.0015) * Math.exp(-t / 0.045);
      const wobble = vibratoRate ? 1 + Math.sin(2 * Math.PI * vibratoRate * t) * vibratoDepth : 1;

      let value = 0;
      for (let h = 0; h < harmonics.length; h++) {
        const weight = harmonics[h];
        if (weight === 0) continue;
        value += Math.sin(2 * Math.PI * pitch * (h + 1) * wobble * t) * weight;
      }
      // щелчок на атаке: без него блип звучит слишком гладко
      if (click > 0 && t < 0.004) value += (Math.random() * 2 - 1) * click * (1 - t / 0.004);

      // округление до бит — та самая зернистость 8-битного сэмпла
      data[i] = Math.round((value / norm) * envelope * levels) / levels;
    }

    this.cache.set(key, buffer);
    return buffer;
  }
}
