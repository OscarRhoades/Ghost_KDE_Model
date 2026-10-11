/**
 * Prop catalog: street furniture, trees and park features. Each prop is a
 * small low-poly model in local coordinates (meters, y up, front facing +z),
 * built once into a template and stamped wherever it is placed.
 */
import { Color } from "three";
import { Catalog } from "../catalog/registry";
import { newParts, type Parts, type Slot } from "../buildings/kit";
import type { MeshBuilder, RawMesh, V3 } from "../render/meshBuilder";
import { column, puff } from "../render/organic";

export interface PropDef {
  build(p: Parts): void;
  /** Footprint half-size for collision (circle or box half-extents); omit for walk-through. */
  solid?: { r?: number; hx?: number; hz?: number };
  /** Lit at night (lamps, signs). */
  glows?: boolean;
  /** A pool of light on the ground at night: center in the prop's frame and radius. */
  light?: { x: number; z: number; r: number };
}

export const propCatalog = new Catalog<PropDef>("prop");

const hex = (h: string) => new Color(h);

// ---- Primitives (local space) ---------------------------------------------------

export function block(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: Color, bottom = false) {
  const v = (x: number, y: number, z: number): V3 => [x, y, z];
  mb.quadFacing(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), [0, 0, 1], c);
  mb.quadFacing(v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), [0, 0, -1], c);
  mb.quadFacing(v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0), [1, 0, 0], c);
  mb.quadFacing(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), [-1, 0, 0], c);
  mb.quadFacing(v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1), [0, 1, 0], c);
  if (bottom) mb.quadFacing(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), [0, -1, 0], c);
}

/** Vertical prism with `n` sides (a low-poly cylinder), optionally tapering. */
export function cylinder(mb: MeshBuilder, x: number, z: number, r0: number, r1: number, y0: number, y1: number, c: Color, n = 6, cap = true) {
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const out: V3 = [Math.cos(am), 0, Math.sin(am)];
    mb.quadFacing(
      [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0],
      [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
      [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1],
      [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1],
      out,
      c,
    );
    if (cap && r1 > 0.001) mb.triFacing([x, y1, z], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [0, 1, 0], c);
  }
}

/** Low-poly blob (an icosahedron), stretched by (sx, sy, sz). */
export function blob(mb: MeshBuilder, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Color, jitter = 0) {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const len = Math.hypot(1, t);
  const pts = raw.map(([a, b, d], i): V3 => {
    const j = 1 + (jitter ? Math.sin(i * 12.9898 + jitter) * 0.12 : 0);
    return [x + (a / len) * sx * j, y + (b / len) * sy * j, z + (d / len) * sz * j];
  });
  const shade = [c, c.clone().offsetHSL(0, 0, -0.05), c.clone().offsetHSL(0, 0, 0.04)];
  faces.forEach(([a, b, d], k) => {
    const cx = (pts[a][0] + pts[b][0] + pts[d][0]) / 3 - x;
    const cy = (pts[a][1] + pts[b][1] + pts[d][1]) / 3 - y;
    const cz = (pts[a][2] + pts[b][2] + pts[d][2]) / 3 - z;
    mb.triFacing(pts[a], pts[b], pts[d], [cx, cy, cz], shade[k % 3]);
  });
}

// ---- Trees ------------------------------------------------------------------------
// Soft canopies of overlapping puffs whose normals bend toward the canopy
// center, shaded from a deep inner green to sunlit yellow-green on top.

const BARK = hex("#6e4b33");
const GREEN = {
  deep: hex("#2e6b3c"),
  mid: hex("#4f9a42"),
  sun: hex("#a8d95a"),
  cool: hex("#3f8f6a"),
  coolSun: hex("#8fd18a"),
  olive: hex("#5f8a3a"),
  oliveSun: hex("#c2d96a"),
};

/** A canopy of puffs around `c`: [dx, dy, dz, radius] offsets, shaded as one. */
function canopy(p: Parts, c: V3, puffs: [number, number, number, number][], bottom: Color, top: Color, seed: number, squash = 0.85) {
  puffs.forEach(([dx, dy, dz, r], k) =>
    puff(p.matte, [c[0] + dx, c[1] + dy, c[2] + dz], [r, r * squash, r], { canopy: c, bend: 0.6, bottom, top, seed: seed + k, lumps: 0.1 }),
  );
}

propCatalog.register("tree-oak", {
  solid: { r: 0.3 },
  build(p) {
    column(p.matte, 0, 0, 0.34, 0.2, 0, 3.6, BARK, 8, false);
    column(p.matte, 0.15, 0, 0.12, 0.06, 2.8, 4.4, BARK, 6, false);
    canopy(p, [0, 5.4, 0], [[0, 0.4, 0, 2.6], [1.6, -0.3, 0.6, 1.9], [-1.5, -0.2, -0.7, 1.9], [0.5, -0.2, -1.6, 1.7], [-0.6, -0.4, 1.5, 1.7], [0.2, 1.5, 0.2, 1.7]], GREEN.deep, GREEN.sun, 1);
  },
}, { tags: ["tree"] });

propCatalog.register("tree-plane", {
  solid: { r: 0.3 },
  build(p) {
    column(p.matte, 0, 0, 0.3, 0.2, 0, 4.6, hex("#9a8f72"), 8, false);
    canopy(p, [0, 6.6, 0], [[0, 0.3, 0, 2.8], [2.0, -0.4, 0.4, 2.0], [-2.0, -0.3, -0.3, 2.0], [0.3, -0.4, 2.0, 1.9], [-0.2, -0.3, -2.0, 1.9], [0, 1.5, 0, 1.8]], GREEN.cool, GREEN.coolSun, 4, 0.75);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-birch", {
  solid: { r: 0.2 },
  build(p) {
    column(p.matte, 0, 0, 0.18, 0.1, 0, 6.2, hex("#efeae0"), 7, false);
    canopy(p, [0, 6.0, 0], [[0, 0.8, 0, 1.5], [0.6, -0.4, 0.3, 1.3], [-0.5, -0.9, -0.3, 1.25], [0.1, -1.9, 0.2, 1.2], [0, 1.9, 0, 1.0]], GREEN.olive, GREEN.oliveSun, 6, 1.05);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-cherry", {
  solid: { r: 0.2 },
  build(p) {
    column(p.matte, 0, 0, 0.2, 0.13, 0, 2.6, BARK, 7, false);
    canopy(p, [0, 3.8, 0], [[0, 0.3, 0, 1.9], [1.2, -0.2, 0.4, 1.3], [-1.1, -0.1, -0.5, 1.3], [0.3, -0.2, -1.1, 1.2], [-0.3, 0.9, 0.6, 1.1]], hex("#c4628a"), hex("#ffd3e2"), 8, 0.8);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-pine", {
  solid: { r: 0.25 },
  build(p) {
    column(p.matte, 0, 0, 0.22, 0.14, 0, 2.2, BARK, 7, false);
    const tiers: [number, number, number][] = [[2.5, 1.4, 4.6], [2.0, 3.0, 6.2], [1.45, 4.6, 7.8], [0.9, 6.1, 9.0]];
    tiers.forEach(([r, y0, y1], k) => column(p.matte, 0, 0, r, 0, y0, y1, hex(k % 2 ? "#3f7f52" : "#356f49"), 10, false));
  },
}, { tags: ["tree"] });

// ---- Street furniture ----------------------------------------------------------------

const STEEL = hex("#3a3f45");
const LIGHT = hex("#fff1cf");
const TIMBER = hex("#a3734c");

propCatalog.register("lamp", {
  solid: { r: 0.15 },
  glows: true,
  light: { x: 0, z: 1.45, r: 8 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.1, 0.07, 0, 7, STEEL);
    block(p.metal, -0.05, 6.9, 0, 0.05, 7.0, 1.4, STEEL);
    block(p.metal, -0.25, 6.8, 1.1, 0.25, 6.95, 1.8, STEEL);
    block(p.glow, -0.2, 6.75, 1.15, 0.2, 6.8, 1.75, LIGHT, true);
  },
}, { tags: ["street"] });

propCatalog.register("lamp-post", {
  solid: { r: 0.15 },
  glows: true,
  light: { x: 0, z: 0, r: 5.5 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.12, 0.06, 0, 4.2, STEEL);
    cylinder(p.glow, 0, 0, 0.22, 0.22, 4.2, 4.7, LIGHT);
    cylinder(p.metal, 0, 0, 0.28, 0, 4.7, 4.95, STEEL);
  },
}, { tags: ["street", "park"] });

propCatalog.register("bench", {
  solid: { hx: 0.9, hz: 0.3 },
  build(p) {
    block(p.matte, -0.9, 0.42, -0.25, 0.9, 0.48, 0.25, TIMBER);
    block(p.matte, -0.9, 0.5, -0.3, 0.9, 0.9, -0.24, TIMBER);
    for (const x of [-0.75, 0.75]) block(p.metal, x - 0.04, 0, -0.25, x + 0.04, 0.48, 0.25, STEEL);
  },
}, { tags: ["street", "park"] });

propCatalog.register("bin", {
  solid: { r: 0.3 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.25, 0.28, 0, 0.95, hex("#2f5d4a"), 8);
    cylinder(p.metal, 0, 0, 0.3, 0.3, 0.95, 1.0, STEEL, 8);
  },
}, { tags: ["street", "park"] });

propCatalog.register("bollard", {
  solid: { r: 0.12 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.1, 0.1, 0, 0.9, STEEL, 6);
    cylinder(p.glow, 0, 0, 0.105, 0.105, 0.75, 0.82, LIGHT, 6, false);
  },
}, { tags: ["street"] });

propCatalog.register("bus-shelter", {
  solid: { hx: 1.6, hz: 0.7 },
  glows: true,
  build(p) {
    const glass = hex("#a9c3cf");
    for (const x of [-1.6, 1.6]) block(p.metal, x - 0.05, 0, -0.7, x + 0.05, 2.5, -0.6, STEEL);
    block(p.glass, -1.6, 0.1, -0.7, 1.6, 2.4, -0.66, glass);
    block(p.glass, -1.6, 0.1, -0.7, -1.56, 2.4, 0.5, glass);
    block(p.metal, -1.75, 2.5, -0.8, 1.75, 2.6, 0.7, STEEL);
    block(p.matte, -1.3, 0.45, -0.6, 1.3, 0.5, -0.25, TIMBER);
    block(p.glow, 0.9, 0.6, -0.64, 1.5, 2.0, -0.6, hex("#f6efe2"));
  },
}, { tags: ["street"] });

propCatalog.register("bus-stop-sign", {
  solid: { r: 0.1 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.05, 0.05, 0, 2.6, STEEL);
    block(p.glow, -0.3, 2.3, -0.02, 0.3, 2.8, 0.02, hex("#2f6e9e"));
  },
}, { tags: ["street"] });

propCatalog.register("bike-rack", {
  solid: { hx: 1.2, hz: 0.1 },
  build(p) {
    for (let k = 0; k < 4; k++) {
      const x = -0.9 + k * 0.6;
      block(p.metal, x - 0.02, 0, -0.35, x + 0.02, 0.8, -0.31, STEEL);
      block(p.metal, x - 0.02, 0, 0.31, x + 0.02, 0.8, 0.35, STEEL);
      block(p.metal, x - 0.02, 0.76, -0.35, x + 0.02, 0.8, 0.35, STEEL);
    }
  },
}, { tags: ["street"] });

propCatalog.register("street-sign", {
  solid: { r: 0.08 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.04, 0.04, 0, 3, STEEL);
    block(p.matte, -0.45, 2.7, -0.02, 0.45, 2.95, 0.02, hex("#1f5a3a"));
    block(p.matte, -0.02, 2.4, -0.45, 0.02, 2.65, 0.45, hex("#1f5a3a"));
  },
}, { tags: ["street"] });

propCatalog.register("traffic-light", {
  solid: { r: 0.15 },
  glows: true,
  build(p) {
    cylinder(p.metal, 0, 0, 0.09, 0.08, 0, 5.2, STEEL);
    block(p.metal, -0.05, 5.0, 0, 0.05, 5.1, 3.0, STEEL);
    block(p.metal, -0.22, 4.1, 2.6, 0.22, 5.0, 2.9, STEEL);
    block(p.glow, -0.12, 4.75, 2.9, 0.12, 4.9, 2.92, hex("#e04a3a"));
    block(p.glow, -0.12, 4.5, 2.9, 0.12, 4.65, 2.92, hex("#e8b33a"));
    block(p.glow, -0.12, 4.25, 2.9, 0.12, 4.4, 2.92, hex("#3fbf5a"));
    block(p.metal, -0.15, 2.2, 0.08, 0.15, 2.7, 0.3, STEEL);
  },
}, { tags: ["street"] });

propCatalog.register("hydrant", {
  solid: { r: 0.2 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.14, 0.12, 0, 0.6, hex("#c4392f"), 8);
    cylinder(p.metal, 0, 0, 0.12, 0.05, 0.6, 0.75, hex("#c4392f"), 8);
    block(p.metal, -0.2, 0.35, -0.05, 0.2, 0.43, 0.05, hex("#c4392f"));
  },
}, { tags: ["street"] });

propCatalog.register("planter", {
  solid: { hx: 0.6, hz: 0.6 },
  build(p) {
    block(p.matte, -0.6, 0, -0.6, 0.6, 0.6, 0.6, hex("#9a9184"));
    puff(p.matte, [0, 0.9, 0], [0.62, 0.45, 0.62], { bottom: GREEN.deep, top: GREEN.sun, seed: 11 });
  },
}, { tags: ["street", "park"] });

propCatalog.register("kiosk", {
  solid: { hx: 1.3, hz: 1.3 },
  glows: true,
  build(p) {
    block(p.matte, -1.2, 0, -1.2, 1.2, 2.6, 1.2, hex("#2f4a3a"));
    block(p.glass, -1.0, 1.0, 1.2, 1.0, 2.2, 1.22, hex("#a9c3cf"));
    block(p.matte, -1.5, 2.6, -1.5, 1.5, 2.8, 1.5, hex("#d9d3c5"));
    block(p.glow, -1.0, 2.25, 1.22, 1.0, 2.55, 1.25, hex("#f2e6c8"));
  },
}, { tags: ["street", "park"] });

propCatalog.register("scooter-dock", {
  build(p) {
    for (let k = 0; k < 3; k++) {
      const x = -0.8 + k * 0.8;
      block(p.metal, x - 0.06, 0.05, -0.4, x + 0.06, 0.12, 0.4, hex("#2fbf8a"));
      block(p.metal, x - 0.03, 0.12, 0.3, x + 0.03, 1.1, 0.36, STEEL);
      block(p.metal, x - 0.25, 1.05, 0.3, x + 0.25, 1.1, 0.36, STEEL);
    }
  },
}, { tags: ["street"] });

// ---- Park features ---------------------------------------------------------------------

propCatalog.register("fountain", {
  solid: { r: 3.2 },
  build(p) {
    cylinder(p.matte, 0, 0, 3.2, 3.2, 0, 0.55, hex("#d2cfc8"), 16);
    cylinder(p.glass, 0, 0, 2.9, 2.9, 0.5, 0.52, hex("#7fb7d4"), 16);
    cylinder(p.matte, 0, 0, 0.5, 0.4, 0, 1.6, hex("#d2cfc8"), 8);
    cylinder(p.glass, 0, 0, 0.3, 0.05, 1.6, 2.6, hex("#cfe8f4"), 8);
  },
}, { tags: ["park"] });

propCatalog.register("playground", {
  solid: { hx: 3, hz: 2.5 },
  build(p) {
    block(p.matte, -3, 0, -2.5, 3, 0.05, 2.5, hex("#d9a46a"));
    // Climbing frame with a slide.
    for (const [x, z] of [[-1.5, -1], [0, -1], [-1.5, 1], [0, 1]]) block(p.metal, x - 0.06, 0, z - 0.06, x + 0.06, 2.4, z + 0.06, hex("#c4573b"));
    block(p.matte, -1.6, 1.4, -1.1, 0.1, 1.5, 1.1, TIMBER);
    block(p.matte, -1.6, 2.4, -1.1, 0.1, 2.55, 1.1, hex("#2f6e9e"));
    p.metal.quadFacing([0.1, 1.45, -0.4], [0.1, 1.45, 0.4], [2.6, 0.1, 0.4], [2.6, 0.1, -0.4], [0.5, 1, 0], hex("#d9a441"));
    // Swing.
    block(p.metal, 1.4, 0, 1.4, 1.5, 2.2, 1.5, STEEL);
    block(p.metal, 2.8, 0, 1.4, 2.9, 2.2, 1.5, STEEL);
    block(p.metal, 1.4, 2.2, 1.4, 2.9, 2.3, 1.5, STEEL);
    block(p.matte, 1.9, 0.5, 1.3, 2.4, 0.55, 1.6, hex("#c4573b"));
  },
}, { tags: ["park"] });

propCatalog.register("court", {
  build(p) {
    block(p.matte, -7, 0, -12, 7, 0.04, 12, hex("#4f7fae"));
    block(p.matte, -6.6, 0.04, -0.05, 6.6, 0.05, 0.05, hex("#f2f1ee"));
    for (const z of [-11.6, 11.6]) block(p.matte, -6.6, 0.04, z - 0.05, 6.6, 0.05, z + 0.05, hex("#f2f1ee"));
    for (const x of [-6.6, 6.6]) block(p.matte, x - 0.05, 0.04, -11.6, x + 0.05, 0.05, 11.6, hex("#f2f1ee"));
    block(p.metal, -6.8, 0, -0.05, -6.7, 1.0, 0.05, STEEL);
    block(p.metal, 6.7, 0, -0.05, 6.8, 1.0, 0.05, STEEL);
    block(p.matte, -6.7, 0.8, -0.02, 6.7, 1.0, 0.02, hex("#f2f1ee"));
  },
}, { tags: ["park"] });

propCatalog.register("pavilion", {
  solid: { hx: 2.6, hz: 2.6 },
  build(p) {
    block(p.matte, -3, 0, -3, 3, 0.25, 3, hex("#d2cfc8"));
    for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) cylinder(p.matte, x, z, 0.15, 0.15, 0.25, 3.2, hex("#f2f1ee"));
    block(p.matte, -3.4, 3.2, -3.4, 3.4, 3.5, 3.4, hex("#f2f1ee"), true);
  },
}, { tags: ["park"] });

propCatalog.register("hedge", {
  solid: { hx: 2, hz: 0.5 },
  build(p) {
    for (let k = 0; k < 4; k++) puff(p.matte, [-1.5 + k, 0.62, 0], [0.7, 0.66, 0.58], { canopy: [0, 0.3, 0], bend: 0.7, bottom: GREEN.deep, top: GREEN.mid.clone().lerp(GREEN.sun, 0.4), seed: k + 30, lumps: 0.08 });
  },
}, { tags: ["park"] });

propCatalog.register("flower-bed", {
  build(p) {
    block(p.matte, -1.5, 0, -1, 1.5, 0.2, 1, hex("#6b5440"));
    const colors = ["#e04a6a", "#f2c84a", "#9a5ac4", "#f2f1ee"].map(hex);
    for (let k = 0; k < 8; k++) blob(p.matte, -1.1 + (k % 4) * 0.75, 0.35, -0.45 + Math.floor(k / 4) * 0.9, 0.3, 0.2, 0.3, colors[k % 4], k);
  },
}, { tags: ["park"] });

propCatalog.register("picnic-table", {
  solid: { hx: 1, hz: 0.8 },
  build(p) {
    block(p.matte, -1, 0.72, -0.4, 1, 0.78, 0.4, TIMBER);
    block(p.matte, -1, 0.42, -0.8, 1, 0.48, -0.55, TIMBER);
    block(p.matte, -1, 0.42, 0.55, 1, 0.48, 0.8, TIMBER);
    for (const x of [-0.8, 0.8]) block(p.matte, x - 0.05, 0, -0.75, x + 0.05, 0.72, 0.75, TIMBER);
  },
}, { tags: ["park"] });

// ---- Vehicles ------------------------------------------------------------------------

const TYRE = hex("#25282c");
const WINDOW = hex("#3d4b57");
export const CAR_COLORS: Record<string, string> = {
  white: "#eef0f0", silver: "#b9bec4", graphite: "#4a4f56", black: "#22262b",
  red: "#b8382f", blue: "#2f5d8f", green: "#4f7a5a", sand: "#cdb58a",
};
const CAR_TYPES: Record<string, { len: number; wid: number; body: number; cabin: [number, number, number]; box?: boolean }> = {
  // cabin: [start along z from the rear, length, height]
  sedan: { len: 4.5, wid: 1.8, body: 0.75, cabin: [1.1, 2.2, 0.55] },
  hatch: { len: 3.9, wid: 1.75, body: 0.8, cabin: [0.35, 2.3, 0.6] },
  suv: { len: 4.7, wid: 1.9, body: 0.95, cabin: [0.5, 3.0, 0.65] },
  van: { len: 5.2, wid: 2.0, body: 1.0, cabin: [0.2, 4.0, 1.0], box: true },
};

function car(p: Parts, type: (typeof CAR_TYPES)[string], paint: Color) {
  const hl = type.len / 2, hw = type.wid / 2, y0 = 0.32, y1 = y0 + type.body;
  block(p.metal, -hw, y0, -hl, hw, y1, hl, paint);
  const [c0, cl, ch] = type.cabin;
  const z0 = -hl + c0, z1 = z0 + cl;
  // Glass band with a painted roof on top.
  block(p.glass, -hw + 0.08, y1, z0, hw - 0.08, y1 + ch * 0.85, z1, WINDOW);
  block(p.metal, -hw + 0.1, y1 + ch * 0.85, z0 + (type.box ? 0 : 0.1), hw - 0.1, y1 + ch, z1 - (type.box ? 0 : 0.15), paint);
  for (const [x, z] of [[-hw + 0.02, -hl + 0.75], [hw - 0.02, -hl + 0.75], [-hw + 0.02, hl - 0.8], [hw - 0.02, hl - 0.8]]) {
    block(p.matte, x - 0.12, 0, z - 0.33, x + 0.12, 0.62, z + 0.33, TYRE);
  }
  // Head and tail lights (+z is the front); parked, so not lit.
  block(p.matte, -hw + 0.15, y1 - 0.25, hl, -hw + 0.5, y1 - 0.1, hl + 0.02, hex("#fff6dc"));
  block(p.matte, hw - 0.5, y1 - 0.25, hl, hw - 0.15, y1 - 0.1, hl + 0.02, hex("#fff6dc"));
  block(p.matte, -hw + 0.1, y1 - 0.22, -hl - 0.02, -hw + 0.45, y1 - 0.1, -hl, hex("#d0392f"));
  block(p.matte, hw - 0.45, y1 - 0.22, -hl - 0.02, hw - 0.1, y1 - 0.1, -hl, hex("#d0392f"));
}

for (const [tname, type] of Object.entries(CAR_TYPES)) {
  for (const [cname, color] of Object.entries(CAR_COLORS)) {
    propCatalog.register(`car-${tname}-${cname}`, {
      solid: { hx: type.wid / 2, hz: type.len / 2 },
      build: (p) => car(p, type, hex(color)),
    }, { tags: ["car", tname] });
  }
}

propCatalog.register("truck", {
  solid: { hx: 1.25, hz: 5.5 },
  build(p) {
    const cab = hex("#e7e4dc");
    block(p.metal, -1.2, 0.5, 3.0, 1.2, 3.0, 5.5, cab);
    block(p.glass, -1.15, 1.9, 5.5, 1.15, 2.8, 5.52, WINDOW);
    block(p.metal, -1.25, 0.9, -5.5, 1.25, 3.9, 2.8, hex("#c9cdd1"));
    block(p.metal, -1.2, 0.5, -5.5, 1.2, 0.9, 5.4, STEEL);
    for (const z of [-4.4, -3.2, 4.2]) for (const x of [-1.15, 1.15]) block(p.matte, x - 0.15, 0, z - 0.5, x + 0.15, 1.0, z + 0.5, TYRE);
  },
}, { tags: ["vehicle", "yard"] });

for (const [name, color] of Object.entries({ rust: "#9b4a33", blue: "#2f6397", green: "#3e7a5c", grey: "#8d949b" })) {
  propCatalog.register(`container-${name}`, {
    solid: { hx: 1.22, hz: 3.05 },
    build(p) {
      const c = hex(color);
      block(p.metal, -1.22, 0, -3.05, 1.22, 2.6, 3.05, c);
      for (let k = 0; k < 9; k++) block(p.metal, -1.25, 0.05, -2.8 + k * 0.7, 1.25, 2.55, -2.7 + k * 0.7, c.clone().offsetHSL(0, 0, -0.06));
    },
  }, { tags: ["yard"] });
}

propCatalog.register("pallets", {
  solid: { hx: 0.6, hz: 0.6 },
  build(p) {
    block(p.matte, -0.6, 0, -0.6, 0.6, 0.15, 0.6, TIMBER);
    block(p.matte, -0.55, 0.15, -0.55, 0.55, 1.1, 0.55, hex("#c9b48e"));
  },
}, { tags: ["yard"] });

// ---- Gardens -------------------------------------------------------------------------

propCatalog.register("shed", {
  solid: { hx: 1.3, hz: 1.0 },
  build(p) {
    block(p.matte, -1.3, 0, -1, 1.3, 2.1, 1, hex("#7b6650"));
    block(p.matte, -1.45, 2.1, -1.15, 1.45, 2.25, 1.15, hex("#3e4247"));
    block(p.matte, -0.4, 0, 1, 0.4, 1.9, 1.04, hex("#5c4a39"));
  },
}, { tags: ["garden"] });

propCatalog.register("parasol-table", {
  solid: { r: 0.5 },
  build(p) {
    block(p.matte, -0.5, 0.7, -0.5, 0.5, 0.75, 0.5, hex("#efece6"));
    cylinder(p.metal, 0, 0, 0.04, 0.04, 0, 2.3, STEEL, 4);
    cylinder(p.matte, 0, 0, 1.5, 0.05, 1.95, 2.35, hex("#e6dccb"), 8);
    for (const [x, z] of [[-0.85, 0], [0.85, 0]]) block(p.matte, x - 0.22, 0, z - 0.22, x + 0.22, 0.45, z + 0.22, hex("#efece6"));
  },
}, { tags: ["garden", "cafe"] });

propCatalog.register("shrub", {
  build(p) {
    canopy(p, [0, 0.6, 0], [[0, 0, 0, 0.75], [0.45, -0.1, 0.2, 0.5], [-0.4, -0.12, -0.25, 0.5]], GREEN.deep, GREEN.sun, 11, 0.8);
  },
}, { tags: ["garden", "park"] });

propCatalog.register("trampoline", {
  solid: { r: 1.7 },
  build(p) {
    cylinder(p.matte, 0, 0, 1.7, 1.7, 0.75, 0.85, hex("#2f3439"), 10);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      block(p.metal, Math.cos(a) * 1.6 - 0.04, 0, Math.sin(a) * 1.6 - 0.04, Math.cos(a) * 1.6 + 0.04, 0.8, Math.sin(a) * 1.6 + 0.04, STEEL);
    }
  },
}, { tags: ["garden"] });

propCatalog.register("reeds", {
  build(p) {
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4, r = 0.2 + (k % 3) * 0.25;
      cylinder(p.matte, Math.cos(a) * r, Math.sin(a) * r, 0.05, 0, 0, 1.0 + (k % 3) * 0.3, hex("#7d9a4e"), 3, false);
    }
  },
}, { tags: ["park", "water"] });

propCatalog.register("rock", {
  solid: { r: 0.7 },
  build(p) {
    blob(p.matte, 0, 0.25, 0, 0.9, 0.55, 0.7, hex("#a39d92"), 13);
  },
}, { tags: ["park"] });

propCatalog.register("sculpture", {
  solid: { r: 1.0 },
  build(p) {
    block(p.matte, -1, 0, -1, 1, 0.6, 1, hex("#d8d2c6"));
    cylinder(p.metal, 0, 0, 0.35, 0.05, 0.6, 4.2, hex("#b97a46"), 5);
    blob(p.metal, 0, 3.2, 0, 0.8, 0.8, 0.8, hex("#c9894f"), 14);
  },
}, { tags: ["plaza", "park"] });

propCatalog.register("table-chairs", {
  solid: { r: 0.8 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.06, 0.06, 0, 0.72, STEEL, 4);
    cylinder(p.metal, 0, 0, 0.4, 0.4, 0.72, 0.76, hex("#e9e6df"), 8);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const x = Math.cos(a) * 0.7, z = Math.sin(a) * 0.7;
      block(p.metal, x - 0.2, 0.42, z - 0.2, x + 0.2, 0.46, z + 0.2, hex("#3d5a52"));
      block(p.metal, x - 0.03, 0, z - 0.03, x + 0.03, 0.42, z + 0.03, STEEL);
    }
  },
}, { tags: ["cafe", "plaza"] });

// ---- Transit and eco ---------------------------------------------------------------------

propCatalog.register("tram", {
  solid: { hx: 1.35, hz: 15 },
  glows: true,
  build(p) {
    const body = hex("#e9e4d6"), stripe = hex("#2f7a5a"), win = hex("#3d4b57");
    for (const z0 of [-15, -4.7, 5.6]) {
      const z1 = z0 + 9.4;
      block(p.metal, -1.32, 0.35, z0, 1.32, 3.3, z1, body);
      block(p.glass, -1.34, 1.15, z0 + 0.4, 1.34, 2.45, z1 - 0.4, win);
      block(p.metal, -1.35, 0.6, z0, 1.35, 1.0, z1, stripe);
      block(p.matte, -1.0, 3.3, z0 + 1, 1.0, 3.55, z1 - 1, hex("#9aa0a6"));
    }
    // Pantograph and the lit destination sign.
    block(p.metal, -0.6, 3.55, -1, 0.6, 3.6, 1, STEEL);
    block(p.metal, -0.05, 3.6, -0.05, 0.05, 5.4, 0.05, STEEL);
    block(p.glow, -0.8, 2.6, 15, 0.8, 3.0, 15.05, hex("#ffb84a"));
    block(p.glow, -0.8, 2.6, -15.05, 0.8, 3.0, -15, hex("#ffb84a"));
  },
}, { tags: ["transit"] });

propCatalog.register("catenary-pole", {
  solid: { r: 0.15 },
  build(p) {
    cylinder(p.metal, 0, 0, 0.14, 0.1, 0, 6.6, STEEL);
    block(p.metal, -2.4, 6.2, -0.04, 2.4, 6.28, 0.04, STEEL);
    for (const x of [-1.55, 1.55]) block(p.metal, x - 0.02, 5.6, -0.02, x + 0.02, 6.2, 0.02, STEEL);
  },
}, { tags: ["transit"] });

propCatalog.register("tram-stop", {
  solid: { hx: 2.6, hz: 0.6 },
  glows: true,
  light: { x: 0, z: 0.3, r: 4 },
  build(p) {
    const glass = hex("#a9c3cf");
    block(p.matte, -6, 0, -0.9, 6, 0.12, 1.0, hex("#c9c4ba"));
    for (const x of [-2.6, 2.6]) block(p.metal, x - 0.05, 0, -0.6, x + 0.05, 2.6, -0.5, STEEL);
    block(p.glass, -2.6, 0.2, -0.62, 2.6, 2.45, -0.58, glass);
    block(p.metal, -2.9, 2.6, -0.8, 2.9, 2.72, 0.9, hex("#2f7a5a"));
    p.glass.quadFacing([-2.8, 2.73, -0.7], [2.8, 2.73, -0.7], [2.8, 2.73, 0.8], [-2.8, 2.73, 0.8], [0, 1, 0], SOLAR);
    block(p.matte, -2.0, 0.45, -0.55, 2.0, 0.5, -0.25, TIMBER);
    block(p.glow, 3.4, 2.0, -0.05, 4.0, 2.6, 0.05, hex("#2f7a5a"));
    block(p.metal, 3.66, 0, -0.03, 3.74, 2.0, 0.03, STEEL);
  },
}, { tags: ["transit"] });

const SOLAR = hex("#25324a");

propCatalog.register("solar-canopy", {
  solid: { hx: 0.2, hz: 0.2 },
  build(p) {
    for (const x of [-4, 4]) block(p.metal, x - 0.12, 0, -0.12, x + 0.12, 3.2, 0.12, STEEL);
    block(p.metal, -5, 3.2, -0.15, 5, 3.35, 0.15, STEEL);
    p.glass.quadFacing([-5.5, 3.0, -2.6], [5.5, 3.0, -2.6], [5.5, 3.7, 2.6], [-5.5, 3.7, 2.6], [0, 1, 0], SOLAR);
    p.metal.quadFacing([-5.5, 3.0, -2.6], [5.5, 3.0, -2.6], [5.5, 3.7, 2.6], [-5.5, 3.7, 2.6], [0, -1, 0], hex("#9aa0a6"));
  },
}, { tags: ["eco"] });

propCatalog.register("wind-turbine", {
  solid: { r: 0.4 },
  build(p) {
    const white = hex("#eef0f0");
    cylinder(p.metal, 0, 0, 0.45, 0.22, 0, 18, white, 10);
    block(p.metal, -0.35, 17.6, -0.6, 0.35, 18.4, 1.0, white);
    // Three blades in the plane facing +z.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      const tip: V3 = [Math.cos(a) * 7, 18 + Math.sin(a) * 7, 1.05];
      const side: V3 = [-Math.sin(a) * 0.35, Math.cos(a) * 0.35, 0];
      p.matte.quadFacing([side[0], 18 + side[1], 1.05], [-side[0], 18 - side[1], 1.05], [tip[0] - side[0] * 0.3, tip[1] - side[1] * 0.3, 1.05], [tip[0] + side[0] * 0.3, tip[1] + side[1] * 0.3, 1.05], [0, 0, 1], white);
      p.matte.quadFacing([side[0], 18 + side[1], 1.05], [-side[0], 18 - side[1], 1.05], [tip[0] - side[0] * 0.3, tip[1] - side[1] * 0.3, 1.05], [tip[0] + side[0] * 0.3, tip[1] + side[1] * 0.3, 1.05], [0, 0, -1], white);
    }
  },
}, { tags: ["eco"] });

propCatalog.register("veg-bed", {
  solid: { hx: 1.3, hz: 0.65 },
  build(p) {
    block(p.matte, -1.3, 0, -0.65, 1.3, 0.45, 0.65, TIMBER);
    block(p.matte, -1.2, 0.45, -0.55, 1.2, 0.5, 0.55, hex("#5a4632"));
    const greens = ["#6f9e4f", "#8fbf5a", "#557f3e", "#a7c95f"].map(hex);
    for (let k = 0; k < 6; k++) blob(p.matte, -0.85 + (k % 3) * 0.85, 0.65, -0.25 + Math.floor(k / 3) * 0.5, 0.32, 0.22, 0.25, greens[k % 4], k + 20);
  },
}, { tags: ["eco", "garden"] });

propCatalog.register("greenhouse", {
  solid: { hx: 2, hz: 3 },
  build(p) {
    const glass = hex("#cfe3e8");
    block(p.matte, -2, 0, -3, 2, 0.4, 3, hex("#d2cfc8"));
    block(p.glass, -2, 0.4, -3, 2, 2.2, 3, glass);
    p.glass.quadFacing([-2, 2.2, -3], [0, 3.2, -3], [0, 3.2, 3], [-2, 2.2, 3], [-1, 2, 0], glass);
    p.glass.quadFacing([2, 2.2, -3], [0, 3.2, -3], [0, 3.2, 3], [2, 2.2, 3], [1, 2, 0], glass);
    for (const z of [-3, -1, 1, 3]) block(p.metal, -2.02, 0.4, z - 0.03, 2.02, 2.25, z + 0.03, hex("#eef0f0"));
  },
}, { tags: ["eco", "garden"] });

propCatalog.register("bike-share", {
  solid: { hx: 3, hz: 0.5 },
  build(p) {
    block(p.metal, -3, 0, -0.08, 3, 0.9, 0.08, hex("#2f7a5a"));
    for (let k = 0; k < 7; k++) {
      const x = -2.6 + k * 0.85;
      block(p.matte, x - 0.03, 0.05, -0.9, x + 0.03, 0.75, 0.6, hex("#2f3439"));
      block(p.metal, x - 0.04, 0.55, -0.3, x + 0.04, 0.62, 0.3, hex("#d9e34a"));
    }
  },
}, { tags: ["eco", "street"] });

// ---- Templates -------------------------------------------------------------------------

export interface PropTemplate {
  parts: Partial<Record<Slot, RawMesh>>;
  def: PropDef;
}

const templates = new Map<string, PropTemplate>();

/** The prebuilt geometry for a prop kind, or undefined for unknown kinds. */
export function templateFor(kind: string): PropTemplate | undefined {
  let t = templates.get(kind);
  if (t) return t;
  const def = propCatalog.get(kind);
  if (!def) return undefined;
  const p = newParts();
  def.build(p);
  t = { def, parts: {} };
  for (const slot of Object.keys(p) as Slot[]) if (p[slot].triangleCount) t.parts[slot] = p[slot].raw();
  templates.set(kind, t);
  return t;
}
