import * as THREE from 'three';

import './style.css';
import { Net } from './net/socket';

/**
 * M0: доказать, что всё стоит на ногах — WebGL рисует, сокет отвечает.
 * Вагон, управление и свет приедут на M1, поэтому здесь нарочно пустая комната.
 */

const canvas = document.getElementById('view') as HTMLCanvasElement;
const elConn = document.getElementById('s-conn') as HTMLElement;
const elPing = document.getElementById('s-ping') as HTMLElement;
const elFps = document.getElementById('s-fps') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070a);
scene.fog = new THREE.FogExp2(0x05070a, 0.055);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 120);
camera.position.set(0, 1.6, 3.2);
camera.lookAt(0, 1.4, 0);

// заглушка вместо вагона
const room = new THREE.Mesh(
  new THREE.BoxGeometry(8, 3, 12),
  new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.9, metalness: 0.1, side: THREE.BackSide }),
);
room.position.y = 1.5;
scene.add(room);

const prop = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.6, 0.6),
  new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.6, metalness: 0.4 }),
);
prop.position.set(0, 1.2, 0);
scene.add(prop);

const lamp = new THREE.PointLight(0xffd9a0, 12, 18, 2);
lamp.position.set(0, 2.6, 0);
scene.add(lamp);
scene.add(new THREE.AmbientLight(0x30405a, 0.35));

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let frames = 0;
let fpsAt = performance.now();
let last = performance.now();

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  prop.rotation.x += dt * 0.4;
  prop.rotation.y += dt * 0.6;

  renderer.render(scene, camera);

  frames++;
  if (now - fpsAt >= 500) {
    elFps.textContent = String(Math.round((frames * 1000) / (now - fpsAt)));
    frames = 0;
    fpsAt = now;
  }
});

const net = new Net({
  onState: (state) => {
    elConn.textContent = state === 'open' ? 'есть' : state === 'connecting' ? 'подключаюсь…' : 'нет';
  },
  onWelcome: (you) => {
    elConn.textContent = `есть, игрок #${you}`;
  },
  onPong: (ms) => {
    elPing.textContent = `${Math.round(ms)} мс`;
  },
});

net.connect();
setInterval(() => net.ping(), 1000);
