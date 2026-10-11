import { describe, expect, it } from "vitest";
import { Color } from "three";
import { MeshBuilder } from "../src/render/meshBuilder";
import { column, icosphere, puff } from "../src/render/organic";

const white = new Color(1, 1, 1);

describe("mesh builder for the painted look", () => {
  it("records quad edge coordinates in meters and flat normals", () => {
    const mb = new MeshBuilder();
    mb.quadFacing([0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0], [0, 0, 1], white);
    const g = mb.build();
    const edge = g.getAttribute("edge");
    const normal = g.getAttribute("normal");
    expect(edge.count).toBe(6);
    expect([edge.getZ(0), edge.getW(0)]).toEqual([4, 3]);
    for (let k = 0; k < 6; k++) expect(normal.getZ(k)).toBeCloseTo(1);
  });

  it("keeps a sane normal on quads with two corners in one place (cones)", () => {
    const mb = new MeshBuilder();
    mb.quadFacing([0, 0, 0], [1, 0, 0], [0.5, 2, 0], [0.5, 2, 0], [0, 0, -1], white);
    const n = mb.build().getAttribute("normal");
    expect(n.getZ(0)).toBeCloseTo(-1);
  });

  it("grades colors by height", () => {
    const mb = new MeshBuilder();
    mb.quadFacing([0, 0, 0], [1, 0, 0], [1, 10, 0], [0, 10, 0], [0, 0, 1], white);
    mb.gradeVertical(0, 0, 10, 0.5, 1);
    const { pos, col } = mb.raw();
    for (let v = 0; v < pos.length / 3; v++) expect(col[v * 3]).toBeCloseTo(pos[v * 3 + 1] === 0 ? 0.5 : 1);
  });
});

describe("organic shapes", () => {
  it("builds smooth puffs that are lighter on top and face outward", () => {
    expect(icosphere(1).f.length).toBe(80);
    const mb = new MeshBuilder();
    puff(mb, [0, 5, 0], [2, 2, 2], { bottom: new Color(0, 0.2, 0), top: new Color(0.5, 1, 0.3) });
    const { pos, col, nrm } = mb.raw();
    let top = 0, bottom = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      const out = (pos[v * 3] * nrm[v * 3] + (pos[v * 3 + 1] - 5) * nrm[v * 3 + 1] + pos[v * 3 + 2] * nrm[v * 3 + 2]);
      expect(out).toBeGreaterThan(0);
      if (pos[v * 3 + 1] > 6.5) top += col[v * 3 + 1];
      if (pos[v * 3 + 1] < 3.5) bottom += col[v * 3 + 1];
    }
    expect(top).toBeGreaterThan(bottom);
  });

  it("winds column sides outward", () => {
    const mb = new MeshBuilder();
    column(mb, 0, 0, 1, 0.5, 0, 3, white, 8);
    const g = mb.build();
    const p = g.getAttribute("position");
    // First side triangle: its geometric normal agrees with the stored normal.
    const a = [p.getX(0), p.getY(0), p.getZ(0)], b = [p.getX(1), p.getY(1), p.getZ(1)], c = [p.getX(2), p.getY(2), p.getZ(2)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const sn = g.getAttribute("normal");
    expect(n[0] * sn.getX(0) + n[1] * sn.getY(0) + n[2] * sn.getZ(0)).toBeGreaterThan(0);
  });
});
