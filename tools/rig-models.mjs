/**
 * Офлайн-риг моделей персонажей.
 *
 * Задача: у моделей BKS5 нет скелета — каждый GLB это один меш из отдельных
 * замкнутых деталей (голова, торс, руки, ноги, обувь). Скрипт находит детали,
 * раскладывает их по костям, пришивает к каждой вершине вес 1.0 (жёсткий риг,
 * стиль и так низкополигональный) и пересобирает GLB со skin — одна draw call
 * на персонажа, как и было.
 *
 * Колено: в стоячих моделях нога — одна деталь от бедра до щиколотки, а в
 * сидячих бедро и голень уже разные детали. Поэтому колено делается двумя
 * способами: там, где нога цельная, веса у вершины плавно переходят с бедра
 * на голень в полосе ±5 см вокруг колена (меш тянется, а не рвётся); там, где
 * детали разные, они просто расходятся по двум костям.
 *
 * Запуск: node tools/rig-models.mjs
 * Результат: client/public/models/*.glb (перезаписываются), tools/rig/report.json
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'charachters');
const DST = path.join(ROOT, 'client', 'public', 'models');
const OVERRIDES = path.join(ROOT, 'tools', 'rig', 'overrides.json');
const REPORT = path.join(ROOT, 'tools', 'rig', 'report.json');

/** Имя модели в charachters → имя файла в public/models. */
const RENAME = {
  'npc stand.glb': 'npc_stand.glb',
  'npc sit.glb': 'npc_sit.glb',
};

/** Кости: имя, родитель. Порядок = порядок joints в skin. */
const BONES = [
  ['hips', null],
  ['spine', 'hips'],
  ['head', 'spine'],
  ['shoulderL', 'spine'],
  ['elbowL', 'shoulderL'],
  ['handL', 'elbowL'],
  ['shoulderR', 'spine'],
  ['elbowR', 'shoulderR'],
  ['handR', 'elbowR'],
  ['thighL', 'hips'],
  ['kneeL', 'thighL'],
  ['footL', 'kneeL'],
  ['thighR', 'hips'],
  ['kneeR', 'thighR'],
  ['footR', 'kneeR'],
];
const BONE_INDEX = new Map(BONES.map(([name], i) => [name, i]));

/** Поза модели: от неё зависит, как искать ноги и руки. */
const POSES = {
  'altyshka.glb': 'stand',
  'ganvest.glb': 'stand',
  'maksim.glb': 'stand',
  'mashinist.glb': 'stand',
  'obhodchik.glb': 'stand',
  'rabochii.glb': 'stand',
  'teacher.glb': 'stand',
  'vladimir.glb': 'stand',
  'npc stand.glb': 'stand',
  'svyazi_def.glb': 'stand',
  'svyazi_orange.glb': 'stand',
  'babka.glb': 'sit',
  'devochka.glb': 'sit',
  'npc_sidit.glb': 'sit',
  'npc sit.glb': 'sit',
  'dima_red_t-shirt.glb': 'lie',
  'dima_witout_red_t-shirt.glb': 'lie',
  /** Велосипед — не персонаж: скелет ему не нужен, остаётся как есть. */
  'velosiped.glb': 'skip',
};

/** Полоса подмешивания веса у колена, метры. */
const KNEE_BAND = 0.05;

// ---------------------------------------------------------------- GLB чтение

function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('не GLB: ' + file);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  let bin = Buffer.alloc(0);
  const binChunkLength = buf.readUInt32LE(20 + jsonLength);
  if (binChunkLength > 0) {
    bin = buf.subarray(20 + jsonLength + 8, 20 + jsonLength + 8 + binChunkLength);
  }
  return { json, bin };
}

const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function accessorValues(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const size = COMPONENT_SIZE[accessor.componentType];
  const count = TYPE_COUNT[accessor.type];
  const stride = view.byteStride ?? size * count;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(accessor.count * count);
  for (let i = 0; i < accessor.count; i++) {
    const offset = base + i * stride;
    for (let c = 0; c < count; c++) {
      const at = offset + c * size;
      let value;
      if (accessor.componentType === 5126) value = bin.readFloatLE(at);
      else if (accessor.componentType === 5125) value = bin.readUInt32LE(at);
      else if (accessor.componentType === 5123) value = bin.readUInt16LE(at);
      else if (accessor.componentType === 5121) value = bin.readUInt8(at);
      else value = bin.readInt16LE(at);
      out[i * count + c] = value;
    }
  }
  return { data: out, count, stride: count };
}

// ------------------------------------------------------------- анализ деталей

/** Детали меша: связные куски после сварки вершин по позиции. */
function findParts(positions, indices) {
  const n = positions.length / 3;

  // сварка: одинаковые позиции получают один номер
  const weld = new Int32Array(n);
  const seen = new Map();
  let welded = 0;
  for (let i = 0; i < n; i++) {
    const key =
      Math.round(positions[i * 3] * 2000) +
      ',' +
      Math.round(positions[i * 3 + 1] * 2000) +
      ',' +
      Math.round(positions[i * 3 + 2] * 2000);
    let id = seen.get(key);
    if (id === undefined) {
      id = welded++;
      seen.set(key, id);
    }
    weld[i] = id;
  }

  const parent = new Int32Array(welded);
  for (let i = 0; i < welded; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    union(weld[indices[t]], weld[indices[t + 1]]);
    union(weld[indices[t + 1]], weld[indices[t + 2]]);
  }

  const byRoot = new Map();
  for (let v = 0; v < n; v++) {
    const root = find(weld[v]);
    let part = byRoot.get(root);
    if (!part) {
      part = {
        root,
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
        sum: [0, 0, 0],
        verts: [],
      };
      byRoot.set(root, part);
    }
    part.verts.push(v);
    for (let c = 0; c < 3; c++) {
      const value = positions[v * 3 + c];
      part.sum[c] += value;
      if (value < part.min[c]) part.min[c] = value;
      if (value > part.max[c]) part.max[c] = value;
    }
  }

  const parts = [...byRoot.values()];
  for (const part of parts) {
    part.tris = part.verts.length / 3;
    part.cy = part.sum[1] / part.verts.length;
    part.cx = part.sum[0] / part.verts.length;
    part.cz = part.sum[2] / part.verts.length;
    part.width = part.max[0] - part.min[0];
    part.height = part.max[1] - part.min[1];
    part.depth = part.max[2] - part.min[2];
  }
  parts.sort((a, b) => b.tris - a.tris);
  parts.forEach((part, i) => (part.index = i));
  return { parts, weld };
}

// ---------------------------------------------------------- классификация

/**
 * Раскладывает детали по костям: сначала крупные и очевидные (голова, ноги,
 * руки, торс, пояс), потом всё остальное — к ближайшей уже разобранной детали.
 * Так очки, галстук и сумка садятся на ту же кость, что и соседняя деталь,
 * и не нужно угадывать их по высоте.
 */
function classify(parts, height, pose) {
  const assignments = new Map(); // part.index -> { bone, kneeAt? }
  const take = (part, bone, extra) => assignments.set(part.index, { bone, ...extra });
  const sideOf = (x) => (x < 0 ? 'L' : 'R');
  const big = parts.filter((part) => part.tris >= 6); // мелочь (кнопки, шнурки) — потом
  const central = (part) => Math.abs(part.cx) < 0.13 * height;
  const oneSided = (part) => part.max[0] < 0.01 * height || part.min[0] > -0.01 * height;

  /** Голова: самый верхний центральный кусок и всё, что вокруг него. */
  const assignHead = (anchor) => {
    take(anchor, 'head');
    const neckY = anchor.min[1];
    for (const part of big) {
      if (assignments.has(part.index)) continue;
      if (part.cy > neckY - 0.05 * height && Math.abs(part.cx) < 0.16 * height) take(part, 'head');
    }
    return neckY;
  };

  // — лежащий и сидящий: конечности не разбираем, для них важнее корпус и голова
  if (pose === 'lie') {
    const torso = [...big].sort((a, b) => b.tris - a.tris).find(central) ?? big[0];
    take(torso, 'spine');
    const head = big
      .filter((part) => part.index !== torso.index && central(part) && part.tris > 20)
      .sort((a, b) => Math.abs(b.cz - torso.cz) - Math.abs(a.cz - torso.cz))[0];
    if (head) assignHead(head);
    for (const part of parts) if (!assignments.has(part.index)) take(part, 'hips');
    return assignments;
  }

  if (pose === 'sit') {
    const anchor = big.filter(central).sort((a, b) => b.max[1] - a.max[1])[0];
    assignHead(anchor);
    const torso = big
      .filter((part) => !assignments.has(part.index) && central(part))
      .sort((a, b) => b.tris - a.tris)[0];
    if (torso) take(torso, 'spine');
    for (const part of parts) if (!assignments.has(part.index)) take(part, 'hips');
    return assignments;
  }

  // — стоящий: голова, ступни, ноги, руки, торс, пояс
  const headAnchor = big.filter(central).sort((a, b) => b.max[1] - a.max[1])[0];
  assignHead(headAnchor);

  // граница «ноги / руки» — по данным: ищем самый большой разрыв в |x| между деталями
  const lateral = big
    .filter((part) => oneSided(part) && Math.abs(part.cx) > 0.02 * height)
    .map((part) => Math.abs(part.cx))
    .sort((a, b) => a - b);
  let split = 0.13 * height;
  let bestGap = 0;
  for (let i = 1; i < lateral.length; i++) {
    const gap = lateral[i] - lateral[i - 1];
    if (gap > bestGap && lateral[i] > 0.07 * height && lateral[i - 1] < 0.2 * height) {
      bestGap = gap;
      split = (lateral[i] + lateral[i - 1]) / 2;
    }
  }
  const isLeg = (part) => oneSided(part) && Math.abs(part.cx) < split;
  const isArm = (part) => Math.abs(part.cx) >= split;

  // ступни: обувь у самого пола
  for (const part of big) {
    if (assignments.has(part.index)) continue;
    if (part.max[1] < 0.14 * height && part.cy < 0.1 * height) take(part, 'foot' + sideOf(part.cx));
  }

  // опорные высоты ноги: щиколотка снизу, пояс сверху
  const ankleY = 0.05 * height;
  const pelvisGuess = 0.52 * height;

  // ноги: однобокие куски у центра, ниже пояса
  for (const sign of [-1, 1]) {
    const suffix = sign < 0 ? 'L' : 'R';
    const mine = big
      .filter((part) => !assignments.has(part.index))
      .filter((part) => Math.sign(part.cx) === sign && isLeg(part))
      .filter((part) => part.cy < 0.62 * height);
    for (const part of mine) {
      if (part.height > 0.42 * height) {
        // цельная нога от бедра до щиколотки: колено внутри детали
        take(part, 'thigh' + suffix, {
          kneeAt: {
            y: part.min[1] + 0.48 * part.height,
            upper: 'thigh' + suffix,
            lower: 'knee' + suffix,
          },
        });
        continue;
      }
      const t = (part.cy - ankleY) / Math.max(0.01, pelvisGuess - ankleY);
      take(part, t > 0.35 ? 'thigh' + suffix : 'knee' + suffix);
    }
  }

  // руки: куски дальше от центра, чем ноги, сверху вниз плечо → предплечье → кисть
  for (const sign of [-1, 1]) {
    const names = sign < 0 ? ['shoulderL', 'elbowL', 'handL'] : ['shoulderR', 'elbowR', 'handR'];
    const mine = big
      .filter((part) => !assignments.has(part.index))
      .filter((part) => Math.sign(part.cx) === sign && isArm(part))
      .filter((part) => part.cy > 0.25 * height)
      .sort((a, b) => b.cy - a.cy);
    mine.slice(0, 3).forEach((part, i) => take(part, names[i]));
  }

  // торс и пояс — самые крупные из оставшихся центральных
  const freeCentral = big.filter((part) => !assignments.has(part.index) && central(part));
  const torso = freeCentral
    .filter((part) => part.cy > 0.5 * height)
    .sort((a, b) => b.tris - a.tris)[0];
  if (torso) take(torso, 'spine');
  const pelvis = freeCentral
    .filter((part) => !assignments.has(part.index))
    .filter((part) => part.cy > 0.28 * height && part.cy <= 0.65 * height)
    .sort((a, b) => b.tris - a.tris)[0];
  if (pelvis) take(pelvis, 'hips');

  fillNearest(parts, assignments);
  return assignments;
}

/** Свободные детали — к ближайшей уже занятой: аксессуары едут с тем, к чему прилипли. */
function fillNearest(parts, assignments) {
  const taken = parts.filter((part) => assignments.has(part.index));
  for (const part of parts) {
    if (assignments.has(part.index)) continue;
    let best = null;
    let bestDistance = Infinity;
    for (const other of taken) {
      const dx = part.cx - other.cx;
      const dy = part.cy - other.cy;
      const dz = part.cz - other.cz;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    }
    if (best) assignments.set(part.index, { bone: assignments.get(best.index).bone });
  }
}

// ------------------------------------------------------------- скелет

/** Точки, где сидят кости: считаются из деталей, с разумными заглушками. */
function bonePositions(parts, height, assignments, pose) {
  const at = {};
  const ofBone = (bone) =>
    parts.filter((part) => assignments.get(part.index)?.bone === bone);

  const centerOf = (list, axis) => {
    const min = Math.min(...list.map((p) => p.min[axis]));
    const max = Math.max(...list.map((p) => p.max[axis]));
    return (min + max) / 2;
  };
  const bottomOf = (list) => Math.min(...list.map((p) => p.min[1]));
  const topOf = (list) => Math.max(...list.map((p) => p.max[1]));

  const pelvis = ofBone('hips');
  const torso = ofBone('spine');
  const head = ofBone('head');

  // лежащий корпус: пояс ставим в центр торса, иначе кость висит на полу
  at.hips = [
    0,
    pose === 'lie' && torso.length
      ? centerOf(torso, 1)
      : pelvis.length
        ? centerOf(pelvis, 1)
        : 0.5 * height,
    0,
  ];
  at.spine = [0, torso.length ? bottomOf(torso) + 0.02 : 0.6 * height, 0];
  at.head = [0, head.length ? bottomOf(head) : 0.86 * height, 0];

  for (const side of ['L', 'R']) {
    const shoulder = ofBone('shoulder' + side);
    const elbow = ofBone('elbow' + side);
    const hand = ofBone('hand' + side);
    const thigh = ofBone('thigh' + side);
    const knee = ofBone('knee' + side);
    const foot = ofBone('foot' + side);

    const sX = shoulder.length ? centerOf(shoulder, 0) : (side === 'L' ? -0.2 : 0.2) * height;
    at['shoulder' + side] = [sX, shoulder.length ? topOf(shoulder) : 0.8 * height, 0];
    at['elbow' + side] = [
      elbow.length ? centerOf(elbow, 0) : sX,
      elbow.length ? topOf(elbow) : 0.62 * height,
      0,
    ];
    at['hand' + side] = [
      hand.length ? centerOf(hand, 0) : sX,
      hand.length ? topOf(hand) : 0.55 * height,
      0,
    ];

    const tX = thigh.length ? centerOf(thigh, 0) : (side === 'L' ? -0.1 : 0.1) * height;
    at['thigh' + side] = [tX, thigh.length ? topOf(thigh) : 0.5 * height, 0];
    const legForKnee = thigh.find((part) => part.height > 0.42 * height);
    at['knee' + side] = [
      tX,
      knee.length
        ? topOf(knee)
        : legForKnee
          ? legForKnee.min[1] + 0.48 * legForKnee.height
          : 0.28 * height,
      0,
    ];
    at['foot' + side] = [
      foot.length ? centerOf(foot, 0) : tX,
      foot.length ? topOf(foot) : 0.06 * height,
      0,
    ];
  }
  return at;
}

// --------------------------------------------------------------- сборка GLB

function appendBuffer(json, bin, data, target) {
  // выравнивание по 4 байта: float-аксессоры в glTF этого требуют
  const padded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const view = {
    buffer: 0,
    byteOffset: padded.length,
    byteLength: data.length,
  };
  if (target) view.target = target;
  json.bufferViews.push(view);
  return Buffer.concat([padded, data]);
}

function rigGlb(file, options) {
  const { json, bin: sourceBin } = readGlb(file);
  const primitive = json.meshes[0].primitives[0];
  const positions = accessorValues(json, sourceBin, primitive.attributes.POSITION).data;
  // часть моделей выгружена без индексов: треугольники идут подряд
  const indices =
    primitive.indices !== undefined
      ? accessorValues(json, sourceBin, primitive.indices).data
      : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const vertexCount = positions.length / 3;

  const ys = [];
  for (let i = 0; i < vertexCount; i++) ys.push(positions[i * 3 + 1]);
  const height = Math.max(...ys);

  const pose = POSES[path.basename(file)] ?? 'stand';
  const { parts } = findParts(positions, indices);
  const assignments = classify(parts, height, pose);

  const override = options.overrides ?? {};
  for (const [partIndex, bone] of Object.entries(override)) {
    const part = parts[Number(partIndex)];
    if (part) assignments.set(part.index, { bone });
  }

  const at = bonePositions(parts, height, assignments, pose);
  for (const [bone, position] of Object.entries(options.boneOverrides ?? {})) {
    at[bone] = position;
  }

  // — веса
  const joints = new Uint8Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (const part of parts) {
    const decision = assignments.get(part.index);
    if (!decision) continue;
    const boneIndex = BONE_INDEX.get(decision.bone);
    for (const vertex of part.verts) {
      const y = positions[vertex * 3 + 1];
      if (decision.kneeAt) {
        // цельная нога: вокруг колена плавно переводим вес с бедра на голень
        const t = (y - decision.kneeAt.y) / KNEE_BAND; // >0 — выше колена
        const up = Math.min(1, Math.max(0, 0.5 + 0.5 * t));
        const upIndex = BONE_INDEX.get(decision.kneeAt.upper);
        const lowIndex = BONE_INDEX.get(decision.kneeAt.lower);
        if (up > 0.999) {
          joints[vertex * 4] = upIndex;
          weights[vertex * 4] = 1;
        } else if (up < 0.001) {
          joints[vertex * 4] = lowIndex;
          weights[vertex * 4] = 1;
        } else {
          joints[vertex * 4] = upIndex;
          joints[vertex * 4 + 1] = lowIndex;
          weights[vertex * 4] = up;
          weights[vertex * 4 + 1] = 1 - up;
        }
      } else {
        joints[vertex * 4] = boneIndex;
        weights[vertex * 4] = 1;
      }
    }
  }

  let bin = sourceBin;
  const jointBytes = Buffer.from(joints.buffer, joints.byteOffset, joints.byteLength);
  const jointView = appendBuffer(json, bin, jointBytes);
  bin = jointView;
  let jointOffset = json.bufferViews[json.bufferViews.length - 1].byteOffset;
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: 5121,
    count: vertexCount,
    type: 'VEC4',
  });
  const jointAccessor = json.accessors.length - 1;

  const weightBytes = Buffer.from(weights.buffer, weights.byteOffset, weights.byteLength);
  bin = appendBuffer(json, bin, weightBytes);
  const weightOffset = json.bufferViews[json.bufferViews.length - 1].byteOffset;
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: 5126,
    count: vertexCount,
    type: 'VEC4',
  });
  const weightAccessor = json.accessors.length - 1;

  // — кости как узлы
  const boneNodeIndex = new Map();
  const firstBoneNode = json.nodes.length;
  for (const [name] of BONES) {
    json.nodes.push({ name });
    boneNodeIndex.set(name, json.nodes.length - 1);
  }
  for (const [name, parentName] of BONES) {
    const node = json.nodes[boneNodeIndex.get(name)];
    const parent = parentName ? at[parentName] : [0, 0, 0];
    const me = at[name];
    node.translation = [me[0] - parent[0], me[1] - parent[1], me[2] - parent[2]];
    if (parentName) {
      const parentNode = json.nodes[boneNodeIndex.get(parentName)];
      (parentNode.children ??= []).push(boneNodeIndex.get(name));
    }
  }

  // — обратные матрицы привязки: кости без поворота, значит просто сдвиг
  const ibm = new Float32Array(BONES.length * 16);
  BONES.forEach(([name], i) => {
    const [x, y, z] = at[name];
    const m = ibm.subarray(i * 16, i * 16 + 16);
    m[0] = 1;
    m[5] = 1;
    m[10] = 1;
    m[15] = 1;
    m[12] = -x;
    m[13] = -y;
    m[14] = -z;
  });
  const ibmBytes = Buffer.from(ibm.buffer, ibm.byteOffset, ibm.byteLength);
  bin = appendBuffer(json, bin, ibmBytes);
  json.accessors.push({
    bufferView: json.bufferViews.length - 1,
    componentType: 5126,
    count: BONES.length,
    type: 'MAT4',
  });
  const ibmAccessor = json.accessors.length - 1;

  primitive.attributes.JOINTS_0 = jointAccessor;
  primitive.attributes.WEIGHTS_0 = weightAccessor;
  json.nodes[0].skin = 0;
  json.skins = [
    {
      name: 'rig',
      joints: BONES.map(([name]) => boneNodeIndex.get(name)),
      skeleton: boneNodeIndex.get('hips'),
      inverseBindMatrices: ibmAccessor,
    },
  ];
  json.scenes[0].nodes = [...new Set([...json.scenes[0].nodes, firstBoneNode])];

  // — запись
  json.buffers = [{ byteLength: bin.length }];
  return {
    json,
    bin,
    height,
    parts: parts.map((part) => ({
      index: part.index,
      tris: part.tris,
      bone: assignments.get(part.index)?.bone ?? null,
      knee: Boolean(assignments.get(part.index)?.kneeAt),
      y: [+part.min[1].toFixed(2), +part.max[1].toFixed(2)],
      x: [+part.min[0].toFixed(2), +part.max[0].toFixed(2)],
    })),
    bones: at,
  };
}

function writeGlb(json, bin) {
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += ' ';
  const jsonBuffer = Buffer.from(jsonText, 'utf8');
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuffer.length + 8 + binPadded.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binPadded]);
}

// ------------------------------------------------------------------- запуск

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const overrideTable = fs.existsSync(OVERRIDES) ? JSON.parse(fs.readFileSync(OVERRIDES, 'utf8')) : {};
fs.mkdirSync(DST, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

const report = {};
const files = fs
  .readdirSync(SRC)
  .filter((f) => f.toLowerCase().endsWith('.glb'))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)));

for (const file of files) {
  try {
    if (POSES[file] === 'skip') {
      console.log(`${file.padEnd(32)} пропуск: не персонаж, скелета не нужно`);
      report[file] = { skipped: true };
      continue;
    }
    const result = rigGlb(path.join(SRC, file), overrideTable[file] ?? {});
    const target = path.join(DST, RENAME[file] ?? file);
    fs.writeFileSync(target, writeGlb(result.json, result.bin));
    report[file] = { out: path.basename(target), height: +result.height.toFixed(2), parts: result.parts };

    const counts = {};
    for (const part of result.parts) counts[part.bone] = (counts[part.bone] ?? 0) + 1;
    const summary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([bone, n]) => `${bone}:${n}`)
      .join(' ');
    console.log(`${file.padEnd(32)} частей ${String(result.parts.length).padStart(2)}  ${summary}`);
  } catch (error) {
    console.error(`${file}: ОШИБКА — ${error.message}`);
    report[file] = { error: error.message };
  }
}

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\nотчёт: ${path.relative(ROOT, REPORT)}`);
