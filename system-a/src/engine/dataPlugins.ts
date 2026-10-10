/**
 * Loaders for the core sections of a city file. They only create entities and
 * resources (no rendering), so they run headless in tests and tools.
 */
import type { World } from "../ecs/world";
import {
  DEFAULT_FLOOR_HEIGHT,
  ROAD_DEFAULTS,
  type CityFile,
} from "../format/schema";
import { bounds, centroid, pointInPolygon, type P2 } from "../geom/polygon";
import { gradeSegment, flattenPolygon, Surface } from "../terrain/conform";
import { Heightfield } from "../terrain/heightfield";
import { edgePath } from "../roads/path";
import {
  Building,
  IdIndexR,
  Parcel,
  RoadEdge,
  RoadNode,
  SourceId,
  TerrainR,
  indexKey,
} from "./components";
import { LoadOrder, type Engine, type Plugin } from "./engine";

/** Blend distances (meters) from flattened ground back to natural terrain. */
const PAD_BLEND = 10;
const ROAD_BLEND = 14;
/** Keep built ground at least this far above the water surface. */
const DRY_MARGIN = 0.6;
/** Coarser terrain is upsampled to this cell size (meters) on load. */
const MAX_TERRAIN_CELL = 8;

export function terrainData(): Plugin {
  return {
    name: "terrain-data",
    install(engine: Engine) {
      engine.addLoader({
        name: "terrain",
        order: LoadOrder.terrain,
        load(world, city) {
          const hf = Heightfield.fromTerrain(city.terrain).refined(MAX_TERRAIN_CELL);
          world.setResource(TerrainR, {
            hf,
            source: city.terrain,
            surface: new Uint8Array(hf.data.length),
            waterLevel: city.terrain.waterLevel,
          });
        },
        save(world, out) {
          out.terrain = structuredClone(world.resource(TerrainR).source);
        },
      });
    },
  };
}

/** Elevation for built ground derived from natural terrain. */
function groundLevel(world: World, points: readonly P2[]): number {
  const { hf, waterLevel } = world.resource(TerrainR);
  const c = centroid(points);
  let sum = hf.heightAt(c[0], c[1]);
  for (const [x, z] of points) sum += hf.heightAt(x, z);
  const y = sum / (points.length + 1);
  return waterLevel === undefined ? y : Math.max(y, waterLevel + DRY_MARGIN);
}

export function roadsData(): Plugin {
  return {
    name: "roads-data",
    install(engine) {
      engine.addLoader({
        name: "roads",
        order: LoadOrder.roads,
        load(world, city) {
          const index = world.resource(IdIndexR);
          const { hf, waterLevel } = world.resource(TerrainR);
          for (const n of city.roads.nodes) {
            const e = world.spawn();
            let y = n.y ?? hf.averageAround(n.p[0], n.p[1], 16);
            if (n.y === undefined && waterLevel !== undefined) y = Math.max(y, waterLevel + DRY_MARGIN);
            world.add(e, SourceId, n.id).add(e, RoadNode, { x: n.p[0], z: n.p[1], y, fixedY: n.y !== undefined });
            index.set(indexKey("road-node", n.id), e);
          }
          for (const r of city.roads.edges) {
            const e = world.spawn();
            const d = ROAD_DEFAULTS[r.kind];
            world.add(e, SourceId, r.id).add(e, RoadEdge, {
              a: index.get(indexKey("road-node", r.a))!,
              b: index.get(indexKey("road-node", r.b))!,
              kind: r.kind,
              width: r.width ?? d.width,
              sidewalk: r.sidewalk ?? d.sidewalk,
              via: (r.via ?? []).map((p) => [p[0], p[1]] as [number, number]),
              explicit: { width: r.width, sidewalk: r.sidewalk },
            });
            index.set(indexKey("road-edge", r.id), e);
          }
        },
        save(world, out) {
          for (const e of world.query(RoadNode, SourceId)) {
            const n = world.read(e, RoadNode);
            out.roads.nodes.push({ id: world.read(e, SourceId), p: [n.x, n.z], ...(n.fixedY ? { y: n.y } : {}) });
          }
          for (const e of world.query(RoadEdge, SourceId)) {
            const r = world.read(e, RoadEdge);
            out.roads.edges.push({
              id: world.read(e, SourceId),
              a: world.read(r.a, SourceId),
              b: world.read(r.b, SourceId),
              kind: r.kind,
              ...(r.explicit.width !== undefined ? { width: r.explicit.width } : {}),
              ...(r.explicit.sidewalk !== undefined ? { sidewalk: r.explicit.sidewalk } : {}),
              ...(r.via.length ? { via: r.via.map((p) => [p[0], p[1]] as [number, number]) } : {}),
            });
          }
        },
      });
    },
  };
}

export function parcelsData(): Plugin {
  return {
    name: "parcels-data",
    install(engine) {
      engine.addLoader({
        name: "parcels",
        order: LoadOrder.parcels,
        load(world, city) {
          const index = world.resource(IdIndexR);
          for (const p of city.parcels) {
            const e = world.spawn();
            world.add(e, SourceId, p.id).add(e, Parcel, {
              polygon: p.polygon.map((q) => [q[0], q[1]] as const),
              zone: p.zone,
              elevation: p.elevation ?? groundLevel(world, p.polygon),
              fixedElevation: p.elevation !== undefined,
            });
            index.set(indexKey("parcel", p.id), e);
          }
        },
        save(world, out) {
          for (const e of world.query(Parcel, SourceId)) {
            const p = world.read(e, Parcel);
            out.parcels.push({
              id: world.read(e, SourceId),
              polygon: p.polygon.map((q) => [q[0], q[1]]),
              zone: p.zone,
              ...(p.fixedElevation ? { elevation: p.elevation } : {}),
            });
          }
        },
      });
    },
  };
}

/** FNV-1a hash of a string, for default per-building seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

export function buildingsData(): Plugin {
  return {
    name: "buildings-data",
    install(engine) {
      engine.addLoader({
        name: "buildings",
        order: LoadOrder.buildings,
        load(world, city) {
          const index = world.resource(IdIndexR);
          for (const b of city.buildings) {
            const e = world.spawn();
            const parcel = b.parcel !== undefined ? index.get(indexKey("parcel", b.parcel)) : undefined;
            const baseY = parcel !== undefined ? world.read(parcel, Parcel).elevation : groundLevel(world, b.footprint);
            world.add(e, SourceId, b.id).add(e, Building, {
              parcel,
              footprint: b.footprint.map((q) => [q[0], q[1]] as const),
              floors: b.floors,
              floorHeight: b.floorHeight ?? DEFAULT_FLOOR_HEIGHT,
              roof: b.roof ?? "flat",
              style: b.style ?? "default",
              seed: b.seed ?? hashString(b.id),
              baseY,
              explicit: { floorHeight: b.floorHeight, roof: b.roof, style: b.style, seed: b.seed },
            });
            index.set(indexKey("building", b.id), e);
          }
        },
        save(world, out) {
          for (const e of world.query(Building, SourceId)) {
            const b = world.read(e, Building);
            const x = b.explicit;
            out.buildings.push({
              id: world.read(e, SourceId),
              ...(b.parcel !== undefined ? { parcel: world.read(b.parcel, SourceId) } : {}),
              footprint: b.footprint.map((q) => [q[0], q[1]]),
              floors: b.floors,
              ...(x.floorHeight !== undefined ? { floorHeight: x.floorHeight } : {}),
              ...(x.roof !== undefined ? { roof: x.roof as CityFile["buildings"][number]["roof"] } : {}),
              ...(x.style !== undefined ? { style: x.style } : {}),
              ...(x.seed !== undefined ? { seed: x.seed } : {}),
            });
          }
        },
      });
    },
  };
}

/**
 * Shapes the terrain to the city: flat pads under parcels (parks keep their
 * natural contours), graded corridors under roads.
 */
export function terrainConform(): Plugin {
  return {
    name: "terrain-conform",
    install(engine) {
      engine.addLoader({
        name: "conform",
        order: LoadOrder.conform,
        load(world) {
          const { hf, surface } = world.resource(TerrainR);
          for (const e of world.query(Parcel)) {
            const p = world.read(e, Parcel);
            if (p.zone === "park") {
              markPolygon(hf, p.polygon, surface, Surface.park);
            } else {
              flattenPolygon(hf, p.polygon, p.elevation, PAD_BLEND, surface, p.zone === "plaza" ? Surface.plaza : Surface.pad);
            }
          }
          for (const e of world.query(Building)) {
            const b = world.read(e, Building);
            if (b.parcel === undefined) flattenPolygon(hf, b.footprint, b.baseY, PAD_BLEND, surface);
          }
          for (const e of world.query(RoadEdge)) {
            const r = world.read(e, RoadEdge);
            const path = edgePath(world, r);
            const half = r.width / 2 + r.sidewalk;
            for (let k = 1; k < path.length; k++) gradeSegment(hf, path[k - 1], path[k], half, ROAD_BLEND, surface);
          }
          // Junctions: flatten a disc as wide as the widest road meeting there.
          const radius = new Map<number, number>();
          for (const e of world.query(RoadEdge)) {
            const r = world.read(e, RoadEdge);
            const half = r.width / 2 + r.sidewalk;
            for (const n of [r.a, r.b]) radius.set(n, Math.max(radius.get(n) ?? 0, half));
          }
          for (const [n, rad] of radius) {
            const { x, y, z } = world.read(n, RoadNode);
            gradeSegment(hf, [x, y, z], [x, y, z], rad, ROAD_BLEND, surface);
          }
        },
      });
    },
  };
}

/** Tag samples inside `poly` with a surface kind, leaving heights untouched. */
function markPolygon(hf: Heightfield, poly: readonly P2[], surface: Uint8Array, kind: number) {
  const b = bounds(poly);
  const r = hf.rangeFor(b.minX, b.minZ, b.maxX, b.maxZ);
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      if (pointInPolygon(i * hf.cellX, j * hf.cellZ, poly)) surface[hf.index(i, j)] = kind;
    }
  }
}

/** Every core data plugin, in dependency order. */
export function coreDataPlugins(): Plugin[] {
  return [terrainData(), roadsData(), parcelsData(), buildingsData(), terrainConform()];
}
