/**
 * Terrain conforming: carve flat pads for parcels and graded corridors for roads,
 * blending smoothly back into the natural terrain. This lets the city sit on a
 * real heightmap while buildings and interiors keep flat floors.
 */
import { bounds, segmentDistance, signedDistance, type P2 } from "../geom/polygon";
import type { Heightfield } from "./heightfield";

/** What each terrain sample is covered by; drives coloring. */
export const Surface = {
  natural: 0,
  pad: 1,
  park: 2,
  road: 3,
  plaza: 4,
  /** Flattened residential lot: lawn around the house. */
  lawn: 5,
} as const;
export type SurfaceKind = (typeof Surface)[keyof typeof Surface];

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Set every sample inside `poly` to `y`, blending to natural terrain over `blend` meters. */
export function flattenPolygon(
  hf: Heightfield,
  poly: readonly P2[],
  y: number,
  blend: number,
  surface?: Uint8Array,
  kind: SurfaceKind = Surface.pad,
): void {
  const b = bounds(poly);
  const r = hf.rangeFor(b.minX - blend, b.minZ - blend, b.maxX + blend, b.maxZ + blend);
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      const x = i * hf.cellX;
      const z = j * hf.cellZ;
      const d = signedDistance(x, z, poly);
      if (d > blend) continue;
      const k = hf.index(i, j);
      if (d <= 0) {
        hf.data[k] = y;
        if (surface) surface[k] = kind;
      } else if (!surface || surface[k] === Surface.natural) {
        hf.data[k] = y + (hf.data[k] - y) * smooth(d / blend);
      }
    }
  }
}

/**
 * Grade a straight road segment: samples within `halfWidth` get the linearly
 * interpolated road elevation; natural samples out to `halfWidth + blend` ease back.
 * Pass the half width including sidewalks so they sit level with the street.
 */
export function gradeSegment(
  hf: Heightfield,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  halfWidth: number,
  blend: number,
  surface?: Uint8Array,
): void {
  const reach = halfWidth + blend;
  const r = hf.rangeFor(
    Math.min(a[0], b[0]) - reach,
    Math.min(a[2], b[2]) - reach,
    Math.max(a[0], b[0]) + reach,
    Math.max(a[2], b[2]) + reach,
  );
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      const x = i * hf.cellX;
      const z = j * hf.cellZ;
      const { d, t } = segmentDistance(x, z, a[0], a[2], b[0], b[2]);
      if (d > reach) continue;
      const y = a[1] + (b[1] - a[1]) * t;
      const k = hf.index(i, j);
      if (d <= halfWidth) {
        hf.data[k] = y;
        if (surface) surface[k] = Surface.road;
      } else if (!surface || surface[k] === Surface.natural) {
        // Blend only into untouched ground so pads and other roads stay flat.
        hf.data[k] = y + (hf.data[k] - y) * smooth((d - halfWidth) / blend);
      }
    }
  }
}
