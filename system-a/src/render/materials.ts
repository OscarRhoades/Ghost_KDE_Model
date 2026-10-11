/**
 * Materials shared by every view that draws `Parts` (buildings, props): one
 * set per world, so lighting changes (night, weather) apply everywhere.
 */
import { MeshStandardMaterial, type Material } from "three";
import { defineResource, type World } from "../ecs/world";
import type { Slot } from "../buildings/kit";

export type PartMaterials = Record<Slot, MeshStandardMaterial>;

export const MaterialsR = defineResource<PartMaterials>("PartMaterials");

export function partMaterials(world: World): PartMaterials {
  let m = world.getResource(MaterialsR);
  if (!m) {
    m = {
      matte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
      glass: new MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.8 }),
      metal: new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55, envMapIntensity: 1.2 }),
      glow: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    };
    world.setResource(MaterialsR, m);
  }
  return m;
}

export type { Material };
