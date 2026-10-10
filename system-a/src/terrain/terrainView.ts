import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { addToScene } from "../render/renderPlugin";
import { Surface } from "./conform";
import type { Heightfield } from "./heightfield";

/** Cells per terrain chunk side; chunks are separate meshes for culling. */
const CHUNK = 64;

const C = {
  grass: new Color("#93c26c"),
  grassDark: new Color("#8bbd66"),
  rock: new Color("#a39a8c"),
  sand: new Color("#e3d29d"),
  seabed: new Color("#c4b385"),
  pad: new Color("#d9d3c5"),
  park: new Color("#74b65a"),
  plaza: new Color("#e7e0cf"),
  lawn: new Color("#9cc979"),
  lawnDark: new Color("#93c171"),
  road: new Color("#b9b5ad"),
  earth: new Color("#8c7558"),
  water: new Color("#5aa6d1"),
};

export function terrainView(): Plugin {
  return {
    name: "terrain-view",
    install(engine) {
      engine.addSystem({
        name: "terrain-view",
        onLoad(world) {
          const t = world.resource(TerrainR);
          const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
          const cellsX = t.hf.nx - 1;
          const cellsZ = t.hf.nz - 1;
          for (let cj = 0; cj < cellsZ; cj += CHUNK) {
            for (let ci = 0; ci < cellsX; ci += CHUNK) {
              const mesh = new Mesh(
                buildChunk(t.hf, t.surface, t.waterLevel, ci, cj, Math.min(cellsX, ci + CHUNK), Math.min(cellsZ, cj + CHUNK)),
                material,
              );
              mesh.receiveShadow = true;
              mesh.name = `terrain-${ci}-${cj}`;
              addToScene(world, mesh);
            }
          }
          const skirt = new Mesh(buildSkirt(t.hf, t.waterLevel), material);
          skirt.name = "terrain-skirt";
          addToScene(world, skirt);

          if (t.waterLevel !== undefined) {
            // Oversized so the sea reaches the horizon in iso view.
            const g = new PlaneGeometry(t.hf.width * 4, t.hf.depth * 4);
            g.rotateX(-Math.PI / 2);
            g.translate(t.hf.width / 2, t.waterLevel, t.hf.depth / 2);
            const water = new Mesh(
              g,
              new MeshStandardMaterial({ color: C.water, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.88 }),
            );
            water.receiveShadow = true;
            water.name = "water";
            addToScene(world, water);
          }
        },
      });
    },
  };
}

/** Cheap deterministic per-cell jitter in [0, 1). */
function jitter(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function faceColor(
  surface: Uint8Array,
  water: number | undefined,
  idx: [number, number, number],
  ys: [number, number, number],
  normalY: number,
  i: number,
  j: number,
): Color {
  const s0 = surface[idx[0]], s1 = surface[idx[1]], s2 = surface[idx[2]];
  // Majority surface of the three corners.
  const s = s0 === s1 || s0 === s2 ? s0 : s1 === s2 ? s1 : s0;
  switch (s) {
    case Surface.pad: return C.pad;
    case Surface.plaza: return C.plaza;
    case Surface.lawn: return jitter(i, j) > 0.5 ? C.lawn : C.lawnDark;
    case Surface.road: return C.road;
    case Surface.park: return C.park;
  }
  const maxY = Math.max(...ys);
  if (water !== undefined && maxY < water) return C.seabed;
  if (water !== undefined && Math.min(...ys) < water + 1.2) return C.sand;
  if (normalY < 0.8) return C.rock;
  return jitter(i, j) > 0.35 ? C.grass : C.grassDark;
}

function buildChunk(
  hf: Heightfield,
  surface: Uint8Array,
  water: number | undefined,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
) {
  const mb = new MeshBuilder();
  const up: V3 = [0, 1, 0];
  const v = (i: number, j: number): V3 => [i * hf.cellX, hf.data[hf.index(i, j)], j * hf.cellZ];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const ia = hf.index(i, j), ib = hf.index(i + 1, j), ic = hf.index(i + 1, j + 1), id = hf.index(i, j + 1);
      // Alternate the split diagonal for a less regular low-poly pattern.
      const tris: [V3, V3, V3, [number, number, number]][] =
        (i + j) % 2 === 0
          ? [[a, b, c, [ia, ib, ic]], [a, c, d, [ia, ic, id]]]
          : [[a, b, d, [ia, ib, id]], [b, c, d, [ib, ic, id]]];
      for (const [p, q, r, idx] of tris) {
        const ny = normalY(p, q, r);
        mb.triFacing(p, q, r, up, faceColor(surface, water, idx, [p[1], q[1], r[1]], ny, i, j));
      }
    }
  }
  return mb.build();
}

function normalY(a: V3, b: V3, c: V3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return Math.abs(ny) / Math.hypot(nx, ny, nz);
}

/** Vertical walls around the map edge, like a cut-out diorama. */
function buildSkirt(hf: Heightfield, water: number | undefined) {
  const mb = new MeshBuilder();
  const bottom = Math.min(hf.minMax().min, water ?? Infinity) - 30;
  const edges: { pts: [number, number][]; out: V3 }[] = [
    { pts: Array.from({ length: hf.nx }, (_, i) => [i, 0]), out: [0, 0, -1] },
    { pts: Array.from({ length: hf.nx }, (_, i) => [i, hf.nz - 1]), out: [0, 0, 1] },
    { pts: Array.from({ length: hf.nz }, (_, j) => [0, j]), out: [-1, 0, 0] },
    { pts: Array.from({ length: hf.nz }, (_, j) => [hf.nx - 1, j]), out: [1, 0, 0] },
  ];
  for (const { pts, out } of edges) {
    for (let k = 1; k < pts.length; k++) {
      const [i0, j0] = pts[k - 1];
      const [i1, j1] = pts[k];
      const x0 = i0 * hf.cellX, z0 = j0 * hf.cellZ, x1 = i1 * hf.cellX, z1 = j1 * hf.cellZ;
      mb.quadFacing(
        [x0, bottom, z0],
        [x1, bottom, z1],
        [x1, hf.sample(i1, j1), z1],
        [x0, hf.sample(i0, j0), z0],
        out,
        C.earth,
      );
    }
  }
  return mb.build();
}
