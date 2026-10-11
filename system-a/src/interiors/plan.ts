/**
 * Interior floor plans, generated from a building's parameters and seed.
 *
 * Plans are laid out in a local frame on the ground footprint (x along the
 * long side, y across, in meters) and mapped to world coordinates, so they
 * follow slightly skewed lots. Everything returned is in world space.
 *
 * Floors connect through one switchback stair: two lanes side by side. Lane A
 * climbs the first half storey from the open end to the far end; lane B
 * climbs the second half back to the open end, which is the next floor.
 */
import { rngFor } from "../buildings/kit";
import { houseUpper, interiorFloorHeight, interiorFloors, longFirst, shellOf } from "../buildings/shape";
import type { BuildingData } from "../engine/components";
import { pointInPolygon, quadPoint, type P2 } from "../geom/polygon";

export type RoomKind = "lobby" | "shop" | "office" | "living" | "kitchen" | "bedroom" | "hall" | "warehouse";

export interface Wall {
  a: P2;
  b: P2;
  /** Absolute heights. Pieces starting well above the floor (lintels) don't block walking. */
  y0: number;
  y1: number;
}

export interface Furniture {
  poly: P2[];
  y0: number;
  y1: number;
  color: number;
}

export interface Room {
  poly: P2[];
  kind: RoomKind;
}

export interface Stair {
  /** World corner at the open end, lane A side. */
  o: P2;
  /** Vector from the open end to the far end. */
  run: P2;
  /** Vector from the lane A side to the lane B side. */
  across: P2;
}

export interface FloorPlan {
  index: number;
  /** Floor surface elevation. */
  y: number;
  /** Ceiling elevation. */
  ceiling: number;
  shell: P2[];
  walls: Wall[];
  rooms: Room[];
  furniture: Furniture[];
  /** Ceiling light positions. */
  lights: P2[];
}

export type Glazing = "full" | "punched" | "solid";

export interface BuildingPlan {
  floors: FloorPlan[];
  stair: Stair | null;
  baseY: number;
  floorHeight: number;
  glazing: Glazing;
  floorColor: number;
  wallColor: number;
}

/** Slab thickness between a ceiling and the floor above. */
export const SLAB = 0.3;
const DOOR_W = 0.95;
const DOOR_H = 2.15;

/** Local metric frame on a quad footprint. */
class Frame {
  readonly U: number;
  readonly V: number;
  constructor(readonly q: P2[]) {
    const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.U = (len(q[0], q[1]) + len(q[3], q[2])) / 2;
    this.V = (len(q[0], q[3]) + len(q[1], q[2])) / 2;
  }
  w(x: number, y: number): P2 {
    return quadPoint(this.q, x / this.U, y / this.V);
  }
  rect(x0: number, y0: number, x1: number, y1: number): P2[] {
    return [this.w(x0, y0), this.w(x1, y0), this.w(x1, y1), this.w(x0, y1)];
  }
}

interface LocalStair {
  /** Open-end corner on the lane A side, run direction and across direction (unit axes). */
  ox: number;
  oy: number;
  rx: number;
  ry: number;
  ax: number;
  ay: number;
  run: number;
  width: number;
}

const stairRect = (s: LocalStair): [number, number, number, number] => {
  const xs = [s.ox, s.ox + s.rx * s.run + s.ax * s.width];
  const ys = [s.oy, s.oy + s.ry * s.run + s.ay * s.width];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Builder for one floor's walls, rooms and furniture in local coordinates. */
class FloorBuilder {
  walls: Wall[] = [];
  rooms: Room[] = [];
  furniture: Furniture[] = [];
  lights: P2[] = [];
  constructor(
    readonly f: Frame,
    readonly y: number,
    readonly ceiling: number,
    readonly shell: P2[],
  ) {}

  /** A straight wall from (x0,y0) to (x1,y1) with door gaps at the given offsets along it. */
  wall(x0: number, y0: number, x1: number, y1: number, doors: number[] = [], height?: number) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.2) return;
    const at = (t: number): P2 => this.f.w(x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len);
    const top = height === undefined ? this.ceiling : this.y + height;
    let cursor = 0;
    for (const d of [...doors].sort((a, b) => a - b)) {
      const s0 = Math.max(0, d - DOOR_W / 2);
      const s1 = Math.min(len, d + DOOR_W / 2);
      if (s0 > cursor) this.walls.push({ a: at(cursor), b: at(s0), y0: this.y, y1: top });
      if (top > this.y + DOOR_H) this.walls.push({ a: at(s0), b: at(s1), y0: this.y + DOOR_H, y1: top });
      cursor = s1;
    }
    if (cursor < len) this.walls.push({ a: at(cursor), b: at(len), y0: this.y, y1: top });
  }

  room(x0: number, y0: number, x1: number, y1: number, kind: RoomKind) {
    this.rooms.push({ poly: this.f.rect(x0, y0, x1, y1), kind });
    this.lights.push(this.f.w((x0 + x1) / 2, (y0 + y1) / 2));
  }

  /** A furniture box if it sits fully inside this floor's shell. */
  box(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, color: number) {
    const poly = this.f.rect(x0, y0, x1, y1);
    if (!poly.every(([x, z]) => pointInPolygon(x, z, this.shell))) return;
    this.furniture.push({ poly, y0: this.y + h0, y1: this.y + h1, color });
  }

  finish(index: number): FloorPlan {
    return {
      index,
      y: this.y,
      ceiling: this.ceiling,
      shell: this.shell,
      walls: this.walls,
      rooms: this.rooms,
      furniture: this.furniture,
      lights: this.lights,
    };
  }
}

const C = {
  desk: 0xe8e4dc,
  deskTop: 0xd9cdb8,
  sofa: 0x5b6670,
  rug: 0xc9b89a,
  wood: 0xa57b54,
  bed: 0xf1eee8,
  counter: 0xdedad2,
  rack: 0x4f6f8f,
  crate: 0xb48a5a,
  bench: 0x8a7a66,
  reception: 0x2f3438,
  shelf: 0xcfc8bb,
};

function stairWalls(fb: FloorBuilder, s: LocalStair, index: number, floors: number) {
  const P = (r: number, w: number): [number, number] => [s.ox + s.rx * r * s.run + s.ax * w * s.width, s.oy + s.ry * r * s.run + s.ay * w * s.width];
  const seg = (a: [number, number], b: [number, number], doors: number[] = [], h?: number) => fb.wall(a[0], a[1], b[0], b[1], doors, h);
  seg(P(0, 0), P(1, 0));
  seg(P(0, 1), P(1, 1));
  seg(P(1, 0), P(1, 1));
  seg(P(0, 0.5), P(0.78, 0.5), [], 1.1); // divider rail between the lanes
  // Railings across the lane that leads nowhere: down from the ground floor, up from the top floor.
  if (index === 0) seg(P(0, 0.5), P(0, 1), [], 1.1);
  if (index === floors - 1) seg(P(0, 0), P(0, 0.5), [], 1.1);
}

function officeDesks(fb: FloorBuilder, f: Frame, avoid: [number, number, number, number] | null) {
  for (let y = 2; y + 1 < f.V - 1.5; y += 3.2) {
    for (let x = 2; x + 1.6 < f.U - 1.5; x += 2.4) {
      if (avoid && x + 1.6 > avoid[0] - 1.5 && x < avoid[2] + 1.5 && y + 0.8 > avoid[1] - 1.5 && y < avoid[3] + 1.5) continue;
      fb.box(x, y, x + 1.6, y + 0.8, 0.7, 0.76, C.deskTop);
      fb.box(x + 0.05, y + 0.05, x + 0.15, y + 0.75, 0, 0.7, C.desk);
      fb.box(x + 1.45, y + 0.05, x + 1.55, y + 0.75, 0, 0.7, C.desk);
    }
  }
}

function living(fb: FloorBuilder, x0: number, y0: number, x1: number, y1: number) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  fb.box(cx - 1.5, cy - 1.0, cx + 1.5, cy + 1.0, 0, 0.02, C.rug);
  fb.box(cx - 1.1, y1 - 1.3, cx + 1.1, y1 - 0.4, 0, 0.75, C.sofa);
  fb.box(cx - 0.5, cy - 0.3, cx + 0.5, cy + 0.3, 0, 0.4, C.wood);
}

function bedroom(fb: FloorBuilder, x0: number, y0: number, x1: number) {
  const cx = (x0 + x1) / 2;
  fb.box(cx - 0.8, y0 + 0.3, cx + 0.8, y0 + 2.3, 0, 0.5, C.bed);
  fb.box(cx - 0.8, y0 + 0.2, cx + 0.8, y0 + 0.3, 0, 1.0, C.wood);
  fb.box(cx + 1.0, y0 + 0.3, cx + 1.5, y0 + 0.8, 0, 0.5, C.wood);
}

/** Generate the full plan for a building. Deterministic per seed. */
export function planBuilding(b: BuildingData): BuildingPlan {
  const rng = rngFor(b.seed ^ 0x1a7e);
  const n = interiorFloors(b);
  const fh = interiorFloorHeight(b);
  const quad = b.footprint.length === 4 ? new Frame(longFirst(b.footprint)) : null;
  const house = b.style === "suburban-house";
  const residential = house || b.style === "apartment" || b.style === "brick-midrise";
  const plan: BuildingPlan = {
    floors: [],
    stair: null,
    baseY: b.baseY,
    floorHeight: fh,
    glazing: b.style === "glass-tower" || b.style === "office" || b.style === "civic" || b.style === "default" ? "full" : b.style === "industrial" ? "solid" : "punched",
    floorColor: residential ? 0xc49a6c : b.style === "civic" ? 0xd9d3c6 : 0xb8b5ae,
    wallColor: 0xf0eee9,
  };

  // ---- Stair placement (local frame) ----
  let ls: LocalStair | null = null;
  if (quad && n >= 2) {
    const { U, V } = quad;
    if (house) {
      const up = houseUpper(b);
      const xs = Math.max(0.4, (up ? up.u0 * U : 0) + 0.4);
      const run = 3.6;
      if (xs + run + 1.5 < U && V > 5) ls = { ox: xs + run, oy: V - 0.3 - 2.0, rx: -1, ry: 0, ax: 0, ay: 1, run, width: 2.0 };
    } else if (b.style === "apartment" || b.style === "brick-midrise") {
      const run = Math.min(5.2, V / 2 - 0.9 - 0.6);
      if (run >= 3 && U > 8) ls = { ox: U / 2 - 1.4, oy: V / 2 + 0.9, rx: 0, ry: 1, ax: 1, ay: 0, run, width: 2.8 };
    } else if (U > 8 && V > 8) {
      const run = Math.min(5.2, V - 5);
      ls = { ox: U / 2 - 1.4, oy: V / 2 - run / 2, rx: 0, ry: 1, ax: 1, ay: 0, run, width: 2.8 };
    }
  }
  if (quad && ls) {
    const o = quad.w(ls.ox, ls.oy);
    const r = quad.w(ls.ox + ls.rx * ls.run, ls.oy + ls.ry * ls.run);
    const a = quad.w(ls.ox + ls.ax * ls.width, ls.oy + ls.ay * ls.width);
    plan.stair = { o, run: [r[0] - o[0], r[1] - o[1]], across: [a[0] - o[0], a[1] - o[1]] };
  }
  const sr = ls ? stairRect(ls) : null;

  for (let f = 0; f < n; f++) {
    const y = b.baseY + f * fh + 0.05;
    const ceiling = b.baseY + (f + 1) * fh - SLAB;
    const shell = shellOf(b, f);
    const fb = new FloorBuilder(quad ?? new Frame([shell[0], shell[1], shell[2], shell[shell.length - 1]]), y, ceiling, shell);
    if (quad && ls) stairWalls(fb, ls, f, n);

    if (!quad) {
      plan.floors.push(fb.finish(f));
      continue;
    }
    const { U, V } = quad;

    if (house) {
      const up = f >= 1 ? houseUpper(b) : null;
      const x0 = up ? Math.max(0, up.u0 * U) : 0;
      const x1 = up ? Math.min(U * 1.2, up.u1 * U) : U;
      const y0 = up ? up.v0 * V : 0;
      const xp = ls ? ls.ox + 1.4 : U * 0.4;
      if (f === 0) {
        if (U - xp > 3.5) {
          fb.wall(xp, 0, xp, V, [V * 0.3 + 0.6]);
          fb.room(0, 0, xp, V, "kitchen");
          fb.room(xp, 0, U, V, "living");
          fb.box(0.3, 0.3, Math.min(3.6, xp - 0.3), 0.9, 0, 0.92, C.counter);
          fb.box(0.8, 1.8, Math.min(2.8, xp - 0.8), 2.7, 0, 0.92, C.counter);
          living(fb, xp, 0, U, V);
        } else {
          fb.room(0, 0, U, V, "living");
          living(fb, 0, 0, U, V);
        }
      } else {
        const xb = Math.max(xp, x0 + 2);
        if (x1 - xb > 3) {
          fb.wall(xb, y0, xb, V, [y0 + 0.9]);
          fb.room(x0, y0, xb, V, "hall");
          if (x1 - xb > 7.5) {
            const xm = (xb + x1) / 2;
            fb.wall(xm, y0, xm, V, [y0 + 0.9]);
            fb.room(xb, y0, xm, V, "bedroom");
            fb.room(xm, y0, x1, V, "bedroom");
            bedroom(fb, xb, y0, xm);
            bedroom(fb, xm, y0, x1);
          } else {
            fb.room(xb, y0, x1, V, "bedroom");
            bedroom(fb, xb, y0, x1);
          }
        } else {
          fb.room(x0, y0, x1, V, "bedroom");
        }
      }
    } else if (b.style === "apartment" || b.style === "brick-midrise") {
      if (f === 0) {
        const kind: RoomKind = b.style === "brick-midrise" ? "shop" : "lobby";
        fb.room(0, 0, U, V, kind);
        if (kind === "shop") {
          for (let x = 2.5; x + 1.2 < U - 2; x += 3.6) for (let y = 2; y + 1.2 < V / 2 - 0.5; y += 3.4) fb.box(x, y, x + 1.2, y + 1.2, 0, 0.9, C.shelf);
          fb.box(1, V - 2.2, 4, V - 1.4, 0, 1.0, C.counter);
        } else {
          fb.box(U / 2 - 2, 1.5, U / 2 + 2, 2.2, 0, 0.45, C.bench);
        }
      } else {
        const c0 = V / 2 - 0.9;
        const c1 = V / 2 + 0.9;
        const cuts = Array.from({ length: Math.max(1, Math.round(U / 8)) + 1 }, (_, k) => (U * k) / Math.max(1, Math.round(U / 8)));
        const southDoors: number[] = [];
        const northDoors: number[] = [];
        for (let k = 0; k + 1 < cuts.length; k++) {
          const a = cuts[k];
          const w = cuts[k + 1] - a;
          if (w < 3) continue;
          southDoors.push(a + 1.2);
          const inStair = sr && a + 1.2 > sr[0] - 0.6 && a + 1.2 < sr[2] + 0.6;
          northDoors.push(inStair ? (a + 1.2 < sr![0] ? a + 0.8 : sr![2] + 1.0) : a + 1.2);
          // Partitions between units, both sides.
          if (k > 0) {
            fb.wall(a, 0, a, c0);
            if (!(sr && a > sr[0] - 0.4 && a < sr[2] + 0.4)) fb.wall(a, c1, a, V);
          }
          // Each unit: living room by the corridor door, bedroom beyond.
          for (const [ya, yb] of [[0, c0], [c1, V]] as const) {
            if (w >= 7) {
              const xm = a + w * 0.55;
              const clash = ya === c1 && sr && xm > sr[0] - 0.3 && xm < sr[2] + 0.3;
              if (!clash) fb.wall(xm, ya, xm, yb, [(ya + yb) / 2]);
              fb.room(a, ya, xm, yb, "living");
              fb.room(xm, ya, a + w, yb, "bedroom");
              living(fb, a, ya, xm, yb);
              bedroom(fb, xm, ya, a + w);
            } else {
              fb.room(a, ya, a + w, yb, "living");
            }
          }
        }
        fb.wall(0, c0, U, c0, southDoors);
        // The stair opens onto the corridor through a gap as wide as the stairwell.
        if (sr) {
          fb.wall(0, c1, sr[0], c1, northDoors.filter((d) => d < sr[0]));
          fb.wall(sr[2], c1, U, c1, northDoors.filter((d) => d > sr[2]).map((d) => d - sr[2]));
        } else {
          fb.wall(0, c1, U, c1, northDoors);
        }
        fb.room(0, c0, U, c1, "hall");
      }
    } else if (b.style === "industrial") {
      fb.room(0, 0, U, V, "warehouse");
      for (let y = 4; y + 1.1 < V - 3; y += 4.6) {
        for (let x = 3; x + 6 < U - 3; x += 7.5) {
          fb.box(x, y, x + 6, y + 1.1, 0, 4.2, C.rack);
          if (rng.chance(0.6)) fb.box(x + 0.5, y - 1.6, x + 1.7, y - 0.4, 0, 1.0, C.crate);
        }
      }
    } else if (b.style === "civic") {
      fb.room(0, 0, U, V, "lobby");
      for (let x = 4; x + 2.5 < U - 4; x += 5) fb.box(x, V / 2 - 0.3, x + 2.5, V / 2 + 0.3, 0, 0.45, C.bench);
    } else {
      // Offices and towers: lobby with a reception desk, then open-plan floors.
      if (f === 0) {
        fb.room(0, 0, U, V, "lobby");
        const ry = sr ? sr[1] - 4.5 : V / 2;
        fb.box(U / 2 - 2.2, ry, U / 2 + 2.2, ry + 0.8, 0, 1.05, C.reception);
      } else {
        fb.room(0, 0, U, V, "office");
        officeDesks(fb, quad, sr);
      }
    }
    plan.floors.push(fb.finish(f));
  }
  return plan;
}

/** Position on the stair as (r along the run, w across), both 0..1 inside it. */
export function stairCoords(s: Stair, x: number, z: number): { r: number; w: number } {
  const px = x - s.o[0];
  const pz = z - s.o[1];
  const rl = s.run[0] ** 2 + s.run[1] ** 2;
  const al = s.across[0] ** 2 + s.across[1] ** 2;
  return { r: (px * s.run[0] + pz * s.run[1]) / rl, w: (px * s.across[0] + pz * s.across[1]) / al };
}

export const onStair = (c: { r: number; w: number }) => c.r >= 0 && c.r <= 1 && c.w >= 0 && c.w <= 1;

/**
 * Walking height on the stair. Lane A climbs the first half storey away from
 * the open end, lane B the second half back. The floor (k) is whichever keeps
 * the walker closest to where they were, so walking is continuous.
 */
export function stairHeight(plan: BuildingPlan, c: { r: number; w: number }, prevY: number): { y: number; floor: number } {
  const n = plan.floors.length;
  const r = Math.min(1, Math.max(0, c.r));
  const laneA = c.w < 0.5;
  const phase = laneA ? r / 2 : 0.5 + (1 - r) / 2;
  const kMax = laneA ? n - 1 : n - 2;
  let best = { y: plan.floors[0].y, floor: 0, d: Infinity };
  for (let k = 0; k <= kMax; k++) {
    const y = plan.baseY + 0.05 + Math.min(k + phase, n - 1) * plan.floorHeight;
    const d = Math.abs(y - prevY);
    if (d < best.d) best = { y, floor: Math.round(k + phase), d };
  }
  return { y: best.y, floor: Math.min(n - 1, best.floor) };
}
