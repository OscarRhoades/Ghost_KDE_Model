/**
 * Buildings on screen. The city is cut into square tiles. Every tile has a
 * cheap massing mesh; tiles near the focus also get full street-level detail,
 * built a few at a time and dropped again when the view moves away, so memory
 * and triangle counts stay bounded on large cities and phones.
 */
import { Color, Group, Mesh, type Material } from "three";
import type { World } from "../ecs/world";
import { Building, FocusR, type BuildingData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { centroid } from "../geom/polygon";
import { nightMaterials, partMaterials } from "../render/materials";
import { MeshBuilder } from "../render/meshBuilder";
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

export function toGroup(parts: Parts, materials: Record<Slot, Material>, name: string): Group {
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

const LIT = ["#ffd59a", "#ffe6bf", "#fff2da", "#ffc983", "#dde8ff"].map((h) => new Color(h));

/**
 * Lit windows for night: a share of the vertical glass panes, copied a little
 * in front of the glass in warm colors. Panes come in triangle pairs (quads).
 */
export function litWindows(glass: MeshBuilder, share = 0.45): MeshBuilder {
  const { pos } = glass.raw();
  const out = new MeshBuilder();
  for (let k = 0; k + 18 <= pos.length; k += 18) {
    const ax = pos[k], ay = pos[k + 1], az = pos[k + 2];
    const ux = pos[k + 3] - ax, uy = pos[k + 4] - ay, uz = pos[k + 5] - az;
    const vx = pos[k + 6] - ax, vy = pos[k + 7] - ay, vz = pos[k + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    nx /= len; ny /= len; nz /= len;
    if (Math.abs(ny) > 0.4) continue;
    const quad = quadOf(pos, k);
    if (!quad) continue;
    const { a, tx, tz, w, y0, h } = quad;
    // Big panes (curtain walls, ribbons) light up window by window and floor by floor.
    const cols = Math.max(1, Math.round(w / 1.8));
    const rows = Math.max(1, Math.round(h / 3.4));
    const cw = w / cols, ch = h / rows;
    const gx = cols > 1 ? 0.1 : 0, gy = rows > 1 ? 0.3 : 0;
    const o = 0.04;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const s0 = i * cw + gx, s1 = (i + 1) * cw - gx;
        const yy0 = y0 + j * ch + gy, yy1 = y0 + (j + 1) * ch - gy * 0.4;
        const hsh = hash3(Math.round((a[0] + tx * (s0 + s1) / 2) / 0.6), Math.round((yy0 + yy1) / 1.2), Math.round((a[2] + tz * (s0 + s1) / 2) / 0.6));
        if (hsh >= share) continue;
        const color = LIT[Math.floor((hsh / share) * LIT.length * 7) % LIT.length];
        const P = (sv: number, y: number): [number, number, number] => [a[0] + tx * sv + nx * o, y, a[2] + tz * sv + nz * o];
        out.quadFacing(P(s0, yy0), P(s1, yy0), P(s1, yy1), P(s0, yy1), [nx, ny, nz], color);
      }
    }
  }
  return out;
}

/** A vertical quad from a triangle pair: bottom-left corner, direction along, width, base and height. */
function quadOf(pos: ArrayLike<number>, k: number) {
  const pts: [number, number, number][] = [];
  for (let v = 0; v < 6; v++) {
    const q: [number, number, number] = [pos[k + v * 3], pos[k + v * 3 + 1], pos[k + v * 3 + 2]];
    if (!pts.some((r) => Math.abs(r[0] - q[0]) + Math.abs(r[1] - q[1]) + Math.abs(r[2] - q[2]) < 1e-4)) pts.push(q);
  }
  if (pts.length !== 4) return null;
  const ys = pts.map((q) => q[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const bottom = pts.filter((q) => q[1] < y0 + 0.01);
  if (bottom.length !== 2) return null;
  const [a, b] = bottom;
  const w = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (w < 0.05) return null;
  return { a, tx: (b[0] - a[0]) / w, tz: (b[2] - a[2]) / w, w, y0, h: y1 - y0 };
}

/**
 * Lit windows for the far-away massing: on each tall wall quad, rows of
 * small panes per storey, a share of them lit. Only lit panes become geometry.
 */
export function litMassing(builders: MeshBuilder[], share = 0.3): MeshBuilder {
  const out = new MeshBuilder();
  for (const mb of builders) {
    const { pos } = mb.raw();
    for (let k = 0; k + 18 <= pos.length; k += 18) {
      const pts: [number, number, number][] = [];
      for (let v = 0; v < 6; v++) {
        const q: [number, number, number] = [pos[k + v * 3], pos[k + v * 3 + 1], pos[k + v * 3 + 2]];
        if (!pts.some((r) => Math.abs(r[0] - q[0]) + Math.abs(r[1] - q[1]) + Math.abs(r[2] - q[2]) < 1e-4)) pts.push(q);
      }
      if (pts.length !== 4) continue;
      const ys = pts.map((q) => q[1]);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (y1 - y0 < 5) continue;
      const bottom = pts.filter((q) => q[1] < y0 + 0.01);
      if (bottom.length !== 2) continue;
      const [a, b] = bottom;
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len < 4) continue;
      const tx = (b[0] - a[0]) / len, tz = (b[2] - a[2]) / len;
      // Outward normal: from the triangle winding.
      const ux = pos[k + 3] - pos[k], uy = pos[k + 4] - pos[k + 1], uz = pos[k + 5] - pos[k + 2];
      const vx = pos[k + 6] - pos[k], vy = pos[k + 7] - pos[k + 1], vz = pos[k + 8] - pos[k + 2];
      let nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const o = 0.06;
      for (let y = y0 + 3.6; y + 1.6 < y1 - 0.6; y += 3.4) {
        for (let s = 1.2; s + 2.4 < len - 0.8; s += 4) {
          const h = hash3(Math.round(a[0] + tx * s), Math.round(y), Math.round(a[2] + tz * s));
          if (h >= share) continue;
          const color = LIT[Math.floor((h / share) * LIT.length * 7) % LIT.length];
          const P = (ds: number, dy: number): [number, number, number] => [a[0] + tx * (s + ds) + nx * o, y + dy, a[2] + tz * (s + ds) + nz * o];
          out.quadFacing(P(0, 0), P(2.4, 0), P(2.4, 1.6), P(0, 1.6), [nx, 0, nz], color);
        }
      }
    }
  }
  return out;
}

function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function disposeGroup(g: Group) {
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
        onLoad(world) {
          materials = partMaterials(world);
          tiles = [];
          for (const [key, buildings] of tileBuildings(world)) {
            const [i, j] = key.split(",").map(Number);
            const parts = newParts();
            for (const b of buildings) buildBuilding(parts, b, "massing");
            const massing = toGroup(parts, materials, `buildings-${key}`);
            const lit = litMassing([parts.matte, parts.glass]);
            if (lit.triangleCount) massing.add(new Mesh(lit.build(), nightMaterials(world).lit));
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
            const lit = litWindows(job.parts.glass);
            if (lit.triangleCount) {
              const mesh = new Mesh(lit.build(), nightMaterials(world).lit);
              mesh.name = "lit-windows";
              t.detail.add(mesh);
            }
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
