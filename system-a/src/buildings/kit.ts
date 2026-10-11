/**
 * Facade toolkit: the vocabulary building styles are written in.
 *
 * A footprint is broken into `Edge`s, each with a tangent and an outward
 * normal. Everything on a facade is placed in edge space: `s` meters along the
 * edge, `y` meters up, `out` meters in front of the wall plane.
 */
import { Color, ShapeUtils, Vector2 } from "three";
import type { Entrance } from "../engine/components";
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
  // Clockwise in x/z, so the outside is always to the left of each edge;
  // this holds for concave plans (L, U) where a centroid test would not.
  const fp = signedArea(poly) > 0 ? [...poly].reverse() : [...poly];
  const out: Edge[] = [];
  for (let k = 0; k < fp.length; k++) {
    const a = fp[k];
    const b = fp[(k + 1) % fp.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    out.push({ a, b, len, tx, tz, nx: -tz, nz: tx });
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

/** Where a doorway crosses this edge, in edge space; null if it is on another edge. */
export function doorOn(e: Edge, door?: Entrance): { s0: number; s1: number; top: number } | null {
  if (!door) return null;
  const dx = door.x - e.a[0];
  const dz = door.z - e.a[1];
  if (Math.abs(dx * e.nx + dz * e.nz) > 0.3) return null;
  const s = dx * e.tx + dz * e.tz;
  if (s < 0 || s > e.len) return null;
  return { s0: s - door.width / 2, s1: s + door.width / 2, top: door.y + door.height };
}

/** Whether the rectangle s0..s1 (from height y0 up) on this edge overlaps the doorway. */
export function hitsDoor(e: Edge, s0: number, s1: number, y0: number, door?: Entrance): boolean {
  const d = doorOn(e, door);
  return !!d && s1 > d.s0 - 0.2 && s0 < d.s1 + 0.2 && y0 < d.top;
}

/** Like `panel`, but leaves the doorway open. */
export function panelAround(
  mb: MeshBuilder,
  e: Edge,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  out: number,
  c: Color,
  door?: Entrance,
) {
  const d = doorOn(e, door);
  if (!d || d.s1 <= s0 || d.s0 >= s1 || d.top <= y0) return panel(mb, e, s0, s1, y0, y1, out, c);
  if (d.s0 > s0) panel(mb, e, s0, d.s0, y0, y1, out, c);
  if (d.s1 < s1) panel(mb, e, d.s1, s1, y0, y1, out, c);
  if (d.top < y1) panel(mb, e, Math.max(s0, d.s0), Math.min(s1, d.s1), d.top, y1, out, c);
}

/** A slim frame around the doorway on whichever edge holds it. */
export function doorFrame(mb: MeshBuilder, edges: Edge[], door: Entrance | undefined, c: Color) {
  for (const e of edges) {
    const d = doorOn(e, door);
    if (!d) continue;
    box(mb, e, d.s0 - 0.12, d.s0, door!.y, d.top, -0.05, 0.12, c);
    box(mb, e, d.s1, d.s1 + 0.12, door!.y, d.top, -0.05, 0.12, c);
    box(mb, e, d.s0 - 0.12, d.s1 + 0.12, d.top, d.top + 0.12, -0.05, 0.12, c);
  }
}

/** A horizontal band wrapping the whole perimeter (slab edge, cornice, parapet). */
export function band(mb: MeshBuilder, edges: Edge[], y0: number, y1: number, out: number, c: Color, inset = 0) {
  for (const e of edges) box(mb, e, -out, e.len + out, y0, y1, -inset, out, c);
}

/** Vertical walls of a prism from y0 to y1 (no caps), leaving `door` open if given. */
export function walls(mb: MeshBuilder, edges: Edge[], y0: number, y1: number, c: Color, out = 0, door?: Entrance) {
  for (const e of edges) panelAround(mb, e, 0, e.len, y0, y1, out, c, door);
}

/** A horizontal polygon at height y, facing up (or down with `down`), with optional holes. */
export function cap(mb: MeshBuilder, poly: readonly P2[], y: number, c: Color, down = false, holes: readonly (readonly P2[])[] = []) {
  const ring = (pts: readonly P2[], ccw: boolean) => {
    const v = pts.map(([x, z]) => new Vector2(x, z));
    return ShapeUtils.isClockWise(v) === ccw ? v.reverse() : v;
  };
  const contour = ring(poly, true);
  const holeRings = holes.map((h) => ring(h, false));
  const all = [...contour, ...holeRings.flat()];
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, holeRings)) {
    mb.triFacing([all[i].x, y, all[i].y], [all[j].x, y, all[j].y], [all[k].x, y, all[k].y], [0, down ? -1 : 1, 0], c);
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

/** Index of the longest edge. */
export function longestEdge(edges: Edge[]): number {
  let best = 0;
  for (let k = 1; k < edges.length; k++) if (edges[k].len > edges[best].len) best = k;
  return best;
}

/** Index of the edge holding the front door, or the longest edge if there is none. */
export function frontEdge(edges: Edge[], door?: Entrance): number {
  const k = edges.findIndex((e) => doorOn(e, door));
  return k >= 0 ? k : longestEdge(edges);
}
