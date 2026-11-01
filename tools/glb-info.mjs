/**
 * Что лежит внутри .glb: узлы, меши, анимации, габариты.
 *
 *   node tools/glb-info.mjs charachters
 *
 * Нужен, чтобы не гадать: где у модели «низ», какая высота в метрах,
 * есть ли скелет и анимации, куда смотрит лицо.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'charachters';

function readGlb(file) {
  const buffer = readFileSync(file);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('не GLB');

  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return json;
}

for (const name of readdirSync(dir)) {
  const file = path.join(dir, name);
  if (!statSync(file).isFile() || !name.endsWith('.glb')) continue;

  const gltf = readGlb(file);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];

  // габариты считаем по min/max POSITION — их пишет экспортёр
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      const accessor = gltf.accessors?.[prim.attributes?.POSITION];
      if (!accessor?.min) continue;
      min = min.map((v, i) => Math.min(v, accessor.min[i]));
      max = max.map((v, i) => Math.max(v, accessor.max[i]));
    }
  }

  const size = max.map((v, i) => +(v - min[i]).toFixed(2));
  const anims = (gltf.animations ?? []).map((a) => a.name ?? '(без имени)');

  console.log(`${name}`);
  console.log(`  узлов: ${nodes.length}, мешей: ${meshes.length}, материалов: ${(gltf.materials ?? []).length}`);
  console.log(`  габариты: ${size.join(' × ')} м, низ по y: ${min[1].toFixed(2)}, верх: ${max[1].toFixed(2)}`);
  console.log(`  скелет: ${(gltf.skins ?? []).length > 0 ? 'да' : 'нет'}`);
  console.log(`  анимации: ${anims.length > 0 ? anims.join(', ') : 'нет'}`);
  console.log(`  корневые узлы: ${(gltf.scenes?.[0]?.nodes ?? []).map((i) => nodes[i]?.name ?? i).join(', ')}`);
  console.log('');
}
