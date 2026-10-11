/** Roof types, drawn on top of each volume. */
import type { Color } from "three";
import { Catalog } from "../catalog/registry";
import type { BuildingData } from "../engine/components";
import { insetConvex, type P2 } from "../geom/polygon";
import type { MeshBuilder, V3 } from "../render/meshBuilder";
import { band, bays, box, cap, edgesOf, panel, prism, scaled, type Parts, type Rng } from "./kit";
import { SWATCH, type Palette } from "./look";
import { longFirst } from "./massing";

export interface RoofCtx {
  b: BuildingData;
  pal: Palette;
  rng: Rng;
}

export interface RoofDef {
  /** Only for quad plans (pitched shapes). */
  quadOnly?: boolean;
  draw(p: Parts, poly: P2[], y: number, ctx: RoofCtx): void;
}

export const roofCatalog = new Catalog<RoofDef>("roof");

const parapet = (p: Parts, poly: P2[], y: number, c: Color, h = 0.9) => band(p.matte, edgesOf(poly), y, y + h, 0.05, c, 0.3);

roofCatalog.register("parapet", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    parapet(p, poly, y, ctx.pal.trim);
  },
});

roofCatalog.register("plant", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    parapet(p, poly, y, ctx.pal.trim);
    prism(p.matte, scaled(poly, ctx.rng.range(0.3, 0.45)), y, y + 3.2, SWATCH.concrete[1], ctx.pal.roof);
    for (let k = 0; k < 3; k++) {
      const c = scaled(poly, 0.08).map(([x, z]) => [x + ctx.rng.range(-6, 6), z + ctx.rng.range(-6, 6)] as P2);
      prism(p.metal, c, y, y + 1.4, SWATCH.frame[2]);
    }
  },
});

roofCatalog.register("green", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    cap(p.matte, scaled(poly, 0.82), y + 0.08, SWATCH.green);
    parapet(p, poly, y, ctx.pal.trim, 0.6);
  },
});

roofCatalog.register("terrace", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, SWATCH.warm[2]);
    const E = edgesOf(poly);
    for (const e of E) {
      panel(p.glass, e, 0.1, e.len - 0.1, y, y + 1.05, -0.15, SWATCH.railing);
      box(p.metal, e, 0.1, e.len - 0.1, y + 1.05, y + 1.1, -0.2, -0.1, ctx.pal.frame);
      // Planters along each terrace edge.
      for (const x of bays(e.len, 6, 1.5).slice(0, -1)) box(p.matte, e, x + 0.5, x + 1.7, y, y + 0.6, -1.0, -0.3, SWATCH.green);
    }
  },
});

roofCatalog.register("pavilion", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    parapet(p, poly, y, ctx.pal.trim);
    const pav = scaled(poly, 0.3);
    const PE = edgesOf(pav);
    for (const e of PE) panel(p.glass, e, 0, e.len, y, y + 2.8, 0, ctx.pal.glass);
    prism(p.matte, scaled(poly, 0.42), y + 2.8, y + 3.05, ctx.pal.trim);
    cap(p.matte, scaled(poly, 0.7), y + 0.06, SWATCH.green);
  },
});

roofCatalog.register("crown", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    band(p.metal, edgesOf(poly), y, y + 1.1, 0.05, ctx.pal.frame, 0.3);
    prism(p.matte, scaled(poly, 0.45), y, y + 4.5, ctx.pal.trim, ctx.pal.roof);
    if (ctx.b.floors > 34) prism(p.metal, scaled(poly, 0.05), y + 4.5, y + 22, ctx.pal.frame);
  },
});

roofCatalog.register("slab", {
  draw(p, poly, y, ctx) {
    prism(p.matte, scaled(poly, 1.06), y, y + 0.25, ctx.pal.wall);
    cap(p.matte, scaled(poly, 1.06), y, ctx.pal.wall, true);
  },
});

roofCatalog.register("civic-float", {
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    const roof = insetConvex(poly, -2.5) ?? poly;
    prism(p.matte, roof, y + 0.4, y + 1.3, ctx.pal.wall);
    cap(p.matte, roof, y + 0.4, ctx.pal.wall, true);
  },
});

/** Gable or hip roof over a quad; the ridge runs along the longer axis. */
export function pitchedRoof(mb: MeshBuilder, fp: readonly P2[], y: number, hip: boolean, color: Color, gableColor: Color) {
  const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [p0, p1, p2, p3] = longFirst(fp);
  const span = (len(p1, p2) + len(p3, p0)) / 2;
  const rise = span * 0.45;
  const mid = (a: P2, b: P2): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let r0 = mid(p3, p0);
  let r1 = mid(p1, p2);
  if (hip) {
    const ridgeLen = len(r0, r1) || 1;
    const inset = Math.min(span / 2, ridgeLen * 0.45);
    const ux = (r1[0] - r0[0]) / ridgeLen;
    const uz = (r1[1] - r0[1]) / ridgeLen;
    r0 = [r0[0] + ux * inset, r0[1] + uz * inset];
    r1 = [r1[0] - ux * inset, r1[1] - uz * inset];
  }
  const v = (q: P2, h = y): V3 => [q[0], h, q[1]];
  const R0 = v(r0, y + rise);
  const R1 = v(r1, y + rise);
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cz = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const outward = (a: P2, b: P2): V3 => [(a[0] + b[0]) / 2 - cx, 0.5, (a[1] + b[1]) / 2 - cz];
  mb.quadFacing(v(p0), v(p1), R1, R0, outward(p0, p1), color);
  mb.quadFacing(v(p2), v(p3), R0, R1, outward(p2, p3), color);
  mb.triFacing(v(p1), v(p2), R1, outward(p1, p2), hip ? color : gableColor);
  mb.triFacing(v(p3), v(p0), R0, outward(p3, p0), hip ? color : gableColor);
}

roofCatalog.register("gable", { quadOnly: true, draw: (p, poly, y, ctx) => pitchedRoof(p.matte, poly, y, false, SWATCH.roofDark, ctx.pal.wall) });
roofCatalog.register("hip", { quadOnly: true, draw: (p, poly, y, ctx) => pitchedRoof(p.matte, poly, y, true, SWATCH.roofDark, ctx.pal.wall) });

/** A single sloped plane over a quad, rising from the first edge to the opposite one. */
function slopedPlane(mb: MeshBuilder, q: P2[], y0: number, y1: number, roof: Color, wall: Color) {
  const [a, b, c, d] = q;
  const v = (pt: P2, h: number): V3 => [pt[0], h, pt[1]];
  mb.quadFacing(v(a, y0), v(b, y0), v(c, y1), v(d, y1), [0, 1, 0], roof);
  mb.quadFacing(v(a, y0), v(b, y0), v(c, y1), v(d, y1), [0, -1, 0], roof);
  // Side triangles and the tall back wall.
  const side = (p0: P2, p1: P2) => {
    const n: V3 = [p1[1] - p0[1], 0, -(p1[0] - p0[0])];
    mb.triFacing(v(p0, y0), v(p1, y0), v(p1, y1), n, wall);
    mb.triFacing(v(p0, y0), v(p1, y0), v(p1, y1), [-n[0], 0, -n[2]], wall);
  };
  side(b, c);
  side(a, d);
  const back: V3 = [(c[0] + d[0]) / 2 - (a[0] + b[0]) / 2, 0, (c[1] + d[1]) / 2 - (a[1] + b[1]) / 2];
  mb.quadFacing(v(d, y0), v(c, y0), v(c, y1), v(d, y1), back, wall);
}

roofCatalog.register("mono-pitch", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    const q = longFirst(poly);
    const span = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
    slopedPlane(p.matte, q, y, y + span * 0.25, SWATCH.roofDark, ctx.pal.wall);
  },
});

roofCatalog.register("butterfly", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    const [a, b, c, d] = longFirst(poly);
    const m0: P2 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
    const m1: P2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const span = Math.hypot(d[0] - a[0], d[1] - a[1]);
    const rise = span * 0.12;
    // Two planes falling to a central valley.
    slopedPlane(p.matte, [m0, m1, b, a], y, y + rise, SWATCH.roofDark, ctx.pal.wall);
    slopedPlane(p.matte, [m1, m0, d, c], y, y + rise, SWATCH.roofDark, ctx.pal.wall);
  },
});

roofCatalog.register("sawtooth", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    const q = longFirst(poly);
    const len = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
    const n = Math.max(2, Math.round(len / 8));
    const lerp = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let k = 0; k < n; k++) {
      // Each tooth: north-light glazing on the steep face, roof on the long slope.
      const t0 = k / n;
      const t1 = (k + 1) / n;
      // Low edge across the building at t0, rising to a glazed vertical face at t1.
      const tooth: P2[] = [lerp(q[0], q[1], t0), lerp(q[3], q[2], t0), lerp(q[3], q[2], t1), lerp(q[0], q[1], t1)];
      slopedPlane(p.matte, tooth, y, y + 3, SWATCH.cladding[3], ctx.pal.glass);
    }
  },
});

/** Rows of tilted solar panels across a quad roof, between `v0` and `v1` of its depth. */
function solarRows(p: Parts, q: P2[], y: number, v0 = 0.1, v1 = 0.9) {
  const [a, b, , d] = q;
  const depth = Math.hypot(d[0] - a[0], d[1] - a[1]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const P = (u: number, v: number, h: number): V3 => {
    const x = a[0] + ((b[0] - a[0]) * u) / len + ((d[0] - a[0]) * v) / depth;
    const z = a[1] + ((b[1] - a[1]) * u) / len + ((d[1] - a[1]) * v) / depth;
    return [x, h, z];
  };
  const panelC = SWATCH.solar;
  const frame = SWATCH.charcoal[0];
  for (let v = depth * v0; v + 1.7 < depth * v1; v += 2.6) {
    const u0 = Math.min(1.5, len * 0.1), u1 = len - u0;
    if (u1 - u0 < 1.5) continue;
    p.glass.quadFacing(P(u0, v, y + 0.35), P(u1, v, y + 0.35), P(u1, v + 1.7, y + 1.05), P(u0, v + 1.7, y + 1.05), [0, 1, 0], panelC);
    p.metal.quadFacing(P(u0, v, y + 0.35), P(u1, v, y + 0.35), P(u1, v + 1.7, y + 1.05), P(u0, v + 1.7, y + 1.05), [0, -1, 0], frame);
    p.metal.quadFacing(P(u0, v + 1.7, y), P(u1, v + 1.7, y), P(u1, v + 1.7, y + 1.05), P(u0, v + 1.7, y + 1.05), [0, 0, 1], frame);
  }
}

roofCatalog.register("solar", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    parapet(p, poly, y, ctx.pal.trim, 0.5);
    solarRows(p, longFirst(poly), y);
  },
});

roofCatalog.register("solar-green", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    cap(p.matte, poly, y, ctx.pal.roof);
    cap(p.matte, scaled(poly, 0.9), y + 0.08, SWATCH.green);
    parapet(p, poly, y, ctx.pal.trim, 0.6);
    solarRows(p, longFirst(poly), y + 0.08, 0.15, 0.6);
  },
});

/** Mono-pitch roof covered in solar panels on its slope. */
roofCatalog.register("solar-pitch", {
  quadOnly: true,
  draw(p, poly, y, ctx) {
    const q = longFirst(poly);
    const span = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
    const rise = span * 0.25;
    slopedPlane(p.matte, q, y, y + rise, SWATCH.roofDark, ctx.pal.wall);
    const [a, b, c, d] = q;
    const lerp = (m: P2, n: P2, t: number): P2 => [m[0] + (n[0] - m[0]) * t, m[1] + (n[1] - m[1]) * t];
    const k0 = 0.12, k1 = 0.88;
    const pa = lerp(lerp(a, b, k0), lerp(d, c, k0), 0.08), pb = lerp(lerp(a, b, k1), lerp(d, c, k1), 0.08);
    const pc = lerp(lerp(a, b, k1), lerp(d, c, k1), 0.7), pd = lerp(lerp(a, b, k0), lerp(d, c, k0), 0.7);
    const h = (t: number) => y + rise * t + 0.06;
    p.glass.quadFacing([pa[0], h(0.08), pa[1]], [pb[0], h(0.08), pb[1]], [pc[0], h(0.7), pc[1]], [pd[0], h(0.7), pd[1]], [0, 1, 0], SWATCH.solar);
  },
});
