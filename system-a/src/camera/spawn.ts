/** Where a walker appears when dropping into the city at a requested point. */
import type { World } from "../ecs/world";
import { Building, RoadEdge, TerrainR } from "../engine/components";
import { FootprintGrid } from "../physics/collision";
import { densify, edgePath } from "../roads/path";

export interface SpawnPoint {
  x: number;
  z: number;
  /** Heading in radians; 0 looks toward -z (north), positive turns left (west). */
  yaw: number;
}

/** Walker radius in meters. */
export const WALKER_RADIUS = 0.35;

export function buildFootprintGrid(world: World): FootprintGrid {
  const grid = new FootprintGrid();
  for (const e of world.query(Building)) grid.add(world.read(e, Building).footprint);
  return grid;
}

/**
 * Snap a requested point to the nearest sidewalk within `searchRadius`, facing
 * along the street. Falls back to the point itself, pushed clear of buildings.
 */
export function findSpawn(world: World, grid: FootprintGrid, x: number, z: number, searchRadius = 120): SpawnPoint {
  let best: { d: number; p: SpawnPoint } | null = null;
  for (const e of world.query(RoadEdge)) {
    const r = world.read(e, RoadEdge);
    const path = densify(edgePath(world, r), 4);
    for (let k = 1; k < path.length; k++) {
      const [ax, , az] = path[k - 1];
      const [bx, , bz] = path[k];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (d > searchRadius || (best && d >= best.d)) continue;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      // Stand on the sidewalk on the side nearer the requested point.
      const side = (x - mx) * -dz + (z - mz) * dx >= 0 ? 1 : -1;
      const off = r.width / 2 + Math.max(r.sidewalk / 2, 0.8);
      best = {
        d,
        p: { x: mx - dz * off * side, z: mz + dx * off * side, yaw: Math.atan2(-dx, -dz) },
      };
    }
  }
  const p = best?.p ?? { x, z, yaw: 0 };
  const { hf } = world.resource(TerrainR);
  const cx = Math.min(hf.width - 1, Math.max(1, p.x));
  const cz = Math.min(hf.depth - 1, Math.max(1, p.z));
  const [sx, sz] = grid.resolve(cx, cz, WALKER_RADIUS);
  return { x: sx, z: sz, yaw: p.yaw };
}
