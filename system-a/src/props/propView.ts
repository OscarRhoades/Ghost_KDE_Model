/**
 * Props on screen: trees, street furniture and park features, merged into one
 * mesh per material per tile and streamed around the view like building
 * detail. Optional props are thinned on lower quality tiers.
 */
import { Group } from "three";
import type { World } from "../ecs/world";
import { FocusR, Prop, TerrainR, type PropData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { disposeGroup, toGroup } from "../buildings/buildingView";
import { newParts, type Slot } from "../buildings/kit";
import { partMaterials } from "../render/materials";
import { QualityR } from "../render/quality";
import { SceneR } from "../render/renderPlugin";
import { templateFor } from "./catalog";

/** Prop tile edge (m): smaller than building tiles, props are dense. */
export const PROP_TILE = 120;
const HYSTERESIS = 1.25;
const BUDGET_MS =
  typeof location !== "undefined" && new URLSearchParams(location.search).has("eager") ? Infinity : 6;

/** Stable 0..1 value per prop, for thinning optional props. */
export function propKeep(p: PropData): number {
  let h = Math.imul(Math.round(p.x * 10), 374761393) ^ Math.imul(Math.round(p.z * 10), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Whether a prop is shown at this density (non-optional props always are). */
export function propShown(p: PropData, density: number): boolean {
  return !p.optional || propKeep(p) < density;
}

/** Ground elevation a prop stands at. */
export function propY(world: World, p: PropData): number {
  if (p.y !== undefined) return p.y;
  return world.resource(TerrainR).hf.heightAt(p.x, p.z) + (p.lift ?? 0);
}

interface Tile {
  key: string;
  cx: number;
  cz: number;
  props: PropData[];
  group: Group | null;
}

export function propView(): Plugin {
  return {
    name: "prop-view",
    install(engine) {
      let tiles: Tile[] = [];
      let builtFor = -1;

      const dropAll = () => {
        for (const t of tiles) if (t.group) disposeGroup(t.group), (t.group = null);
      };

      engine.addSystem({
        name: "prop-view",
        onLoad(world) {
          const byKey = new Map<string, Tile>();
          for (const e of world.query(Prop)) {
            const p = world.read(e, Prop);
            const i = Math.floor(p.x / PROP_TILE);
            const j = Math.floor(p.z / PROP_TILE);
            const key = `${i},${j}`;
            let t = byKey.get(key);
            if (!t) byKey.set(key, (t = { key, cx: (i + 0.5) * PROP_TILE, cz: (j + 0.5) * PROP_TILE, props: [], group: null }));
            t.props.push(p);
          }
          tiles = [...byKey.values()];
        },
        onUnload() {
          dropAll();
          tiles = [];
        },
        update(world) {
          const quality = world.getResource(QualityR);
          const focus = world.getResource(FocusR);
          const density = quality?.propDensity ?? 1;
          if (quality && quality.version !== builtFor) {
            builtFor = quality.version;
            dropAll();
          }
          const want = focus?.detailRadius ? Math.min(focus.detailRadius, quality?.propRadius ?? Infinity) : 0;
          const dist = (t: Tile) => (focus ? Math.max(0, Math.hypot(t.cx - focus.x, t.cz - focus.z) - PROP_TILE * 0.71) : Infinity);
          for (const t of tiles) {
            if (t.group && (want <= 0 || dist(t) > want * HYSTERESIS)) {
              disposeGroup(t.group);
              t.group = null;
            }
          }
          if (want <= 0) return;
          const scene = world.resource(SceneR);
          const materials = partMaterials(world);
          const start = performance.now();
          const missing = tiles.filter((t) => !t.group && dist(t) <= want).sort((a, b) => dist(a) - dist(b));
          for (const t of missing) {
            if (performance.now() - start > BUDGET_MS) break;
            const parts = newParts();
            for (const p of t.props) {
              if (!propShown(p, density)) continue;
              const tpl = templateFor(p.kind);
              if (!tpl) continue;
              const y = propY(world, p);
              for (const slot of Object.keys(tpl.parts) as Slot[]) {
                const d = tpl.parts[slot]!;
                parts[slot].appendTransformed(d.pos, d.col, p.rot, p.scale, p.x, y, p.z);
              }
            }
            t.group = toGroup(parts, materials, `props-${t.key}`);
            scene.add(t.group);
          }
        },
      });
    },
  };
}
