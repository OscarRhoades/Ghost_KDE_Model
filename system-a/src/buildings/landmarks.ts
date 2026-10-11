/**
 * Landmarks: signature buildings drawn by hand-written generators, each with
 * its own interior. Generators place a few per city on prominent lots by
 * giving a building one of these styles.
 */
import { Color } from "three";
import type { BuildingData } from "../engine/components";
import { centroid, type P2 } from "../geom/polygon";
import type { MeshBuilder, V3 } from "../render/meshBuilder";
import { canopy } from "./facades";
import { bays, box, cap, edgesOf, panel, panelAround, prism, walls, type Parts } from "./kit";
import { lookRng, SWATCH, tint, type Palette } from "./look";
import { quadOf, type Quad } from "./massing";
import { pitchedRoof } from "./roofs";
import { specialInfo, type FurnishApi } from "./special";
import { FOUNDATION, registerRecipe, registerStyle } from "./styles";

const hex = (h: string) => new Color(h);
const H = (b: BuildingData) => b.floors * b.floorHeight;
const v3 = (p: P2, y: number): V3 => [p[0], y, p[1]];
const quad = (b: BuildingData): Quad => quadOf(b.footprint)!;
const fp = (b: BuildingData): P2[] => b.footprint.map((q) => [q[0], q[1]] as P2);

/** Points on an ellipse in the lot's (u, v) space. */
function ellipse(q: Quad, cu: number, cv: number, ru: number, rv: number, n: number): P2[] {
  return q.poly(Array.from({ length: n }, (_, k) => [cu + ru * Math.cos((k / n) * Math.PI * 2), cv + rv * Math.sin((k / n) * Math.PI * 2)]));
}

function plinth(p: Parts, b: BuildingData, poly: P2[]) {
  walls(p.matte, edgesOf(poly), b.baseY - FOUNDATION, b.baseY + 0.25, SWATCH.concrete[1], 0.05, b.entrance);
}

/** A double-sided gable roof (visible from inside the hall too), with glazed or solid ends. */
function hallRoof(p: Parts, poly: P2[], y: number, riseFactor: number, roof: Color, ends: Color, glassEnds: boolean) {
  const [a, b, c, d] = poly;
  const m0: P2 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
  const m1: P2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
  const rise = Math.hypot(d[0] - a[0], d[1] - a[1]) * riseFactor;
  const both = (mb: MeshBuilder, pts: V3[], n: V3, color: Color) => {
    if (pts.length === 4) {
      mb.quadFacing(pts[0], pts[1], pts[2], pts[3], n, color);
      mb.quadFacing(pts[0], pts[1], pts[2], pts[3], [-n[0], -n[1], -n[2]], color);
    } else {
      mb.triFacing(pts[0], pts[1], pts[2], n, color);
      mb.triFacing(pts[0], pts[1], pts[2], [-n[0], -n[1], -n[2]], color);
    }
  };
  const [cx, cz] = centroid(poly);
  const out = (pp: P2[]): V3 => {
    const [mx, mz] = centroid(pp);
    return [mx - cx, 0.6, mz - cz];
  };
  both(p.matte, [v3(a, y), v3(b, y), v3(m1, y + rise), v3(m0, y + rise)], out([a, b]), roof);
  both(p.matte, [v3(d, y), v3(c, y), v3(m1, y + rise), v3(m0, y + rise)], out([c, d]), roof);
  const endSlot = glassEnds ? p.glass : p.matte;
  both(endSlot, [v3(b, y), v3(c, y), v3(m1, y + rise)], out([b, c]), ends);
  both(endSlot, [v3(a, y), v3(d, y), v3(m0, y + rise)], out([a, d]), ends);
  return rise;
}


// ---- 1. Supertall (a recipe over twisting / tapering massing) ----------------

registerRecipe(
  "supertall",
  {
    facades: [["unitised-grid", 1], ["curtain-fins", 1], ["horizontal-louvres", 0.5]],
    roofs: [["crown", 1]],
    lowerRoof: "terrace",
    palette(rng) {
      const trim = tint(rng, SWATCH.white);
      return { wall: trim, wall2: trim, glass: tint(rng, SWATCH.glass), frame: tint(rng, SWATCH.frame, 0.5), accent: tint(rng, SWATCH.white), roof: SWATCH.roof, trim };
    },
  },
  ["landmark"],
);

// ---- 2. Museum: stone box under a cantilevered roof ---------------------------

const museumBase = (b: BuildingData) => quad(b).sub(0.1, 0.22, 0.9, 0.85);

registerStyle(
  "museum",
  {
    detail(p, b) {
      const q = quad(b);
      const rng = lookRng(b, 0x3005);
      const stone = tint(rng, SWATCH.white, 0.4);
      const base = museumBase(b);
      const E = edgesOf(base);
      const top = b.baseY + H(b);
      plinth(p, b, base);
      walls(p.matte, E, b.baseY + 4.5, top, stone);
      for (const e of E) {
        panelAround(p.glass, e, 0, e.len, b.baseY, b.baseY + 4.5, 0, SWATCH.glass[2], b.entrance);
        // Tall slit windows.
        for (const x of bays(e.len, 4.5, 2).slice(1, -1)) panel(p.glass, e, x - 0.2, x + 0.2, b.baseY + 5.5, top - 1.5, 0.02, SWATCH.glass[4]);
      }
      // Cantilevered roof slab reaching over the forecourt, on two slender columns.
      const slab = q.sub(0.03, -0.02, 0.97, 0.9);
      prism(p.matte, slab, top, top + 1.4, stone);
      cap(p.matte, slab, top, stone, true);
      for (const [u, v] of [[0.06, 0.02], [0.94, 0.02]] as const) prism(p.metal, q.sub(u - 0.008, v, u + 0.008, v + 0.016), b.baseY, top, SWATCH.frame[0]);
      // Skylights.
      for (let k = 0; k < 3; k++) prism(p.glass, q.sub(0.25 + k * 0.2, 0.4, 0.31 + k * 0.2, 0.75), top + 1.4, top + 2.4, SWATCH.glassLight);
      canopy(p, E, b.entrance, b.baseY + 4.5, 6, 0.4, SWATCH.frame[0]);
    },
    massing(p, b) {
      const top = b.baseY + H(b);
      prism(p.matte, museumBase(b), b.baseY - FOUNDATION, top, SWATCH.white[0]);
      prism(p.matte, quad(b).sub(0.03, -0.02, 0.97, 0.9), top, top + 1.4, SWATCH.white[1]);
    },
  },
  ["landmark"],
);

specialInfo.set("museum", {
  shell: museumBase,
  floors: () => 1,
  floorHeight: (b) => H(b),
  room: "Gallery",
  glazing: "solid",
  furnish(api) {
    const { U, V } = api;
    const x0 = U * 0.1 + 3;
    const x1 = U * 0.9 - 3;
    const y0 = V * 0.22 + 4;
    const y1 = V * 0.85 - 3;
    const colors = [0xc4573b, 0x2f6e9e, 0xd9a441, 0x5f8a4e, 0x2b3035];
    let k = 0;
    for (let x = x0; x < x1 - 1; x += 6) {
      for (let y = y0; y < y1 - 1; y += 6) {
        api.box(x, y, x + 1.2, y + 1.2, 0, 1.0, 0xf2f1ee);
        api.box(x + 0.3, y + 0.3, x + 0.9, y + 0.9, 1.0, 1.6 + (k % 3) * 0.4, colors[k++ % colors.length]);
      }
    }
    // Paintings on the long walls.
    for (let x = x0; x < x1 - 2; x += 4.5) {
      api.box(x, V * 0.85 - 0.25, x + 2.4, V * 0.85 - 0.18, 1.4, 3.0, colors[k++ % colors.length]);
      api.box(x, V * 0.22 + 0.18, x + 2.4, V * 0.22 + 0.25, 1.4, 3.0, colors[k++ % colors.length]);
    }
    api.box(U / 2 - 2, (y0 + y1) / 2 - 0.3, U / 2 + 2, (y0 + y1) / 2 + 0.3, 0, 0.45, 0x8a7a66);
  },
});

// ---- 3. Rail station: arched glass train shed ------------------------------

const ARCH_SEGMENTS = 12;

function archPoint(q: Quad, u: number, v: number, y0: number, rise: number): V3 {
  const [x, z] = q.poly([[u, v]])[0];
  return [x, y0 + rise * Math.sin(Math.PI * v), z];
}

registerStyle(
  "station",
  {
    detail(p, b) {
      const q = quad(b);
      const rng = lookRng(b, 0x57a7);
      const brick = tint(rng, SWATCH.brick, 0.5);
      const wallTop = b.baseY + 8;
      const rise = q.V * 0.32;
      const E = edgesOf(fp(b));
      plinth(p, b, fp(b));
      walls(p.matte, E, b.baseY, wallTop, brick, 0, b.entrance);
      for (const e of E) {
        for (const x of bays(e.len, 6, 2).slice(0, -1)) {
          const s0 = x + 1.6;
          const s1 = x + 4.4;
          if (b.entrance && Math.abs((b.entrance.x - e.a[0]) * e.tx + (b.entrance.z - e.a[1]) * e.tz - (s0 + s1) / 2) < 3 && Math.abs((b.entrance.x - e.a[0]) * e.nx + (b.entrance.z - e.a[1]) * e.nz) < 0.3) continue;
          panel(p.metal, e, s0 - 0.1, s1 + 0.1, b.baseY + 1.2, wallTop - 0.9, 0.02, SWATCH.frame[0]);
          panel(p.glass, e, s0, s1, b.baseY + 1.3, wallTop - 1.0, 0.04, SWATCH.glass[1]);
        }
      }
      box(p.matte, E[0], -0.3, E[0].len + 0.3, wallTop, wallTop + 0.5, 0, 0.3, SWATCH.concrete[0]);
      for (const e of E) box(p.matte, e, -0.3, e.len + 0.3, wallTop, wallTop + 0.5, 0, 0.3, SWATCH.concrete[0]);
      // Arched roof: ribs across the short side, glazing between them.
      const ribs = bays(q.U, 8).map((x) => x / q.U);
      for (const u of ribs) {
        for (let k = 0; k < ARCH_SEGMENTS; k++) {
          const a = archPoint(q, u, k / ARCH_SEGMENTS, wallTop, rise);
          const c = archPoint(q, u, (k + 1) / ARCH_SEGMENTS, wallTop, rise);
          const du = 0.6 / q.U;
          const a2 = archPoint(q, u + du, k / ARCH_SEGMENTS, wallTop, rise);
          const c2 = archPoint(q, u + du, (k + 1) / ARCH_SEGMENTS, wallTop, rise);
          // Ribs ride just above the glazing, light grey so they read from afar.
          const lift = (v: V3): V3 => [v[0], v[1] + 0.12, v[2]];
          p.metal.quadFacing(lift(a), lift(c), lift(c2), lift(a2), [0, 1, 0], SWATCH.frame[2]);
          p.metal.quadFacing(a, c, c2, a2, [0, -1, 0], SWATCH.frame[0]);
        }
      }
      for (let r = 0; r + 1 < ribs.length; r++) {
        for (let k = 0; k < ARCH_SEGMENTS; k++) {
          const pts = [archPoint(q, ribs[r], k / ARCH_SEGMENTS, wallTop + 0.05, rise), archPoint(q, ribs[r + 1], k / ARCH_SEGMENTS, wallTop + 0.05, rise), archPoint(q, ribs[r + 1], (k + 1) / ARCH_SEGMENTS, wallTop + 0.05, rise), archPoint(q, ribs[r], (k + 1) / ARCH_SEGMENTS, wallTop + 0.05, rise)];
          p.glass.quadFacing(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], SWATCH.glass[3]);
        }
      }
      // Glazed arched ends with a clock on each.
      for (const [u, out] of [[0, -1], [1, 1]] as const) {
        const base = archPoint(q, u, 0.5, wallTop, 0);
        const dir: V3 = [(q.q[1][0] - q.q[0][0]) * out, 0, (q.q[1][1] - q.q[0][1]) * out];
        for (let k = 0; k < ARCH_SEGMENTS; k++) {
          p.glass.triFacing(base, archPoint(q, u, k / ARCH_SEGMENTS, wallTop, rise), archPoint(q, u, (k + 1) / ARCH_SEGMENTS, wallTop, rise), dir, SWATCH.glass[2]);
        }
        const c = archPoint(q, u, 0.5, wallTop + rise * 0.45, 0);
        const len = Math.hypot(dir[0], dir[2]) || 1;
        const nx = dir[0] / len;
        const nz = dir[2] / len;
        const tx = -nz;
        const tz = nx;
        const R = 1.6;
        for (let k = 0; k < 16; k++) {
          const a0 = (k / 16) * Math.PI * 2;
          const a1 = ((k + 1) / 16) * Math.PI * 2;
          const P = (a: number, r: number): V3 => [c[0] + tx * Math.cos(a) * r + nx * 0.3, c[1] + Math.sin(a) * r, c[2] + tz * Math.cos(a) * r + nz * 0.3];
          p.glow.triFacing([c[0] + nx * 0.3, c[1], c[2] + nz * 0.3], P(a0, R), P(a1, R), [nx, 0, nz], SWATCH.white[2]);
        }
        const hand = (ang: number, r: number) => {
          const P = (s: number, w: number): V3 => [c[0] + tx * (Math.cos(ang) * s - Math.sin(ang) * w) + nx * 0.33, c[1] + Math.sin(ang) * s + Math.cos(ang) * w, c[2] + tz * (Math.cos(ang) * s - Math.sin(ang) * w) + nz * 0.33];
          p.metal.quadFacing(P(0, -0.06), P(r, -0.06), P(r, 0.06), P(0, 0.06), [nx, 0, nz], SWATCH.charcoal[2]);
        };
        hand(1.2, R * 0.85);
        hand(2.9, R * 0.6);
      }
    },
    massing(p, b) {
      const q = quad(b);
      const wallTop = b.baseY + 8;
      walls(p.matte, edgesOf(fp(b)), b.baseY - FOUNDATION, wallTop, SWATCH.brick[0]);
      const rise = q.V * 0.32;
      for (let k = 0; k < 6; k++) {
        const pts = [archPoint(q, 0, k / 6, wallTop, rise), archPoint(q, 1, k / 6, wallTop, rise), archPoint(q, 1, (k + 1) / 6, wallTop, rise), archPoint(q, 0, (k + 1) / 6, wallTop, rise)];
        p.glass.quadFacing(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], SWATCH.glass[3]);
      }
    },
  },
  ["landmark"],
);

specialInfo.set("station", {
  glazing: "punched",
  floors: () => 1,
  floorHeight: () => 8,
  openCeiling: true,
  room: "Station hall",
  furnish(api) {
    const { U, V } = api;
    // Tracks and platforms along the hall, a concourse at one end.
    let y = 4;
    let k = 0;
    while (y + 4 < V - 3) {
      if (k % 2 === 0) {
        api.box(14, y, U - 3, y + 4, 0, 0.9, 0xbdb8ae);
        for (let x = 20; x < U - 6; x += 12) api.box(x, y + 1.5, x + 2, y + 2.1, 0.9, 1.35, 0x6b5a4a);
      } else {
        api.box(14, y + 0.6, U - 3, y + 0.8, 0, 0.08, 0x5a5550);
        api.box(14, y + 2.6, U - 3, y + 2.8, 0, 0.08, 0x5a5550);
      }
      y += k % 2 === 0 ? 4 : 3.4;
      k++;
    }
    api.box(4, V / 2 - 2.5, 5, V / 2 + 2.5, 2.2, 3.4, 0x1f2a33);
  },
});

// ---- 4. Stadium: elliptical bowl ---------------------------------------------

const stadiumOuter = (b: BuildingData) => ellipse(quad(b), 0.5, 0.5, 0.48, 0.47, 40);

registerStyle(
  "stadium",
  {
    detail(p, b) {
      const q = quad(b);
      const outer = stadiumOuter(b);
      const E = edgesOf(outer);
      const top = b.baseY + 20;
      const white = SWATCH.white[0];
      plinth(p, b, outer);
      walls(p.glass, E, b.baseY, b.baseY + 4, SWATCH.glass[1], 0, b.entrance);
      walls(p.matte, E, b.baseY + 4, top, white);
      for (const e of E) box(p.metal, e, -0.15, 0.15, b.baseY, top + 1, 0, 0.6, SWATCH.frame[2]);
      // Roof ring over the stands.
      const ringOut = ellipse(q, 0.5, 0.5, 0.49, 0.48, 40);
      const ringIn = ellipse(q, 0.5, 0.5, 0.36, 0.35, 40);
      for (let k = 0; k < 40; k++) {
        const j = (k + 1) % 40;
        const pts: V3[] = [v3(ringOut[k], top), v3(ringOut[j], top), v3(ringIn[j], top + 1.5), v3(ringIn[k], top + 1.5)];
        p.matte.quadFacing(pts[0], pts[1], pts[2], pts[3], [0, 1, 0], white);
        p.matte.quadFacing(pts[0], pts[1], pts[2], pts[3], [0, -1, 0], SWATCH.concrete[2]);
      }
      // Seating tiers rising from the pitch.
      const [cx, cz] = centroid(outer);
      const tiers = 10;
      const seat = [hex("#b23a3a"), hex("#c94a44")];
      for (let i = 0; i < tiers; i++) {
        const s0 = 0.3 + (i / tiers) * 0.16;
        const s1 = 0.3 + ((i + 1) / tiers) * 0.16;
        const h0 = b.baseY + 2.6 + i * 1.3;
        const inner = ellipse(q, 0.5, 0.5, s0, s0 * 0.98, 40);
        const outerT = ellipse(q, 0.5, 0.5, s1, s1 * 0.98, 40);
        for (let k = 0; k < 40; k++) {
          const j = (k + 1) % 40;
          p.matte.quadFacing(v3(inner[k], h0), v3(inner[j], h0), v3(outerT[j], h0), v3(outerT[k], h0), [0, 1, 0], seat[i % 2]);
          // Riser faces the pitch.
          const toCenter: V3 = [cx - inner[k][0], 0, cz - inner[k][1]];
          p.matte.quadFacing(v3(inner[k], h0 - 1.3), v3(inner[j], h0 - 1.3), v3(inner[j], h0), v3(inner[k], h0), toCenter, SWATCH.concrete[1]);
          p.matte.quadFacing(v3(inner[k], h0 - 1.3), v3(inner[j], h0 - 1.3), v3(outerT[j], h0 - 1.3), v3(outerT[k], h0 - 1.3), [0, -1, 0], SWATCH.concrete[2]);
        }
      }
      // Pitch with white lines.
      const pitch = q.sub(0.3, 0.33, 0.7, 0.67);
      cap(p.matte, pitch, b.baseY + 0.07, hex("#5f9e4a"));
      const PE = edgesOf(pitch);
      for (const e of PE) box(p.glow, e, 0, e.len, b.baseY + 0.07, b.baseY + 0.09, -0.15, 0, SWATCH.white[2]);
      cap(p.glow, q.sub(0.497, 0.33, 0.503, 0.67), b.baseY + 0.09, SWATCH.white[2]);
      // Floodlight masts.
      for (const ang of [0.6, 2.55, 3.75, 5.7]) {
        const [x, z] = q.poly([[0.5 + 0.5 * Math.cos(ang), 0.5 + 0.49 * Math.sin(ang)]])[0];
        prism(p.metal, [[x - 0.4, z - 0.4], [x + 0.4, z - 0.4], [x + 0.4, z + 0.4], [x - 0.4, z + 0.4]], b.baseY, top + 14, SWATCH.frame[2]);
        prism(p.glow, [[x - 2, z - 0.5], [x + 2, z - 0.5], [x + 2, z + 0.5], [x - 2, z + 0.5]], top + 14, top + 16, SWATCH.white[2]);
      }
    },
    massing(p, b) {
      prism(p.matte, stadiumOuter(b), b.baseY - FOUNDATION, b.baseY + 20, SWATCH.white[0], hex("#5f9e4a"));
    },
  },
  ["landmark"],
);

specialInfo.set("stadium", {
  shell: stadiumOuter,
  floors: () => 1,
  floorHeight: () => 20,
  openCeiling: true,
  room: "Stadium",
  furnish(api, _f, b) {
    // Front wall of the stands, with four tunnels out to the pitch.
    const q = quad(b);
    const ring = ellipse(q, 0.5, 0.5, 0.3, 0.294, 40).map((pt) => api.local(pt));
    for (let k = 0; k < 40; k++) {
      if (k % 10 === 0) continue;
      const a = ring[k];
      const c = ring[(k + 1) % 40];
      api.wall(a[0], a[1], c[0], c[1], [], 2.6);
    }
  },
});

// ---- 5. Concert hall: faceted crystal ---------------------------------------

function crystal(b: BuildingData) {
  const q = quad(b);
  const plan = q.poly([[0.12, 0.08], [0.88, 0.08], [0.96, 0.3], [0.9, 0.9], [0.5, 0.96], [0.1, 0.88], [0.04, 0.4]]);
  const rng = lookRng(b, 0xc0c0);
  const tops = plan.map(() => b.baseY + H(b) * rng.range(0.65, 1));
  return { plan, tops, apex: b.baseY + H(b) + 6 };
}

registerStyle(
  "concert-hall",
  {
    detail(p, b) {
      const { plan, tops, apex } = crystal(b);
      const E = edgesOf(plan);
      const n = plan.length;
      const white = SWATCH.white[2];
      plinth(p, b, plan);
      walls(p.glass, E, b.baseY, b.baseY + 5, SWATCH.glass[2], 0, b.entrance);
      const [cx, cz] = centroid(plan);
      // Walls rise to a different height at every corner; panels alternate white and glass.
      for (let k = 0; k < n; k++) {
        const a = plan[k];
        const c = plan[(k + 1) % n];
        const ta = tops[k];
        const tc = tops[(k + 1) % n];
        const out: V3 = [(a[0] + c[0]) / 2 - cx, 0, (a[1] + c[1]) / 2 - cz];
        const segs = 4;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs;
          const t1 = (s + 1) / segs;
          const P = (t: number, y: number): V3 => [a[0] + (c[0] - a[0]) * t, y, a[1] + (c[1] - a[1]) * t];
          const y0 = b.baseY + 5;
          const top0 = ta + (tc - ta) * t0;
          const top1 = ta + (tc - ta) * t1;
          const lo = (s % 2 ? p.glass : p.matte) as MeshBuilder;
          const hi = (s % 2 ? p.matte : p.glass) as MeshBuilder;
          lo.triFacing(P(t0, y0), P(t1, y0), P(t1, top1), out, s % 2 ? SWATCH.glass[0] : white);
          hi.triFacing(P(t0, y0), P(t1, top1), P(t0, top0), out, s % 2 ? white : SWATCH.glass[0]);
        }
      }
      // Faceted roof rising to an off-center peak.
      const peak: V3 = [cx + (plan[2][0] - cx) * 0.25, apex, cz + (plan[2][1] - cz) * 0.25];
      for (let k = 0; k < n; k++) p.matte.triFacing(v3(plan[k], tops[k]), v3(plan[(k + 1) % n], tops[(k + 1) % n]), peak, [0, 1, 0], white);
      canopy(p, E, b.entrance, b.baseY + 5, 10, 4, SWATCH.frame[0]);
    },
    massing(p, b) {
      const { plan, tops, apex } = crystal(b);
      const [cx, cz] = centroid(plan);
      const n = plan.length;
      for (let k = 0; k < n; k++) {
        const a = plan[k];
        const c = plan[(k + 1) % n];
        const out: V3 = [(a[0] + c[0]) / 2 - cx, 0, (a[1] + c[1]) / 2 - cz];
        p.matte.quadFacing(v3(a, b.baseY - FOUNDATION), v3(c, b.baseY - FOUNDATION), v3(c, tops[(k + 1) % n]), v3(a, tops[k]), out, SWATCH.white[2]);
        p.matte.triFacing(v3(a, tops[k]), v3(c, tops[(k + 1) % n]), [cx, apex, cz], [0, 1, 0], SWATCH.white[1]);
      }
    },
  },
  ["landmark"],
);

specialInfo.set("concert-hall", {
  shell: (b) => crystal(b).plan,
  floors: () => 1,
  floorHeight: (b) => H(b) * 0.6,
  room: "Auditorium",
  glazing: "solid",
  furnish(api) {
    const { U, V } = api;
    api.box(U * 0.3, V * 0.72, U * 0.7, V * 0.84, 0, 1.0, 0x2b2420);
    for (let r = 0; r < 10; r++) {
      const y = V * 0.62 - r * 1.15;
      if (y < V * 0.18) break;
      api.box(U * 0.22, y, U * 0.48, y + 0.6, 0, 0.5 + r * 0.12, 0x8a2a2a);
      api.box(U * 0.52, y, U * 0.78, y + 0.6, 0, 0.5 + r * 0.12, 0x8a2a2a);
    }
  },
});

// ---- 6. Library (a recipe over stepped massing, furnished with stacks) ------

registerRecipe(
  "library",
  {
    facades: [["horizontal-louvres", 1], ["timber-cladding", 0.8], ["concrete-grid", 0.6]],
    roofs: [["green", 1], ["terrace", 1]],
    lowerRoof: "terrace",
    palette(rng): Palette {
      const wall = tint(rng, SWATCH.warm);
      return { wall, wall2: wall, glass: tint(rng, SWATCH.glass), frame: SWATCH.frame[3], accent: tint(rng, SWATCH.timber), roof: SWATCH.roof, trim: tint(rng, SWATCH.concrete) };
    },
  },
  ["landmark"],
);

specialInfo.set("library", {
  room: "Library",
  furnish(api: FurnishApi) {
    const { U, V } = api;
    const stair = api.stair;
    const clear = (x0: number, y0: number, x1: number, y1: number) => !stair || x1 < stair[0] - 1.5 || x0 > stair[2] + 1.5 || y1 < stair[1] - 1.5 || y0 > stair[3] + 1.5;
    // Book stacks in the middle, reading tables by the windows.
    for (let y = 4; y + 0.6 < V - 4; y += 2.6) {
      for (let x = 4; x + 5 < U - 4; x += 6.5) if (clear(x, y, x + 5, y + 0.6)) api.box(x, y, x + 5, y + 0.6, 0, 2.2, 0x8a6a4a);
    }
    for (let x = 3; x + 2 < U - 3; x += 4) {
      if (clear(x, 1.2, x + 2, 2.2)) api.box(x, 1.2, x + 2, 2.2, 0.72, 0.78, 0xd9cdb8);
    }
  },
});

// ---- 7. Market hall: brick piers under a glazed-end gable --------------------

const marketHall = (b: BuildingData) => quad(b).sub(0.05, 0.1, 0.95, 0.9);

registerStyle(
  "market-hall",
  {
    detail(p, b) {
      const hall = marketHall(b);
      const E = edgesOf(hall);
      const rng = lookRng(b, 0x3a4c);
      const brick = tint(rng, SWATCH.brick, 0.5);
      const top = b.baseY + 7;
      plinth(p, b, hall);
      walls(p.matte, E, b.baseY, top, brick, 0, b.entrance);
      for (const e of E) {
        const xs = bays(e.len, 5, 0.5);
        for (let k = 0; k < xs.length; k++) {
          box(p.matte, e, xs[k] - 0.4, xs[k] + 0.4, b.baseY, top + 0.3, 0, 0.4, brick.clone().offsetHSL(0, 0, -0.05));
          if (k + 1 < xs.length) {
            const s0 = xs[k] + 0.9;
            const s1 = xs[k + 1] - 0.9;
            const door = b.entrance;
            const onDoor = door && Math.abs((door.x - e.a[0]) * e.nx + (door.z - e.a[1]) * e.nz) < 0.3 && Math.abs((door.x - e.a[0]) * e.tx + (door.z - e.a[1]) * e.tz - (s0 + s1) / 2) < (s1 - s0) / 2 + 1;
            if (onDoor) continue;
            panel(p.metal, e, s0 - 0.08, s1 + 0.08, b.baseY + 1.4, top - 0.7, 0.02, SWATCH.frame[3]);
            panel(p.glass, e, s0, s1, b.baseY + 1.5, top - 0.8, 0.04, SWATCH.glass[5]);
          }
        }
      }
      hallRoof(p, hall, top, 0.32, SWATCH.roofDark, SWATCH.glass[2], true);
    },
    massing(p, b) {
      const hall = marketHall(b);
      walls(p.matte, edgesOf(hall), b.baseY - FOUNDATION, b.baseY + 7, SWATCH.brick[1]);
      pitchedRoof(p.matte, hall, b.baseY + 7, false, SWATCH.roofDark, SWATCH.glass[2]);
    },
  },
  ["landmark"],
);

specialInfo.set("market-hall", {
  shell: marketHall,
  floors: () => 1,
  floorHeight: () => 7,
  openCeiling: true,
  room: "Market hall",
  furnish(api) {
    const { U, V } = api;
    const canopies = [0xc4573b, 0x2f6e9e, 0xd9a441, 0x5f8a4e, 0xf1ead8];
    let k = 0;
    for (let x = U * 0.05 + 3; x + 3 < U * 0.95 - 3; x += 5) {
      for (const y of [V * 0.1 + 3, V * 0.5 - 1.2, V * 0.9 - 4.2]) {
        api.box(x, y, x + 3, y + 1.2, 0, 0.95, 0xb48a5a);
        api.box(x - 0.2, y - 0.3, x + 3.2, y + 1.5, 2.3, 2.4, canopies[k++ % canopies.length]);
        api.box(x, y, x + 0.08, y + 0.08, 0.95, 2.3, 0x3a3f45);
        api.box(x + 2.92, y, x + 3, y + 0.08, 0.95, 2.3, 0x3a3f45);
      }
    }
  },
});

// ---- 8. Chapel: steep gable and bell tower ---------------------------------

const nave = (b: BuildingData) => quad(b).sub(0.15, 0.3, 0.72, 0.7);
const tower = (b: BuildingData) => quad(b).sub(0.72, 0.4, 0.84, 0.6);

registerStyle(
  "chapel",
  {
    detail(p, b) {
      const N = nave(b);
      const T = tower(b);
      const E = edgesOf(N);
      const white = SWATCH.white[1];
      const slate = SWATCH.roofDark;
      const top = b.baseY + 8;
      plinth(p, b, N);
      walls(p.matte, E, b.baseY, top, white, 0, b.entrance);
      for (const e of E) {
        for (const x of bays(e.len, 3, 1.5).slice(1, -1)) {
          panel(p.metal, e, x - 0.38, x + 0.38, b.baseY + 2, b.baseY + 6.6, 0.02, SWATCH.frame[3]);
          panel(p.glass, e, x - 0.3, x + 0.3, b.baseY + 2.1, b.baseY + 6.5, 0.04, hex("#8fb0c4"));
        }
      }
      hallRoof(p, N, top, 0.9, slate, white, false);
      // Bell tower with belfry openings and a pyramid spire.
      const tTop = b.baseY + 18;
      prism(p.matte, T, b.baseY - FOUNDATION, tTop, white);
      for (const e of edgesOf(T)) panel(p.metal, e, e.len * 0.3, e.len * 0.7, tTop - 4, tTop - 1.2, 0.02, SWATCH.charcoal[2]);
      const [cx, cz] = centroid(T);
      for (let k = 0; k < 4; k++) p.matte.triFacing(v3(T[k], tTop), v3(T[(k + 1) % 4], tTop), [cx, tTop + 7, cz], [(T[k][0] + T[(k + 1) % 4][0]) / 2 - cx, 0.5, (T[k][1] + T[(k + 1) % 4][1]) / 2 - cz], slate);
    },
    massing(p, b) {
      walls(p.matte, edgesOf(nave(b)), b.baseY - FOUNDATION, b.baseY + 8, SWATCH.white[1]);
      pitchedRoof(p.matte, nave(b), b.baseY + 8, false, SWATCH.roofDark, SWATCH.white[1]);
      prism(p.matte, tower(b), b.baseY - FOUNDATION, b.baseY + 18, SWATCH.white[1]);
    },
  },
  ["landmark"],
);

specialInfo.set("chapel", {
  shell: nave,
  solids: (b) => [tower(b)],
  floors: () => 1,
  floorHeight: () => 8,
  openCeiling: true,
  room: "Chapel",
  glazing: "solid",
  furnish(api) {
    const { U, V } = api;
    // Pews facing the altar at the tower end.
    for (let x = U * 0.15 + 1.5; x + 0.5 < U * 0.72 - 4; x += 1.2) {
      api.box(x, V * 0.3 + 0.8, x + 0.5, V * 0.5 - 0.6, 0, 0.9, 0x7d5a3c);
      api.box(x, V * 0.5 + 0.6, x + 0.5, V * 0.7 - 0.8, 0, 0.9, 0x7d5a3c);
    }
    api.box(U * 0.72 - 2.6, V * 0.45, U * 0.72 - 1.6, V * 0.55, 0, 1.0, 0xf2f1ee);
  },
});

/** All landmark styles, for generators. */
export const LANDMARKS = ["supertall", "museum", "station", "stadium", "concert-hall", "library", "market-hall", "chapel"] as const;
