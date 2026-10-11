import { BufferGeometry, Color, Float32BufferAttribute } from "three";

export type V3 = readonly [number, number, number];

/** Triangle data as flat arrays: 3 positions, 3 colors, 3 normals and 4 edge values per vertex. */
export interface RawMesh {
  pos: number[];
  col: number[];
  nrm: number[];
  edge: number[];
}

const NO_EDGE = [0, 0, 0, 0] as const;

/**
 * Accumulates colored triangles into one non-indexed geometry. Every vertex
 * carries its own normal, so faces can be flat (architecture) or smooth
 * (foliage, terrain). Quads also record where each vertex sits within the
 * quad in meters (`edge`: u, v, width, height), which the stylized shader
 * uses to paint soft highlights along edges, like bevels.
 */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly nrm: number[] = [];
  private readonly edge: number[] = [];

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  private vertex(p: V3, n: V3, c: Color, e: readonly number[]) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c.r, c.g, c.b);
    this.edge.push(e[0], e[1], e[2], e[3]);
  }

  /** Flat triangle a-b-c (counter-clockwise from the front). */
  tri(a: V3, b: V3, c: V3, color: Color): void {
    const n = faceNormal(a, b, c);
    this.vertex(a, n, color, NO_EDGE);
    this.vertex(b, n, color, NO_EDGE);
    this.vertex(c, n, color, NO_EDGE);
  }

  /** Triangle with its own normal and color per vertex (smooth shading, gradients). */
  triSmooth(a: V3, b: V3, c: V3, na: V3, nb: V3, nc: V3, ca: Color, cb: Color = ca, cc: Color = ca): void {
    this.vertex(a, na, ca, NO_EDGE);
    this.vertex(b, nb, cb, NO_EDGE);
    this.vertex(c, nc, cc, NO_EDGE);
  }

  /** Quad a-b-c-d in counter-clockwise order as seen from the front. */
  quad(a: V3, b: V3, c: V3, d: V3, color: Color): void {
    const n = quadNormal(a, b, c, d);
    const w = dist(a, b);
    const h = dist(a, d);
    const e = (u: number, v: number) => [u, v, w, h];
    this.vertex(a, n, color, e(0, 0));
    this.vertex(b, n, color, e(w, 0));
    this.vertex(c, n, color, e(w, h));
    this.vertex(a, n, color, e(0, 0));
    this.vertex(c, n, color, e(w, h));
    this.vertex(d, n, color, e(0, h));
  }

  /** Triangle wound so its normal points along `facing` (any non-perpendicular hint). */
  triFacing(a: V3, b: V3, c: V3, facing: V3, color: Color): void {
    if (dot(rawNormal(a, b, c), facing) >= 0) this.tri(a, b, c, color);
    else this.tri(a, c, b, color);
  }

  /** Quad a-b-c-d (a loop in either direction) wound so it faces along `facing`. */
  quadFacing(a: V3, b: V3, c: V3, d: V3, facing: V3, color: Color): void {
    if (dot(quadRaw(a, b, c, d), facing) >= 0) this.quad(a, b, c, d, color);
    else this.quad(a, d, c, b, color);
  }

  /**
   * Append raw triangles rotated about Y by `rot`, scaled, then translated.
   * Used to stamp prop templates into a tile.
   */
  appendTransformed(m: RawMesh, rot: number, scale: number, tx: number, ty: number, tz: number): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let k = 0; k < m.pos.length; k += 3) {
      const x = m.pos[k], y = m.pos[k + 1], z = m.pos[k + 2];
      this.pos.push(tx + (x * c + z * s) * scale, ty + y * scale, tz + (-x * s + z * c) * scale);
      const nx = m.nrm[k], ny = m.nrm[k + 1], nz = m.nrm[k + 2];
      this.nrm.push(nx * c + nz * s, ny, -nx * s + nz * c);
    }
    for (let k = 0; k < m.col.length; k++) this.col.push(m.col[k]);
    for (let k = 0; k < m.edge.length; k++) this.edge.push(m.edge[k] * scale);
  }

  /** Number of vertices so far (to mark where a piece starts). */
  get vertexCount(): number {
    return this.pos.length / 3;
  }

  /**
   * Shade vertices from `start` on by height: `low` at y0 rising to `high` at
   * y1 (ambient darkening near the ground, sunlit tops).
   */
  gradeVertical(start: number, y0: number, y1: number, low: number, high: number): void {
    const span = Math.max(0.01, y1 - y0);
    for (let v = start; v < this.pos.length / 3; v++) {
      const t = Math.min(1, Math.max(0, (this.pos[v * 3 + 1] - y0) / span));
      const k = low + (high - low) * t * t * (3 - 2 * t);
      this.col[v * 3] *= k;
      this.col[v * 3 + 1] *= k;
      this.col[v * 3 + 2] *= k;
    }
  }

  /** Raw triangle data. */
  raw(): RawMesh {
    return { pos: this.pos, col: this.col, nrm: this.nrm, edge: this.edge };
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("edge", new Float32BufferAttribute(this.edge, 4));
    g.computeBoundingSphere();
    return g;
  }
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

function rawNormal(a: V3, b: V3, c: V3): V3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function faceNormal(a: V3, b: V3, c: V3): V3 {
  const n = rawNormal(a, b, c);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Quad normal from its diagonals: robust when two corners meet (cones, wedges). */
function quadRaw(a: V3, b: V3, c: V3, d: V3): V3 {
  const px = c[0] - a[0], py = c[1] - a[1], pz = c[2] - a[2];
  const qx = d[0] - b[0], qy = d[1] - b[1], qz = d[2] - b[2];
  return [py * qz - pz * qy, pz * qx - px * qz, px * qy - py * qx];
}

function quadNormal(a: V3, b: V3, c: V3, d: V3): V3 {
  const n = quadRaw(a, b, c, d);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}
