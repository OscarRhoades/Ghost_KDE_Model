/**
 * Walking navigation through streets and buildings: collision with outer walls
 * (with their doorways open), interior walls of the floor you are on, stairs,
 * water and the map edge.
 */
import { edgesOf, doorOn } from "../buildings/kit";
import { shellOf } from "../buildings/shape";
import { defineResource, type World } from "../ecs/world";
import { Building, TerrainR, type BuildingData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { pointInPolygon, type P2 } from "../geom/polygon";
import { FootprintGrid } from "../physics/collision";
import { pushOut, SegmentGrid, type Segment } from "../physics/walls";
import { onStair, planBuilding, stairCoords, stairHeight, type BuildingPlan } from "./plan";

export interface WalkPose {
  x: number;
  z: number;
  /** Feet elevation. */
  y: number;
  floor: number;
  building: BuildingData | null;
}

export interface Navigator {
  /** Move the walker by (dx, dz), sliding along walls, then settle its height and floor. */
  move(pose: WalkPose, dx: number, dz: number, radius: number): void;
  /** Recompute building, floor and height for the current position. */
  settle(pose: WalkPose): void;
  plan(b: BuildingData): BuildingPlan;
  buildingAt(x: number, z: number): BuildingData | null;
  /** Building whose front door is within `r` meters, if any. */
  entranceNear(x: number, z: number, r: number): BuildingData | null;
}

export const NavR = defineResource<Navigator>("Navigator");
/** The walker's current pose, published by the walk camera while walking. */
export const WalkerR = defineResource<WalkPose>("Walker");

/** Longest single collision step, so fast walkers can't tunnel through walls. */
const SUBSTEP = 0.2;
const PLAN_CACHE = 16;

function edgeSegments(poly: readonly P2[], owner: unknown, door?: BuildingData["entrance"]): Segment[] {
  const out: Segment[] = [];
  for (const e of edgesOf(poly)) {
    const d = doorOn(e, door);
    const piece = (s0: number, s1: number) => {
      if (s1 - s0 < 0.01) return;
      out.push({
        ax: e.a[0] + e.tx * s0,
        az: e.a[1] + e.tz * s0,
        bx: e.a[0] + e.tx * s1,
        bz: e.a[1] + e.tz * s1,
        owner,
      });
    };
    if (d) {
      piece(0, d.s0);
      piece(d.s1, e.len);
    } else piece(0, e.len);
  }
  return out;
}

export function createNavigator(world: World): Navigator {
  const footprints = new FootprintGrid();
  const owners = new Map<readonly P2[], BuildingData>();
  const outer = new SegmentGrid();
  const doors = new SegmentGrid(32);
  for (const e of world.query(Building)) {
    const b = world.read(e, Building);
    footprints.add(b.footprint);
    owners.set(b.footprint, b);
    for (const s of edgeSegments(shellOf(b, 0), b, b.entrance)) outer.add(s);
    if (b.entrance) doors.add({ ax: b.entrance.x, az: b.entrance.z, bx: b.entrance.x, bz: b.entrance.z, owner: b });
  }

  const plans = new Map<BuildingData, BuildingPlan>();
  const plan = (b: BuildingData) => {
    let p = plans.get(b);
    if (!p) {
      p = planBuilding(b);
      plans.set(b, p);
      if (plans.size > PLAN_CACHE) plans.delete(plans.keys().next().value!);
    }
    return p;
  };

  // Interior walls of the floor you are on (lintels over doorways don't block).
  const floorSegs = new Map<string, Segment[]>();
  const interiorWalls = (b: BuildingData, f: number): Segment[] => {
    const key = `${b.seed}:${f}`;
    let segs = floorSegs.get(key);
    if (!segs) {
      const fp = plan(b).floors[f];
      segs = fp.walls.filter((w) => w.y0 <= fp.y + 0.5).map((w) => ({ ax: w.a[0], az: w.a[1], bx: w.b[0], bz: w.b[1] }));
      // Above the ground floor the outer wall is closed all round.
      if (f > 0) segs.push(...edgeSegments(fp.shell, b));
      floorSegs.set(key, segs);
      if (floorSegs.size > 64) floorSegs.delete(floorSegs.keys().next().value!);
    }
    return segs;
  };

  const buildingAt = (x: number, z: number) => {
    for (const poly of footprints.near(x, z, 0)) if (pointInPolygon(x, z, poly)) return owners.get(poly)!;
    return null;
  };

  const settle = (pose: WalkPose) => {
    const { hf } = world.resource(TerrainR);
    // Upstairs you stay in your building (cantilevers reach past the footprint).
    const b = pose.building && pose.floor > 0 ? pose.building : buildingAt(pose.x, pose.z);
    if (b !== pose.building) {
      pose.building = b;
      pose.floor = 0;
    }
    if (!b) {
      pose.y = hf.heightAt(pose.x, pose.z);
      return;
    }
    const p = plan(b);
    pose.floor = Math.min(pose.floor, p.floors.length - 1);
    if (p.stair) {
      const c = stairCoords(p.stair, pose.x, pose.z);
      if (onStair(c)) {
        const s = stairHeight(p, c, pose.y);
        pose.y = s.y;
        pose.floor = s.floor;
        return;
      }
    }
    pose.y = p.floors[pose.floor].y;
  };

  const move = (pose: WalkPose, dx: number, dz: number, radius: number) => {
    const { hf, waterLevel } = world.resource(TerrainR);
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SUBSTEP));
    for (let k = 0; k < steps; k++) {
      let nx = pose.x + dx / steps;
      let nz = pose.z + dz / steps;
      const inside = pose.building;
      let segs = outer.near(nx, nz, radius + 1);
      if (inside && pose.floor > 0) segs = segs.filter((s) => s.owner !== inside);
      if (inside) segs = segs.concat(interiorWalls(inside, pose.floor));
      [nx, nz] = pushOut(nx, nz, radius, segs);
      const outdoors = !(inside && pose.floor > 0) && !buildingAt(nx, nz);
      if (outdoors) {
        const wet = waterLevel !== undefined && hf.heightAt(nx, nz) < waterLevel + 0.2;
        const off = nx < 0.5 || nz < 0.5 || nx > hf.width - 0.5 || nz > hf.depth - 0.5;
        if (wet || off) break;
      }
      pose.x = nx;
      pose.z = nz;
      settle(pose);
    }
  };

  const entranceNear = (x: number, z: number, r: number) => {
    let best: BuildingData | null = null;
    let bestD = r;
    for (const s of doors.near(x, z, r)) {
      const d = Math.hypot(s.ax - x, s.az - z);
      if (d < bestD) {
        bestD = d;
        best = s.owner as BuildingData;
      }
    }
    return best;
  };

  return { move, settle, plan, buildingAt, entranceNear };
}

/** Installs the navigator for walking; rebuilt for each city. */
export function navigation(): Plugin {
  return {
    name: "navigation",
    install(engine) {
      engine.addSystem({
        name: "navigation",
        onLoad(world) {
          world.setResource(NavR, createNavigator(world));
        },
      });
    },
  };
}
