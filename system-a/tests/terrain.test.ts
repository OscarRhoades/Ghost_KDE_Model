import { describe, expect, it } from "vitest";
import { flattenPolygon, gradeSegment, Surface } from "../src/terrain/conform";
import { decodeHeights, encodeHeights, Heightfield } from "../src/terrain/heightfield";

const ramp = (n = 11, size = 100) => {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = i; // rises 1 per 10 m along x
  return new Heightfield(size, size, n, n, data);
};

describe("Heightfield", () => {
  it("interpolates bilinearly and clamps outside", () => {
    const hf = ramp();
    expect(hf.heightAt(0, 50)).toBeCloseTo(0);
    expect(hf.heightAt(55, 50)).toBeCloseTo(5.5);
    expect(hf.heightAt(-20, 50)).toBeCloseTo(0);
    expect(hf.heightAt(500, 50)).toBeCloseTo(10);
  });

  it("refines coarse grids without changing the surface", () => {
    const coarse = new Heightfield(100, 100, 2, 2, Float32Array.from([0, 10, 20, 30]));
    const fine = coarse.refined(8);
    expect(fine.nx).toBe(14);
    expect(fine.cellX).toBeLessThanOrEqual(8);
    for (const [x, z] of [[0, 0], [37, 81], [100, 100]]) expect(fine.heightAt(x, z)).toBeCloseTo(coarse.heightAt(x, z), 4);
    expect(ramp().refined(50)).toBeInstanceOf(Heightfield);
  });

  it("round-trips the uint16 encoding within quantization error", () => {
    const src = Float32Array.from({ length: 64 }, (_, k) => Math.sin(k) * 40 - 3);
    const decoded = decodeHeights(encodeHeights(src), src.length);
    const step = 80 / 65535;
    for (let k = 0; k < src.length; k++) expect(Math.abs(decoded[k] - src[k])).toBeLessThanOrEqual(step);
    expect(encodeHeights(new Float32Array(4).fill(2))).toEqual({ encoding: "flat", value: 2 });
  });
});

describe("conform", () => {
  it("flattens a pad and blends outside it", () => {
    const hf = ramp();
    const surface = new Uint8Array(hf.data.length);
    flattenPolygon(hf, [[30, 30], [60, 30], [60, 60], [30, 60]], 4, 20, surface);
    expect(hf.heightAt(45, 45)).toBeCloseTo(4);
    expect(surface[hf.index(4, 4)]).toBe(Surface.pad);
    // 10 m outside: partly blended, between pad and natural (8).
    const h = hf.sample(7, 4);
    expect(h).toBeGreaterThan(4);
    expect(h).toBeLessThan(7);
    // Beyond the blend radius: untouched.
    expect(hf.sample(9, 4)).toBe(9);
  });

  it("grades a road linearly between its ends without disturbing pads", () => {
    const hf = ramp();
    const surface = new Uint8Array(hf.data.length);
    flattenPolygon(hf, [[0, 70], [100, 70], [100, 100], [0, 100]], 3, 10, surface);
    gradeSegment(hf, [0, 1, 40], [100, 2, 40], 5, 15, surface);
    expect(hf.sample(0, 4)).toBeCloseTo(1);
    expect(hf.sample(5, 4)).toBeCloseTo(1.5);
    expect(hf.sample(10, 4)).toBeCloseTo(2);
    expect(surface[hf.index(5, 4)]).toBe(Surface.road);
    expect(hf.sample(5, 7)).toBe(3); // pad row stays flat
  });
});
