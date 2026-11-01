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
import { Characters, type CharacterId, type SceneryItem } from './world/characters';
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

  function setLights(value: number): void {
    lightsTarget = Math.max(0, Math.min(1, value));
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

    chunks.group.traverse((node) => {
      if (node.name === 'lamp') {
        const mesh = node as THREE.Mesh;
        const material = mesh.material as THREE.MeshStandardMaterial;
        // до блэкаута плафоны тёплые, от лампы из бутылки — холодные
        if (lampMode) material.emissive.setRGB(0.62, 0.78, 1).multiplyScalar(lightsValue * 0.9);
        else material.emissive.setRGB(1, 0.97, 0.88).multiplyScalar(lightsValue * 0.9);
        return;
      }

      // после крафта света экраны у людей гаснут
      if (node.name === 'phones' && phonesDimmed) {
        const mesh = node as THREE.Mesh;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.setHex(0x2b3550);
      }
    });
    if (lampMode) {
      // свет от бутылки с телефоном: холодный, приглушённый
      ambient.intensity = 0.16 + lightsValue * 0.45;
      scene.environmentIntensity = 0.25 + lightsValue * 0.3;
      for (const light of fillLights) {
        light.color.setHex(0x9dc2ff);
        light.intensity = lightsValue * 3.3;
      }
    } else {
      // городское питание: тёплое и ярче
      ambient.intensity = 0.16 + lightsValue * 0.55;
      scene.environmentIntensity = 0.25 + lightsValue * 0.35;
      for (const light of fillLights) {
        light.color.setHex(0xffe4b8);
        light.intensity = lightsValue * 5.4;
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
  const elPhone = document.getElementById('phone') as HTMLElement;
  const elPhoneNet = document.getElementById('phone-net') as HTMLElement;
  const elPhoneVideo = document.getElementById('phone-video') as HTMLVideoElement;

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
            elPhoneNet.classList.remove('hidden');
            return;
          case 'lower':
            // экран уходит вниз: сначала телефон, потом подъём
            elPhone.classList.add('lowered');
            return;
          case 'hide':
            elPhoneVideo.pause();
            elPhone.classList.add('hidden');
            elPhone.classList.remove('lowered');
            elPhoneNet.classList.add('hidden');
            return;
        }
      },
      onEnd: (yaw, pitch) => {
        elCutscene.classList.add('hidden');
        elCutsceneSub.classList.add('hidden');

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
        case 'say':
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
          model: npc.model,
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
    onAuthFailed: () => {
      // токен протух или отозван: чистим и просим войти заново
      forgetSession();
      location.reload();
    },
  });

  net.connect();
  setInterval(() => net.ping(), 1000);

  // кнопка лобби: пока её не нажали, сценарий не идёт ни у кого
  elLobbyStart.addEventListener('click', () => net.start());

  /* ───────────────────────────── кадр ───────────────────────────── */

  /** Рюкзак: пока открыт, мышь принадлежит панели, а не камере. */
  let bagOpen = false;

  function setBag(open: boolean): void {
    bagOpen = open;
    hud.setBagOpen(open);
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

  addEventListener('keydown', (event) => {
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

    if (event.code === 'Escape' && bagOpen) {
      setBag(false);
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
      // в мир идём с тем предметом, что выбран в нижней полоске
      if (nearProp && nearPropVerb) net.interact(nearProp.id, nearPropVerb.id, inventory.selectedItem);
      return;
    }

    // пока игрок печатает или роется в рюкзаке, игровые клавиши не работают
    if (chatOpen || bagOpen) return;

    if (event.code === 'F3') {
      elStatus.classList.toggle('hidden');
      return;
    }

    if (/^Digit[1-6]$/.test(event.code)) {
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
    if (!text || !talkingTo) return;

    const npcId = npcIds[talkingTo.id - 1000];
    if (npcId) net.say(npcId, text);

    subtitleText = '';
    elSubtitles.textContent = `${talkingTo.name}: …`;
    elSubtitles.classList.remove('hidden');
    elChatInput.value = '';
  });

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
      } else if (gameStarted && !chatOpen && !bagOpen) {
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
      smoothLights(frameDt);

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
        elPos.textContent = `x ${player.position.x.toFixed(2)} · z ${player.position.z.toFixed(2)}`;
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
    input.dispose();
    net.close();
    remotePlayers.dispose();
    post.dispose();
    renderer.dispose();
  });
}

void main();
