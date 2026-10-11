import { Color, Mesh, MeshStandardMaterial } from "three";
import { stylize } from "../render/style";
import type { Entity } from "../ecs/world";
import { RoadEdge, RoadNode } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { addToScene } from "../render/renderPlugin";
import { densify, edgePath, type P3 } from "./path";

const C = {
  asphalt: new Color("#787c83"),
  highway: new Color("#6c7077"),
  sidewalk: new Color("#cdc8bf"),
  curb: new Color("#a9a49b"),
  marking: new Color("#f2efe6"),
  centre: new Color("#e8c45a"),
  bike: new Color("#6f8f6a"),
  trackBed: new Color("#7f9f62"),
  rail: new Color("#8d9196"),
  sleeper: new Color("#6b6259"),
  deck: new Color("#b9b5ad"),
  railing: new Color("#3a3f45"),
};

/** Heights above the graded terrain, in meters. */
const ASPHALT_Y = 0.08;
const SIDEWALK_Y = 0.22;
const MARK_Y = 0.1;
const UP: V3 = [0, 1, 0];

export function roadView(): Plugin {
  return {
    name: "road-view",
    install(engine) {
      engine.addSystem({
        name: "road-view",
        onLoad(world) {
          const mb = new MeshBuilder();
          // Junction radius per node: the widest carriageway meeting there.
          const junction = new Map<Entity, number>();
          const degree = new Map<Entity, number>();
          for (const e of world.query(RoadEdge)) {
            const r = world.read(e, RoadEdge);
            for (const n of [r.a, r.b]) {
              junction.set(n, Math.max(junction.get(n) ?? 0, r.width / 2));
              degree.set(n, (degree.get(n) ?? 0) + 1);
            }
          }

          for (const e of world.query(RoadEdge)) {
            const r = world.read(e, RoadEdge);
            const path = densify(edgePath(world, r), 6);
            const half = r.width / 2;
            ribbon(mb, path, -half, half, ASPHALT_Y, r.kind === "highway" ? C.highway : C.asphalt);
            // Sidewalks and markings stop short of junctions so crossings stay clear.
            const trimA = (degree.get(r.a) ?? 0) > 1 ? (junction.get(r.a) ?? 0) + r.sidewalk : 0;
            const trimB = (degree.get(r.b) ?? 0) > 1 ? (junction.get(r.b) ?? 0) + r.sidewalk : 0;
            const inner = trim(path, trimA, trimB);
            if (inner && r.sidewalk > 0) {
              ribbon(mb, inner, half, half + r.sidewalk, SIDEWALK_Y, C.sidewalk);
              ribbon(mb, inner, -half - r.sidewalk, -half, SIDEWALK_Y, C.sidewalk);
              curb(mb, inner, half);
              curb(mb, inner, -half);
            }
            if (r.kind === "street" || r.kind === "avenue") {
              const L = length(path);
              // Crossings and stop lines just outside each junction.
              for (const [atA, n] of [[true, r.a], [false, r.b]] as const) {
                if ((degree.get(n) ?? 0) < 3) continue;
                const j = junction.get(n) ?? 0;
                const from = (d: number) => (atA ? d : L - d);
                const zebra = section(path, from(j + 0.4), from(j + 2.8));
                if (zebra) for (let o = -half + 0.5; o + 0.5 <= half - 0.3; o += 1.1) ribbon(mb, zebra, o, o + 0.55, MARK_Y, C.marking);
                const stop = section(path, from(j + 3.4), from(j + 3.75));
                // Traffic drives on the right: the stop line spans the approaching half.
                if (stop) ribbon(mb, stop, atA ? -half + 0.3 : 0, atA ? 0 : half - 0.3, MARK_Y, C.marking);
              }
              const lined = trim(path, (degree.get(r.a) ?? 0) > 2 ? (junction.get(r.a) ?? 0) + 4 : 0, (degree.get(r.b) ?? 0) > 2 ? (junction.get(r.b) ?? 0) + 4 : 0);
              if (lined && r.tram) {
                // Grass track bed with two tracks; no centre line.
                tracks(mb, lined);
              } else if (lined && r.kind === "avenue") {
                // Double centre line, dashed lane dividers, bike lanes at the curb.
                ribbon(mb, lined, -0.25, -0.1, MARK_Y, C.centre);
                ribbon(mb, lined, 0.1, 0.25, MARK_Y, C.centre);
                const bike = Math.min(1.8, half * 0.25);
                const lane = (half - bike) / 2;
                dashes(mb, lined, lane);
                dashes(mb, lined, -lane);
                for (const sgn of [1, -1]) {
                  ribbon(mb, lined, sgn > 0 ? half - bike : -half, sgn > 0 ? half : -half + bike, MARK_Y - 0.005, C.bike);
                  ribbon(mb, lined, sgn * (half - bike) - 0.08, sgn * (half - bike) + 0.08, MARK_Y, C.marking);
                }
              } else if (lined) dashes(mb, lined, 0);
            }
            if (r.tram && r.kind !== "street" && r.kind !== "avenue") tracks(mb, path);
            if (r.bridge) bridge(mb, path, half + r.sidewalk);
          }

          for (const [n, radius] of junction) {
            if ((degree.get(n) ?? 0) < 2) continue;
            const { x, y, z } = world.read(n, RoadNode);
            disc(mb, x, y + ASPHALT_Y + 0.005, z, radius, C.asphalt);
          }

          const mesh = new Mesh(
            mb.build(),
            stylize(new MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.95,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            }), { edges: false, paint: 1.2, rim: 0.3, paving: 1.2 }),
          );
          mesh.receiveShadow = true;
          mesh.name = "roads";
          addToScene(world, mesh);
        },
      });
    },
  };
}

/** Unit perpendicular (pointing right of travel) at each path point. */
function normals(path: P3[]): [number, number][] {
  return path.map((_, k) => {
    const p = path[Math.max(0, k - 1)];
    const q = path[Math.min(path.length - 1, k + 1)];
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const len = Math.hypot(dx, dz) || 1;
    return [-dz / len, dx / len];
  });
}

/** Strip between signed offsets `o0` and `o1` from the centerline. */
function ribbon(mb: MeshBuilder, path: P3[], o0: number, o1: number, lift: number, color: Color) {
  const ns = normals(path);
  for (let k = 1; k < path.length; k++) {
    const p = path[k - 1], q = path[k];
    const np = ns[k - 1], nq = ns[k];
    const a: V3 = [p[0] + np[0] * o0, p[1] + lift, p[2] + np[1] * o0];
    const b: V3 = [p[0] + np[0] * o1, p[1] + lift, p[2] + np[1] * o1];
    const c: V3 = [q[0] + nq[0] * o1, q[1] + lift, q[2] + nq[1] * o1];
    const d: V3 = [q[0] + nq[0] * o0, q[1] + lift, q[2] + nq[1] * o0];
    mb.quadFacing(a, b, c, d, UP, color);
  }
}

function curb(mb: MeshBuilder, path: P3[], offset: number) {
  const ns = normals(path);
  for (let k = 1; k < path.length; k++) {
    const p = path[k - 1], q = path[k];
    const np = ns[k - 1], nq = ns[k];
    const out: V3 = [-np[0] * Math.sign(offset), 0, -np[1] * Math.sign(offset)];
    mb.quadFacing(
      [p[0] + np[0] * offset, p[1] + ASPHALT_Y, p[2] + np[1] * offset],
      [q[0] + nq[0] * offset, q[1] + ASPHALT_Y, q[2] + nq[1] * offset],
      [q[0] + nq[0] * offset, q[1] + SIDEWALK_Y, q[2] + nq[1] * offset],
      [p[0] + np[0] * offset, p[1] + SIDEWALK_Y, p[2] + np[1] * offset],
      out,
      C.curb,
    );
  }
}

/** Two tram tracks on a grass bed down the middle of the road. */
function tracks(mb: MeshBuilder, path: P3[]) {
  ribbon(mb, path, -3.1, 3.1, MARK_Y - 0.006, C.trackBed);
  for (const c of [-1.55, 1.55]) {
    for (const g of [-0.72, 0.72]) {
      ribbon(mb, path, c + g - 0.04, c + g + 0.04, MARK_Y + 0.05, C.rail);
      curbFace(mb, path, c + g - 0.04, MARK_Y - 0.006, MARK_Y + 0.05);
      curbFace(mb, path, c + g + 0.04, MARK_Y - 0.006, MARK_Y + 0.05);
    }
  }
}

/** A vertical strip along the path at a signed offset, between two heights. */
function curbFace(mb: MeshBuilder, path: P3[], offset: number, y0: number, y1: number, color = C.rail) {
  const ns = normals(path);
  for (let k = 1; k < path.length; k++) {
    const p = path[k - 1], q = path[k];
    const np = ns[k - 1], nq = ns[k];
    const a: V3 = [p[0] + np[0] * offset, p[1] + y0, p[2] + np[1] * offset];
    const b: V3 = [q[0] + nq[0] * offset, q[1] + y0, q[2] + nq[1] * offset];
    const c: V3 = [q[0] + nq[0] * offset, q[1] + y1, q[2] + nq[1] * offset];
    const d: V3 = [p[0] + np[0] * offset, p[1] + y1, p[2] + np[1] * offset];
    mb.quadFacing(a, b, c, d, [np[0], 0, np[1]], color);
    mb.quadFacing(a, b, c, d, [-np[0], 0, -np[1]], color);
  }
}

/** Deck edges and railings for a bridge `half` meters to each side. */
function bridge(mb: MeshBuilder, path: P3[], half: number) {
  for (const side of [-1, 1]) {
    curbFace(mb, path, side * half, -1.4, SIDEWALK_Y, C.deck);
    curbFace(mb, path, side * (half - 0.1), SIDEWALK_Y, SIDEWALK_Y + 1.1, C.railing);
  }
  ribbon(mb, path, -half, half, -1.4, C.deck);
}

function length(path: P3[]): number {
  let L = 0;
  for (let k = 1; k < path.length; k++) L += Math.hypot(path[k][0] - path[k - 1][0], path[k][2] - path[k - 1][2]);
  return L;
}

/** The part of a path between distances d0 and d1 (either order) from its start. */
function section(path: P3[], d0: number, d1: number): P3[] | null {
  const a = Math.min(d0, d1), b = Math.max(d0, d1);
  const L = length(path);
  if (a < 0 || b > L) return null;
  return trim(path, a, L - b);
}

/** Dashed line at `offset`: 3 m dashes every 9 m. */
function dashes(mb: MeshBuilder, path: P3[], offset = 0) {
  const fine = densify(path, 1.5);
  let dist = 0;
  for (let k = 1; k < fine.length; k++) {
    const p = fine[k - 1], q = fine[k];
    const seg = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if (dist % 9 < 3) ribbon(mb, [p, q], offset - 0.08, offset + 0.08, MARK_Y, C.marking);
    dist += seg;
  }
}

function disc(mb: MeshBuilder, x: number, y: number, z: number, r: number, color: Color) {
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    mb.triFacing([x, y, z], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], UP, color);
  }
}

/** Cut `d0` meters off the start and `d1` off the end; null if nothing is left. */
function trim(path: P3[], d0: number, d1: number): P3[] | null {
  const cut = (pts: P3[], d: number): P3[] | null => {
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      const seg = Math.hypot(q[0] - p[0], q[2] - p[2]);
      if (acc + seg > d) {
        const t = (d - acc) / seg;
        const start: P3 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        return [start, ...pts.slice(k)];
      }
      acc += seg;
    }
    return null;
  };
  const a = cut(path, d0);
  if (!a) return null;
  const b = cut([...a].reverse(), d1);
  return b && b.length >= 2 ? b.reverse() : null;
}
