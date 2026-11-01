/**
 * Предпросмотр окружения: кабина, тоннель и платформа в тех же координатах,
 * в которых они будут жить в игре, со свободной камерой.
 *
 * Зачем отдельная страница: main.ts ведёт другой агент. Здесь свой рендерер,
 * свой свет и своя камера, поэтому геометрию можно крутить, ничего не ломая.
 *
 * Управление: клик — захват мыши, WASD — полёт, Space/Ctrl — вверх/вниз,
 * Shift — быстрее. 1–6 — точки обзора, L — свет, P — пост-обработка,
 * C — коллайдеры и границы, H — панель.
 *
 * `?people=1` — горстка персонажей в тоннеле; камера играет роль игрока,
 * по ней и проверяются повороты головы (см. блок «люди» ниже).
 *
 * Любую точку можно задать ссылкой, это нужно для скриншотов:
 *   /env-preview.html?cam=0,1.6,-11&yaw=0&pitch=-0.1&lights=0&post=0
 */

import * as THREE from 'three';

import { PostFX } from './render/post';
import { createEnvironment, createTextures } from './render/textures';
import type { Box2 } from './world/collision';
import type { LightSpot, Location } from './world/location';
import { buildCab } from './world/cab';
import { buildPlatform } from './world/platform';
import { buildTunnel } from './world/tunnel';
import { Characters } from './world/characters';
import { Passengers, type PassengerSpot } from './world/passengers';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const centerText = document.getElementById('center-text') as HTMLElement;

const LONG_SIDE = 640;

/* ───────────────────────────── рендерер ───────────────────────────── */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  // иначе canvas.toBlob() вне кадра отдаёт пустоту, и скриншот для проверки
  // геометрии не снять; для страницы предпросмотра цена незаметна
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.055);
scene.environment = createEnvironment(renderer);
scene.environmentIntensity = 0.28;

const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 120);

/* ───────────────────────────── локации ───────────────────────────── */

const textures = createTextures();
const locations: Array<{ name: string; location: Location }> = [
  { name: 'кабина', location: buildCab(textures) },
  { name: 'тоннель', location: buildTunnel(textures) },
  { name: 'платформа', location: buildPlatform(textures) },
];

const lampMaterials: THREE.MeshStandardMaterial[] = [];

for (const { location } of locations) {
  scene.add(location.group);
  location.group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node.name !== 'lamp') return;
    const material = node.material as THREE.MeshStandardMaterial;
    if (!lampMaterials.includes(material)) lampMaterials.push(material);
  });
}

/* ───────────────────────────── свет ───────────────────────────── */

const ambient = new THREE.AmbientLight(0x93a7bb, 0.32);
scene.add(ambient);

// подсветка сверху для осмотра геометрии: в игре такой не будет,
// но без неё тёмные углы не разглядеть, а задача страницы — разглядывать
const hemi = new THREE.HemisphereLight(0xb6c6d8, 0x2a2f36, 0.28);
scene.add(hemi);

/** Плоский свет для разбора геометрии: `?flat=1` — всё видно, настроения нет. */
const flat = params.get('flat') === '1';
if (flat) {
  ambient.color.setHex(0xffffff);
  ambient.intensity = 2.2;
  hemi.intensity = 1.1;
  scene.fog = null;
}

/** Лампы по подсказкам самих локаций: тот же формат, что отдаёт модуль. */
const pointLights: THREE.PointLight[] = [];

for (const { location } of locations) {
  const spots = (location.group.userData.lightSpots as LightSpot[] | undefined) ?? [];
  for (const spot of spots) {
    const light = new THREE.PointLight(spot.color, spot.intensity, spot.distance, 2);
    light.position.set(spot.x, spot.y, spot.z);
    scene.add(light);
    pointLights.push(light);
  }
}

/* ───────────────────────────── отладка коллайдеров ───────────────────────────── */

const debugGroup = new THREE.Group();
debugGroup.name = 'debug';
debugGroup.visible = false;
scene.add(debugGroup);

function buildDebug(): void {
  for (const { location } of locations) {
    const points: number[] = [];
    const box = (b: Box2): void => {
      const y0 = 0.02;
      const y1 = 0.22;
      const corners: Array<[number, number]> = [
        [b.minX, b.minZ],
        [b.maxX, b.minZ],
        [b.maxX, b.maxZ],
        [b.minX, b.maxZ],
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const c = corners[(i + 1) % 4];
        points.push(a[0], y0, a[1], c[0], y0, c[1]);
        points.push(a[0], y1, a[1], c[0], y1, c[1]);
        points.push(a[0], y0, a[1], a[0], y1, a[1]);
      }
    };

    for (const collider of location.colliders) box(collider);

    // границы локации — отдельным цветом, чуть выше коллайдеров
    const bounds = location.bounds;
    const y = 0.4;
    const rect: Array<[number, number]> = [
      [bounds.minX, bounds.minZ],
      [bounds.maxX, bounds.minZ],
      [bounds.maxX, bounds.maxZ],
      [bounds.minX, bounds.maxZ],
    ];
    for (let i = 0; i < 4; i++) {
      const a = rect[i];
      const c = rect[(i + 1) % 4];
      points.push(a[0], y, a[1], c[0], y, c[1]);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x53b8a8 });
    debugGroup.add(new THREE.LineSegments(geometry, material));
  }
}

buildDebug();
if (params.get('debug') === '1') debugGroup.visible = true;

/* ───────────────────────────── люди ───────────────────────────── */

/**
 * `?people=1` — горстка персонажей в тоннеле рядом с кабиной. Камера
 * предпросмотра при этом играет роль игрока: персонажи видят её так же,
 * как в игре видят камеру из main.ts. Нужно, чтобы смотреть повороты
 * головы глазами, не запуская игру.
 */
const peopleMode = params.get('people') === '1';
let crowd: Passengers | null = null;

const CROWD_SPOTS: PassengerSpot[] = [
  { x: -1.5, z: -14.4, yaw: 0.12, pose: 'stand' },
  { x: -0.45, z: -15.3, yaw: -0.06, pose: 'stand' },
  { x: 0.7, z: -14.9, yaw: 0.3, pose: 'stand' },
  { x: 1.7, z: -16.1, yaw: -0.22, pose: 'stand' },
  { x: -1.2, z: -17.4, yaw: 0.08, pose: 'stand' },
  { x: 0.15, z: -18.2, yaw: 0.0, pose: 'stand' },
  { x: -0.9, z: -19.4, yaw: -0.35, pose: 'stand' },
];

if (peopleMode) {
  scene.add(camera);
  const characters = new Characters();
  void characters.load().then(() => {
    crowd = new Passengers(CROWD_SPOTS, characters);
    scene.add(crowd.group);
    (window as unknown as { crowdReady?: boolean }).crowdReady = true;
  });
}

/* ───────────────────────────── картинка ───────────────────────────── */

function targetSize(): { width: number; height: number } {
  const w = Math.max(320, innerWidth);
  const h = Math.max(180, innerHeight);
  const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
  return { width: Math.max(320, Math.round(w * scale)), height: Math.max(180, Math.round(h * scale)) };
}

const post = new PostFX(targetSize().width, targetSize().height);
let postEnabled = params.get('post') !== '0';

function resize(): void {
  const { width, height } = targetSize();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  post.setSize(width, height);
}

addEventListener('resize', resize);
resize();

/* ───────────────────────────── камера ───────────────────────────── */

interface View {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  label: string;
}

const VIEWS: Record<string, View> = {
  cab: { pos: [0.6, 1.6, -10.5], yaw: 0, pitch: -0.12, label: 'кабина · от двери вагона' },
  console: { pos: [0.45, 1.55, -11.35], yaw: 0.05, pitch: -0.3, label: 'кабина · пульт' },
  side: { pos: [-0.35, 1.6, -11.6], yaw: -1.5, pitch: 0.02, label: 'кабина · в боковую дверь' },
  tunnel: { pos: [0.2, 1.6, -13.2], yaw: 0, pitch: 0, label: 'тоннель · от кабины' },
  signal: { pos: [0.9, 1.6, -29.0], yaw: 0.55, pitch: 0.02, label: 'тоннель · светофор с трубкой' },
  niche: { pos: [0.9, 1.6, -23.0], yaw: 1.05, pitch: 0.05, label: 'тоннель · замурованный проход' },
  arch: { pos: [-0.6, 1.6, -31.0], yaw: 1.4, pitch: 0, label: 'тоннель · проём на платформу' },
  platform: { pos: [-3.3, 1.6, -31.0], yaw: 1.45, pitch: -0.02, label: 'платформа · зал' },
  exit: { pos: [-5.6, 1.6, -32.6], yaw: 0, pitch: 0, label: 'платформа · выход' },
  crowd: { pos: [0, 1.6, -13.0], yaw: 0, pitch: -0.02, label: 'тоннель · люди (нужен ?people=1)' },
  overview: { pos: [7, 11, -8], yaw: 0.9, pitch: -0.62, label: 'обзор' },
};

let yaw = 0;
let pitch = 0;
const position = new THREE.Vector3();

function applyView(view: View): void {
  position.set(...view.pos);
  yaw = view.yaw;
  pitch = view.pitch;
  syncCamera();
}

function syncCamera(): void {
  camera.position.copy(position);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function parseCam(): boolean {
  const raw = params.get('cam');
  if (!raw) return false;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return false;
  position.set(parts[0], parts[1], parts[2]);
  yaw = Number(params.get('yaw') ?? 0) || 0;
  pitch = Number(params.get('pitch') ?? 0) || 0;
  syncCamera();
  return true;
}

const initialView = params.get('view');
if (initialView && VIEWS[initialView]) applyView(VIEWS[initialView]);
else if (!parseCam()) applyView(VIEWS.cab);

/* ───────────────────────────── управление ───────────────────────────── */

const keys = new Set<string>();
let dragging = false;

addEventListener('keydown', (event) => {
  keys.add(event.code);

  switch (event.code) {
    case 'Digit1':
      applyView(VIEWS.cab);
      break;
    case 'Digit2':
      applyView(VIEWS.tunnel);
      break;
    case 'Digit3':
      applyView(VIEWS.arch);
      break;
    case 'Digit4':
      applyView(VIEWS.platform);
      break;
    case 'Digit5':
      applyView(VIEWS.overview);
      break;
    case 'Digit6':
      applyView(VIEWS.crowd);
      break;
    case 'KeyL':
      lightsOn = !lightsOn;
      applyLights();
      break;
    case 'KeyP':
      postEnabled = !postEnabled;
      break;
    case 'KeyC':
      debugGroup.visible = !debugGroup.visible;
      break;
    case 'KeyH': {
      const hidden = hud.style.display === 'none';
      hud.style.display = hidden ? 'block' : 'none';
      break;
    }
    case 'KeyR':
      applyView(VIEWS.cab);
      break;
    default:
      break;
  }
});

addEventListener('keyup', (event) => keys.delete(event.code));
addEventListener('blur', () => keys.clear());

canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});

addEventListener('mousedown', () => {
  dragging = true;
});
addEventListener('mouseup', () => {
  dragging = false;
});

addEventListener('mousemove', (event) => {
  // в предпросмотре мышь работает и с захватом, и просто с зажатой кнопкой:
  // так удобнее, когда страницу открыли в панели предпросмотра
  const locked = document.pointerLockElement === canvas;
  if (!locked && !dragging) return;
  yaw -= event.movementX * 0.0022;
  pitch -= event.movementY * 0.0022;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});

/* ───────────────────────────── свет ───────────────────────────── */

let lightsOn = params.get('lights') !== '0';

function applyLights(): void {
  for (const material of lampMaterials) {
    if (lightsOn) material.emissive.setRGB(1, 0.97, 0.88).multiplyScalar(0.85);
    else material.emissive.setRGB(0, 0, 0);
  }

  for (const light of pointLights) light.visible = lightsOn;
  if (flat) return;
  ambient.intensity = lightsOn ? 0.32 : 0.08;
  hemi.intensity = lightsOn ? 0.28 : 0.06;
  scene.environmentIntensity = lightsOn ? 0.4 : 0.06;
}

applyLights();

/* ───────────────────────────── кадр ───────────────────────────── */

const clock = new THREE.Clock();
let hudTimer = 0;
let frames = 0;
let fps = 0;

function currentPlace(): string {
  if (position.x < -2.4) return 'платформа';
  if (position.z < -12.5) return 'тоннель';
  return 'кабина';
}

function updateHud(dt: number): void {
  frames++;
  hudTimer += dt;
  if (hudTimer < 0.25) return;

  fps = Math.round(frames / hudTimer);
  frames = 0;
  hudTimer = 0;

  hud.innerHTML =
    `окружение · предпросмотр\n` +
    `место: <b>${currentPlace()}</b>\n` +
    `x ${position.x.toFixed(2)}  y ${position.y.toFixed(2)}  z ${position.z.toFixed(2)}\n` +
    `yaw ${yaw.toFixed(2)}  pitch ${pitch.toFixed(2)}  ${fps} fps\n` +
    `\n` +
    `<b>1</b> кабина  <b>2</b> тоннель  <b>3</b> проём  <b>4</b> платформа  <b>5</b> обзор  <b>6</b> люди (?people=1)\n` +
    `<b>L</b> свет ${lightsOn ? 'вкл' : 'выкл'}  <b>P</b> пост ${postEnabled ? 'вкл' : 'выкл'}  ` +
    `<b>C</b> коллайдеры ${debugGroup.visible ? 'вкл' : 'выкл'}\n` +
    `<b>WASD</b> полёт  <b>Space/Ctrl</b> вверх/вниз  <b>Shift</b> быстрее  <b>клик</b> мышь  <b>H</b> панель`;
}

function move(dt: number): void {
  let speed = 2.4;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) speed *= 4;
  if (keys.has('AltLeft') || keys.has('AltRight')) speed *= 0.25;

  const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
  const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
  const step = new THREE.Vector3();

  if (keys.has('KeyW')) step.add(forward);
  if (keys.has('KeyS')) step.sub(forward);
  if (keys.has('KeyD')) step.add(right);
  if (keys.has('KeyA')) step.sub(right);
  if (keys.has('Space')) step.y += 1;
  if (keys.has('ControlLeft') || keys.has('ControlRight')) step.y -= 1;

  if (step.lengthSq() > 0) {
    step.normalize().multiplyScalar(speed * dt);
    position.add(step);
  }

  syncCamera();
}

function draw(elapsed: number): void {
  if (postEnabled) post.render(renderer, scene, camera, elapsed);
  else renderer.render(scene, camera);
}

function tick(): void {
  const dt = Math.min(0.05, clock.getDelta());
  const elapsed = clock.elapsedTime;

  move(dt);
  updateHud(dt);
  crowd?.update(dt);

  draw(elapsed);
  requestAnimationFrame(tick);
}

tick();

/* ───────────────────────────── ручки для проверки ───────────────────────────── */

/** Поставить камеру в точку: так снимаются кадры «сбоку», «сзади» и т.п. */
function place(x: number, y: number, z: number, viewYaw: number, viewPitch: number): void {
  position.set(x, y, z);
  yaw = viewYaw;
  pitch = viewPitch;
  syncCamera();
}

/** Прокрутить персонажей вперёд без ожидания кадров: поза на заданной секунде. */
function stepSim(seconds: number): void {
  if (!crowd) return;
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) crowd.update(step);
  draw(clock.elapsedTime);
}

/** Повороты голов: числами, чтобы проверять пределы и плавность без глаз. */
function heads(): Array<{ x: number; z: number; yaw: number; pitch: number }> {
  const out: Array<{ x: number; z: number; yaw: number; pitch: number }> = [];
  if (!crowd) return out;
  const p = new THREE.Vector3();
  crowd.group.traverse((node) => {
    if (!(node instanceof THREE.Bone) || node.name !== 'head') return;
    node.getWorldPosition(p);
    out.push({
      x: +p.x.toFixed(2),
      z: +p.z.toFixed(2),
      yaw: +node.rotation.y.toFixed(3),
      pitch: +node.rotation.x.toFixed(3),
    });
  });
  return out;
}

/** Ручки для отладки: менять свет и камеру, не пересобирая страницу. */
(window as unknown as { env?: unknown }).env = {
  scene,
  camera,
  renderer,
  pointLights,
  ambient,
  hemi,
  locations,
  applyView,
  VIEWS,
  place,
  people: () => crowd,
  step: stepSim,
  heads,
};

/**
 * Снять текущий кадр файлом. Нужно для проверки геометрии без живого экрана:
 * страница закрыта в фоне — кадр всё равно уже в буфере.
 */
(window as unknown as { envShot?: (name: string) => void }).envShot = (name: string) => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, 'image/png');
};

// признак готовности первой картинки: по нему ждут скриншоты
requestAnimationFrame(() => {
  (window as unknown as { envReady?: boolean }).envReady = true;
  centerText.classList.add('show');
  centerText.textContent = 'клик — захват мыши · 1–5 — точки обзора';
  setTimeout(() => centerText.classList.remove('show'), 3200);
});
