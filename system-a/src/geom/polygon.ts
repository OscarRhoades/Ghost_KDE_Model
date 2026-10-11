/** Pure 2D geometry on the ground plane. Points are `[x, z]`. */
export type P2 = readonly [number, number];

export function signedArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function area(poly: readonly P2[]): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: readonly P2[]): [number, number] {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    const f = x1 * z2 - x2 * z1;
    a += f;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate: fall back to the vertex average.
    const s = poly.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [s[0] / poly.length, s[1] / poly.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function bounds(poly: readonly P2[]): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function pointInPolygon(x: number, z: number, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (x,z) to segment ab, plus the projection parameter t in [0,1]. */
export function segmentDistance(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx - x;
  const pz = az + t * dz - z;
  return { d: Math.sqrt(px * px + pz * pz), t };
}

/** Signed distance to the polygon boundary: negative inside, positive outside. */
export function signedDistance(x: number, z: number, poly: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const { d } = segmentDistance(x, z, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return pointInPolygon(x, z, poly) ? -best : best;
}

/**
 * Inset a convex polygon by a per-edge distance (edge i runs from vertex i to i+1).
 * Returns null if the result collapses.
 */
export function insetConvex(poly: readonly P2[], dist: number | readonly number[]): [number, number][] | null {
  const n = poly.length;
  const ccw = signedArea(poly) > 0;
  const lines: { px: number; pz: number; dx: number; dz: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    let dx = bx - ax;
    let dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return null;
    dx /= len;
    dz /= len;
    // Inward normal: left of the edge for CCW (in x/z with z "up"), right otherwise.
    const nx = ccw ? -dz : dz;
    const nz = ccw ? dx : -dx;
    const d = typeof dist === "number" ? dist : dist[i];
    lines.push({ px: ax + nx * d, pz: az + nz * d, dx, dz });
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const den = l1.dx * l2.dz - l1.dz * l2.dx;
    if (Math.abs(den) < 1e-9) {
      out.push([l2.px, l2.pz]);
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dz - (l2.pz - l1.pz) * l2.dx) / den;
    out.push([l1.px + l1.dx * t, l1.pz + l1.dz * t]);
  }
  // Collapse check: orientation must survive and area must be positive.
  const a = signedArea(out);
  if (Math.abs(a) < 1 || a > 0 !== ccw) return null;
  return out;
}

/** Bilinear point inside a quad [p00, p10, p11, p01] at (u, v) in [0,1]^2. */
export function quadPoint(q: readonly P2[], u: number, v: number): [number, number] {
  const [p00, p10, p11, p01] = q;
  const x = (1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + u * v * p11[0] + (1 - u) * v * p01[0];
  const z = (1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + u * v * p11[1] + (1 - u) * v * p01[1];
  return [x, z];
}

/** Polygon rotated by `angle` radians about (cx, cz). */
export function rotated(poly: readonly P2[], angle: number, cx: number, cz: number): [number, number][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return poly.map(([x, z]) => [cx + (x - cx) * c - (z - cz) * s, cz + (x - cx) * s + (z - cz) * c]);
}

/**
 * The parts of segment a-b that lie inside `poly` (any simple polygon), as
 * parameter ranges [t0, t1] along the segment.
 */
export function clipSegment(ax: number, az: number, bx: number, bz: number, poly: readonly P2[]): [number, number][] {
  const ts = [0, 1];
  const dx = bx - ax;
  const dz = bz - az;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [px, pz] = poly[i];
    const [qx, qz] = poly[(i + 1) % n];
    const ex = qx - px;
    const ez = qz - pz;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - ax) * ez - (pz - az) * ex) / den;
    const u = ((px - ax) * dz - (pz - az) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k];
    const t1 = ts[k + 1];
    if (t1 - t0 < 1e-6) continue;
    const tm = (t0 + t1) / 2;
    if (!pointInPolygon(ax + dx * tm, az + dz * tm, poly)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-6) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}
