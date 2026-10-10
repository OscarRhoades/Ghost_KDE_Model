import { describe, expect, it } from "vitest";
import { defineComponent, defineResource, Schedule, World } from "../src/ecs/world";

const Pos = defineComponent<{ x: number }>("Pos");
const Tag = defineComponent<true>("Tag");
const Clock = defineResource<number>("Clock");

describe("World", () => {
  it("queries entities having every component", () => {
    const w = new World();
    const a = w.spawn();
    const b = w.spawn();
    w.add(a, Pos, { x: 1 }).add(a, Tag, true);
    w.add(b, Pos, { x: 2 });
    expect([...w.query(Pos)]).toEqual([a, b]);
    expect([...w.query(Pos, Tag)]).toEqual([a]);
    w.despawn(a);
    expect([...w.query(Pos, Tag)]).toEqual([]);
    expect(w.get(a, Pos)).toBeUndefined();
  });

  it("refuses components on dead entities and reports missing ones", () => {
    const w = new World();
    const e = w.spawn();
    w.despawn(e);
    expect(() => w.add(e, Tag, true)).toThrow(/not alive/);
    expect(() => w.read(w.spawn(), Pos)).toThrow(/no Pos/);
  });

  it("keeps resources across clearEntities", () => {
    const w = new World();
    w.setResource(Clock, 5);
    w.add(w.spawn(), Tag, true);
    w.clearEntities();
    expect(w.count(Tag)).toBe(0);
    expect(w.resource(Clock)).toBe(5);
  });
});

describe("Schedule", () => {
  it("runs systems in registration order and rejects duplicates", () => {
    const s = new Schedule();
    const log: string[] = [];
    s.add({ name: "a", update: () => log.push("a") });
    s.add({ name: "b", update: () => log.push("b") });
    s.update(new World(), 0.016);
    expect(log).toEqual(["a", "b"]);
    expect(() => s.add({ name: "a" })).toThrow(/already registered/);
  });
});
