/**
 * Ground-plane collision for walkers: a circle against building footprints.
 * Footprints live in a uniform grid so each step only tests nearby buildings.
 */
import { bounds, pointInPolygon, segmentDistance, type P2 } from "../geom/polygon";

export class FootprintGrid {
  private readonly cells = new Map<string, P2[][]>();

  constructor(readonly cellSize = 32) {}

  add(poly: readonly P2[]): void {
    const b = bounds(poly);
    for (let i = Math.floor(b.minX / this.cellSize); i <= Math.floor(b.maxX / this.cellSize); i++) {
      for (let j = Math.floor(b.minZ / this.cellSize); j <= Math.floor(b.maxZ / this.cellSize); j++) {
        const key = `${i},${j}`;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(poly as P2[]);
      }
    }
  }

  /** Footprints whose cells overlap the box around (x, z) of half-size r. */
  near(x: number, z: number, r: number): P2[][] {
    const out = new Set<P2[]>();
    for (let i = Math.floor((x - r) / this.cellSize); i <= Math.floor((x + r) / this.cellSize); i++) {
      for (let j = Math.floor((z - r) / this.cellSize); j <= Math.floor((z + r) / this.cellSize); j++) {
        for (const p of this.cells.get(`${i},${j}`) ?? []) out.add(p);
      }
    }
    return [...out];
  }

  /** Whether a circle at (x, z) touches any footprint. */
  blocked(x: number, z: number, r: number): boolean {
    return this.near(x, z, r).some((poly) => pointInPolygon(x, z, poly) || edgeDistance(x, z, poly).d < r);
  }

  /** Push a circle of radius `r` at (x, z) out of every footprint it overlaps. */
  resolve(x: number, z: number, r: number): [number, number] {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const poly of this.near(x, z, r)) {
        const inside = pointInPolygon(x, z, poly);
        const { d, qx, qz } = edgeDistance(x, z, poly);
        if (!inside && d >= r) continue;
        // Direction from the circle center to the nearest boundary point, flipped when outside.
        let nx = qx - x;
        let nz = qz - z;
        const len = Math.hypot(nx, nz) || 1;
        nx /= len;
        nz /= len;
        if (inside) {
          x = qx + nx * r;
          z = qz + nz * r;
        } else {
          x = qx - nx * r;
          z = qz - nz * r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return [x, z];
  }
}

/** Distance from (x, z) to the polygon boundary and the closest boundary point. */
function edgeDistance(x: number, z: number, poly: readonly P2[]) {
  let best = { d: Infinity, qx: x, qz: z };
  for (let k = 0; k < poly.length; k++) {
    const [ax, az] = poly[k];
    const [bx, bz] = poly[(k + 1) % poly.length];
    const { d, t } = segmentDistance(x, z, ax, az, bx, bz);
    if (d < best.d) best = { d, qx: ax + (bx - ax) * t, qz: az + (bz - az) * t };
  }
  return best;
}
