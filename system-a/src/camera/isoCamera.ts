/**
 * Classic isometric camera: true orthographic projection at the isometric
 * elevation (35.26°), rotating in 90° steps.
 *
 *   Pan:    WASD / arrow keys, or drag with any mouse button
 *   Zoom:   mouse wheel (toward the cursor), or +/- keys
 *   Rotate: Q / E (90° steps)
 */
import { OrthographicCamera, Vector3 } from "three";
import { FocusR, TerrainR } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { ActiveCameraR, RendererR } from "../render/renderPlugin";

const ELEVATION = Math.atan(1 / Math.SQRT2);
const DISTANCE = 3000;
const MIN_VIEW = 30;
const MAX_VIEW = 5000;

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
          world.setResource(ActiveCameraR, camera);
          window.addEventListener("keydown", (e) => {
            if (e.metaKey || e.ctrlKey) return;
            const k = e.key.toLowerCase();
            if (k === "q") step--;
            else if (k === "e") step++;
            else if (k === "+" || k === "=") zoomAt(0.8);
            else if (k === "-") zoomAt(1.25);
            else keys.add(k);
          });
          window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
          window.addEventListener("blur", () => keys.clear());

          let dragging = false;
          canvas.addEventListener("contextmenu", (e) => e.preventDefault());
          canvas.addEventListener("pointerdown", (e) => {
            dragging = true;
            canvas.setPointerCapture(e.pointerId);
          });
          canvas.addEventListener("pointerup", (e) => {
            dragging = false;
            canvas.releasePointerCapture(e.pointerId);
          });
          canvas.addEventListener("pointermove", (e) => {
            if (dragging) panPixels(e.movementX, e.movementY);
          });
          canvas.addEventListener(
            "wheel",
            (e) => {
              e.preventDefault();
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
