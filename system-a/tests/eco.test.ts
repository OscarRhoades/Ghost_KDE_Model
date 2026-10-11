import { describe, expect, it } from "vitest";
import { buildBuilding } from "../src/buildings";
import { newParts } from "../src/buildings/kit";
import { lookOf } from "../src/buildings/styles";
import { Building, Prop, RoadEdge, TerrainR } from "../src/engine/components";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { planBuilding } from "../src/interiors/plan";
import { generateEco } from "../generators/eco";

const raw = generateEco({ seed: 3, size: 1200, cell: 8 });
const city = parseCity(raw);
const engine = new Engine();
for (const p of coreDataPlugins()) engine.use(p);
engine.load(city);
const w = engine.world;
const buildings = [...w.query(Building)].map((e) => w.read(e, Building));

describe("eco district", () => {
  it("is a valid city that round-trips", () => {
    expect(engine.save()).toEqual(city);
  });

  it("has a tram line, bridged canals and no parked cars", () => {
    const roads = [...w.query(RoadEdge)].map((e) => w.read(e, RoadEdge));
    expect(roads.some((r) => r.tram)).toBe(true);
    expect(roads.some((r) => r.bridge)).toBe(true);
    const props = [...w.query(Prop)].map((e) => w.read(e, Prop));
    expect(props.some((p) => p.kind.startsWith("car-"))).toBe(false);
    for (const k of ["tram", "tram-stop", "catenary-pole", "wind-turbine", "veg-bed", "solar-canopy"]) expect(props.some((p) => p.kind === k), k).toBe(true);
  });

  it("keeps the canals under water after the terrain is conformed", () => {
    const { hf, waterLevel } = w.resource(TerrainR);
    let wet = 0;
    for (let k = 0; k < hf.data.length; k++) if (hf.data[k] < (waterLevel ?? 0) - 1) wet++;
    expect(wet).toBeGreaterThan(500);
  });

  it("builds every eco style with its own looks, roofs and interiors", () => {
    for (const style of ["timber-tower", "eco-midrise", "eco-townhouse"]) {
      const some = buildings.filter((b) => b.style === style).slice(0, 8);
      expect(some.length, style).toBeGreaterThan(0);
      const roofs = new Set(some.map((b) => lookOf(b).roof));
      for (const b of some) {
        const parts = newParts();
        buildBuilding(parts, b, "detail");
        expect(parts.matte.triangleCount).toBeGreaterThan(50);
        const plan = planBuilding(b);
        expect(plan.floors[plan.floors.length - 1].rooms.length).toBeGreaterThan(0);
      }
      expect([...roofs].some((r) => r.startsWith("solar") || r === "green"), style).toBe(true);
    }
  });
});
