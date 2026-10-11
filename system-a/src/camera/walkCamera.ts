/**
 * First-person walking at street level.
 *
 *   Desktop: WASD / arrows to move, Shift to run, click to capture the mouse
 *            and look around (or drag to look), M or Esc for the map.
 *   Touch:   left side of the screen is a thumbstick, drag elsewhere to look.
 */
import { Fog, PerspectiveCamera } from "three";
import { defineResource } from "../ecs/world";
import { FocusR, TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { FootprintGrid } from "../physics/collision";
import { ActiveCameraR, PALETTE, RendererR, SceneR } from "../render/renderPlugin";
import { NavR, WalkerR, type WalkPose } from "../interiors/nav";
import { buildFootprintGrid, findSpawn, WALKER_RADIUS } from "./spawn";
import { ViewR } from "./viewMode";

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4.5; // m/s
const RUN_SPEED = 11;
const LOOK_SENSITIVITY = 0.0025; // radians per pixel (mouse)
const TOUCH_LOOK_SENSITIVITY = 0.005;
const STICK_RADIUS = 60; // px of thumb travel for full speed
const MAX_PITCH = Math.PI / 2 - 0.05;
/** Full building detail within this distance (m) of the walker. */
const DETAIL_RADIUS = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 320 : 480;

/** Point the walker's view (radians; yaw 0 looks north, pitch 0 level). */
export const WalkLookR = defineResource<(yaw: number, pitch?: number) => void>("WalkLook");

/** Thumbstick state for on-screen UI to draw. */
export interface StickState {
  active: boolean;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
}

export function walkCamera(opts: { onStick?: (s: StickState) => void } = {}): Plugin {
  return {
    name: "walk-camera",
    install(engine) {
      const camera = new PerspectiveCamera(70, 1, 0.1, 4000);
      /** Camera position (eye); follows the walker's feet smoothly. */
      const pos = { x: 0, y: 0, z: 0 };
      const walker: WalkPose = { x: 0, z: 0, y: 0, floor: 0, building: null };
      let yaw = 0;
      let pitch = -0.05;
      let grid = new FootprintGrid();
      const keys = new Set<string>();
      let canvas: HTMLCanvasElement;
      let savedFog: Fog | null = null;
      const streetFog = new Fog(PALETTE.sky, 250, 1800);
      const stick: StickState = { active: false, originX: 0, originY: 0, dx: 0, dy: 0 };
      let stickPointer: number | null = null;
      const lookPointers = new Map<number, { x: number; y: number }>();

      const look = (dx: number, dy: number, sensitivity: number) => {
        yaw -= dx * sensitivity;
        pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - dy * sensitivity));
      };

      engine.addSystem({
        name: "walk-camera",
        start(world) {
          canvas = world.resource(RendererR).domElement;
          const view = world.resource(ViewR);
          const active = () => view.mode === "walk";
          world.setResource(WalkLookR, (y, p = 0) => {
            yaw = y;
            pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));
          });

          view.register("walk", (at) => {
            const spawn = findSpawn(world, grid, at?.x ?? pos.x, at?.z ?? pos.z);
            pos.x = walker.x = spawn.x;
            pos.z = walker.z = spawn.z;
            walker.building = null;
            walker.floor = 0;
            yaw = at?.yaw ?? spawn.yaw;
            pitch = -0.05;
            const { hf } = world.resource(TerrainR);
            walker.y = hf.heightAt(pos.x, pos.z);
            world.getResource(NavR)?.settle(walker);
            pos.y = walker.y + EYE_HEIGHT;
            world.setResource(WalkerR, walker);
            keys.clear();
            world.setResource(ActiveCameraR, camera);
            // Closer fog at street level adds depth and hides the far map edge.
            const scene = world.resource(SceneR);
            // Remember the map's fog only when arriving from the map, not when hopping between spots.
            if (scene.fog !== streetFog) savedFog = scene.fog as Fog | null;
            scene.fog = streetFog;
          });
          view.onChange((mode) => {
            if (mode === "walk") return;
            if (document.pointerLockElement === canvas) document.exitPointerLock();
            const scene = world.resource(SceneR);
            if (savedFog) scene.fog = savedFog;
            keys.clear();
            lookPointers.clear();
            stickPointer = null;
            stick.active = false;
            opts.onStick?.(stick);
          });
          const toMap = () => view.switchTo("iso", { x: pos.x, z: pos.z });

          window.addEventListener("keydown", (e) => {
            if (!active() || e.metaKey || e.ctrlKey) return;
            const k = e.key.toLowerCase();
            if (k === "m" || k === "escape") toMap();
            else keys.add(k);
          });
          window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
          window.addEventListener("blur", () => keys.clear());

          // Mouse look: pointer lock when the browser allows it, dragging otherwise.
          canvas.addEventListener("click", () => {
            if (!active() || matchMedia("(pointer: coarse)").matches) return;
            try {
              const r = canvas.requestPointerLock() as unknown;
              if (r instanceof Promise) r.catch(() => {});
            } catch {
              /* drag-to-look still works */
            }
          });
          document.addEventListener("mousemove", (e) => {
            if (active() && document.pointerLockElement === canvas) look(e.movementX, e.movementY, LOOK_SENSITIVITY);
          });

          canvas.addEventListener("pointerdown", (e) => {
            if (!active() || document.pointerLockElement === canvas) return;
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            canvas.setPointerCapture(e.pointerId);
            if (e.pointerType === "touch" && x < r.width * 0.45 && stickPointer === null) {
              stickPointer = e.pointerId;
              Object.assign(stick, { active: true, originX: x, originY: y, dx: 0, dy: 0 });
              opts.onStick?.(stick);
            } else {
              lookPointers.set(e.pointerId, { x, y });
            }
          });
          canvas.addEventListener("pointermove", (e) => {
            if (!active()) return;
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            if (e.pointerId === stickPointer) {
              let dx = x - stick.originX;
              let dy = y - stick.originY;
              const len = Math.hypot(dx, dy);
              if (len > STICK_RADIUS) {
                dx *= STICK_RADIUS / len;
                dy *= STICK_RADIUS / len;
              }
              stick.dx = dx;
              stick.dy = dy;
              opts.onStick?.(stick);
              return;
            }
            const prev = lookPointers.get(e.pointerId);
            if (!prev) return;
            look(x - prev.x, y - prev.y, e.pointerType === "touch" ? TOUCH_LOOK_SENSITIVITY : LOOK_SENSITIVITY);
            lookPointers.set(e.pointerId, { x, y });
          });
          const release = (e: PointerEvent) => {
            if (e.pointerId === stickPointer) {
              stickPointer = null;
              Object.assign(stick, { active: false, dx: 0, dy: 0 });
              opts.onStick?.(stick);
            }
            lookPointers.delete(e.pointerId);
          };
          canvas.addEventListener("pointerup", release);
          canvas.addEventListener("pointercancel", release);
        },
        onLoad(world) {
          grid = buildFootprintGrid(world);
          const { hf } = world.resource(TerrainR);
          pos.x = hf.width / 2;
          pos.z = hf.depth / 2;
        },
        update(world, dt) {
          if (world.resource(ViewR).mode !== "walk") return;
          const terrain = world.getResource(TerrainR);
          if (!terrain) return;
          const { hf, waterLevel } = terrain;

          // Input in walker space: forward is +f, right is +s.
          let f = 0;
          let s = 0;
          if (keys.has("w") || keys.has("arrowup")) f += 1;
          if (keys.has("s") || keys.has("arrowdown")) f -= 1;
          if (keys.has("d") || keys.has("arrowright")) s += 1;
          if (keys.has("a") || keys.has("arrowleft")) s -= 1;
          let speed = keys.has("shift") ? RUN_SPEED : WALK_SPEED;
          if (stick.active) {
            f = -stick.dy / STICK_RADIUS;
            s = stick.dx / STICK_RADIUS;
            // Push the stick all the way to run.
            speed = Math.hypot(f, s) > 0.95 ? RUN_SPEED : WALK_SPEED;
          }
          const mag = Math.hypot(f, s);
          if (mag > 1) {
            f /= mag;
            s /= mag;
          }
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
          const rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const step = speed * dt;
          const dx = (fx * f + rx * s) * step;
          const dz = (fz * f + rz * s) * step;

          const nav = world.getResource(NavR);
          if (nav) {
            // Streets, doorways, interior walls and stairs.
            if (dx || dz) nav.move(walker, dx, dz, WALKER_RADIUS);
          } else if (dx || dz) {
            // Without the navigator: footprints are solid and ground is terrain.
            const dry = (x: number, z: number) => waterLevel === undefined || hf.heightAt(x, z) > waterLevel + 0.2;
            const inside = (x: number, z: number) => x > 0.5 && z > 0.5 && x < hf.width - 0.5 && z < hf.depth - 0.5;
            // Try the full move, then slide along each axis.
            for (const [mx, mz] of [[dx, dz], [dx, 0], [0, dz]] as const) {
              const [nx, nz] = grid.resolve(walker.x + mx, walker.z + mz, WALKER_RADIUS);
              if (dry(nx, nz) && inside(nx, nz) && !grid.blocked(nx, nz, WALKER_RADIUS * 0.9)) {
                walker.x = nx;
                walker.z = nz;
                break;
              }
            }
            walker.y = hf.heightAt(walker.x, walker.z);
          }
          pos.x = walker.x;
          pos.z = walker.z;
          const eye = walker.y + EYE_HEIGHT;
          pos.y += (eye - pos.y) * Math.min(1, dt * 12);
          world.setResource(WalkerR, walker);

          camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
          camera.updateProjectionMatrix();
          camera.position.set(pos.x, pos.y, pos.z);
          camera.rotation.set(pitch, yaw, 0, "YXZ");

          world.setResource(FocusR, { x: pos.x, y: pos.y, z: pos.z, radius: 140, detailRadius: DETAIL_RADIUS });
        },
      });
    },
  };
}
