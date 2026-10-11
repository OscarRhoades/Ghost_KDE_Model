/**
 * Facade systems: how a volume's outer walls are built. Each system draws the
 * walls of a volume slice and reports its window openings per edge and floor,
 * which the interiors use so windows line up inside and out.
 */
import { Color } from "three";
import { Catalog } from "../catalog/registry";
import type { BuildingData, Entrance } from "../engine/components";
import type { P2 } from "../geom/polygon";
import type { V3 } from "../render/meshBuilder";
import { at, band, bays, box, cap, doorFrame, doorOn, frontEdge, hitsDoor, longestEdge, panel, walls, type Edge, type Parts, type Rng } from "./kit";
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
  /** Adjust the building palette to suit this system (e.g. terracotta accents). */
  palette?(pal: Palette, rng: Rng): void;
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

/** Green wall: punched windows, planter ledges on every floor and climbers up the piers. */
const greenWall: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(3.2, 4.0), climbers: rng.chance(0.6) ? 1 : 0 }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, 0.9, ctx.fh - 0.5, 0.7),
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    punched(p, s, ctx, greenWall);
    const leaf = SWATCH.green;
    const deep = SWATCH.green.clone().offsetHSL(0.02, 0.05, -0.12);
    for (const e of s.edges) {
      if (e.len < 3) continue;
      for (let f = Math.max(1, s.f0); f < s.f1; f++) {
        const y = ctx.y(f);
        box(p.matte, e, 0.3, e.len - 0.3, y - 0.05, y + 0.35, 0, 0.5, ctx.pal.trim);
        box(p.matte, e, 0.4, e.len - 0.4, y + 0.35, y + 0.75, 0.08, 0.46, (f + Math.round(e.len)) % 3 ? leaf : deep);
      }
      if (!ctx.params.climbers) continue;
      const cuts = bays(e.len, ctx.params.bay, 0.6);
      for (const x of cuts) {
        if (x < 0.5 || x > e.len - 0.5) continue;
        box(p.matte, e, x - 0.3, x + 0.3, ctx.y(s.f0) + (s.f0 === 0 ? 2.6 : 0), ctx.y(s.f1) - 0.2, 0.02, 0.22, deep);
      }
    }
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.1, ctx.y(s.f1) + 0.6, 0.15, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("green-wall", greenWall, { tags: ["residential", "eco"] });
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
    if (e.len <= 4) return [];
    // Upper floors of a single-box house: a row of windows on each side.
    if (f !== 0) return bayOpenings(e, 3.2, 0.8, 0.9, ctx.fh - 0.5, 0.7);
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

// ---- More systems ---------------------------------------------------------------

/**
 * Walls built from piers and spandrels around the openings, standing `depth`
 * proud of the glass, so every window sits in a real reveal. The doorway is
 * treated as one more opening on the ground floor.
 */
function revealWalls(p: Parts, s: Slice, ctx: FacadeCtx, sys: FacadeSystem, depth: number, color: Color, glass = true) {
  const door = doorFor(s, ctx);
  const shade = color.clone().offsetHSL(0, 0, -0.06);
  for (const e of s.edges) {
    const t: V3 = [e.tx, 0, e.tz];
    const mt: V3 = [-e.tx, 0, -e.tz];
    const q = (s0: number, s1: number, y0: number, y1: number, o0: number, o1: number, facing: V3, c: Color) => {
      // Quad spanning along-edge s0..s1 or depth o0..o1 (whichever differs), for reveals.
      if (s0 === s1) p.matte.quadFacing(at(e, s0, y0, o0), at(e, s0, y0, o1), at(e, s0, y1, o1), at(e, s0, y1, o0), facing, c);
      else p.matte.quadFacing(at(e, s0, y0, o0), at(e, s1, y0, o0), at(e, s1, y0, o1), at(e, s0, y0, o1), facing, c);
    };
    for (let f = s.f0; f < s.f1; f++) {
      const y = ctx.y(f);
      const top = ctx.y(f + 1);
      const opens = sys.openings(e, f, ctx, s).filter((o) => !(f === 0 && hitsDoor(e, o.s0, o.s1, y + o.y0, door)));
      const d = f === 0 ? doorOn(e, door) : null;
      const holes = [...opens.map((o) => ({ ...o, door: false })), ...(d ? [{ s0: d.s0, s1: d.s1, y0: 0, y1: d.top - y, door: true }] : [])].sort((a, b) => a.s0 - b.s0);
      // Front face, `depth` proud of the glass, with corners closed by running past the ends.
      let cursor = -depth;
      for (const h of holes) {
        if (h.s0 > cursor) panel(p.matte, e, cursor, h.s0, y, top, depth, color);
        if (h.y0 > 0.01) panel(p.matte, e, h.s0, h.s1, y, y + h.y0, depth, color);
        panel(p.matte, e, h.s0, h.s1, y + h.y1, top, depth, color);
        // Reveals: jambs, head and sill.
        q(h.s0, h.s0, y + h.y0, y + h.y1, 0, depth, t, shade);
        q(h.s1, h.s1, y + h.y0, y + h.y1, 0, depth, mt, shade);
        q(h.s0, h.s1, y + h.y1, y + h.y1, 0, depth, [0, -1, 0], shade);
        if (h.y0 > 0.01) q(h.s0, h.s1, y + h.y0, y + h.y0, 0, depth, [0, 1, 0], shade);
        if (!h.door && glass) windowOn(p, e, h.s0, h.s1, y + h.y0, y + h.y1, ctx.pal.glass, ctx.pal.frame);
        cursor = Math.max(cursor, h.s1);
      }
      if (cursor < e.len + depth) panel(p.matte, e, cursor, e.len + depth, y, top, depth, color);
    }
  }
  doorFrame(p.metal, s.edges, door, ctx.pal.frame);
}

const grid = (e: Edge, step: number, margin = 0) => bays(e.len, step, margin);

facadeCatalog.register(
  "unitised-grid",
  {
    glazing: "full",
    glassy: true,
    params: (rng) => ({ module: rng.range(1.35, 1.8), transom: rng.chance(0.5) ? 1 : 0 }),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      const y0 = ctx.y(s.f0) + (isGround(s) ? 3 : 0);
      for (const e of s.edges) for (const x of grid(e, ctx.params.module)) box(p.metal, e, x - 0.04, x + 0.04, y0, ctx.y(s.f1), 0, 0.12, ctx.pal.frame);
      for (let f = Math.max(1, s.f0); f <= s.f1; f++) {
        band(p.metal, s.edges, ctx.y(f) - 0.06, ctx.y(f) + 0.06, 0.12, ctx.pal.frame);
        if (ctx.params.transom && f < s.f1) band(p.metal, s.edges, ctx.y(f) + 1.05, ctx.y(f) + 1.1, 0.1, ctx.pal.frame);
      }
      if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 3.6, 8, 3, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["glass"] },
);

const concreteGrid: FacadeSystem = {
  glazing: "full",
  glassy: false,
  params: (rng) => ({ bay: rng.range(4, 6), depth: rng.range(0.5, 0.9) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0, 0.75, ctx.fh - 0.55, 0.3),
  draw(p, s, ctx) {
    revealWalls(p, s, ctx, concreteGrid, ctx.params.depth, ctx.pal.trim);
    if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 3.2, 7, 2.5, ctx.pal.frame);
  },
};
facadeCatalog.register("concrete-grid", concreteGrid, { tags: ["office"] });

facadeCatalog.register(
  "horizontal-louvres",
  {
    palette: (pal, rng) => void (pal.accent = rng.chance(0.5) ? rng.pick(SWATCH.timber).clone() : rng.pick(SWATCH.white).clone()),
    glazing: "full",
    glassy: true,
    params: (rng) => ({ blades: rng.chance(0.5) ? 3 : 4, depth: rng.range(0.4, 0.7) }),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      for (let f = Math.max(1, s.f0); f < s.f1; f++) {
        band(p.matte, s.edges, ctx.y(f) - 0.15, ctx.y(f) + 0.15, 0.15, ctx.pal.trim);
        for (let k = 1; k <= ctx.params.blades; k++) {
          const y = ctx.y(f) + (ctx.fh * k) / (ctx.params.blades + 1);
          band(p.matte, s.edges, y - 0.04, y + 0.04, ctx.params.depth, ctx.pal.accent);
        }
      }
      if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 3.2, 7, 2.5, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["glass", "shading"] },
);

facadeCatalog.register(
  "perforated-screen",
  {
    palette: (pal, rng) => void (pal.accent = rng.pick([...SWATCH.cladding, ...SWATCH.white, SWATCH.terracotta[1]]).clone()),
    glazing: "full",
    glassy: false,
    params: (rng) => ({ panel: rng.range(1.2, 1.8), cover: rng.range(0.45, 0.65), seed: Math.floor(rng.next() * 1e6) }),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      // A screen of metal panels standing off the glass in a seeded on/off pattern.
      let h = ctx.params.seed | 0;
      const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
      for (const e of s.edges) {
        const xs = grid(e, ctx.params.panel);
        for (let f = Math.max(1, s.f0); f < s.f1; f++) {
          for (let k = 0; k + 1 < xs.length; k++) {
            if (next() > ctx.params.cover) continue;
            panel(p.metal, e, xs[k] + 0.03, xs[k + 1] - 0.03, ctx.y(f) + 0.05, ctx.y(f + 1) - 0.05, 0.6, ctx.pal.accent);
          }
        }
      }
      for (let f = Math.max(1, s.f0); f <= s.f1; f++) band(p.matte, s.edges, ctx.y(f) - 0.12, ctx.y(f) + 0.12, 0.65, ctx.pal.trim);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["shading"] },
);

facadeCatalog.register(
  "metal-mesh",
  {
    palette: (pal) => void (pal.accent = new Color("#c9ccce")),
    glazing: "full",
    glassy: false,
    params: () => ({}),
    openings: (e, _f, ctx) => fullOpening(e, ctx),
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      // A continuous fine mesh veil above the ground floor, read as a soft sheen.
      const y0 = ctx.y(Math.max(1, s.f0));
      for (const e of s.edges) panel(p.glass, e, -0.4, e.len + 0.4, y0, ctx.y(s.f1) + 0.6, 0.8, ctx.pal.accent);
      for (const e of s.edges) for (const x of grid(e, 6)) box(p.metal, e, x - 0.05, x + 0.05, y0, ctx.y(s.f1) + 0.6, 0, 0.8, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["shading"] },
);

const flemishBrick: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(3.2, 4.2), oriel: rng.range(0.35, 0.6) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.8, 0.7, ctx.fh - 0.45, 0.7),
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    const course = ctx.pal.wall.clone().offsetHSL(0, -0.05, -0.08);
    for (let f = Math.max(1, s.f0); f < s.f1; f++) band(p.matte, s.edges, ctx.y(f) - 0.25, ctx.y(f) + 0.05, 0.06, course);
    for (const e of s.edges) {
      for (let f = s.f0; f < s.f1; f++) {
        for (const o of flemishBrick.openings(e, f, ctx, s)) {
          const y0 = ctx.y(f) + o.y0;
          const y1 = ctx.y(f) + o.y1;
          if (f === 0 && hitsDoor(e, o.s0, o.s1, y0, ctx.door)) continue;
          // Projecting bay window: a framed box standing out from the brick.
          const d = f === 0 ? 0.08 : ctx.params.oriel;
          box(p.metal, e, o.s0 - 0.12, o.s1 + 0.12, y0 - 0.12, y1 + 0.12, 0, d, ctx.pal.frame);
          panel(p.glass, e, o.s0, o.s1, y0, y1, d + 0.01, ctx.pal.glass);
        }
      }
    }
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.1, ctx.y(s.f1) + 0.8, 0.12, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("flemish-brick", flemishBrick, { tags: ["residential", "brick"] });

function revealSystem(colorOf: (pal: Palette) => Color, depth: [number, number]): FacadeSystem {
  const sys: FacadeSystem = {
    glazing: "punched",
    glassy: false,
    params: (rng) => ({ bay: rng.range(2.6, 3.6), tall: rng.chance(0.4) ? 1 : 0, depth: rng.range(depth[0], depth[1]) }),
    openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.5, ctx.params.tall ? 0.15 : 0.85, ctx.fh - 0.5, 0.55),
    draw(p, s, ctx) {
      revealWalls(p, s, ctx, sys, ctx.params.depth, colorOf(ctx.pal));
      if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.05, ctx.y(s.f1) + 0.6, ctx.params.depth + 0.05, ctx.pal.trim);
    },
  };
  return sys;
}
facadeCatalog.register("recessed-brick", revealSystem((pal) => pal.wall, [0.3, 0.45]), { tags: ["residential", "brick"] });
facadeCatalog.register("deep-reveal-render", revealSystem((pal) => pal.wall, [0.25, 0.4]), { tags: ["residential"] });

const timberCladding: FacadeSystem = {
  palette: (pal, rng) => void (pal.accent = rng.pick(SWATCH.timber).clone()),
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(2.8, 3.8), batten: rng.range(0.5, 0.8) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, 0.8, ctx.fh - 0.5, 0.65),
  draw(p, s, ctx) {
    const boards = ctx.pal.accent;
    const batten = boards.clone().offsetHSL(0, 0, -0.07);
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), boards, 0, doorFor(s, ctx));
    for (const e of s.edges) {
      const opens = Array.from({ length: s.f1 - s.f0 }, (_, k) => timberCladding.openings(e, s.f0 + k, ctx, s)).flat();
      for (const x of grid(e, ctx.params.batten, 0.2)) {
        // Battens stop at windows: draw them only where no opening crosses.
        if (opens.some((o) => x > o.s0 - 0.1 && x < o.s1 + 0.1)) continue;
        if (hitsDoor(e, x - 0.04, x + 0.04, ctx.y(0), doorFor(s, ctx))) continue;
        box(p.matte, e, x - 0.035, x + 0.035, ctx.y(s.f0) + 0.3, ctx.y(s.f1), 0, 0.06, batten);
      }
    }
    punched(p, s, ctx, timberCladding);
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.05, ctx.y(s.f1) + 0.5, 0.1, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("timber-cladding", timberCladding, { tags: ["residential", "timber"] });

facadeCatalog.register(
  "terracotta-baguettes",
  {
    palette: (pal, rng) => void (pal.accent = rng.pick(SWATCH.terracotta).clone()),
    glazing: "full",
    glassy: false,
    params: (rng) => ({ rods: rng.chance(0.5) ? 4 : 6, gap: rng.range(0.1, 0.18) }),
    openings: (e, _f, ctx) => [{ s0: 0.05, s1: e.len - 0.05, y0: 0.9, y1: ctx.fh - 0.4 }],
    draw(p, s, ctx) {
      glassWalls(p, s, ctx, ctx.pal.glass);
      const clay = ctx.pal.accent;
      for (let f = Math.max(1, s.f0); f < s.f1; f++) {
        band(p.matte, s.edges, ctx.y(f) - 0.2, ctx.y(f) + 0.9, 0.2, clay);
        const y0 = ctx.y(f) + 0.95;
        const y1 = ctx.y(f + 1) - 0.4;
        for (let k = 0; k < ctx.params.rods; k++) {
          const y = y0 + ((y1 - y0) * (k + 0.5)) / ctx.params.rods;
          band(p.matte, s.edges, y - 0.04, y + 0.04, 0.35, clay);
        }
      }
      if (isGround(s)) canopy(p, s.edges, ctx.door, ctx.y(0) + 3.2, 6, 2.2, ctx.pal.frame);
      doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
    },
  },
  { tags: ["office"] },
);

const fibreCement: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(2.8, 3.6), seed: Math.floor(rng.next() * 1e6) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, 0.85, ctx.fh - 0.55, 0.6),
  draw(p, s, ctx) {
    // Large panels in three close tones, arranged per bay and floor.
    const tones = [ctx.pal.wall, ctx.pal.wall.clone().offsetHSL(0, 0, -0.05), ctx.pal.wall.clone().offsetHSL(0.01, 0.03, 0.04)];
    let h = ctx.params.seed | 0;
    const next = () => ((h = Math.imul(h ^ (h >>> 13), 2654435761) + 0x7f4a7c15) >>> 0) / 4294967296;
    const door = doorFor(s, ctx);
    for (const e of s.edges) {
      const xs = grid(e, ctx.params.bay / 2);
      for (let f = s.f0; f < s.f1; f++) {
        for (let k = 0; k + 1 < xs.length; k++) {
          panelAroundDoor(p, e, xs[k], xs[k + 1], ctx.y(f), ctx.y(f + 1), tones[Math.floor(next() * 3)], f === 0 ? door : undefined);
        }
      }
    }
    punched(p, s, ctx, fibreCement);
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.05, ctx.y(s.f1) + 0.5, 0.08, ctx.pal.frame);
    doorFrame(p.metal, s.edges, door, ctx.pal.frame);
  },
};
facadeCatalog.register("fibre-cement", fibreCement, { tags: ["residential"] });

function panelAroundDoor(p: Parts, e: Edge, s0: number, s1: number, y0: number, y1: number, c: Color, door?: Entrance) {
  const d = doorOn(e, door);
  if (!d || d.s1 <= s0 || d.s0 >= s1 || d.top <= y0) return panel(p.matte, e, s0, s1, y0, y1, 0, c);
  if (d.s0 > s0) panel(p.matte, e, s0, d.s0, y0, y1, 0, c);
  if (d.s1 < s1) panel(p.matte, e, d.s1, s1, y0, y1, 0, c);
  if (d.top < y1) panel(p.matte, e, Math.max(s0, d.s0), Math.min(s1, d.s1), d.top, y1, 0, c);
}

const loggias: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(3.4, 4.4) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, 0.1, ctx.fh - 0.45, 0.45),
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    const shade = ctx.pal.wall.clone().offsetHSL(0, 0, -0.18);
    for (const e of s.edges) {
      for (let f = s.f0; f < s.f1; f++) {
        loggias.openings(e, f, ctx, s).forEach((o, k) => {
          const y0 = ctx.y(f) + o.y0;
          const y1 = ctx.y(f) + o.y1;
          if (f === 0 && hitsDoor(e, o.s0, o.s1, y0, ctx.door)) return;
          if (f >= 1 && (k + f) % 2 === 0) {
            // Recessed loggia: deep frame, shadowed back wall, glass door, railing.
            box(p.matte, e, o.s0 - 0.25, o.s0, y0 - 0.1, y1 + 0.25, 0, 0.35, ctx.pal.trim);
            box(p.matte, e, o.s1, o.s1 + 0.25, y0 - 0.1, y1 + 0.25, 0, 0.35, ctx.pal.trim);
            box(p.matte, e, o.s0 - 0.25, o.s1 + 0.25, y1, y1 + 0.25, 0, 0.35, ctx.pal.trim);
            panel(p.matte, e, o.s0, o.s1, y0, y1, 0.01, shade);
            panel(p.glass, e, o.s0 + 0.4, o.s1 - 0.4, y0, y1 - 0.2, 0.03, ctx.pal.glass);
            panel(p.glass, e, o.s0, o.s1, y0, y0 + 1.05, 0.34, SWATCH.railing);
          } else {
            windowOn(p, e, o.s0 + 0.3, o.s1 - 0.3, y0 + 0.8, y1, ctx.pal.glass, ctx.pal.frame);
          }
        });
      }
    }
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.05, ctx.y(s.f1) + 0.6, 0.12, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("loggias", loggias, { tags: ["residential"] });

const wraparound: FacadeSystem = {
  glazing: "full",
  glassy: false,
  params: (rng) => ({ depth: rng.range(1.6, 2.4) }),
  openings: (e, _f, ctx) => bayOpenings(e, 3.2, 0.3, 0.1, ctx.fh - 0.4, 0.25),
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    punched(p, s, ctx, wraparound);
    const d = ctx.params.depth;
    for (let f = Math.max(1, s.f0); f < s.f1; f++) {
      const y = ctx.y(f);
      band(p.matte, s.edges, y - 0.22, y + 0.02, d, ctx.pal.trim);
      for (const e of s.edges) {
        panel(p.glass, e, -d, e.len + d, y + 0.02, y + 1.05, d - 0.02, SWATCH.railing);
        box(p.metal, e, -d, e.len + d, y + 1.05, y + 1.1, d - 0.06, d, ctx.pal.frame);
      }
    }
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.22, ctx.y(s.f1) + 0.1, d, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("wraparound-balconies", wraparound, { tags: ["residential"] });

const winterGardens: FacadeSystem = {
  glazing: "punched",
  glassy: false,
  params: (rng) => ({ bay: rng.range(3.6, 4.6), depth: rng.range(1.0, 1.4) }),
  openings: (e, _f, ctx) => bayOpenings(e, ctx.params.bay, 0.6, 0.1, ctx.fh - 0.5, 0.5),
  draw(p, s, ctx) {
    walls(p.matte, s.edges, ctx.y(s.f0), ctx.y(s.f1), ctx.pal.wall, 0, doorFor(s, ctx));
    const d = ctx.params.depth;
    const longLen = s.edges[longestEdge(s.edges)].len;
    for (const e of s.edges) {
      for (let f = s.f0; f < s.f1; f++) {
        winterGardens.openings(e, f, ctx, s).forEach((o, k) => {
          const y0 = ctx.y(f) + o.y0;
          const y1 = ctx.y(f) + o.y1;
          if (f === 0) {
            if (!hitsDoor(e, o.s0, o.s1, y0, ctx.door)) windowOn(p, e, o.s0, o.s1, y0 + 0.8, y1, ctx.pal.glass, ctx.pal.frame);
            return;
          }
          windowOn(p, e, o.s0, o.s1, y0, y1, ctx.pal.glass, ctx.pal.frame);
          if (e.len < longLen * 0.8 || (k + f) % 2 === 1) return;
          // Glazed box on a slab, framed in metal.
          box(p.matte, e, o.s0 - 0.3, o.s1 + 0.3, ctx.y(f) - 0.2, ctx.y(f), 0, d, ctx.pal.trim);
          panel(p.glass, e, o.s0 - 0.3, o.s1 + 0.3, ctx.y(f), ctx.y(f + 1) - 0.2, d, ctx.pal.glass);
          box(p.metal, e, o.s0 - 0.3, o.s1 + 0.3, ctx.y(f + 1) - 0.25, ctx.y(f + 1) - 0.15, 0, d + 0.02, ctx.pal.frame);
        });
      }
    }
    if (s.top) band(p.matte, s.edges, ctx.y(s.f1) - 0.05, ctx.y(s.f1) + 0.6, 0.12, ctx.pal.trim);
    doorFrame(p.metal, s.edges, doorFor(s, ctx), ctx.pal.frame);
  },
};
facadeCatalog.register("winter-gardens", winterGardens, { tags: ["residential"] });
