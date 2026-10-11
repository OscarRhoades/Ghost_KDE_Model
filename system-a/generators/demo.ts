/**
 * Demo city: a generic modern city on rolling terrain.
 *
 * A dense downtown grid of towers around a civic plaza, a mid-rise ring of
 * perimeter blocks, suburbs of pitched-roof houses on a gently warped grid,
 * a river with industry along its banks, hills to the northwest and the sea
 * to the south.
 *
 *   npx tsx generators/demo.ts [--seed 7] [--out public/cities/demo.city.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  parseCity,
  type CityFileInput,
  type RoadKind,
  type Vec2,
  type Zone,
  ROAD_DEFAULTS,
} from "../src/format/schema";
import { area, centroid, insetConvex, quadPoint, type P2 } from "../src/geom/polygon";
import { encodeHeights } from "../src/terrain/heightfield";
import { fbm, lerp, mulberry32, pick, range, smoothstep, valueNoise2D } from "./lib/random";

export interface DemoOptions {
  seed: number;
  size: number;
  /** Meters between terrain samples. */
  cell: number;
}

const WATER = 0;
/** Ground must be this high to build on. */
const DRY = 1.5;

export function generateDemo({ seed, size, cell }: DemoOptions): CityFileInput {
  const rng = mulberry32(seed);
  const center: [number, number] = [size * 0.43, size * 0.46];
  const distC = (x: number, z: number) => Math.hypot(x - center[0], z - center[1]);
  const riverX = (z: number) => size * 0.76 + 150 * Math.sin(z / 430) + 60 * Math.sin(z / 170 + 1);

  // ---- Terrain -------------------------------------------------------------
  const rolling = fbm(valueNoise2D(seed), 5);
  const detail = valueNoise2D(seed + 1);
  const ridges = fbm(valueNoise2D(seed + 3), 4);
  const natural = (x: number, z: number): number => {
    let h = 16 + rolling(x / 900, z / 900) * 18 + detail(x / 120, z / 120) * 1.5;
    // NW hills: a broad rise with sharp ridges on top.
    const hill = smoothstep(1250, 150, Math.hypot(x - size * 0.04, z - size * 0.04));
    h += hill * (90 + 110 * (1 - Math.abs(ridges(x / 420, z / 420))) ** 2);
    h = lerp(h, 15, smoothstep(800, 250, distC(x, z)) * 0.7); // calmer downtown
    const dr = Math.abs(x - riverX(z));
    h = lerp(-6, h, smoothstep(45, 260, dr)); // river valley
    h -= 45 * smoothstep(size * 0.86, size * 0.99, z); // the sea to the south
    return h;
  };
  const n = Math.round(size / cell) + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = natural(i * cell, j * cell);
  const dry = (x: number, z: number) => natural(x, z) > WATER + DRY;
  /** Rise over run across ~40 m; streets stay off slopes steeper than MAX_GRADE. */
  const MAX_GRADE = 0.11;
  const grade = (x: number, z: number) =>
    Math.hypot(natural(x + 20, z) - natural(x - 20, z), natural(x, z + 20) - natural(x, z - 20)) / 40;

  // ---- Street grid ---------------------------------------------------------
  // Block size grows away from the center.
  const spacing = (d: number) => (d < 520 ? 110 : d < 1050 ? 135 : 165);
  const lines = (c: number, lo: number, hi: number) => {
    const out = [c];
    for (let v = c; v + spacing(v - c) <= hi; ) out.push((v += spacing(v - c)));
    for (let v = c; v - spacing(c - v) >= lo; ) out.unshift((v -= spacing(c - v)));
    return out;
  };
  const xs = lines(center[0], 140, size - 140);
  const zs = lines(center[1], 140, size - 140);
  const cx0 = xs.indexOf(center[0]);
  const cz0 = zs.indexOf(center[1]);

  const warp = valueNoise2D(seed + 2);
  type GridNode = { id: string; p: [number, number] };
  const grid: (GridNode | null)[][] = xs.map((x, ix) =>
    zs.map((z, iz) => {
      const w = smoothstep(650, 1400, distC(x, z)) * 22;
      const p: [number, number] = [x + warp(x / 200, z / 200) * w, z + warp(z / 200 + 50, x / 200) * w];
      const nearRiver = Math.abs(p[0] - riverX(p[1])) < 80;
      return dry(p[0], p[1]) && !nearRiver && grade(p[0], p[1]) < MAX_GRADE ? { id: `n${ix}_${iz}`, p } : null;
    }),
  );

  const edges = new Map<string, { id: string; a: string; b: string; kind: RoadKind }>();
  const edgeKey = (a: GridNode, b: GridNode) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  const tryEdge = (a: GridNode | null, b: GridNode | null, avenue: boolean) => {
    if (!a || !b) return;
    // No bridges yet: both ends on the same bank, dry all the way.
    if (Math.sign(a.p[0] - riverX(a.p[1])) !== Math.sign(b.p[0] - riverX(b.p[1]))) return;
    for (let t = 0.2; t < 1; t += 0.2) {
      const x = lerp(a.p[0], b.p[0], t), z = lerp(a.p[1], b.p[1], t);
      if (!dry(x, z) || grade(x, z) > MAX_GRADE) return;
    }
    const mid = distC((a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2);
    if (!avenue && mid > 1100 && rng() < 0.07) return; // irregular suburbs
    const key = edgeKey(a, b);
    edges.set(key, { id: `e${edges.size}`, a: a.id, b: b.id, kind: avenue ? "avenue" : "street" });
  };
  for (let ix = 0; ix < xs.length; ix++) {
    for (let iz = 0; iz < zs.length; iz++) {
      if (ix + 1 < xs.length) tryEdge(grid[ix][iz], grid[ix + 1][iz], (iz - cz0) % 4 === 0);
      if (iz + 1 < zs.length) tryEdge(grid[ix][iz], grid[ix][iz + 1], (ix - cx0) % 4 === 0);
    }
  }
  pruneFragments(edges, 8);
  const usedNodes = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  const edgeBetween = (a: GridNode, b: GridNode) => edges.get(edgeKey(a, b));

  // ---- Blocks, parcels, buildings -------------------------------------------
  const parcels: CityFileInput["parcels"] = [];
  const buildings: NonNullable<CityFileInput["buildings"]> = [];
  const round = (p: P2): Vec2 => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  const allDry = (poly: P2[]) => poly.every(([x, z]) => dry(x, z));

  const addParcel = (poly: P2[], zone: Zone) => {
    const id = `p${parcels.length}`;
    parcels.push({ id, polygon: poly.map(round), zone });
    return id;
  };
  const addBuilding = (
    parcel: string,
    footprint: P2[],
    floors: number,
    style: string,
    roof: "flat" | "gable" | "hip" = "flat",
    floorHeight?: number,
  ) => {
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

  /** The buildable block inside the streets around grid cell (ix, iz), if any. */
  const blockAt = (ix: number, iz: number): P2[] | null => {
    const c = [grid[ix][iz], grid[ix + 1][iz], grid[ix + 1][iz + 1], grid[ix][iz + 1]];
    if (c.some((v) => !v)) return null;
    const [a, b, cc, d] = c as GridNode[];
    const sides = [edgeBetween(a, b), edgeBetween(b, cc), edgeBetween(cc, d), edgeBetween(d, a)];
    if (sides.some((s) => !s)) return null;
    const setback = sides.map((s) => {
      const r = ROAD_DEFAULTS[s!.kind];
      return r.width / 2 + r.sidewalk + 0.5;
    });
    const block = insetConvex([a.p, b.p, cc.p, d.p], setback);
    return block && allDry(block) ? block : null;
  };

  // Landmarks: each takes a whole block in its preferred distance band.
  const LANDMARK_RULES: { style: string; band: [number, number]; min: number; floors: number; fh: number; zone: Zone }[] = [
    { style: "supertall", band: [110, 360], min: 55, floors: 72, fh: 3.8, zone: "commercial" },
    { style: "museum", band: [260, 620], min: 60, floors: 3, fh: 5, zone: "civic" },
    { style: "concert-hall", band: [300, 700], min: 60, floors: 5, fh: 5, zone: "civic" },
    { style: "library", band: [350, 800], min: 50, floors: 4, fh: 4.2, zone: "civic" },
    { style: "market-hall", band: [480, 950], min: 55, floors: 1, fh: 7, zone: "commercial" },
    { style: "station", band: [520, 1050], min: 70, floors: 4, fh: 4, zone: "civic" },
    { style: "stadium", band: [900, 1600], min: 120, floors: 5, fh: 4, zone: "civic" },
    { style: "chapel", band: [950, 1500], min: 40, floors: 1, fh: 8, zone: "civic" },
  ];
  const landmarkAt = new Map<string, (typeof LANDMARK_RULES)[number]>();
  {
    const candidates: { key: string; dist: number; minDim: number }[] = [];
    for (let ix = 0; ix + 1 < xs.length; ix++) {
      for (let iz = 0; iz + 1 < zs.length; iz++) {
        if ((ix === cx0 && iz === cz0) || (ix === cx0 + 2 && iz === cz0 - 1)) continue;
        const block = blockAt(ix, iz);
        if (!block) continue;
        const [bx, bz] = centroid(block);
        const minDim = Math.min(Math.hypot(block[1][0] - block[0][0], block[1][1] - block[0][1]), Math.hypot(block[3][0] - block[0][0], block[3][1] - block[0][1]));
        candidates.push({ key: `${ix},${iz}`, dist: distC(bx, bz), minDim });
      }
    }
    for (const rule of LANDMARK_RULES) {
      const mid = (rule.band[0] + rule.band[1]) / 2;
      const pick = candidates
        .filter((c) => !landmarkAt.has(c.key) && c.dist >= rule.band[0] && c.dist <= rule.band[1] && c.minDim >= rule.min)
        .sort((a, b) => Math.abs(a.dist - mid) - Math.abs(b.dist - mid))[0];
      if (pick) landmarkAt.set(pick.key, rule);
    }
  }

  for (let ix = 0; ix + 1 < xs.length; ix++) {
    for (let iz = 0; iz + 1 < zs.length; iz++) {
      const block = blockAt(ix, iz);
      if (!block) continue;

      const [bx, bz] = centroid(block);
      const dist = distC(bx, bz);
      const nearRiver = Math.abs(bx - riverX(bz)) < 330;
      const lenU = Math.hypot(block[1][0] - block[0][0], block[1][1] - block[0][1]);
      const lenV = Math.hypot(block[3][0] - block[0][0], block[3][1] - block[0][1]);

      if (ix === cx0 && iz === cz0) {
        // Civic plaza with a town hall.
        const pid = addParcel(block, "plaza");
        const hall = insetConvex(block, 26);
        if (hall) addBuilding(pid, hall, 4, "civic", "hip", 4.5);
        continue;
      }
      const landmark = landmarkAt.get(`${ix},${iz}`);
      if (landmark) {
        const pid = addParcel(block, landmark.zone);
        const lot = insetConvex(block, 3);
        if (lot) addBuilding(pid, lot, landmark.floors, landmark.style, "flat", landmark.fh);
        continue;
      }
      if ((dist > 300 && rng() < 0.06) || (ix === cx0 + 2 && iz === cz0 - 1)) {
        addParcel(block, "park");
        continue;
      }

      // Lot grid and zone by distance from the center.
      let zone: Zone;
      let lot: number;
      if (dist < 470) [zone, lot] = ["commercial", 48];
      else if (nearRiver && dist > 900) [zone, lot] = ["industrial", 60];
      else if (dist < 1000) [zone, lot] = ["mixed", 30];
      else [zone, lot] = ["residential", 22];

      const nu = zone === "residential" && lenU < lenV ? 2 : Math.max(1, Math.round(lenU / lot));
      const nv = zone === "residential" && lenV <= lenU ? 2 : Math.max(1, Math.round(lenV / lot));
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          const perimeter = i === 0 || j === 0 || i === nu - 1 || j === nv - 1;
          if (zone === "mixed" && !perimeter) continue; // courtyard
          const q = [quadPoint(block, i / nu, j / nv), quadPoint(block, (i + 1) / nu, j / nv),
            quadPoint(block, (i + 1) / nu, (j + 1) / nv), quadPoint(block, i / nu, (j + 1) / nv)];
          if (area(q) < 80 || !allDry(q)) continue;
          const pid = addParcel(q, zone);

          if (zone === "commercial") {
            const fp = insetConvex(q, 2.5);
            if (!fp) continue;
            const core = Math.pow(1 - Math.min(1, dist / 470), 1.4);
            const floors = (6 + 42 * core) * range(rng, 0.55, 1.25);
            addBuilding(pid, fp, floors, floors > 14 ? "glass-tower" : "office", "flat", floors > 14 ? 3.8 : 3.5);
          } else if (zone === "mixed") {
            const fp = insetConvex(q, 1.5);
            if (fp) addBuilding(pid, fp, range(rng, 3, 8), pick(rng, ["brick-midrise", "apartment"]));
          } else if (zone === "industrial") {
            // Sheds sit to one side of the lot, leaving a yard for trucks and parking.
            const back = Math.floor(rng() * 4);
            const fp = insetConvex(q, [0, 1, 2, 3].map((k) => (k === back ? 20 : 5)));
            if (fp) addBuilding(pid, fp, range(rng, 1, 3), "industrial", "flat", 5.5);
          } else {
            const inset = insetConvex(q, 4);
            if (!inset) continue;
            // Shrink toward the lot center for a garden around the house.
            const [hx, hz] = centroid(inset);
            const s = Math.min(0.85, 13 / Math.sqrt(area(inset)));
            const house = inset.map(([x, z]) => [hx + (x - hx) * s, hz + (z - hz) * s] as [number, number]);
            // Mostly flat-roofed modern houses, with some pitched-roof ones.
            const roof = rng() < 0.65 ? "flat" : rng() < 0.6 ? "gable" : "hip";
            addBuilding(pid, house, rng() < 0.75 ? 2 : rng() < 0.5 ? 1 : 3, "suburban-house", roof, 3);
          }
        }
      }
    }
  }

  return {
    format: "system-a/city",
    version: 1,
    meta: {
      name: "Demo City",
      description: "Generic modern city: downtown towers, mid-rise ring, suburbs, river and coast.",
      generator: "generators/demo.ts",
      seed,
    },
    terrain: {
      size: [size, size],
      resolution: [n, n],
      heights: encodeHeights(heights),
      waterLevel: WATER,
    },
    roads: {
      nodes: grid.flat().filter((v): v is GridNode => !!v && usedNodes.has(v.id)).map((v) => ({ id: v.id, p: round(v.p) })),
      edges: [...edges.values()],
    },
    parcels,
    buildings,
  };
}

/** Drop small disconnected road fragments (fewer than `minEdges` edges). */
function pruneFragments(edges: Map<string, { a: string; b: string }>, minEdges: number) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const { a, b } of edges.values()) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const size = new Map<string, number>();
  for (const { a } of edges.values()) size.set(find(a), (size.get(find(a)) ?? 0) + 1);
  for (const [key, { a }] of edges) if ((size.get(find(a)) ?? 0) < minEdges) edges.delete(key);
}

function arg(name: string): string | undefined {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 ? process.argv[k + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg("out") ?? "public/cities/demo.city.json";
  const t0 = performance.now();
  const raw = generateDemo({ seed: Number(arg("seed") ?? 7), size: 3200, cell: 8 });
  const city = parseCity(raw); // never write a file the engine would reject
  mkdirSync(dirname(out), { recursive: true });
  const json = JSON.stringify(raw);
  writeFileSync(out, json);
  console.log(
    `${out}: ${city.roads.nodes.length} nodes, ${city.roads.edges.length} roads, ` +
      `${city.parcels.length} parcels, ${city.buildings.length} buildings, ` +
      `${(json.length / 1e6).toFixed(1)} MB in ${Math.round(performance.now() - t0)} ms`,
  );
}
