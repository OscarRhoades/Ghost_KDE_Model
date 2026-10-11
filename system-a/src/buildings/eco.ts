/**
 * Eco district styles: mass-timber towers, timber and green-walled mid-rise
 * blocks, and terraced townhouses with solar roofs. Built from the shared
 * catalogs (shapes, facades, roofs) plus the green wall and solar roofs.
 */
import { registerPlanKind } from "./kinds";
import { styleShopChance } from "./ground";
import { SWATCH, tint } from "./look";
import { registerStyleShapes } from "./massing";
import { registerRecipe } from "./styles";
import type { Rng } from "./kit";

const timberPalette = (rng: Rng) => {
  const wall = tint(rng, SWATCH.timber, 0.6);
  const accent = rng.chance(0.5) ? tint(rng, SWATCH.white) : tint(rng, SWATCH.charcoal);
  return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent, roof: SWATCH.roof, trim: accent.clone() };
};

const lightPalette = (rng: Rng) => {
  const wall = tint(rng, [...SWATCH.white, ...SWATCH.warm, ...SWATCH.pastel]);
  const accent = tint(rng, SWATCH.timber);
  return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent, roof: SWATCH.roof, trim: wall.clone().offsetHSL(0, 0, 0.05) };
};

registerRecipe("timber-tower", {
  facades: [["timber-cladding", 1.4], ["winter-gardens", 1], ["loggias", 0.8], ["green-wall", 0.8], ["wraparound-balconies", 0.6]],
  roofs: [["solar-green", 2], ["green", 1], ["terrace", 0.6]],
  lowerRoof: "terrace",
  palette: (rng) => (rng.chance(0.65) ? timberPalette(rng) : lightPalette(rng)),
});
registerStyleShapes("timber-tower", [["setback", 1.5], ["podium-tower", 1.2], ["stepped", 1], ["terrace-steps", 0.8], ["chamfer", 0.6], ["box", 0.5]]);
registerPlanKind("timber-tower", "apartments");
styleShopChance.set("timber-tower", 0.45);

registerRecipe("eco-midrise", {
  facades: [["green-wall", 1.2], ["timber-cladding", 1], ["winter-gardens", 0.8], ["loggias", 0.8], ["fibre-cement", 0.6], ["wraparound-balconies", 0.5]],
  roofs: [["solar-green", 1.5], ["solar", 1], ["green", 1], ["terrace", 0.5]],
  lowerRoof: "terrace",
  palette: (rng) => (rng.chance(0.4) ? timberPalette(rng) : lightPalette(rng)),
});
registerStyleShapes("eco-midrise", [["box", 1.5], ["l-plan", 1], ["notched", 0.8], ["terrace-steps", 1.2], ["u-plan", 0.5]]);
registerPlanKind("eco-midrise", "apartments");
styleShopChance.set("eco-midrise", 0.6);

registerRecipe("eco-townhouse", {
  facades: [["timber-cladding", 1.2], ["fibre-cement", 1], ["green-wall", 0.6], ["punched-render", 0.6]],
  roofs: [["solar-pitch", 2], ["solar", 1], ["solar-green", 0.6], ["sawtooth", 0.3]],
  lowerRoof: "green",
  palette: (rng) => (rng.chance(0.5) ? timberPalette(rng) : lightPalette(rng)),
});
registerStyleShapes("eco-townhouse", [["box", 1]]);
registerPlanKind("eco-townhouse", "house");

export const ECO_STYLES = ["timber-tower", "eco-midrise", "eco-townhouse"] as const;
