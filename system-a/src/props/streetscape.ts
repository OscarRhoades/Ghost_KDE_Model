/**
 * Street dressing: furniture placed along every street when a city loads,
 * from the road network, junctions and front doors. Deterministic; never
 * saved (the file's `streetscape` settings switch kinds on or off).
 */
import { Building, CityR, Prop, RoadEdge, TerrainR, type PropData } from "../engine/components";
import { LoadOrder, type Plugin } from "../engine/engine";
import type { Entity, World } from "../ecs/world";
import { pointInPolygon } from "../geom/polygon";
import { FootprintGrid } from "../physics/collision";
import { densify, edgePath } from "../roads/path";
import { groundPlans } from "../buildings/massing";
import { carKind } from "./landscape";

/** Sidewalk surface above the road, matching the road view. */
export const CURB = 0.22;

interface Placement {
  kind: string;
  x: number;
  z: number;
  rot: number;
  lift: number;
  optional: boolean;
}

/** Heading that turns a prop's +z toward (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function placeStreetscape(world: World): Placement[] {
  const city = world.getResource(CityR);
  const opts = { trees: true, lamps: true, furniture: true, parking: true, density: 1, ...(city?.streetscape ?? {}) };
  const { hf, waterLevel } = world.resource(TerrainR);
  const out: Placement[] = [];

  // Where props may not go: inside buildings, in front of doors, in water.
  const blocked = new FootprintGrid(32);
  const doors: [number, number][] = [];
  for (const e of world.query(Building)) {
    const b = world.read(e, Building);
    for (const plan of groundPlans(b)) blocked.add(plan);
    if (b.entrance) doors.push([b.entrance.x, b.entrance.z]);
  }
  const doorGrid = new Map<string, [number, number][]>();
  for (const d of doors) {
    const k = `${Math.floor(d[0] / 16)},${Math.floor(d[1] / 16)}`;
    (doorGrid.get(k) ?? doorGrid.set(k, []).get(k)!).push(d);
  }
  const nearDoor = (x: number, z: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const [dx, dz] of doorGrid.get(`${Math.floor(x / 16) + i},${Math.floor(z / 16) + j}`) ?? []) if (Math.hypot(dx - x, dz - z) < 3) return true;
    }
    return false;
  };
  const ok = (x: number, z: number) =>
    x > 1 && z > 1 && x < hf.width - 1 && z < hf.depth - 1 &&
    (waterLevel === undefined || hf.heightAt(x, z) > waterLevel + 0.3) &&
    !nearDoor(x, z) &&
    !blocked.near(x, z, 1).some((poly) => pointInPolygon(x, z, poly));
  const add = (kind: string, x: number, z: number, rot: number, lift: number, optional: boolean) => {
    if (ok(x, z)) out.push({ kind, x, z, rot, lift, optional });
  };

  // Junction sizes, as in the road view.
  const radius = new Map<Entity, number>();
  const degree = new Map<Entity, number>();
  const avenueAt = new Set<Entity>();
  for (const e of world.query(RoadEdge)) {
    const r = world.read(e, RoadEdge);
    for (const n of [r.a, r.b]) {
      radius.set(n, Math.max(radius.get(n) ?? 0, r.width / 2));
      degree.set(n, (degree.get(n) ?? 0) + 1);
      if (r.kind === "avenue") avenueAt.add(n);
    }
  }

  const treeKinds = ["tree-plane", "tree-birch", "tree-cherry", "tree-oak"];
  const spacing = (m: number) => m / Math.max(0.2, opts.density);

  for (const e of world.query(RoadEdge)) {
    const r = world.read(e, RoadEdge);
    if (r.kind === "highway" || r.kind === "path") continue;
    const path = densify(edgePath(world, r), 2);
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][2] - path[k - 1][2]));
    const L = cum[cum.length - 1];
    const trimA = (degree.get(r.a) ?? 0) > 1 ? (radius.get(r.a) ?? 0) + r.sidewalk + 4 : 2;
    const trimB = (degree.get(r.b) ?? 0) > 1 ? (radius.get(r.b) ?? 0) + r.sidewalk + 4 : 2;
    if (L - trimA - trimB < 6) continue;
    const at = (t: number) => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < t) k++;
      const f = (t - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      const [x0, , z0] = path[k - 1];
      const [x1, , z1] = path[k];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1;
      const tx = (x1 - x0) / len;
      const tz = (z1 - z0) / len;
      return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, tx, tz, nx: -tz, nz: tx };
    };
    const half = r.width / 2;
    const seed = Math.round(path[0][0] * 7 + path[0][2] * 13);
    const place = (kind: string, t: number, side: number, offset: number, mode: "road" | "along" | "travel", optional: boolean, lift = CURB) => {
      const p = at(t);
      const x = p.x + p.nx * side * offset;
      const z = p.z + p.nz * side * offset;
      const rot = mode === "road" ? facing(-p.nx * side, -p.nz * side) : mode === "travel" ? facing(p.tx * side, p.tz * side) : Math.atan2(-p.tz, p.tx);
      add(kind, x, z, rot, lift, optional);
    };
    if (r.tram) {
      // Overhead line poles between the tracks, stops at the curb, and the odd tram.
      for (let t = trimA + 6; t < L - trimB - 2; t += spacing(35)) place("catenary-pole", t, 1, 0, "travel", false, 0.1);
      if (L - trimA - trimB > 30 && hash(seed, 6) < 0.6) {
        const mid = (trimA + L - trimB) / 2;
        place("tram-stop", mid - 7, 1, half + 1.0, "road", false);
        place("tram-stop", mid + 7, -1, half + 1.0, "road", false);
      }
      if (hash(seed, 7) < 0.45 && L - trimA - trimB > 30) {
        const side = hash(seed, 8) < 0.5 ? 1 : -1;
        place("tram", trimA + (L - trimA - trimB) * (0.3 + hash(seed, 9) * 0.4), side, 1.55, "travel", false, 0.12);
      }
    }
    const lampSpacing = spacing(r.kind === "avenue" ? 28 : 32);
    const lampTs: number[] = [];
    if (opts.lamps) {
      let k = 0;
      for (let t = trimA + 3; t < L - trimB; t += lampSpacing, k++) {
        lampTs.push(t);
        const sides = r.kind === "avenue" ? [1, -1] : [k % 2 ? 1 : -1];
        for (const side of sides) place(r.kind === "lane" ? "lamp-post" : "lamp", t, side, half + 0.45, "road", false);
      }
    }
    if (opts.trees && r.sidewalk >= 2.5) {
      const species = treeKinds[Math.floor(hash(seed, 1) * treeKinds.length)];
      for (let t = trimA + 6; t < L - trimB - 2; t += spacing(r.kind === "avenue" ? 10 : 12)) {
        if (lampTs.some((lt) => Math.abs(lt - t) < 2.5)) continue;
        for (const side of [1, -1]) place(species, t, side, half + r.sidewalk * 0.55, "road", true);
      }
    }
    if (opts.furniture) {
      // Hydrants at the curb.
      for (let t = trimA + 8; t < L - trimB; t += spacing(85)) place("hydrant", t, 1, half + 0.35, "road", true);
      if (r.sidewalk >= 2.5) {
        // Benches with bins, facing the street.
        for (let t = trimA + 15; t < L - trimB - 4; t += spacing(r.kind === "avenue" ? 55 : 110)) {
          for (const side of r.kind === "avenue" ? [1, -1] : [-1]) {
            place("bench", t, side, half + r.sidewalk - 0.5, "road", true);
            place("bin", t + 1.6, side, half + r.sidewalk - 0.45, "road", true);
          }
        }
        // Bike racks and scooter docks along the sidewalk.
        for (let t = trimA + 30; t < L - trimB - 4; t += spacing(140)) place("bike-rack", t, 1, half + r.sidewalk * 0.5, "along", true);
        if (r.kind === "avenue") for (let t = trimA + 70; t < L - trimB - 4; t += spacing(260)) place("scooter-dock", t, -1, half + r.sidewalk * 0.5, "along", true);
      }
      if (r.kind === "street" && opts.parking !== false && !r.tram) {
        // Parked cars along both curbs, facing the traffic on their side.
        for (const side of [1, -1]) {
          for (let t = trimA + 4; t < L - trimB - 3; t += 6.2) {
            const h = hash(Math.round(t * 10) + seed, side);
            if (h > 0.55) continue;
            const p = at(t);
            const x = p.x + p.nx * side * (half - 1.15);
            const z = p.z + p.nz * side * (half - 1.15);
            if (nearDoor(x, z)) continue;
            add(carKind(Math.round(h * 1e6)), x, z, facing(p.tx * side, p.tz * side), 0.08, true);
          }
        }
      }
      if (r.kind === "avenue" && !r.tram && L - trimA - trimB > 40) {
        // A bus stop on one side, mid-block.
        const t = (trimA + L - trimB) / 2;
        const side = hash(seed, 2) < 0.5 ? 1 : -1;
        place("bus-shelter", t, side, half + r.sidewalk * 0.6, "road", false);
        place("bus-stop-sign", t + 3, side, half + 0.4, "road", false);
        if (hash(seed, 3) < 0.25) place("kiosk", t - 9, -side, half + r.sidewalk * 0.5, "road", true);
      }
    }
  }

  // Junctions: traffic lights where avenues meet, a street sign at one corner, bollards.
  if (opts.furniture) {
    for (const e of world.query(RoadEdge)) {
      const r = world.read(e, RoadEdge);
      if (r.kind === "highway" || r.kind === "path") continue;
      const path = edgePath(world, r);
      for (const [node, from, to] of [[r.a, path[0], path[1]], [r.b, path[path.length - 1], path[path.length - 2]]] as const) {
        if ((degree.get(node) ?? 0) < 3) continue;
        const len = Math.hypot(to[0] - from[0], to[2] - from[2]) || 1;
        const dx = (to[0] - from[0]) / len;
        const dz = (to[2] - from[2]) / len;
        const R = (radius.get(node) ?? r.width / 2) + 2.5;
        // Right-hand curb of traffic approaching the junction along this edge.
        const nx = dz;
        const nz = -dx;
        const x = from[0] + dx * R + nx * (r.width / 2 + 0.5);
        const z = from[2] + dz * R + nz * (r.width / 2 + 0.5);
        if (avenueAt.has(node)) add("traffic-light", x, z, facing(-nx, -nz), CURB, false);
        if (node === r.a && hash(Math.round(x), Math.round(z)) < 0.5) {
          const sx = from[0] + dx * (R + 1) - nx * (r.width / 2 + r.sidewalk * 0.8);
          const sz = from[2] + dz * (R + 1) - nz * (r.width / 2 + r.sidewalk * 0.8);
          add("street-sign", sx, sz, facing(dx, dz), CURB, true);
        }
        if (r.kind === "avenue") {
          for (let k = 0; k < 3; k++) add("bollard", from[0] + dx * (R - 1.2 + k * 1.2) - nx * (r.width / 2 + 0.4), from[2] + dz * (R - 1.2 + k * 1.2) - nz * (r.width / 2 + 0.4), 0, CURB, true);
        }
      }
    }
  }
  return out;
}

export function streetscape(): Plugin {
  return {
    name: "streetscape",
    install(engine) {
      engine.addLoader({
        name: "streetscape",
        order: LoadOrder.streetscape,
        load(world) {
          for (const pl of placeStreetscape(world)) {
            const data: PropData = { kind: pl.kind, x: pl.x, z: pl.z, rot: pl.rot, scale: 1, explicit: {}, derived: true, lift: pl.lift, optional: pl.optional };
            world.add(world.spawn(), Prop, data);
          }
        },
      });
    },
  };
}
