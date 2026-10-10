import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CityFormatError, parseCity } from "../src/format/schema";

const tiny = () => JSON.parse(readFileSync("public/cities/tiny.city.json", "utf8"));

describe("parseCity", () => {
  it("accepts the hand-written example and fills defaults", () => {
    const city = parseCity(tiny());
    expect(city.meta.name).toBe("Tiny Crossroads");
    expect(city.extensions).toEqual({});
    expect(city.roads.edges).toHaveLength(4);
  });

  it("accepts a minimal file with only terrain", () => {
    const city = parseCity({
      format: "system-a/city",
      version: 1,
      meta: { name: "Empty" },
      terrain: { size: [100, 100], resolution: [2, 2], heights: { encoding: "flat", value: 0 } },
    });
    expect(city.buildings).toEqual([]);
  });

  it("reports dangling references, duplicate ids and bad sample counts with paths", () => {
    const raw = tiny();
    raw.roads.edges[0].b = "nowhere";
    raw.parcels[1].id = "corner-shop";
    raw.buildings[0].parcel = "missing";
    raw.terrain.heights.data.pop();
    try {
      parseCity(raw);
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CityFormatError);
      const issues = (e as CityFormatError).issues.join("\n");
      expect(issues).toMatch(/roads\.edges\.0\.b: unknown road node "nowhere"/);
      expect(issues).toMatch(/parcels\.1\.id: duplicate id "corner-shop"/);
      expect(issues).toMatch(/buildings\.0\.parcel: unknown parcel "missing"/);
      expect(issues).toMatch(/terrain\.heights\.data: expected 9 samples/);
    }
  });

  it("rejects other formats and versions", () => {
    expect(() => parseCity({ ...tiny(), version: 2 })).toThrow(CityFormatError);
    expect(() => parseCity({ ...tiny(), format: "other" })).toThrow(CityFormatError);
  });
});
