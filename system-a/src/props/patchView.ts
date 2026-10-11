/**
 * Ground overlays (paths, paving, ponds, sandpits, yards) draped over the
 * terrain: each convex outline is cut into small pieces that follow the
 * ground, merged into one mesh.
 */
import { Color, Mesh, MeshStandardMaterial } from "three";
import { stylize } from "../render/style";
import { Patch, TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import type { P2 } from "../geom/polygon";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { addToScene } from "../render/renderPlugin";
import { clipConvex } from "./landscape";

/** Size of the draping grid (m). */
const PIECE = 4;
const UP: V3 = [0, 1, 0];

export function patchView(): Plugin {
  return {
    name: "patch-view",
    install(engine) {
      engine.addSystem({
        name: "patch-view",
        onLoad(world) {
          const { hf } = world.resource(TerrainR);
          const mb = new MeshBuilder();
          const colors = new Map<string, Color>();
          for (const e of world.query(Patch)) {
            const p = world.read(e, Patch);
            let c = colors.get(p.color);
            if (!c) colors.set(p.color, (c = new Color(p.color)));
            let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
            for (const [x, z] of p.poly) {
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
            }
            for (let x = Math.floor(minX / PIECE) * PIECE; x < maxX; x += PIECE) {
              for (let z = Math.floor(minZ / PIECE) * PIECE; z < maxZ; z += PIECE) {
                const cell: P2[] = [[x, z], [x + PIECE, z], [x + PIECE, z + PIECE], [x, z + PIECE]];
                const piece = clipConvex(p.poly, cell);
                if (!piece) continue;
                const v = piece.map(([px, pz]): V3 => [px, hf.heightAt(px, pz) + p.lift, pz]);
                for (let k = 1; k + 1 < v.length; k++) mb.triFacing(v[0], v[k], v[k + 1], UP, c);
              }
            }
          }
          if (mb.triangleCount === 0) return;
          const mesh = new Mesh(
            mb.build(),
            stylize(new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { edges: false, paint: 1.3, rim: 0.3, paving: 1.5 }),
          );
          mesh.receiveShadow = true;
          mesh.name = "patches";
          addToScene(world, mesh);
        },
      });
    },
  };
}
