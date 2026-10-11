/**
 * Front doors: each building gets an entrance in the middle of the outer wall
 * that faces the nearest street. Derived on load, never saved.
 */
import { edgesOf } from "../buildings/kit";
import { shellOf } from "../buildings/massing";
import { Building, RoadEdge, type BuildingData, type Entrance } from "../engine/components";
import { LoadOrder, type Plugin } from "../engine/engine";
import { segmentDistance } from "../geom/polygon";
import { SegmentGrid, type Segment } from "../physics/walls";
import { edgePath } from "../roads/path";

/** Door width and height by building style. */
export function doorSize(style: string): { width: number; height: number } {
  switch (style) {
    case "suburban-house":
      return { width: 1.1, height: 2.3 };
    case "industrial":
      return { width: 4.4, height: 4.6 };
    case "glass-tower":
    case "civic":
      return { width: 2.4, height: 2.8 };
    default:
      return { width: 1.6, height: 2.4 };
  }
}

export function chooseEntrance(b: BuildingData, roads: SegmentGrid): Entrance | undefined {
  const { width, height } = doorSize(b.style);
  const edges = edgesOf(shellOf(b, 0)).filter((e) => e.len >= width + 1.2);
  if (edges.length === 0) return undefined;
  const distToRoad = (x: number, z: number) => {
    for (const r of [40, 120, 400]) {
      const near = roads.near(x, z, r);
      if (near.length) return Math.min(...near.map((s) => segmentDistance(x, z, s.ax, s.az, s.bx, s.bz).d));
    }
    return Infinity;
  };
  let best = edges[0];
  let bestD = Infinity;
  for (const e of edges) {
    const d = distToRoad((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2);
    if (d < bestD - 0.5) {
      best = e;
      bestD = d;
    }
  }
  return {
    x: (best.a[0] + best.b[0]) / 2,
    z: (best.a[1] + best.b[1]) / 2,
    tx: best.tx,
    tz: best.tz,
    width,
    height,
    y: b.baseY,
  };
}

export function frontage(): Plugin {
  return {
    name: "frontage",
    install(engine) {
      engine.addLoader({
        name: "frontage",
        order: LoadOrder.frontage,
        load(world) {
          const roads = new SegmentGrid(64);
          for (const e of world.query(RoadEdge)) {
            const path = edgePath(world, world.read(e, RoadEdge));
            for (let k = 1; k < path.length; k++) {
              const s: Segment = { ax: path[k - 1][0], az: path[k - 1][2], bx: path[k][0], bz: path[k][2] };
              roads.add(s);
            }
          }
          for (const e of world.query(Building)) {
            const b = world.read(e, Building);
            b.entrance = chooseEntrance(b, roads);
          }
        },
      });
    },
  };
}
