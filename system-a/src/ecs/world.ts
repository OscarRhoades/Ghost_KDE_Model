/**
 * Minimal entity-component-system.
 *
 * Entities are integers. Components are typed keys created with
 * `defineComponent`; each component owns a sparse store (Map) of values.
 * Resources are world-level singletons (the scene, the heightfield, ...).
 * Systems are plain objects scheduled by `Schedule`.
 */

export type Entity = number;

export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Phantom field so `ComponentType<A>` and `ComponentType<B>` don't unify. */
  readonly __type?: T;
}

export interface ResourceKey<T> {
  readonly key: symbol;
  readonly name: string;
  readonly __type?: T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string): ComponentType<T> {
  return { id: nextComponentId++, name };
}

export function defineResource<T>(name: string): ResourceKey<T> {
  return { key: Symbol(name), name };
}

export class World {
  private nextEntity: Entity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores = new Map<number, Map<Entity, unknown>>();
  private readonly resources = new Map<symbol, unknown>();

  spawn(): Entity {
    const e = this.nextEntity++;
    this.alive.add(e);
    return e;
  }

  despawn(e: Entity): void {
    if (!this.alive.delete(e)) return;
    for (const store of this.stores.values()) store.delete(e);
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  add<T>(e: Entity, c: ComponentType<T>, value: T): this {
    if (!this.alive.has(e)) throw new Error(`add ${c.name}: entity ${e} is not alive`);
    this.store(c).set(e, value);
    return this;
  }

  get<T>(e: Entity, c: ComponentType<T>): T | undefined {
    return this.stores.get(c.id)?.get(e) as T | undefined;
  }

  /** Like `get`, but throws if the component is missing. */
  read<T>(e: Entity, c: ComponentType<T>): T {
    const v = this.get(e, c);
    if (v === undefined) throw new Error(`entity ${e} has no ${c.name}`);
    return v;
  }

  has(e: Entity, c: ComponentType<unknown>): boolean {
    return this.stores.get(c.id)?.has(e) ?? false;
  }

  remove(e: Entity, c: ComponentType<unknown>): void {
    this.stores.get(c.id)?.delete(e);
  }

  /** Entities that have every listed component. Iterates the smallest store. */
  *query(...components: ComponentType<unknown>[]): IterableIterator<Entity> {
    if (components.length === 0) {
      yield* this.alive;
      return;
    }
    const stores = components.map((c) => this.stores.get(c.id) ?? new Map<Entity, unknown>());
    stores.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = stores;
    for (const e of smallest.keys()) {
      if (rest.every((s) => s.has(e))) yield e;
    }
  }

  count(c: ComponentType<unknown>): number {
    return this.stores.get(c.id)?.size ?? 0;
  }

  setResource<T>(r: ResourceKey<T>, value: T): void {
    this.resources.set(r.key, value);
  }

  getResource<T>(r: ResourceKey<T>): T | undefined {
    return this.resources.get(r.key) as T | undefined;
  }

  resource<T>(r: ResourceKey<T>): T {
    const v = this.getResource(r);
    if (v === undefined) throw new Error(`missing resource ${r.name}`);
    return v;
  }

  hasResource(r: ResourceKey<unknown>): boolean {
    return this.resources.has(r.key);
  }

  /** Remove all entities and components; resources are kept. */
  clearEntities(): void {
    this.alive.clear();
    this.stores.clear();
  }

  private store<T>(c: ComponentType<T>): Map<Entity, T> {
    let s = this.stores.get(c.id);
    if (!s) {
      s = new Map();
      this.stores.set(c.id, s);
    }
    return s as Map<Entity, T>;
  }
}

export interface System {
  readonly name: string;
  /** Called once when the engine starts (before any city is loaded). */
  start?(world: World): void;
  /** Called after a city file has been loaded into the world. */
  onLoad?(world: World): void;
  /** Called before the world is cleared for a new city. */
  onUnload?(world: World): void;
  /** Called every frame. `dt` is in seconds. */
  update?(world: World, dt: number): void;
}

/** Ordered list of systems. Registration order is execution order. */
export class Schedule {
  private readonly systems: System[] = [];

  add(system: System): void {
    if (this.systems.some((s) => s.name === system.name)) {
      throw new Error(`system "${system.name}" already registered`);
    }
    this.systems.push(system);
  }

  get names(): string[] {
    return this.systems.map((s) => s.name);
  }

  start(world: World): void {
    for (const s of this.systems) s.start?.(world);
  }

  onLoad(world: World): void {
    for (const s of this.systems) s.onLoad?.(world);
  }

  onUnload(world: World): void {
    for (const s of this.systems) s.onUnload?.(world);
  }

  update(world: World, dt: number): void {
    for (const s of this.systems) s.update?.(world, dt);
  }
}
