/**
 * A building's "look": its palette (unique per building), facade system with
 * its parameters, and roof. Chosen once from the style recipe and the seed,
 * then shared by the exterior, the massing view and the interiors.
 */
import { Color } from "three";
import type { BuildingData } from "../engine/components";
import { rngFor, type Rng } from "./kit";

export interface Palette {
  wall: Color;
  wall2: Color;
  glass: Color;
  frame: Color;
  accent: Color;
  roof: Color;
  trim: Color;
}

const hex = (h: string) => new Color(h);
export const SWATCH = {
  // A painted, sunlit palette: warm stone and cream, saturated clay and
  // timber, teal-blue glass and slate-blue darks instead of neutral greys.
  glass: ["#7cc2d8", "#6ab4cc", "#86cad9", "#73b9c9", "#8fd0dc", "#68aac4", "#7fbcd0", "#74b0cc"].map(hex),
  glassWarm: ["#c9b98a", "#bfae80", "#d4c495"].map(hex),
  glassLight: hex("#8ccbe0"),
  railing: hex("#8fc2d4"),
  frame: ["#2f3a47", "#3d4a5a", "#9aa8b3", "#6b5a48", "#d8d0c0"].map(hex),
  white: ["#f4ead8", "#efe3cc", "#f7f0e2", "#ecdcc2"].map(hex),
  concrete: ["#d9cdb6", "#cbbfa8", "#e0d6c2", "#bfb29a"].map(hex),
  warm: ["#e8c99a", "#dcb380", "#efd6ae", "#d9a877", "#e6be8e"].map(hex),
  pastel: ["#a8d0c8", "#f0c7a8", "#b8c8e8", "#f2d79a", "#c8dca0", "#e8b8b0"].map(hex),
  brick: ["#b5553a", "#c4683f", "#9e4530", "#cf7a4e", "#a85a45", "#d08a5a", "#8a4a3e"].map(hex),
  charcoal: ["#3a4552", "#465566", "#2f3a47", "#4d5a6b"].map(hex),
  timber: ["#c47f45", "#d4924f", "#a8693a", "#e0a865", "#93582f"].map(hex),
  terracotta: ["#d0683c", "#e07e4a", "#c45a34", "#e89660"].map(hex),
  cladding: ["#7fa3b8", "#c9b98e", "#7f9f8f", "#a8b4bf", "#4f7590", "#6f8f6a", "#b89a72"].map(hex),
  accent: ["#f0b43c", "#e0603a", "#2fa3a8", "#6fae4a", "#e8cf45", "#8a6ac0", "#2f7fc4"].map(hex),
  roof: hex("#cdbfa6"),
  roofs: ["#cdbfa6", "#c08a6a", "#8fa0b3", "#aebe9a", "#d2ab7e", "#9aaeb8", "#b9776a"].map(hex),
  roofDark: hex("#3d4d63"),
  green: hex("#6f9d50"),
  solar: hex("#2d4a78"),
  door: hex("#3a2e28"),
};

/** A color picked from a swatch and nudged so no two buildings match exactly. */
export function tint(rng: Rng, options: Color[], amount = 1): Color {
  const c = rng.pick(options).clone();
  return c.offsetHSL(rng.range(-0.015, 0.015) * amount, rng.range(-0.04, 0.04) * amount, rng.range(-0.04, 0.04) * amount);
}

/** A seeded random stream for one aspect of a building's look. */
export const lookRng = (b: BuildingData, salt: number): Rng => rngFor(b.seed ^ salt);
