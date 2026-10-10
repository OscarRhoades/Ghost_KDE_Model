/**
 * Which camera is in charge. Cameras register an `enter` handler for their
 * mode; UI and cameras call `switchTo` to hand over, passing where to go.
 */
import { defineResource } from "../ecs/world";
import type { Plugin } from "../engine/engine";

export type ViewMode = "iso" | "walk";

/** A ground position (and optional heading) to hand from one view to another. */
export interface ViewTarget {
  x: number;
  z: number;
  yaw?: number;
}

export class ViewController {
  mode: ViewMode = "iso";
  private readonly enterHandlers = new Map<ViewMode, (at?: ViewTarget) => void>();
  private readonly listeners: ((mode: ViewMode) => void)[] = [];

  register(mode: ViewMode, onEnter: (at?: ViewTarget) => void): void {
    this.enterHandlers.set(mode, onEnter);
  }

  onChange(fn: (mode: ViewMode) => void): void {
    this.listeners.push(fn);
  }

  switchTo(mode: ViewMode, at?: ViewTarget): void {
    if (!this.enterHandlers.has(mode)) return;
    this.mode = mode;
    this.enterHandlers.get(mode)!(at);
    for (const fn of this.listeners) fn(mode);
  }
}

export const ViewR = defineResource<ViewController>("View");

/** Install before any camera plugin. */
export function viewModes(): Plugin {
  return {
    name: "view-modes",
    install(engine) {
      engine.world.setResource(ViewR, new ViewController());
    },
  };
}
