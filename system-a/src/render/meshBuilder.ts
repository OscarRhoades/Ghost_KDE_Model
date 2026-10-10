import { BufferGeometry, Color, Float32BufferAttribute } from "three";

export type V3 = readonly [number, number, number];

/**
 * Accumulates flat-colored triangles into one non-indexed geometry, so every
 * face gets its own normal: the low-poly look without per-face materials.
 */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  tri(a: V3, b: V3, c: V3, color: Color): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) this.col.push(color.r, color.g, color.b);
  }

  /** Quad a-b-c-d in counter-clockwise order as seen from the front. */
  quad(a: V3, b: V3, c: V3, d: V3, color: Color): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Triangle wound so its normal points along `facing` (any non-perpendicular hint). */
  triFacing(a: V3, b: V3, c: V3, facing: V3, color: Color): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * facing[0] + ny * facing[1] + nz * facing[2] >= 0) this.tri(a, b, c, color);
    else this.tri(a, c, b, color);
  }

  quadFacing(a: V3, b: V3, c: V3, d: V3, facing: V3, color: Color): void {
    this.triFacing(a, b, c, facing, color);
    this.triFacing(a, c, d, facing, color);
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
