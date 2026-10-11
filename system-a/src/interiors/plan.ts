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
import { interiorFloorHeight, interiorFloors, longFirst, shellOf } from "../buildings/massing";
import { specialInfo } from "../buildings/special";
import "../buildings/index"; // registers landmark interiors
import type { BuildingData } from "../engine/components";
import { clipSegment, pointInPolygon, quadPoint, type P2 } from "../geom/polygon";
import { groundCatalog, groundUseOf } from "../buildings/ground";
import { planKind } from "../buildings/kinds";
import { FLOORS, finishFor, furnitureCatalog, PAINTS, type Finish } from "./furniture";
import { againstAny, furnish, grid, officeFloor, type Ctx, type Side } from "./rooms";

export type RoomKind =
  | "lobby"
  | "shop"
  | "office"
  | "living"
  | "kitchen"
  | "bedroom"
  | "hall"
  | "warehouse"
  | "bathroom"
  | "studio"
  | "meeting"
  | "breakout"
  | "cafe"
  | "restaurant"
  | "bank";

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
  /** Floor finish color, when it differs from the building's. */
  floor?: number;
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
  /** Leave the top floor without a flat ceiling (landmark roofs are visible). */
  openCeiling: boolean;
  /** HUD label override for every room. */
  roomLabel?: string;
}

/** Slab thickness between a ceiling and the floor above. */
export const SLAB = 0.3;
const DOOR_W = 0.95;
const DOOR_H = 2.15;

/** Local metric frame on a quad footprint. */
export class Frame {
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
  /** Approximate local (x, y) meters of a world point (exact for parallelograms). */
  local(p: P2): [number, number] {
    const [q0, q1, , q3] = this.q;
    const ax = (q1[0] - q0[0]) / this.U;
    const az = (q1[1] - q0[1]) / this.U;
    const bx = (q3[0] - q0[0]) / this.V;
    const bz = (q3[1] - q0[1]) / this.V;
    const px = p[0] - q0[0];
    const pz = p[1] - q0[1];
    const det = ax * bz - az * bx || 1;
    return [(px * bz - pz * bx) / det, (ax * pz - az * px) / det];
  }
  /** Local bounding box of a world polygon. */
  bounds(poly: readonly P2[]) {
    const pts = poly.map((p) => this.local(p));
    return {
      x0: Math.min(...pts.map((p) => p[0])),
      y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])),
      y1: Math.max(...pts.map((p) => p[1])),
    };
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

/** Axis-aligned local rectangle [x0, y0, x1, y1]. */
export type Rect = [number, number, number, number];
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Builder for one floor's walls, rooms and furniture in local coordinates. */
export class FloorBuilder {
  walls: Wall[] = [];
  rooms: Room[] = [];
  furniture: Furniture[] = [];
  lights: P2[] = [];
  /** Space taken by furniture, stairs and door swings. */
  occupied: Rect[] = [];
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
    // Keep only what lies inside this floor's outline (L and U plans, setbacks).
    const push = (a: P2, b: P2, y0: number) => {
      for (const [t0, t1] of clipSegment(a[0], a[1], b[0], b[1], this.shell)) {
        const p = (t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if ((t1 - t0) * Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.1) this.walls.push({ a: p(t0), b: p(t1), y0, y1: top });
      }
    };
    let cursor = 0;
    for (const d of [...doors].sort((a, b) => a - b)) {
      // Keep the floor clear on both sides of the doorway.
      const cx = x0 + ((x1 - x0) * d) / len, cy = y0 + ((y1 - y0) * d) / len;
      const along = Math.abs(x1 - x0) > Math.abs(y1 - y0);
      this.occupied.push(along ? [cx - 0.7, cy - 1.0, cx + 0.7, cy + 1.0] : [cx - 1.0, cy - 0.7, cx + 1.0, cy + 0.7]);
      const s0 = Math.max(0, d - DOOR_W / 2);
      const s1 = Math.min(len, d + DOOR_W / 2);
      if (s0 > cursor) push(at(cursor), at(s0), this.y);
      if (top > this.y + DOOR_H) push(at(s0), at(s1), this.y + DOOR_H);
      cursor = s1;
    }
    if (cursor < len) push(at(cursor), at(len), this.y);
  }

  room(x0: number, y0: number, x1: number, y1: number, kind: RoomKind, floor?: number) {
    this.rooms.push({ poly: this.f.rect(x0, y0, x1, y1), kind, floor });
    this.lights.push(this.f.w((x0 + x1) / 2, (y0 + y1) / 2));
  }

  /** A furniture box if it sits fully inside this floor's shell. */
  box(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, color: number) {
    const poly = this.f.rect(x0, y0, x1, y1);
    if (!poly.every(([x, z]) => pointInPolygon(x, z, this.shell))) return;
    this.furniture.push({ poly, y0: this.y + h0, y1: this.y + h1, color });
  }

  /** Whether a local rectangle is indoors on this floor and clear of everything placed. */
  free(r: Rect): boolean {
    return this.inside(r) && !this.occupied.some((o) => overlaps(o, r));
  }

  inside(r: Rect): boolean {
    const corners: [number, number][] = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    return corners.every(([x, y]) => {
      const [wx, wz] = this.f.w(x, y);
      return pointInPolygon(wx, wz, this.shell);
    });
  }

  /**
   * Place a catalog piece centered at (cx, cy), turned so its front faces
   * dir: 0 = +y, 1 = +x, 2 = -y, 3 = -x. Returns false (placing nothing) if it doesn't fit.
   */
  place(kind: string, cx: number, cy: number, dir: number, finish: Finish, force = false): boolean {
    const def = furnitureCatalog.get(kind);
    if (!def) return false;
    const t = (x: number, y: number): [number, number] =>
      dir === 0 ? [cx + x, cy + y] : dir === 1 ? [cx + y, cy - x] : dir === 2 ? [cx - x, cy - y] : [cx - y, cy + x];
    const rect = (x0: number, y0: number, x1: number, y1: number): Rect => {
      const [ax, ay] = t(x0, y0);
      const [bx, by] = t(x1, y1);
      return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    };
    const parts = def.parts(finish).map(([x0, y0, x1, y1, h0, h1, color]) => ({ r: rect(x0, y0, x1, y1), h0, h1, color }));
    const bounds: Rect = [
      Math.min(...parts.map((p) => p.r[0])),
      Math.min(...parts.map((p) => p.r[1])),
      Math.max(...parts.map((p) => p.r[2])),
      Math.max(...parts.map((p) => p.r[3])),
    ];
    if (def.flat ? !this.inside(bounds) : !force && !this.free(bounds)) return false;
    for (const { r, h0, h1, color } of parts) {
      this.furniture.push({ poly: this.f.rect(r[0], r[1], r[2], r[3]), y0: this.y + h0, y1: this.y + h1, color });
    }
    if (!def.flat) this.occupied.push(bounds);
    return true;
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

/** Generate the full plan for a building. Deterministic per seed. */
export function planBuilding(b: BuildingData): BuildingPlan {
  const n = interiorFloors(b);
  const fh = interiorFloorHeight(b);
  // Frame on the ground floor's outline when it is a quad (e.g. a courtyard's front
  // bar), otherwise on the lot footprint.
  const shell0 = shellOf(b, 0);
  const quad = shell0.length === 4 ? new Frame(longFirst(shell0)) : b.footprint.length === 4 ? new Frame(longFirst(b.footprint)) : null;
  const shells = Array.from({ length: n }, (_, f) => (f === 0 ? shell0 : shellOf(b, f)));
  const kind = planKind(b.style);
  const house = kind === "house";
  const flats = kind === "apartments";
  const residential = house || flats;
  const plan: BuildingPlan = {
    floors: [],
    stair: null,
    baseY: b.baseY,
    floorHeight: fh,
    glazing: b.style === "glass-tower" || b.style === "office" || b.style === "civic" || b.style === "default" ? "full" : b.style === "industrial" ? "solid" : "punched",
    floorColor: residential ? 0xc49a6c : b.style === "civic" ? 0xd9d3c6 : 0xb8b5ae,
    wallColor: 0xf0eee9,
    openCeiling: false,
  };
  const special = specialInfo.get(b.style);
  if (special) {
    plan.openCeiling = !!special.openCeiling;
    plan.roomLabel = special.room;
    if (special.glazing) plan.glazing = special.glazing;
  }

  // ---- Stair placement (local frame) ----
  let ls: LocalStair | null = null;
  if (quad && n >= 2) {
    const { U, V } = quad;
    // Candidate positions, best first; the first that fits inside every floor wins.
    const candidates: LocalStair[] = [];
    if (house) {
      const up = quad.bounds(shells[1]);
      const xs = Math.max(0.4, up.x0 + 0.4);
      const run = 3.6;
      const oy = Math.min(V, up.y1) - 0.3 - 2.0;
      candidates.push({ ox: xs + run, oy, rx: -1, ry: 0, ax: 0, ay: 1, run, width: 2.0 });
      candidates.push({ ox: Math.min(U, up.x1) - 0.4, oy, rx: -1, ry: 0, ax: 0, ay: 1, run, width: 2.0 });
    } else if (flats) {
      const run = Math.min(5.2, V / 2 - 0.9 - 0.6);
      if (run >= 3 && U > 8) for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85]) candidates.push({ ox: U * fx - 1.4, oy: V / 2 + 0.9, rx: 0, ry: 1, ax: 1, ay: 0, run, width: 2.8 });
    } else if (U > 8 && V > 8) {
      const run = Math.min(5.2, V - 5);
      for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.35], [0.5, 0.65], [0.25, 0.3], [0.75, 0.3]]) {
        candidates.push({ ox: U * fx - 1.4, oy: V * fy - run / 2, rx: 0, ry: 1, ax: 1, ay: 0, run, width: 2.8 });
      }
    }
    const fits = (c: LocalStair) => {
      const P = (r: number, w: number) => quad.w(c.ox + c.rx * r * c.run + c.ax * w * c.width, c.oy + c.ry * r * c.run + c.ay * w * c.width);
      // The stair plus a landing in front of its open end must be indoors on every floor.
      const pts = [P(-0.3, 0.02), P(1.02, 0.02), P(1.02, 0.98), P(-0.3, 0.98)];
      return shells.every((sh) => pts.every(([x, z]) => pointInPolygon(x, z, sh)));
    };
    ls = candidates.find(fits) ?? null;
  }
  if (quad && ls) {
    const o = quad.w(ls.ox, ls.oy);
    const r = quad.w(ls.ox + ls.rx * ls.run, ls.oy + ls.ry * ls.run);
    const a = quad.w(ls.ox + ls.ax * ls.width, ls.oy + ls.ay * ls.width);
    plan.stair = { o, run: [r[0] - o[0], r[1] - o[1]], across: [a[0] - o[0], a[1] - o[1]] };
  }
  const sr = ls ? stairRect(ls) : null;

  // Finishes shared by every floor.
  const frng = rngFor(b.seed ^ 0xf1a5);
  const fin = finishFor(frng);
  const floorFin = {
    wood: frng.pick(FLOORS.wood),
    tile: frng.pick(FLOORS.tile),
    carpet: frng.pick(FLOORS.carpet),
    stone: frng.pick(FLOORS.stone),
    concrete: frng.pick(FLOORS.concrete),
  };
  if (!special) plan.wallColor = frng.pick(PAINTS);
  // Which side of the local frame faces the street: the one nearest the front door.
  let front: Side = "s";
  if (quad && b.entrance) {
    const [ex, ey] = quad.local([b.entrance.x, b.entrance.z]);
    const d = { s: Math.abs(ey), n: Math.abs(quad.V - ey), w: Math.abs(ex), e: Math.abs(quad.U - ex) };
    front = (Object.keys(d) as Side[]).reduce((m, k) => (d[k] < d[m] ? k : m), "s");
  }
  const use = groundUseOf(b);
  const groundFloor = (c: Ctx, U: number, V: number, fallback: RoomKind) => {
    const kind: RoomKind = use === "none" || use === "arcade" ? fallback : groundCatalog.require(use).room;
    const depth = front === "s" || front === "n" ? V : U;
    if (kind === fallback || depth < 16) {
      furnish(c, kind, [0, 0, U, V], { use });
      return;
    }
    // The shop takes the street side; the building's lobby is behind it.
    const D = 11;
    const [shop, back]: [Rect, Rect] =
      front === "s" ? [[0, 0, U, D], [0, D, U, V]] : front === "n" ? [[0, V - D, U, V], [0, 0, U, V - D]] : front === "w" ? [[0, 0, D, V], [D, 0, U, V]] : [[U - D, 0, U, V], [0, 0, U - D, V]];
    // A dividing wall, unless it would cut through the stairwell.
    const line = front === "s" ? D : front === "n" ? V - D : front === "w" ? D : U - D;
    const horizontal = front === "s" || front === "n";
    const cuts = sr && (horizontal ? sr[1] - 1.5 < line && line < sr[3] + 1.5 : sr[0] - 1.5 < line && line < sr[2] + 1.5);
    if (!cuts) {
      if (horizontal) c.fb.wall(0, line, U, line, [U * 0.15, U * 0.85]);
      else c.fb.wall(line, 0, line, V, [V * 0.15, V * 0.85]);
    }
    furnish(c, kind, shop, { use });
    furnish(c, fallback, back);
  };

  const buildFloor = (f: number): FloorPlan => {
    const y = b.baseY + f * fh + 0.05;
    const ceiling = b.baseY + (f + 1) * fh - SLAB;
    const shell = shells[f];
    const fb = new FloorBuilder(quad ?? new Frame([shell[0], shell[1], shell[2], shell[shell.length - 1]]), y, ceiling, shell);
    if (quad && ls) stairWalls(fb, ls, f, n);

    if (!quad) {
      return fb.finish(f);
    }
    const { U, V } = quad;

    if (special?.furnish) {
      special.furnish(
        {
          U,
          V,
          box: (x0, y0, x1, y1, h0, h1, c) => fb.box(x0, y0, x1, y1, h0, h1, c),
          wall: (x0, y0, x1, y1, doors, h) => fb.wall(x0, y0, x1, y1, doors, h),
          room: (x0, y0, x1, y1, kind) => fb.room(x0, y0, x1, y1, kind as RoomKind),
          local: (p) => quad.local(p),
          stair: sr,
        },
        f,
        b,
      );
      return fb.finish(f);
    }

    const c: Ctx = { fb, fin, rng: rngFor(b.seed ^ (0x51f0 + f * 7919)), front, floors: floorFin };
    if (sr) fb.occupied.push([sr[0] - 0.3, sr[1] - 1.3, sr[2] + 0.3, sr[3] + 1.3]);

    if (house) {
      const up = f >= 1 ? quad.bounds(shell) : null;
      const x0 = up ? up.x0 : 0;
      const x1 = up ? up.x1 : U;
      const y0 = up ? Math.max(0, up.y0) : 0;
      const xp = ls ? ls.ox + 1.4 : U * 0.4;
      if (f === 0) {
        if (U - xp > 3.5) {
          fb.wall(xp, 0, xp, V, [V * 0.3 + 0.6]);
          furnish(c, "kitchen", [0, 0, xp, V]);
          furnish(c, "living", [xp, 0, U, V]);
        } else furnish(c, "living", [0, 0, U, V]);
      } else {
        const xb = Math.max(xp, x0 + 2);
        if (x1 - xb > 3) {
          fb.wall(xb, y0, xb, V, [y0 + 0.9]);
          furnish(c, "hall", [x0, y0, xb, V]);
          if (x1 - xb > 7.5) {
            // Main bedroom with an ensuite, and a second bedroom beyond.
            const xm = (xb + x1) / 2;
            const yb = y0 + 2.6;
            fb.wall(xm, y0, xm, V, [y0 + 1.3, V - 0.9]);
            fb.wall(xm, yb, x1, yb);
            furnish(c, "bedroom", [xb, y0, xm, V]);
            furnish(c, "bathroom", [xm, y0, x1, yb]);
            furnish(c, "bedroom", [xm, yb, x1, V], { double: false });
          } else furnish(c, "bedroom", [xb, y0, x1, V]);
        } else furnish(c, "bedroom", [x0, y0, x1, V]);
      }
    } else if (flats) {
      if (f === 0) groundFloor(c, U, V, "lobby");
      else {
        const c0 = V / 2 - 0.9;
        const c1 = V / 2 + 0.9;
        const cuts = Array.from({ length: Math.max(1, Math.round(U / 8)) + 1 }, (_, k) => (U * k) / Math.max(1, Math.round(U / 8)));
        const southDoors: number[] = [];
        const northDoors: number[] = [];
        // The stair and the corridor are claimed before units are furnished.
        fb.occupied.push([0, c0, U, c1]);
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
          // Each unit: open living room and kitchen by the corridor door, then a
          // bathroom off the living room and a bedroom beyond. Narrow units are studios.
          for (const [ya, yb] of [[0, c0], [c1, V]] as const) {
            const xm = a + w * 0.55;
            const clash = ya === c1 && sr && xm > sr[0] - 0.3 && xm < sr[2] + 0.3;
            if (w >= 7 && !clash && yb - ya > 5) {
              const corridorSide = ya === 0 ? yb : ya;
              const bath: Rect = ya === 0 ? [xm, yb - 2.4, a + w, yb] : [xm, ya, a + w, ya + 2.4];
              const bed: Rect = ya === 0 ? [xm, ya, a + w, yb - 2.4] : [xm, ya + 2.4, a + w, yb];
              const bathDoor = ya === 0 ? yb - 1.2 : ya + 1.2;
              fb.wall(xm, ya, xm, yb, [bathDoor, (bed[1] + bed[3]) / 2].map((y) => y - ya));
              fb.wall(xm, ya === 0 ? bath[1] : bath[3], a + w, ya === 0 ? bath[1] : bath[3]);
              void corridorSide;
              furnish(c, "living", [a, ya, xm, yb]);
              againstAny(c, "kitchen-run", [a, ya, xm, yb], ["w", "e"], [0.5, 0.3, 0.7]);
              furnish(c, "bathroom", bath);
              furnish(c, "bedroom", bed);
            } else furnish(c, "studio", [a, ya, a + w, yb]);
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
        fb.room(0, c0, U, c1, "hall", floorFin.wood);
      }
    } else if (kind === "industrial") {
      // A small office in one corner of the shed.
      const ow = Math.min(8, U * 0.25), od = Math.min(6, V * 0.35);
      const [ox0, ox1] = front === "e" ? [U - ow, U] : [0, ow];
      if (U > 20 && V > 14) {
        fb.wall(ox0 === 0 ? ow : U - ow, 0, ox0 === 0 ? ow : U - ow, od, [od / 2], 3);
        fb.wall(ox0, od, ox1, od, [], 3);
        furnish(c, "office", [ox0, 0, ox1, od]);
        fb.occupied.push([ox0, 0, ox1, od + 0.5]);
      }
      furnish(c, "warehouse", [0, 0, U, V]);
    } else if (kind === "civic") {
      furnish(c, "lobby", [0, 0, U, V]);
      grid(c, "bench-seat", [0, 0, U, V], 5, 6, 4, 0, 0.3);
    } else {
      // Offices and towers: a lobby or shop below, then floors that vary.
      if (f === 0) groundFloor(c, U, V, "lobby");
      else officeFloor(c, U, V, sr);
    }
    return fb.finish(f);
  };

  // Floors are planned on first use: a 70-storey tower only plans the floors you visit.
  const cache: FloorPlan[] = [];
  const floors: FloorPlan[] = [];
  for (let f = 0; f < n; f++) {
    Object.defineProperty(floors, f, { enumerable: true, get: () => (cache[f] ??= buildFloor(f)) });
  }
  plan.floors = floors;
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
