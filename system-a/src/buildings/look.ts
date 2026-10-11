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
  glass: ["#8fb3c9", "#7ea5bd", "#9dbccc", "#7598ad", "#a6c2cf", "#88a9b5", "#94aeb0", "#a3b6c4", "#6f8ea3"].map(hex),
  glassWarm: ["#b6b39f", "#a9a48c", "#c0b9a2"].map(hex),
  glassLight: hex("#b3cad6"),
  railing: hex("#9fb6c2"),
  frame: ["#2b3035", "#3a3f45", "#8e979d", "#5c544b", "#b7b2a8"].map(hex),
  white: ["#eeece6", "#e6e3db", "#f2f1ee", "#e9e6df"].map(hex),
  concrete: ["#c8c5be", "#b9b6ae", "#d2cfc8", "#a9a69f"].map(hex),
  warm: ["#d9cbb6", "#cdbba3", "#e1d6c4", "#c9b597", "#d8c3a5"].map(hex),
  pastel: ["#c9d6cf", "#d8cfc4", "#cfd3dc", "#e0d2c0", "#c7cdb8"].map(hex),
  brick: ["#8a4b37", "#9b573d", "#6e3f31", "#a8664a", "#7b4a3b", "#b07a5a", "#5e4a42"].map(hex),
  charcoal: ["#3a3c3f", "#45474a", "#2f3134", "#4a4f55"].map(hex),
  timber: ["#a3734c", "#b58258", "#8f6342", "#c49a6c", "#7d5a3c"].map(hex),
  terracotta: ["#b5653f", "#c47a52", "#a5573a", "#d08c62"].map(hex),
  cladding: ["#8d979e", "#b3ab98", "#7f8b84", "#a4a9ad", "#5f6d78", "#6d7b6f", "#9a8e7c"].map(hex),
  accent: ["#d9a441", "#c4573b", "#3f7f8c", "#5f8a4e", "#c9b23f", "#7c5c9a", "#2f6e9e"].map(hex),
  roof: hex("#b3b4b2"),
  roofDark: hex("#3e4246"),
  green: hex("#7fa46a"),
  solar: hex("#34445e"),
  door: hex("#2e2a27"),
};

/** A color picked from a swatch and nudged so no two buildings match exactly. */
export function tint(rng: Rng, options: Color[], amount = 1): Color {
  const c = rng.pick(options).clone();
  return c.offsetHSL(rng.range(-0.015, 0.015) * amount, rng.range(-0.04, 0.04) * amount, rng.range(-0.04, 0.04) * amount);
}

/** A seeded random stream for one aspect of a building's look. */
export const lookRng = (b: BuildingData, salt: number): Rng => rngFor(b.seed ^ salt);
