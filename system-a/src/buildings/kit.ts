/**
 * Facade toolkit: the vocabulary building styles are written in.
 *
 * A footprint is broken into `Edge`s, each with a tangent and an outward
 * normal. Everything on a facade is placed in edge space: `s` meters along the
 * edge, `y` meters up, `out` meters in front of the wall plane.
 */
import { Color, ShapeUtils, Vector2 } from "three";
import { centroid, signedArea, type P2 } from "../geom/polygon";
import { MeshBuilder, type V3 } from "../render/meshBuilder";

/** Material slots. Each becomes one merged mesh per tile. */
export type Slot = "matte" | "glass" | "metal";
export type Parts = Record<Slot, MeshBuilder>;

export function newParts(): Parts {
  return { matte: new MeshBuilder(), glass: new MeshBuilder(), metal: new MeshBuilder() };
}

export interface Edge {
  a: P2;
  b: P2;
  len: number;
  /** Unit tangent a → b. */
  tx: number;
  tz: number;
  /** Unit outward normal. */
  nx: number;
  nz: number;
}

/** Edges of a polygon with outward normals, in a consistent (clockwise in x/z) order. */
export function edgesOf(poly: readonly P2[]): Edge[] {
  const fp = signedArea(poly) > 0 ? [...poly].reverse() : [...poly];
  const [cx, cz] = centroid(fp);
  const out: Edge[] = [];
  for (let k = 0; k < fp.length; k++) {
    const a = fp[k];
    const b = fp[(k + 1) % fp.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    let nx = -tz;
    let nz = tx;
    const mx = (a[0] + b[0]) / 2 - cx;
    const mz = (a[1] + b[1]) / 2 - cz;
    if (mx * nx + mz * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    out.push({ a, b, len, tx, tz, nx, nz });
  }
  return out;
}

/** World point at (s along, y up, out in front) of an edge. */
export function at(e: Edge, s: number, y: number, out = 0): V3 {
  return [e.a[0] + e.tx * s + e.nx * out, y, e.a[1] + e.tz * s + e.nz * out];
}

const normalOf = (e: Edge): V3 => [e.nx, 0, e.nz];

/** A flat rectangle on the facade plane (offset `out`), facing outward. */
export function panel(mb: MeshBuilder, e: Edge, s0: number, s1: number, y0: number, y1: number, out: number, c: Color) {
  mb.quadFacing(at(e, s0, y0, out), at(e, s1, y0, out), at(e, s1, y1, out), at(e, s0, y1, out), normalOf(e), c);
}

/**
 * A box sitting on the facade: spans s0..s1 along the edge, y0..y1 up, and
 * out0..out1 in front of the wall. Draws the five visible faces.
 */
export function box(
  mb: MeshBuilder,
  e: Edge,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  out0: number,
  out1: number,
  c: Color,
) {
  const p = (s: number, y: number, o: number) => at(e, s, y, o);
  const n = normalOf(e);
  const t: V3 = [e.tx, 0, e.tz];
  const mt: V3 = [-e.tx, 0, -e.tz];
  mb.quadFacing(p(s0, y0, out1), p(s1, y0, out1), p(s1, y1, out1), p(s0, y1, out1), n, c); // front
  mb.quadFacing(p(s0, y1, out0), p(s1, y1, out0), p(s1, y1, out1), p(s0, y1, out1), [0, 1, 0], c); // top
  mb.quadFacing(p(s0, y0, out0), p(s1, y0, out0), p(s1, y0, out1), p(s0, y0, out1), [0, -1, 0], c); // bottom
  mb.quadFacing(p(s0, y0, out0), p(s0, y0, out1), p(s0, y1, out1), p(s0, y1, out0), mt, c); // start side
  mb.quadFacing(p(s1, y0, out0), p(s1, y0, out1), p(s1, y1, out1), p(s1, y1, out0), t, c); // end side
}

/** A horizontal band wrapping the whole perimeter (slab edge, cornice, parapet). */
export function band(mb: MeshBuilder, edges: Edge[], y0: number, y1: number, out: number, c: Color, inset = 0) {
  for (const e of edges) box(mb, e, -out, e.len + out, y0, y1, -inset, out, c);
}

/** Vertical walls of a prism from y0 to y1 (no caps). */
export function walls(mb: MeshBuilder, edges: Edge[], y0: number, y1: number, c: Color, out = 0) {
  for (const e of edges) panel(mb, e, 0, e.len, y0, y1, out, c);
}

/** A horizontal polygon at height y, facing up (or down with `down`). */
export function cap(mb: MeshBuilder, poly: readonly P2[], y: number, c: Color, down = false) {
  const contour = poly.map(([x, z]) => new Vector2(x, z));
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
    mb.triFacing([poly[i][0], y, poly[i][1]], [poly[j][0], y, poly[j][1]], [poly[k][0], y, poly[k][1]], [0, down ? -1 : 1, 0], c);
  }
}

/** A closed prism (walls + top). */
export function prism(mb: MeshBuilder, poly: readonly P2[], y0: number, y1: number, c: Color, roof?: Color) {
  walls(mb, edgesOf(poly), y0, y1, c);
  cap(mb, poly, y1, roof ?? c);
}

/** Evenly divide `len` into bays close to `target` wide; returns bay boundaries. */
export function bays(len: number, target: number, margin = 0): number[] {
  const usable = Math.max(0, len - 2 * margin);
  const n = Math.max(1, Math.round(usable / target));
  return Array.from({ length: n + 1 }, (_, k) => margin + (usable * k) / n);
}

/** Polygon scaled about its centroid. */
export function scaled(poly: readonly P2[], f: number): P2[] {
  const [cx, cz] = centroid(poly);
  return poly.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f] as const);
}

/** Deterministic per-building randomness. */
export function rngFor(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}
export type Rng = ReturnType<typeof rngFor>;

/** Index of the longest edge (a proxy for the street front). */
export function longestEdge(edges: Edge[]): number {
  let best = 0;
  for (let k = 1; k < edges.length; k++) if (edges[k].len > edges[best].len) best = k;
  return best;
}
