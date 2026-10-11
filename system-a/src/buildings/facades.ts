/**
 * Facade systems: how a volume's outer walls are built. Each system draws the
 * walls of a volume slice and reports its window openings per edge and floor,
 * which the interiors use so windows line up inside and out.
 */
import { Color } from "three";
import { Catalog } from "../catalog/registry";
import type { BuildingData, Entrance } from "../engine/components";
import type { P2 } from "../geom/polygon";
import { band, bays, box, cap, doorFrame, doorOn, frontEdge, hitsDoor, longestEdge, panel, walls, type Edge, type Parts, type Rng } from "./kit";
import { SWATCH, type Palette } from "./look";
import type { VolumeRole } from "./massing";

/** A window on an edge: along-edge range and heights relative to the floor. */
export interface Opening {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

export interface FacadeCtx {
  b: BuildingData;
  pal: Palette;
  /** The facade's parameters for this building (from `params`). */
  params: Record<string, number>;
  door?: Entrance;
  fh: number;
  /** Elevation of floor f. */
  y(f: number): number;
  /** Decorative randomness (never used for openings). */
  rng: Rng;
}

export interface Slice {
  poly: P2[];
  edges: Edge[];
  f0: number;
  f1: number;
  role: VolumeRole;
  /** Whether this slice is the top of its volume. */
  top: boolean;
}

export interface FacadeSystem {
  /** How interiors glaze their outer walls when openings are not used. */
  glazing: "full" | "punched" | "solid";
  /** Draw the far-away massing in glass rather than the wall color. */
  glassy: boolean;
  params(rng: Rng): Record<string, number>;
  /** Window openings on an edge at floor f, in edge space. */
  openings(e: Edge, f: number, ctx: FacadeCtx, slice: Slice): Opening[];
  draw(p: Parts, slice: Slice, ctx: FacadeCtx): void;
}

export const facadeCatalog = new Catalog<FacadeSystem>("facade system");

// ---- Shared pieces -------------------------------------------------------------

/** Window: a dark frame panel with a slightly smaller glass pane in front. */
export function windowOn(p: Parts, e: Edge, s0: number, s1: number, y0: number, y1: number, glass: Color, frame: Color, out = 0) {
  const f = 0.08;
  panel(p.metal, e, s0 - f, s1 + f, y0 - f, y1 + f, out + 0.02, frame);
  panel(p.glass, e, s0, s1, y0, y1, out + 0.04, glass);
}

/** Center (s) of the doorway on an edge, or the edge middle. */
export function doorCenter(e: Edge, door?: Entrance): number {
  if (!door) return e.len / 2;
  return (door.x - e.a[0]) * e.tx + (door.z - e.a[1]) * e.tz;
}

/** Canopy over the front door, `w` wide and `depth` deep. */
export function canopy(p: Parts, E: Edge[], door: Entrance | undefined, y: number, w: number, depth: number, c: Color) {
  if (!door) return;
  const k = E.findIndex((e) => doorOn(e, door));
  if (k < 0) return;
  const front = E[k];
  const s = Math.min(front.len - w / 2, Math.max(w / 2, doorCenter(front, door)));
  box(p.metal, front, s - w / 2, s + w / 2, y, y + 0.35, 0, depth, c);
}

const isGround = (s: Slice) => s.f0 === 0;
const doorFor = (s: Slice, ctx: FacadeCtx) => (isGround(s) ? ctx.door : undefined);

/** Glass walls with a doorway on the ground floor. */
function glassWalls(p: Parts, s: Slice, ctx: FacadeCtx, glass: Color) {
  walls(p.glass, s.edges, ctx.y(s.f0), ctx.y(s.f1), glass, 0, doorFor(s, ctx));
}

/** Punched windows from `openings`, skipping any that would hit the door. */
function punched(p: Parts, s: Slice, ctx: FacadeCtx, sys: FacadeSystem) {
  for (const e of s.edges) {
    for (let f = s.f0; f < s.f1; f++) {
      for (const o of sys.openings(e, f, ctx, s)) {
        if (f === 0 && hitsDoor(e, o.s0, o.s1, ctx.y(f) + o.y0, ctx.door)) continue;
        windowOn(p, e, o.s0, o.s1, ctx.y(f) + o.y0, ctx.y(f) + o.y1, ctx.pal.glass, ctx.pal.frame);
      }
    }
  }
}

/** Balconies on the long sides: slab, glass railing, top rail. */
function balconies(p: Parts, s: Slice, ctx: FacadeCtx, sys: FacadeSystem, every = 2) {
  const li = longestEdge(s.edges);
  const longLen = s.edges[li].len;
  s.edges.forEach((e) => {
    if (e.len < longLen * 0.8) return;
    for (let f = Math.max(1, s.f0); f < s.f1; f++) {
      sys.openings(e, f, ctx, s).forEach((o, k) => {
        if (k % every !== f % every) return;
        const y = ctx.y(f);
        box(p.matte, e, o.s0 - 0.4, o.s1 + 0.4, y - 0.15, y + 0.05, 0, 1.5, ctx.pal.accent);
        panel(p.glass, e, o.s0 - 0.35, o.s1 + 0.35, y + 0.05, y + 1.05, 1.48, SWATCH.railing);
        box(p.metal, e, o.s0 - 0.35, o.s1 + 0.35, y + 1.05, y + 1.1, 1.42, 1.5, ctx.pal.frame);
      });
    }
  });
}

/** Even bays of punched windows: bay width, sill height, head height. */
function bayOpenings(e: Edge, bay: number, margin: number, sill: number, head: number, pier: number): Opening[] {
  const cuts = bays(e.len, bay, margin);
  const out: Opening[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const s0 = cuts[k] + pier;
    const s1 = cuts[k + 1] - pier;
    if (s1 - s0 > 0.6) out.push({ s0, s1, y0: sill, y1: head });
  }
  return out;
}

const fullOpening = (e: Edge, ctx: FacadeCtx): Opening[] => [{ s0: 0.05, s1: e.len - 0.05, y0: 0.1, y1: ctx.fh - 0.1 }];

// ---- Systems -----------------------------------------------------------------

facadeCatalog.register(
  "curtain-wall",
  {
    glazing: "full",
    glassy: true,
    params: (rng) => ({ slabEvery: rng.chance(0.5) ? 1 : 2, lobby: 1 }),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      for (let f = s.f0 + 1; f < s.f1; f += ctx.params.slabEvery) band(p.matte, s.edges, ctx.y(f) - 0.18, ctx.y(f) + 0.18, 0.12, ctx.pal.trim);
      if (isGround(s) && s.f1 > 2) {
        band(p.metal, s.edges, ctx.y(2) - 0.4, ctx.y(2), 0.2, ctx.pal.frame);
        canopy(p, s.edges, ctx.door, ctx.y(0) + 4.2, 9, 3.2, ctx.pal.frame);
      }
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["tower", "glass"] },
);

facadeCatalog.register(
  "curtain-fins",
  {
    glazing: "full",
    glassy: true,
    params: (rng) => ({ fin: rng.range(2.4, 3.6), depth: rng.range(0.35, 0.6) }),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      for (let f = s.f0 + 2; f < s.f1; f += 2) band(p.matte, s.edges, ctx.y(f) - 0.18, ctx.y(f) + 0.18, 0.12, ctx.pal.trim);
      const fy0 = ctx.y(s.f0) + (isGround(s) ? ctx.fh * 2 : 0);
      for (const e of s.edges) for (const x of bays(e.len, ctx.params.fin, 0.4)) box(p.metal, e, x - 0.07, x + 0.07, fy0, ctx.y(s.f1), 0, ctx.params.depth, ctx.pal.frame);
      if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 4.2, 9, 3.2, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["tower", "glass"] },
);

facadeCatalog.register(
  "ribbon",
  {
    glazing: "full",
    glassy: true,
    params: (rng) => ({ fins: rng.chance(0.6) ? 1 : 0, spandrel: rng.range(0.9, 1.2) }),
    openings: (e, _f, ctx) => [{ s0: 0.05, s1: e.len - 0.05, y0: 0.15, y1: ctx.fh - ctx.params.spandrel }],
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      for (let f = Math.max(1, s.f0); f <= s.f1; f++) {
        const lip = f === s.f1 && s.top ? 0.6 : 0.1;
        band(p.matte, s.edges, ctx.y(f) - ctx.params.spandrel, ctx.y(f) + lip, 0.12, ctx.pal.wall);
      }
      if (ctx.params.fins) {
        const y0 = ctx.y(Math.max(1, s.f0)) - ctx.params.spandrel;
        for (const e of s.edges) for (const x of bays(e.len, 3, 0.5)) box(p.matte, e, x - 0.08, x + 0.08, y0, ctx.y(s.f1), 0, 0.7, ctx.pal.wall);
      }
      if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 3.0, 6, 2.4, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["office", "glass"] },
);

function punchedSystem(balconyChance: number): FacadeSystem {
  const sys: FacadeSystem = {
    glazing: "punched",
    glassy: false,
    params: (rng) => ({ bay: rng.range(3.0, 3.8), tall: rng.chance(0.5) ? 1 : 0, balconies: rng.chance(balconyChance) ? 1 : 0 }),
    openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, ctx.params.tall ? 0.1 : 0.9, ctx.fh - 0.5, 0.6),
    draw(p, s, ctx) {
      walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
      punched(p, s, ctx, sys);
      if (ctx.params.balconies) balconies(p, s, ctx, sys);
      if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.1, ctx.y(s.f1) + 0.7, 0.15, ctx.pal.trim);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  };
  return sys;
}

facadeCatalog.register("punched-render", punchedSystem(0.7), { tags: ["residential"] });
facadeCatalog.register("punched-brick", punchedSystem(0.6), { tags: ["residential", "brick"] });

/** Modern house: render below with big garden glazing, clad upper box with a strip window. */
const houseRender: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: () => ({}),
  openings(e, f, ctx, s) {
    if (s.role === "upper") {
      const longest = longestEdge(s.edges);
      return s.edges[longest] === e ? [{ s0: e.len * 0.1, s1: e.len * 0.9, y0: 0.9, y1: ctx.fh - 0.6 }] : [];
    }
    if (f !== 0 || e.len <= 4) return [];
    const fi = frontEdge(s.edges, ctx.door);
    const front = s.edges[fi];
    // Garden side: the long edge facing away from the front door.
    const garden = s.edges.reduce((best, x) => (x.len > 4 && x.nx * front.nx + x.nz * front.nz < best.d ? { e: x, d: x.nx * front.nx + x.nz * front.nz } : best), { e: front, d: 2 }).e;
    if (e === garden) return [{ s0: e.len * 0.12, s1: e.len * 0.78, y0: 0.1, y1: ctx.fh - 0.4 }];
    const o = { s0: e.len * 0.25, s1: e.len * 0.6, y0: 1.0, y1: 2.4 };
    if (hitsDoor(e, o.s0, o.s1, ctx.y(0) + 1, ctx.door)) return [{ s0: e.len * 0.66, s1: e.len * 0.9, y0: 1.0, y1: 2.4 }];
    return [o];
  },
  draw(p, s, ctx) {
    const color = s.role === "upper" ? ctx.pal.accent : ctx.pal.wall;
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), color, 0, doorFor(s, ctx));
    // Soffit under the cantilevered upper box.
    if (s.role === "upper") cap(p.matte, s.poly, ctx.y(s.f0), color, true);
    punched(p, s, ctx, houseRender);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("house-render", houseRender, { tags: ["house"] });

/** Pitched-roof house: rows of windows on the long sides, a tall glazed gable end. */
const housePitched: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: () => ({}),
  openings(e, f, ctx, s) {
    const long = e.len >= s.edges[longestEdge(s.edges)].len * 0.9;
    if (long) {
      return bays(e.len, 3.2, 1)
        .slice(0, -1)
        .map((x) => ({ s0: x + 0.7, s1: x + 2.0, y0: f === 0 ? 0.1 : 0.8, y1: ctx.fh - 0.5 }));
    }
    return f === 0 ? [{ s0: e.len * 0.3, s1: e.len * 0.7, y0: 0.1, y1: ctx.fh * (ctx.b.floors) - 0.4 }] : [];
  },
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    punched(p, s, ctx, housePitched);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("house-pitched", housePitched, { tags: ["house"] });

facadeCatalog.register(
  "ribbed-metal",
  {
    glazing: "solid",
    glassy: false,
    params: (rng) => ({ rib: rng.range(1.2, 2.0) }),
    openings: (e, _f, ctx) => [{ s0: 0.3, s1: e.len - 0.3, y0: ctx.fh * ctx.b.floors - 1.5, y1: ctx.fh * ctx.b.floors - 0.4 }],
    draw(p, s, ctx) {
      const t = ctx.y(s.f1);
      const rib = ctx.pal.wall.clone().offsetHSL(0, 0, -0.06);
      walls(p.matte, s.edges, ctx.y(s.f0), t, ctx.pal.wall, 0, doorFor(s, ctx));
      for (const e of s.edges) {
        for (const x of bays(e.len, ctx.params.rib)) {
          if (!hitsDoor(e, x - 0.06, x + 0.06, ctx.y(0), doorFor(s, ctx))) box(p.matte, e, x - 0.06, x + 0.06, ctx.y(s.f0) + 0.3, t - 1.6, 0, 0.1, rib);
        }
        panel(p.glass, e, 0.3, e.len - 0.3, t - 1.5, t - 0.4, 0.12, SWATCH.glassLight);
      }
      // Loading doors; the open one is the way in.
      if (isGround(s)) {
        const front = s.edges[frontEdge(s.edges, ctx.door)];
        const doors = bays(front.len, 9, 3);
        for (let k = 0; k + 1 < doors.length; k++) {
          const c = (doors[k] + doors[k + 1]) / 2;
          if (!hitsDoor(front, c - 2.2, c + 2.2, ctx.y(0), ctx.door)) panel(p.metal, front, c - 2.2, c + 2.2, ctx.y(0), ctx.y(0) + 4.6, 0.14, SWATCH.charcoal[0]);
        }
      }
      doorFrame(p.metal, s.edges, doorFor(s, ctx), SWATCH.charcoal[0]);
    },
  },
  { tags: ["industrial"] },
);
