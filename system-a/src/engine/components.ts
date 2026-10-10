/** Core components and resources shared by the built-in plugins. */
import type { Object3D } from "three";
import { defineComponent, defineResource, type Entity } from "../ecs/world";
import type { CityFile, RoadKind, Zone } from "../format/schema";
import type { P2 } from "../geom/polygon";
import type { Heightfield } from "../terrain/heightfield";

/** Stable id from the city file. */
export const SourceId = defineComponent<string>("SourceId");

export interface RoadNodeData {
  x: number;
  z: number;
  y: number;
  /** Whether `y` was fixed by the file (vs derived from terrain). */
  fixedY: boolean;
}
export const RoadNode = defineComponent<RoadNodeData>("RoadNode");

export interface RoadEdgeData {
  a: Entity;
  b: Entity;
  kind: RoadKind;
  width: number;
  sidewalk: number;
  /** Intermediate points from the file (excluding the end nodes). */
  via: [number, number][];
  /** Width/sidewalk as written in the file, to round-trip defaults faithfully. */
  explicit: { width?: number; sidewalk?: number };
}
export const RoadEdge = defineComponent<RoadEdgeData>("RoadEdge");

export interface ParcelData {
  polygon: P2[];
  zone: Zone;
  /** Pad elevation (resolved during load). */
  elevation: number;
  fixedElevation: boolean;
}
export const Parcel = defineComponent<ParcelData>("Parcel");

export interface BuildingData {
  parcel?: Entity;
  footprint: P2[];
  floors: number;
  floorHeight: number;
  roof: "flat" | "gable" | "hip" | "shed";
  style: string;
  seed: number;
  /** Ground floor elevation (resolved during load). */
  baseY: number;
  /** Raw optional fields as written, for faithful saving. */
  explicit: { floorHeight?: number; roof?: string; style?: string; seed?: number };
}
export const Building = defineComponent<BuildingData>("Building");

/** Scene objects owned by an entity (removed when the city unloads). */
export const SceneObject = defineComponent<Object3D>("SceneObject");

export interface TerrainState {
  /** Conformed heights the city stands on. */
  hf: Heightfield;
  /** Natural heights exactly as loaded (saved back unchanged). */
  source: CityFile["terrain"];
  /** Per-sample `Surface` kind, same layout as `hf.data`. */
  surface: Uint8Array;
  waterLevel?: number;
}
export const TerrainR = defineResource<TerrainState>("Terrain");

/** The loaded file's metadata and plugin extensions. */
export const CityR = defineResource<Pick<CityFile, "meta" | "extensions">>("City");

/** File id -> entity, per section ("road-node", "parcel", ...). */
export const IdIndexR = defineResource<Map<string, Entity>>("IdIndex");

/**
 * Point the view is centered on, and roughly how far it can see. Cameras write it;
 * the renderer uses it to fit the shadow map and later systems to stream detail.
 */
export interface FocusData {
  x: number;
  y: number;
  z: number;
  radius: number;
}
export const FocusR = defineResource<FocusData>("Focus");

export function indexKey(section: string, id: string): string {
  return `${section}:${id}`;
}
