/**
 * Building shape decisions shared by the facade styles and the interiors:
 * tower setbacks, the house's upper box and the outer wall ("shell") of each
 * floor. Each uses its own seeded stream so both sides always agree.
 */
import type { BuildingData } from "../engine/components";
import { insetConvex, quadPoint, type P2 } from "../geom/polygon";
import { rngFor } from "./kit";

/** Salts so each decision draws from its own random stream. */
const SALT = { tower: 0x7a11, house: 0x4053 };

export interface TowerSection {
  poly: P2[];
  f0: number;
  f1: number;
}

const footprintOf = (b: BuildingData): P2[] => b.footprint.map((q) => [q[0], q[1]] as P2);

/** Tall towers split into a base and an inset upper section (setback). */
export function towerSections(b: BuildingData): TowerSection[] {
  const rng = rngFor(b.seed ^ SALT.tower);
  const fp = footprintOf(b);
  if (b.floors >= 20 && rng.chance(0.75)) {
    const split = Math.round(b.floors * rng.range(0.55, 0.8));
    const upper = insetConvex(fp, rng.range(2.5, 5));
    if (upper) return [{ poly: fp, f0: 0, f1: split }, { poly: upper, f0: split, f1: b.floors }];
  }
  return [{ poly: fp, f0: 0, f1: b.floors }];
}

/** Reorder a quad so its first edge is a long side. */
export function longFirst(fp: readonly P2[]): P2[] {
  const q = [...fp];
  if (q.length !== 4) return q;
  const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  return len(q[0], q[1]) >= len(q[1], q[2]) ? q : [q[1], q[2], q[3], q[0]];
}

export const isPitched = (b: BuildingData) => (b.roof === "gable" || b.roof === "hip") && b.footprint.length === 4;

/**
 * A modern house's upper floors: a narrower box pushed to the back and
 * cantilevered past one end. In the quad's (u, v) coordinates.
 */
export function houseUpper(b: BuildingData): { u0: number; u1: number; v0: number; poly: P2[] } | null {
  if (b.style !== "suburban-house" || isPitched(b) || b.floors < 2 || b.footprint.length !== 4) return null;
  const rng = rngFor(b.seed ^ SALT.house);
  const q = longFirst(b.footprint);
  const len = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) || 1;
  const shift = rng.range(1.5, 3);
  const u0 = shift / len - 0.05;
  const u1 = 1 + shift / len - 0.25;
  const v0 = rng.range(0.3, 0.45);
  return { u0, u1, v0, poly: [quadPoint(q, u0, v0), quadPoint(q, u1, v0), quadPoint(q, u1, 1), quadPoint(q, u0, 1)] };
}

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

/** Outer wall polygon of floor `f` (what you are enclosed by on that floor). */
export function shellOf(b: BuildingData, f: number): P2[] {
  const fp = footprintOf(b);
  if (b.style === "civic" && f === 0) return insetConvex(fp, 3) ?? fp;
  if (b.style === "glass-tower") {
    const sec = towerSections(b).find((s) => f >= s.f0 && f < s.f1);
    return sec ? sec.poly : fp;
  }
  if (f >= 1) {
    const up = houseUpper(b);
    if (up) return up.poly;
  }
  return fp;
}
