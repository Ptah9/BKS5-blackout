import * as THREE from 'three';

import './style.css';
import { Voices, presetFor, type VoicePreset } from './audio/voice';
import { soundscape, type SoundName } from './audio/soundscape';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { RemotePlayers } from './game/remotePlayers';
import { Player } from './game/player';
import type { RemotePlayer } from './net/replica';
import { Inventory } from './game/inventory';
import { Pulse } from './game/pulse';
import { CutscenePlayer, type CutsceneData } from './game/cutscene';
import { Replica } from './net/replica';
import { Net } from './net/socket';
import { PostFX } from './render/post';
import { createEnvironment, createTextures } from './render/textures';
import { Hud } from './ui/hud';
import { AdminPanel, type AdminState } from './ui/admin';
import { ensureSession, forgetSession } from './ui/login';
import { ChunkManager } from './world/chunks';
import { Characters, type CharacterId, type SceneryItem } from './world/characters';
import { Passengers, type PassengerSpot } from './world/passengers';
import { CAR_HEIGHT, setVentOpen, setCabDoorOpen } from './world/car';
import { buildCab } from './world/cab';
import { buildTunnel } from './world/tunnel';
import { buildPlatform } from './world/platform';
import { createPropMesh } from './world/propMeshes';
import { ViewHand } from './world/viewHand';
import type { Box2 } from './world/collision';
import type { LightSpot } from './world/location';

/**
 * M2: вход по логину с паролем, состояние в базе, другие игроки в вагоне.
 *
 * Кадр считается в низком разрешении (640 точек по длинной стороне) и потом
 * растягивается браузером — так работает и стиль, и производительность.
 */

const LONG_SIDE = 640;
const INPUT_INTERVAL = 1 / 20;

// Отладочная ручка: по ней проверяются движение, позиция и кадры без скриншотов.
// Клиент и так целиком в браузере, скрывать тут нечего.
declare global {
  interface Window {
    __game?: {
      player: Player;
      camera: THREE.PerspectiveCamera;
      scene: THREE.Scene;
      renderer: THREE.WebGLRenderer;
      fps: () => number;
      cutscene: CutscenePlayer;
      playCutscene: (id: string) => Promise<void>;
      voices: Voices;
      npcCount: () => number;
      turn: (deg: number) => number;
      seat: (forward: number, up: number) => { forward: number; up: number } | null;
      probe: () => Record<string, unknown>;
    };
  }
}

async function main(): Promise<void> {
  // без токена дальше не идём: сервер всё равно закроет сокет
  const session = await ensureSession();

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const elConn = document.getElementById('s-conn') as HTMLElement;
  const elPing = document.getElementById('s-ping') as HTMLElement;
  const elFps = document.getElementById('s-fps') as HTMLElement;
  const elName = document.getElementById('s-name') as HTMLElement;  const elChunks = document.getElementById('s-chunks') as HTMLElement;
  const elMem = document.getElementById('s-mem') as HTMLElement;
  const elPos = document.getElementById('s-pos') as HTMLElement;
  const elPanic = document.getElementById('v-panic') as HTMLElement;
  const elTrust = document.getElementById('v-trust') as HTMLElement;
  const elAir = document.getElementById('v-air') as HTMLElement;
  const elStress = document.getElementById('stress') as HTMLElement;
  const elLobby = document.getElementById('lobby') as HTMLElement;
  const elLobbyPlayers = document.getElementById('lobby-players') as HTMLElement;
  const elLobbyStart = document.getElementById('lobby-start') as HTMLButtonElement;
  const elBagBtn = document.getElementById('bag-btn') as HTMLButtonElement;

  /** Игра начинается по кнопке, чтобы у всех был один старт. */
  let gameStarted = false;
  /** Смерть от паники/доверия: ввод заблокирован, висит экран «начать заново». */
  let dead = false;
  const elHint = document.getElementById('hint') as HTMLElement;
  const elObjective = document.getElementById('objective') as HTMLElement;

  elName.textContent = session.name;

  /* ───────────────────────────── рендерер ───────────────────────────── */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);
  scene.fog = new THREE.FogExp2(0x030406, 0.075);
  scene.environment = createEnvironment(renderer);
  scene.environmentIntensity = 0.25;

  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
  /** Рука от первого лица: предмет в кисти и телефон в интро. */
  const viewHand = new ViewHand(camera);

  /* ───────────────────────────── мир ───────────────────────────── */

  const textures = createTextures();
  const chunks = new ChunkManager(textures);
  scene.add(chunks.group);

  // кабина, тоннель и платформа: окружение из отдельной ветки
  const cab = buildCab(textures);
  const tunnel = buildTunnel(textures);
  const platform = buildPlatform(textures);
  scene.add(cab.group, tunnel.group, platform.group);

  /** Где искать плафоны: вагон и три локации. Гасим и зажигаем их по имени. */
  const lampRoots: THREE.Object3D[] = [chunks.group, cab.group, tunnel.group, platform.group];

  interface LocationLight {
    light: THREE.PointLight;
    /** Цвет из подсказки: к нему подмешивается оттенок режима. */
    base: THREE.Color;
    /** Яркость из подсказки: её масштабирует общий уровень света. */
    intensity: number;
  }

  const locationLights: LocationLight[] = [];

  // Свет локаций той же природы, что заливка вагона: точечный, с затуханием,
  // без теней. Модули сами источников не создают — только подсказывают, где
  // ставить, и подбирают яркость под этот рендер (в тоннеле ~30).
  for (const loc of [cab, tunnel, platform]) {
    const spots = (loc.group.userData.lightSpots as LightSpot[] | undefined) ?? [];
    for (const spot of spots) {
      const light = new THREE.PointLight(spot.color, 0, spot.distance, 2);
      light.position.set(spot.x, spot.y, spot.z);
      scene.add(light);
      locationLights.push({ light, base: new THREE.Color(spot.color), intensity: spot.intensity });
    }
  }

  /** Оттенки режимов: тёплое городское питание и холодный свет лампы. */
  const WARM_LIGHT = new THREE.Color(0xffe4b8);
  const COLD_LIGHT = new THREE.Color(0x9dc2ff);

  /** Дверь в кабину открыта — проход свободен. */
  let cabOpen = false;
  /** Петля двери в кабину: её крутим, когда дверь открывают. */
  const cabDoorHinge = cab.group.userData.door?.front as THREE.Group | undefined;

  /** Проём в кабину перекрыт, пока дверь закрыта. */
  const cabBlocker: Box2 = { minX: -0.45, maxX: 0.45, minZ: -10.05, maxZ: -9.85 };
  /** Стены вагона: раньше игрока держали границы мира, теперь мир шире. */
  const carWalls: Box2[] = [
    { minX: -1.5, maxX: -1.33, minZ: -10, maxZ: 10 },
    { minX: 1.33, maxX: 1.5, minZ: -10, maxZ: 10 },
    { minX: -1.5, maxX: 1.5, minZ: 9.9, maxZ: 10.2 },
  ];

  /** Коллайдеры текущего кадра: вагон, кабина, тоннель, платформа и дверь. */
  const walkColliders = (): Box2[] => [
    ...chunks.colliders,
    ...carWalls,
    ...cab.colliders,
    ...tunnel.colliders,
    ...platform.colliders,
    ...(cabOpen ? [] : [cabBlocker]),
  ];

  // Модели персонажей: пассажиры и агенты берут их отсюда.
  const characters = new Characters();
  /** Ссылка на пассажиров: нужна кнопке доворота на глаз. */
  let passengers: Passengers | null = null;

  // Пассажиры: расстановка в данных, модели — из charachters/*.glb.
  void Promise.all([
    characters.load(),
    fetch('/api/content/passengers.json').then((response) => (response.ok ? response.json() : null)),
    fetch('/api/content/scenery.json').then((response) => (response.ok ? response.json() : null)),
  ])
    .then(([, passengersData, sceneryData]) => {
      const spots = (passengersData as { spots?: PassengerSpot[] } | null)?.spots ?? [];
      if (spots.length > 0) {
        passengers = new Passengers(spots, characters);
        scene.add(passengers.group);
      }

      // мелкие вещи: велосипед у Владимира и всё, что допишут в данные
      const items = (sceneryData as { items?: SceneryItem[] } | null)?.items ?? [];
      for (const item of items) {
        const object = characters.create(item.model as CharacterId);
        if (!object) continue;
        object.position.set(item.x, item.y ?? 0, item.z);
        object.rotation.y = item.yaw ?? 0;
        scene.add(object);
      }
    })
    .catch(() => {
      // без пассажиров играется, просто вагон пустой
    });

  const remotePlayers = new RemotePlayers(characters);
  scene.add(remotePlayers.group);

  const ambient = new THREE.AmbientLight(0x263247, 0.16);
  scene.add(ambient);

  scene.add(camera);

  const emergency = new THREE.PointLight(0xff2a18, 2.2, 7, 2);
  emergency.position.set(0, CAR_HEIGHT - 0.2, 0);
  scene.add(emergency);

  // Заливка вагона: четыре лампы по длине. Ставим их на высоте груди, а не под
  // потолком — иначе на потолке получается один огромный белый круг.
  const fillLights = [-6.5, -2.5, 2.5, 6.5].map((z) => {
    // оттенок тот же, что даёт лампа из бутылки и телефона
    const light = new THREE.PointLight(0xdfe8ff, 0, 9, 2);
    light.position.set(0, 1.55, z);
    scene.add(light);
    return light;
  });

  // Свет в вагоне: 1 — горят лампы, 0 — полный блэкаут.
  // Значение приходит из сценария, поэтому его держим отдельно от рендера.
  let lightsValue = 1;
  /** Куда свет едет: включается не рывком, а за пару секунд. */
  let lightsTarget = 1;
  let lastAppliedLights = -1;
  let lastChunkVersion = -1;
  /** Сила тряски камеры от паники: 0 — спокойно, 1 — психоз. */
  let shake = 0;
  /** После крафта света остальные гасят экраны: они больше не нужны. */
  let phonesDimmed = false;
  /** Лампа из бутылки и телефона ставится в мире один раз. */
  let lampPlaced = false;
  /** true — свет уже от бутылки с телефоном: холодный и тусклее, чем городской. */
  let lampMode = false;
  /** true — в кабине включили резервный свет: тёплый городской режим и таймер. */
  let cabLightOn = false;
  /** Гул тоннеля: включается на входе за кабину и гаснет при возврате. */
  let tunnelHumOn = false;
  /** Песня у Альтушки: включается один раз, когда интро позади. */
  let dinastyOn = false;
  /** Где сейчас её источник: тянем из живой позиции NPC, а не из константы. */
  let dinastyAt: [number, number] = [0.6, 0.9];

  /** Первое значение света после входа ставим сразу: иначе вагон вспыхивает
   *  и гаснет рывком, пока идёт плавный переход. */
  let lightsInitialized = false;

  function setLights(value: number): void {
    lightsTarget = Math.max(0, Math.min(1, value));
    // отладка: видно, кто и когда двигал свет
    (window as unknown as { __lightsLog?: Array<[number, number]> }).__lightsLog ??= [];
    (window as unknown as { __lightsLog: Array<[number, number]> }).__lightsLog.push([
      Math.round(performance.now()),
      lightsTarget,
    ]);

    if (!lightsInitialized) {
      lightsInitialized = true;
      lightsValue = lightsTarget;
      lastAppliedLights = -1;
      updateLights();
    }
  }

  /** Плавный переход: вагон не щёлкает, а разгорается. */
  function smoothLights(dt: number): void {
    const diff = lightsTarget - lightsValue;
    if (Math.abs(diff) < 0.004) {
      if (lightsValue !== lightsTarget) {
        lightsValue = lightsTarget;
        updateLights();
      }
      return;
    }
    lightsValue += diff * Math.min(1, dt * 2.6);
    updateLights();
  }

  function updateLights(): void {
    // пересчитываем только когда изменился свет или загрузился новый чанк
    if (lightsValue === lastAppliedLights && chunks.version === lastChunkVersion) return;
    lastAppliedLights = lightsValue;
    lastChunkVersion = chunks.version;

    // резервный свет в кабине: пока горит — тёплый городской режим на полную,
    // независимо от сценария и от лампы из бутылки
    const level = cabLightOn ? 1 : lightsValue;
    const warm = !lampMode || cabLightOn;

    for (const root of lampRoots) {
      root.traverse((node) => {
        if (node.name === 'lamp') {
          const mesh = node as THREE.Mesh;
          const material = mesh.material as THREE.MeshStandardMaterial;
          // до блэкаута плафоны тёплые, от лампы из бутылки — холодные
          if (warm) material.emissive.setRGB(1, 0.97, 0.88).multiplyScalar(level * 0.9);
          else material.emissive.setRGB(0.62, 0.78, 1).multiplyScalar(level * 0.9);
          return;
        }

        // после крафта света экраны у людей гаснут
        if (node.name === 'phones' && phonesDimmed) {
          const mesh = node as THREE.Mesh;
          const material = mesh.material as THREE.MeshBasicMaterial;
          material.color.setHex(0x2b3550);
        }
      });
    }

    // Свет локаций. Общий уровень тот же, что у вагона: в блэкауте он ноль,
    // и тоннель с платформой не светятся; после крафта холодный оттенок.
    const tint = warm ? WARM_LIGHT : COLD_LIGHT;
    for (const spot of locationLights) {
      spot.light.intensity = spot.intensity * level;
      spot.light.color.copy(spot.base).lerp(tint, 0.45);
    }

    if (!warm) {
      // свет от бутылки с телефоном: холодный, приглушённый
      ambient.intensity = 0.16 + level * 0.45;
      scene.environmentIntensity = 0.25 + level * 0.3;
      for (const light of fillLights) {
        light.color.setHex(0x9dc2ff);
        light.intensity = level * 3.3;
      }
    } else {
      // городское питание: тёплое и ярче
      ambient.intensity = 0.16 + level * 0.55;
      scene.environmentIntensity = 0.25 + level * 0.35;
      for (const light of fillLights) {
        light.color.setHex(0xffe4b8);
        light.intensity = level * 5.4;
      }
    }
  }

  function setObjective(text: string): void {
    if (!text) {
      elObjective.classList.add('hidden');
      return;
    }
    elObjective.textContent = text;
    elObjective.classList.remove('hidden');
  }

  /** Паника мира: голоса персонажей злее, когда всем страшно. */
  let worldPanic = 20;

  /** Порог, на котором толпа замолкает совсем. */
  const CROWD_SILENT_PANIC = 30;
  /** Прошлая паника: по ней ловим именно переход через порог вниз. */
  let lastPanicForVoice: number | null = null;

  /**
   * Шёпот толпы по панике. До 30 и ниже — полная тишина без слышимого хвоста
   * (гасим дорожку за 0.05 с), выше — обычная громкость от паники.
   */
  function applyCrowdVoice(panic: number): void {
    if (panic <= CROWD_SILENT_PANIC) {
      soundscape.setChannelScale('whisper', 0, 0.05);
      if (lastPanicForVoice !== null && lastPanicForVoice > CROWD_SILENT_PANIC) {
        // один раз на переход, а не на каждом тике stats
        hud.say('Вагон затихает. Люди смотрят на тебя.', 6);
      }
    } else {
      soundscape.setPanic(panic);
    }
    lastPanicForVoice = panic;
  }

  /** Паника, доверие и воздух приходят с сервера: это состояние мира. */
  let lastTrust = 50;
  function setStats(panic: number, trust: number, air: number): void {
    worldPanic = panic;
    lastTrust = trust;
    applyCrowdVoice(panic);
    hud.setAnnounceGoal(announceMode, panic, trust);
    elPanic.textContent = String(panic);
    elTrust.textContent = String(trust);
    elAir.textContent = String(air);

    elPanic.classList.toggle('high', panic >= 65);
    elTrust.classList.toggle('high', trust >= 65);
    elAir.classList.toggle('low', air <= 40);

    // «спираль паники»: чем выше, тем плотнее виньетка и заметнее тряска
    const stress = Math.max(0, Math.min(1, (panic - 30) / 70));
    elStress.style.opacity = String(stress * 0.75);
    shake = stress * 0.006;
  }

  /* ── катсцены ─────────────────────────────────────────────────────── */

  const elCutscene = document.getElementById('cutscene') as HTMLElement;
  const elCutsceneSub = document.getElementById('cutscene-sub') as HTMLElement;
  const elPhone = document.getElementById('phone') as HTMLElement;
  const elPhoneNet = document.getElementById('phone-net') as HTMLElement;
  const elPhoneVideo = document.getElementById('phone-video') as HTMLVideoElement;

  // PS1-телефон: видео декодируется как обычно (и звучит), но на экран выводим
  // canvas с буфером и рубим сглаживание; корпус и надпись «нет сети» рисуются
  // там же — никакого DOM-текста поверх мира.
  const PHONE_W = 128;
  const PHONE_H = 228;
  /** false — телефон как в оригинале (обычное видео и DOM-плашка), true — PS1-буфер. */
  const PHONE_PS1 = false;
  const SCREEN_X = 19;
  const SCREEN_Y = 34;
  const SCREEN_W = 90;
  const SCREEN_H = 160;
  /** true — на экране плашка «нет сети» (рисуется в буфере, не в DOM). */
  let phoneNet = false;
  let netPlate: HTMLCanvasElement | null = null;

  const elPhoneScreen = document.createElement('canvas');
  elPhoneScreen.width = PHONE_W;
  elPhoneScreen.height = PHONE_H;
  elPhoneScreen.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    'image-rendering:pixelated',
    'background:transparent',
    'pointer-events:none',
  ].join(';');
  elPhoneVideo.style.opacity = PHONE_PS1 ? '0' : '1';
  elPhoneVideo.after(elPhoneScreen);
  if (!PHONE_PS1) elPhoneScreen.style.display = 'none';
  const phoneCtx = elPhoneScreen.getContext('2d');
  if (phoneCtx) phoneCtx.imageSmoothingEnabled = false;

  /** Плашка «нет сети»: текст режется порогом, поэтому буквы без сглаживания. */
  function makeNetPlate(): HTMLCanvasElement {
    const layer = document.createElement('canvas');
    layer.width = SCREEN_W;
    layer.height = SCREEN_H;
    const g = layer.getContext('2d');
    if (!g) return layer;

    g.fillStyle = '#ffffff';
    g.font = 'bold 13px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('нет сети', SCREEN_W / 2, SCREEN_H / 2);

    const img = g.getImageData(0, 0, SCREEN_W, SCREEN_H);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const on = data[i + 3] > 100;
      data[i] = 231;
      data[i + 1] = 236;
      data[i + 2] = 243;
      data[i + 3] = on ? 255 : 0;
    }
    g.putImageData(img, 0, 0);
    return layer;
  }

  /** Кадр телефона: корпус, экран с видео, плашка. Всё в одном буфере. */
  function drawPhoneFrame(): void {
    if (!phoneCtx || elPhone.classList.contains('hidden')) return;
    const ctx = phoneCtx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PHONE_W, PHONE_H);

    // корпус: жёсткие края, без теней и размытий
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, PHONE_W, PHONE_H);
    ctx.fillStyle = '#161b23';
    ctx.fillRect(2, 2, PHONE_W - 4, PHONE_H - 4);
    ctx.fillStyle = '#232a34';
    ctx.fillRect(52, 12, 24, 3);
    // рамка экрана
    ctx.fillStyle = '#090b0f';
    ctx.fillRect(SCREEN_X - 2, SCREEN_Y - 2, SCREEN_W + 4, SCREEN_H + 4);

    if (elPhoneVideo.readyState >= 2 && elPhoneVideo.videoWidth > 0) {
      const vw = elPhoneVideo.videoWidth;
      const vh = elPhoneVideo.videoHeight;
      const scale = Math.max(SCREEN_W / vw, SCREEN_H / vh);
      const sw = SCREEN_W / scale;
      const sh = SCREEN_H / scale;
      ctx.drawImage(
        elPhoneVideo,
        (vw - sw) / 2,
        (vh - sh) / 2,
        sw,
        sh,
        SCREEN_X,
        SCREEN_Y,
        SCREEN_W,
        SCREEN_H,
      );
    }

    if (phoneNet) {
      ctx.fillStyle = 'rgba(6, 8, 11, 0.74)';
      ctx.fillRect(SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H);
      if (!netPlate) netPlate = makeNetPlate();
      ctx.drawImage(netPlate, SCREEN_X, SCREEN_Y);
    }
  }

  const cutscene = new CutscenePlayer(
    camera,
    {
      onSubtitle: (text) => {
        elCutsceneSub.textContent = text;
        elCutsceneSub.classList.toggle('hidden', !text);
      },
      onLights: (value) => setLights(value),
      onPhone: (action, src) => {
        switch (action) {
          case 'play': {
            if (src && elPhoneVideo.src !== location.origin + src) elPhoneVideo.src = src;
            phoneNet = false;
            elPhoneNet.classList.add('hidden');
            elPhone.classList.remove('lowered');
            elPhone.classList.remove('hidden');
            elPhoneVideo.currentTime = 0;

            // звук включаем, если браузер разрешил: кнопка «Начать» даёт на это право.
            // Если автозапуск отклонили — играем без звука, но сцену не ломаем.
            elPhoneVideo.muted = false;
            elPhoneVideo.volume = 0.8;
            void elPhoneVideo.play().catch(() => {
              elPhoneVideo.muted = true;
              void elPhoneVideo.play().catch(() => {});
            });
            return;
          }
          case 'freeze':
            // видео виснет на кадре — ровно как залипший тик-ток
            elPhoneVideo.pause();
            return;
          case 'net':
            // плашка: в PS1-режиме рисуется в буфере, иначе это обычный DOM-элемент
            phoneNet = true;
            elPhoneNet.classList.toggle('hidden', PHONE_PS1);
            return;
          case 'lower':
            // экран уходит вниз: сначала телефон, потом подъём
            elPhone.classList.add('lowered');
            return;
          case 'hide':
            elPhoneVideo.pause();
            phoneNet = false;
            elPhone.classList.add('hidden');
            elPhone.classList.remove('lowered');
            elPhoneNet.classList.add('hidden');
            // рука исчезает ровно вместе с телефоном, а не в конце сцены
            viewHand.holdPhone(false);
            return;
        }
      },
      onEnd: (yaw, pitch) => {
        elCutscene.classList.add('hidden');
        elCutsceneSub.classList.add('hidden');
        viewHand.holdPhone(false);

        // телефон уже убран — теперь игрок встаёт с сиденья
        player.setView(yaw, pitch);
        if (player.isSitting) player.standUp();
      },
    },
    () => ({ x: player.position.x, z: player.position.z, yaw: player.facing }),
  );

  async function playCutscene(id: string): Promise<void> {
    if (cutscene.playing) return;

    try {
      const response = await fetch(`/api/content/cutscenes/${encodeURIComponent(id)}.json`);
      if (!response.ok) {
        console.info('[катсцена] файл не найден:', id);
        return;
      }
      const data = (await response.json()) as CutsceneData;
      cutscene.start(data);
      elCutscene.classList.remove('hidden');
      // рука с телефоном: персонаж поднимает его к глазам в интро
      viewHand.holdPhone(id === 'intro_blackout');
      hud.say('');
    } catch (error) {
      console.info('[катсцена] не загрузилась:', id, error);
    }
  }

  const bounds = {
    // мир шире вагона: кабина, тоннель и платформа. Стены держат коллайдеры.
    minX: -9.2,
    maxX: 2.3,
    minZ: -36.9,
    maxZ: 9.7,
  };

  const player = new Player(camera);
  const input = new Input(canvas);
  const replica = new Replica();

  const inventory = new Inventory();
  const hud = new Hud(inventory);
  // панель администратора: оверлей, живёт отдельно от HUD; ручки идут в net
  const admin = new AdminPanel(
    (kind, value, flag, code, npc, text) => net.adminSet(kind, value, flag, code, npc, text),
    (id, text, code) => net.adminPersona(id, text, code),
  );
  const pulse = new Pulse();
  // звук: блипы в духе Undertale, по одному на символ реплики
  const voices = new Voices();
  // звуковая сцена: файлы тянем заранее, играть начинает сценарий и мир
  soundscape.preload();

  /** Мысленный азарт толпы 0..1: выше паника — выше и злее голоса. */
  const mood = (): number => Math.max(0, Math.min(1, (worldPanic - 30) / 70));

  /* ── персонажи и разговор ─────────────────────────────────────────── */

  const elTalk = document.getElementById('talk') as HTMLElement;
  const elInteract = document.getElementById('interact') as HTMLElement;
  const elSubtitles = document.getElementById('subtitles') as HTMLElement;
  const elChat = document.getElementById('chat') as HTMLElement;
  const elChatName = document.getElementById('chat-name') as HTMLElement;
  const elChatInput = document.getElementById('chat-input') as HTMLInputElement;

  const npcEntities: RemotePlayer[] = [];
  const npcIds: string[] = [];

  interface PropVerb {
    id: string;
    label: string;
    text: string;
    flag?: string;
    value?: boolean;
    requiresFlag?: string;
  }

  interface PropView {
    id: string;
    name: string;
    pos: number[];
    radius: number;
    verbs: PropVerb[];
  }

  let worldProps: PropView[] = [];
  let nearProp: PropView | null = null;
  let nearPropVerb: PropVerb | null = null;
  /** Что уже унесли из мира: такие предметы не показываем и не предлагаем. */
  const takenProps = new Set<string>();
  /** Какие флаги мира уже стоят: по ним прячем отработавшие действия. */
  const worldFlags = new Set<string>();
  const propMeshes = new Map<string, THREE.Object3D>();

  const dropProp = (id: string): void => {
    takenProps.add(id);
    const mesh = propMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      propMeshes.delete(id);
    }
  };

  // предметы мира (двери, кнопки, люки) приезжают из content/props.json
  void fetch('/api/content/props.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { props?: PropView[] } | null) => {
      worldProps = data?.props ?? [];

      // что можно взять — то и видно: у каждой вещи своя фигурка
      for (const prop of worldProps) {
        const mesh = createPropMesh(prop.id);
        if (!mesh) continue;
        mesh.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
        scene.add(mesh);
        propMeshes.set(prop.id, mesh);
      }
    })
    .catch(() => {
      // без предметов играть можно, просто нечего нажимать
    });

  let nearNpc: RemotePlayer | null = null;
  let talkingTo: RemotePlayer | null = null;
  let chatOpen = false;
  /** Чат открыт для объявления в микрофон, а не для разговора с NPC. */
  let announceMode = false;
  let subtitleTimer = 0;

  /**
   * Печать реплики. Модель присылает текст пачками, а печатаем мы сами, по
   * символу за такт голоса: тогда звук идёт ровно там, где появляются буквы,
   * а не догоняет пачку задним числом.
   */
  interface Typing {
    id: string;
    name: string;
    shown: string;
    queue: string;
    /** Накопленное время, мс. */
    acc: number;
    done: boolean;
    preset: VoicePreset;
  }
  let typing: Typing | null = null;

  function updateTyping(dt: number): void {
    if (!typing) return;

    // длинную реплику печатаем чуть быстрее, иначе хвост висит после ответа
    const hurry = typing.queue.length > 80 ? 0.6 : 1;
    const step = voices.step(typing.preset, mood()) * hurry;
    typing.acc += dt * 1000;

    let printed = false;
    while (typing.queue.length > 0 && typing.acc >= step) {
      typing.acc -= step;
      const char = typing.queue[0];
      typing.queue = typing.queue.slice(1);
      typing.shown += char;
      printed = true;
      // блип на символ, включая пунктуацию: в игре пропускается только пробел
      voices.speak(char, typing.preset, mood());
    }

    if (printed) elSubtitles.textContent = `${typing.name}: ${typing.shown}`;

    if (typing.done && typing.queue.length === 0) {
      subtitleTimer = 9;
      typing = null;
    }
  }

  function openChat(npc: RemotePlayer): void {
    announceMode = false;
    talkingTo = npc;
    chatOpen = true;
    elChatName.textContent = npc.name;
    elChat.classList.remove('hidden');
    elChatInput.value = '';
    document.exitPointerLock();
    elChatInput.focus();
  }

  /**
   * Объявление в микрофон: то же поле, что у чата с NPC, только адресат — вагон.
   * Текст оценивает сервер по ключевым словам; модель тут не нужна.
   */
  function openAnnounce(): void {
    announceMode = true;
    talkingTo = null;
    chatOpen = true;
    elChatName.textContent = 'в микрофон';
    elChat.classList.remove('hidden');
    elChatInput.value = '';
    elChatInput.placeholder = 'сказать всему вагону…';
    document.exitPointerLock();
    elChatInput.focus();
    hud.setAnnounceGoal(true, worldPanic, lastTrust);
  }

  function closeChat(): void {
    chatOpen = false;
    announceMode = false;
    talkingTo = null;
    elChat.classList.add('hidden');
    elChatInput.blur();
    elChatInput.placeholder = 'сказать…';
    hud.setAnnounceGoal(false, worldPanic, lastTrust);
  }

  /** Акт 1 закрыт: один флаг, который ставит сервер, когда цель мини-игры взята. */
  function actOneReady(): boolean {
    return worldFlags.has('act1_done');
  }

  hud.say('Темно. В кармане бутылка воды и телефон — экран светит синим.');

  /**
   * Лампа из подручного: телефон экраном вверх, сверху пластиковая бутылка —
   * она разбивает свет по всему вагону. Стоит на полу там, где её собрали.
   */
  function addLamp(x: number, z: number): void {
    if (lampPlaced) return;
    lampPlaced = true;

    const group = new THREE.Group();
    group.name = 'lamp';
    group.position.set(x, 0, z);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.012, 0.17),
      new THREE.MeshBasicMaterial({ color: 0xf2f6ff }),
    );
    screen.position.y = 0.016;
    group.add(screen);

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.042, 0.23, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xc9dcff,
        transparent: true,
        opacity: 0.34,
        roughness: 0.25,
        side: THREE.DoubleSide,
        emissive: 0x8fb0ff,
        emissiveIntensity: 0.45,
      }),
    );
    glass.position.y = 0.13;
    group.add(glass);

    // свет от лампы почти рассеянный: главное — общий ровный свет по вагону,
    // а не пятно под ногами
    const light = new THREE.PointLight(0xb9d4ff, 1.1, 3.2, 2);
    light.position.y = 0.28;
    group.add(light);

    scene.add(group);
  }

  function placeName(): string {
    const z = player.position.z;
    if (z > 4) return 'вагон · к тамбуру';
    if (z < -4) return 'вагон · к кабине';
    return 'вагон · середина';
  }

  /**
   * Часть мира для сценария. Клиент только сообщает, где он; реагирует сервер.
   * Платформу проверяем раньше тоннеля: она лежит слева от его стены и внутри
   * тех же Z, отличается только по X.
   */
  function zoneAt(x: number, z: number): string {
    if (x < -2.42 && x >= -9.2 && z <= -12.6) return 'platform';
    if (z <= -12.6 && z >= -36.6) return 'tunnel';
    return z < 0 ? 'car_a' : 'car_b';
  }

  /* ───────────────────────────── картинка ───────────────────────────── */

  function targetSize(): { width: number; height: number } {
    const w = Math.max(320, innerWidth);
    const h = Math.max(180, innerHeight);
    const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
    return { width: Math.max(320, Math.round(w * scale)), height: Math.max(180, Math.round(h * scale)) };
  }

  const post = new PostFX(targetSize().width, targetSize().height);

  function resize(): void {
    const { width, height } = targetSize();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post.setSize(width, height);
  }

  addEventListener('resize', resize);
  resize();

  /* ───────────────────────────── сеть ───────────────────────────── */

  /** Последний замер ping: уходит на сервер вместе с fps в панель админа. */
  let lastPingMs = 0;

  /** Агенты с сервера: общий приём для снапшота и события «появился». */
  function applyNpcs(
    list: Array<{ id: string; name: string; pos: number[]; yaw: number; model?: string }>,
  ): void {
    npcEntities.length = 0;
    npcIds.length = 0;
    list.forEach((npc, index) => {
      npcIds.push(npc.id);
      npcEntities.push({
        id: 1000 + index,
        name: npc.name,
        x: npc.pos[0],
        z: npc.pos[2],
        yaw: npc.yaw,
        model: npc.model,
        targetX: npc.pos[0],
        targetZ: npc.pos[2],
        targetYaw: npc.yaw,
        lastSeen: Number.MAX_SAFE_INTEGER,
      });
    });
  }

  const net = new Net(session.token, {
    onState: (state) => {
      elConn.textContent = state === 'open' ? 'есть' : state === 'connecting' ? 'подключаюсь…' : 'нет';
    },
    onWelcome: (you, name) => {
      elConn.textContent = `есть, как ${name} (#${you})`;
    },
    onSnapshot: (self, players, slots) => {
      player.teleport(self.x, self.z, self.yaw);
      replica.apply(players, self.id, performance.now());
      inventory.apply(slots);
      hud.renderSlots();
    },
    onInventory: (slots, text) => {
      inventory.apply(slots);
      hud.renderSlots();
      if (text) hud.say(text);

      if (inventory.has('flashlight') && !phonesDimmed) {
        phonesDimmed = true;
        lastAppliedLights = -1; // заставим пересчитать свет и экраны
      }
    },
    onEvent: (kind, data) => {
      // отладка: журнал событий сценария с временем — без него не понять,
      // кто именно гасит свет
      const log = ((window as unknown as { __eventLog?: Array<[number, string, unknown]> }).__eventLog ??= []);
      if (log.length < 200) log.push([Math.round(performance.now()), kind, data]);

      switch (kind) {
        case 'notes':
          hud.setNotes((data.list as Array<{ id: string; text: string }>) ?? []);
          return;
        case 'spawn':
          // сервер рассадил игроков: садимся на своё место до начала сцены
          player.sitDown(Number(data.x ?? 0), Number(data.z ?? 0), Number(data.yaw ?? 0));
          // страховка: если сцена не придёт (или её нет), сидеть вечно нельзя
          setTimeout(() => {
            if (player.isSitting && !cutscene.playing) player.standUp();
          }, 3000);
          return;
        case 'lamp':
          addLamp(Number(data.x ?? 0), Number(data.z ?? 0));
          // с этого момента вагон светит бутылкой с телефоном: холодно и тише
          if (!lampMode) {
            lampMode = true;
            lastAppliedLights = -1; // заставим пересчитать свет и цвет плафонов
          }
          return;
        case 'npcs': {
          // флаг появления поднялся: сервер прислал новый список агентов
          const list = (data.list as Array<{ id: string; name: string; pos: number[]; yaw: number; model?: string }>) ?? [];
          applyNpcs(list);
          return;
        }
        case 'death': {
          // личная смерть: ввод заблокирован, мир живёт дальше
          dead = true;
          document.exitPointerLock();
          hud.showDeath(String(data.text ?? 'Толпа выходит из-под контроля.'));
          return;
        }
        case 'revive': {
          dead = false;
          hud.hideDeath();
          return;
        }
        case 'cab_light': {
          // резервный свет в кабине: горит — тёплый городской режим и таймер
          const remaining = Number(data.remaining ?? 0);
          cabLightOn = remaining > 0;
          hud.setCabTimer(cabLightOn ? remaining : null);
          lastAppliedLights = -1; // режим меняется не по катсцене — пересчитать сразу
          updateLights();
          return;
        }
        case 'flag':
          // дверь кабины открыли — проход свободен, створка отходит
          if (data.flag === 'cab_open') cabOpen = true;
          if (typeof data.flag === 'string') {
            if (data.value) worldFlags.add(data.flag);
            else worldFlags.delete(data.flag);
          }
          return;
        case 'prop_taken': {
          const id = String(data.id ?? '');
          if (id) dropProp(id);
          return;
        }
        case 'world_state': {
          const taken = (data.taken as string[]) ?? [];
          const flags = (data.flags as string[]) ?? [];
          for (const id of taken) dropProp(id);
          for (const flag of flags) worldFlags.add(flag);
          if (worldFlags.has('cab_open')) cabOpen = true;
          return;
        }
        case 'ending':
          // финал: большая плашка и тишина вместо задач
          hud.say(String(data.text ?? ''), 25);
          setObjective('Финал');
          return;
        case 'say':
          hud.say(String(data.text ?? ''), 6);
          // объявление по громкой связи: сервер присылает звук вместе с текстом,
          // поэтому каждый повтор звучит и не расходится с лентой.
          // Дорожка (4,9 с) длиннее интервала повтора (4 с), поэтому перед
          // каждым разом гасим её и запускаем заново — иначе второй повтор молчит.
          if (data.sound) {
            const name = String(data.sound) as SoundName;
            const volume = Number(data.volume ?? 0.9);
            soundscape.stop(name, 0.05);
            window.setTimeout(() => soundscape.play(name, { volume }), 150);
          }
          return;
        case 'objective':
          setObjective(String(data.text ?? ''));
          return;
        case 'lights':
          setLights(Number(data.value ?? 0));
          return;
        case 'cutscene':
          void playCutscene(String(data.id ?? ''));
          return;
        case 'prop':
          hud.say(String(data.text ?? ''), 5);
          return;
        case 'stats':
          setStats(Number(data.panic ?? 0), Number(data.trust ?? 0), Number(data.air ?? 100));
          return;
        case 'phone':
          hud.say('На экране — «нет сети».', 4);
          return;
        default:
          console.info('[сценарий] действие без обработчика:', kind, data);
      }
    },
    onPlayers: (list) => {
      replica.apply(list, session.playerId, performance.now());
    },
    onNpcs: applyNpcs,
    onNpcReply: (id, delta, done) => {
      if (delta) {
        // новая реплика или другой собеседник — начинаем печатать с чистого листа
        if (!typing || typing.id !== id) {
          voices.reset();
          subtitleTimer = 0;
          typing = {
            id,
            name: talkingTo?.name ?? '—',
            shown: '',
            queue: '',
            acc: 0,
            done: false,
            preset: presetFor(id, talkingTo?.name),
          };
          elSubtitles.textContent = `${typing.name}: `;
        }
        typing.queue += delta;
        elSubtitles.classList.remove('hidden');
      }
      if (done && typing) typing.done = true;
    },
    onPong: (ms) => {
      lastPingMs = ms;
      elPing.textContent = `${Math.round(ms)} мс`;
    },
    onLobby: (players, started) => {
      gameStarted = started;
      elLobby.classList.toggle('hidden', started);

      elLobbyPlayers.innerHTML = '';
      for (const name of players) {
        const item = document.createElement('li');
        item.textContent = name;
        elLobbyPlayers.appendChild(item);
      }
      elLobbyStart.disabled = started;
    },
    onAdminState: (data) => {
      admin.render(data as unknown as AdminState);
    },
    onAuthFailed: () => {
      // токен протух или отозван: чистим и просим войти заново
      forgetSession();
      location.reload();
    },
  });

  net.connect();
  setInterval(() => net.ping(), 1000);

  // кнопка лобби: пока её не нажали, сценарий не идёт ни у кого
  elLobbyStart.addEventListener('click', () => {
    // это первый уверенный жест — разрешаем браузеру звук
    voices.unlock();
    net.start();
  });

  // звук в браузере стартует только с жеста: ловим любой, дальше unlock дёшев
  addEventListener('pointerdown', () => voices.unlock());
  addEventListener('keydown', () => voices.unlock());

  /* ───────────────────────────── кадр ───────────────────────────── */

  /** Рюкзак: пока открыт, мышь принадлежит панели, а не камере. */
  let bagOpen = false;
  /** Панель администратора: пока открыта, камера стоит, курсор свободен. */
  let adminOpen = false;

  function setBag(open: boolean): void {
    bagOpen = open;
    hud.setBagOpen(open);
    if (open) document.exitPointerLock();
  }

  function setAdmin(open: boolean): void {
    adminOpen = open;
    admin.setOpen(open);
    if (open) document.exitPointerLock();
  }

  elBagBtn.addEventListener('click', () => setBag(!bagOpen));

  hud.onSlot = (index) => {
    inventory.toggle(index);
    hud.renderSlots();
    const pair = inventory.pair;
    // два предмета выбраны — сразу соединяем, как по клавише C
    if (pair) net.combine(pair[0], pair[1]);
  };

  // «Начать заново» на экране смерти: сервер оживит и откатит толпу
  hud.onRestart = () => net.restart();

  addEventListener('keydown', (event) => {
    // пока висит экран смерти, игровые клавиши не работают
    if (dead) return;

    if (event.code === 'Escape' && cutscene.playing) {
      cutscene.skip();
      return;
    }

    if (event.code === 'Escape' && chatOpen) {
      closeChat();
      return;
    }

    if (event.code === 'KeyI' && !chatOpen) {
      event.preventDefault();
      setBag(!bagOpen);
      return;
    }

    // M — выключить/включить звук целиком: в общежитии играют ночью
    if (event.code === 'KeyM' && !chatOpen) {
      event.preventDefault();
      voices.toggleMute();
      return;
    }

    if (event.code === 'Escape' && bagOpen) {
      setBag(false);
      return;
    }

    if (event.code === 'Escape' && adminOpen) {
      setAdmin(false);
      return;
    }

    // F3 — панель администратора (раньше открывала отладочную плашку)
    if (event.code === 'F3') {
      event.preventDefault();
      setAdmin(!adminOpen);
      return;
    }

    if (event.code === 'KeyT' && !chatOpen && !bagOpen) {
      if (nearNpc) {
        // без этого нажатая буква (t или «е» в русской раскладке) попадает в поле
        event.preventDefault();
        openChat(nearNpc);
      }
      return;
    }

    if (event.code === 'KeyE' && !chatOpen && !bagOpen && !cutscene.playing) {
      if (!nearProp || !nearPropVerb) return;
      // «сказать в микрофон» — это не действие с предметом, а ввод текста:
      // открываем то же поле, что у чата с персонажем
      if (nearPropVerb.id === 'announce') {
        openAnnounce();
        return;
      }
      // в мир идём с тем предметом, что выбран в нижней полоске
      net.interact(nearProp.id, nearPropVerb.id, inventory.selectedItem);
      return;
    }

    // пока игрок печатает или роется в рюкзаке, игровые клавиши не работают
    if (chatOpen || bagOpen || adminOpen) return;

    if (/^Digit[1-8]$/.test(event.code)) {
      // в нижней полоске выбирается ровно один предмет: им и работаем с миром
      inventory.select(Number(event.code.slice(5)) - 1);
      hud.renderSlots();
      return;
    }
  });

  elChatInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const text = elChatInput.value.trim();
    if (!text) return;

    // объявление в микрофон: текст уходит серверу, он и решает, что услышали
    if (announceMode) {
      net.announce(text);
      elChatInput.value = '';
      closeChat();
      return;
    }

    if (!talkingTo) return;

    const npcId = npcIds[talkingTo.id - 1000];
    if (npcId) net.say(npcId, text);

    subtitleTimer = 0;
    // прошлая печать больше не нужна: новый ответ начнёт свою
    typing = null;
    voices.reset();
    elSubtitles.textContent = `${talkingTo.name}: …`;
    elSubtitles.classList.remove('hidden');
    elChatInput.value = '';
  });

  let inputAccumulator = 0;
  let hudAccumulator = 0;
  let lastFrame = performance.now();
  let lastZone = '';
  /** Когда в последний раз стучались в тоннель, чтобы не спамить сервер. */
  let lastExitTry = 0;

  const loop = startLoop(
    (dt) => {
      if (cutscene.playing) {
        // камера идёт по точкам, а движения мыши за это время не копим,
        // иначе после сцены камеру дёрнет
        cutscene.update(dt);
        input.consumeLook();
      } else if (gameStarted && !chatOpen && !bagOpen && !adminOpen && !dead) {
        player.update(dt, input, walkColliders(), bounds);

      // выбранный предмет в руке; setItem идемпотентен
      viewHand.setItem(inventory.selectedItem);
      viewHand.update(dt);
      }

      // из кабины в тоннель — только когда акт 1 закрыт: дверь мягко держит
      if (gameStarted && player.position.z < -12.4 && !actOneReady()) {
        player.teleport(player.position.x, -12.4, player.facing);
        const now = performance.now();
        if (now - lastExitTry > 2500) {
          lastExitTry = now;
          net.exitTry();
        }
      }

      // гул тоннеля не запускаем и не гасим, а делаем громче/тише:
      // после остановки поезда он уже играет тихо из интро
      if (!tunnelHumOn && player.position.z < -12.5) {
        tunnelHumOn = true;
        soundscape.setChannelVolume('tunnelWind', 0.07, 2.5);
      } else if (tunnelHumOn && player.position.z > -10) {
        tunnelHumOn = false;
        soundscape.setChannelVolume('tunnelWind', 0.03, 2);
      }

      // песня у Альтушки: по кругу, тихо, громче рядом с ней и тише к краям вагона;
      // источник — её текущая позиция, поэтому если её сдвинут, звук поедет следом
      const altIndex = npcIds.indexOf('altushka');
      const alt = altIndex >= 0 ? npcEntities[altIndex] : null;
      const altAt: [number, number] = alt ? [alt.x, alt.z] : dinastyAt;
      if (!dinastyOn && !cutscene.playing && performance.now() > 15000) {
        dinastyOn = true;
        dinastyAt = altAt;
        soundscape.play('dinasty', {
          volume: 0.001,
          fade: 4,
          loop: true,
          persist: true,
          at: altAt,
          near: 1,
          far: 2.5,
          nearVolume: 0.004,
        });
      } else if (dinastyOn && Math.hypot(altAt[0] - dinastyAt[0], altAt[1] - dinastyAt[1]) > 0.25) {
        dinastyAt = altAt;
        soundscape.play('dinasty', { at: altAt });
      }
      soundscape.setListener(player.position.x, player.position.z);

      chunks.update(player.position.z);

      // створки форточек в дверях: открываются по флагу, вызов идемпотентный
      setVentOpen(worldFlags.has('window_open'));
      // дверь кабины машиниста: на петлях, следует за флагом cab_open
      setCabDoorOpen(worldFlags.has('cab_open'));

      // ближайший персонаж: подсказка «T — поговорить»
      let closest: RemotePlayer | null = null;
      let bestDistance = 2.6;
      for (const npc of npcEntities) {
        const distance = Math.hypot(npc.x - player.position.x, npc.z - player.position.z);
        if (distance < bestDistance) {
          bestDistance = distance;
          closest = npc;
        }
      }
      nearNpc = closest;
      elTalk.classList.toggle('hidden', !nearNpc || chatOpen);
      if (nearNpc) elTalk.textContent = `T — поговорить: ${nearNpc.name}`;

      // ближайший предмет, на который смотрит игрок
      let closestProp: PropView | null = null;
      let closestVerb: PropVerb | null = null;
      let bestPropDistance = Infinity;

      const forwardX = -Math.sin(player.facing);
      const forwardZ = -Math.cos(player.facing);

      for (const prop of worldProps) {
        if (takenProps.has(prop.id)) continue;
        const dx = prop.pos[0] - player.position.x;
        const dz = prop.pos[2] - player.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > prop.radius) continue;

        // проверяем, что игрок смотрит в сторону предмета, а не стоит спиной:
        // порог мягкий, иначе подсказка не появляется при взгляде чуть вбок
        const dot = (dx * forwardX + dz * forwardZ) / Math.max(0.001, distance);
        if (dot < 0.15) continue;

        if (distance < bestPropDistance) {
          bestPropDistance = distance;
          closestProp = prop;
        }
      }

      if (closestProp) {
        // отработавшие действия не предлагаем: дверь уже открыта, свет уже есть
        const available = closestProp.verbs.filter((verb) => !verb.flag || !worldFlags.has(verb.flag));
        closestVerb = available.find((verb) => verb.id !== 'look') ?? available[0] ?? null;
      }

      nearProp = closestProp;
      nearPropVerb = closestVerb;

      elInteract.classList.toggle('hidden', !nearProp || chatOpen);
      if (nearProp && nearPropVerb) {
        elInteract.textContent = `E — ${nearPropVerb.label}: ${nearProp.name}`;
      }

      // сообщаем серверу, когда игрок переходит в другую часть мира
      const zone = zoneAt(player.position.x, player.position.z);
      if (zone !== lastZone) {
        lastZone = zone;
        net.sendZone(zone);
      }

      pulse.update(dt, {
        lightOn: inventory.has('flashlight'),
        moving: player.speed > 0.35,
        scared: false,
      });

      inputAccumulator += dt;
      if (!chatOpen && inputAccumulator >= INPUT_INTERVAL) {
        inputAccumulator = 0;
        net.sendInput(player.position.x, player.position.z, player.facing);
      }
    },
    (alpha, elapsed) => {
      const now = performance.now();
      const frameDt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      emergency.intensity = 2.0 + Math.sin(elapsed * 2.3) * 0.5;
      smoothLights(frameDt);

      // шёпот волнами на высокой панике: затухает и возвращается, а не ровный фон
      if (worldPanic >= 60) {
        const wave = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * 1.1));
        const base = 0.05 + 0.35 * Math.min(1, worldPanic / 100);
        soundscape.setChannelScale('whisper', (base / 0.22) * wave, 0.4);
      }

      // дверь кабины отходит в сторону, когда её открыли
      if (cabOpen && cabDoorHinge && cabDoorHinge.rotation.y > -1.9) {
        cabDoorHinge.rotation.y = Math.max(-1.9, cabDoorHinge.rotation.y - frameDt * 2.2);
      }

      remotePlayers.update([...replica.step(frameDt, now), ...npcEntities], frameDt);
      passengers?.update(frameDt);

      if (subtitleTimer > 0) {
        subtitleTimer -= frameDt;
        if (subtitleTimer <= 0) elSubtitles.classList.add('hidden');
      }

      updateTyping(frameDt);

      hud.tick(frameDt);
      hudAccumulator += frameDt;
      if (hudAccumulator >= 0.25) {
        hudAccumulator = 0;
        hud.setPulse(pulse.bpm, pulse.level);
        hud.setPlace(placeName());
        elPos.textContent = `x ${player.position.x.toFixed(2)} · z ${player.position.z.toFixed(2)}`;
      }

      elHint.classList.toggle('hidden', input.pointerLocked);

      // «спираль паники»: на высоких фазах камеру потряхивает
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
      }

      // телефон показывает не видео, а пиксельный кадр из него
      if (PHONE_PS1) drawPhoneFrame();

      post.render(renderer, scene, camera, elapsed);
      void alpha;
    },
  );

  const fpsTimer = setInterval(() => {
    elFps.textContent = String(Math.round(loop.fps()));
    const stats = chunks.stats();
    elChunks.textContent = `${stats.loadedChunks} из ${stats.totalChunks}`;
    elMem.textContent = `${stats.loadedMb} из ${stats.totalMb} МБ · ${stats.loadedPercent}%`;
  }, 500);

  // раз в секунду: свои fps и ping — сервер собирает их в таблицу панели.
  // Ping уже измеряется через PING/PONG, отдельного замера не заводим.
  const statsTimer = setInterval(() => {
    net.sendClientStats(loop.fps(), lastPingMs);
    if (admin.open) net.requestAdmin();
  }, 1000);

  window.__game = {
    player,
    camera,
    scene,
    renderer,
    fps: () => loop.fps(),
    cutscene,
    playCutscene,
    // отладка: голоса персонажей — по ним проверяется, что блипы вообще идут
    voices,
    // отладка: сколько агентов пришло с сервера
    npcCount: () => npcEntities.length,
    /** Довернуть всех персонажей на градусы: подгонка направления без сборки. */
    turn: (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      if (passengers) {
        passengers.turnOffset += rad;
        passengers.applyTurn();
      }
      remotePlayers.turnOffset += rad;
      return +(((passengers?.turnOffset ?? remotePlayers.turnOffset) * 180) / Math.PI).toFixed(1);
    },
    /** Сдвинуть сидящих: вперёд к проходу и вверх, метры. */
    seat: (forward: number, up: number) => {
      if (!passengers) return null;
      passengers.seatForward = forward;
      passengers.seatUp = up;
      passengers.applySeatOffsets();
      return { forward, up };
    },
    // отладка: посчитать ближайший предмет и персонажа без ожидания кадров
    probe: () => {
      const forwardX = -Math.sin(player.facing);
      const forwardZ = -Math.cos(player.facing);
      const props = worldProps.map((prop) => {
        const dx = prop.pos[0] - player.position.x;
        const dz = prop.pos[2] - player.position.z;
        const distance = Math.hypot(dx, dz);
        const dot = (dx * forwardX + dz * forwardZ) / Math.max(0.001, distance);
        return { id: prop.id, distance: +distance.toFixed(2), dot: +dot.toFixed(2), inRadius: distance <= prop.radius };
      });
      return {
        position: player.position.toArray().map((n) => +n.toFixed(2)),
        facing: +player.facing.toFixed(2),
        propsLoaded: worldProps.length,
        props,
        nearProp: nearProp?.id ?? null,
        nearPropVerb: nearPropVerb?.id ?? null,
      };
    },
  };

  addEventListener('beforeunload', () => {
    loop.stop();
    clearInterval(fpsTimer);
    clearInterval(statsTimer);
    input.dispose();
    net.close();
    remotePlayers.dispose();
    post.dispose();
    renderer.dispose();
  });
}

void main();
