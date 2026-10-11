/**
 * Quality tiers. The viewer picks one from the device (phones get "low" or
 * "medium"), and the viewer's quality button can override it. Systems read
 * the settings each frame and react when `version` changes.
 */
import { defineResource } from "../ecs/world";

export type Tier = "low" | "medium" | "high";
export const TIERS: Tier[] = ["low", "medium", "high"];

export interface QualitySettings {
  tier: Tier;
  /** Bumped on every change so systems can re-apply settings. */
  version: number;
  pixelRatioCap: number;
  shadowMapSize: number;
  /** Multiplier on building-detail streaming radii. */
  detailScale: number;
  /** Street props are drawn within this distance (m) of the view. */
  propRadius: number;
  /** Share of optional props kept (0..1). */
  propDensity: number;
  /** Ambient occlusion, bloom and grading. */
  postFx: boolean;
}

const PRESETS: Record<Tier, Omit<QualitySettings, "tier" | "version">> = {
  low: { pixelRatioCap: 1.25, shadowMapSize: 1024, detailScale: 0.6, propRadius: 160, propDensity: 0.45, postFx: false },
  medium: { pixelRatioCap: 1.5, shadowMapSize: 2048, detailScale: 0.85, propRadius: 260, propDensity: 0.75, postFx: false },
  high: { pixelRatioCap: 2, shadowMapSize: 4096, detailScale: 1, propRadius: 400, propDensity: 1, postFx: true },
};

export function settingsFor(tier: Tier, version = 0): QualitySettings {
  return { tier, version, ...PRESETS[tier] };
}

/** Best guess from the device: phones and small or low-core machines get lighter settings. */
export function detectTier(): Tier {
  if (typeof window === "undefined") return "medium";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 8;
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (touch) return cores >= 8 && memory >= 6 ? "medium" : "low";
  return cores >= 8 && memory >= 8 ? "high" : "medium";
}

const STORAGE_KEY = "systemA.quality";

/** The tier the viewer last chose by hand, if any. */
export function savedTier(): Tier | null {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t && (TIERS as string[]).includes(t) ? (t as Tier) : null;
  } catch {
    return null;
  }
}

export function saveTier(t: Tier): void {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

export const QualityR = defineResource<QualitySettings>("Quality");
