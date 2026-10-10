/**
 * Classic isometric camera: true orthographic projection at the isometric
 * elevation (35.26°), rotating in 90° steps.
 *
 *   Pan:    WASD / arrow keys, or drag with a mouse button or one finger
 *   Zoom:   mouse wheel (toward the cursor), +/- keys, or pinch
 *   Rotate: Q / E, or a two-finger twist (90° steps)
 *   Walk:   double-click / double-tap a street, or F for the view center
 */
import { OrthographicCamera, Vector3 } from "three";
import { defineResource } from "../ecs/world";
import { FocusR, TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { ActiveCameraR, RendererR } from "../render/renderPlugin";
import { ViewR } from "./viewMode";

const ELEVATION = Math.atan(1 / Math.SQRT2);
const DISTANCE = 3000;
const MIN_VIEW = 30;
const MAX_VIEW = 5000;
/** Two-finger twist (radians) that triggers a 90° rotation step. */
const TWIST_STEP = Math.PI / 5;
/** A press shorter than this (ms) that moves less than TAP_SLOP (px) is a tap. */
const TAP_TIME = 300;
const TAP_SLOP = 10;
/** A tap starting within this many ms (and pixels) of the previous tap's release is a double tap. */
const DOUBLE_TAP_TIME = 400;
const DOUBLE_TAP_SLOP = 30;
/** View height (m) when returning from street level, for local context. */
const RETURN_VIEW = 320;

/** Camera actions for on-screen buttons and other UI. */
export interface IsoControls {
  rotate(direction: 1 | -1): void;
  zoom(factor: number): void;
  /** Ground point at the center of the view. */
  center(): { x: number; z: number };
}
export const IsoControlsR = defineResource<IsoControls>("IsoControls");

export interface IsoCameraOptions {
  /** Initial vertical extent of the view in meters. */
  viewHeight?: number;
}

export function isoCamera(opts: IsoCameraOptions = {}): Plugin {
  return {
    name: "iso-camera",
    install(engine) {
      const camera = new OrthographicCamera(-1, 1, 1, -1, 1, DISTANCE * 3);
      const target = new Vector3();
      let viewHeight = opts.viewHeight ?? 900;
      let step = 0; // rotation index, any integer
      let azimuth = Math.PI / 4; // animated toward the step's azimuth
      const keys = new Set<string>();
      let canvas: HTMLCanvasElement;

      const targetAzimuth = () => Math.PI / 4 + step * (Math.PI / 2);
      /** Ground-plane basis vectors for screen-right and screen-up. */
      const basis = () => {
        const right = new Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
        const up = new Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
        return { right, up };
      };
      const metersPerPixel = () => viewHeight / Math.max(1, canvas.clientHeight);

      /** Move the target by a screen-space delta in pixels. */
      const panPixels = (dx: number, dy: number) => {
        const { right, up } = basis();
        const m = metersPerPixel();
        // Screen-vertical motion covers more ground because the view is tilted.
        target.addScaledVector(right, -dx * m).addScaledVector(up, (dy * m) / Math.sin(ELEVATION));
      };

      /** Ground point (at target height) under a canvas pixel. */
      const groundAt = (px: number, py: number) => {
        const { right, up } = basis();
        const m = metersPerPixel();
        const sx = (px - canvas.clientWidth / 2) * m;
        const sy = (canvas.clientHeight / 2 - py) * m;
        return target.clone().addScaledVector(right, sx).addScaledVector(up, sy / Math.sin(ELEVATION));
      };

      const zoomAt = (factor: number, px?: number, py?: number) => {
        const before = px !== undefined ? groundAt(px, py!) : null;
        viewHeight = Math.min(MAX_VIEW, Math.max(MIN_VIEW, viewHeight * factor));
        if (before) target.add(before.sub(groundAt(px!, py!)));
      };

      engine.addSystem({
        name: "iso-camera",
        start(world) {
          canvas = world.resource(RendererR).domElement;
          const view = world.resource(ViewR);
          const active = () => view.mode === "iso";
          world.setResource(ActiveCameraR, camera);
          world.setResource(IsoControlsR, {
            rotate: (d) => (step += d),
            zoom: (f) => zoomAt(f, canvas.clientWidth / 2, canvas.clientHeight / 2),
            center: () => ({ x: target.x, z: target.z }),
          });
          view.register("iso", (at) => {
            world.setResource(ActiveCameraR, camera);
            keys.clear();
            pointers.clear();
            if (at) {
              target.x = at.x;
              target.z = at.z;
              const terrain = world.getResource(TerrainR);
              if (terrain) target.y = terrain.hf.heightAt(at.x, at.z);
              viewHeight = Math.min(viewHeight, RETURN_VIEW);
            }
          });
          window.addEventListener("keydown", (e) => {
            if (!active() || e.metaKey || e.ctrlKey) return;
            const k = e.key.toLowerCase();
            if (k === "f") view.switchTo("walk", { x: target.x, z: target.z });
            else if (k === "q") step--;
            else if (k === "e") step++;
            else if (k === "+" || k === "=") zoomAt(0.8);
            else if (k === "-") zoomAt(1.25);
            else keys.add(k);
          });
          window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
          window.addEventListener("blur", () => keys.clear());

          // Pointer gestures: one pointer pans; two pinch-zoom around their midpoint,
          // pan with it, and a twist past TWIST_STEP rotates by 90°.
          const pointers = new Map<number, { x: number; y: number }>();
          let twist = 0;
          // Tap tracking for double-tap-to-walk.
          let down: { id: number; x: number; y: number; t: number; travel: number } | null = null;
          let lastTap: { x: number; y: number; t: number } | null = null;
          const local = (e: PointerEvent) => {
            const r = canvas.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
          };
          const pair = () => {
            const [a, b] = [...pointers.values()];
            return {
              mx: (a.x + b.x) / 2,
              my: (a.y + b.y) / 2,
              dist: Math.hypot(b.x - a.x, b.y - a.y),
              angle: Math.atan2(b.y - a.y, b.x - a.x),
            };
          };
          canvas.addEventListener("contextmenu", (e) => e.preventDefault());
          canvas.addEventListener("pointerdown", (e) => {
            if (!active()) return;
            canvas.setPointerCapture(e.pointerId);
            const p = local(e);
            pointers.set(e.pointerId, p);
            twist = 0;
            // Event timestamps measure when the touch happened, even if frames are slow.
            down = pointers.size === 1 ? { id: e.pointerId, ...p, t: e.timeStamp, travel: 0 } : null;
          });
          const release = (e: PointerEvent) => {
            pointers.delete(e.pointerId);
            twist = 0;
            if (!active() || !down || down.id !== e.pointerId) return;
            const now = e.timeStamp;
            const tap = now - down.t < TAP_TIME && down.travel < TAP_SLOP;
            const { x, y, t: pressedAt } = down;
            down = null;
            if (!tap) return;
            if (lastTap && pressedAt - lastTap.t < DOUBLE_TAP_TIME && Math.hypot(x - lastTap.x, y - lastTap.y) < DOUBLE_TAP_SLOP) {
              lastTap = null;
              const g = groundAt(x, y);
              view.switchTo("walk", { x: g.x, z: g.z });
            } else {
              lastTap = { x, y, t: now };
            }
          };
          canvas.addEventListener("pointerup", release);
          canvas.addEventListener("pointercancel", release);
          canvas.addEventListener("pointermove", (e) => {
            const prev = pointers.get(e.pointerId);
            if (!prev || !active()) return;
            const next = local(e);
            if (down?.id === e.pointerId) down.travel += Math.hypot(next.x - prev.x, next.y - prev.y);
            if (pointers.size === 1) {
              panPixels(next.x - prev.x, next.y - prev.y);
              pointers.set(e.pointerId, next);
              return;
            }
            const before = pair();
            pointers.set(e.pointerId, next);
            const after = pair();
            if (after.dist > 0 && before.dist > 0) zoomAt(before.dist / after.dist, after.mx, after.my);
            panPixels(after.mx - before.mx, after.my - before.my);
            let d = after.angle - before.angle;
            if (d > Math.PI) d -= 2 * Math.PI;
            if (d < -Math.PI) d += 2 * Math.PI;
            twist += d;
            if (Math.abs(twist) > TWIST_STEP) {
              step += Math.sign(twist);
              twist = 0;
            }
          });
          // Stop Safari's own page pinch-zoom from fighting ours.
          document.addEventListener("gesturestart", (e) => e.preventDefault());
          canvas.addEventListener(
            "wheel",
            (e) => {
              e.preventDefault();
              if (!active()) return;
              const r = canvas.getBoundingClientRect();
              zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
            },
            { passive: false },
          );
        },
        onLoad(world) {
          const { hf } = world.resource(TerrainR);
          target.set(hf.width / 2, 0, hf.depth / 2);
          target.y = hf.heightAt(target.x, target.z);
        },
        update(world, dt) {
          if (world.resource(ViewR).mode !== "iso") return;
          const terrain = world.getResource(TerrainR);

          // Keyboard pan: constant screen speed regardless of zoom.
          const speed = viewHeight * 0.8 * dt;
          const { right, up } = basis();
          const move = new Vector3();
          if (keys.has("w") || keys.has("arrowup")) move.add(up);
          if (keys.has("s") || keys.has("arrowdown")) move.sub(up);
          if (keys.has("d") || keys.has("arrowright")) move.add(right);
          if (keys.has("a") || keys.has("arrowleft")) move.sub(right);
          if (move.lengthSq() > 0) target.addScaledVector(move.normalize(), speed);

          // Ease rotation toward the current 90° step.
          const goal = targetAzimuth();
          azimuth += (goal - azimuth) * Math.min(1, dt * 10);
          if (Math.abs(goal - azimuth) < 1e-4) azimuth = goal;

          if (terrain) {
            const { hf } = terrain;
            target.x = Math.min(hf.width, Math.max(0, target.x));
            target.z = Math.min(hf.depth, Math.max(0, target.z));
            const ground = Math.max(hf.heightAt(target.x, target.z), terrain.waterLevel ?? -Infinity);
            target.y += (ground - target.y) * Math.min(1, dt * 4);
          }

          const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
          camera.top = viewHeight / 2;
          camera.bottom = -viewHeight / 2;
          camera.left = (-viewHeight / 2) * aspect;
          camera.right = (viewHeight / 2) * aspect;
          camera.updateProjectionMatrix();
          const dir = new Vector3(
            Math.cos(ELEVATION) * Math.sin(azimuth),
            Math.sin(ELEVATION),
            Math.cos(ELEVATION) * Math.cos(azimuth),
          );
          camera.position.copy(target).addScaledVector(dir, DISTANCE);
          camera.lookAt(target);

          world.setResource(FocusR, {
            x: target.x,
            y: target.y,
            z: target.z,
            radius: (viewHeight / 2) * Math.max(1, aspect) * 1.3,
          });
        },
      });
    },
  };
}
