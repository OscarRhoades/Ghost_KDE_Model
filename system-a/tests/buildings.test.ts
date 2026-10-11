import { describe, expect, it } from "vitest";
import { edgesOf, newParts, type Parts } from "../src/buildings/kit";
import { buildBuilding, styleFor, styleNames } from "../src/buildings/index";
import type { BuildingData } from "../src/engine/components";

const rect = (w: number, d: number) => [[0, 0], [w, 0], [w, d], [0, d]] as const;

function building(style: string, floors: number, roof: BuildingData["roof"] = "flat", fp = rect(30, 22)): BuildingData {
  return {
    footprint: fp.map((p) => [p[0], p[1]] as const),
    floors,
    floorHeight: 3.4,
    roof,
    style,
    seed: 12345,
    baseY: 10,
    explicit: {},
  };
}

function stats(p: Parts) {
  let tris = 0;
  let finite = true;
  let minY = Infinity;
  for (const mb of Object.values(p)) {
    tris += mb.triangleCount;
    const pos = mb.build().getAttribute("position");
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (![pos.getX(k), y, pos.getZ(k)].every(Number.isFinite)) finite = false;
      minY = Math.min(minY, y);
    }
  }
  return { tris, finite, minY };
}

describe("building styles", () => {
  const cases: [string, number, BuildingData["roof"]][] = [
    ["glass-tower", 40, "flat"],
    ["glass-tower", 12, "flat"],
    ["office", 9, "flat"],
    ["apartment", 6, "flat"],
    ["brick-midrise", 5, "flat"],
    ["suburban-house", 2, "flat"],
    ["suburban-house", 1, "flat"],
    ["suburban-house", 2, "gable"],
    ["suburban-house", 2, "hip"],
    ["industrial", 2, "flat"],
    ["civic", 4, "hip"],
  ];

  it.each(cases)("%s (%i floors, %s roof) builds finite geometry at both levels", (style, floors, roof) => {
    const fp = style === "suburban-house" ? rect(12, 9) : rect(30, 22);
    for (const lod of ["detail", "massing"] as const) {
      const p = newParts();
      buildBuilding(p, building(style, floors, roof, fp), lod);
      const s = stats(p);
      expect(s.tris).toBeGreaterThan(lod === "detail" ? 20 : 4);
      expect(s.finite).toBe(true);
      // Foundations reach below the pad so slopes never show a gap.
      expect(s.minY).toBeLessThan(10);
    }
  });

  it("puts far more into street-level detail than into massing", () => {
    const d = newParts();
    const m = newParts();
    buildBuilding(d, building("apartment", 6), "detail");
    buildBuilding(m, building("apartment", 6), "massing");
    expect(stats(d).tris).toBeGreaterThan(stats(m).tris * 10);
  });

  it("is deterministic per seed", () => {
    const a = newParts();
    const b = newParts();
    buildBuilding(a, building("apartment", 6), "detail");
    buildBuilding(b, building("apartment", 6), "detail");
    expect(Array.from(a.matte.build().getAttribute("position").array)).toEqual(
      Array.from(b.matte.build().getAttribute("position").array),
    );
  });

  it("falls back to the default style for unknown keys", () => {
    expect(styleFor("no-such-style")).toBe(styleFor("default"));
    expect(styleNames()).toEqual(expect.arrayContaining(["glass-tower", "office", "apartment", "suburban-house", "civic", "industrial"]));
  });
});

describe("edgesOf", () => {
  it("gives outward normals for either winding", () => {
    for (const poly of [rect(10, 5), [...rect(10, 5)].reverse()]) {
      for (const e of edgesOf(poly.map((p) => [p[0], p[1]] as const))) {
        const mx = (e.a[0] + e.b[0]) / 2 - 5;
        const mz = (e.a[1] + e.b[1]) / 2 - 2.5;
        expect(mx * e.nx + mz * e.nz).toBeGreaterThan(0);
      }
    }
  });
});
