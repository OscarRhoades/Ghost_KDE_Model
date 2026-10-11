/**
 * Falling rain and snow around the view, and wet, reflective roads in rain.
 * Particles live in a box that follows the camera focus and wrap around it.
 */
import { BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Mesh, Points, PointsMaterial, type MeshStandardMaterial } from "three";
import { FocusR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { AtmosR } from "./atmosphere";
import { QualityR } from "./quality";
import { ActiveCameraR, SceneR } from "./renderPlugin";

const COUNT = { low: 1500, medium: 3000, high: 5000 } as const;

export function weatherView(): Plugin {
  return {
    name: "weather-view",
    install(engine) {
      let rain: LineSegments | null = null;
      let snow: Points | null = null;
      let seeds: Float32Array | null = null;
      let applied = "";
      let last = performance.now();
      let time = 0;

      engine.addSystem({
        name: "weather-view",
        update(world) {
          const settings = world.getResource(AtmosR);
          const focus = world.getResource(FocusR);
          const camera = world.getResource(ActiveCameraR);
          if (!settings || !focus || !camera) return;
          const scene = world.resource(SceneR);
          const tier = world.getResource(QualityR)?.tier ?? "medium";
          const key = `${settings.weather}:${tier}`;
          const now = performance.now();
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          time += dt;

          if (key !== applied) {
            applied = key;
            for (const o of [rain, snow]) {
              if (!o) continue;
              o.geometry.dispose();
              o.removeFromParent();
            }
            rain = snow = null;
            const n = COUNT[tier];
            seeds = new Float32Array(n * 3);
            for (let k = 0; k < seeds.length; k++) seeds[k] = Math.random();
            if (settings.weather === "rain") {
              const g = new BufferGeometry();
              g.setAttribute("position", new BufferAttribute(new Float32Array(n * 6), 3));
              rain = new LineSegments(g, new LineBasicMaterial({ color: new Color("#c9d6e2"), transparent: true, opacity: 0.6, depthWrite: false }));
              rain.frustumCulled = false;
              rain.name = "rain";
              scene.add(rain);
            } else if (settings.weather === "snow") {
              const g = new BufferGeometry();
              g.setAttribute("position", new BufferAttribute(new Float32Array(n * 3), 3));
              snow = new Points(g, new PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
              snow.frustumCulled = false;
              snow.name = "snow";
              scene.add(snow);
            }
            // Wet roads shine in the rain.
            const roads = scene.getObjectByName("roads") as Mesh | undefined;
            const m = roads?.material as MeshStandardMaterial | undefined;
            if (m) {
              m.roughness = settings.weather === "rain" ? 0.3 : 0.95;
              m.metalness = settings.weather === "rain" ? 0.15 : 0;
            }
          }
          if (!seeds || (!rain && !snow)) return;

          // The box: around the walker at street level, over the focus on the map.
          const street = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
          const half = street ? 45 : Math.max(60, Math.min(400, focus.radius));
          const height = street ? 40 : half * 1.2;
          const cx = street ? camera.position.x : focus.x;
          const cz = street ? camera.position.z : focus.z;
          const base = (street ? camera.position.y : focus.y) - (street ? 12 : 10);
          const n = seeds.length / 3;
          const wrap = (v: number) => v - Math.floor(v);
          if (rain) {
            const pos = rain.geometry.getAttribute("position") as BufferAttribute;
            const fall = 22;
            const len = street ? 0.7 : Math.max(1.2, half * 0.012);
            for (let k = 0; k < n; k++) {
              const x = cx + (wrap(seeds[k * 3] - cx / (2 * half)) - 0.5) * 2 * half;
              const z = cz + (wrap(seeds[k * 3 + 1] - cz / (2 * half)) - 0.5) * 2 * half;
              const y = base + wrap(seeds[k * 3 + 2] - (time * fall) / height) * height;
              pos.setXYZ(k * 2, x, y, z);
              pos.setXYZ(k * 2 + 1, x + 0.05 * len, y + len, z + 0.02 * len);
            }
            pos.needsUpdate = true;
          }
          if (snow) {
            const pos = snow.geometry.getAttribute("position") as BufferAttribute;
            const fall = 1.4;
            (snow.material as PointsMaterial).size = street ? 0.16 : Math.max(0.5, half * 0.006);
            for (let k = 0; k < n; k++) {
              const sway = Math.sin(time * 0.8 + seeds[k * 3] * 20) * 0.8;
              const x = cx + (wrap(seeds[k * 3] - cx / (2 * half)) - 0.5) * 2 * half + sway;
              const z = cz + (wrap(seeds[k * 3 + 1] - cz / (2 * half)) - 0.5) * 2 * half;
              const y = base + wrap(seeds[k * 3 + 2] - (time * fall) / height) * height;
              pos.setXYZ(k, x, y, z);
            }
            pos.needsUpdate = true;
          }
        },
      });
    },
  };
}
