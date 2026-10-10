import { Building, Parcel, RoadEdge } from "./engine/components";
import { Engine } from "./engine/engine";
import { parseCity } from "./format/schema";
import { coreDataPlugins, viewerPlugins } from "./plugins";

const hud = document.getElementById("hud")!;
const status = document.getElementById("status")!;

async function main() {
  const url = new URLSearchParams(location.search).get("city") ?? "cities/demo.city.json";
  const engine = new Engine();
  for (const p of [...coreDataPlugins(), ...viewerPlugins({ container: document.getElementById("viewport")! })]) {
    engine.use(p);
  }
  engine.start();

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

  engine.run();
  Object.assign(window, { systemA: engine });
}

main().catch((err) => {
  console.error(err);
  status.textContent = String(err?.message ?? err);
  status.classList.add("error");
});
