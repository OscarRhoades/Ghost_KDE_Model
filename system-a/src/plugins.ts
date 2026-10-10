/** Built-in plugin sets. Order matters: systems run in registration order. */
import { massingView } from "./buildings/massingView";
import { isoCamera, type IsoCameraOptions } from "./camera/isoCamera";
import { coreDataPlugins } from "./engine/dataPlugins";
import type { Plugin } from "./engine/engine";
import { renderPlugin, type RenderOptions } from "./render/renderPlugin";
import { roadView } from "./roads/roadView";
import { terrainView } from "./terrain/terrainView";

export { coreDataPlugins };

export function viewerPlugins(opts: RenderOptions & { iso?: IsoCameraOptions }): Plugin[] {
  return [renderPlugin(opts), terrainView(), roadView(), massingView(), isoCamera(opts.iso)];
}
