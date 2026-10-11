/**
 * Building styles. Each style turns a building's parameters into geometry at
 * two levels of detail: `detail` for street level and `massing` for distance.
 * Register new styles with `registerStyle`; unknown style keys fall back to
 * "default".
 */
import { Color } from "three";
import type { BuildingData } from "../engine/components";
import { insetConvex, type P2 } from "../geom/polygon";
import {
  band,
  bays,
  box,
  cap,
  doorFrame,
  edgesOf,
  frontEdge,
  hitsDoor,
  longestEdge,
  panel,
  panelAround,
  prism,
  rngFor,
  scaled,
  walls,
  type Edge,
  type Parts,
  type Rng,
} from "./kit";
import { houseUpper, longFirst, towerSections } from "./shape";
import type { MeshBuilder, V3 } from "../render/meshBuilder";

export interface BuildingStyle {
  detail(p: Parts, b: BuildingData, rng: Rng): void;
  massing(p: Parts, b: BuildingData, rng: Rng): void;
}

const registry = new Map<string, BuildingStyle>();

export function registerStyle(name: string, style: BuildingStyle): void {
  registry.set(name, style);
}

export function styleFor(name: string): BuildingStyle {
  return registry.get(name) ?? registry.get("default")!;
}

export const styleNames = () => [...registry.keys()];

/** Build one building into `parts` at the requested level of detail. */
export function buildBuilding(p: Parts, b: BuildingData, lod: "detail" | "massing"): void {
  const style = styleFor(b.style);
  style[lod](p, b, rngFor(b.seed));
}

// ---- Palette -----------------------------------------------------------------

const hex = (h: string) => new Color(h);
const P = {
  glass: ["#8fb3c9", "#7ea5bd", "#9dbccc", "#7598ad", "#a6c2cf", "#88a9b5"].map(hex),
  glassLight: hex("#b3cad6"),
  railing: hex("#9fb6c2"),
  frame: ["#2b3035", "#3a3f45", "#8e979d"].map(hex),
  white: ["#eeece6", "#e6e3db", "#f2f1ee"].map(hex),
  concrete: ["#c8c5be", "#b9b6ae", "#d2cfc8"].map(hex),
  warm: ["#d9cbb6", "#cdbba3", "#e1d6c4"].map(hex),
  brick: ["#8a4b37", "#9b573d", "#6e3f31", "#a8664a"].map(hex),
  charcoal: ["#3a3c3f", "#45474a", "#2f3134"].map(hex),
  timber: ["#a3734c", "#b58258", "#8f6342"].map(hex),
  cladding: ["#8d979e", "#b3ab98", "#7f8b84", "#a4a9ad", "#5f6d78"].map(hex),
  roof: hex("#b3b4b2"),
  roofDark: hex("#3e4246"),
  green: hex("#7fa46a"),
  door: hex("#2e2a27"),
};

/** Walls start this far below the pad so sloped ground never shows a gap. */
const FOUNDATION = 2;

const yAt = (b: BuildingData, floor: number) => b.baseY + floor * b.floorHeight;
const top = (b: BuildingData) => yAt(b, b.floors);

/** Center (s) of the doorway on an edge, or the edge middle. */
function doorCenter(e: Edge, b: BuildingData): number {
  const d = b.entrance;
  if (!d) return e.len / 2;
  return (d.x - e.a[0]) * e.tx + (d.z - e.a[1]) * e.tz;
}

/** Canopy over the front door, `w` wide and `depth` deep. */
function canopy(p: Parts, E: Edge[], b: BuildingData, y: number, w: number, depth: number, c: Color) {
  const front = E[frontEdge(E, b.entrance)];
  const s = Math.min(front.len - w / 2, Math.max(w / 2, doorCenter(front, b)));
  box(p.metal, front, s - w / 2, s + w / 2, y, y + 0.35, 0, depth, c);
}

/** Window: a dark frame panel with a slightly smaller glass pane in front. */
function windowOn(p: Parts, e: Edge, s0: number, s1: number, y0: number, y1: number, glass: Color, frame: Color, out = 0) {
  const f = 0.08;
  panel(p.metal, e, s0 - f, s1 + f, y0 - f, y1 + f, out + 0.02, frame);
  panel(p.glass, e, s0, s1, y0, y1, out + 0.04, glass);
}

function plinth(p: Parts, b: BuildingData, poly: readonly P2[], c: Color) {
  walls(p.matte, edgesOf(poly), b.baseY - FOUNDATION, b.baseY + 0.25, c, 0.05, b.entrance);
}

function parapet(mb: MeshBuilder, edges: Edge[], y: number, h: number, c: Color) {
  band(mb, edges, y, y + h, 0.05, c, 0.3);
}

// ---- Glass tower ------------------------------------------------------------

registerStyle("glass-tower", {
  detail(p, b, rng) {
    const glass = rng.pick(P.glass);
    const frame = rng.pick(P.frame);
    const slab = rng.pick(P.concrete);
    const fins = rng.chance(0.5);
    const sections = towerSections(b);
    plinth(p, b, sections[0].poly, slab);
    sections.forEach((sec, i) => {
      const E = edgesOf(sec.poly);
      const y0 = yAt(b, sec.f0);
      const y1 = yAt(b, sec.f1);
      walls(p.glass, E, y0, y1, glass, 0, i === 0 ? b.entrance : undefined);
      // Slab edges every floor (every other floor on finned towers).
      for (let f = sec.f0 + 1; f < sec.f1; f += fins ? 2 : 1) band(p.matte, E, yAt(b, f) - 0.18, yAt(b, f) + 0.18, 0.12, slab);
      if (fins) {
        for (const e of E) for (const s of bays(e.len, 3, 0.4)) box(p.metal, e, s - 0.07, s + 0.07, y0 + (i === 0 ? b.floorHeight * 2 : 0), y1, 0, 0.45, frame);
      }
      cap(p.matte, sec.poly, y1, P.roof);
      parapet(p.metal, E, y1, 1.1, frame);
    });
    // Double-height lobby: darker frame band and an entrance canopy.
    const E0 = edgesOf(sections[0].poly);
    band(p.metal, E0, b.baseY + 2 * b.floorHeight - 0.4, b.baseY + 2 * b.floorHeight, 0.2, frame);
    canopy(p, E0, b, b.baseY + 4.2, 9, 3.2, frame);
    doorFrame(p.metal, E0, b.entrance, frame);
    // Crown: plant room, and a mast on the tallest towers.
    const last = sections[sections.length - 1];
    const t = top(b);
    prism(p.matte, scaled(last.poly, 0.45), t, t + 4.5, slab, P.roof);
    if (b.floors > 34) prism(p.metal, scaled(last.poly, 0.05), t + 4.5, t + 22, frame);
  },
  massing(p, b, rng) {
    const glass = rng.pick(P.glass);
    for (const sec of towerSections(b)) {
      walls(p.glass, edgesOf(sec.poly), sec.f0 === 0 ? b.baseY - FOUNDATION : yAt(b, sec.f0), yAt(b, sec.f1), glass);
      cap(p.matte, sec.poly, yAt(b, sec.f1), P.roof);
    }
  },
});

// ---- Office: ribbon windows and sunshade fins -------------------------------

const office: BuildingStyle = {
  detail(p, b, rng) {
    const E = edgesOf(b.footprint);
    const glass = rng.pick(P.glass);
    const spandrel = rng.pick([...P.white, ...P.concrete]);
    const frame = rng.pick(P.frame);
    const t = top(b);
    plinth(p, b, b.footprint, spandrel);
    walls(p.glass, E, b.baseY, t, glass, 0, b.entrance);
    doorFrame(p.metal, E, b.entrance, frame);
    for (let f = 1; f <= b.floors; f++) band(p.matte, E, yAt(b, f) - 1.0, yAt(b, f) + (f === b.floors ? 0.6 : 0.1), 0.12, spandrel);
    if (rng.chance(0.6)) {
      for (const e of E) for (const s of bays(e.len, 3, 0.5)) box(p.matte, e, s - 0.08, s + 0.08, yAt(b, 1) - 1, t, 0, 0.7, spandrel);
    }
    cap(p.matte, b.footprint, t + 0.6, P.roof);
    canopy(p, E, b, b.baseY + 3.0, 6, 2.4, frame);
    prism(p.matte, scaled(b.footprint, 0.35), t + 0.6, t + 3.2, P.concrete[1], P.roof);
  },
  massing(p, b) {
    walls(p.glass, edgesOf(b.footprint), b.baseY - FOUNDATION, top(b), P.glassLight);
    cap(p.matte, b.footprint, top(b), P.roof);
  },
};
registerStyle("office", office);
registerStyle("default", office);

// ---- Mid-rise residential: punched windows, balconies, shops below ---------

function midrise(palette: Color[], retailChance: number): BuildingStyle {
  return {
    detail(p, b, rng) {
      const E = edgesOf(b.footprint);
      const wall = rng.pick(palette);
      const frame = rng.pick(P.frame);
      const glass = rng.pick(P.glass);
      const accent = rng.chance(0.5) ? rng.pick(P.timber) : rng.pick(P.white);
      const retail = rng.chance(retailChance);
      const tall = rng.chance(0.5); // floor-to-ceiling vs. punched windows
      const t = top(b);
      const li = longestEdge(E);
      const balconyEdges = new Set(E.length === 4 ? [li, (li + 2) % 4] : [li]);
      plinth(p, b, b.footprint, P.concrete[1]);

      // Ground floor.
      const g1 = yAt(b, 1);
      if (retail) {
        for (const e of E) {
          const cuts = bays(e.len, 5);
          for (let k = 0; k + 1 < cuts.length; k++) {
            if (!hitsDoor(e, cuts[k] - 0.25, cuts[k] + 0.25, b.baseY, b.entrance)) {
              box(p.matte, e, cuts[k] - 0.25, cuts[k] + 0.25, b.baseY, g1, 0, 0.15, wall);
            }
            panelAround(p.glass, e, cuts[k] + 0.25, cuts[k + 1] - 0.25, b.baseY + 0.2, g1 - 0.6, -0.1, glass, b.entrance);
          }
          box(p.metal, e, 0, e.len, g1 - 0.7, g1 - 0.4, 0, 1.4, frame); // canopy
        }
        walls(p.matte, E, g1 - 0.6, t, wall);
      } else {
        walls(p.matte, E, b.baseY, t, wall, 0, b.entrance);
      }
      doorFrame(p.metal, E, b.entrance, frame);

      // Upper floors.
      E.forEach((e, ei) => {
        const cuts = bays(e.len, 3.4, 0.6);
        for (let f = retail ? 1 : 0; f < b.floors; f++) {
          const y = yAt(b, f);
          for (let k = 0; k + 1 < cuts.length; k++) {
            const s0 = cuts[k] + 0.6;
            const s1 = cuts[k + 1] - 0.6;
            if (s1 - s0 < 0.6) continue;
            const balcony = f >= 1 && balconyEdges.has(ei) && k % 2 === (f % 2);
            const y0 = y + (tall || balcony ? 0.1 : 0.9);
            if (hitsDoor(e, s0, s1, y0, b.entrance)) continue;
            windowOn(p, e, s0, s1, y0, y + b.floorHeight - 0.5, glass, frame);
            if (balcony) {
              box(p.matte, e, s0 - 0.4, s1 + 0.4, y - 0.15, y + 0.05, 0, 1.5, accent);
              panel(p.glass, e, s0 - 0.35, s1 + 0.35, y + 0.05, y + 1.05, 1.48, P.railing);
              box(p.metal, e, s0 - 0.35, s1 + 0.35, y + 1.05, y + 1.1, 1.42, 1.5, frame);
            }
          }
        }
      });
      band(p.matte, E, t - 0.1, t + 0.7, 0.15, wall.clone().offsetHSL(0, 0, 0.06));
      cap(p.matte, b.footprint, t + 0.4, P.roof);
      if (rng.chance(0.4)) cap(p.matte, scaled(b.footprint, 0.75), t + 0.45, P.green);
    },
    massing(p, b, rng) {
      prism(p.matte, b.footprint, b.baseY - FOUNDATION, top(b), rng.pick(palette), P.roof);
    },
  };
}
registerStyle("apartment", midrise([...P.white, ...P.warm], 0.35));
registerStyle("brick-midrise", midrise(P.brick, 0.8));

// ---- Houses ------------------------------------------------------------------

function modernHouse(p: Parts, b: BuildingData, rng: Rng) {
  const render = rng.pick(P.white);
  const upperClad = rng.chance(0.55) ? rng.pick(P.timber) : rng.pick(P.charcoal);
  const frame = P.frame[0];
  const glass = rng.pick(P.glass);
  const fh = b.floorHeight;
  const y1 = b.baseY + fh;
  const q = longFirst(b.footprint);
  const E = edgesOf(q);
  const fi = frontEdge(E, b.entrance);
  const garden = E.length === 4 ? (fi + 2) % 4 : longestEdge(E);

  plinth(p, b, q, P.concrete[1]);
  walls(p.matte, E, b.baseY, y1, render, 0, b.entrance);
  doorFrame(p.metal, E, b.entrance, frame);
  // Big sliding glazing on the garden side, smaller windows elsewhere.
  E.forEach((e, k) => {
    if (k === garden) windowOn(p, e, e.len * 0.12, e.len * 0.78, b.baseY + 0.1, y1 - 0.4, glass, frame);
    else if (e.len > 4) {
      // Shift the window clear of the front door if they would overlap.
      const [s0, s1] = hitsDoor(e, e.len * 0.25, e.len * 0.6, b.baseY + 1.0, b.entrance) ? [e.len * 0.66, e.len * 0.9] : [e.len * 0.25, e.len * 0.6];
      if (!hitsDoor(e, s0, s1, b.baseY + 1.0, b.entrance)) windowOn(p, e, s0, s1, b.baseY + 1.0, b.baseY + 2.4, glass, frame);
    }
  });
  cap(p.matte, q, y1, P.roof);

  const up = houseUpper(b);
  if (up) {
    const upper = up.poly;
    const h = fh * (b.floors - 1);
    const UE = edgesOf(upper);
    walls(p.matte, UE, y1, y1 + h, upperClad);
    cap(p.matte, upper, y1, upperClad, true); // soffit under the cantilever
    const uf = UE[longestEdge(UE)];
    windowOn(p, uf, uf.len * 0.1, uf.len * 0.9, y1 + 0.9, y1 + h - 0.6, glass, frame);
    prism(p.matte, scaled(upper, 1.06), y1 + h, y1 + h + 0.25, render);
    if (rng.chance(0.5)) cap(p.matte, scaled(q, 0.8), y1 + 0.05, P.green);
  } else {
    prism(p.matte, scaled(q, 1.05), y1, y1 + 0.25, render);
  }
}

function pitchedHouse(p: Parts, b: BuildingData, rng: Rng) {
  const wall = rng.chance(0.6) ? rng.pick(P.white) : rng.pick(P.charcoal);
  const glass = rng.pick(P.glass);
  const frame = P.frame[0];
  const q = longFirst(b.footprint);
  const E = edgesOf(q);
  const t = top(b);
  plinth(p, b, q, P.concrete[1]);
  walls(p.matte, E, b.baseY, t, wall, 0, b.entrance);
  doorFrame(p.metal, E, b.entrance, frame);
  E.forEach((e, k) => {
    if (k % 2 === 0) {
      for (const s of bays(e.len, 3.2, 1).slice(0, -1)) {
        for (let f = 0; f < b.floors; f++) {
          const y0 = yAt(b, f) + (f === 0 ? 0.1 : 0.8);
          if (hitsDoor(e, s + 0.7, s + 2.0, y0, b.entrance)) continue;
          windowOn(p, e, s + 0.7, s + 2.0, y0, yAt(b, f) + b.floorHeight - 0.5, glass, frame);
        }
      }
    } else if (!hitsDoor(e, e.len * 0.3, e.len * 0.7, b.baseY, b.entrance)) {
      // Tall glazed gable end.
      windowOn(p, e, e.len * 0.3, e.len * 0.7, b.baseY + 0.1, t - 0.4, glass, frame);
    }
  });
  pitchedRoof(p.matte, q, t, b.roof === "hip", P.roofDark, wall);
}

/** Gable or hip roof over a quad footprint; the ridge runs along the longer axis. */
export function pitchedRoof(mb: MeshBuilder, fp: P2[], y: number, hip: boolean, color: Color, gableColor: Color) {
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
    const ux = (r1[0] - r0[0]) / ridgeLen, uz = (r1[1] - r0[1]) / ridgeLen;
    r0 = [r0[0] + ux * inset, r0[1] + uz * inset];
    r1 = [r1[0] - ux * inset, r1[1] - uz * inset];
  }
  const v = (p: P2, h = y): V3 => [p[0], h, p[1]];
  const R0 = v(r0, y + rise), R1 = v(r1, y + rise);
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4;
  const cz = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const outward = (a: P2, b: P2): V3 => [(a[0] + b[0]) / 2 - cx, 0.5, (a[1] + b[1]) / 2 - cz];
  mb.quadFacing(v(p0), v(p1), R1, R0, outward(p0, p1), color);
  mb.quadFacing(v(p2), v(p3), R0, R1, outward(p2, p3), color);
  mb.triFacing(v(p1), v(p2), R1, outward(p1, p2), hip ? color : gableColor);
  mb.triFacing(v(p3), v(p0), R0, outward(p3, p0), hip ? color : gableColor);
}

registerStyle("suburban-house", {
  detail(p, b, rng) {
    const pitched = (b.roof === "gable" || b.roof === "hip") && b.footprint.length === 4;
    if (pitched) pitchedHouse(p, b, rng);
    else modernHouse(p, b, rng);
  },
  massing(p, b, rng) {
    const q = b.footprint.length === 4 ? longFirst(b.footprint) : [...b.footprint];
    const wall = rng.pick(P.white);
    walls(p.matte, edgesOf(q), b.baseY - FOUNDATION, top(b), wall);
    if ((b.roof === "gable" || b.roof === "hip") && q.length === 4) pitchedRoof(p.matte, q, top(b), b.roof === "hip", P.roofDark, wall);
    else cap(p.matte, q, top(b), P.roof);
  },
});

// ---- Industrial: ribbed cladding, clerestory, loading doors ------------------

registerStyle("industrial", {
  detail(p, b, rng) {
    const E = edgesOf(b.footprint);
    const clad = rng.pick(P.cladding);
    const rib = clad.clone().offsetHSL(0, 0, -0.06);
    const t = top(b);
    plinth(p, b, b.footprint, P.concrete[1]);
    walls(p.matte, E, b.baseY, t, clad, 0, b.entrance);
    for (const e of E) {
      for (const s of bays(e.len, 1.6)) {
        if (!hitsDoor(e, s - 0.06, s + 0.06, b.baseY, b.entrance)) box(p.matte, e, s - 0.06, s + 0.06, b.baseY + 0.3, t - 1.6, 0, 0.1, rib);
      }
      panel(p.glass, e, 0.3, e.len - 0.3, t - 1.5, t - 0.4, 0.12, P.glassLight);
    }
    // Loading doors; the open one is the way in.
    const front = E[frontEdge(E, b.entrance)];
    const doors = bays(front.len, 9, 3);
    for (let k = 0; k + 1 < doors.length; k++) {
      const c = (doors[k] + doors[k + 1]) / 2;
      if (!hitsDoor(front, c - 2.2, c + 2.2, b.baseY, b.entrance)) panel(p.metal, front, c - 2.2, c + 2.2, b.baseY, b.baseY + 4.6, 0.14, P.charcoal[0]);
    }
    doorFrame(p.metal, E, b.entrance, P.charcoal[0]);
    cap(p.matte, b.footprint, t, P.roof);
    parapet(p.matte, E, t, 0.6, rib);
    for (let k = 0; k < 3; k++) {
      const c = scaled(b.footprint, rng.range(0.08, 0.14)).map(([x, z]) => [x + rng.range(-8, 8), z + rng.range(-8, 8)] as P2);
      prism(p.metal, c, t, t + 1.6, P.frame[2]);
    }
  },
  massing(p, b, rng) {
    prism(p.matte, b.footprint, b.baseY - FOUNDATION, top(b), rng.pick(P.cladding), P.roof);
  },
});

// ---- Civic: colonnade, glazed ground floor, floating roof --------------------

registerStyle("civic", {
  detail(p, b, rng) {
    const fp = b.footprint.map((q) => [q[0], q[1]] as P2);
    const E = edgesOf(fp);
    const stone = rng.pick(P.white);
    const glass = rng.pick(P.glass);
    const g = b.baseY + b.floorHeight * 1.4;
    const t = top(b);
    plinth(p, b, fp, P.concrete[2]);
    const core = insetConvex(fp, 3) ?? fp;
    walls(p.glass, edgesOf(core), b.baseY, g, glass, 0, b.entrance);
    doorFrame(p.metal, edgesOf(core), b.entrance, P.frame[0]);
    cap(p.matte, core, b.baseY + 0.02, P.concrete[2]); // arcade floor
    for (const e of E) for (const s of bays(e.len, 6, 0.6)) box(p.matte, e, s - 0.35, s + 0.35, b.baseY, g, -0.7, 0, stone);
    walls(p.matte, E, g, t, stone);
    cap(p.matte, fp, g, stone, true); // arcade ceiling
    for (const e of E) {
      for (const s of bays(e.len, 3, 1.5)) panel(p.glass, e, s - 0.45, s + 0.45, g + 0.8, t - 1.2, 0.03, glass);
    }
    const roof = insetConvex(fp, -2.5) ?? fp;
    prism(p.matte, roof, t + 0.4, t + 1.3, stone);
    cap(p.matte, roof, t + 0.4, stone, true);
  },
  massing(p, b, rng) {
    prism(p.matte, b.footprint, b.baseY - FOUNDATION, top(b), rng.pick(P.white), P.roof);
  },
});

