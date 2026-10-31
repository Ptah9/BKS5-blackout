import * as THREE from 'three';

import './style.css';
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
import { ensureSession, forgetSession } from './ui/login';
import { ChunkManager } from './world/chunks';
import { Passengers, type PassengerSpot } from './world/passengers';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, CAR_HEIGHT } from './world/car';

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
  const elPanic = document.getElementById('v-panic') as HTMLElement;
  const elTrust = document.getElementById('v-trust') as HTMLElement;
  const elAir = document.getElementById('v-air') as HTMLElement;
  const elStress = document.getElementById('stress') as HTMLElement;
  const elStatus = document.getElementById('status') as HTMLElement;
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

  /* ───────────────────────────── мир ───────────────────────────── */

  const textures = createTextures();
  const chunks = new ChunkManager(textures);
  scene.add(chunks.group);

  // Пассажиры: пока силуэты, потом сюда встанут модели. Расстановка в данных.
  void fetch('/api/content/passengers.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { spots?: PassengerSpot[] } | null) => {
      const spots = data?.spots ?? [];
      if (spots.length === 0) return;
      scene.add(new Passengers(spots).group);
    })
    .catch(() => {
      // без пассажиров играется, просто вагон пустой
    });

  const remotePlayers = new RemotePlayers();
  scene.add(remotePlayers.group);

  const ambient = new THREE.AmbientLight(0x263247, 0.16);
  scene.add(ambient);

  const flashlight = new THREE.SpotLight(0xfff4dc, 130, 15, Math.PI / 9, 0.5, 1.5);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(512, 512);
  flashlight.shadow.camera.near = 0.2;
  flashlight.shadow.camera.far = 13;
  flashlight.shadow.bias = -0.004;
  flashlight.position.set(0.06, -0.1, 0);

  const flashlightTarget = new THREE.Object3D();
  flashlightTarget.position.set(0, -0.15, -1);
  flashlight.target = flashlightTarget;
  camera.add(flashlight, flashlightTarget);
  scene.add(camera);

  const emergency = new THREE.PointLight(0xff2a18, 2.2, 7, 2);
  emergency.position.set(0, CAR_HEIGHT - 0.2, 0);
  scene.add(emergency);

  const phoneLights = [0, 1, 2, 3].map(() => {
    const light = new THREE.PointLight(0x86a8ff, 2.4, 3.8, 2);
    scene.add(light);
    return light;
  });

  // Свет в вагоне: 1 — горят лампы, 0 — полный блэкаут.
  // Значение приходит из сценария, поэтому его держим отдельно от рендера.
  let lightsValue = 1;
  let lastAppliedLights = -1;
  let lastChunkVersion = -1;
  /** Сила тряски камеры от паники: 0 — спокойно, 1 — психоз. */
  let shake = 0;

  function setLights(value: number): void {
    lightsValue = Math.max(0, Math.min(1, value));
  }

  function updateLights(): void {
    // пересчитываем только когда изменился свет или загрузился новый чанк
    if (lightsValue === lastAppliedLights && chunks.version === lastChunkVersion) return;
    lastAppliedLights = lightsValue;
    lastChunkVersion = chunks.version;

    chunks.group.traverse((node) => {
      if (node.name !== 'lamp') return;
      const mesh = node as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissive.setRGB(1, 0.97, 0.88).multiplyScalar(lightsValue * 0.9);
    });
    ambient.intensity = 0.16 + lightsValue * 0.55;
    scene.environmentIntensity = 0.25 + lightsValue * 0.35;
  }

  function setObjective(text: string): void {
    if (!text) {
      elObjective.classList.add('hidden');
      return;
    }
    elObjective.textContent = text;
    elObjective.classList.remove('hidden');
  }

  /** Паника, доверие и воздух приходят с сервера: это состояние мира. */
  function setStats(panic: number, trust: number, air: number): void {
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

  const cutscene = new CutscenePlayer(camera, {
    onSubtitle: (text) => {
      elCutsceneSub.textContent = text;
      elCutsceneSub.classList.toggle('hidden', !text);
    },
    onLights: (value) => setLights(value),
    onEnd: () => {
      elCutscene.classList.add('hidden');
      elCutsceneSub.classList.add('hidden');
    },
  });

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
      hud.say('');
    } catch (error) {
      console.info('[катсцена] не загрузилась:', id, error);
    }
  }

  const bounds = {
    minX: -CAR_HALF_WIDTH,
    maxX: CAR_HALF_WIDTH,
    minZ: -CAR_HALF_LENGTH,
    maxZ: CAR_HALF_LENGTH,
  };

  const player = new Player(camera);
  const input = new Input(canvas);
  const replica = new Replica();

  const inventory = new Inventory();
  const hud = new Hud(inventory);
  const pulse = new Pulse();

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

  // предметы мира (двери, кнопки, люки) приезжают из content/props.json
  void fetch('/api/content/props.json')
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { props?: PropView[] } | null) => {
      worldProps = data?.props ?? [];
    })
    .catch(() => {
      // без предметов играть можно, просто нечего нажимать
    });

  let nearNpc: RemotePlayer | null = null;
  let talkingTo: RemotePlayer | null = null;
  let chatOpen = false;
  let subtitleText = '';
  let subtitleTimer = 0;

  function openChat(npc: RemotePlayer): void {
    talkingTo = npc;
    chatOpen = true;
    elChatName.textContent = npc.name;
    elChat.classList.remove('hidden');
    elChatInput.value = '';
    document.exitPointerLock();
    elChatInput.focus();
  }

  function closeChat(): void {
    chatOpen = false;
    talkingTo = null;
    elChat.classList.add('hidden');
    elChatInput.blur();
  }

  hud.say('Темно. В кармане бутылка воды и телефон — экран светит синим.');

  function applyFlashlight(hasLight: boolean): void {
    flashlight.intensity = hasLight ? 210 : 130;
    flashlight.angle = hasLight ? Math.PI / 7.5 : Math.PI / 9;
  }

  function placeName(): string {
    const z = player.position.z;
    if (z > 4) return 'вагон · к тамбуру';
    if (z < -4) return 'вагон · к кабине';
    return 'вагон · середина';
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
      applyFlashlight(inventory.has('flashlight'));
    },
    onInventory: (slots, text) => {
      inventory.apply(slots);
      hud.renderSlots();
      if (text) hud.say(text);
      applyFlashlight(inventory.has('flashlight'));
    },
    onEvent: (kind, data) => {
      switch (kind) {
        case 'thought':
          hud.say(String(data.text ?? ''), 6);
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
    onNpcs: (list) => {
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
          targetX: npc.pos[0],
          targetZ: npc.pos[2],
          targetYaw: npc.yaw,
          lastSeen: Number.MAX_SAFE_INTEGER,
        });
      });
    },
    onNpcReply: (_id, delta, done) => {
      if (delta) {
        subtitleText += delta;
        elSubtitles.textContent = `${talkingTo?.name ?? '—'}: ${subtitleText}`;
        elSubtitles.classList.remove('hidden');
      }
      if (done) subtitleTimer = 9;
    },
    onPong: (ms) => {
      elPing.textContent = `${Math.round(ms)} мс`;
    },
    onAuthFailed: () => {
      // токен протух или отозван: чистим и просим войти заново
      forgetSession();
      location.reload();
    },
  });

  net.connect();
  setInterval(() => net.ping(), 1000);

  /* ───────────────────────────── кадр ───────────────────────────── */

  addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && cutscene.playing) {
      cutscene.skip();
      return;
    }

    if (event.code === 'Escape' && chatOpen) {
      closeChat();
      return;
    }

    if (event.code === 'KeyT' && !chatOpen) {
      if (nearNpc) openChat(nearNpc);
      return;
    }

    if (event.code === 'KeyE' && !chatOpen && !cutscene.playing) {
      if (nearProp && nearPropVerb) net.interact(nearProp.id, nearPropVerb.id);
      return;
    }

    // пока игрок печатает, игровые клавиши не работают
    if (chatOpen) return;

    if (event.code === 'F3') {
      elStatus.classList.toggle('hidden');
      return;
    }

    if (/^Digit[1-6]$/.test(event.code)) {
      inventory.toggle(Number(event.code.slice(5)) - 1);
      hud.renderSlots();
      return;
    }

    if (event.code === 'KeyC') {
      const pair = inventory.pair;
      if (!pair) {
        hud.say('Выбери два предмета: цифры 1–6');
        return;
      }
      // решает сервер: он сверяет рецепт и присылает новое состояние слотов
      net.combine(pair[0], pair[1]);
    }
  });

  elChatInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const text = elChatInput.value.trim();
    if (!text || !talkingTo) return;

    const npcId = npcIds[talkingTo.id - 1000];
    if (npcId) net.say(npcId, text);

    subtitleText = '';
    elSubtitles.textContent = `${talkingTo.name}: …`;
    elSubtitles.classList.remove('hidden');
    elChatInput.value = '';
  });

  function updatePhoneLights(): void {
    const phones = chunks.phones;
    const sorted = [...phones].sort(
      (a, b) => a.distanceToSquared(player.position) - b.distanceToSquared(player.position),
    );
    phoneLights.forEach((light, i) => {
      const p = sorted[i];
      if (!p) return;
      light.position.set(p.x, p.y + 0.03, p.z);
    });
  }

  let inputAccumulator = 0;
  let hudAccumulator = 0;
  let lastFrame = performance.now();
  let lastZone = '';

  const loop = startLoop(
    (dt) => {
      if (cutscene.playing) {
        // камера идёт по точкам, а движения мыши за это время не копим,
        // иначе после сцены камеру дёрнет
        cutscene.update(dt);
        input.consumeLook();
      } else if (!chatOpen) {
        player.update(dt, input, chunks.colliders, bounds);
      }
      chunks.update(player.position.z);

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
        closestVerb = closestProp.verbs.find((verb) => verb.id !== 'look') ?? closestProp.verbs[0];
      }

      nearProp = closestProp;
      nearPropVerb = closestVerb;

      elInteract.classList.toggle('hidden', !nearProp || chatOpen);
      if (nearProp && nearPropVerb) {
        elInteract.textContent = `E — ${nearPropVerb.label}: ${nearProp.name}`;
      }

      // сообщаем серверу, когда игрок переходит в другую часть мира
      const zone = player.position.z < 0 ? 'car_a' : 'car_b';
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
      updatePhoneLights();
      updateLights();

      remotePlayers.update([...replica.step(frameDt, now), ...npcEntities]);

      if (subtitleTimer > 0) {
        subtitleTimer -= frameDt;
        if (subtitleTimer <= 0) elSubtitles.classList.add('hidden');
      }

      hud.tick(frameDt);
      hudAccumulator += frameDt;
      if (hudAccumulator >= 0.25) {
        hudAccumulator = 0;
        hud.setPulse(pulse.bpm, pulse.level);
        hud.setPlace(placeName());
      }

      elHint.classList.toggle('hidden', input.pointerLocked);

      // «спираль паники»: на высоких фазах камеру потряхивает
      if (shake > 0) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
      }

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

  window.__game = {
    player,
    camera,
    scene,
    renderer,
    fps: () => loop.fps(),
    cutscene,
    playCutscene,
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
    input.dispose();
    net.close();
    remotePlayers.dispose();
    post.dispose();
    renderer.dispose();
  });
}

void main();
