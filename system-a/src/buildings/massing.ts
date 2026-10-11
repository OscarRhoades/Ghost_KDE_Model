/**
 * Massing: a building as a stack of volumes. Each volume is a plan polygon
 * extruded over a range of floors, optionally tapering or twisting floor by
 * floor. Shapes live in a catalog; a building's `shape` names one, otherwise
 * its style picks one that fits, using the building's seed.
 *
 * Facades, roofs, interiors and collision all read the same volumes, so what
 * you see from outside is what you walk through inside.
 */
import { Catalog } from "../catalog/registry";
import type { BuildingData } from "../engine/components";
import { area, centroid, insetConvex, quadPoint, rotated, type P2 } from "../geom/polygon";
import { rngFor, scaled, type Rng } from "./kit";

export type VolumeRole = "main" | "wing" | "podium" | "tower" | "upper";

export interface Volume {
  poly: P2[];
  /** Floors [f0, f1). */
  f0: number;
  f1: number;
  role: VolumeRole;
  /** Shrink by this fraction from bottom to top (tapering towers). */
  taper?: number;
  /** Rotation per floor in radians (twisting towers). */
  twist?: number;
}

export interface Massing {
  shape: string;
  volumes: Volume[];
}

export interface ShapeDef {
  /** Whether this shape suits the building's size and height. */
  fits(b: BuildingData, q: Quad): boolean;
  build(b: BuildingData, q: Quad, rng: Rng): Volume[];
}

export const shapeCatalog = new Catalog<ShapeDef>("massing shape");

/** The footprint as a quad with its long side first, plus its size. */
export interface Quad {
  q: P2[];
  /** Length along q0→q1 and across q0→q3. */
  U: number;
  V: number;
  /** Rectangle in (u, v) fractions. */
  sub(u0: number, v0: number, u1: number, v1: number): P2[];
  /** Polygon from (u, v) fractions. */
  poly(uv: [number, number][]): P2[];
}

export function quadOf(fp: readonly P2[]): Quad | null {
  if (fp.length !== 4) return null;
  const q = longFirst(fp);
  const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    q,
    U: (len(q[0], q[1]) + len(q[3], q[2])) / 2,
    V: (len(q[0], q[3]) + len(q[1], q[2])) / 2,
    sub: (u0, v0, u1, v1) => [quadPoint(q, u0, v0), quadPoint(q, u1, v0), quadPoint(q, u1, v1), quadPoint(q, u0, v1)],
    poly: (uv) => uv.map(([u, v]) => quadPoint(q, u, v)),
  };
}

/** Reorder a quad so its first edge is a long side. */
export function longFirst(fp: readonly P2[]): P2[] {
  const q = [...fp];
  if (q.length !== 4) return q;
  const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  return len(q[0], q[1]) >= len(q[1], q[2]) ? q : [q[1], q[2], q[3], q[0]];
}

export const isPitched = (b: BuildingData) => (b.roof === "gable" || b.roof === "hip") && b.footprint.length === 4;

const footprintOf = (b: BuildingData): P2[] => b.footprint.map((q) => [q[0], q[1]] as P2);
const all = (b: BuildingData, role: VolumeRole = "main"): Volume => ({ poly: footprintOf(b), f0: 0, f1: b.floors, role });
const minDim = (q: Quad) => Math.min(q.U, q.V);

// ---- Shapes -----------------------------------------------------------------

shapeCatalog.register("box", { fits: () => true, build: (b) => [all(b)] });

shapeCatalog.register("setback", {
  fits: (b, q) => b.floors >= 12 && minDim(q) >= 16,
  build(b, _q, rng) {
    const split = Math.round(b.floors * rng.range(0.55, 0.8));
    const upper = insetConvex(footprintOf(b), rng.range(2.5, 5));
    if (!upper) return [all(b)];
    return [{ ...all(b), f1: split }, { poly: upper, f0: split, f1: b.floors, role: "tower" }];
  },
});

shapeCatalog.register("podium-tower", {
  fits: (b, q) => b.floors >= 8 && minDim(q) >= 20,
  build(b, q, rng) {
    const p = Math.max(2, Math.min(4, Math.round(b.floors * 0.15)));
    const w = rng.range(0.5, 0.68);
    const d = rng.range(0.55, 0.75);
    const u0 = rng.range(0.1, 0.9 - w);
    const v0 = rng.range(0.1, 0.9 - d);
    return [
      { ...all(b, "podium"), f1: p },
      { poly: q.sub(u0, v0, u0 + w, v0 + d), f0: p, f1: b.floors, role: "tower" },
    ];
  },
});

shapeCatalog.register("stepped", {
  fits: (b, q) => b.floors >= 15 && minDim(q) >= 24,
  build(b, _q, rng) {
    const fp = footprintOf(b);
    const s1 = Math.round(b.floors * rng.range(0.4, 0.55));
    const s2 = Math.round(b.floors * rng.range(0.7, 0.82));
    const step = rng.range(2.5, 4);
    const t1 = insetConvex(fp, step);
    const t2 = insetConvex(fp, step * 2);
    if (!t1 || !t2) return [all(b)];
    return [
      { ...all(b), f1: s1 },
      { poly: t1, f0: s1, f1: s2, role: "tower" },
      { poly: t2, f0: s2, f1: b.floors, role: "tower" },
    ];
  },
});

shapeCatalog.register("tapered", {
  fits: (b, q) => b.floors >= 18 && minDim(q) >= 20,
  build: (b, _q, rng) => [{ ...all(b), taper: rng.range(0.2, 0.35) }],
});

shapeCatalog.register("twisted", {
  fits: (b, q) => b.floors >= 24 && minDim(q) >= 24,
  build(b, _q, rng) {
    // Shrink so the corners stay on the lot while it turns.
    const total = rng.range(0.6, 1.1) * (rng.chance(0.5) ? 1 : -1);
    return [{ poly: scaled(footprintOf(b), 0.74), f0: 0, f1: b.floors, role: "main", twist: total / b.floors }];
  },
});

shapeCatalog.register("chamfer", {
  fits: (_b, q) => minDim(q) >= 10,
  build(b, q, rng) {
    const c = Math.min(4, minDim(q) * rng.range(0.12, 0.2));
    const cu = c / q.U;
    const cv = c / q.V;
    return [{ ...all(b), poly: q.poly([[cu, 0], [1 - cu, 0], [1, cv], [1, 1 - cv], [1 - cu, 1], [cu, 1], [0, 1 - cv], [0, cv]]) }];
  },
});

/** Plan with the rectangle [u0,u1]x[v0,v1] cut away; it must touch the outline. */
function notchedPlan(q: Quad, cu: number, cv: number, corner: number): P2[] {
  // Corner order: 0 = (1,1), 1 = (0,1), 2 = (0,0), 3 = (1,0); notch size cu x cv.
  const uv: [number, number][][] = [
    [[0, 0], [1, 0], [1, 1 - cv], [1 - cu, 1 - cv], [1 - cu, 1], [0, 1]],
    [[0, 0], [1, 0], [1, 1], [cu, 1], [cu, 1 - cv], [0, 1 - cv]],
    [[cu, 0], [1, 0], [1, 1], [0, 1], [0, cv], [cu, cv]],
    [[0, 0], [1 - cu, 0], [1 - cu, cv], [1, cv], [1, 1], [0, 1]],
  ];
  return q.poly(uv[corner % 4]);
}

shapeCatalog.register("notched", {
  fits: (_b, q) => minDim(q) >= 14,
  build: (b, q, rng) => [{ ...all(b), poly: notchedPlan(q, rng.range(0.22, 0.32), rng.range(0.22, 0.32), Math.floor(rng.next() * 4)) }],
});

shapeCatalog.register("l-plan", {
  fits: (_b, q) => q.U >= 18 && q.V >= 14,
  build: (b, q, rng) => [{ ...all(b), poly: notchedPlan(q, rng.range(0.42, 0.55), rng.range(0.42, 0.55), Math.floor(rng.next() * 4)) }],
});

shapeCatalog.register("u-plan", {
  fits: (_b, q) => q.U >= 24 && q.V >= 16,
  build(b, q, rng) {
    const a = rng.range(0.3, 0.36);
    const d = rng.range(0.4, 0.55);
    // Courtyard opening on the back side (v = 1).
    return [{ ...all(b), poly: q.poly([[0, 0], [1, 0], [1, 1], [1 - a, 1], [1 - a, 1 - d], [a, 1 - d], [a, 1], [0, 1]]) }];
  },
});

shapeCatalog.register("courtyard", {
  fits: (_b, q) => q.U >= 32 && q.V >= 30,
  build(b, q) {
    const du = Math.min(12, q.U * 0.3) / q.U;
    const dv = Math.min(12, q.V * 0.3) / q.V;
    return [
      { poly: q.sub(0, 0, 1, dv), f0: 0, f1: b.floors, role: "main" },
      { poly: q.sub(0, 1 - dv, 1, 1), f0: 0, f1: b.floors, role: "wing" },
      { poly: q.sub(0, dv, du, 1 - dv), f0: 0, f1: b.floors, role: "wing" },
      { poly: q.sub(1 - du, dv, 1, 1 - dv), f0: 0, f1: b.floors, role: "wing" },
    ];
  },
});

shapeCatalog.register("terrace-steps", {
  fits: (b, q) => b.floors >= 4 && q.V >= 12,
  build(b, q, rng) {
    // Top floors step back from the front, leaving roof terraces.
    const steps = Math.min(3, b.floors - 2);
    const out: Volume[] = [{ ...all(b), f1: b.floors - steps }];
    const depth = rng.range(0.12, 0.18);
    for (let i = 1; i <= steps; i++) out.push({ poly: q.sub(0, depth * i, 1, 1), f0: b.floors - steps + i - 1, f1: b.floors - steps + i, role: "main" });
    return out;
  },
});

shapeCatalog.register("overhang", {
  fits: (b, q) => b.floors >= 3 && minDim(q) >= 12,
  build(b, _q, rng) {
    // A recessed glazed ground floor under the full-width upper floors.
    const base = insetConvex(footprintOf(b), rng.range(1.5, 2.5));
    if (!base) return [all(b)];
    return [{ poly: base, f0: 0, f1: 1, role: "main" }, { ...all(b, "upper"), f0: 1 }];
  },
});

shapeCatalog.register("house-modern", {
  fits: (b) => b.floors >= 2,
  build(b, q, rng) {
    // Narrower upper box pushed to the back and cantilevered past one end.
    const shift = rng.range(1.5, 3);
    const u0 = shift / q.U - 0.05;
    const u1 = 1 + shift / q.U - 0.25;
    const v0 = rng.range(0.3, 0.45);
    return [{ ...all(b), f1: 1 }, { poly: q.sub(u0, v0, u1, 1), f0: 1, f1: b.floors, role: "upper" }];
  },
});

shapeCatalog.register("house-l", {
  fits: (_b, q) => q.U >= 10 && q.V >= 8,
  build(b, q, rng) {
    const plan = notchedPlan(q, rng.range(0.35, 0.45), rng.range(0.4, 0.5), rng.chance(0.5) ? 0 : 1);
    if (b.floors < 2) return [{ ...all(b), poly: plan }];
    // Upper floor over the long arm only.
    return [{ ...all(b), poly: plan, f1: 1 }, { poly: q.sub(0, 0, 1, rng.range(0.45, 0.55)), f0: 1, f1: b.floors, role: "upper" }];
  },
});

// ---- Choosing and querying ----------------------------------------------------

/** Shapes each style may use, with weights. Styles not listed use "box". */
const STYLE_SHAPES: Record<string, [string, number][]> = {
  "glass-tower": [["box", 1], ["setback", 2], ["podium-tower", 2], ["stepped", 1.2], ["tapered", 0.8], ["chamfer", 1], ["twisted", 0.35]],
  office: [["box", 2], ["chamfer", 1], ["notched", 1], ["l-plan", 0.8], ["overhang", 1], ["podium-tower", 0.8], ["setback", 0.5]],
  default: [["box", 2], ["chamfer", 1], ["overhang", 1]],
  apartment: [["box", 1.5], ["l-plan", 1], ["u-plan", 0.8], ["courtyard", 0.8], ["notched", 1], ["terrace-steps", 1.2], ["chamfer", 0.6], ["overhang", 0.6]],
  "brick-midrise": [["box", 2], ["l-plan", 1], ["u-plan", 0.6], ["courtyard", 0.6], ["notched", 0.8], ["terrace-steps", 0.6]],
  "suburban-house": [["house-modern", 2], ["house-l", 1], ["box", 0.5]],
  industrial: [["box", 1]],
  civic: [["box", 1]],
};

const cache = new WeakMap<BuildingData, Massing>();

/** The volumes of a building. Deterministic; cached per building. */
export function massingOf(b: BuildingData): Massing {
  const hit = cache.get(b);
  if (hit) return hit;
  const q = quadOf(b.footprint);
  const rng = rngFor(b.seed ^ 0x3a55);
  let name = "box";
  if (q) {
    if (b.shape && shapeCatalog.has(b.shape) && shapeCatalog.require(b.shape).fits(b, q)) {
      name = b.shape;
    } else if (b.style === "suburban-house" && (b.roof === "gable" || b.roof === "hip")) {
      name = "box";
    } else {
      const options = (STYLE_SHAPES[b.style] ?? [["box", 1]]).filter(([n]) => shapeCatalog.has(n) && shapeCatalog.require(n).fits(b, q));
      const total = options.reduce((s, [, w]) => s + w, 0);
      let r = rng.next() * total;
      for (const [n, w] of options) {
        r -= w;
        if (r < 0) {
          name = n;
          break;
        }
      }
    }
  }
  const volumes = q ? shapeCatalog.require(name).build(b, q, rng) : [all(b)];
  const m = { shape: name, volumes };
  cache.set(b, m);
  return m;
}

/** A volume's plan at floor f (accounting for taper and twist). */
export function planAt(v: Volume, f: number): P2[] {
  if (!v.taper && !v.twist) return v.poly;
  let poly = v.poly;
  const span = Math.max(1, v.f1 - v.f0);
  if (v.taper) poly = scaled(poly, 1 - v.taper * ((f - v.f0) / span));
  if (v.twist) {
    const [cx, cz] = centroid(poly);
    poly = rotated(poly, v.twist * (f - v.f0), cx, cz);
  }
  return poly;
}

/** Volumes present on floor f. */
export const volumesAt = (m: Massing, f: number) => m.volumes.filter((v) => f >= v.f0 && f < v.f1);

/** Floors you can walk on: industrial halls and the town hall lobby are one tall space. */
export function interiorFloors(b: BuildingData): number {
  return b.style === "industrial" || b.style === "civic" ? 1 : b.floors;
}

/** Height of one walkable floor. */
export function interiorFloorHeight(b: BuildingData): number {
  if (b.style === "industrial") return b.floors * b.floorHeight;
  if (b.style === "civic") return b.floorHeight * 1.4; // double-height lobby, matching the facade
  return b.floorHeight;
}

/**
 * Outer wall of the walkable part of floor f: the main volume on that floor
 * (courtyard wings and other secondary volumes are closed off).
 */
export function shellOf(b: BuildingData, f: number): P2[] {
  if (b.style === "civic" && f === 0) return insetConvex(footprintOf(b), 3) ?? footprintOf(b);
  const vs = volumesAt(massingOf(b), f);
  const v = vs.find((x) => x.role !== "wing") ?? vs[0];
  return v ? planAt(v, f) : footprintOf(b);
}

/** Ground-level plans that block walking (every volume touching the ground). */
export function groundPlans(b: BuildingData): P2[][] {
  if (b.style === "civic") return [shellOf(b, 0)];
  return massingOf(b).volumes.filter((v) => v.f0 === 0).map((v) => planAt(v, 0));
}

/** Total plan area of a building's ground floor (for sanity checks). */
export const groundArea = (b: BuildingData) => groundPlans(b).reduce((s, p) => s + area(p), 0);
