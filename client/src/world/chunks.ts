/**
 * Стриминг мира: чанки грузятся по расстоянию и выгружаются, когда далеко.
 *
 * Это тот самый пункт «на клиенте ~10% данных»: в памяти держим только то,
 * что рядом. Вес чанка считается по-настоящему — по размерам буферов геометрии,
 * а не «на глаз», поэтому и цифра в панели настоящая.
 */

import * as THREE from 'three';

import type { Box2 } from './collision';
import { buildCar, CAR_HALF_LENGTH } from './car';
import { buildTunnelSlice } from './tunnel';
import type { Textures } from '../render/textures';

/** Границы чанка по оси Z. */
export interface ChunkDef {
  id: string;
  zFrom: number;
  zTo: number;
}

export interface ChunkContent {
  object: THREE.Object3D;
  colliders?: Box2[];
  phones?: THREE.Vector3[];
}

const CAR_LIMIT = CAR_HALF_LENGTH + 0.1;
const TUNNEL_FROM = -30;
const TUNNEL_TO = 30;
const TUNNEL_SEGMENTS = 8;
const SEGMENT = (TUNNEL_TO - TUNNEL_FROM) / TUNNEL_SEGMENTS;

export const CHUNKS: ChunkDef[] = [
  { id: 'car_a', zFrom: -CAR_LIMIT, zTo: 0 },
  { id: 'car_b', zFrom: 0, zTo: CAR_LIMIT },
  ...Array.from({ length: TUNNEL_SEGMENTS }, (_, i) => ({
    id: `tunnel_${String(i + 1).padStart(2, '0')}`,
    zFrom: TUNNEL_FROM + i * SEGMENT,
    zTo: TUNNEL_FROM + (i + 1) * SEGMENT,
  })),
];

function buildChunk(def: ChunkDef, tex: Textures): ChunkContent {
  if (def.id.startsWith('car')) {
    const car = buildCar(tex, def.zFrom, def.zTo);
    return { object: car.group, colliders: car.colliders, phones: car.phones };
  }
  return { object: buildTunnelSlice(def.zFrom, def.zTo) };
}

/** Байты геометрии: сумма буферов атрибутов и индексов. */
function measureGeometry(object: THREE.Object3D): number {
  let bytes = 0;
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry;
    for (const attribute of Object.values(geometry.attributes)) {
      const array = (attribute as THREE.BufferAttribute | undefined)?.array;
      if (array) bytes += array.byteLength;
    }
    if (geometry.index) bytes += geometry.index.array.byteLength;
  });
  return bytes;
}

function measureTextures(tex: Textures): number {
  let bytes = 0;
  for (const texture of Object.values(tex)) {
    const image = texture.image as { width?: number; height?: number } | undefined;
    bytes += (image?.width ?? 256) * (image?.height ?? 256) * 4;
  }
  return bytes;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const material = node.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}

export interface ChunkStats {
  loadedChunks: number;
  totalChunks: number;
  loadedMb: number;
  totalMb: number;
  loadedPercent: number;
}

export class ChunkManager {
  readonly group = new THREE.Group();

  private readonly loaded = new Map<string, ChunkContent>();
  private readonly weights = new Map<string, number>();
  private readonly textureBytes: number;
  private collidersCache: Box2[] = [];
  private phonesCache: THREE.Vector3[] = [];

  constructor(
    private readonly tex: Textures,
    // радиус подобран так, чтобы вагон не разваливался на глазах: половинки
    // грузятся обе, пока игрок внутри, а тоннель подтягивается по мере подхода
    private readonly loadRadius = 12,
    private readonly unloadRadius = 16,
  ) {
    this.group.name = 'chunks';
    this.textureBytes = measureTextures(tex);

    // Один раз собираем каждый чанк, чтобы знать его настоящий вес,
    // и сразу освобождаем: в памяти на старте ничего не остаётся.
    for (const def of CHUNKS) {
      const content = buildChunk(def, tex);
      this.weights.set(def.id, measureGeometry(content.object));
      disposeObject(content.object);
    }
  }

  get colliders(): readonly Box2[] {
    return this.collidersCache;
  }

  get phones(): readonly THREE.Vector3[] {
    return this.phonesCache;
  }

  /** Подгружает и выгружает чанки под текущую позицию игрока. */
  update(playerZ: number): void {
    for (const def of CHUNKS) {
      const isLoaded = this.loaded.has(def.id);
      const distance = distanceToChunk(def, playerZ);
      const limit = isLoaded ? this.unloadRadius : this.loadRadius;

      if (!isLoaded && distance <= limit) this.load(def);
      else if (isLoaded && distance > limit) this.unload(def.id);
    }
  }

  stats(): ChunkStats {
    let loadedBytes = 0;
    let totalBytes = 0;

    for (const def of CHUNKS) {
      const weight = this.weights.get(def.id) ?? 0;
      totalBytes += weight;
      if (this.loaded.has(def.id)) loadedBytes += weight;
    }

    // текстуры общие: если загружен хоть один чанк вагона, они в памяти
    const usesTextures = [...this.loaded.keys()].some((id) => id.startsWith('car'));
    totalBytes += this.textureBytes;
    if (usesTextures) loadedBytes += this.textureBytes;

    const toMb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

    return {
      loadedChunks: this.loaded.size,
      totalChunks: CHUNKS.length,
      loadedMb: toMb(loadedBytes),
      totalMb: toMb(totalBytes),
      loadedPercent: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
    };
  }

  private load(def: ChunkDef): void {
    const content = buildChunk(def, this.tex);
    this.group.add(content.object);
    this.loaded.set(def.id, content);
    this.rebuildCaches();
  }

  private unload(id: string): void {
    const content = this.loaded.get(id);
    if (!content) return;
    this.group.remove(content.object);
    disposeObject(content.object);
    this.loaded.delete(id);
    this.rebuildCaches();
  }

  private rebuildCaches(): void {
    const colliders: Box2[] = [];
    const phones: THREE.Vector3[] = [];
    for (const content of this.loaded.values()) {
      if (content.colliders) colliders.push(...content.colliders);
      if (content.phones) phones.push(...content.phones);
    }
    this.collidersCache = colliders;
    this.phonesCache = phones;
  }
}

function distanceToChunk(def: ChunkDef, z: number): number {
  if (z < def.zFrom) return def.zFrom - z;
  if (z > def.zTo) return z - def.zTo;
  return 0;
}
