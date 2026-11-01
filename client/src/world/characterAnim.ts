/**
 * Живая поза персонажа: у моделей есть скелет, но нет клипов анимации.
 *
 * Что делает:
 *  - смотрит на ближайшего человека: сначала игрок в радиусе 6 м, иначе сосед,
 *    никого — медленный случайный обзор (у части персонажей — взгляд в телефон);
 *  - шея не сворачивается: голова доворачивается не больше ~54° в сторону,
 *    остальное забирает корпус, а цель за спиной перестаёт быть целью;
 *  - всё сглажено экспонентой, а частота дыхания, фаза и характер
 *    у каждого свои — толпа не дышит в такт.
 *
 * Риг у всех восемнадцати моделей один: hips → spine → head, в покое без
 * поворотов. Поэтому rotation.y головы — поворот вокруг вертикали тела,
 * а rotation.x — кивок; ничего пересчитывать в костях не нужно.
 *
 * Кто есть «игрок» — берётся из сцены, без правок main.ts: камеры на сцене
 * и фигуры в группе `remotePlayers` (её ведёт RemotePlayers). Соседи — все
 * оживлённые этим классом фигуры, включая пассажиров вагона.
 */

import * as THREE from 'three';

/** Радиус, в котором персонаж замечает человека, и радиус «соседа», метры. */
const PLAYER_RANGE = 6;
const NEIGHBOR_RANGE = 5;

/** Пределы шеи: голова не должна сворачиваться. */
const MAX_YAW = 0.95;
const MAX_PITCH_UP = 0.34;
const MAX_PITCH_DOWN = 0.55;

/** Дальше этого угла от «носа» цель считается стоящей за спиной, рад.
 *  На игрока оглядываются широко (прохожий интересен), на соседа — только
 *  если он в зоне комфорта, иначе в вагоне все сидят с головой набок. */
const PLAYER_BEHIND = 1.6;
const NEIGHBOR_BEHIND = 0.95;

/** Какую долю поворота забирает корпус, чтобы шея не работала одна. */
const SPINE_SHARE = 0.2;

const SPINE_LIMIT = 0.16;

/** Высота глаз у фигуры без головной кости, метры. */
const PERSON_EYE = 1.5;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Угол в (−π, π]: после добавки π к сидящим моделям он выходит за предел. */
function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

/** Роль кости по имени: у моделей проекта это head и spine, но встречается
 *  и mixamo-раскладка, поэтому сравниваем по «голому» имени. */
function boneRole(rawName: string): 'head' | 'spine' | null {
  const name = rawName.toLowerCase().replace(/^(mixamorig|armature)[:_.]/, '');
  if (name === 'head' || name === 'head_01' || name === 'bip01 head') return 'head';
  if (name === 'spine' || name === 'spine1' || name === 'chest' || name === 'upperchest') return 'spine';
  return null;
}

/** Всё, что оживлено: пул для поиска соседей и целей. */
const world = {
  idles: new Set<CharacterIdle>(),
  /** Люди на сцене: камера игрока и фигуры из remotePlayers. */
  persons: [] as THREE.Object3D[],
  scene: null as THREE.Object3D | null,
  /** Время последней пересборки списка, мс: сканируем сцену 2–3 раза в секунду,
   *  а не на каждого персонажа отдельно. Минус бесконечность — первый кадр
   *  сканирует сразу, иначе персонажи полсекунды «слепые». */
  lastScan: Number.NEGATIVE_INFINITY,
};

function topObject(object: THREE.Object3D): THREE.Object3D {
  let node = object;
  while (node.parent) node = node.parent;
  return node;
}

/** Пересборка списка людей: камеры и всё, что лежит в группе remotePlayers. */
function scanWorld(): void {
  const scene = world.scene;
  world.persons.length = 0;
  if (!scene) return;

  const remote = scene.getObjectByName('remotePlayers');
  if (remote) world.persons.push(...remote.children);
  scene.traverse((node) => {
    if ((node as THREE.Camera).isCamera) world.persons.push(node);
  });

  // выпавшие из сцены персонажи (игрок вышел) не должны оставаться целями
  for (const idle of world.idles) {
    if (idle.detached(scene)) world.idles.delete(idle);
  }
}

/** Точка, куда смотрит человек: глаз у камеры, голова у фигуры. */
function eyeOf(object: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  for (const idle of world.idles) {
    if (idle.belongs(object)) return idle.eyeWorld(out);
  }
  if ((object as THREE.Camera).isCamera) return object.getWorldPosition(out);
  object.getWorldPosition(out);
  out.y += PERSON_EYE * Math.abs(object.scale.y || 1);
  return out;
}

export class CharacterIdle {
  private head: THREE.Bone | null = null;
  private spine: THREE.Bone | null = null;

  private readonly baseHeadX: number;
  private readonly baseHeadY: number;
  private readonly baseHeadZ: number;
  private readonly baseSpineX: number;
  private readonly baseSpineY: number;

  /** Фаза и темп — свои у каждого, иначе толпа двигается синхронно. */
  private readonly phase: number;
  private readonly breathRate: number;
  private readonly breathAmp: number;
  private readonly turnRate: number;
  private readonly fondOfPhone: boolean;
  private rndState: number;

  private time = 0;
  /** Текущий и желаемый поворот головы относительно позы покоя, рад. */
  private yaw = 0;
  private pitch = 0;
  private wantYaw = 0;
  private wantPitch = 0;

  private think = 0;
  private wanderIn = 0;
  private wanderYaw = 0;
  private wanderPitch = 0;
  private target: THREE.Object3D | null = null;
  private mode: 'person' | 'neighbor' | 'wander' = 'wander';

  /** Один раз видели себя в сцене: значит, пропажа из неё — это уход игрока. */
  private wasInScene = false;
  /** Голова выше полуметра над точкой опоры: лежачим шею не крутим. */
  private readonly upright: boolean;
  /** Сидячие модели: голова висит не на кости, поворот у них уже и мягче,
   *  а корпус не доворачивается. */
  private readonly headLocked: boolean = false;
  private readonly maxYaw: number = MAX_YAW;
  private readonly maxPitchUp: number = MAX_PITCH_UP;
  private readonly maxPitchDown: number = MAX_PITCH_DOWN;
  /** С какого угла цель считается «за спиной» для этой модели. */
  private readonly behind: number = PLAYER_BEHIND;
  /** Стык шеи и головы относительно кости. Вращать надо вокруг него, а не
   *  вокруг центра головы: у стоящих кость и так на шее (смещение 0), а у
   *  сидящих она на 0.39–0.48 м позади головы, и без поправки голова
   *  улетает в сторону при первом же повороте. */
  private readonly headShift: THREE.Vector3 | null = null;
  private readonly headBasePos = new THREE.Vector3();
  /** Куда смотрит лицо при нулевом повороте: у сидящих моделей это −Z. */
  private readonly facing: number = 0;

  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpEye = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(private readonly root: THREE.Object3D, seed = Math.random()) {
    root.traverse((node) => {
      if (!(node instanceof THREE.Bone)) return;
      const role = boneRole(node.name);
      if (role === 'head' && !this.head) this.head = node;
      if (role === 'spine' && !this.spine) this.spine = node;
    });

    this.baseHeadX = this.head?.rotation.x ?? 0;
    this.baseHeadY = this.head?.rotation.y ?? 0;
    this.baseHeadZ = this.head?.rotation.z ?? 0;
    this.baseSpineX = this.spine?.rotation.x ?? 0;
    this.baseSpineY = this.spine?.rotation.y ?? 0;

    // Лежачие модели (в npcs.json есть такой персонаж) — особый случай:
    // у них кости сложены у пола, и «поворот шеи» читается как вывернутая
    // голова. Им оставляем только дыхание.
    const headY = this.eyeWorld(this.tmpA).y;
    const rootY = this.root.getWorldPosition(this.tmpB).y;
    this.upright = headY - rootY > 0.6;

    // Где на самом деле голова относительно кости: по вершинам, привязанным
    // к head. У стоящих моделей смещение нулевое, у сидящих — почти полметра.
    const shift = this.measureHeadShift();
    if (shift) {
      // Точка вращения — стык шеи и головы: по высоте он там же, где кость,
      // а по глубине — там, где на самом деле висит голова.
      this.headShift = new THREE.Vector3(0, 0, shift.z);
      this.headBasePos.copy(this.head!.position);
      // Голова висит позади кости — у этих моделей неясно, куда смотрит лицо
      // (у npc_sit и npc_sidit геометрия даёт −Z лишь на грани шума, а разворот
      // на π ставил лицо против корпуса). Поэтому: никакого разворота и никакого
      // поворота головы, только дыхание. Так лицо хотя бы смотрит туда же,
      // куда и тело.
      if (shift.z < -0.2) {
        this.headLocked = true;
      }
    }

    const unit = ((seed % 1) + 1) % 1;
    this.phase = unit * Math.PI * 2;
    this.rndState = (unit * 4294967296) >>> 0 || 1;
    this.breathRate = 0.9 + this.rnd() * 0.55;
    this.breathAmp = 0.008 + this.rnd() * 0.008;
    this.turnRate = 0.85 + this.rnd() * 0.5;
    this.fondOfPhone = this.rnd() < 0.4;
    this.wanderIn = this.time + this.rnd() * 2;
    this.wantYaw = this.wanderYaw = (this.rnd() * 2 - 1) * 0.2;

    world.idles.add(this);
  }

  /** Детерминированный генератор: одинаковый «характер» при каждом запуске. */
  private rnd(): number {
    this.rndState = (Math.imul(this.rndState, 1664525) + 1013904223) >>> 0;
    return this.rndState / 4294967296;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;

    const top = topObject(this.root);
    if ((top as THREE.Scene).isScene) {
      world.scene = top;
      this.wasInScene = true;
    }

    const now = performance.now();
    if (now - world.lastScan > 400) {
      world.lastScan = now;
      scanWorld();
    }

    // цель перевыбираем несколько раз в секунду, а угол считаем каждый кадр:
    // идущий человек должен оставаться в фокусе без рывков
    if (this.upright && !this.headLocked) {
      this.think -= dt;
      if (this.think <= 0) {
        this.choose();
        this.think = 0.2 + this.rnd() * 0.15;
      }
      this.aim(dt);
    }

    this.apply();
  }

  /** Куда смотрит сам персонаж: глаз у камеры, голова у модели. */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    if (this.head) return this.head.getWorldPosition(out);
    this.root.getWorldPosition(out);
    out.y += PERSON_EYE * Math.abs(this.root.scale.y || 1);
    return out;
  }

  /** object — сам персонаж или его предок (фигура игрока в remotePlayers). */
  belongs(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = this.root;
    while (node) {
      if (node === object) return true;
      node = node.parent;
    }
    return false;
  }

  /** Отцепился от сцены (игрок вышел): держать его в целях больше нельзя. */
  detached(scene: THREE.Object3D): boolean {
    return this.wasInScene && topObject(this.root) !== scene;
  }

  dispose(): void {
    world.idles.delete(this);
  }

  /**
   * Центр головы относительно кости: считается по вершинам, привязанным
   * к head. Нужен и для поправки поворота, и для определения, куда смотрит
   * лицо у моделей, у которых голова смещена назад.
   */
  private measureHeadShift(): THREE.Vector3 | null {
    const head = this.head;
    if (!head) return null;

    let skinned: THREE.SkinnedMesh | null = null;
    this.root.traverse((node) => {
      if (!skinned && node instanceof THREE.SkinnedMesh) skinned = node;
    });
    if (!skinned) return null;

    const mesh = skinned as THREE.SkinnedMesh;
    const index = mesh.skeleton.bones.indexOf(head);
    if (index < 0) return null;

    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    const position = mesh.geometry.getAttribute('position');
    if (!skinIndex || !skinWeight || !position) return null;

    const center = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < position.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) {
        if (skinIndex.getComponent(i, k) === index) weight += skinWeight.getComponent(i, k);
      }
      if (weight <= 0.5) continue;
      center.x += position.getX(i);
      center.y += position.getY(i);
      center.z += position.getZ(i);
      count++;
    }
    if (count === 0) return null;
    center.divideScalar(count);

    this.root.updateMatrixWorld(true);
    const bone = head.getWorldPosition(new THREE.Vector3());
    mesh.worldToLocal(bone);
    return center.sub(bone);
  }

  /** Куда должна повернуться голова, чтобы лицо смотрело на точку. */
  private faceYaw(point: THREE.Vector3): number {
    return normalizeAngle(this.yawTo(point) + this.facing);
  }

  /** Готовые числа для проверок: не надо лезть в кости снаружи. */
  state(): {
    yaw: number;
    pitch: number;
    wantYaw: number;
    wantPitch: number;
    mode: 'person' | 'neighbor' | 'wander';
    distance: number | null;
  } {
    let distance: number | null = null;
    if (this.target) {
      const point = eyeOf(this.target, this.tmpEye);
      const origin = this.eyeWorld(this.tmpA);
      distance = Math.hypot(point.x - origin.x, point.z - origin.z);
    }
    return {
      yaw: this.head?.rotation.y ?? 0,
      pitch: this.head?.rotation.x ?? 0,
      wantYaw: this.wantYaw,
      wantPitch: this.wantPitch,
      mode: this.mode,
      distance,
    };
  }

  /* ───────────────────────────── выбор цели ───────────────────────────── */

  private choose(): void {
    const person = this.findPerson();
    if (person) {
      this.target = person;
      this.mode = 'person';
      return;
    }

    const neighbor = this.findNeighbor();
    if (neighbor) {
      this.target = neighbor.root;
      this.mode = 'neighbor';
      return;
    }

    this.target = null;
    this.mode = 'wander';
    if (this.time >= this.wanderIn) this.wander();
  }

  private findPerson(): THREE.Object3D | null {
    const origin = this.eyeWorld(this.tmpOrigin);
    let best: THREE.Object3D | null = null;
    let bestScore = PLAYER_RANGE;

    for (const person of world.persons) {
      if (this.belongs(person)) continue;
      const point = eyeOf(person, this.tmpEye);
      const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
      if (distance < 0.45 || distance > PLAYER_RANGE) continue;
      if (Math.abs(this.faceYaw(point)) > this.behind) continue;
      // за текущую цель держимся крепче: иначе при двух игроках рядом
      // взгляд перескакивает между ними каждый кадр
      const score = distance * (person === this.target ? 0.75 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = person;
      }
    }

    return best;
  }

  private findNeighbor(): CharacterIdle | null {
    const origin = this.eyeWorld(this.tmpOrigin);
    let best: CharacterIdle | null = null;
    let bestScore = NEIGHBOR_RANGE;

    for (const idle of world.idles) {
      if (idle === this) continue;
      if (this.belongs(idle.root)) continue;
      const point = idle.eyeWorld(this.tmpEye);
      const distance = Math.hypot(point.x - origin.x, point.z - origin.z);
      if (distance < 0.5 || distance > NEIGHBOR_RANGE) continue;
      if (Math.abs(this.faceYaw(point)) > Math.min(NEIGHBOR_BEHIND, this.behind)) continue;
      const score = distance * (idle.root === this.target ? 0.75 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = idle;
      }
    }

    return best;
  }

  /** Никого рядом: медленный обзор, у части персонажей — телефон. */
  private wander(): void {
    if (this.fondOfPhone && this.rnd() < 0.5) {
      this.wanderYaw = (this.rnd() - 0.5) * 0.5;
      this.wanderPitch = -(0.3 + this.rnd() * 0.18);
      this.wanderIn = this.time + 2.5 + this.rnd() * 3.5;
      return;
    }

    this.wanderYaw = (this.rnd() * 2 - 1) * 0.7;
    this.wanderPitch = (this.rnd() * 2 - 1) * 0.14;
    this.wanderIn = this.time + 1.6 + this.rnd() * 3.4;
  }

  /** Угол до точки в системе тела: 0 — прямо перед лицом (−Z/+Z не путать:
   *  модели собраны лицом в +Z, поэтому yaw = atan2(x, z)). */
  private yawTo(point: THREE.Vector3): number {
    const origin = this.eyeWorld(this.tmpA);
    this.root.getWorldQuaternion(this.tmpQuat);
    const local = this.tmpB.copy(point).sub(origin).applyQuaternion(this.tmpQuat.invert());
    return Math.atan2(local.x, local.z);
  }

  /* ───────────────────────────── поза ───────────────────────────── */

  private aim(dt: number): void {
    let wantYaw = this.wanderYaw;
    let wantPitch = this.wanderPitch;

    if (this.target) {
      const point = eyeOf(this.target, this.tmpEye);
      const origin = this.eyeWorld(this.tmpA);
      this.root.getWorldQuaternion(this.tmpQuat);
      const local = this.tmpB.copy(point).sub(origin).applyQuaternion(this.tmpQuat.invert());
      const flat = Math.hypot(local.x, local.z);
      wantYaw = clamp(normalizeAngle(Math.atan2(local.x, local.z) + this.facing), -this.maxYaw, this.maxYaw);
      wantPitch = clamp(Math.atan2(local.y, flat || 0.001), -this.maxPitchDown, this.maxPitchUp);
    }

    this.wantYaw = wantYaw;
    this.wantPitch = wantPitch;

    // с целью реагируем быстро, без цели возвращаемся вяло
    const tau = (this.target ? 0.18 : 0.5) * this.turnRate;
    const k = 1 - Math.exp(-dt / tau);
    this.yaw += (this.wantYaw - this.yaw) * k;
    this.pitch += (this.wantPitch - this.pitch) * k;
  }

  private apply(): void {
    // корпус забирает долю поворота, голова — остальное: суммарно ровно this.yaw,
    // иначе шея складывается с корпусом и предел 54° превращается в 65°
    const spineYaw = this.headLocked ? 0 : clamp(this.yaw * SPINE_SHARE, -SPINE_LIMIT, SPINE_LIMIT);

    if (this.head && this.upright && !this.headLocked) {
      // микротремор: даже замерев на цели, человек не превращается в манекен
      const tremor = Math.sin(this.time * 1.9 + this.phase) * 0.008;
      this.head.rotation.y = this.baseHeadY + this.yaw - spineYaw + tremor;
      this.head.rotation.x =
        this.baseHeadX - this.pitch + Math.sin(this.time * 1.1 + this.phase * 2) * 0.005;
      this.head.rotation.z = this.baseHeadZ + this.yaw * 0.07;

      // Вращаем вокруг стыка шеи, а не вокруг кости: кость у сидящих моделей
      // на 0.4 м позади головы. Поправка = p − R·p, где p — стык шеи в системе
      // кости. У стоящих моделей p ≈ 0, поэтому для них ничего не меняется.
      if (this.headShift) {
        this.tmpQuat.setFromEuler(this.head.rotation);
        this.tmpA.copy(this.headShift).applyQuaternion(this.tmpQuat);
        this.head.position
          .copy(this.headBasePos)
          .add(this.tmpB.copy(this.headShift).sub(this.tmpA));
      }
    }

    if (this.spine) {
      this.spine.rotation.y = this.baseSpineY + spineYaw;
      // дыхание: чуть заметный наклон вперёд-назад, у каждого свой темп
      this.spine.rotation.x =
        this.baseSpineX + Math.sin(this.time * this.breathRate + this.phase) * this.breathAmp;
    }
  }
}
