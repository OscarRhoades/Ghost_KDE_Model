/**
 * Room furnishing: given a room's rectangle (local meters) and which side
 * faces the street, set out furniture from the catalog against the walls and
 * in the middle, skipping whatever doesn't fit around doors and stairs.
 */
import type { Rng } from "../buildings/kit";
import { FLOORS, furnitureCatalog, type Finish } from "./furniture";
import type { FloorBuilder, Rect, RoomKind } from "./plan";

/** Which wall of a rect: south (y0), north (y1), west (x0), east (x1). */
export type Side = "s" | "n" | "w" | "e";

export interface Ctx {
  fb: FloorBuilder;
  fin: Finish;
  rng: Rng;
  /** The side of the floor that faces the street (shop fronts, entrances). */
  front: Side;
  /** Per-building floor finishes by family. */
  floors: Record<keyof typeof FLOORS, number>;
}

const OPP: Record<Side, Side> = { s: "n", n: "s", w: "e", e: "w" };
const SIDES: Side[] = ["s", "n", "w", "e"];

/** Place a piece with its back against one wall of `r`, at fraction t along that wall. */
export function against(c: Ctx, kind: string, r: Rect, side: Side, t = 0.5, gap = 0.05): boolean {
  const def = furnitureCatalog.get(kind);
  if (!def) return false;
  const [x0, y0, x1, y1] = r;
  const hd = def.d / 2 + gap;
  const hw = def.w / 2;
  const along = (a: number, b: number) => Math.min(b - hw, Math.max(a + hw, a + (b - a) * t));
  switch (side) {
    case "s": return x1 - x0 >= def.w && c.fb.place(kind, along(x0, x1), y0 + hd, 0, c.fin);
    case "n": return x1 - x0 >= def.w && c.fb.place(kind, along(x0, x1), y1 - hd, 2, c.fin);
    case "w": return y1 - y0 >= def.w && c.fb.place(kind, x0 + hd, along(y0, y1), 1, c.fin);
    case "e": return y1 - y0 >= def.w && c.fb.place(kind, x1 - hd, along(y0, y1), 3, c.fin);
  }
}

/** Try a piece against each of `sides` at each of `ts` until one fits. */
export function againstAny(c: Ctx, kind: string, r: Rect, sides: Side[], ts = [0.5, 0.25, 0.75, 0.1, 0.9]): Side | null {
  for (const side of sides) for (const t of ts) if (against(c, kind, r, side, t)) return side;
  return null;
}

/** Place a piece at the middle of `r` (offset by dx, dy), facing `dir`. */
export function middle(c: Ctx, kind: string, r: Rect, dir = 0, dx = 0, dy = 0): boolean {
  return c.fb.place(kind, (r[0] + r[2]) / 2 + dx, (r[1] + r[3]) / 2 + dy, dir, c.fin);
}

/** Fill `r` with a grid of a piece at the given pitch, inset from the walls. */
export function grid(c: Ctx, kind: string, r: Rect, px: number, py: number, inset: number, dir = 0, skip = 0): number {
  let n = 0;
  for (let y = r[1] + inset; y <= r[3] - inset; y += py) {
    for (let x = r[0] + inset; x <= r[2] - inset; x += px) {
      if (skip && c.rng.next() < skip) continue;
      if (c.fb.place(kind, x, y, dir, c.fin)) n++;
    }
  }
  return n;
}

/** Plants in the corners of a room. */
function plants(c: Ctx, r: Rect, n = 2) {
  const corners: [number, number][] = [[r[0] + 0.45, r[1] + 0.45], [r[2] - 0.45, r[3] - 0.45], [r[2] - 0.45, r[1] + 0.45], [r[0] + 0.45, r[3] - 0.45]];
  for (const [x, y] of corners.slice(0, n)) c.fb.place("plant", x, y, 0, c.fin);
}

const dirFacing = (side: Side) => ({ s: 0, n: 2, w: 1, e: 3 })[side];

export function floorFor(c: Ctx, kind: RoomKind): number | undefined {
  switch (kind) {
    case "kitchen":
    case "bathroom":
      return c.floors.tile;
    case "office":
    case "meeting":
      return c.floors.carpet;
    case "lobby":
    case "bank":
      return c.floors.stone;
    case "warehouse":
      return c.floors.concrete;
    case "breakout":
    case "cafe":
      return c.floors.tile;
    default:
      return c.floors.wood;
  }
}

/** Declare a room and furnish it. */
export function furnish(c: Ctx, kind: RoomKind, r: Rect, opts: { use?: string; double?: boolean } = {}) {
  c.fb.room(r[0], r[1], r[2], r[3], kind, floorFor(c, kind));
  const w = r[2] - r[0];
  const h = r[3] - r[1];
  const long: Side[] = w >= h ? ["s", "n", "w", "e"] : ["w", "e", "s", "n"];
  const back = OPP[c.front];
  switch (kind) {
    case "living": {
      middle(c, "rug", r, w >= h ? 0 : 1);
      const sofaSide = againstAny(c, c.rng.chance(0.4) && w > 4.5 && h > 4 ? "sofa-l" : "sofa", r, long, [0.5, 0.35, 0.65]);
      if (sofaSide) againstAny(c, "tv-unit", r, [OPP[sofaSide]], [0.5, 0.35, 0.65]);
      middle(c, "coffee-table", r, w >= h ? 0 : 1);
      againstAny(c, "armchair", r, SIDES, [0.15, 0.85]);
      againstAny(c, "bookshelf", r, SIDES, [0.2, 0.8, 0.5]);
      c.fb.place("floor-lamp", r[0] + 0.4, r[3] - 0.4, 0, c.fin);
      plants(c, r, 1);
      break;
    }
    case "kitchen": {
      againstAny(c, "kitchen-run", r, long, [0.5, 0.3, 0.7, 0.1, 0.9]);
      if (!(w > 4.5 && h > 4 && middle(c, "island", r, w >= h ? 0 : 1, 0, 0.3))) middle(c, "dining-table", r, w >= h ? 0 : 1);
      break;
    }
    case "studio": {
      againstAny(c, "kitchen-run", r, long, [0.2, 0.8]);
      againstAny(c, "bed-double", r, SIDES, [0.8, 0.2, 0.5]) ?? againstAny(c, "bed-single", r, SIDES, [0.8, 0.2]);
      againstAny(c, "sofa", r, SIDES, [0.5, 0.3, 0.7]);
      middle(c, "coffee-table", r);
      plants(c, r, 1);
      break;
    }
    case "bedroom": {
      const bed = opts.double === false ? "bed-single" : "bed-double";
      const side = againstAny(c, bed, r, long, [0.5, 0.4, 0.6, 0.3, 0.7]) ?? againstAny(c, "bed-single", r, SIDES, [0.5, 0.3, 0.7]);
      againstAny(c, "wardrobe", r, side ? SIDES.filter((s) => s !== side) : SIDES, [0.85, 0.15, 0.5]);
      if (opts.double === false) againstAny(c, "desk", r, SIDES, [0.8, 0.2]);
      else c.fb.place("floor-lamp", r[2] - 0.4, r[3] - 0.4, 0, c.fin);
      middle(c, "rug", r, w >= h ? 0 : 1, 0, 0);
      break;
    }
    case "bathroom": {
      againstAny(c, h > 1.8 && w > 1.8 ? "bath" : "shower", r, long, [0.5, 0.2, 0.8]) ?? againstAny(c, "shower", r, SIDES, [0.15, 0.85]);
      againstAny(c, "toilet", r, SIDES, [0.85, 0.15, 0.5]);
      againstAny(c, "basin", r, SIDES, [0.5, 0.2, 0.8]);
      break;
    }
    case "office": {
      grid(c, "desk-pod", r, 4.6, 4.2, 2.6, w >= h ? 0 : 1);
      againstAny(c, "lounge", r, [c.front], [0.15, 0.85]);
      againstAny(c, "lockers", r, [back], [0.5, 0.2, 0.8]);
      plants(c, r, 4);
      break;
    }
    case "meeting": {
      middle(c, "meeting-table", r, w >= h ? 0 : 1) || middle(c, "meeting-table", r, w >= h ? 1 : 0);
      plants(c, r, 1);
      break;
    }
    case "breakout": {
      againstAny(c, "kitchen-run", r, long, [0.5, 0.2, 0.8]);
      grid(c, "cafe-table", r, 2.2, 2.4, 1.8, 1);
      plants(c, r, 2);
      break;
    }
    case "lobby": {
      againstAny(c, "reception", r, [back], [0.5, 0.3, 0.7]) ?? middle(c, "reception", r, dirFacing(c.front));
      againstAny(c, "lounge", r, [c.front, "w", "e"], [0.2, 0.8]);
      againstAny(c, "bench-seat", r, ["w", "e"], [0.5]);
      plants(c, r, 4);
      break;
    }
    case "cafe":
    case "restaurant": {
      const food = kind === "cafe";
      againstAny(c, food ? "counter" : "bar", r, [back], [0.5, 0.3, 0.7]);
      if (food) againstAny(c, "display-case", r, [back], [0.85, 0.15]);
      grid(c, food ? "cafe-table" : "restaurant-table", r, food ? 2.4 : 3.2, food ? 2.8 : 3.2, 1.8, food ? 0 : 1, 0.25);
      plants(c, r, 2);
      break;
    }
    case "bank": {
      againstAny(c, "bank-counter", r, [back], [0.5]);
      againstAny(c, "bench-seat", r, ["w", "e", c.front], [0.5, 0.3]);
      middle(c, "rug", r);
      plants(c, r, 3);
      break;
    }
    case "shop": {
      againstAny(c, "counter", r, [back, "w", "e"], [0.8, 0.2, 0.5]);
      const piece = opts.use === "boutique" ? "clothes-rack" : opts.use === "bike-shop" ? "bike" : "shelf-unit";
      const vertical = c.front === "s" || c.front === "n";
      grid(c, piece, r, vertical ? 2.6 : 2.2, vertical ? 2.2 : 2.6, 1.8, vertical ? 1 : 0);
      plants(c, r, 1);
      break;
    }
    case "warehouse": {
      grid(c, "pallet-rack", r, 7.5, 4.6, 4, w >= h ? 0 : 1);
      againstAny(c, "lockers", r, SIDES, [0.1, 0.9]);
      middle(c, "forklift", r, 1, 0, 0);
      break;
    }
    case "hall":
      plants(c, r, 1);
      break;
  }
}

/** An office floor: open plan, sometimes with meeting rooms and a kitchen, or a row of cellular offices. */
export function officeFloor(c: Ctx, U: number, V: number, sr: Rect | null) {
  const clash = (r: Rect) => !!sr && r[0] < sr[2] + 1 && sr[0] < r[2] + 1 && r[1] < sr[3] + 1.6 && sr[1] - 1.6 < r[3];
  let open: Rect = [0, 0, U, V];
  const v = c.rng.next();
  if (v < 0.4 && U > 20 && V > 10) {
    for (const atEnd of [true, false]) {
      const strip: Rect = atEnd ? [U - 6, 0, U, V] : [0, 0, 6, V];
      if (clash(strip)) continue;
      const x = atEnd ? U - 6 : 6;
      c.fb.wall(x, 0, x, V, [V * 0.25, V * 0.75]);
      c.fb.wall(strip[0], V / 2, strip[2], V / 2);
      furnish(c, "meeting", [strip[0], 0, strip[2], V / 2]);
      furnish(c, "breakout", [strip[0], V / 2, strip[2], V]);
      open = atEnd ? [0, 0, U - 6, V] : [6, 0, U, V];
      break;
    }
  } else if (v < 0.7 && U > 16 && V > 14) {
    const south = c.front !== "s";
    const strip: Rect = south ? [0, 0, U, 4] : [0, V - 4, U, V];
    if (!clash(strip)) {
      const y = south ? 4 : V - 4;
      const n = Math.max(2, Math.floor(U / 3.6));
      const cw = U / n;
      c.fb.wall(0, y, U, y, Array.from({ length: n }, (_, k) => k * cw + cw / 2));
      for (let k = 0; k < n; k++) {
        if (k > 0) c.fb.wall(k * cw, strip[1], k * cw, strip[3]);
        const cell: Rect = [k * cw, strip[1], (k + 1) * cw, strip[3]];
        c.fb.room(cell[0], cell[1], cell[2], cell[3], "office", c.floors.carpet);
        against(c, "desk", cell, south ? "s" : "n", 0.5);
        againstAny(c, "bookshelf", cell, ["w", "e"], [0.3, 0.7]);
      }
      open = south ? [0, 4, U, V] : [0, 0, U, V - 4];
    }
  }
  furnish(c, "office", open);
}
