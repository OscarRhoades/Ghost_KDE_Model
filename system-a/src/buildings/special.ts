/**
 * Per-style overrides for buildings that are not ordinary floor stacks
 * (landmarks): their outline, walkable floors and how their halls are
 * furnished. Kept dependency-free so massing, plans and styles can all use it.
 */
import type { BuildingData } from "../engine/components";
import type { P2 } from "../geom/polygon";

/** What a furnishing function can place, in the plan's local frame (meters). */
export interface FurnishApi {
  /** Lot size along x (long side) and y. */
  U: number;
  V: number;
  box(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, color: number): void;
  wall(x0: number, y0: number, x1: number, y1: number, doors?: number[], height?: number): void;
  room(x0: number, y0: number, x1: number, y1: number, kind: string): void;
  /** Local position of a world point. */
  local(p: P2): [number, number];
  /** The stairwell's local rectangle [x0, y0, x1, y1], if the building has stairs. */
  stair: [number, number, number, number] | null;
}

export interface SpecialInfo {
  /** Walkable floors (default: the building's floors). */
  floors?(b: BuildingData): number;
  /** Height of one walkable floor (default: the building's floor height). */
  floorHeight?(b: BuildingData): number;
  /** Ground outline, when it is not the lot footprint. */
  shell?(b: BuildingData): P2[];
  /** Further solid parts at ground level (e.g. a tower) that block walking. */
  solids?(b: BuildingData): P2[][];
  /** No flat ceiling on the top floor: the roof structure is visible inside. */
  openCeiling?: boolean;
  glazing?: "full" | "punched" | "solid";
  /** Room label for the HUD. */
  room?: string;
  furnish?(api: FurnishApi, floor: number, b: BuildingData): void;
}

export const specialInfo = new Map<string, SpecialInfo>();
