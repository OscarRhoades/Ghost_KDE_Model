import { describe, expect, it } from "vitest";
import { edgesOf } from "../src/buildings/kit";
import { groundPlans, massingOf, planAt, quadOf, shapeCatalog, shellOf } from "../src/buildings/massing";
import { lookOf } from "../src/buildings/index";
import type { BuildingData } from "../src/engine/components";
import { area, pointInPolygon, signedArea } from "../src/geom/polygon";
import { planBuilding } from "../src/interiors/plan";

const rect = (w: number, d: number) => [[0, 0], [w, 0], [w, d], [0, d]].map(([x, z]) => [x + 100, z + 100] as const);

function building(style: string, floors: number, shape?: string, w = 44, d = 36, seed = 77): BuildingData {
  return { footprint: rect(w, d), floors, floorHeight: 3.4, roof: "flat", style, seed, baseY: 5, explicit: {}, shape };
}

describe("massing shapes", () => {
  for (const name of shapeCatalog.names()) {
    it(`${name} builds sensible volumes`, () => {
      const style = name.startsWith("house") ? "suburban-house" : "office";
      const b = building(style, name.startsWith("house") ? 2 : 30, name, name.startsWith("house") ? 14 : 44, name.startsWith("house") ? 10 : 36);
      const m = massingOf(b);
      expect(m.shape).toBe(name);
      expect(m.volumes.length).toBeGreaterThan(0);
      for (const v of m.volumes) {
        expect(v.f1).toBeGreaterThan(v.f0);
        for (let f = v.f0; f < v.f1; f += 5) {
          const poly = planAt(v, f);
          expect(area(poly)).toBeGreaterThan(10);
          expect(poly.flat().every(Number.isFinite)).toBe(true);
        }
      }
      // Every floor has an outline to walk inside.
      for (let f = 0; f < b.floors; f++) expect(area(shellOf(b, f))).toBeGreaterThan(10);
      expect(groundPlans(b).length).toBeGreaterThan(0);
    });
  }

  it("falls back when a requested shape does not fit", () => {
    expect(massingOf(building("office", 3, "twisted")).shape).not.toBe("twisted");
  });

  it("outward normals point out of concave plans", () => {
    const q = quadOf(rect(30, 24))!;
    const l = shapeCatalog.require("l-plan").build(building("office", 4), q, { next: () => 0.5, range: (a, b) => (a + b) / 2, pick: (x) => x[0], chance: () => true })[0].poly;
    expect(l.length).toBe(6);
    for (const e of edgesOf(l)) {
      const mx = (e.a[0] + e.b[0]) / 2 + e.nx * 0.2;
      const mz = (e.a[1] + e.b[1]) / 2 + e.nz * 0.2;
      expect(pointInPolygon(mx, mz, l)).toBe(false);
    }
    expect(signedArea(l)).not.toBe(0);
  });

  it("gives towers varied shapes across seeds", () => {
    const shapes = new Set(Array.from({ length: 40 }, (_, k) => massingOf(building("glass-tower", 32, undefined, 44, 36, k * 101 + 3)).shape));
    expect(shapes.size).toBeGreaterThanOrEqual(4);
  });

  it("keeps stairs inside every floor of shaped buildings", () => {
    for (const shape of ["setback", "podium-tower", "stepped", "tapered", "twisted", "l-plan", "u-plan", "courtyard", "terrace-steps", "overhang"]) {
      const b = building(shape === "l-plan" || shape === "u-plan" || shape === "courtyard" || shape === "terrace-steps" ? "apartment" : "office", 26, shape);
      const plan = planBuilding(b);
      if (!plan.stair) continue;
      const s = plan.stair;
      const mid: [number, number] = [s.o[0] + s.run[0] / 2 + s.across[0] / 2, s.o[1] + s.run[1] / 2 + s.across[1] / 2];
      for (const f of plan.floors) expect(pointInPolygon(mid[0], mid[1], f.shell), `${shape} floor ${f.index}`).toBe(true);
    }
  });

  it("gives every building its own palette", () => {
    const walls = new Set(Array.from({ length: 30 }, (_, k) => lookOf(building("apartment", 5, undefined, 30, 20, k + 1)).pal.wall.getHexString()));
    expect(walls.size).toBeGreaterThan(25);
  });
});

import { facadeCatalog } from "../src/buildings/facades";
import { newParts } from "../src/buildings/kit";
import { buildBuilding } from "../src/buildings/index";

describe("facade systems", () => {
  for (const name of facadeCatalog.names()) {
    it(`${name} draws finite geometry with openings that fit their edges`, () => {
      const style = name.startsWith("house") ? "suburban-house" : name.includes("brick") ? "brick-midrise" : "apartment";
      const b = building(style, name.startsWith("house") ? 2 : 6, "box", name.startsWith("house") ? 14 : 30, name.startsWith("house") ? 10 : 20);
      b.facade = name;
      b.entrance = { x: 115, z: 100, tx: 1, tz: 0, width: 1.6, height: 2.4, y: 5 };
      const p = newParts();
      buildBuilding(p, b, "detail");
      let tris = 0;
      for (const mb of Object.values(p)) {
        tris += mb.triangleCount;
        const pos = mb.build().getAttribute("position");
        for (let k = 0; k < pos.count; k++) expect(Number.isFinite(pos.getY(k))).toBe(true);
      }
      expect(tris).toBeGreaterThan(50);
      const look = lookOf(b);
      expect(look.facadeName).toBe(name);
    });
  }
});

import { groundCatalog, groundUseOf } from "../src/buildings/ground";

describe("ground-floor uses", () => {
  for (const use of groundCatalog.names()) {
    it(`${use} draws a ground floor`, () => {
      const b = building("brick-midrise", 4, "box", 30, 18);
      b.ground = use;
      b.entrance = { x: 115, z: 100, tx: 1, tz: 0, width: 1.6, height: 2.4, y: 5 };
      b.streetSides = [[115, 100]];
      expect(groundUseOf(b)).toBe(use);
      const p = newParts();
      buildBuilding(p, b, "detail");
      expect(p.matte.triangleCount + p.glass.triangleCount).toBeGreaterThan(100);
    });
  }

  it("gives most brick blocks a shop and houses none", () => {
    const uses = Array.from({ length: 50 }, (_, k) => groundUseOf(building("brick-midrise", 4, undefined, 30, 18, k + 9)));
    expect(uses.filter((u) => u !== "none").length).toBeGreaterThan(30);
    expect(new Set(uses).size).toBeGreaterThan(4);
    expect(groundUseOf(building("suburban-house", 2, undefined, 12, 9))).toBe("none");
  });
});

import { LANDMARKS } from "../src/buildings/index";

describe("landmarks", () => {
  for (const style of LANDMARKS) {
    it(`${style} builds detail, massing and an interior`, () => {
      const b = building(style, style === "supertall" ? 70 : 4, undefined, 120, 110);
      b.entrance = { x: 160, z: 100, tx: 1, tz: 0, width: 2.4, height: 2.8, y: 5 };
      for (const lod of ["detail", "massing"] as const) {
        const p = newParts();
        buildBuilding(p, b, lod);
        let tris = 0;
        for (const mb of Object.values(p)) {
          tris += mb.triangleCount;
          const pos = mb.build().getAttribute("position");
          for (let k = 0; k < pos.count; k++) expect(Number.isFinite(pos.getY(k))).toBe(true);
        }
        expect(tris).toBeGreaterThan(lod === "detail" ? 40 : 6);
      }
      const plan = planBuilding(b);
      expect(plan.floors.length).toBeGreaterThan(0);
      for (const f of plan.floors) for (const it of f.furniture) for (const [x, z] of it.poly) expect(pointInPolygon(x, z, f.shell)).toBe(true);
    });
  }
});
