import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from "three";
import { stylize, stylizeWater } from "../render/style";
import { TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { addToScene } from "../render/renderPlugin";
import { Surface } from "./conform";
import type { Heightfield } from "./heightfield";

/** Cells per terrain chunk side; chunks are separate meshes for culling. */
const CHUNK = 64;

const C = {
  grass: new Color("#76b54c"),
  grassDark: new Color("#5fa743"),
  meadow: new Color("#b5c95a"),
  rock: new Color("#a8957c"),
  sand: new Color("#f0d9a0"),
  seabed: new Color("#d6c08a"),
  deep: new Color("#3f8f9e"),
  pad: new Color("#e6dccb"),
  park: new Color("#71b84b"),
  plaza: new Color("#eadfca"),
  lawn: new Color("#84c057"),
  lawnDark: new Color("#74b84c"),
  road: new Color("#c9bfae"),
  earth: new Color("#8a6a4a"),
  water: new Color("#3fb4d0"),
};

export function terrainView(): Plugin {
  return {
    name: "terrain-view",
    install(engine) {
      engine.addSystem({
        name: "terrain-view",
        onLoad(world) {
          const t = world.resource(TerrainR);
          const material = stylize(new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), { edges: false, paint: 1.6, rim: 0.3 });
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
              stylizeWater(new MeshStandardMaterial({ color: C.water, roughness: 0.18, metalness: 0.0, transparent: true, opacity: 0.92, envMapIntensity: 0.6 })),
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

/** Color of the ground at one terrain sample, from its surface, height and slope. */
function vertexColor(hf: Heightfield, surface: Uint8Array, water: number | undefined, i: number, j: number, n: V3, out: Color): Color {
  const s = surface[hf.index(i, j)];
  const y = hf.data[hf.index(i, j)];
  const j1 = jitter(Math.floor(i / 3), Math.floor(j / 3));
  switch (s) {
    case Surface.pad: return out.copy(C.pad);
    case Surface.plaza: return out.copy(C.plaza);
    case Surface.lawn: return out.copy(C.lawn).lerp(C.lawnDark, j1);
    case Surface.road: return out.copy(C.road);
    case Surface.park: return out.copy(C.park).lerp(C.grassDark, j1 * 0.5);
  }
  if (water !== undefined && y < water - 0.3) return out.copy(C.seabed).lerp(C.deep, Math.min(1, (water - y) / 8));
  if (water !== undefined && y < water + 1.4) return out.copy(C.sand);
  // Grass in soft patches, drier higher up; steep ground shows rock.
  out.copy(C.grass).lerp(C.grassDark, j1 * 0.6).lerp(C.meadow, Math.min(1, Math.max(0, (y - 40) / 120)));
  return out.lerp(C.rock, Math.min(1, Math.max(0, (0.86 - n[1]) / 0.12)));
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
  // Smooth shading: one normal and one color per terrain sample.
  const w = i1 - i0 + 1;
  const h = (ii: number, jj: number) => hf.sample(Math.min(hf.nx - 1, Math.max(0, ii)), Math.min(hf.nz - 1, Math.max(0, jj)));
  const verts: { p: V3; n: V3; c: Color }[] = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * hf.cellX);
      const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * hf.cellZ);
      const l = Math.hypot(dx, 1, dz);
      const n: V3 = [-dx / l, 1 / l, -dz / l];
      verts.push({ p: [i * hf.cellX, h(i, j), j * hf.cellZ], n, c: vertexColor(hf, surface, water, i, j, n, new Color()) });
    }
  }
  const at = (i: number, j: number) => verts[(j - j0) * w + (i - i0)];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      // Counter-clockwise seen from above.
      mb.triSmooth(a.p, d.p, c.p, a.n, d.n, c.n, a.c, d.c, c.c);
      mb.triSmooth(a.p, c.p, b.p, a.n, c.n, b.n, a.c, c.c, b.c);
    }
  }
  return mb.build();
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
