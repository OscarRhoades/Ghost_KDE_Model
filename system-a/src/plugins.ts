/** Built-in plugin sets. Order matters: systems run in registration order. */
import { buildingView } from "./buildings/buildingView";
import { isoCamera, type IsoCameraOptions } from "./camera/isoCamera";
import { viewModes } from "./camera/viewMode";
import { walkCamera, type StickState } from "./camera/walkCamera";
import { interiorView } from "./interiors/interiorView";
import { navigation } from "./interiors/nav";
import { coreDataPlugins } from "./engine/dataPlugins";
import type { Plugin } from "./engine/engine";
import { renderPlugin, type RenderOptions } from "./render/renderPlugin";
import { roadView } from "./roads/roadView";
import { terrainView } from "./terrain/terrainView";

export { coreDataPlugins };

export interface ViewerOptions extends RenderOptions {
  iso?: IsoCameraOptions;
  /** Called when the walk-mode thumbstick changes, so the page can draw it. */
  onStick?: (s: StickState) => void;
}

export function viewerPlugins(opts: ViewerOptions): Plugin[] {
  return [
    viewModes(),
    renderPlugin(opts),
    terrainView(),
    roadView(),
    buildingView(),
    isoCamera(opts.iso),
    walkCamera({ onStick: opts.onStick }),
    navigation(),
    interiorView(),
  ];
}
