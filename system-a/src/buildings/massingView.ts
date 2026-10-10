/**
 * Placeholder building massing: extruded footprints with simple roofs, merged
 * into one mesh. Milestone 2 replaces this with the parametric building generator.
 */
import { Color, Mesh, MeshStandardMaterial, ShapeUtils, Vector2 } from "three";
import { Building, type BuildingData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { signedArea, type P2 } from "../geom/polygon";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { addToScene } from "../render/renderPlugin";

const STYLE_COLORS: Record<string, string> = {
  "glass-tower": "#9db6c8",
  office: "#c8c2b6",
  "brick-midrise": "#c28b6c",
  apartment: "#e2d7c1",
  "suburban-house": "#f1e9d9",
  civic: "#ebe4d2",
  industrial: "#b8b4aa",
  default: "#d8d3ca",
};
const ROOF_COLORS: Record<string, string> = {
  "suburban-house": "#a65d4a",
  default: "#8f8a82",
};
/** Walls start this far below the pad so slopes never show a gap. */
const FOUNDATION = 2;

export function massingView(): Plugin {
  return {
    name: "massing-view",
    install(engine) {
      engine.addSystem({
        name: "massing-view",
        onLoad(world) {
          const mb = new MeshBuilder();
          for (const e of world.query(Building)) addMassing(mb, world.read(e, Building));
          if (mb.triangleCount === 0) return;
          const mesh = new Mesh(mb.build(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.name = "buildings-massing";
          addToScene(world, mesh);
        },
      });
    },
  };
}

function shade(hex: string, seed: number, amount: number): Color {
  const c = new Color(hex);
  const t = (((seed >>> 0) % 1000) / 1000 - 0.5) * 2 * amount;
  return c.offsetHSL(0, 0, t);
}

export function addMassing(mb: MeshBuilder, b: BuildingData): void {
  // Clockwise in x/z so `quadFacing` hints and wall order agree (see MeshBuilder).
  const fp: P2[] = signedArea(b.footprint) > 0 ? [...b.footprint].reverse() : [...b.footprint];
  const wall = shade(STYLE_COLORS[b.style] ?? STYLE_COLORS.default, b.seed, 0.06);
  const roofColor = shade(ROOF_COLORS[b.style] ?? ROOF_COLORS.default, b.seed >> 3, 0.05);
  const y0 = b.baseY - FOUNDATION;
  const y1 = b.baseY + b.floors * b.floorHeight;
  const cx = fp.reduce((s, p) => s + p[0], 0) / fp.length;
  const cz = fp.reduce((s, p) => s + p[1], 0) / fp.length;

  for (let k = 0; k < fp.length; k++) {
    const [ax, az] = fp[k];
    const [bx, bz] = fp[(k + 1) % fp.length];
    const out: V3 = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    mb.quadFacing([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], out, wall);
  }

  const pitched = (b.roof === "gable" || b.roof === "hip") && fp.length === 4;
  if (pitched) pitchedRoof(mb, fp, y1, b.roof === "hip", roofColor, wall);
  else flatRoof(mb, fp, y1, roofColor);
}

function flatRoof(mb: MeshBuilder, fp: P2[], y: number, color: Color) {
  const contour = fp.map(([x, z]) => new Vector2(x, z));
  for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
    mb.triFacing([fp[i][0], y, fp[i][1]], [fp[j][0], y, fp[j][1]], [fp[k][0], y, fp[k][1]], [0, 1, 0], color);
  }
}

/** Gable or hip roof over a quad footprint; the ridge runs along the longer axis. */
function pitchedRoof(mb: MeshBuilder, fp: P2[], y: number, hip: boolean, color: Color, gableColor: Color) {
  const len = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Rotate so edges 0-1 and 2-3 are the long sides.
  const q = len(fp[0], fp[1]) >= len(fp[1], fp[2]) ? fp : [fp[1], fp[2], fp[3], fp[0]];
  const [p0, p1, p2, p3] = q;
  const span = (len(p1, p2) + len(p3, p0)) / 2;
  const rise = span * 0.45;
  const mid = (a: P2, b: P2): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let r0 = mid(p3, p0);
  let r1 = mid(p1, p2);
  if (hip) {
    const ridgeLen = len(r0, r1);
    const inset = Math.min(span / 2, ridgeLen * 0.45);
    const ux = (r1[0] - r0[0]) / ridgeLen, uz = (r1[1] - r0[1]) / ridgeLen;
    r0 = [r0[0] + ux * inset, r0[1] + uz * inset];
    r1 = [r1[0] - ux * inset, r1[1] - uz * inset];
  }
  const v = (p: P2, h = y): V3 => [p[0], h, p[1]];
  const R0 = v(r0, y + rise), R1 = v(r1, y + rise);
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cz = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const outward = (a: P2, b: P2): V3 => [(a[0] + b[0]) / 2 - cx, 0.5, (a[1] + b[1]) / 2 - cz];
  // Long slopes.
  mb.quadFacing(v(p0), v(p1), R1, R0, outward(p0, p1), color);
  mb.quadFacing(v(p2), v(p3), R0, R1, outward(p2, p3), color);
  // Ends: triangular gables (wall color) or hipped slopes (roof color).
  mb.triFacing(v(p1), v(p2), R1, outward(p1, p2), hip ? color : gableColor);
  mb.triFacing(v(p3), v(p0), R0, outward(p3, p0), hip ? color : gableColor);
}
