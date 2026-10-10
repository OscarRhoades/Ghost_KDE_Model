import type { World } from "../ecs/world";
import { RoadNode, type RoadEdgeData } from "../engine/components";

export type P3 = [number, number, number];

/**
 * Polyline for an edge, end nodes included, with elevation interpolated
 * linearly by arc length between the two node elevations.
 */
export function edgePath(world: World, edge: RoadEdgeData): P3[] {
  const a = world.read(edge.a, RoadNode);
  const b = world.read(edge.b, RoadNode);
  const pts: [number, number][] = [[a.x, a.z], ...edge.via, [b.x, b.z]];
  const cum = [0];
  for (let k = 1; k < pts.length; k++) {
    cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  }
  const total = cum[cum.length - 1] || 1;
  return pts.map(([x, z], k) => [x, a.y + (b.y - a.y) * (cum[k] / total), z]);
}

/** Resample a polyline so no segment is longer than `step`. */
export function densify(path: P3[], step: number): P3[] {
  const out: P3[] = [path[0]];
  for (let k = 1; k < path.length; k++) {
    const [x0, y0, z0] = path[k - 1];
    const [x1, y1, z1] = path[k];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t]);
    }
  }
  return out;
}
