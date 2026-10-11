/**
 * Soft, rounded shapes for the painted look: foliage puffs with normals bent
 * toward the whole canopy's center (so a tree reads as one soft volume, lit
 * like a cloud), trunks and cones with smooth sides, and vertical color
 * gradients baked into vertex colors (dark at the base, sunlit on top).
 */
import { Color } from "three";
import type { MeshBuilder, V3 } from "./meshBuilder";

type Tri = [number, number, number];

const spheres = new Map<number, { v: V3[]; f: Tri[] }>();

/** Unit icosphere with `level` subdivisions (0: 20 faces, 1: 80, 2: 320). */
export function icosphere(level: number): { v: V3[]; f: Tri[] } {
  const hit = spheres.get(level);
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  let v: V3[] = ([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ] as V3[]).map((p) => norm(p));
  let f: Tri[] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        i = v.length;
        v = [...v, norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])];
        mid.set(key, i);
      }
      return i;
    };
    const next: Tri[] = [];
    for (const [a, b, c] of f) {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    f = next;
  }
  const out = { v, f };
  spheres.set(level, out);
  return out;
}

export interface PuffOptions {
  /** Center of the whole canopy; normals bend toward pointing away from it. */
  canopy?: V3;
  /** How much normals follow the canopy (0 = this puff only, 1 = canopy only). */
  bend?: number;
  /** Colors at the bottom and the top of the puff. */
  bottom: Color;
  top: Color;
  /** Lumpiness (0..0.3) and its seed. */
  lumps?: number;
  seed?: number;
  level?: number;
}

/** A soft rounded puff (foliage, shrubs, clouds of leaves). */
export function puff(mb: MeshBuilder, c: V3, r: V3, o: PuffOptions): void {
  const { v, f } = icosphere(o.level ?? 1);
  const lumps = o.lumps ?? 0.12;
  const seed = o.seed ?? 0;
  const bend = o.bend ?? 0.55;
  const pts: V3[] = [];
  const nrm: V3[] = [];
  const col: Color[] = [];
  for (const u of v) {
    const k = 1 + (wave(u, seed) - 0.5) * 2 * lumps;
    const p: V3 = [c[0] + u[0] * r[0] * k, c[1] + u[1] * r[1] * k, c[2] + u[2] * r[2] * k];
    pts.push(p);
    // Ellipsoid normal for the puff, bent toward the canopy-wide normal.
    const own = norm([u[0] / r[0], u[1] / r[1], u[2] / r[2]]);
    const cc = o.canopy ?? c;
    const whole = norm([p[0] - cc[0], (p[1] - cc[1]) * 0.8, p[2] - cc[2]]);
    nrm.push(norm([own[0] * (1 - bend) + whole[0] * bend, own[1] * (1 - bend) + whole[1] * bend, own[2] * (1 - bend) + whole[2] * bend]));
    const h = smooth((u[1] + 1) / 2) * 0.85 + (whole[1] + 1) * 0.075;
    col.push(o.bottom.clone().lerp(o.top, Math.min(1, h)).offsetHSL((wave(u, seed + 7) - 0.5) * 0.02, 0, (wave(u, seed + 3) - 0.5) * 0.05));
  }
  for (const [a, b, d] of f) mb.triSmooth(pts[a], pts[b], pts[d], nrm[a], nrm[b], nrm[d], col[a], col[b], col[d]);
}

/** A smooth-sided tapered column (trunk, post, cone when r1 = 0), darker at its base. */
export function column(mb: MeshBuilder, x: number, z: number, r0: number, r1: number, y0: number, y1: number, color: Color, sides = 8, cap = true): void {
  const base = color.clone().multiplyScalar(0.72);
  const slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * Math.PI * 2;
    const a1 = ((k + 1) / sides) * Math.PI * 2;
    const n0 = norm([Math.cos(a0), slope, Math.sin(a0)]);
    const n1 = norm([Math.cos(a1), slope, Math.sin(a1)]);
    const p00: V3 = [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0];
    const p10: V3 = [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0];
    const p01: V3 = [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1];
    const p11: V3 = [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1];
    // Counter-clockwise seen from outside.
    mb.triSmooth(p00, p01, p10, n0, n0, n1, base, color, base);
    if (r1 > 1e-4) mb.triSmooth(p10, p01, p11, n1, n0, n1, base, color, color);
    if (cap && r1 > 1e-4) mb.triSmooth([x, y1, z], p11, p01, [0, 1, 0], [0, 1, 0], [0, 1, 0], color);
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function norm(p: V3): V3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** Cheap smooth pseudo-random field on the unit sphere, 0..1. */
function wave(u: V3, seed: number): number {
  const s = Math.sin(u[0] * 3.1 + seed * 1.7) * Math.cos(u[1] * 2.7 - seed) + Math.sin(u[2] * 3.7 + seed * 0.3) * 0.6;
  return 0.5 + s * 0.3;
}
