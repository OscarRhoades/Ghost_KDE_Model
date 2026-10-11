import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Catalog, describeCatalogs } from "../src/catalog/registry";
import { Prop } from "../src/engine/components";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { settingsFor, TIERS } from "../src/render/quality";

describe("Catalog", () => {
  const c = new Catalog<number>("test-things")
    .register("a", 1, { tags: ["red", "small"] })
    .register("b", 2, { tags: ["red"], weight: 3 })
    .register("c", 3, { tags: ["blue"] });

  it("filters by tags and finds by name", () => {
    expect(c.names("red")).toEqual(["a", "b"]);
    expect(c.names(["red", "small"])).toEqual(["a"]);
    expect(c.get("c")).toBe(3);
    expect(() => c.require("zzz")).toThrow(/known: a, b, c/);
  });

  it("picks by weight, deterministically for a given random source", () => {
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 400; i++) counts[c.pick(() => (i + 0.5) / 400, "red").name as "a" | "b"]++;
    expect(counts.a).toBe(100);
    expect(counts.b).toBe(300);
    expect(() => c.pick(Math.random, "green")).toThrow(/no test-things/);
  });

  it("is listed with the other catalogs", () => {
    expect(describeCatalogs()["test-things"]).toEqual(["a", "b", "c"]);
  });
});

describe("quality tiers", () => {
  it("scale detail up from low to high", () => {
    const [low, mid, high] = TIERS.map((t) => settingsFor(t));
    expect(low.propRadius).toBeLessThan(mid.propRadius);
    expect(mid.propRadius).toBeLessThan(high.propRadius);
    expect(low.postFx).toBe(false);
    expect(high.postFx).toBe(true);
  });
});

describe("city file catalog fields", () => {
  it("loads props and building choices and saves them unchanged", () => {
    const engine = new Engine();
    for (const p of coreDataPlugins()) engine.use(p);
    const city = parseCity(JSON.parse(readFileSync("public/cities/tiny.city.json", "utf8")));
    engine.load(city);
    const all = [...engine.world.query(Prop)].map((e) => engine.world.read(e, Prop));
    expect(all.filter((p) => !p.derived).length).toBe(4);
    expect(all.filter((p) => p.derived).length).toBeGreaterThan(0);
    expect(engine.save()).toEqual(city);
    expect(engine.save().buildings[0].shape).toBe("podium-tower");
  });
});
