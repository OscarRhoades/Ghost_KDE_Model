/**
 * Catalogs: named, tagged, weighted collections of things the engine can
 * build. Props, facade systems, massing shapes, shopfronts, room types and
 * landmarks each live in their own catalog. City files and generators refer to
 * entries by name; when a file leaves a choice open, the engine picks from a
 * catalog with the building's seed, so results are deterministic.
 */

export interface CatalogEntry<T> {
  name: string;
  item: T;
  tags: ReadonlySet<string>;
  weight: number;
}

export interface RegisterOptions {
  tags?: string[];
  /** Relative likelihood when picked at random (default 1). */
  weight?: number;
}

export class Catalog<T> {
  private readonly entries = new Map<string, CatalogEntry<T>>();

  constructor(readonly kind: string) {
    allCatalogs.set(kind, this as Catalog<unknown>);
  }

  register(name: string, item: T, opts: RegisterOptions = {}): this {
    this.entries.set(name, { name, item, tags: new Set(opts.tags ?? []), weight: opts.weight ?? 1 });
    return this;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): T | undefined {
    return this.entries.get(name)?.item;
  }

  /** Like `get`, but throws with the list of known names. */
  require(name: string): T {
    const e = this.entries.get(name);
    if (!e) throw new Error(`unknown ${this.kind} "${name}"; known: ${[...this.entries.keys()].join(", ")}`);
    return e.item;
  }

  /** Entries carrying every one of `tags` (all entries when empty). */
  list(tags: string | string[] = []): CatalogEntry<T>[] {
    const want = Array.isArray(tags) ? tags : [tags];
    return [...this.entries.values()].filter((e) => want.every((t) => e.tags.has(t)));
  }

  names(tags: string | string[] = []): string[] {
    return this.list(tags).map((e) => e.name);
  }

  get size(): number {
    return this.entries.size;
  }

  /** Weighted random pick among entries with all `tags`. `rand` returns [0, 1). */
  pick(rand: () => number, tags: string | string[] = []): CatalogEntry<T> {
    const pool = this.list(tags);
    if (pool.length === 0) throw new Error(`no ${this.kind} tagged ${JSON.stringify(tags)}`);
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = rand() * total;
    for (const e of pool) {
      r -= e.weight;
      if (r < 0) return e;
    }
    return pool[pool.length - 1];
  }
}

const allCatalogs = new Map<string, Catalog<unknown>>();

/** Every catalog and its entry names, e.g. for documentation or a debug panel. */
export function describeCatalogs(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [kind, c] of allCatalogs) out[kind] = c.names();
  return out;
}
