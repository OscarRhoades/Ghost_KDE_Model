import { IsoControlsR } from "./camera/isoCamera";
import { ViewR } from "./camera/viewMode";
import { LocationR } from "./interiors/interiorView";
import type { StickState } from "./camera/walkCamera";
import { Building, FocusR, Parcel, RoadEdge } from "./engine/components";
import { Engine } from "./engine/engine";
import { parseCity } from "./format/schema";
import { coreDataPlugins, viewerPlugins } from "./plugins";

const hud = document.getElementById("hud")!;
const status = document.getElementById("status")!;
const stickEl = document.getElementById("stick")!;
const knobEl = stickEl.querySelector<HTMLElement>(".knob")!;

function drawStick(s: StickState) {
  stickEl.hidden = !s.active;
  stickEl.style.left = `${s.originX}px`;
  stickEl.style.top = `${s.originY}px`;
  knobEl.style.transform = `translate(${s.dx}px, ${s.dy}px)`;
}

window.addEventListener("hashchange", () => location.reload());

async function main() {
  // ?city=path/to.city.json, or #name for cities/name.city.json (hash survives where queries don't).
  const hash = location.hash.slice(1);
  const url =
    new URLSearchParams(location.search).get("city") ??
    (/^[\w-]+$/.test(hash) ? `cities/${hash}.city.json` : "cities/demo.city.json");
  const engine = new Engine();
  for (const p of [...coreDataPlugins(), ...viewerPlugins({ container: document.getElementById("viewport")!, onStick: drawStick })]) {
    engine.use(p);
  }
  engine.start();

  const controls = engine.world.resource(IsoControlsR);
  const view = engine.world.resource(ViewR);
  const modeButton = document.getElementById("mode") as HTMLButtonElement;
  view.onChange((mode) => {
    document.body.dataset.mode = mode;
    modeButton.textContent = mode === "walk" ? "Map" : "Walk";
  });
  modeButton.addEventListener("click", () => {
    if (view.mode === "iso") view.switchTo("walk", controls.center());
    else {
      // Return to the map centered on where the walker stands.
      const f = engine.world.getResource(FocusR);
      view.switchTo("iso", f ? { x: f.x, z: f.z } : undefined);
    }
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>("#controls button[data-zoom], #controls button[data-rotate]")) {
    b.addEventListener("click", () => {
      if (b.dataset.zoom) controls.zoom(Number(b.dataset.zoom));
      if (b.dataset.rotate) controls.rotate(Number(b.dataset.rotate) as 1 | -1);
    });
  }

  status.textContent = `Loading ${url}…`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const t0 = performance.now();
  const city = parseCity(await res.json());
  engine.load(city);
  const ms = Math.round(performance.now() - t0);

  const w = engine.world;
  hud.querySelector("[data-name]")!.textContent = city.meta.name;
  hud.querySelector("[data-stats]")!.textContent =
    `${w.count(RoadEdge)} roads · ${w.count(Parcel)} parcels · ${w.count(Building)} buildings · ` +
    `${(city.terrain.size[0] / 1000).toFixed(1)}×${(city.terrain.size[1] / 1000).toFixed(1)} km · loaded in ${ms} ms`;
  status.textContent = "";

  // Ctrl/Cmd+S downloads the city as the engine sees it (round-trip through save()).
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      const blob = new Blob([JSON.stringify(engine.save())], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${city.meta.name.replace(/\W+/g, "-").toLowerCase()}.city.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });

  // Show where the walker is ("Kitchen · Ground floor") in the HUD.
  const locationEl = document.getElementById("location")!;
  engine.addSystem({
    name: "hud-location",
    update(world) {
      const text = world.getResource(LocationR)?.label ?? "";
      if (locationEl.textContent !== text) locationEl.textContent = text;
    },
  });

  engine.run();
  Object.assign(window, { systemA: engine });
}

main().catch((err) => {
  console.error(err);
  status.textContent = String(err?.message ?? err);
  status.classList.add("error");
});
