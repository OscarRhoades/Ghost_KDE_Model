/**
 * Furniture catalog: each piece is a few boxes in its own frame (width along
 * x, depth along y, the front facing +y, origin at the center), colored from
 * the building's finishes. Plans place pieces turned to face into a room.
 */
import { Catalog } from "../catalog/registry";
import type { Rng } from "../buildings/kit";

/** A box in a piece's frame: [x0, y0, x1, y1, h0, h1, color]. */
export type Part = [number, number, number, number, number, number, number];

/** Colors shared by a building's interiors. */
export interface Finish {
  wood: number;
  woodDark: number;
  fabric: number;
  fabric2: number;
  accent: number;
  metal: number;
  white: number;
  stone: number;
  plant: number;
}

export interface FurnitureDef {
  w: number;
  d: number;
  /** Lies flat on the floor (rugs): other pieces may stand on it. */
  flat?: boolean;
  parts(c: Finish): Part[];
}

export const furnitureCatalog = new Catalog<FurnitureDef>("furniture");

const reg = (name: string, w: number, d: number, parts: (c: Finish, hw: number, hd: number) => Part[], tags: string[] = [], flat = false) =>
  furnitureCatalog.register(name, { w, d, flat, parts: (c) => parts(c, w / 2, d / 2) }, { tags });

const DARK = 0x2a2d31;
const SCREEN = 0x1d2329;
const POT = 0xb0623f;
const LINEN = 0xf1eee8;
const TILE = 0xe9ecec;
const CHROME = 0xc8ccd0;
const BOOKS = [0x8c3b2f, 0x2f5d8f, 0xd9b45a, 0x3e6b4f, 0xe6e1d6];

/** A chair at (x, y) facing direction (fx, fy) in the parent frame. */
function chair(x: number, y: number, fy: number, c: number, legs: number): Part[] {
  const back = fy > 0 ? y - 0.22 : y + 0.18;
  return [
    [x - 0.22, y - 0.22, x + 0.22, y + 0.22, 0.42, 0.47, c],
    [x - 0.22, back, x + 0.22, back + 0.04, 0.47, 0.9, c],
    [x - 0.02, y - 0.02, x + 0.02, y + 0.02, 0, 0.42, legs],
  ];
}

// ---- Living -----------------------------------------------------------------------------

reg("sofa", 2.2, 0.9, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0.1, 0.42, c.fabric],
  [-hw, -hd, hw, -hd + 0.22, 0.42, 0.85, c.fabric],
  [-hw, -hd, -hw + 0.18, hd, 0.42, 0.62, c.fabric],
  [hw - 0.18, -hd, hw, hd, 0.42, 0.62, c.fabric],
  [-hw + 0.25, -hd + 0.25, -0.02, hd - 0.05, 0.42, 0.52, c.fabric2],
  [0.02, -hd + 0.25, hw - 0.25, hd - 0.05, 0.42, 0.52, c.fabric2],
], ["living"]);

reg("sofa-l", 2.6, 1.8, (c, hw, hd) => [
  [-hw, -hd, hw, -hd + 0.9, 0.1, 0.42, c.fabric],
  [-hw, -hd, hw, -hd + 0.2, 0.42, 0.85, c.fabric],
  [hw - 0.9, -hd, hw, hd, 0.1, 0.42, c.fabric],
  [hw - 0.2, -hd, hw, hd, 0.42, 0.85, c.fabric],
  [-hw, -hd, -hw + 0.18, -hd + 0.9, 0.42, 0.62, c.fabric],
], ["living"]);

reg("armchair", 0.85, 0.85, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0.1, 0.42, c.fabric2],
  [-hw, -hd, hw, -hd + 0.2, 0.42, 0.9, c.fabric2],
  [-hw, -hd, -hw + 0.14, hd, 0.42, 0.6, c.fabric2],
  [hw - 0.14, -hd, hw, hd, 0.42, 0.6, c.fabric2],
], ["living"]);

reg("coffee-table", 1.1, 0.6, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0.36, 0.42, c.wood],
  [-hw + 0.05, -hd + 0.05, hw - 0.05, hd - 0.05, 0, 0.36, c.woodDark],
], ["living"]);

reg("rug", 2.4, 1.7, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.012, c.accent],
  [-hw + 0.15, -hd + 0.15, hw - 0.15, hd - 0.15, 0.012, 0.016, c.fabric2],
], ["living", "bedroom"], true);

reg("tv-unit", 1.8, 0.45, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.5, c.woodDark],
  [-0.65, -0.05, 0.65, 0.0, 0.62, 1.35, SCREEN],
  [-0.1, -0.1, 0.1, 0.05, 0.5, 0.62, DARK],
], ["living"]);

reg("bookshelf", 1.0, 0.35, (c, hw, hd) => {
  const out: Part[] = [[-hw, -hd, hw, hd, 0, 0.04, c.wood], [-hw, -hd, -hw + 0.03, hd, 0, 2.0, c.wood], [hw - 0.03, -hd, hw, hd, 0, 2.0, c.wood], [-hw, -hd, hw, -hd + 0.02, 0, 2.0, c.wood]];
  for (let k = 0; k < 5; k++) {
    const y = 0.04 + k * 0.4;
    out.push([-hw, -hd, hw, hd, y + 0.36, y + 0.4, c.wood]);
    out.push([-hw + 0.05, -hd + 0.03, -hw + 0.05 + 0.25 + (k % 3) * 0.1, hd - 0.05, y, y + 0.28, BOOKS[k % 5]]);
    out.push([0.05, -hd + 0.03, hw - 0.08, hd - 0.05, y, y + 0.24, BOOKS[(k + 2) % 5]]);
  }
  return out;
}, ["living", "office"]);

reg("plant", 0.5, 0.5, (c) => [
  [-0.18, -0.18, 0.18, 0.18, 0, 0.4, POT],
  [-0.25, -0.25, 0.25, 0.25, 0.4, 0.95, c.plant],
  [-0.15, -0.15, 0.15, 0.15, 0.95, 1.35, c.plant],
], ["any"]);

reg("floor-lamp", 0.4, 0.4, (c) => [
  [-0.15, -0.15, 0.15, 0.15, 0, 0.03, c.metal],
  [-0.02, -0.02, 0.02, 0.02, 0, 1.5, c.metal],
  [-0.18, -0.18, 0.18, 0.18, 1.5, 1.75, LINEN],
], ["living", "bedroom"]);

// ---- Kitchen and dining ----------------------------------------------------------------------

reg("kitchen-run", 3.0, 0.65, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.88, c.white],
  [-hw, -hd, hw, hd, 0.88, 0.92, c.stone],
  [-0.5, -0.1, 0.1, 0.2, 0.92, 0.93, DARK],
  [-hw, -hd, hw, -hd + 0.35, 1.5, 2.2, c.white],
  [hw - 0.7, -hd, hw, hd, 0, 2.0, CHROME],
], ["kitchen"]);

reg("island", 2.0, 0.9, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.88, c.woodDark],
  [-hw - 0.05, -hd - 0.05, hw + 0.05, hd + 0.2, 0.88, 0.92, c.stone],
  ...[-0.6, 0, 0.6].flatMap((x): Part[] => [[x - 0.17, hd + 0.3, x + 0.17, hd + 0.64, 0.62, 0.66, c.accent], [x - 0.02, hd + 0.45, x + 0.02, hd + 0.49, 0, 0.62, c.metal]]),
], ["kitchen"]);

reg("dining-table", 1.8, 1.9, (c, hw) => [
  [-hw, -0.45, hw, 0.45, 0.72, 0.76, c.wood],
  [-hw + 0.1, -0.35, -hw + 0.18, 0.35, 0, 0.72, c.woodDark],
  [hw - 0.18, -0.35, hw - 0.1, 0.35, 0, 0.72, c.woodDark],
  ...[-0.55, 0.55].flatMap((x) => [...chair(x, -0.7, 1, c.fabric2, c.metal), ...chair(x, 0.7, -1, c.fabric2, c.metal)]),
], ["kitchen", "dining"]);

// ---- Bedroom and bathroom ---------------------------------------------------------------------

reg("bed-double", 1.7, 2.15, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.3, c.woodDark],
  [-hw + 0.05, -hd + 0.1, hw - 0.05, hd - 0.05, 0.3, 0.52, LINEN],
  [-hw + 0.05, -hd + 0.75, hw - 0.05, hd - 0.05, 0.52, 0.56, c.accent],
  [-hw + 0.15, -hd + 0.15, -0.05, -hd + 0.55, 0.52, 0.64, LINEN],
  [0.05, -hd + 0.15, hw - 0.15, -hd + 0.55, 0.52, 0.64, LINEN],
  [-hw, -hd, hw, -hd + 0.08, 0, 1.05, c.wood],
  [-hw - 0.5, -hd, -hw - 0.05, -hd + 0.45, 0, 0.5, c.wood],
  [hw + 0.05, -hd, hw + 0.5, -hd + 0.45, 0, 0.5, c.wood],
], ["bedroom"]);

reg("bed-single", 1.0, 2.05, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.3, c.wood],
  [-hw + 0.05, -hd + 0.1, hw - 0.05, hd - 0.05, 0.3, 0.5, LINEN],
  [-hw + 0.05, -hd + 0.7, hw - 0.05, hd - 0.05, 0.5, 0.54, c.fabric2],
  [-hw + 0.15, -hd + 0.12, hw - 0.15, -hd + 0.5, 0.5, 0.6, LINEN],
  [-hw, -hd, hw, -hd + 0.06, 0, 0.85, c.wood],
], ["bedroom"]);

reg("wardrobe", 1.8, 0.6, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 2.2, c.white],
  [-0.01, hd, 0.01, hd + 0.01, 0.1, 2.1, c.woodDark],
], ["bedroom"]);

reg("desk", 1.4, 1.2, (c, hw) => [
  [-hw, -0.6, hw, 0.1, 0.72, 0.76, c.wood],
  [-hw + 0.03, -0.55, -hw + 0.08, 0.05, 0, 0.72, c.metal],
  [hw - 0.08, -0.55, hw - 0.03, 0.05, 0, 0.72, c.metal],
  [-0.3, -0.5, 0.3, -0.46, 0.8, 1.15, SCREEN],
  ...chair(0, 0.35, -1, c.fabric, c.metal),
], ["bedroom", "office"]);

reg("bath", 1.7, 0.75, (_c, hw, hd) => [[-hw, -hd, hw, hd, 0, 0.55, LINEN], [-hw + 0.08, -hd + 0.08, hw - 0.08, hd - 0.08, 0.55, 0.56, 0xcfe0e6]], ["bathroom"]);
reg("shower", 0.9, 0.9, (_c, hw, hd) => [[-hw, -hd, hw, hd, 0, 0.05, TILE], [-hw, -hd, -hw + 0.02, hd, 0, 2.0, 0xcfe0e6], [-0.05, -hd, 0.05, -hd + 0.08, 1.8, 1.9, CHROME]], ["bathroom"]);
reg("toilet", 0.4, 0.7, (_c, hw, hd) => [[-hw + 0.05, -hd + 0.2, hw - 0.05, hd, 0, 0.42, LINEN], [-hw, -hd, hw, -hd + 0.2, 0.42, 0.85, LINEN]], ["bathroom"]);
reg("basin", 0.6, 0.45, (c, hw, hd) => [[-hw, -hd, hw, hd, 0.5, 0.85, c.woodDark], [-hw + 0.05, -hd + 0.05, hw - 0.05, hd - 0.05, 0.85, 0.88, LINEN], [-hw, -hd, hw, -hd + 0.02, 1.0, 1.7, 0xd5e4ea]], ["bathroom"]);

// ---- Work ------------------------------------------------------------------------------------

reg("desk-pod", 3.2, 2.4, (c) => {
  const out: Part[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const x0 = sx < 0 ? -1.6 : 0, y0 = sy < 0 ? -0.8 : 0;
    out.push([x0 + 0.02, y0, x0 + 1.58, y0 + 0.8, 0.72, 0.75, c.white]);
    out.push([x0 + 0.5, sy < 0 ? -0.06 : 0.02, x0 + 1.1, sy < 0 ? -0.02 : 0.06, 0.8, 1.15, SCREEN]);
    out.push(...chair(x0 + 0.8, sy * 1.0, -sy, c.fabric, c.metal));
  }
  out.push([-1.6, -0.02, 1.6, 0.02, 0.75, 1.15, c.accent]);
  out.push([-1.55, -0.75, -1.5, 0.75, 0, 0.72, c.metal], [1.5, -0.75, 1.55, 0.75, 0, 0.72, c.metal]);
  return out;
}, ["office"]);

reg("meeting-table", 3.2, 2.4, (c) => [
  [-1.4, -0.55, 1.4, 0.55, 0.72, 0.76, c.wood],
  [-0.1, -0.4, 0.1, 0.4, 0, 0.72, c.metal],
  ...[-0.9, 0, 0.9].flatMap((x) => [...chair(x, -0.85, 1, c.fabric, c.metal), ...chair(x, 0.85, -1, c.fabric, c.metal)]),
], ["office"]);

reg("reception", 3.0, 0.9, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 1.05, c.woodDark],
  [-hw - 0.05, -hd - 0.05, hw + 0.05, hd + 0.05, 1.05, 1.1, c.stone],
  [-0.4, -hd - 0.5, 0.4, -hd - 0.1, 0.45, 0.5, c.fabric],
], ["lobby"]);

reg("lounge", 3.2, 2.8, (c) => [
  [-1.1, -1.4, 1.1, -0.5, 0.1, 0.42, c.fabric], [-1.1, -1.4, 1.1, -1.2, 0.42, 0.8, c.fabric],
  [-1.1, 0.5, 1.1, 1.4, 0.1, 0.42, c.fabric], [-1.1, 1.2, 1.1, 1.4, 0.42, 0.8, c.fabric],
  [-0.6, -0.3, 0.6, 0.3, 0.35, 0.4, c.stone], [-0.1, -0.1, 0.1, 0.1, 0, 0.35, c.metal],
], ["lobby", "office"]);

reg("lockers", 2.4, 0.5, (c, hw, hd) => [[-hw, -hd, hw, hd, 0, 1.9, c.metal], ...[-0.6, 0, 0.6].map((x): Part => [x - 0.01, hd, x + 0.01, hd + 0.01, 0.05, 1.85, DARK])], ["office", "warehouse"]);

// ---- Shops, cafes, banks ------------------------------------------------------------------------

reg("counter", 3.0, 0.8, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 1.0, c.woodDark],
  [-hw - 0.05, -hd - 0.05, hw + 0.05, hd + 0.05, 1.0, 1.05, c.stone],
  [hw - 0.9, -0.2, hw - 0.3, 0.2, 1.05, 1.5, CHROME],
  [-hw, -hd - 1.2, hw, -hd - 0.85, 0, 2.2, c.white],
], ["cafe", "shop"]);

reg("display-case", 2.0, 0.8, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 0.8, c.woodDark],
  [-hw, -hd, hw, hd, 0.8, 1.25, 0xd9e8ee],
  ...[-0.6, 0, 0.6].map((x, k): Part => [x - 0.2, -0.2, x + 0.2, 0.2, 0.85, 0.95, [0xd9a65b, 0xb5603f, 0xf0dcb0][k]]),
], ["cafe"]);

reg("cafe-table", 0.7, 1.6, (c) => [
  [-0.35, -0.35, 0.35, 0.35, 0.72, 0.75, c.stone],
  [-0.03, -0.03, 0.03, 0.03, 0, 0.72, c.metal],
  ...chair(0, -0.6, 1, c.accent, c.metal),
  ...chair(0, 0.6, -1, c.accent, c.metal),
], ["cafe"]);

reg("restaurant-table", 1.9, 1.8, (c) => [
  [-0.6, -0.4, 0.6, 0.4, 0.72, 0.76, LINEN],
  [-0.04, -0.04, 0.04, 0.04, 0, 0.72, c.metal],
  ...[-0.3, 0.3].flatMap((x) => [...chair(x, -0.65, 1, c.fabric, c.woodDark), ...chair(x, 0.65, -1, c.fabric, c.woodDark)]),
], ["restaurant"]);

reg("bar", 4.0, 2.0, (c, hw) => [
  [-hw, -0.3, hw, 0.3, 0, 1.08, c.woodDark],
  [-hw - 0.05, -0.35, hw + 0.05, 0.4, 1.08, 1.12, c.stone],
  [-hw, -1.0, hw, -0.7, 0, 2.2, c.wood],
  ...[-1.4, -0.5, 0.4, 1.3].flatMap((x): Part[] => [[x - 0.17, 0.6, x + 0.17, 0.94, 0.72, 0.76, c.accent], [x - 0.02, 0.75, x + 0.02, 0.79, 0, 0.72, c.metal]]),
], ["restaurant", "cafe"]);

reg("shelf-unit", 1.8, 0.55, (c, hw, hd) => {
  const out: Part[] = [[-hw, -hd, hw, hd, 0, 0.1, c.white], [-hw, -0.03, hw, 0.03, 0, 1.7, c.white]];
  for (let k = 0; k < 4; k++) {
    const y = 0.1 + k * 0.4;
    out.push([-hw, -hd, hw, hd, y + 0.34, y + 0.37, c.white]);
    for (const side of [-1, 1]) out.push([-hw + 0.05, side < 0 ? -hd + 0.03 : 0.06, hw - 0.05, side < 0 ? -0.06 : hd - 0.03, y, y + 0.26, BOOKS[(k + (side > 0 ? 1 : 3)) % 5]]);
  }
  return out;
}, ["shop"]);

reg("clothes-rack", 1.5, 0.6, (c, hw) => [
  [-hw, -0.02, hw, 0.02, 1.5, 1.54, c.metal],
  [-hw, -0.02, -hw + 0.04, 0.02, 0, 1.5, c.metal],
  [hw - 0.04, -0.02, hw, 0.02, 0, 1.5, c.metal],
  ...[-0.5, -0.15, 0.2, 0.55].map((x, k): Part => [x - 0.14, -0.25, x + 0.14, 0.25, 0.65, 1.45, [c.accent, c.fabric, c.fabric2, LINEN][k]]),
], ["shop"]);

reg("bike", 1.8, 0.5, (c) => [
  [-0.75, -0.04, -0.15, 0.04, 0.05, 0.65, DARK], [0.15, -0.04, 0.75, 0.04, 0.05, 0.65, DARK],
  [-0.45, -0.03, 0.45, 0.03, 0.5, 0.58, c.accent], [-0.1, -0.03, 0.0, 0.03, 0.35, 0.9, c.accent],
  [0.35, -0.2, 0.42, 0.2, 0.95, 0.99, c.metal],
], ["shop"]);

reg("bank-counter", 4.0, 0.9, (c, hw, hd) => [
  [-hw, -hd, hw, hd, 0, 1.1, c.stone],
  [-hw, -0.03, hw, 0.03, 1.1, 1.9, 0xd9e8ee],
  ...[-1.3, 0, 1.3].map((x): Part => [x - 0.3, -hd + 0.05, x + 0.3, -hd + 0.1, 1.15, 1.5, SCREEN]),
], ["bank"]);

reg("bench-seat", 2.0, 0.5, (c, hw, hd) => [[-hw, -hd, hw, hd, 0.4, 0.46, c.wood], [-hw + 0.1, -0.05, -hw + 0.2, 0.05, 0, 0.4, c.metal], [hw - 0.2, -0.05, hw - 0.1, 0.05, 0, 0.4, c.metal]], ["lobby", "bank"]);

// ---- Warehouse ----------------------------------------------------------------------------------

reg("pallet-rack", 6.0, 1.1, (_c, hw, hd) => {
  const out: Part[] = [];
  for (const x of [-hw, -1, 1, hw - 0.1]) out.push([x, -hd, x + 0.1, hd, 0, 4.4, 0x3f6f9f]);
  for (const h of [0.15, 1.6, 3.0]) {
    out.push([-hw, -hd, hw, hd, h - 0.1, h, 0xd9822b]);
    for (const x of [-2.4, -0.4, 1.6]) out.push([x - 0.5, -hd + 0.1, x + 0.5, hd - 0.1, h, h + 1.0, [0xb48a5a, 0xc9b48e, 0x9a7a52][Math.abs(Math.round(x + h)) % 3]]);
  }
  return out;
}, ["warehouse"]);

reg("forklift", 1.2, 2.4, (c) => [
  [-0.55, -0.6, 0.55, 0.9, 0.2, 1.1, 0xe0a82e], [-0.5, 0.2, 0.5, 0.9, 1.1, 2.1, DARK],
  [-0.45, -1.2, -0.35, -0.6, 0.1, 0.15, c.metal], [0.35, -1.2, 0.45, -0.6, 0.1, 0.15, c.metal], [-0.5, -0.65, 0.5, -0.6, 0.1, 2.4, c.metal],
], ["warehouse"]);

/** Pick a piece name with a tag. */
export function pickFurniture(rng: Rng, tag: string): string {
  return furnitureCatalog.pick(() => rng.next(), tag).name;
}

// ---- Finishes -----------------------------------------------------------------------------------

const WOODS = [0xc49a6c, 0xb07f52, 0xd8b98f, 0x8a6142, 0xcfae84];
const FABRICS = [0x5b6670, 0x8a9a8c, 0xb7a58e, 0x3f4f63, 0xa3574a, 0x7d8f9e, 0xd8cfc0];
const ACCENTS = [0xc9894f, 0x4f7a6e, 0xc4573b, 0x2f5d8f, 0xd9b45a, 0x8a5a7a];
const STONES = [0xe8e4dc, 0xd2cdc4, 0xbfc3c4, 0x9a9b98];

export function finishFor(rng: Rng): Finish {
  const wood = rng.pick(WOODS);
  return {
    wood,
    woodDark: rng.pick([0x6b5440, 0x4a3a2e, 0x3a3f45, 0x7a5a40]),
    fabric: rng.pick(FABRICS),
    fabric2: rng.pick(FABRICS),
    accent: rng.pick(ACCENTS),
    metal: rng.pick([0x2f3438, 0x8f949a, 0xb08d57]),
    white: rng.pick([0xf2f0eb, 0xe6e2da, 0xdfe4e6]),
    stone: rng.pick(STONES),
    plant: rng.pick([0x4f7f3e, 0x5e8f45, 0x3e6b46]),
  };
}

/** Floor finishes by room kind. */
export const FLOORS: Record<string, number[]> = {
  wood: [0xc49a6c, 0xb88d60, 0xd2ae82, 0x9a7352, 0xc8a67c],
  tile: [0xe2e0db, 0xd0d4d6, 0xcfc7ba, 0xb9bfc2],
  carpet: [0x8d939a, 0x7b8691, 0x9a948a, 0x6f7a72],
  stone: [0xd9d3c6, 0xc7c2b8, 0xe4dfd4, 0xb5b2ab],
  concrete: [0xb8b5ae, 0xa9a7a2],
};

/** Wall paint for a building's interiors. */
export const PAINTS = [0xf0eee9, 0xf3efe6, 0xe9ece6, 0xe6ebee, 0xf1e9e1, 0xe4e6df];
