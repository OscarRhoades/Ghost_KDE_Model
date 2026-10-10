import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFootprintGrid, findSpawn, WALKER_RADIUS } from "../src/camera/spawn";
import { ViewController } from "../src/camera/viewMode";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { FootprintGrid } from "../src/physics/collision";

const square = (x: number, z: number, s: number) => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]] as [number, number][];

describe("FootprintGrid", () => {
  const grid = new FootprintGrid(16);
  grid.add(square(10, 10, 20)); // spans several cells

  it("leaves free circles alone", () => {
    expect(grid.resolve(5, 5, 0.5)).toEqual([5, 5]);
    expect(grid.blocked(5, 5, 0.5)).toBe(false);
  });

  it("pushes a circle overlapping a wall back out to radius distance", () => {
    const [x, z] = grid.resolve(9.8, 20, 0.5);
    expect(x).toBeCloseTo(9.5);
    expect(z).toBeCloseTo(20);
  });

  it("ejects a circle that ended up inside through the nearest wall", () => {
    const [x, z] = grid.resolve(28, 15, 0.5);
    expect(x).toBeCloseTo(30.5);
    expect(z).toBeCloseTo(15);
    expect(grid.blocked(x, z, 0.45)).toBe(false);
  });
});

describe("findSpawn", () => {
  const engine = new Engine();
  for (const p of coreDataPlugins()) engine.use(p);
  engine.load(parseCity(JSON.parse(readFileSync("public/cities/tiny.city.json", "utf8"))));
  const grid = buildFootprintGrid(engine.world);

  it("snaps to the sidewalk of the nearest street, facing along it", () => {
    // Near the north-south avenue (x = 100, width 14, sidewalk 4), west side.
    const s = findSpawn(engine.world, grid, 80, 40);
    expect(s.x).toBeCloseTo(100 - 7 - 2, 0);
    expect(Math.abs(Math.sin(s.yaw))).toBeLessThan(0.01); // facing north or south
    expect(grid.blocked(s.x, s.z, WALKER_RADIUS * 0.9)).toBe(false);
  });

  it("never spawns inside a building", () => {
    // Middle of the glass tower, with no road in range.
    const s = findSpawn(engine.world, grid, 45, 45, 1);
    expect(grid.blocked(s.x, s.z, WALKER_RADIUS * 0.9)).toBe(false);
  });
});

describe("ViewController", () => {
  it("runs the enter handler and notifies listeners, ignoring unknown modes", () => {
    const v = new ViewController();
    const log: string[] = [];
    v.register("walk", (at) => log.push(`enter ${at?.x}`));
    v.onChange((m) => log.push(`now ${m}`));
    v.switchTo("iso"); // no iso handler registered
    v.switchTo("walk", { x: 3, z: 4 });
    expect(v.mode).toBe("walk");
    expect(log).toEqual(["enter 3", "now walk"]);
  });
});
