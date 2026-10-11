import { Schedule, World, type System } from "../ecs/world";
import { FORMAT_ID, FORMAT_VERSION, type CityFile } from "../format/schema";
import { CityR, IdIndexR } from "./components";

/**
 * Turns one section of a city file into entities/resources, and back.
 * Loaders run in ascending `order`, so later loaders can rely on earlier ones
 * (roads need terrain; terrain conforming needs roads and parcels).
 */
export interface CityLoader {
  readonly name: string;
  readonly order: number;
  load(world: World, city: CityFile): void;
  /** Write this loader's section into `out`. */
  save?(world: World, out: CityFile): void;
}

/** A bundle of components, loaders and systems. */
export interface Plugin {
  readonly name: string;
  install(engine: Engine): void;
}

export const LoadOrder = {
  terrain: 0,
  roads: 10,
  parcels: 20,
  buildings: 30,
  /** Derived data that needs roads and buildings (front doors). */
  frontage: 40,
  /** Runs after every data section is in the world. */
  conform: 100,
} as const;

export class Engine {
  readonly world = new World();
  readonly schedule = new Schedule();
  private readonly loaders: CityLoader[] = [];
  private readonly plugins: string[] = [];
  private started = false;
  private loaded = false;
  private frame = 0;

  use(plugin: Plugin): this {
    if (this.plugins.includes(plugin.name)) throw new Error(`plugin "${plugin.name}" already installed`);
    plugin.install(this);
    this.plugins.push(plugin.name);
    return this;
  }

  get pluginNames(): readonly string[] {
    return this.plugins;
  }

  addSystem(system: System): this {
    this.schedule.add(system);
    if (this.started) system.start?.(this.world);
    return this;
  }

  addLoader(loader: CityLoader): this {
    this.loaders.push(loader);
    this.loaders.sort((a, b) => a.order - b.order);
    return this;
  }

  start(): this {
    if (!this.started) {
      this.started = true;
      this.schedule.start(this.world);
    }
    return this;
  }

  load(city: CityFile): void {
    this.start();
    this.unload();
    this.world.setResource(CityR, { meta: city.meta, extensions: city.extensions });
    this.world.setResource(IdIndexR, new Map());
    for (const loader of this.loaders) loader.load(this.world, city);
    this.schedule.onLoad(this.world);
    this.loaded = true;
  }

  unload(): void {
    if (!this.loaded) return;
    this.schedule.onUnload(this.world);
    this.world.clearEntities();
    this.loaded = false;
  }

  /** Serialize the current world back into a city file. */
  save(): CityFile {
    const city = this.world.resource(CityR);
    const out = {
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      meta: structuredClone(city.meta),
      roads: { nodes: [], edges: [] },
      parcels: [],
      buildings: [],
      extensions: structuredClone(city.extensions),
    } as unknown as CityFile;
    for (const loader of this.loaders) loader.save?.(this.world, out);
    return out;
  }

  tick(dt: number): void {
    this.schedule.update(this.world, dt);
  }

  /** Start the browser frame loop. */
  run(): void {
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
  }
}
