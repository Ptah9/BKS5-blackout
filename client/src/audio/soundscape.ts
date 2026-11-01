/**
 * Звук игры: короткие дорожки и фоновые петли на `HTMLAudioElement`.
 *
 * Зачем не Web Audio: нужны только громкость, fade и цикл, а `HTMLAudioElement`
 * не требует собирать граф, разблокируется тем же кликом, что и игра, и умеет
 * потоково тянуть длинный гул тоннеля (1,2 МБ) без декодирования в память.
 *
 * Правила:
 *  - нет файла — одна строка в консоль, игра идёт дальше;
 *  - громкость плавно едет к цели, резких щелчков нет;
 *  - `M` выключает весь звук, повторное нажатие возвращает;
 *  - всё, что запустила катсцена, гасится её концом, кроме `persist`.
 *
 * Файлы лежат в `client/public/audio/` (копии из `audio_metroinfo/`, оригиналы
 * не трогаются).
 */

interface SoundDef {
  file: string;
  /** Базовая громкость 0..1. */
  volume: number;
  loop?: boolean;
}

/** Реестр дорожек: имя в сценарии → файл. */
const DEFS = {
  /** Едущий поезд, фон. 16.8 с, поэтому петлёй. */
  train: { file: 'train.mp3', volume: 0.5, loop: true },
  /** «Следующая станция Измайловская». 5.2 с. */
  station: { file: 'station-izmailovskaya.mp3', volume: 0.85 },
  /** Скрип тормозов и остановка. 7.08 с. */
  brakes: { file: 'brakes-squeal.mp3', volume: 0.7 },
  /** Щелчок и гул при погасании света. 1.41 с. */
  blackout: { file: 'blackout.mp3', volume: 0.9 },
  /** Шёпот в темноте, тихо и петлёй. 5.62 с. */
  whisper: { file: 'whisper.mp3', volume: 0.22, loop: true },
  /** «Внимание, оставайтесь в вагоне». 4.96 с. */
  intercom: { file: 'intercom-stay-in-car.mp3', volume: 0.9 },
  /** Гул тоннеля после интро. 30 с, петля. */
  tunnelWind: { file: 'tunnel-rumble.mp3', volume: 0.3, loop: true },
} as const satisfies Record<string, SoundDef>;

const SOUNDS: Record<keyof typeof DEFS, SoundDef> = DEFS;

export type SoundName = keyof typeof DEFS;
export { SOUNDS };

export interface PlayOptions {
  /** 0..1, иначе берётся из реестра. */
  volume?: number;
  /** Секунды плавного входа, по умолчанию 0.35. */
  fade?: number;
  loop?: boolean;
  /** Пережить конец катсцены (гул тоннеля, шёпот). */
  persist?: boolean;
}

interface Sound {
  audio: HTMLAudioElement;
  /** Громкость по реестру с поправкой на options.volume. */
  base: number;
  /** Текущая и желаемая громкость до учёта mute. */
  gain: number;
  target: number;
  /** Скорость изменения громкости в секунду. */
  rate: number;
  persist: boolean;
  /** Множитель на базовую громкость: паника и прочие «настроения». */
  scale: number;
  /** Файл не открылся: второй раз не пытаемся и не шумим. */
  dead: boolean;
  /** Ждём разрешения на воспроизведение после клика. */
  waitingGesture: boolean;
}

const MUTE_KEY = 'KeyM';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export class Soundscape {
  private readonly sounds = new Map<SoundName, Sound>();
  private muted = false;
  private cutsceneLive = false;
  private lastTick = 0;
  private ticking = false;
  private gestureHooked = false;

  constructor() {
    this.lastTick = typeof performance === 'undefined' ? 0 : performance.now();
    if (typeof document !== 'undefined') this.hookMuteKey();
  }

  /** `M` — выключить/включить весь звук. Клик по полю ввода не считается. */
  private hookMuteKey(): void {
    document.addEventListener('keydown', (event) => {
      if (event.code !== MUTE_KEY) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      this.toggleMute();
    });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyVolumes();
  }

  /** Создать элементы заранее: к первому событию файл уже в буфере. */
  preload(names: readonly SoundName[] = Object.keys(SOUNDS) as SoundName[]): void {
    for (const name of names) this.element(name);
  }

  /** Катсцена началась: всё, что она запустит, будет помечено её как «временное». */
  beginCutscene(): void {
    this.cutsceneLive = true;
  }

  /** Катсцена кончилась: гасим её звуки, кроме persist. */
  endCutscene(fade = 0.5): void {
    this.cutsceneLive = false;
    for (const [name, sound] of this.sounds) {
      if (sound.persist) continue;
      this.stop(name, fade);
    }
  }

  play(name: SoundName, options: PlayOptions = {}): void {
    if (!(name in SOUNDS)) {
      console.info('[звук] нет такой дорожки:', name);
      return;
    }

    const sound = this.element(name);
    if (!sound || sound.dead) return;

    const def = SOUNDS[name];
    sound.base = clamp01(options.volume ?? def.volume);
    sound.persist = options.persist ?? false;
    sound.audio.loop = options.loop ?? def.loop ?? false;
    sound.target = sound.base * sound.scale;
    sound.rate = 1 / Math.max(0.05, options.fade ?? 0.35);

    if (!this.cutsceneLive) sound.persist = true;
    if (sound.audio.paused) {
      sound.audio.currentTime = 0;
      this.start(sound);
    }

    this.startTicker();
  }

  stop(name: SoundName, fade = 0.4): void {
    const sound = this.sounds.get(name);
    if (!sound) return;
    sound.target = 0;
    sound.rate = 1 / Math.max(0.05, fade);
    this.startTicker();
  }

  stopAll(fade = 0.4): void {
    for (const name of this.sounds.keys()) this.stop(name, fade);
  }

  /**
   * Сменить громкость канала, не перезапуская дорожку: то, что уже играет,
   * плавно подъедет к новой громкости. Для «в тоннеле громче, в вагоне тише».
   */
  setChannelVolume(name: SoundName, volume: number, fade = 0.8): void {
    const sound = this.sounds.get(name);
    if (!sound) {
      // канал ещё не создан — запомним громкость в реестре? Нет: элемент
      // создаём сразу, чтобы громкость не потерялась до первого play.
      const created = this.element(name);
      if (!created) return;
      created.base = clamp01(volume);
      this.startTicker();
      return;
    }
    sound.base = clamp01(volume);
    sound.target = sound.base * sound.scale;
    sound.rate = 1 / Math.max(0.05, fade);
    this.startTicker();
  }

  /** Множитель на базовую громкость канала (настроения, паника). */
  setChannelScale(name: SoundName, scale: number, fade = 0.8): void {
    const sound = this.sounds.get(name);
    if (!sound) return;
    sound.scale = Math.max(0, scale);
    if (sound.target > 0 || sound.gain > 0) sound.target = sound.base * sound.scale;
    sound.rate = 1 / Math.max(0.05, fade);
    this.startTicker();
  }

  /**
   * Паника мира 0..100 → громкость шёпота: 0.05 на нуле, 0.22 при 50,
   * 0.35 к сотне. Трек задаёт базовые 0.22, паника их масштабирует.
   */
  setPanic(value: number, fade = 0.8): void {
    const panic = clamp01(value / 100);
    const target = 0.05 + (0.35 - 0.05) * panic;
    const whisperDef = SOUNDS.whisper.volume;
    this.setChannelScale('whisper', target / whisperDef, fade);
  }

  /** Есть ли уже элементы в памяти: нужно для отчёта и проверок. */
  loaded(): SoundName[] {
    return [...this.sounds.keys()];
  }

  /** Состояние канала: громкость, играет ли. Пригодится проверкам. */
  state(name: SoundName): { gain: number; playing: boolean; muted: boolean } | null {
    const sound = this.sounds.get(name);
    if (!sound) return null;
    return { gain: +sound.gain.toFixed(3), playing: !sound.audio.paused, muted: this.muted };
  }

  private element(name: SoundName): Sound | null {
    const existing = this.sounds.get(name);
    if (existing) return existing;

    const def = SOUNDS[name];
    const audio = new Audio(`/audio/${def.file}`);
    audio.preload = 'auto';
    audio.volume = 0;

    const sound: Sound = {
      audio,
      base: def.volume,
      gain: 0,
      target: 0,
      rate: 3,
      persist: false,
      scale: 1,
      dead: false,
      waitingGesture: false,
    };

    audio.addEventListener('error', () => {
      sound.dead = true;
      console.info('[звук] файл не загрузился:', def.file);
    });

    this.sounds.set(name, sound);
    return sound;
  }

  private start(sound: Sound): void {
    const promise = sound.audio.play();
    if (!promise) return;
    promise.catch(() => {
      // браузер не дал автозапуск: ждём первого клика и пробуем ещё раз
      sound.waitingGesture = true;
      if (this.gestureHooked) return;
      this.gestureHooked = true;
      const retry = (): void => {
        for (const item of this.sounds.values()) {
          if (!item.waitingGesture || item.dead) continue;
          item.waitingGesture = false;
          void item.audio.play().catch(() => {});
        }
      };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    });
  }

  private applyVolumes(): void {
    for (const sound of this.sounds.values()) {
      sound.audio.volume = this.muted || sound.dead ? 0 : sound.gain;
    }
  }

  private startTicker(): void {
    if (this.ticking || typeof requestAnimationFrame === 'undefined') return;
    this.ticking = true;
    this.lastTick = performance.now();
    const step = (): void => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTick) / 1000);
      this.lastTick = now;
      this.tick(dt);
      if (this.sounds.size === 0) {
        this.ticking = false;
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Плавное движение громкости; отдельного таймера у игры нет. */
  private tick(dt: number): void {
    let busy = false;
    for (const sound of this.sounds.values()) {
      if (sound.dead) continue;
      if (sound.gain !== sound.target) {
        const step = sound.rate * dt;
        sound.gain =
          sound.gain < sound.target
            ? Math.min(sound.target, sound.gain + step)
            : Math.max(sound.target, sound.gain - step);
        busy = true;
      }
      if (sound.target === 0 && sound.gain <= 0.001) {
        if (!sound.audio.paused) sound.audio.pause();
        sound.gain = 0;
        continue;
      }
    }
    this.applyVolumes();
    if (!busy) this.ticking = false;
  }
}

/** Один на игру: катсцена, гул тоннеля и `M` ходят сюда же. */
export const soundscape = new Soundscape();
