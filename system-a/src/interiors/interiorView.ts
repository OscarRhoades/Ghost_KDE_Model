/**
 * Draws the inside of the building the walker is in (or about to walk into):
 * floors, ceilings, the inner face of the outer walls with windows, partitions,
 * stairs, furniture and ceiling lights. Only the walker's floor and its
 * neighbors are built, and only for one building at a time.
 */
import { Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, type Material } from "three";
import { bays, cap, doorOn, edgesOf, type Edge } from "../buildings/kit";
import { defineResource } from "../ecs/world";
import type { BuildingData } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { pointInPolygon, type P2 } from "../geom/polygon";
import { MeshBuilder, type V3 } from "../render/meshBuilder";
import { SceneR } from "../render/renderPlugin";
import { ViewR } from "../camera/viewMode";
import { NavR, WalkerR } from "./nav";
import type { BuildingPlan, FloorPlan, Stair } from "./plan";

/** Where the walker is, for the HUD. Empty when outdoors. */
export const LocationR = defineResource<{ label: string }>("Location");

/** Show a building's ground floor once its front door is this close (m). */
const APPROACH = 16;
const TREADS = 10;

const ROOM_NAMES: Record<string, string> = {
  lobby: "Lobby",
  shop: "Shop",
  office: "Office floor",
  living: "Living room",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  hall: "Hallway",
  warehouse: "Warehouse",
};

interface Builders {
  matte: MeshBuilder;
  glass: MeshBuilder;
  light: MeshBuilder;
}

const hexColor = (h: number) => new Color(h);

/** Inward-facing rectangle on an outer wall, slightly inside the facade. */
function inner(mb: MeshBuilder, e: Edge, s0: number, s1: number, y0: number, y1: number, c: Color) {
  if (s1 - s0 < 0.01 || y1 - y0 < 0.01) return;
  const o = -0.12;
  const p = (s: number, y: number): V3 => [e.a[0] + e.tx * s + e.nx * o, y, e.a[1] + e.tz * s + e.nz * o];
  mb.quadFacing(p(s0, y0), p(s1, y0), p(s1, y1), p(s0, y1), [-e.nx, 0, -e.nz], c);
}

/** Inner face of one floor's outer walls, with windows according to the glazing. */
function shellInside(b: Builders, plan: BuildingPlan, fp: FloorPlan, door: BuildingData["entrance"], wall: Color, glass: Color) {
  const y0 = fp.y - 0.05;
  const y1 = fp.ceiling;
  const fh = plan.floorHeight;
  for (const e of edgesOf(fp.shell)) {
    // Openings along this wall: [s0, s1, bottom, top, isDoor].
    const openings: [number, number, number, number, boolean][] = [];
    const d = fp.index === 0 ? doorOn(e, door) : null;
    if (plan.glazing === "full") {
      openings.push([0.05, e.len - 0.05, y0 + 0.15, y1 - 0.05, false]);
    } else if (plan.glazing === "punched") {
      const cuts = bays(e.len, 3.4, 0.6);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const s0 = cuts[k] + 0.6;
        const s1 = cuts[k + 1] - 0.6;
        if (s1 - s0 > 0.6) openings.push([s0, s1, y0 + 0.9, Math.min(y1 - 0.1, y0 + fh - 0.5), false]);
      }
    } else {
      openings.push([0.3, e.len - 0.3, y1 - 1.5, y1 - 0.4, false]); // clerestory
    }
    if (d) {
      // The doorway replaces any window it overlaps.
      for (let k = openings.length - 1; k >= 0; k--) {
        const o = openings[k];
        if (o[1] > d.s0 && o[0] < d.s1) {
          openings.splice(k, 1);
          if (o[0] < d.s0 - 0.3) openings.push([o[0], d.s0 - 0.15, o[2], o[3], false]);
          if (o[1] > d.s1 + 0.3) openings.push([d.s1 + 0.15, o[1], o[2], o[3], false]);
        }
      }
      openings.push([d.s0, d.s1, y0, d.top, true]);
    }
    openings.sort((a, c) => a[0] - c[0]);
    let cursor = 0;
    for (const [s0, s1, lo, hi, isDoor] of openings) {
      inner(b.matte, e, cursor, s0, y0, y1, wall);
      inner(b.matte, e, s0, s1, y0, lo, wall);
      inner(b.matte, e, s0, s1, hi, y1, wall);
      if (!isDoor) inner(b.glass, e, s0, s1, lo, hi, glass);
      cursor = s1;
    }
    inner(b.matte, e, cursor, e.len, y0, y1, wall);
  }
}

/** A wall piece with two faces, ends and a top. */
function wallBox(mb: MeshBuilder, a: P2, b: P2, y0: number, y1: number, c: Color, half = 0.06) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.01) return;
  const tx = (b[0] - a[0]) / len;
  const tz = (b[1] - a[1]) / len;
  const nx = -tz * half;
  const nz = tx * half;
  const p = (q: P2, side: number, y: number): V3 => [q[0] + nx * side, y, q[1] + nz * side];
  mb.quadFacing(p(a, 1, y0), p(b, 1, y0), p(b, 1, y1), p(a, 1, y1), [nx, 0, nz], c);
  mb.quadFacing(p(a, -1, y0), p(b, -1, y0), p(b, -1, y1), p(a, -1, y1), [-nx, 0, -nz], c);
  mb.quadFacing(p(a, 1, y1), p(b, 1, y1), p(b, -1, y1), p(a, -1, y1), [0, 1, 0], c);
  mb.quadFacing(p(a, 1, y0), p(a, -1, y0), p(a, -1, y1), p(a, 1, y1), [-tx, 0, -tz], c);
  mb.quadFacing(p(b, 1, y0), p(b, -1, y0), p(b, -1, y1), p(b, 1, y1), [tx, 0, tz], c);
}

/** A solid box over a ground polygon (furniture, stair treads). */
function solid(mb: MeshBuilder, poly: readonly P2[], y0: number, y1: number, c: Color) {
  for (const e of edgesOf(poly)) {
    const p = (s: number, y: number): V3 => [e.a[0] + e.tx * s, y, e.a[1] + e.tz * s];
    mb.quadFacing(p(0, y0), p(e.len, y0), p(e.len, y1), p(0, y1), [e.nx, 0, e.nz], c);
  }
  cap(mb, poly, y1, c);
}

const stairPoint = (s: Stair, r: number, w: number): P2 => [
  s.o[0] + s.run[0] * r + s.across[0] * w,
  s.o[1] + s.run[1] * r + s.across[1] * w,
];
const stairHole = (s: Stair): P2[] => [stairPoint(s, 0, 0), stairPoint(s, 1, 0), stairPoint(s, 1, 1), stairPoint(s, 0, 1)];

/** Treads for the flight from floor k to k + 1. */
function flight(mb: MeshBuilder, plan: BuildingPlan, s: Stair, k: number, c: Color) {
  const fh = plan.floorHeight;
  const base = plan.baseY + 0.05 + k * fh;
  for (let i = 0; i < TREADS; i++) {
    const a0 = i / TREADS;
    const a1 = (i + 1) / TREADS;
    const upA = base + ((i + 1) / TREADS) * (fh / 2);
    solid(mb, [stairPoint(s, a0, 0.04), stairPoint(s, a1, 0.04), stairPoint(s, a1, 0.47), stairPoint(s, a0, 0.47)], upA - 0.22, upA, c);
    const upB = base + fh / 2 + ((i + 1) / TREADS) * (fh / 2);
    solid(mb, [stairPoint(s, 1 - a1, 0.53), stairPoint(s, 1 - a0, 0.53), stairPoint(s, 1 - a0, 0.96), stairPoint(s, 1 - a1, 0.96)], upB - 0.22, upB, c);
  }
  // Landing at the far end, halfway up.
  solid(mb, [stairPoint(s, 0.94, 0.04), stairPoint(s, 1, 0.04), stairPoint(s, 1, 0.96), stairPoint(s, 0.94, 0.96)], base + fh / 2 - 0.22, base + fh / 2, c);
}

export function buildInterior(b: BuildingData, plan: BuildingPlan, f0: number, f1: number): Builders {
  const out: Builders = { matte: new MeshBuilder(), glass: new MeshBuilder(), light: new MeshBuilder() };
  const floorC = hexColor(plan.floorColor);
  const wallC = hexColor(plan.wallColor);
  const ceilingC = new Color("#f6f5f2");
  const glassC = new Color("#bcd6e2");
  const treadC = new Color("#d6d2ca");
  const lightC = new Color("#fffbea");
  const n = plan.floors.length;
  for (let f = f0; f <= f1; f++) {
    const fp = plan.floors[f];
    const holeBelow = plan.stair && f > 0 ? [stairHole(plan.stair)] : [];
    const holeAbove = plan.stair && f < n - 1 ? [stairHole(plan.stair)] : [];
    cap(out.matte, fp.shell, fp.y, floorC, false, holeBelow);
    cap(out.matte, fp.shell, fp.ceiling, ceilingC, true, holeAbove);
    shellInside(out, plan, fp, b.entrance, wallC, glassC);
    for (const w of fp.walls) wallBox(out.matte, w.a, w.b, w.y0, w.y1, wallC);
    for (const it of fp.furniture) solid(out.matte, it.poly, it.y0, it.y1, hexColor(it.color));
    for (const [x, z] of fp.lights) {
      if (!pointInPolygon(x, z, fp.shell)) continue;
      const h = 0.35;
      const y = fp.ceiling - 0.01;
      out.light.quadFacing([x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h], [0, -1, 0], lightC);
    }
  }
  if (plan.stair) {
    for (let k = Math.max(0, f0 - 1); k <= Math.min(n - 2, f1); k++) flight(out.matte, plan, plan.stair, k, treadC);
  }
  return out;
}

export function interiorView(): Plugin {
  return {
    name: "interior-view",
    install(engine) {
      let materials: { matte: Material; glass: Material; light: Material };
      let group: Group | null = null;
      let key = "";
      const lamp = new PointLight(0xfff1dc, 35, 22, 2);

      const clear = () => {
        group?.traverse((o) => (o as Mesh).geometry?.dispose());
        group?.removeFromParent();
        group = null;
        key = "";
      };

      engine.addSystem({
        name: "interior-view",
        start(world) {
          materials = {
            matte: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
            glass: new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, depthWrite: false }),
            light: new MeshBasicMaterial({ vertexColors: true }),
          };
          lamp.visible = false;
          world.resource(SceneR).add(lamp);
        },
        onUnload(world) {
          clear();
          world.setResource(LocationR, { label: "" });
        },
        update(world) {
          const walker = world.getResource(WalkerR);
          const nav = world.getResource(NavR);
          if (!walker || !nav || world.resource(ViewR).mode !== "walk") {
            if (group) clear();
            lamp.visible = false;
            world.setResource(LocationR, { label: "" });
            return;
          }
          const inside = walker.building;
          const target = inside ?? nav.entranceNear(walker.x, walker.z, APPROACH);
          if (!target) {
            if (group) clear();
            lamp.visible = false;
            world.setResource(LocationR, { label: "" });
            return;
          }
          const plan = nav.plan(target);
          const n = plan.floors.length;
          const f0 = inside ? Math.max(0, walker.floor - 1) : 0;
          const f1 = inside ? Math.min(n - 1, walker.floor + 1) : 0;
          const nextKey = `${target.seed}:${target.baseY}:${f0}-${f1}`;
          if (nextKey !== key) {
            clear();
            const parts = buildInterior(target, plan, f0, f1);
            group = new Group();
            group.name = "interior";
            for (const slot of ["matte", "glass", "light"] as const) {
              if (parts[slot].triangleCount === 0) continue;
              const mesh = new Mesh(parts[slot].build(), materials[slot]);
              mesh.receiveShadow = slot === "matte";
              mesh.castShadow = slot === "matte";
              mesh.renderOrder = slot === "glass" ? 2 : 0;
              group.add(mesh);
            }
            world.resource(SceneR).add(group);
            key = nextKey;
          }

          lamp.visible = !!inside;
          if (inside) lamp.position.set(walker.x, walker.y + 2.2, walker.z);

          let label = "";
          if (inside) {
            const fp = plan.floors[walker.floor];
            const room = fp.rooms.find((r) => pointInPolygon(walker.x, walker.z, r.poly));
            const level = walker.floor === 0 ? "Ground floor" : `Floor ${walker.floor}`;
            label = room ? `${ROOM_NAMES[room.kind] ?? room.kind} · ${level}` : level;
          }
          world.setResource(LocationR, { label });
        },
      });
    },
  };
}
