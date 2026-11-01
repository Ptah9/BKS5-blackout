/**
 * Куда смотрит модель: носок стопы и колени торчат вперёд.
 *
 *   node tools/glb-facing.mjs charachters
 *
 * Считаем по вершинам: у стоящих берём полосу ступней (y < 0.12), у сидящих —
 * дальнюю по глубине часть (ноги). Где выступает больше, там и «перед».
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? 'charachters';

function parseGlb(file) {
  const buf = readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeaderOffset = 20 + jsonLength;
  const binStart = binHeaderOffset + 8;
  return { json, bin: buf.subarray(binStart) };
}

function positions(json, bin) {
  const out = [];
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const accessor = json.accessors[prim.attributes.POSITION];
      const view = json.bufferViews[accessor.bufferView];
      const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const stride = view.byteStride ?? 12;
      for (let i = 0; i < accessor.count; i++) {
        const o = base + i * stride;
        out.push([bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)]);
      }
    }
  }
  return out;
}

for (const name of readdirSync(dir)) {
  if (!name.endsWith('.glb')) continue;
  const { json, bin } = parseGlb(path.join(dir, name));
  const pts = positions(json, bin);
  if (pts.length === 0) continue;

  let maxY = 0;
  for (const p of pts) maxY = Math.max(maxY, p[1]);

  const band = (lo, hi) => pts.filter((p) => p[1] >= lo && p[1] <= hi);
  const spread = (list) => {
    if (list.length === 0) return null;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of list) {
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    return { minZ: +minZ.toFixed(3), maxZ: +maxZ.toFixed(3) };
  };

  const feet = spread(band(0, Math.min(0.14, maxY * 0.3)));
  const head = spread(band(maxY * 0.85, maxY));

  const forward = feet && Math.abs(feet.minZ) > Math.abs(feet.maxZ) ? '-Z' : '+Z';
  console.log(`${name.padEnd(22)} ступни: ${JSON.stringify(feet)}  голова: ${JSON.stringify(head)}  → перед ${forward}`);
}
