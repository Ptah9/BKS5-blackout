import * as THREE from 'three';

import './style.css';
import { Input } from './core/input';
import { startLoop } from './core/loop';
import { RemotePlayers } from './game/remotePlayers';
import { Player } from './game/player';
import { Replica } from './net/replica';
import { Net } from './net/socket';
import { PostFX } from './render/post';
import { createEnvironment, createTextures } from './render/textures';
import { ensureSession, forgetSession } from './ui/login';
import { buildCar, CAR_HALF_LENGTH, CAR_HALF_WIDTH, CAR_HEIGHT } from './world/car';
import { buildTunnel } from './world/tunnel';

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
  const elName = document.getElementById('s-name') as HTMLElement;
  const elStatus = document.getElementById('status') as HTMLElement;
  const elHint = document.getElementById('hint') as HTMLElement;

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
  const car = buildCar(textures);
  scene.add(car.group);
  scene.add(buildTunnel());

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

  const bounds = {
    minX: -CAR_HALF_WIDTH,
    maxX: CAR_HALF_WIDTH,
    minZ: -CAR_HALF_LENGTH,
    maxZ: CAR_HALF_LENGTH,
  };

  const player = new Player(camera);
  const input = new Input(canvas);
  const replica = new Replica();

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
    onSnapshot: (self, players) => {
      player.teleport(self.x, self.z, self.yaw);
      replica.apply(players, self.id, performance.now());
    },
    onPlayers: (list) => {
      replica.apply(list, session.playerId, performance.now());
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

  addEventListener('keydown', (e) => {
    if (e.code === 'F3') elStatus.classList.toggle('hidden');
  });

  const phones = car.phones;

  function updatePhoneLights(): void {
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
  let lastFrame = performance.now();

  const loop = startLoop(
    (dt) => {
      player.update(dt, input, car.colliders, bounds);

      inputAccumulator += dt;
      if (inputAccumulator >= INPUT_INTERVAL) {
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

      remotePlayers.update(replica.step(frameDt, now));

      elHint.classList.toggle('hidden', input.pointerLocked);
      post.render(renderer, scene, camera, elapsed);
      void alpha;
    },
  );

  const fpsTimer = setInterval(() => {
    elFps.textContent = String(Math.round(loop.fps()));
  }, 500);

  window.__game = { player, camera, scene, renderer, fps: () => loop.fps() };

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
