/**
 * Building styles. Most styles are recipes: weighted choices of facade
 * system, roof and palette, drawn by one shared driver over the building's
 * massing volumes. Fully custom styles (civic, landmarks) implement
 * `BuildingStyle` directly. Unknown style keys fall back to "default".
 */
import { Catalog } from "../catalog/registry";
import type { BuildingData } from "../engine/components";
import { insetConvex, type P2 } from "../geom/polygon";
import { bays, box, cap, doorFrame, edgesOf, panel, prism, walls, type Parts, type Rng } from "./kit";
import { facadeCatalog, type FacadeCtx, type FacadeSystem, type Slice } from "./facades";
import { lookRng, SWATCH, tint, type Palette } from "./look";
import { groundPlans, isPitched, massingOf, planAt, type Volume } from "./massing";
import { pitchedRoof, roofCatalog } from "./roofs";

export interface BuildingStyle {
  detail(p: Parts, b: BuildingData): void;
  massing(p: Parts, b: BuildingData): void;
}

export const styleCatalog = new Catalog<BuildingStyle>("building style");

export function registerStyle(name: string, style: BuildingStyle, tags: string[] = []): void {
  styleCatalog.register(name, style, { tags });
}

export function styleFor(name: string): BuildingStyle {
  return styleCatalog.get(name) ?? styleCatalog.require("default");
}

export const styleNames = () => styleCatalog.names();

/** Build one building into `parts` at the requested level of detail. */
export function buildBuilding(p: Parts, b: BuildingData, lod: "detail" | "massing"): void {
  styleFor(b.style)[lod](p, b);
}

/** Walls start this far below the pad so sloped ground never shows a gap. */
export const FOUNDATION = 2;

// ---- Recipes -------------------------------------------------------------------

export interface Recipe {
  facades: [string, number][];
  roofs: [string, number][];
  /** Roof on lower volumes whose tops are exposed (setbacks, podiums). */
  lowerRoof: string;
  palette(rng: Rng, b: BuildingData): Palette;
}

export interface Look {
  facadeName: string;
  facade: FacadeSystem;
  params: Record<string, number>;
  pal: Palette;
  roof: string;
  lowerRoof: string;
}

const recipes = new Map<string, Recipe>();
const looks = new WeakMap<BuildingData, Look>();

function weighted(rng: Rng, options: [string, number][]): string {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [n, w] of options) {
    r -= w;
    if (r < 0) return n;
  }
  return options[options.length - 1][0];
}

export const recipeFor = (style: string): Recipe => recipes.get(style) ?? recipes.get("default")!;

/** The building's facade, palette and roof. Deterministic; cached per building. */
export function lookOf(b: BuildingData): Look {
  const hit = looks.get(b);
  if (hit) return hit;
  const recipe = recipeFor(b.style);
  const rng = lookRng(b, 0x10c4);
  let facadeName = b.facade && facadeCatalog.has(b.facade) ? b.facade : weighted(rng, recipe.facades);
  let roof = weighted(rng, recipe.roofs);
  if (b.style === "suburban-house") {
    const pitched = isPitched(b) && massingOf(b).volumes.length === 1;
    roof = pitched ? b.roof : "slab";
    if (!b.facade) facadeName = pitched ? "house-pitched" : "house-render";
  }
  const facade = facadeCatalog.require(facadeName);
  const pal = recipe.palette(rng, b);
  facade.palette?.(pal, lookRng(b, 0x9a1e));
  const look: Look = {
    facadeName,
    facade,
    params: facade.params(lookRng(b, 0xfacade)),
    pal,
    roof,
    lowerRoof: recipe.lowerRoof,
  };
  looks.set(b, look);
  return look;
}

export function facadeCtx(b: BuildingData, look: Look = lookOf(b)): FacadeCtx {
  return {
    b,
    pal: look.pal,
    params: look.params,
    door: b.entrance,
    fh: b.floorHeight,
    y: (f) => b.baseY + f * b.floorHeight,
    rng: lookRng(b, 0xdec0),
  };
}

/** A volume as drawable slices: whole, or floor by floor when it tapers or twists. */
export function slicesOf(v: Volume): Slice[] {
  const whole = !v.taper && !v.twist;
  const out: Slice[] = [];
  const ranges = whole ? [[v.f0, v.f1]] : Array.from({ length: v.f1 - v.f0 }, (_, k) => [v.f0 + k, v.f0 + k + 1]);
  for (const [f0, f1] of ranges) {
    const poly = planAt(v, f0);
    out.push({ poly, edges: edgesOf(poly), f0, f1, role: v.role, top: f1 === v.f1 });
  }
  return out;
}

function drawRecipe(p: Parts, b: BuildingData) {
  const look = lookOf(b);
  const ctx = facadeCtx(b, look);
  const m = massingOf(b);
  for (const plan of groundPlans(b)) walls(p.matte, edgesOf(plan), b.baseY - FOUNDATION, b.baseY + 0.25, SWATCH.concrete[1], 0.05, b.entrance);
  const roofCtx = { b, pal: look.pal, rng: lookRng(b, 0x5007) };
  for (const v of m.volumes) {
    const slices = slicesOf(v);
    for (const s of slices) {
      look.facade.draw(p, s, ctx);
      // Floor plates show between the floors of tapering or twisting towers.
      if (slices.length > 1 && !s.top) cap(p.matte, s.poly, ctx.y(s.f1), look.pal.trim);
    }
    const top = slices[slices.length - 1];
    const covered = m.volumes.some((o) => o !== v && o.f0 === v.f1);
    let roofName = covered ? look.lowerRoof : look.roof;
    if (roofCatalog.require(roofName).quadOnly && top.poly.length !== 4) roofName = "parapet";
    roofCatalog.require(roofName).draw(p, top.poly, ctx.y(v.f1), roofCtx);
  }
}

function drawRecipeMassing(p: Parts, b: BuildingData) {
  const look = lookOf(b);
  const m = massingOf(b);
  const slot = look.facade.glassy ? p.glass : p.matte;
  const color = look.facade.glassy ? look.pal.glass : look.pal.wall;
  for (const v of m.volumes) {
    // Coarse steps for tapering and twisting towers.
    const step = v.taper || v.twist ? 4 : v.f1 - v.f0;
    for (let f = v.f0; f < v.f1; f += step) {
      const f1 = Math.min(v.f1, f + step);
      const poly = planAt(v, f);
      walls(slot, edgesOf(poly), f === 0 ? b.baseY - FOUNDATION : b.baseY + f * b.floorHeight, b.baseY + f1 * b.floorHeight, color);
      const y = b.baseY + f1 * b.floorHeight;
      if (f1 === v.f1 && (look.roof === "gable" || look.roof === "hip") && poly.length === 4) {
        pitchedRoof(p.matte, poly, y, look.roof === "hip", SWATCH.roofDark, look.pal.wall);
      } else cap(p.matte, poly, y, look.pal.roof);
    }
  }
}

export function registerRecipe(name: string, recipe: Recipe, tags: string[] = []): void {
  recipes.set(name, recipe);
  registerStyle(name, { detail: drawRecipe, massing: drawRecipeMassing }, tags);
}

// ---- Built-in recipes ---------------------------------------------------------

const towerPalette = (rng: Rng): Palette => {
  const trim = tint(rng, SWATCH.concrete);
  return { wall: trim, wall2: trim, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent: tint(rng, SWATCH.frame), roof: SWATCH.roof, trim };
};

registerRecipe("glass-tower", {
  facades: [["curtain-wall", 1], ["curtain-fins", 1], ["unitised-grid", 1], ["horizontal-louvres", 0.5], ["concrete-grid", 0.4], ["perforated-screen", 0.25]],
  roofs: [["crown", 3], ["plant", 1]],
  lowerRoof: "terrace",
  palette: towerPalette,
});

const officePalette = (rng: Rng): Palette => {
  const wall = tint(rng, [...SWATCH.white, ...SWATCH.concrete]);
  return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent: tint(rng, SWATCH.frame), roof: SWATCH.roof, trim: wall.clone().offsetHSL(0, 0, 0.04) };
};

registerRecipe("office", {
  facades: [
    ["ribbon", 1.5],
    ["curtain-wall", 0.5],
    ["unitised-grid", 0.8],
    ["concrete-grid", 1],
    ["horizontal-louvres", 0.8],
    ["perforated-screen", 0.6],
    ["terracotta-baguettes", 0.8],
    ["metal-mesh", 0.4],
  ],
  roofs: [["plant", 2], ["pavilion", 1], ["green", 1]],
  lowerRoof: "terrace",
  palette: officePalette,
});
registerRecipe("default", {
  facades: [["ribbon", 1]],
  roofs: [["plant", 1]],
  lowerRoof: "parapet",
  palette: officePalette,
});

registerRecipe("apartment", {
  facades: [
    ["punched-render", 1],
    ["deep-reveal-render", 1],
    ["fibre-cement", 1],
    ["loggias", 0.9],
    ["wraparound-balconies", 0.6],
    ["winter-gardens", 0.7],
    ["timber-cladding", 0.7],
  ],
  roofs: [["parapet", 2], ["green", 1.2], ["pavilion", 0.6], ["terrace", 0.6]],
  lowerRoof: "terrace",
  palette(rng) {
    const wall = tint(rng, [...SWATCH.white, ...SWATCH.warm, ...SWATCH.pastel]);
    const accent = rng.chance(0.5) ? tint(rng, SWATCH.timber) : tint(rng, SWATCH.white);
    return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent, roof: SWATCH.roof, trim: wall.clone().offsetHSL(0, 0, 0.06) };
  },
});

registerRecipe("brick-midrise", {
  facades: [["punched-brick", 1], ["flemish-brick", 1], ["recessed-brick", 1], ["loggias", 0.4]],
  roofs: [["parapet", 2], ["green", 1]],
  lowerRoof: "terrace",
  palette(rng) {
    const wall = tint(rng, SWATCH.brick);
    const accent = rng.chance(0.5) ? tint(rng, SWATCH.concrete) : tint(rng, SWATCH.timber);
    return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent, roof: SWATCH.roof, trim: tint(rng, SWATCH.concrete) };
  },
});

registerRecipe("suburban-house", {
  facades: [["house-render", 1]],
  roofs: [["slab", 1]],
  lowerRoof: "green",
  palette(rng, b) {
    const wall = isPitched(b) && rng.chance(0.4) ? tint(rng, SWATCH.charcoal) : tint(rng, SWATCH.white);
    const accent = rng.chance(0.55) ? tint(rng, SWATCH.timber) : tint(rng, SWATCH.charcoal);
    return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: SWATCH.frame[0], accent, roof: SWATCH.roof, trim: wall };
  },
});

registerRecipe("industrial", {
  facades: [["ribbed-metal", 1]],
  roofs: [["parapet", 1], ["sawtooth", 1]],
  lowerRoof: "parapet",
  palette(rng) {
    const wall = tint(rng, SWATCH.cladding);
    return { wall, wall2: wall, glass: SWATCH.glassLight, frame: SWATCH.charcoal[0], accent: tint(rng, SWATCH.accent), roof: SWATCH.roof, trim: wall.clone().offsetHSL(0, 0, -0.06) };
  },
});

// ---- Civic: colonnade, glazed ground floor, floating roof --------------------

registerStyle("civic", {
  detail(p, b) {
    const rng = lookRng(b, 0xc1c1);
    const fp = b.footprint.map((q) => [q[0], q[1]] as P2);
    const E = edgesOf(fp);
    const stone = tint(rng, SWATCH.white, 0.5);
    const glass = tint(rng, SWATCH.glass);
    const g = b.baseY + b.floorHeight * 1.4;
    const t = b.baseY + b.floors * b.floorHeight;
    walls(p.matte, E, b.baseY - FOUNDATION, b.baseY + 0.25, SWATCH.concrete[2], 0.05);
    const core = insetConvex(fp, 3) ?? fp;
    walls(p.glass, edgesOf(core), b.baseY, g, glass, 0, b.entrance);
    doorFrame(p.metal, edgesOf(core), b.entrance, SWATCH.frame[0]);
    cap(p.matte, core, b.baseY + 0.02, SWATCH.concrete[2]); // arcade floor
    for (const e of E) for (const s of bays(e.len, 6, 0.6)) box(p.matte, e, s - 0.35, s + 0.35, b.baseY, g, -0.7, 0, stone);
    walls(p.matte, E, g, t, stone);
    cap(p.matte, fp, g, stone, true); // arcade ceiling
    for (const e of E) for (const s of bays(e.len, 3, 1.5)) panel(p.glass, e, s - 0.45, s + 0.45, g + 0.8, t - 1.2, 0.03, glass);
    const pal: Palette = { wall: stone, wall2: stone, glass, frame: SWATCH.frame[0], accent: stone, roof: SWATCH.roof, trim: stone };
    roofCatalog.require("civic-float").draw(p, fp, t, { b, pal, rng });
  },
  massing(p, b) {
    prism(p.matte, b.footprint, b.baseY - FOUNDATION, b.baseY + b.floors * b.floorHeight, SWATCH.white[0], SWATCH.roof);
  },
});
