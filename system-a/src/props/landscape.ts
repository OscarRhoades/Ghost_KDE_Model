/**
 * Landscape: parks get paths, a central feature, tree groves, play areas,
 * ponds and furniture; the civic plaza gets paving, tree rows and fountains;
 * house lots get hedges and garden things; industrial lots get yards with
 * trucks and containers. Deterministic from the city; never saved.
 */
import type { World } from "../ecs/world";
import { Building, CityR, Parcel, Patch, Prop, TerrainR, type BuildingData, type PatchData, type PropData } from "../engine/components";
import { LoadOrder, type Plugin } from "../engine/engine";
import { area, bounds, centroid, insetConvex, pointInPolygon, segmentDistance, signedArea, type P2 } from "../geom/polygon";
import { groundPlans } from "../buildings/massing";
import { FootprintGrid } from "../physics/collision";
import { distToStreetEdge, roadGrid } from "../interiors/frontage";
import { propCatalog } from "./catalog";

export interface Landscape {
  props: Omit<PropData, "explicit" | "scale">[];
  patches: PatchData[];
}

export const PATCH = {
  gravel: "#d6c7a2",
  paving: "#dcd6ca",
  pavingDark: "#c9c2b4",
  water: "#5f9fc6",
  sand: "#e6d3a0",
  asphalt: "#8a8d92",
  bay: "#eeece6",
} as const;

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rectangle of width `w` around segment a-b, as a convex polygon. */
export function strip(a: P2, b: P2, w: number, extend = 0): P2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
  const nx = -tz * (w / 2), nz = tx * (w / 2);
  const ax = a[0] - tx * extend, az = a[1] - tz * extend, bx = b[0] + tx * extend, bz = b[1] + tz * extend;
  return [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
}

export function ngon(cx: number, cz: number, rx: number, rz = rx, n = 12, rot = 0): P2[] {
  return Array.from({ length: n }, (_, k) => {
    const a = rot + (k / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz] as P2;
  });
}

const lerp = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const heading = (dx: number, dz: number) => Math.atan2(dx, dz);

export function planLandscape(world: World): Landscape {
  const { hf, waterLevel } = world.resource(TerrainR);
  const props: Landscape["props"] = [];
  const patches: PatchData[] = [];
  const opts = world.getResource(CityR)?.streetscape;
  if (opts?.landscape === false) return { props, patches };
  const roads = roadGrid(world);

  const solids = new FootprintGrid(32);
  const byParcel = new Map<number, BuildingData[]>();
  for (const e of world.query(Building)) {
    const b = world.read(e, Building);
    for (const plan of groundPlans(b)) solids.add(plan);
    if (b.parcel !== undefined) (byParcel.get(b.parcel) ?? byParcel.set(b.parcel, []).get(b.parcel)!).push(b);
  }
  const dry = (x: number, z: number) => waterLevel === undefined || hf.heightAt(x, z) > waterLevel + 0.3;
  const inBuilding = (x: number, z: number, r = 0) =>
    solids.near(x, z, r + 1).some((poly) => pointInPolygon(x, z, poly) || (r > 0 && edgeDist(x, z, poly) < r));
  const add = (kind: string, x: number, z: number, rot: number, optional: boolean, lift = 0) => {
    if (!dry(x, z) || inBuilding(x, z)) return false;
    props.push({ kind, x, z, rot, lift, optional, derived: true });
    return true;
  };

  for (const e of world.query(Parcel)) {
    const parcel = world.read(e, Parcel);
    const seed = Math.round(parcel.polygon[0][0] * 7 + parcel.polygon[0][1] * 13);
    if (parcel.zone === "park") park(parcel.polygon, seed);
    else if (parcel.zone === "plaza") plaza(parcel.polygon, seed);
    else if (parcel.zone === "residential") garden(parcel.polygon, byParcel.get(e) ?? [], seed);
    else if (parcel.zone === "industrial") yard(parcel.polygon, byParcel.get(e) ?? [], seed);
  }
  return { props, patches };

  // ---- Parks ---------------------------------------------------------------------------

  function park(poly: P2[], seed: number) {
    const ring = insetConvex(poly, 8);
    if (!ring) return;
    const c = centroid(poly);
    const paths: [P2, P2, number][] = [];
    const path = (a: P2, b: P2, w: number) => {
      paths.push([a, b, w]);
      patches.push({ poly: strip(a, b, w, w / 2), color: PATCH.gravel, lift: 0.05 });
    };
    // A loop path, with spokes to a central feature and out to the streets.
    for (let k = 0; k < ring.length; k++) path(ring[k], ring[(k + 1) % ring.length], 3);
    const big = area(poly) > 9000;
    const R = Math.min(11, Math.sqrt(area(poly)) * 0.09);
    for (let k = 0; k < ring.length; k++) {
      const r = ring[k];
      path(r, lerp(c, r, R / Math.hypot(r[0] - c[0], r[1] - c[1])), 2.5);
      if (big || hash(seed, k) < 0.5) {
        // Entrance from the middle of each side.
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const m = lerp(a, b, 0.5);
        const rm = lerp(ring[k], ring[(k + 1) % ring.length], 0.5);
        path(m, rm, 3);
        if (big) path(rm, lerp(c, rm, R / Math.hypot(rm[0] - c[0], rm[1] - c[1])), 2.5);
      }
    }
    patches.push({ poly: ngon(c[0], c[1], R, R, 16), color: PATCH.paving, lift: 0.07 });
    const feature = hash(seed, 9);
    if (feature < 0.55) add("fountain", c[0], c[1], 0, false);
    else if (feature < 0.8) add("pavilion", c[0], c[1], hash(seed, 10) * Math.PI, false);
    else add("sculpture", c[0], c[1], 0, false);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.5;
      if (k % 2 === 0) add("bench", c[0] + Math.cos(a) * (R - 1.2), c[1] + Math.sin(a) * (R - 1.2), heading(-Math.cos(a), -Math.sin(a)), true);
      else add("flower-bed", c[0] + Math.cos(a) * (R + 2.5), c[1] + Math.sin(a) * (R + 2.5), heading(Math.cos(a), Math.sin(a)), true);
    }

    const pathDist = (x: number, z: number) => Math.min(...paths.map(([a, b, w]) => segmentDistance(x, z, a[0], a[1], b[0], b[1]).d - w / 2));
    const taken: [number, number, number][] = [[c[0], c[1], R + 4]];
    const free = (x: number, z: number, r: number) =>
      pointInPolygon(x, z, poly) && edgeDist(x, z, poly) > r + 1 && pathDist(x, z) > Math.min(r, 1.2) + 0.3 && taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r) && dry(x, z);
    const flat = (x: number, z: number, r: number) => {
      const hs = [[-r, -r], [r, -r], [r, r], [-r, r], [0, 0]].map(([dx, dz]) => hf.heightAt(x + dx, z + dz));
      return Math.max(...hs) - Math.min(...hs) < 0.8;
    };

    // Lamps and benches along the loop.
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      const inward = signedArea(poly) > 0 ? 1 : -1;
      const nx = -tz * inward, nz = tx * inward;
      for (let d = 8; d < len - 6; d += 24) add("lamp-post", a[0] + tx * d - nx * 2.3, a[1] + tz * d - nz * 2.3, 0, false);
      for (let d = 18; d < len - 8; d += 30) {
        const x = a[0] + tx * d + nx * 2.4, z = a[1] + tz * d + nz * 2.4;
        if (add("bench", x, z, heading(-nx, -nz), true)) add("bin", x + tx * 1.6, z + tz * 1.6, 0, true);
        taken.push([x, z, 2]);
      }
    }

    // Features in the sectors between spokes.
    const kinds = ["playground", "pond", "picnic", "court", "beds", "lawn", "rocks", "pond", "playground"];
    // Two spots per side, clear of the spokes to the corners and side middles.
    const spots: P2[] = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      for (const t of [0.27, 0.73]) spots.push(lerp(lerp(a, b, t), c, 0.42));
    }
    for (let k = 0; k < spots.length; k++) {
      const kind = kinds[Math.floor(hash(seed, 20 + k) * kinds.length)];
      const [x, z] = spots[k];
      const rot = heading(c[0] - x, c[1] - z);
      if (kind === "playground" && free(x, z, 5)) {
        patches.push({ poly: ngon(x, z, 6.5, 6.5, 10), color: PATCH.sand, lift: 0.06 });
        add("playground", x, z, rot, false);
        add("bench", x + Math.cos(rot) * 7.5, z - Math.sin(rot) * 7.5, rot + Math.PI / 2, true);
        taken.push([x, z, 7]);
      } else if (kind === "pond" && free(x, z, 9)) {
        const rx = 7 + hash(seed, 30 + k) * 4, rz = 5 + hash(seed, 40 + k) * 3;
        patches.push({ poly: ngon(x, z, rx + 1.2, rz + 1.2, 14, rot), color: PATCH.gravel, lift: 0.05 });
        patches.push({ poly: ngon(x, z, rx, rz, 14, rot), color: PATCH.water, lift: 0.08 });
        for (let r = 0; r < 5; r++) {
          const ang = rot + r * 1.3;
          add("reeds", x + Math.cos(ang) * rx * 0.92, z + Math.sin(ang) * rz * 0.92, ang, true);
        }
        add("rock", x + Math.cos(rot + 2.2) * (rx + 0.5), z + Math.sin(rot + 2.2) * (rz + 0.5), 0, true);
        taken.push([x, z, Math.max(rx, rz) + 2]);
      } else if (kind === "picnic" && free(x, z, 5)) {
        for (let t = 0; t < 4; t++) add("picnic-table", x + ((t % 2) - 0.5) * 5, z + (Math.floor(t / 2) - 0.5) * 5, rot + t * 0.3, true);
        taken.push([x, z, 5]);
      } else if (kind === "court" && free(x, z, 13) && flat(x, z, 10)) {
        add("court", x, z, rot, false);
        taken.push([x, z, 13]);
      } else if (kind === "beds" && free(x, z, 5)) {
        for (let t = 0; t < 5; t++) add("flower-bed", x + Math.cos(t * 1.26) * 3.5, z + Math.sin(t * 1.26) * 3.5, t * 1.26, true);
        taken.push([x, z, 5]);
      } else if (kind === "rocks" && free(x, z, 4)) {
        for (let t = 0; t < 4; t++) add("rock", x + Math.cos(t * 1.7) * 2.5, z + Math.sin(t * 1.7) * 2.5, t, true);
        taken.push([x, z, 4]);
      }
    }

    // Groves: trees on a jittered grid, species by neighbourhood, with clearings.
    const bb = bounds(poly);
    const species = ["tree-oak", "tree-plane", "tree-birch", "tree-pine", "tree-cherry"];
    for (let x = bb.minX + 4; x < bb.maxX; x += 7) {
      for (let z = bb.minZ + 4; z < bb.maxZ; z += 7) {
        const h = hash(Math.round(x), Math.round(z));
        if (hash(Math.round(x / 30), Math.round(z / 30) + seed) < 0.18) continue; // clearing
        const px = x + (h - 0.5) * 4, pz = z + (hash(Math.round(z), Math.round(x)) - 0.5) * 4;
        if (!free(px, pz, 2)) continue;
        const kind = species[Math.floor(hash(Math.round(px / 40), Math.round(pz / 40) + seed) * species.length)];
        if (add(kind, px, pz, h * 6.28, true)) taken.push([px, pz, 1.5]);
        else continue;
        if (h < 0.25) add("shrub", px + 2, pz + 1, 0, true);
      }
    }
    // Low hedge along the street edges, gapped at entrances.
    if (hash(seed, 50) < 0.6) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        hedgeLine(insetPoint(poly, a, 1.2), insetPoint(poly, b, 1.2), 3);
      }
    }
  }

  /** Point moved `d` toward the polygon's centroid. */
  function insetPoint(poly: P2[], p: P2, d: number): P2 {
    const c = centroid(poly);
    const len = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    return [p[0] + ((c[0] - p[0]) / len) * d, p[1] + ((c[1] - p[1]) / len) * d];
  }

  /** 4 m hedge pieces from a to b, leaving a gap of `gap` meters around the middle (0 for none). */
  function hedgeLine(a: P2, b: P2, gap: number, skip?: (x: number, z: number) => boolean) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 4) return;
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    const rot = heading(-tz, tx) ;
    const n = Math.floor(len / 4);
    const start = (len - n * 4) / 2;
    for (let k = 0; k < n; k++) {
      const d = start + k * 4 + 2;
      if (gap > 0 && Math.abs(d - len / 2) < gap / 2 + 2) continue;
      const x = a[0] + tx * d, z = a[1] + tz * d;
      if (skip?.(x, z)) continue;
      add("hedge", x, z, rot, true);
    }
  }

  // ---- The civic plaza ------------------------------------------------------------------

  function plaza(poly: P2[], seed: number) {
    const bb = bounds(poly);
    const T = 6;
    for (let x = Math.floor(bb.minX / T) * T; x < bb.maxX; x += T) {
      for (let z = Math.floor(bb.minZ / T) * T; z < bb.maxZ; z += T) {
        if (((x / T) + (z / T)) % 2 === 0) continue;
        const tile = clipConvex([[x, z], [x + T, z], [x + T, z + T], [x, z + T]], poly);
        if (tile) patches.push({ poly: tile, color: PATCH.pavingDark, lift: 0.04 });
      }
    }
    // Tree rows on the middle line of the ring around the hall, fountains on the long axis.
    const mid = insetConvex(poly, 12);
    const edge = insetConvex(poly, 3);
    if (!mid || !edge) return;
    const c = centroid(poly);
    for (let k = 0; k < mid.length; k++) {
      const a = mid[k], b = mid[(k + 1) % mid.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      const toC = heading(c[0] - (a[0] + b[0]) / 2, c[1] - (a[1] + b[1]) / 2);
      for (let d = 8; d < len - 6; d += 11) {
        const x = a[0] + tx * d, z = a[1] + tz * d;
        if (Math.abs(d - len / 2) < 12) continue;
        add("planter", x, z, 0, false);
        add("tree-plane", x, z, d, false, 0.6);
        add("bench", x + tx * 5.5, z + tz * 5.5, toC + Math.PI, true);
      }
      const m = lerp(a, b, 0.5);
      if (k % 2 === seed % 2) add("fountain", m[0], m[1], 0, false);
      else {
        add("sculpture", m[0], m[1], 0, false);
        for (let t = 0; t < 3; t++) add("table-chairs", m[0] + tx * (6 + t * 2.4), m[1] + tz * (6 + t * 2.4), t, true);
      }
    }
    for (let k = 0; k < edge.length; k++) {
      const a = edge[k], b = edge[(k + 1) % edge.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      for (let d = 6; d < len - 4; d += 18) add("lamp-post", a[0] + tx * d, a[1] + tz * d, 0, false);
      for (let d = 15; d < len - 10; d += 36) add("kiosk", a[0] + tx * d, a[1] + tz * d, heading(c[0] - a[0], c[1] - a[1]), true);
    }
  }

  // ---- House gardens ---------------------------------------------------------------------

  function garden(poly: P2[], houses: BuildingData[], seed: number) {
    if (houses.length === 0) return;
    const h = houses[0];
    const n = poly.length;
    // Hedges along the sides and back; the street side stays open.
    for (let k = 0; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      const m = lerp(a, b, 0.5);
      const mi = insetPoint(poly, m, 2);
      if (distToStreetEdge(roads, mi[0], mi[1]) < 3) continue;
      if (hash(seed, k) < 0.25) continue;
      hedgeLine(insetPoint(poly, a, 0.8), insetPoint(poly, b, 0.8), 0, (x, z) => inBuilding(x, z, 0.8) || distToStreetEdge(roads, x, z) < 1);
    }
    // Garden things in the back: away from the street and the house.
    const bb = bounds(poly);
    const spots: [number, number][] = [];
    for (let t = 0; t < 14 && spots.length < 3; t++) {
      const x = bb.minX + hash(seed, 100 + t) * (bb.maxX - bb.minX);
      const z = bb.minZ + hash(seed, 200 + t) * (bb.maxZ - bb.minZ);
      if (!pointInPolygon(x, z, poly) || edgeDist(x, z, poly) < 2.2 || inBuilding(x, z, 2.5)) continue;
      if (distToStreetEdge(roads, x, z) < 6) continue;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 4)) continue;
      spots.push([x, z]);
    }
    const things = ["tree-cherry", "tree-birch", "shed", "parasol-table", "trampoline", "tree-oak", "shrub", "flower-bed"];
    spots.forEach(([x, z], i) => add(things[Math.floor(hash(seed, 300 + i) * things.length)], x, z, hash(seed, 400 + i) * 6.28, true));
    // A car on the drive, beside the house on the street side.
    if (h.entrance && hash(seed, 500) < 0.6 && opts?.parking !== false) {
      const e = h.entrance;
      let nx = -e.tz, nz = e.tx;
      if (pointInPolygon(e.x + nx, e.z + nz, h.footprint)) (nx = -nx), (nz = -nz);
      for (const side of [1, -1]) {
        const x = e.x + e.tx * side * 4.5 + nx * 3.2, z = e.z + e.tz * side * 4.5 + nz * 3.2;
        if (pointInPolygon(x, z, poly) && !inBuilding(x, z, 1.2) && edgeDist(x, z, poly) > 1) {
          add(carKind(seed), x, z, heading(nx, nz), true);
          break;
        }
      }
    }
  }

  // ---- Industrial yards --------------------------------------------------------------------

  function yard(poly: P2[], sheds: BuildingData[], seed: number) {
    const inner = insetConvex(poly, 1);
    if (!inner || sheds.length === 0) return;
    patches.push({ poly: inner, color: PATCH.asphalt, lift: 0.03 });
    const bb = bounds(poly);
    // Rows along the lot's longest edge.
    let best = 0;
    for (let k = 1; k < poly.length; k++) {
      const len = (i: number) => Math.hypot(poly[(i + 1) % poly.length][0] - poly[i][0], poly[(i + 1) % poly.length][1] - poly[i][1]);
      if (len(k) > len(best)) best = k;
    }
    const a = poly[best], b = poly[(best + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
    const rot = heading(-tz, tx);
    const span = Math.hypot(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
    for (let u = -span; u < span; u += 3) {
      for (let v = -span; v < span; v += 8) {
        const x = (bb.minX + bb.maxX) / 2 + tx * u - tz * v;
        const z = (bb.minZ + bb.maxZ) / 2 + tz * u + tx * v;
        if (!pointInPolygon(x, z, poly) || edgeDist(x, z, poly) < 3 || inBuilding(x, z, 3)) continue;
        if (distToStreetEdge(roads, x, z) < 2) continue;
        const h = hash(Math.round(x * 3) + seed, Math.round(z * 3));
        patches.push({ poly: strip([x + tx * 1.5 - tz * 2.5, z + tz * 1.5 + tx * 2.5], [x + tx * 1.5 + tz * 2.5, z + tz * 1.5 - tx * 2.5], 0.12), color: PATCH.bay, lift: 0.06 });
        if (h < 0.35 && opts?.parking !== false) add(carKind(Math.round(x * 7 + z)), x, z, rot + (h < 0.17 ? Math.PI : 0), true);
        else if (h > 0.93) add(`container-${["rust", "blue", "green", "grey"][Math.floor(h * 97) % 4]}`, x, z, rot + Math.PI / 2, true);
        else if (h > 0.9) add("truck", x, z, rot + Math.PI / 2, true);
        else if (h > 0.86) add("pallets", x, z, 0, true);
      }
    }
  }
}

/** A car kind picked from the catalog by a seed. */
export function carKind(seed: number): string {
  const cars = propCatalog.names().filter((k) => k.startsWith("car-"));
  return cars[Math.floor(hash(seed, 77) * cars.length)];
}

function edgeDist(x: number, z: number, poly: readonly P2[]): number {
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    d = Math.min(d, segmentDistance(x, z, a[0], a[1], b[0], b[1]).d);
  }
  return d;
}

/** Intersection of convex `subject` with convex `clip` (Sutherland-Hodgman). */
export function clipConvex(subject: readonly P2[], clip: readonly P2[]): P2[] | null {
  let out: P2[] = [...subject];
  const ccw = signedArea(clip) > 0;
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k], b = clip[(k + 1) % clip.length];
    const side = (p: P2) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * (ccw ? 1 : -1);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 && Math.abs(signedArea(out)) > 0.01 ? out : null;
}

export function landscape(): Plugin {
  return {
    name: "landscape",
    install(engine) {
      engine.addLoader({
        name: "landscape",
        order: LoadOrder.landscape,
        load(world) {
          const plan = planLandscape(world);
          for (const p of plan.props) world.add(world.spawn(), Prop, { ...p, scale: 1, explicit: {} });
          for (const p of plan.patches) world.add(world.spawn(), Patch, p);
        },
      });
    },
  };
}
