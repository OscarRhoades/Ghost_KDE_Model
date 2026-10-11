/**
 * `.city.json` — the System-A city file format, version 1.
 *
 * Conventions:
 *  - Units are meters. The ground plane is X (east) / Z (south); Y is up.
 *  - 2D points are `[x, z]`. The terrain spans `[0, size[0]] x [0, size[1]]`.
 *  - Polygons are simple, listed in either winding, without repeating the first point.
 *  - Elevations are optional everywhere: when omitted the engine derives them
 *    from the terrain, so hand-written files can stay 2D.
 *  - Data for plugins lives in `extensions`, keyed by plugin name.
 */
import { z } from "zod";

export const FORMAT_ID = "system-a/city";
export const FORMAT_VERSION = 1;

const finite = z.number().finite();
export const Vec2 = z.tuple([finite, finite]);
export type Vec2 = z.infer<typeof Vec2>;

const Id = z.string().min(1);

export const HeightData = z.discriminatedUnion("encoding", [
  /** Every sample has the same height. */
  z.object({ encoding: z.literal("flat"), value: finite }),
  /** Plain array, row-major (z rows of x samples). Good for small hand-written maps. */
  z.object({ encoding: z.literal("array"), data: z.array(finite) }),
  /** Little-endian uint16 samples, row-major, base64; height = min + v/65535 * (max - min). */
  z.object({
    encoding: z.literal("uint16-base64"),
    min: finite,
    max: finite,
    data: z.string(),
  }),
]);
export type HeightData = z.infer<typeof HeightData>;

export const Terrain = z.object({
  /** World extent in meters: [width along x, depth along z]. */
  size: Vec2,
  /** Sample count along x and z (grid vertices, so cells = resolution - 1). */
  resolution: z.tuple([z.number().int().min(2), z.number().int().min(2)]),
  heights: HeightData,
  /** Water surface height; omit for no water. */
  waterLevel: finite.optional(),
});
export type Terrain = z.infer<typeof Terrain>;

export const ROAD_KINDS = ["highway", "avenue", "street", "lane", "path"] as const;
export const RoadKind = z.enum(ROAD_KINDS);
export type RoadKind = z.infer<typeof RoadKind>;

export const RoadNode = z.object({
  id: Id,
  p: Vec2,
  /** Fixed elevation; derived from the terrain when omitted. */
  y: finite.optional(),
});
export type RoadNode = z.infer<typeof RoadNode>;

export const RoadEdge = z.object({
  id: Id,
  a: Id,
  b: Id,
  kind: RoadKind,
  /** Carriageway width in meters; defaults per kind. */
  width: finite.positive().optional(),
  /** Sidewalk width on each side in meters; defaults per kind. */
  sidewalk: finite.nonnegative().optional(),
  /** Intermediate points between `a` and `b` for curved roads. */
  via: z.array(Vec2).optional(),
  /** Tram tracks run down the middle. */
  tram: z.boolean().optional(),
  /** Spans water or a gap: the terrain under it is left alone. */
  bridge: z.boolean().optional(),
});
export type RoadEdge = z.infer<typeof RoadEdge>;

export const Roads = z.object({
  nodes: z.array(RoadNode).default([]),
  edges: z.array(RoadEdge).default([]),
});

export const ZONES = [
  "commercial",
  "mixed",
  "residential",
  "industrial",
  "civic",
  "park",
  "plaza",
] as const;
export const Zone = z.enum(ZONES);
export type Zone = z.infer<typeof Zone>;

export const Parcel = z.object({
  id: Id,
  polygon: z.array(Vec2).min(3),
  zone: Zone,
  /** Elevation of the flattened building pad; derived from the terrain when omitted. */
  elevation: finite.optional(),
});
export type Parcel = z.infer<typeof Parcel>;

export const ROOF_KINDS = ["flat", "gable", "hip", "shed"] as const;
export const RoofKind = z.enum(ROOF_KINDS);

export const Building = z.object({
  id: Id,
  /** Parcel this building stands on; its pad sets the base elevation. */
  parcel: Id.optional(),
  footprint: z.array(Vec2).min(3),
  floors: z.number().int().min(1).max(300),
  /** Meters per floor; default 3.2. */
  floorHeight: finite.positive().optional(),
  roof: RoofKind.optional(),
  /** Free-form style key interpreted by the building generator, e.g. "glass-tower". */
  style: z.string().optional(),
  /** Seed for procedural detail (facade, interior). Derived from `id` when omitted. */
  seed: z.number().int().optional(),
  /** Massing shape from the shape catalog, e.g. "podium-tower". Picked by style when omitted. */
  shape: z.string().optional(),
  /** Facade system from the facade catalog, e.g. "terracotta-baguettes". Picked by style when omitted. */
  facade: z.string().optional(),
  /** Ground-floor use from the shopfront catalog, e.g. "cafe", or "none". Picked by style when omitted. */
  ground: z.string().optional(),
});
export type Building = z.infer<typeof Building>;

/** A placed item from the prop catalog (tree, bench, fountain...). */
export const Prop = z.object({
  id: Id.optional(),
  kind: z.string().min(1),
  p: Vec2,
  /** Heading in radians around the vertical axis. */
  rot: finite.optional(),
  /** Elevation; on the ground when omitted. */
  y: finite.optional(),
  scale: finite.positive().optional(),
});
export type Prop = z.infer<typeof Prop>;

/** Automatic street dressing derived from the road network. */
export const Streetscape = z.object({
  trees: z.boolean().default(true),
  lamps: z.boolean().default(true),
  furniture: z.boolean().default(true),
  markings: z.boolean().default(true),
  /** Cars parked along streets and in yards. */
  parking: z.boolean().default(true),
  /** Park, plaza, garden and yard layouts. */
  landscape: z.boolean().default(true),
  /** Overall density multiplier (1 = default spacing). */
  density: finite.positive().default(1),
});

export const Meta = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Tool that produced the file, e.g. "generators/demo.ts". */
  generator: z.string().optional(),
  seed: z.number().int().optional(),
});

export const CityFile = z
  .object({
    format: z.literal(FORMAT_ID),
    version: z.literal(FORMAT_VERSION),
    meta: Meta,
    terrain: Terrain,
    roads: Roads.default({}),
    parcels: z.array(Parcel).default([]),
    buildings: z.array(Building).default([]),
    props: z.array(Prop).default([]),
    streetscape: Streetscape.optional(),
    extensions: z.record(z.unknown()).default({}),
  })
  .superRefine((city, ctx) => {
    const [nx, nz] = city.terrain.resolution;
    const h = city.terrain.heights;
    if (h.encoding === "array" && h.data.length !== nx * nz) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terrain", "heights", "data"],
        message: `expected ${nx * nz} samples (${nx}x${nz}), got ${h.data.length}`,
      });
    }
    checkUnique(ctx, city.roads.nodes, ["roads", "nodes"]);
    checkUnique(ctx, city.roads.edges, ["roads", "edges"]);
    checkUnique(ctx, city.parcels, ["parcels"]);
    checkUnique(ctx, city.buildings, ["buildings"]);

    const nodeIds = new Set(city.roads.nodes.map((n) => n.id));
    city.roads.edges.forEach((e, i) => {
      for (const end of ["a", "b"] as const) {
        if (!nodeIds.has(e[end])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["roads", "edges", i, end],
            message: `unknown road node "${e[end]}"`,
          });
        }
      }
      if (e.a === e.b && !e.via?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roads", "edges", i],
          message: "edge connects a node to itself",
        });
      }
    });

    const parcelIds = new Set(city.parcels.map((p) => p.id));
    city.buildings.forEach((b, i) => {
      if (b.parcel !== undefined && !parcelIds.has(b.parcel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buildings", i, "parcel"],
          message: `unknown parcel "${b.parcel}"`,
        });
      }
    });
  });

export type CityFile = z.infer<typeof CityFile>;
/** The shape accepted before defaults are applied (what authors write). */
export type CityFileInput = z.input<typeof CityFile>;

function checkUnique(ctx: z.RefinementCtx, items: { id: string }[], path: (string | number)[]) {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, i, "id"],
        message: `duplicate id "${item.id}"`,
      });
    }
    seen.add(item.id);
  });
}

export class CityFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid city file:\n  ${issues.slice(0, 20).join("\n  ")}${issues.length > 20 ? `\n  ...and ${issues.length - 20} more` : ""}`);
    this.name = "CityFormatError";
  }
}

/** Validate and normalize raw JSON into a `CityFile`. Throws `CityFormatError`. */
export function parseCity(raw: unknown): CityFile {
  const result = CityFile.safeParse(raw);
  if (!result.success) {
    throw new CityFormatError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}

export const ROAD_DEFAULTS: Record<RoadKind, { width: number; sidewalk: number }> = {
  highway: { width: 16, sidewalk: 0 },
  avenue: { width: 14, sidewalk: 4 },
  street: { width: 8, sidewalk: 3 },
  lane: { width: 5, sidewalk: 1.5 },
  path: { width: 3, sidewalk: 0 },
};

export const DEFAULT_FLOOR_HEIGHT = 3.2;
