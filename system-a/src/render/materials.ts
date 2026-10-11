/**
 * Materials shared by every view that draws `Parts` (buildings, props): one
 * set per world, so lighting changes (night, weather) apply everywhere.
 */
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Material } from "three";
import { defineResource, type World } from "../ecs/world";
import type { Slot } from "../buildings/kit";

export type PartMaterials = Record<Slot, MeshStandardMaterial>;

export interface NightMaterials {
  /** Lit windows: warm panes over the glass, faded in at night. */
  lit: MeshBasicMaterial;
  /** Pools of lamplight on the ground. */
  pool: MeshBasicMaterial;
}

export const MaterialsR = defineResource<PartMaterials>("PartMaterials");
export const NightMaterialsR = defineResource<NightMaterials>("NightMaterials");

/** 0 by day, 1 at night; read by the glow material's shader. */
export const nightUniform = { value: 0 };

export function partMaterials(world: World): PartMaterials {
  let m = world.getResource(MaterialsR);
  if (!m) {
    const glow = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    // Glow parts (lamps, signs, lettering) light up with their own color at night.
    glow.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = nightUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNight;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uNight * 1.6;");
    };
    m = {
      matte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      glass: new MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.8 }),
      metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55, envMapIntensity: 1.2 }),
      glow,
    };
    world.setResource(MaterialsR, m);
  }
  return m;
}

function radialTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export function nightMaterials(world: World): NightMaterials {
  let m = world.getResource(NightMaterialsR);
  if (!m) {
    m = {
      // Brighter than white, so lit panes bloom on the high tier.
      lit: new MeshBasicMaterial({ color: new Color(1.5, 1.5, 1.5), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      pool: new MeshBasicMaterial({
        color: 0xffc98a,
        map: radialTexture(),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        fog: false,
        side: DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    };
    world.setResource(NightMaterialsR, m);
  }
  return m;
}

/** Set every night-aware material for a night factor in [0, 1]. */
export function applyNight(world: World, night: number): void {
  nightUniform.value = night;
  const m = nightMaterials(world);
  m.lit.opacity = Math.min(1, night * 1.1);
  m.lit.visible = night > 0.02;
  m.pool.opacity = night * 0.4;
  m.pool.visible = night > 0.02;
}

export type { Material };
