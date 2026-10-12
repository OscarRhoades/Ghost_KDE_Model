// 2D polygon helpers. Paper-space polygons are convex and counter-clockwise.

export interface P2 {
  x: number;
  y: number;
}

export const EPS = 1e-9;

export const p2 = (x: number, y: number): P2 => ({ x, y });
export const sub2 = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add2 = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale2 = (a: P2, s: number): P2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: P2, b: P2) => a.x * b.x + a.y * b.y;
export const cross2 = (a: P2, b: P2) => a.x * b.y - a.y * b.x;
export const len2 = (a: P2) => Math.hypot(a.x, a.y);
export const dist2 = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp2 = (a: P2, b: P2, t: number): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm2 = (a: P2): P2 => {
  const l = len2(a);
  return { x: a.x / l, y: a.y / l };
};

export function area(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(poly: P2[]): P2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-14) {
    // degenerate: average of vertices
    const s = poly.reduce((acc, p) => add2(acc, p), p2(0, 0));
    return scale2(s, 1 / poly.length);
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Signed side of point q relative to the directed line (o, d): >0 left, <0 right. */
export const side = (o: P2, d: P2, q: P2) => cross2(d, sub2(q, o));

/**
 * Split a convex polygon by the line through `o` with direction `d`.
 * Returns [left, right]; either may be null when the line misses the polygon.
 */
export function splitConvex(poly: P2[], o: P2, d: P2, tol = 1e-9): [P2[] | null, P2[] | null] {
  const dn = norm2(d);
  const s = poly.map((q) => side(o, dn, q));
  const hasL = s.some((v) => v > tol);
  const hasR = s.some((v) => v < -tol);
  if (!hasL) return [null, poly];
  if (!hasR) return [poly, null];
  const L: P2[] = [];
  const R: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = Math.abs(s[i]) <= tol ? 0 : s[i];
    const sb = Math.abs(s[(i + 1) % poly.length]) <= tol ? 0 : s[(i + 1) % poly.length];
    if (sa >= 0) L.push(a);
    if (sa <= 0) R.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      const x = lerp2(a, b, t);
      L.push(x);
      R.push(x);
    }
  }
  return [cleanPoly(L), cleanPoly(R)];
}

/** Remove duplicate consecutive vertices. */
export function cleanPoly(poly: P2[], tol = 1e-10): P2[] | null {
  const out: P2[] = [];
  for (const p of poly) {
    if (out.length && dist2(out[out.length - 1], p) < tol) continue;
    out.push(p);
  }
  while (out.length > 1 && dist2(out[0], out[out.length - 1]) < tol) out.pop();
  if (out.length < 3 || Math.abs(area(out)) < 1e-12) return null;
  return out;
}

/** Sutherland–Hodgman clip of convex `subject` by convex CCW `clip`. */
export function clipConvex(subject: P2[], clip: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const d = sub2(b, a);
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j];
      const q = inp[(j + 1) % inp.length];
      const sp = side(a, d, p);
      const sq = side(a, d, q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push(lerp2(p, q, t));
      }
    }
  }
  return out;
}

export function overlapArea(a: P2[], b: P2[]): number {
  const A = area(a) < 0 ? [...a].reverse() : a;
  const B = area(b) < 0 ? [...b].reverse() : b;
  const c = clipConvex(A, B);
  return c.length >= 3 ? Math.abs(area(c)) : 0;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bbox(poly: P2[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

export const bboxOverlap = (a: BBox, b: BBox, m = 0) =>
  a.x0 < b.x1 - m && b.x0 < a.x1 - m && a.y0 < b.y1 - m && b.y0 < a.y1 - m;

/**
 * Collinear overlap between segments (a0,a1) and (b0,b1).
 * Returns the overlapping sub-segment or null.
 */
export function segmentOverlap(a0: P2, a1: P2, b0: P2, b1: P2, tol = 1e-7): [P2, P2] | null {
  const d = sub2(a1, a0);
  const L = len2(d);
  if (L < tol) return null;
  const u = scale2(d, 1 / L);
  // both b points must lie on the line of a
  if (Math.abs(cross2(u, sub2(b0, a0))) > tol || Math.abs(cross2(u, sub2(b1, a0))) > tol) return null;
  const t0 = dot2(sub2(b0, a0), u);
  const t1 = dot2(sub2(b1, a0), u);
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(L, Math.max(t0, t1));
  if (hi - lo < 1e-6) return null;
  return [add2(a0, scale2(u, lo)), add2(a0, scale2(u, hi))];
}

export function pointInConvex(poly: P2[], q: P2, tol = 1e-9): boolean {
  const ccw = area(poly) > 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const s = side(a, sub2(b, a), q);
    if (ccw ? s < -tol : s > tol) return false;
  }
  return true;
}
