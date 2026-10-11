/**
 * Walls as line segments with thickness. A walker is a circle; each step it is
 * pushed out of any wall it overlaps. Doorways are simply gaps between segments.
 */
import { segmentDistance } from "../geom/polygon";

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Optional owner, so callers can ignore a building's own outer walls. */
  owner?: unknown;
}

/** Half the thickness of a wall, in meters. */
export const WALL_HALF = 0.1;

export class SegmentGrid {
  private readonly cells = new Map<string, Segment[]>();

  constructor(readonly cellSize = 16) {}

  add(s: Segment): void {
    const c = this.cellSize;
    for (let i = Math.floor(Math.min(s.ax, s.bx) / c); i <= Math.floor(Math.max(s.ax, s.bx) / c); i++) {
      for (let j = Math.floor(Math.min(s.az, s.bz) / c); j <= Math.floor(Math.max(s.az, s.bz) / c); j++) {
        const key = `${i},${j}`;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(s);
      }
    }
  }

  near(x: number, z: number, r: number): Segment[] {
    const out = new Set<Segment>();
    const c = this.cellSize;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        for (const s of this.cells.get(`${i},${j}`) ?? []) out.add(s);
      }
    }
    return [...out];
  }
}

/** Push a circle of radius `r` at (x, z) clear of every segment. */
export function pushOut(x: number, z: number, r: number, segs: readonly Segment[], half = WALL_HALF): [number, number] {
  const min = r + half;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const s of segs) {
      const { d, t } = segmentDistance(x, z, s.ax, s.az, s.bx, s.bz);
      if (d >= min) continue;
      const qx = s.ax + (s.bx - s.ax) * t;
      const qz = s.az + (s.bz - s.az) * t;
      let nx = x - qx;
      let nz = z - qz;
      if (d < 1e-6) {
        // Exactly on the wall line: push along the wall's normal.
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
        nx = -(s.bz - s.az) / len;
        nz = (s.bx - s.ax) / len;
      } else {
        nx /= d;
        nz /= d;
      }
      x = qx + nx * min;
      z = qz + nz * min;
      moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}
