/**
 * Prop catalog: street furniture, trees and park features. Each prop is a
 * small low-poly model in local coordinates (meters, y up, front facing +z),
 * built once into a template and stamped wherever it is placed.
 */
import { Color } from "three";
import { Catalog } from "../catalog/registry";
import { newParts, type Parts, type Slot } from "../buildings/kit";
import type { MeshBuilder, V3 } from "../render/meshBuilder";

export interface PropDef {
  build(p: Parts): void;
  /** Footprint half-size for collision (circle or box half-extents); omit for walk-through. */
  solid?: { r?: number; hx?: number; hz?: number };
  /** Lit at night (lamps, signs). */
  glows?: boolean;
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

const BARK = hex("#6b5440");
const LEAF = ["#6f9e4f", "#5e8f45", "#7aa957", "#557f3e"].map(hex);

propCatalog.register("tree-oak", {
  solid: { r: 0.3 },
  build(p) {
    cylinder(p.matte, 0, 0, 0.28, 0.2, 0, 3.2, BARK);
    blob(p.matte, 0, 5.2, 0, 3.0, 2.6, 3.0, LEAF[0], 1);
    blob(p.matte, 1.2, 4.4, 0.6, 1.8, 1.5, 1.8, LEAF[1], 2);
    blob(p.matte, -1.1, 4.6, -0.8, 1.7, 1.5, 1.7, LEAF[2], 3);
  },
}, { tags: ["tree"] });

propCatalog.register("tree-plane", {
  solid: { r: 0.3 },
  build(p) {
    cylinder(p.matte, 0, 0, 0.26, 0.2, 0, 4.2, hex("#8f8a72"));
    blob(p.matte, 0, 6.6, 0, 3.4, 2.4, 3.4, LEAF[3], 4);
    blob(p.matte, 0.9, 5.6, 0.8, 2.2, 1.6, 2.2, LEAF[0], 5);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-birch", {
  solid: { r: 0.2 },
  build(p) {
    cylinder(p.matte, 0, 0, 0.16, 0.1, 0, 5.5, hex("#e8e4dc"));
    blob(p.matte, 0, 5.8, 0, 1.6, 2.6, 1.6, LEAF[2], 6);
    blob(p.matte, 0.4, 4.4, 0.2, 1.3, 1.6, 1.3, LEAF[0], 7);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-cherry", {
  solid: { r: 0.2 },
  build(p) {
    cylinder(p.matte, 0, 0, 0.18, 0.13, 0, 2.4, BARK);
    blob(p.matte, 0, 3.6, 0, 2.2, 1.6, 2.2, hex("#e9a7b8"), 8);
    blob(p.matte, 0.8, 3.2, 0.5, 1.3, 1.0, 1.3, hex("#f1bccb"), 9);
  },
}, { tags: ["tree", "street-tree"] });

propCatalog.register("tree-pine", {
  solid: { r: 0.25 },
  build(p) {
    cylinder(p.matte, 0, 0, 0.2, 0.15, 0, 2, BARK);
    for (let k = 0; k < 3; k++) cylinder(p.matte, 0, 0, 2.2 - k * 0.55, 0, 1.6 + k * 1.6, 4.4 + k * 1.6, hex("#3f6b46"), 7, false);
  },
}, { tags: ["tree"] });

// ---- Street furniture ----------------------------------------------------------------

const STEEL = hex("#3a3f45");
const LIGHT = hex("#fff1cf");
const TIMBER = hex("#a3734c");

propCatalog.register("lamp", {
  solid: { r: 0.15 },
  glows: true,
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
    blob(p.matte, 0, 0.85, 0, 0.6, 0.45, 0.6, LEAF[1], 11);
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
    block(p.glow, -6.6, 0.04, -0.05, 6.6, 0.05, 0.05, hex("#f2f1ee"));
    for (const z of [-11.6, 11.6]) block(p.glow, -6.6, 0.04, z - 0.05, 6.6, 0.05, z + 0.05, hex("#f2f1ee"));
    for (const x of [-6.6, 6.6]) block(p.glow, x - 0.05, 0.04, -11.6, x + 0.05, 0.05, 11.6, hex("#f2f1ee"));
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
    block(p.matte, -2, 0, -0.5, 2, 1.2, 0.5, hex("#4f7f3e"));
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

// ---- Templates -------------------------------------------------------------------------

export interface PropTemplate {
  parts: Partial<Record<Slot, { pos: number[]; col: number[] }>>;
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
