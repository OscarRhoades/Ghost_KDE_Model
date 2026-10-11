/**
 * Buildings on screen. The city is cut into square tiles. Every tile has a
 * cheap massing mesh; tiles near the focus also get full street-level detail,
 * built a few at a time and dropped again when the view moves away, so memory
 * and triangle counts stay bounded on large cities and phones.
 */
import { Group, Mesh, MeshStandardMaterial, type Material } from "three";
import type { World } from "../ecs/world";
import { Building, FocusR, type BuildingData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { centroid } from "../geom/polygon";
import { addToScene, SceneR } from "../render/renderPlugin";
import { newParts, type Parts, type Slot } from "./kit";
import { buildBuilding } from "./index";

/** Tile edge length in meters. */
export const TILE = 320;
/** Time per frame (ms) spent building detail tiles. */
const BUILD_BUDGET_MS =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("eager") ? Infinity : 12; // ?eager: build all at once (screenshots)
/** Detail is dropped once a tile is this much farther than the wanted radius. */
const HYSTERESIS = 1.3;

interface Tile {
  cx: number;
  cz: number;
  buildings: BuildingData[];
  massing: Group;
  detail: Group | null;
  /** Detail under construction: buildings are added a few per frame. */
  pending: { parts: Parts; next: number } | null;
}

function makeMaterials(): Record<Slot, Material> {
  return {
    matte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
    glass: new MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.8 }),
    metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55, envMapIntensity: 1.2 }),
    glow: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
  };
}

function toGroup(parts: Parts, materials: Record<Slot, Material>, name: string): Group {
  const g = new Group();
  g.name = name;
  for (const slot of Object.keys(parts) as Slot[]) {
    if (parts[slot].triangleCount === 0) continue;
    const mesh = new Mesh(parts[slot].build(), materials[slot]);
    // Sunlight passes through glass into the interiors.
    mesh.castShadow = slot !== "glass";
    mesh.receiveShadow = true;
    mesh.name = `${name}-${slot}`;
    g.add(mesh);
  }
  return g;
}

function disposeGroup(g: Group) {
  g.traverse((o) => (o as Mesh).geometry?.dispose());
  g.removeFromParent();
}

/** Group buildings into tiles by footprint centroid. */
export function tileBuildings(world: World): Map<string, BuildingData[]> {
  const out = new Map<string, BuildingData[]>();
  for (const e of world.query(Building)) {
    const b = world.read(e, Building);
    const [x, z] = centroid(b.footprint);
    const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let list = out.get(key);
    if (!list) out.set(key, (list = []));
    list.push(b);
  }
  return out;
}

export function buildingView(): Plugin {
  return {
    name: "building-view",
    install(engine) {
      let materials: Record<Slot, Material>;
      let tiles: Tile[] = [];

      engine.addSystem({
        name: "building-view",
        start() {
          materials = makeMaterials();
        },
        onLoad(world) {
          tiles = [];
          for (const [key, buildings] of tileBuildings(world)) {
            const [i, j] = key.split(",").map(Number);
            const parts = newParts();
            for (const b of buildings) buildBuilding(parts, b, "massing");
            const massing = toGroup(parts, materials, `buildings-${key}`);
            addToScene(world, massing);
            tiles.push({ cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, buildings, massing, detail: null, pending: null });
          }
        },
        onUnload() {
          for (const t of tiles) if (t.detail) disposeGroup(t.detail);
          // Pending jobs are dropped with their tiles.
          tiles = [];
        },
        update(world) {
          const focus = world.getResource(FocusR);
          const radius = focus?.detailRadius ?? 0;
          const scene = world.resource(SceneR);
          const dist = (t: Tile) => (focus ? Math.max(0, Math.hypot(t.cx - focus.x, t.cz - focus.z) - TILE * 0.71) : Infinity);

          // Drop detail (finished or in progress) that is well out of range.
          for (const t of tiles) {
            const far = radius <= 0 || dist(t) > radius * HYSTERESIS;
            if (far && t.detail) {
              disposeGroup(t.detail);
              t.detail = null;
              t.massing.visible = true;
            }
            if (far) t.pending = null;
          }
          if (radius <= 0) return;

          // Build the nearest missing tiles, building by building, within this
          // frame's budget; a tile swaps from massing to detail once complete.
          const wanted = tiles.filter((t) => !t.detail && dist(t) <= radius).sort((a, b) => dist(a) - dist(b));
          const start = performance.now();
          for (const t of wanted) {
            t.pending ??= { parts: newParts(), next: 0 };
            const job = t.pending;
            while (job.next < t.buildings.length && performance.now() - start < BUILD_BUDGET_MS) {
              buildBuilding(job.parts, t.buildings[job.next++], "detail");
            }
            if (job.next < t.buildings.length) break;
            t.detail = toGroup(job.parts, materials, `detail-${t.cx}-${t.cz}`);
            t.pending = null;
            scene.add(t.detail);
            t.massing.visible = false;
            if (performance.now() - start > BUILD_BUDGET_MS) break;
          }
        },
      });
    },
  };
}
