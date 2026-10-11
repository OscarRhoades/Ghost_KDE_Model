import { describe, expect, it } from "vitest";
import { atmosFor, atmosFromUrl, TIMES, WEATHERS } from "../src/render/atmosphere";
import { litMassing, litWindows } from "../src/buildings/buildingView";
import { MeshBuilder } from "../src/render/meshBuilder";
import { Color } from "three";

describe("atmosphere", () => {
  it("covers every time and weather with sane light", () => {
    for (const t of TIMES) {
      for (const w of WEATHERS) {
        const a = atmosFor(t, w);
        expect(a.night).toBeGreaterThanOrEqual(0);
        expect(a.night).toBeLessThanOrEqual(1);
        expect(a.sunIntensity).toBeGreaterThan(0);
        expect(a.hemiIntensity).toBeGreaterThan(0);
        expect(a.sunDir.length()).toBeCloseTo(1);
        expect(a.fogScale).toBeGreaterThan(0);
      }
    }
  });

  it("gets darker toward night and thicker in fog", () => {
    expect(atmosFor("day", "clear").night).toBe(0);
    expect(atmosFor("night", "clear").night).toBe(1);
    expect(atmosFor("night", "clear").sunIntensity).toBeLessThan(atmosFor("day", "clear").sunIntensity);
    expect(atmosFor("day", "fog").fogScale).toBeLessThan(atmosFor("day", "rain").fogScale);
    expect(atmosFor("day", "overcast").sunIntensity).toBeLessThan(atmosFor("day", "clear").sunIntensity);
  });

  it("reads settings from the URL and ignores nonsense", () => {
    expect(atmosFromUrl("?time=night&weather=rain")).toMatchObject({ time: "night", weather: "rain" });
    expect(atmosFromUrl("?time=noon&weather=lava")).toMatchObject({ time: "day", weather: "clear" });
  });
});

describe("lit windows", () => {
  const wall = (mb: MeshBuilder, w: number, h: number) => mb.quadFacing([0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0], [0, 0, 1], new Color(1, 1, 1));

  it("lights a share of panes and splits curtain walls into windows", () => {
    const glass = new MeshBuilder();
    wall(glass, 40, 60); // one big curtain-wall pane
    const lit = litWindows(glass);
    const cells = 22 * 18;
    expect(lit.triangleCount / 2).toBeGreaterThan(cells * 0.25);
    expect(lit.triangleCount / 2).toBeLessThan(cells * 0.7);
  });

  it("puts lit panes on tall massing walls only", () => {
    const tall = new MeshBuilder();
    wall(tall, 30, 40);
    const low = new MeshBuilder();
    wall(low, 30, 3);
    expect(litMassing([tall]).triangleCount).toBeGreaterThan(0);
    expect(litMassing([low]).triangleCount).toBe(0);
  });
});
