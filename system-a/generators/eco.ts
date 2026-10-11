/**
 * Eco district: a compact, car-free neighbourhood on a bay.
 *
 * A tram boulevard crosses the district east to west and a second line runs
 * north to the shore. Canals run down to the water between the blocks, with
 * paved quays and bridges. Mass-timber towers line the boulevard and the
 * waterfront, green-walled mid-rise blocks wrap courtyard gardens, and rows
 * of solar-roofed townhouses fill the edges. A central plaza with solar
 * canopies, a market hall, a library, parks, community gardens and wind
 * turbines on the shore complete it. Streets are shared lanes without
 * parking; trees, benches and bike-share docks line them.
 *
 *   npx tsx generators/eco.ts [--seed 11] [--out public/cities/eco.city.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseCity, ROAD_DEFAULTS, type CityFileInput, type RoadKind, type Vec2, type Zone } from "../src/format/schema";
import { area, centroid, insetConvex, quadPoint, type P2 } from "../src/geom/polygon";
import { encodeHeights } from "../src/terrain/heightfield";
import { fbm, lerp, mulberry32, pick, range, smoothstep, valueNoise2D } from "./lib/random";

export interface EcoOptions {
  seed: number;
  size: number;
  cell: number;
}

const WATER = 0;
const DRY = 1.5;
/** Canal half-width (water) and quay width either side. */
const CANAL = 12;
const QUAY = 6;

type Road = { id: string; a: string; b: string; kind: RoadKind; width?: number; sidewalk?: number; tram?: boolean; bridge?: boolean };

export function generateEco({ seed, size, cell }: EcoOptions): CityFileInput {
  const rng = mulberry32(seed);
  const spacing = 84;
  const center: [number, number] = [size * 0.5, size * 0.42];

  // ---- Street lines and canals ------------------------------------------------
  const xs: number[] = [];
  for (let x = center[0] - spacing * 8; x <= size - 100; x += spacing) if (x >= 100) xs.push(x);
  const zs: number[] = [];
  for (let z = center[1] - spacing * 4; z <= size - 100; z += spacing) if (z >= 100) zs.push(z);
  const cx0 = xs.indexOf(center[0]);
  const cz0 = zs.indexOf(center[1]);
  // Canals down the middle of two block columns, from the third row to the bay.
  const canalCols = [cx0 - 3, cx0 + 3];
  const canalX = canalCols.map((i) => (xs[i] + xs[i + 1]) / 2);
  const canalTop = zs[cz0 + 1] + spacing / 2;
  const inCanal = (x: number, z: number, pad = 0) => z > canalTop - pad && canalX.some((c) => Math.abs(x - c) < CANAL + pad);

  // ---- Terrain ------------------------------------------------------------------
  const rolling = fbm(valueNoise2D(seed), 4);
  const detail = valueNoise2D(seed + 1);
  const shoreZ = (x: number) => size * 0.83 + 40 * Math.sin(x / 260) + 25 * Math.sin(x / 97 + 2);
  const natural = (x: number, z: number): number => {
    let h = 9 + rolling(x / 700, z / 700) * 7 + detail(x / 110, z / 110) * 0.8;
    h += 18 * smoothstep(size * 0.35, 0, z) * smoothstep(size * 0.55, 0, Math.abs(x - size * 0.2)); // a hill to the north-west
    h = lerp(h, 9, smoothstep(500, 150, Math.hypot(x - center[0], z - center[1])) * 0.8); // calm centre
    h = lerp(-8, h, smoothstep(shoreZ(x) + 40, shoreZ(x) - 30, z)); // the bay
    return h;
  };
  const n = Math.round(size / cell) + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * cell, z = j * cell;
      let h = natural(x, z);
      // Canals: a flat bed below the water with steep quay walls, ending at a basin head.
      const d = Math.min(...canalX.map((c) => Math.abs(x - c)));
      const along = smoothstep(canalTop - 12, canalTop, z);
      h = lerp(lerp(h, -3, along), h, smoothstep(CANAL - 1, CANAL + 1.5, d));
      heights[j * n + i] = h;
    }
  }
  const dry = (x: number, z: number) => natural(x, z) > WATER + DRY && !inCanal(x, z, 1);

  // ---- Roads -------------------------------------------------------------------
  type Node = { id: string; p: [number, number] };
  const grid: (Node | null)[][] = xs.map((x, ix) => zs.map((z, iz) => (dry(x, z) ? { id: `n${ix}_${iz}`, p: [x, z] } : null)));
  const edges = new Map<string, Road>();
  const key = (a: Node, b: Node) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  const tramZ = cz0;
  const tramX = cx0 + 1;
  const tryEdge = (a: Node | null, b: Node | null, ix: number, iz: number, alongX: boolean) => {
    if (!a || !b) return;
    let bridge = false;
    for (let t = 0.1; t < 1; t += 0.1) {
      const x = lerp(a.p[0], b.p[0], t), z = lerp(a.p[1], b.p[1], t);
      if (inCanal(x, z, 2)) bridge = true;
      else if (natural(x, z) < WATER + DRY) return;
    }
    // Only some cross streets bridge the canals.
    if (bridge && iz !== tramZ && (iz - tramZ) % 2 !== 0) return;
    const tram = alongX ? iz === tramZ : ix === tramX && iz >= tramZ;
    const main = tram || (alongX ? (iz - tramZ) % 3 === 0 : (ix - cx0) % 4 === 0);
    const road: Road = tram
      ? { id: "", a: a.id, b: b.id, kind: "avenue", width: 16, sidewalk: 5, tram: true }
      : main
        ? { id: "", a: a.id, b: b.id, kind: "street", width: 7, sidewalk: 4 }
        : { id: "", a: a.id, b: b.id, kind: "lane", width: 5, sidewalk: 3 };
    if (bridge) road.bridge = true;
    road.id = `e${edges.size}`;
    edges.set(key(a, b), road);
  };
  for (let ix = 0; ix < xs.length; ix++) {
    for (let iz = 0; iz < zs.length; iz++) {
      if (ix + 1 < xs.length) tryEdge(grid[ix][iz], grid[ix + 1][iz], ix, iz, true);
      if (iz + 1 < zs.length) tryEdge(grid[ix][iz], grid[ix][iz + 1], ix, iz, false);
    }
  }
  const used = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  const edgeBetween = (a: Node, b: Node) => edges.get(key(a, b));

  // ---- Parcels and buildings -------------------------------------------------------
  const parcels: CityFileInput["parcels"] = [];
  const buildings: NonNullable<CityFileInput["buildings"]> = [];
  const props: NonNullable<CityFileInput["props"]> = [];
  const round = (p: P2): Vec2 => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  const addParcel = (poly: P2[], zone: Zone) => {
    const id = `p${parcels.length}`;
    parcels.push({ id, polygon: poly.map(round), zone });
    return id;
  };
  const addBuilding = (parcel: string, footprint: P2[], floors: number, style: string, roof: "flat" | "gable" = "flat", floorHeight?: number) => {
    buildings.push({
      id: `b${buildings.length}`,
      parcel,
      footprint: footprint.map(round),
      floors: Math.max(1, Math.round(floors)),
      roof,
      style,
      seed: Math.floor(rng() * 2 ** 31),
      ...(floorHeight ? { floorHeight } : {}),
    });
  };
  const addProp = (kind: string, p: P2, rot = 0) => props.push({ kind, p: round(p), ...(rot ? { rot: Math.round(rot * 1000) / 1000 } : {}) });
  const allDry = (poly: P2[]) => poly.every(([x, z]) => natural(x, z) > WATER + DRY) && !poly.some(([x, z]) => inCanal(x, z, 0.5));

  const blockAt = (ix: number, iz: number): P2[] | null => {
    const c = [grid[ix][iz], grid[ix + 1][iz], grid[ix + 1][iz + 1], grid[ix][iz + 1]];
    if (c.some((v) => !v || !used.has(v.id))) return null;
    const [a, b, cc, d] = c as Node[];
    const sides = [edgeBetween(a, b), edgeBetween(b, cc), edgeBetween(cc, d), edgeBetween(d, a)];
    // Blocks may lose a side to a canal; use a nominal setback there.
    const setback = sides.map((s) => (s ? (s.width ?? ROAD_DEFAULTS[s.kind].width) / 2 + (s.sidewalk ?? ROAD_DEFAULTS[s.kind].sidewalk) + 0.5 : 6));
    if (sides.filter(Boolean).length < 3) return null;
    return insetConvex([a.p, b.p, cc.p, d.p], setback);
  };

  /** Split a block either side of a canal running through it (north-south). */
  const splitCanal = (block: P2[], ix: number): P2[][] => {
    const k = canalCols.indexOf(ix);
    if (k < 0) return [block];
    const cx = canalX[k];
    const lineAt = (x: number) => {
      // Points where the block's top and bottom edges cross x.
      const [a, b, c, d] = block;
      const t0 = (x - a[0]) / (b[0] - a[0]);
      const t1 = (x - d[0]) / (c[0] - d[0]);
      return [lerp(a[1], b[1], t0), lerp(d[1], c[1], t1)];
    };
    const [w0, w1] = lineAt(cx - CANAL - QUAY);
    const [e0, e1] = lineAt(cx + CANAL + QUAY);
    const west: P2[] = [block[0], [cx - CANAL - QUAY, w0], [cx - CANAL - QUAY, w1], block[3]];
    const east: P2[] = [[cx + CANAL + QUAY, e0], block[1], block[2], [cx + CANAL + QUAY, e1]];
    // Paved quays along the water.
    const [qw0, qw1] = lineAt(cx - CANAL);
    const [qe0, qe1] = lineAt(cx + CANAL);
    addParcel([[cx - CANAL - QUAY, w0], [cx - CANAL, qw0], [cx - CANAL, qw1], [cx - CANAL - QUAY, w1]], "plaza");
    addParcel([[cx + CANAL, qe0], [cx + CANAL + QUAY, e0], [cx + CANAL + QUAY, e1], [cx + CANAL, qe1]], "plaza");
    for (let z = Math.min(w0, w1) + 6; z < Math.max(w0, w1) - 4; z += 12) {
      for (const [x, face] of [[cx - CANAL - QUAY * 0.55, Math.PI / 2], [cx + CANAL + QUAY * 0.55, -Math.PI / 2]] as const) {
        addProp((z / 12) % 3 < 1 ? "bench" : "tree-birch", [x, z], face);
      }
    }
    return [west, east].filter((p) => area(p) > 300);
  };

  const fill = (poly: P2[], zone: Zone, ix: number, iz: number, dist: number) => {
    const lenU = Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
    const lenV = Math.hypot(poly[3][0] - poly[0][0], poly[3][1] - poly[0][1]);
    if (zone === "commercial") {
      // Timber towers: two or three on podiums of shared ground.
      const nu = Math.max(1, Math.round(lenU / 34));
      const nv = Math.max(1, Math.round(lenV / 34));
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const q = [quadPoint(poly, i / nu, j / nv), quadPoint(poly, (i + 1) / nu, j / nv), quadPoint(poly, (i + 1) / nu, (j + 1) / nv), quadPoint(poly, i / nu, (j + 1) / nv)];
          if (area(q) < 200 || !allDry(q)) continue;
          const pid = addParcel(q, "mixed");
          const fp = insetConvex(q, 3);
          if (fp) addBuilding(pid, fp, range(rng, 7, 15) * (dist < 260 ? 1.25 : 1), "timber-tower", "flat", 3.3);
        }
      }
    } else if (zone === "mixed") {
      // Perimeter block of green mid-rise around a courtyard garden.
      const lot = 24;
      const nu = Math.max(2, Math.round(lenU / lot));
      const nv = Math.max(2, Math.round(lenV / lot));
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          if (i > 0 && j > 0 && i < nu - 1 && j < nv - 1) continue;
          const q = [quadPoint(poly, i / nu, j / nv), quadPoint(poly, (i + 1) / nu, j / nv), quadPoint(poly, (i + 1) / nu, (j + 1) / nv), quadPoint(poly, i / nu, (j + 1) / nv)];
          if (area(q) < 120 || !allDry(q)) continue;
          const pid = addParcel(q, "mixed");
          const fp = insetConvex(q, 1.5);
          if (fp) addBuilding(pid, fp, range(rng, 4, 7), "eco-midrise", "flat", 3.2);
        }
      }
      if (nu > 2 && nv > 2) {
        const court = [quadPoint(poly, 1 / nu, 1 / nv), quadPoint(poly, (nu - 1) / nu, 1 / nv), quadPoint(poly, (nu - 1) / nu, (nv - 1) / nv), quadPoint(poly, 1 / nu, (nv - 1) / nv)];
        if (allDry(court)) addParcel(court, "park");
      }
    } else if (zone === "residential") {
      // Two back-to-back rows of terraced townhouses along the long side.
      const long = lenU >= lenV;
      const L = long ? lenU : lenV;
      const count = Math.max(2, Math.floor(L / 7.5));
      for (let row = 0; row < 2; row++) {
        for (let k = 0; k < count; k++) {
          const u0 = k / count, u1 = (k + 1) / count, v0 = row * 0.5, v1 = v0 + 0.5;
          const q = long
            ? [quadPoint(poly, u0, v0), quadPoint(poly, u1, v0), quadPoint(poly, u1, v1), quadPoint(poly, u0, v1)]
            : [quadPoint(poly, v0, u0), quadPoint(poly, v1, u0), quadPoint(poly, v1, u1), quadPoint(poly, v0, u1)];
          if (area(q) < 60 || !allDry(q)) continue;
          const pid = addParcel(q, "residential");
          // Attached houses: street front 3 m back, garden behind.
          const depth = (long ? lenV : lenU) / 2;
          const front = 3, back = Math.max(4, depth - 3 - 11);
          // Per-edge insets in the lot's edge order (see the quad corners above).
          const ins = long ? (row === 0 ? [front, 0.05, back, 0.05] : [back, 0.05, front, 0.05]) : row === 0 ? [0.05, back, 0.05, front] : [0.05, front, 0.05, back];
          const fp = insetConvex(q, ins);
          if (fp) addBuilding(pid, fp, rng() < 0.6 ? 3 : 2, "eco-townhouse", "flat", 3.1);
        }
      }
    } else if (zone === "park") {
      addParcel(poly, "park");
    } else if (zone === "civic") {
      // Community gardens: raised beds, greenhouses and a shed, around a lawn.
      const pid = addParcel(poly, "residential");
      void pid;
      const [gx, gz] = centroid(poly);
      for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) if (Math.abs(i) > 0 || Math.abs(j) > 1) addProp("veg-bed", [gx + i * 4.2, gz + j * 3.2]);
      addProp("greenhouse", [gx - 20, gz - 14]);
      addProp("greenhouse", [gx + 20, gz - 14]);
      addProp("shed", [gx + 20, gz + 14]);
      addProp("picnic-table", [gx, gz]);
      for (let k = 0; k < 6; k++) addProp(pick(rng, ["tree-cherry", "tree-oak", "tree-birch"]), [gx - 26 + k * 10.4, gz + 22]);
    }
    void ix;
    void iz;
  };

  // Special blocks around the centre.
  const special = new Map<string, string>([
    [`${cx0},${cz0}`, "plaza"],
    [`${cx0 - 1},${cz0}`, "market-hall"],
    [`${cx0 + 1},${cz0 - 1}`, "library"],
    [`${cx0 - 1},${cz0 - 2}`, "park"],
    [`${cx0},${cz0 - 2}`, "park"],
    [`${cx0 + 2},${cz0 + 2}`, "gardens"],
    [`${cx0 - 5},${cz0 + 1}`, "gardens"],
  ]);

  for (let ix = 0; ix + 1 < xs.length; ix++) {
    for (let iz = 0; iz + 1 < zs.length; iz++) {
      const block = blockAt(ix, iz);
      if (!block) continue;
      const [bx, bz] = centroid(block);
      const dist = Math.hypot(bx - center[0], bz - center[1]);
      const sp = special.get(`${ix},${iz}`);
      if (sp === "plaza") {
        const pid = addParcel(block, "plaza");
        void pid;
        const [px, pz] = centroid(block);
        addProp("fountain", [px, pz]);
        for (const [dx, dz] of [[-18, -14], [18, -14], [-18, 14], [18, 14]]) addProp("solar-canopy", [px + dx, pz + dz], dz > 0 ? Math.PI : 0);
        addProp("sculpture", [px, pz - 22]);
        continue;
      }
      if (sp === "market-hall" || sp === "library") {
        const pid = addParcel(block, "civic");
        const lot = insetConvex(block, 4);
        if (lot) addBuilding(pid, lot, sp === "library" ? 4 : 1, sp, "flat", sp === "library" ? 4.2 : 7);
        continue;
      }
      if (sp === "park") {
        addParcel(block, "park");
        continue;
      }
      if (sp === "gardens") {
        fill(block, "civic", ix, iz, dist);
        continue;
      }
      for (const part of splitCanal(block, ix)) {
        if (!allDry(part)) continue;
        const nearTram = Math.abs(iz - tramZ) <= 0 || Math.abs(iz + 1 - tramZ) <= 0 || ix === tramX || ix + 1 === tramX;
        const waterfront = part.some(([x, z]) => z > shoreZ(x) - 120);
        let zone: Zone;
        if ((nearTram && dist < 380) || (waterfront && dist < 420 && rng() < 0.6) || dist < 160) zone = "commercial";
        else if (dist < 520) zone = rng() < 0.12 ? "park" : "mixed";
        else zone = rng() < 0.08 ? "park" : "residential";
        fill(part, zone, ix, iz, dist);
      }
    }
  }

  // Wind turbines and a promenade of trees along the shore.
  for (let x = 140; x < size - 140; x += 130) {
    const z = shoreZ(x) - 18;
    if (natural(x, z) > WATER + DRY && !inCanal(x, z, 6)) addProp("wind-turbine", [x, z], Math.PI);
  }
  // Bike-share docks along the boulevard.
  const bz = zs[tramZ];
  for (let x = xs[0] + 40; x < xs[xs.length - 1] - 40; x += 168) if (dry(x, bz + 14)) addProp("bike-share", [x, bz + 13.2]);

  return {
    format: "system-a/city",
    version: 1,
    meta: {
      name: "Eco District",
      description: "Car-free neighbourhood on a bay: tram boulevard, canals, timber towers, green mid-rise, solar townhouses, parks and gardens.",
      generator: "generators/eco.ts",
      seed,
    },
    terrain: { size: [size, size], resolution: [n, n], heights: encodeHeights(heights), waterLevel: WATER },
    roads: {
      nodes: grid.flat().filter((v): v is Node => !!v && used.has(v.id)).map((v) => ({ id: v.id, p: round(v.p) })),
      edges: [...edges.values()],
    },
    parcels,
    buildings,
    props,
    streetscape: { trees: true, lamps: true, furniture: true, markings: true, parking: false, landscape: true, density: 1.15 },
  };
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg("out") ?? "public/cities/eco.city.json";
  const t0 = performance.now();
  const raw = generateEco({ seed: Number(arg("seed") ?? 11), size: 1600, cell: 8 });
  const city = parseCity(raw);
  mkdirSync(dirname(out), { recursive: true });
  const json = JSON.stringify(raw);
  writeFileSync(out, json);
  console.log(
    `${out}: ${city.roads.nodes.length} nodes, ${city.roads.edges.length} roads, ` +
      `${city.parcels.length} parcels, ${city.buildings.length} buildings, ${city.props.length} props, ` +
      `${(json.length / 1e6).toFixed(1)} MB in ${Math.round(performance.now() - t0)} ms`,
  );
}
