import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Building, Parcel, RoadEdge, RoadNode, TerrainR } from "../src/engine/components";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { generateDemo } from "../generators/demo";

const tinyRaw = () => JSON.parse(readFileSync("public/cities/tiny.city.json", "utf8"));

function headless() {
  const engine = new Engine();
  for (const p of coreDataPlugins()) engine.use(p);
  return engine;
}

describe("Engine", () => {
  it("loads sections into entities and resolves elevations", () => {
    const engine = headless();
    engine.load(parseCity(tinyRaw()));
    const w = engine.world;
    expect(w.count(RoadNode)).toBe(5);
    expect(w.count(RoadEdge)).toBe(4);
    expect(w.count(Parcel)).toBe(2);
    expect(w.count(Building)).toBe(3);

    const nodes = [...w.query(RoadNode)].map((e) => w.read(e, RoadNode));
    expect(nodes.find((n) => n.x === 190)!.y).toBe(7); // fixed in the file

    const { hf, surface } = w.resource(TerrainR);
    const shop = [...w.query(Parcel)].map((e) => w.read(e, Parcel)).find((p) => p.zone === "commercial")!;
    // The pad is flat at the resolved elevation, and the tower stands on it.
    expect(hf.heightAt(40, 40)).toBeCloseTo(shop.elevation, 4);
    expect(hf.heightAt(80, 80)).toBeCloseTo(shop.elevation, 4);
    const tower = [...w.query(Building)].map((e) => w.read(e, Building)).find((b) => b.floors === 12)!;
    expect(tower.baseY).toBe(shop.elevation);
    expect(surface.some((s) => s === 3)).toBe(true); // roads marked
  });

  it("saves back exactly what it loaded", () => {
    const engine = headless();
    const city = parseCity(tinyRaw());
    engine.load(city);
    expect(engine.save()).toEqual(city);
    // And a second load of the saved file is stable.
    engine.load(parseCity(JSON.parse(JSON.stringify(engine.save()))));
    expect(engine.save()).toEqual(city);
  });

  it("rejects installing a plugin twice", () => {
    const engine = headless();
    expect(() => engine.use(coreDataPlugins()[0])).toThrow(/already installed/);
  });
});

describe("demo generator", () => {
  const opts = { seed: 3, size: 1600, cell: 16 };

  it("is deterministic per seed and always valid", () => {
    const a = generateDemo(opts);
    expect(generateDemo(opts)).toEqual(a);
    expect(generateDemo({ ...opts, seed: 4 })).not.toEqual(a);
    const city = parseCity(a);
    expect(city.buildings.length).toBeGreaterThan(50);
  });

  it("produces a city that loads and round-trips", () => {
    const engine = headless();
    const city = parseCity(generateDemo(opts));
    engine.load(city);
    expect(engine.world.count(Building)).toBe(city.buildings.length);
    expect(engine.save()).toEqual(city);
  });
});
