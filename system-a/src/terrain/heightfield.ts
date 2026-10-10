import type { HeightData, Terrain } from "../format/schema";

/**
 * Regular grid of height samples covering [0, width] x [0, depth].
 * Sample (i, j) sits at x = i * cellX, z = j * cellZ; storage is row-major by z.
 */
export class Heightfield {
  readonly cellX: number;
  readonly cellZ: number;

  constructor(
    readonly width: number,
    readonly depth: number,
    readonly nx: number,
    readonly nz: number,
    readonly data: Float32Array,
  ) {
    if (data.length !== nx * nz) throw new Error(`heightfield: expected ${nx * nz} samples, got ${data.length}`);
    this.cellX = width / (nx - 1);
    this.cellZ = depth / (nz - 1);
  }

  static fromTerrain(t: Terrain): Heightfield {
    const [nx, nz] = t.resolution;
    return new Heightfield(t.size[0], t.size[1], nx, nz, decodeHeights(t.heights, nx * nz));
  }

  /**
   * Bilinearly upsample so no cell is wider than `maxCell` meters. Coarse
   * hand-written terrain then has enough samples for pads and roads to conform.
   */
  refined(maxCell: number): Heightfield {
    const nx = Math.max(this.nx, Math.ceil(this.width / maxCell) + 1);
    const nz = Math.max(this.nz, Math.ceil(this.depth / maxCell) + 1);
    if (nx === this.nx && nz === this.nz) return this;
    const data = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        data[j * nx + i] = this.heightAt((i / (nx - 1)) * this.width, (j / (nz - 1)) * this.depth);
      }
    }
    return new Heightfield(this.width, this.depth, nx, nz, data);
  }

  index(i: number, j: number): number {
    return j * this.nx + i;
  }

  sample(i: number, j: number): number {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return this.data[j * this.nx + i];
  }

  /** Bilinear height at world (x, z); clamps outside the grid. */
  heightAt(x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1, x / this.cellX));
    const fz = Math.max(0, Math.min(this.nz - 1, z / this.cellZ));
    const i = Math.min(this.nx - 2, Math.floor(fx));
    const j = Math.min(this.nz - 2, Math.floor(fz));
    const u = fx - i;
    const v = fz - j;
    const d = this.data;
    const k = j * this.nx + i;
    const h00 = d[k];
    const h10 = d[k + 1];
    const h01 = d[k + this.nx];
    const h11 = d[k + this.nx + 1];
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }

  /** Mean height over a disc, sampled on a small pattern. */
  averageAround(x: number, z: number, radius: number): number {
    let sum = this.heightAt(x, z);
    let n = 1;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      sum += this.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
      n++;
    }
    return sum / n;
  }

  /** Grid index range whose samples fall within the world-space box (clamped). */
  rangeFor(minX: number, minZ: number, maxX: number, maxZ: number) {
    return {
      i0: Math.max(0, Math.floor(minX / this.cellX)),
      j0: Math.max(0, Math.floor(minZ / this.cellZ)),
      i1: Math.min(this.nx - 1, Math.ceil(maxX / this.cellX)),
      j1: Math.min(this.nz - 1, Math.ceil(maxZ / this.cellZ)),
    };
  }

  minMax(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const h of this.data) {
      if (h < min) min = h;
      if (h > max) max = h;
    }
    return { min, max };
  }
}

export function decodeHeights(h: HeightData, count: number): Float32Array {
  switch (h.encoding) {
    case "flat":
      return new Float32Array(count).fill(h.value);
    case "array":
      return Float32Array.from(h.data);
    case "uint16-base64": {
      const bytes = base64ToBytes(h.data);
      if (bytes.length !== count * 2) {
        throw new Error(`terrain: uint16 data has ${bytes.length / 2} samples, expected ${count}`);
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Float32Array(count);
      const span = h.max - h.min;
      for (let k = 0; k < count; k++) out[k] = h.min + (view.getUint16(k * 2, true) / 65535) * span;
      return out;
    }
  }
}

/** Quantize heights to the compact uint16 encoding (resolution = range / 65535). */
export function encodeHeights(data: ArrayLike<number>): HeightData {
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < data.length; k++) {
    if (data[k] < min) min = data[k];
    if (data[k] > max) max = data[k];
  }
  if (max - min < 1e-6) return { encoding: "flat", value: min };
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  const span = max - min;
  for (let k = 0; k < data.length; k++) {
    view.setUint16(k * 2, Math.round(((data[k] - min) / span) * 65535), true);
  }
  return { encoding: "uint16-base64", min, max, data: bytesToBase64(bytes) };
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let k = 0; k < bytes.length; k += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(k, k + CHUNK));
  }
  return btoa(bin);
}
