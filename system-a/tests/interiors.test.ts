import { describe, expect, it } from "vitest";
import { shellOf } from "../src/buildings/massing";
import { Building, type BuildingData } from "../src/engine/components";
import { coreDataPlugins } from "../src/engine/dataPlugins";
import { Engine } from "../src/engine/engine";
import { parseCity } from "../src/format/schema";
import { pointInPolygon } from "../src/geom/polygon";
import { createNavigator, type WalkPose } from "../src/interiors/nav";
import { planBuilding, stairCoords, stairHeight } from "../src/interiors/plan";
import { finishFor, furnitureCatalog } from "../src/interiors/furniture";
import { edgesOf, rngFor } from "../src/buildings/kit";
import { openingsAt } from "../src/buildings/styles";
import { generateDemo } from "../generators/demo";

function demoWorld() {
  const engine = new Engine();
  for (const p of coreDataPlugins()) engine.use(p);
  engine.load(parseCity(generateDemo({ seed: 5, size: 1600, cell: 16 })));
  return engine.world;
}

const world = demoWorld();
const buildings = [...world.query(Building)].map((e) => world.read(e, Building));
const byStyle = (style: string, minFloors = 1) => buildings.find((b) => b.style === style && b.floors >= minFloors);

describe("front doors", () => {
  it("every building gets one, on its ground-floor outer wall", () => {
    for (const b of buildings) {
      expect(b.entrance, b.style).toBeDefined();
      const shell = shellOf(b, 0);
      // The door center lies on the outer wall: just inside or just outside the shell.
      const e = b.entrance!;
      const nudge = (s: number) => pointInPolygon(e.x - e.tz * s, e.z + e.tx * s, shell);
      expect(nudge(0.3) !== nudge(-0.3)).toBe(true);
    }
  });
});

describe("floor plans", () => {
  it("covers every style with a shell and walls on each walkable floor", () => {
    for (const style of ["suburban-house", "apartment", "brick-midrise", "office", "glass-tower", "industrial", "civic"]) {
      const b = byStyle(style);
      if (!b) continue;
      const plan = planBuilding(b);
      expect(plan.floors.length).toBeGreaterThan(0);
      for (const f of plan.floors) {
        expect(f.shell.length).toBeGreaterThanOrEqual(3);
        expect(f.ceiling).toBeGreaterThan(f.y + 2);
        for (const w of f.walls) expect([w.a[0], w.a[1], w.b[0], w.b[1], w.y0, w.y1].every(Number.isFinite)).toBe(true);
        for (const it of f.furniture) for (const [x, z] of it.poly) expect(pointInPolygon(x, z, f.shell)).toBe(true);
      }
    }
  });

  it("puts the stair inside the shell of every floor it serves", () => {
    for (const b of buildings.filter((x) => x.floors >= 2).slice(0, 200)) {
      const plan = planBuilding(b);
      if (!plan.stair) continue;
      const s = plan.stair;
      const pts = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.9]].map(([r, w]) => [s.o[0] + s.run[0] * r + s.across[0] * w, s.o[1] + s.run[1] * r + s.across[1] * w]);
      for (const f of plan.floors) for (const [x, z] of pts) expect(pointInPolygon(x, z, f.shell), `${b.style} floor ${f.index}`).toBe(true);
    }
  });

  it("is deterministic", () => {
    const b = byStyle("apartment", 3)!;
    expect(planBuilding(b)).toEqual(planBuilding(b));
  });
});

describe("stairs", () => {
  it("climb continuously from one floor to the next", () => {
    const b = byStyle("apartment", 3) ?? byStyle("office", 3)!;
    const plan = planBuilding(b);
    let y = plan.floors[0].y;
    let floor = 0;
    // Up lane A to the landing, then back along lane B.
    const heights: number[] = [];
    for (let i = 0; i <= 20; i++) {
      ({ y, floor } = stairHeight(plan, { r: i / 20, w: 0.25 }, y));
      heights.push(y);
    }
    for (let i = 20; i >= 0; i--) {
      ({ y, floor } = stairHeight(plan, { r: i / 20, w: 0.75 }, y));
      heights.push(y);
    }
    // Never a jump bigger than one step.
    for (let k = 1; k < heights.length; k++) expect(heights[k] - heights[k - 1]).toBeLessThan(plan.floorHeight / 20 + 1e-6);
    expect(floor).toBe(1);
    expect(y).toBeCloseTo(plan.floors[1].y, 1);
  });
});

describe("navigator", () => {
  const nav = createNavigator(world);

  function walkTo(pose: WalkPose, x: number, z: number, steps = 200) {
    for (let k = 0; k < steps; k++) {
      const dx = x - pose.x;
      const dz = z - pose.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const s = Math.min(0.15, d);
      nav.move(pose, (dx / d) * s, (dz / d) * s, 0.35);
    }
  }

  function outsideDoor(b: BuildingData, dist: number): WalkPose {
    const e = b.entrance!;
    // Pick the side of the door that is outside the building.
    let nx = -e.tz;
    let nz = e.tx;
    if (pointInPolygon(e.x + nx, e.z + nz, shellOf(b, 0))) {
      nx = -nx;
      nz = -nz;
    }
    const pose: WalkPose = { x: e.x + nx * dist, z: e.z + nz * dist, y: 0, floor: 0, building: null };
    nav.settle(pose);
    return pose;
  }

  it("lets you walk in through the front door", () => {
    const b = byStyle("office") ?? byStyle("apartment")!;
    const pose = outsideDoor(b, 3);
    expect(pose.building).toBeNull();
    const inward = outsideDoor(b, -3);
    walkTo(pose, inward.x, inward.z);
    expect(pose.building).toBe(b);
    expect(pose.y).toBeCloseTo(b.baseY + 0.05, 1);
  });

  it("does not let you walk through a wall", () => {
    const b = byStyle("office") ?? byStyle("apartment")!;
    const shell = shellOf(b, 0);
    // Aim at the middle of the building from a corner, well away from the door.
    const [cx, cz] = [shell.reduce((s, p) => s + p[0], 0) / shell.length, shell.reduce((s, p) => s + p[1], 0) / shell.length];
    const corner = shell.find((p) => Math.hypot(p[0] - b.entrance!.x, p[1] - b.entrance!.z) > 8)!;
    const ox = corner[0] + (corner[0] - cx) * 0.3;
    const oz = corner[1] + (corner[1] - cz) * 0.3;
    const pose: WalkPose = { x: ox, z: oz, y: 0, floor: 0, building: null };
    nav.settle(pose);
    if (pose.building) return; // corner landed inside a neighbor; nothing to test here
    walkTo(pose, cx, cz);
    expect(pose.building).toBeNull();
  });
});

describe("interiors round two", () => {
  const plans = (style: string, n = 12) => buildings.filter((b) => b.style === style && b.floors >= 2).slice(0, n).map((b) => ({ b, plan: planBuilding(b) }));

  it("has a furniture catalog of real pieces", () => {
    expect(furnitureCatalog.size).toBeGreaterThanOrEqual(35);
    const fin = finishFor(rngFor(1));
    for (const name of furnitureCatalog.names()) expect(furnitureCatalog.require(name).parts(fin).length, name).toBeGreaterThan(0);
  });

  it("gives homes kitchens, bathrooms and bedrooms with beds", () => {
    const kinds = new Set<string>();
    let beds = 0;
    for (const { plan } of [...plans("apartment"), ...plans("suburban-house")]) {
      for (const f of plan.floors) for (const r of f.rooms) kinds.add(r.kind);
      beds += plan.floors[1].furniture.filter((it) => it.color === 0xf1eee8).length;
    }
    for (const k of ["living", "bedroom", "bathroom"]) expect(kinds.has(k), k).toBe(true);
    expect(beds).toBeGreaterThan(10);
  });

  it("varies office floors and furnishes ground floors by their use", () => {
    const kinds = new Set<string>();
    for (const { plan } of [...plans("office", 30), ...plans("glass-tower", 10)]) for (const f of plan.floors.slice(0, 4)) for (const r of f.rooms) kinds.add(r.kind);
    expect(kinds.has("meeting") || kinds.has("breakout")).toBe(true);
    const ground = new Set<string>();
    for (const { plan } of plans("brick-midrise", 30)) for (const r of plan.floors[0].rooms) ground.add(r.kind);
    expect([...ground].some((k) => ["cafe", "shop", "restaurant", "bank"].includes(k))).toBe(true);
  });

  it("keeps furniture off the stairs and gives rooms floor finishes", () => {
    for (const { plan } of plans("office", 6)) {
      if (!plan.stair) continue;
      const f = plan.floors[1];
      const s = plan.stair;
      const inStair = (x: number, z: number) => {
        const c = stairCoords(s, x, z);
        return c.r > 0.05 && c.r < 0.95 && c.w > 0.05 && c.w < 0.95;
      };
      for (const it of f.furniture) expect(it.poly.every(([x, z]) => inStair(x, z))).toBe(false);
      expect(f.rooms.some((r) => r.floor !== undefined)).toBe(true);
    }
  });

  it("glazes interiors where the facade has windows", () => {
    let matched = 0;
    for (const b of buildings.filter((b) => ["apartment", "office", "brick-midrise"].includes(b.style)).slice(0, 20)) {
      const at = openingsAt(b, 1);
      for (const e of edgesOf(shellOf(b, 1))) {
        const o = at(e);
        if (!o) continue;
        matched++;
        for (const w of o) {
          expect(w.s0).toBeGreaterThanOrEqual(-0.01);
          expect(w.s1).toBeLessThanOrEqual(e.len + 0.01);
        }
      }
    }
    expect(matched).toBeGreaterThan(40);
  });
});
