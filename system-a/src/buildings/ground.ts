/**
 * Ground-floor uses: shopfronts and arcades. A use draws the ground floor of a
 * building's main volume: shopfronts on every wall facing a street, plain
 * walls with windows elsewhere, plus things set out on the pavement.
 */
import { Color } from "three";
import { Catalog } from "../catalog/registry";
import type { BuildingData } from "../engine/components";
import { bays, box, doorOn, panel, walls, type Edge, type Parts } from "./kit";
import { windowOn, type FacadeCtx, type Slice } from "./facades";
import { lookRng, SWATCH } from "./look";

export interface ShopKind {
  /** Fascia (sign band) colors to pick from. */
  fascia: string[];
  /** Lettering color on the fascia. */
  lettering: string;
  awning?: [string, string];
  /** Tables set out on the pavement. */
  seating?: number;
  /** Extra details on a street wall. */
  extras?(p: Parts, e: Edge, ctx: FacadeCtx, y: number): void;
  /** Interior room kind for the ground floor. */
  room: "cafe" | "shop" | "restaurant" | "bank" | "lobby";
}

export const groundCatalog = new Catalog<ShopKind>("ground-floor use");

const hex = (h: string) => new Color(h);

/** Crates of produce on the pavement. */
function crates(p: Parts, e: Edge, s: number, y: number) {
  const colors = ["#c8463a", "#e0a23a", "#6aa04a", "#d9c25a"].map(hex);
  for (let k = 0; k < 4; k++) {
    box(p.matte, e, s + k * 0.7, s + k * 0.7 + 0.6, y, y + 0.35, 0.2, 0.7, SWATCH.timber[1]);
    box(p.matte, e, s + k * 0.7 + 0.05, s + k * 0.7 + 0.55, y + 0.35, y + 0.45, 0.25, 0.65, colors[k]);
  }
}

groundCatalog.register("cafe", { fascia: ["#2f4a3a", "#1f2a33", "#5a3a2a"], lettering: "#f2e6c8", awning: ["#f1ead8", "#2f4a3a"], seating: 3, room: "cafe" }, { tags: ["shop", "food"] });
groundCatalog.register("bakery", {
  fascia: ["#d9a441", "#b5653f"],
  lettering: "#fff6e0",
  awning: ["#f6efe2", "#c4573b"],
  seating: 1,
  room: "cafe",
  extras(p, e, _ctx, y) {
    // Bread display shelves behind the window.
    for (let k = 0; k < 3; k++) box(p.matte, e, 1, e.len - 1, y + 0.6 + k * 0.45, y + 0.65 + k * 0.45, -0.9, -0.5, SWATCH.timber[0]);
  },
}, { tags: ["shop", "food"] });
groundCatalog.register("corner-shop", {
  fascia: ["#2f6e9e", "#3f7f8c"],
  lettering: "#ffffff",
  awning: ["#2f6e9e", "#ffffff"],
  room: "shop",
  extras(p, e, _ctx, y) {
    crates(p, e, 1.2, y);
  },
}, { tags: ["shop"] });
groundCatalog.register("bank", {
  fascia: ["#1f2a44", "#2b3035"],
  lettering: "#d9c27a",
  room: "bank",
  extras(p, e, _ctx, y) {
    // ATM: a dark panel with a lit screen.
    const s = Math.max(1, e.len - 2.4);
    panel(p.metal, e, s, s + 0.9, y + 0.9, y + 2.0, 0.06, SWATCH.charcoal[2]);
    panel(p.glow, e, s + 0.2, s + 0.7, y + 1.45, y + 1.8, 0.08, hex("#7fd0ff"));
  },
}, { tags: ["shop"] });
groundCatalog.register("pharmacy", {
  fascia: ["#f2f1ee"],
  lettering: "#2f8a4a",
  room: "shop",
  extras(p, e, ctx, y) {
    // Projecting green cross sign.
    const s = 0.6;
    const yc = y + ctx.fh - 0.4;
    box(p.glow, e, s - 0.05, s + 0.05, yc - 0.45, yc + 0.45, 0.2, 0.9, hex("#2fbf5a"));
    box(p.glow, e, s - 0.05, s + 0.05, yc - 0.15, yc + 0.15, 0.2, 0.9, hex("#2fbf5a"));
    box(p.glow, e, s - 0.05, s + 0.05, yc - 0.45, yc + 0.45, 0.4, 0.7, hex("#2fbf5a"));
  },
}, { tags: ["shop"] });
groundCatalog.register("restaurant", { fascia: ["#7a1f22", "#3a2a24"], lettering: "#f2dca0", awning: ["#7a1f22", "#7a1f22"], seating: 4, room: "restaurant" }, { tags: ["shop", "food"] });
groundCatalog.register("boutique", { fascia: ["#151515", "#e9e6df"], lettering: "#c9a24a", room: "shop" }, { tags: ["shop"] });
groundCatalog.register("bike-shop", {
  fascia: ["#d9762b"],
  lettering: "#1f1f1f",
  room: "shop",
  extras(p, e, _ctx, y) {
    // A row of bikes: wheels as thin discs (boxes) and frames.
    for (let k = 0; k < 3; k++) {
      const s = 1 + k * 0.8;
      box(p.metal, e, s, s + 0.04, y, y + 0.65, 0.4, 2.0, SWATCH.charcoal[0]);
      box(p.metal, e, s, s + 0.04, y + 0.65, y + 0.7, 0.8, 1.6, hex("#c4573b"));
    }
  },
}, { tags: ["shop"] });
groundCatalog.register("arcade", { fascia: [], lettering: "#ffffff", room: "lobby" }, { tags: ["office"] });

/** Share of buildings of a style that get a shop on the ground floor (styles not built in). */
export const styleShopChance = new Map<string, number>();

/** Which ground-floor use a building has: from the file, or by style and seed. */
export function groundUseOf(b: BuildingData): string {
  if (b.ground) return b.ground === "none" || groundCatalog.has(b.ground) ? b.ground : "none";
  const rng = lookRng(b, 0x6a0d);
  const shop = () => groundCatalog.pick(rng.next, "shop").name;
  switch (b.style) {
    case "brick-midrise":
      return rng.chance(0.85) ? shop() : "none";
    case "apartment":
      return rng.chance(0.45) ? shop() : "none";
    case "office":
    case "default":
      return rng.chance(0.25) ? (rng.chance(0.5) ? "cafe" : "restaurant") : rng.chance(0.25) ? "arcade" : "none";
    case "glass-tower":
      return rng.chance(0.3) ? "arcade" : "none";
    default:
      return rng.chance(styleShopChance.get(b.style) ?? 0) ? shop() : "none";
  }
}

export const nearStreet = (e: Edge, pts: [number, number][] | undefined) =>
  !!pts?.some(([x, z]) => Math.hypot(x - (e.a[0] + e.b[0]) / 2, z - (e.a[1] + e.b[1]) / 2) < 0.5);

/** Draw the ground floor (floor 0) of a slice with the given use. */
export function drawGround(p: Parts, s: Slice, ctx: FacadeCtx, use: string): void {
  const b = ctx.b;
  const kind = groundCatalog.require(use);
  const rng = lookRng(b, 0x5409);
  const y = ctx.y(0);
  const top = ctx.y(1);
  const door = ctx.door;
  const fascia = kind.fascia.length ? hex(rng.pick(kind.fascia)) : ctx.pal.trim;
  const letters = hex(kind.lettering);

  if (use === "arcade") {
    // Colonnade standing on the pavement with a soffit over a covered walk.
    walls(p.glass, s.edges, y, top, ctx.pal.glass, 0, door);
    for (const e of s.edges) {
      if (!nearStreet(e, b.streetSides)) continue;
      for (const x of bays(e.len, 5, 0.3)) box(p.matte, e, x - 0.3, x + 0.3, y, top, 2.2, 2.8, ctx.pal.trim);
      box(p.matte, e, -0.2, e.len + 0.2, top - 0.6, top, 0, 2.9, ctx.pal.trim);
    }
    doorFrames(p, s, ctx);
    return;
  }

  for (const e of s.edges) {
    const street = nearStreet(e, b.streetSides) || !!doorOn(e, door);
    if (!street) {
      // Side and back walls: plain wall with a few windows.
      walls(p.matte, [e], y, top, ctx.pal.wall, 0, door);
      for (const x of bays(e.len, 4, 1).slice(0, -1)) windowOn(p, e, x + 1, x + 2.6, y + 1.1, top - 0.6, ctx.pal.glass, ctx.pal.frame);
      continue;
    }
    const d = doorOn(e, door);
    const cuts = bays(e.len, rng.range(4.2, 5.6));
    // Piers, stall risers, shop windows recessed behind the piers.
    for (let k = 0; k < cuts.length; k++) {
      box(p.matte, e, cuts[k] - 0.25, cuts[k] + 0.25, y, top, 0, 0.22, ctx.pal.wall);
      if (k + 1 >= cuts.length) break;
      const s0 = cuts[k] + 0.25;
      const s1 = cuts[k + 1] - 0.25;
      const hasDoor = d && d.s1 > s0 && d.s0 < s1;
      if (hasDoor) {
        // Recessed entrance: glass either side, deep jambs and a soffit.
        if (d.s0 - 0.1 > s0) panel(p.glass, e, s0, d.s0 - 0.1, y + 0.4, top - 1.0, -0.1, ctx.pal.glass);
        if (s1 > d.s1 + 0.1) panel(p.glass, e, d.s1 + 0.1, s1, y + 0.4, top - 1.0, -0.1, ctx.pal.glass);
        box(p.metal, e, d.s0 - 0.1, d.s0, y, d.top, -0.8, 0, ctx.pal.frame);
        box(p.metal, e, d.s1, d.s1 + 0.1, y, d.top, -0.8, 0, ctx.pal.frame);
        panel(p.matte, e, s0, s1, d.top, top - 1.0, -0.1, ctx.pal.wall);
      } else {
        panel(p.metal, e, s0, s1, y, y + 0.4, 0.05, SWATCH.charcoal[1]);
        panel(p.glass, e, s0, s1, y + 0.4, top - 1.0, -0.1, ctx.pal.glass);
        box(p.metal, e, s0, s1, y + 0.4, y + 0.46, -0.1, 0.12, ctx.pal.frame);
      }
    }
    // Fascia with lettering blocks.
    box(p.matte, e, 0, e.len, top - 1.0, top - 0.25, 0, 0.3, fascia);
    let x = 0.8;
    while (x < e.len - 1.2 && x < 9) {
      const w = rng.range(0.2, 0.45);
      box(p.glow, e, x, x + w, top - 0.82, top - 0.43, 0.3, 0.34, letters);
      x += w + rng.range(0.08, 0.16);
    }
    // Awning: alternating stripes sloping down over the pavement.
    if (kind.awning) {
      const [c0, c1] = kind.awning.map(hex);
      const stripes = Math.max(4, Math.round(e.len / 0.6));
      for (let k = 0; k < stripes; k++) {
        const s0 = (e.len * k) / stripes;
        const s1 = (e.len * (k + 1)) / stripes;
        const c = k % 2 ? c1 : c0;
        p.matte.quadFacing(atE(e, s0, top - 1.05, 0.3), atE(e, s1, top - 1.05, 0.3), atE(e, s1, top - 1.6, 1.9), atE(e, s0, top - 1.6, 1.9), [e.nx, 1, e.nz], c);
        p.matte.quadFacing(atE(e, s0, top - 1.05, 0.3), atE(e, s1, top - 1.05, 0.3), atE(e, s1, top - 1.6, 1.9), atE(e, s0, top - 1.6, 1.9), [-e.nx, -1, -e.nz], c);
      }
      box(p.matte, e, 0, e.len, top - 1.75, top - 1.6, 1.88, 1.92, c0); // valance
    }
    kind.extras?.(p, e, ctx, y);
    // Pavement seating: a table with two chairs and a parasol.
    for (let k = 0; k < (kind.seating ?? 0); k++) {
      const c = e.len * ((k + 1) / ((kind.seating ?? 0) + 1));
      if (d && Math.abs(c - (d.s0 + d.s1) / 2) < 1.6) continue;
      box(p.matte, e, c - 0.35, c + 0.35, y + 0.72, y + 0.76, 2.6, 3.3, SWATCH.white[0]);
      box(p.metal, e, c - 0.03, c + 0.03, y, y + 0.72, 2.92, 2.98, SWATCH.charcoal[0]);
      box(p.matte, e, c - 0.85, c - 0.45, y, y + 0.45, 2.75, 3.15, fascia);
      box(p.matte, e, c + 0.45, c + 0.85, y, y + 0.45, 2.75, 3.15, fascia);
      box(p.metal, e, c - 0.02, c + 0.02, y + 0.76, y + 2.3, 2.93, 2.97, SWATCH.charcoal[0]);
      box(p.matte, e, c - 1.0, c + 1.0, y + 2.3, y + 2.36, 1.95, 3.95, SWATCH.white[1]);
    }
  }
  doorFrames(p, s, ctx);
}

const atE = (e: Edge, s: number, y: number, out: number): [number, number, number] => [e.a[0] + e.tx * s + e.nx * out, y, e.a[1] + e.tz * s + e.nz * out];

function doorFrames(p: Parts, s: Slice, ctx: FacadeCtx) {
  for (const e of s.edges) {
    const d = doorOn(e, ctx.door);
    if (!d) continue;
    box(p.metal, e, d.s0 - 0.12, d.s1 + 0.12, d.top, d.top + 0.12, -0.05, 0.12, ctx.pal.frame);
  }
}
