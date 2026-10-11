import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Object3D,
} from "three";
import { defineResource, type World } from "../ecs/world";
import { FocusR, SceneObject } from "../engine/components";
import type { Plugin } from "../engine/engine";
import { detectTier, QualityR, savedTier, settingsFor } from "./quality";
import { createSky, SKY, type Sky } from "./sky";

export const SceneR = defineResource<Scene>("Scene");
export const RendererR = defineResource<WebGLRenderer>("Renderer");
/** The camera the renderer draws with; camera systems set it when active. */
export const ActiveCameraR = defineResource<Camera>("ActiveCamera");
export const SunR = defineResource<DirectionalLight>("Sun");
export const SkyR = defineResource<Sky>("Sky");

export interface RenderOptions {
  container: HTMLElement;
  /** Direction the sunlight comes from (normalized internally). */
  sunDirection?: Vector3;
}

export const PALETTE = {
  /** Horizon color, used for fog. */
  sky: SKY.horizon,
  hemiSky: new Color("#e8f3ff"),
  hemiGround: new Color("#b9a98c"),
  sun: new Color("#fff4e0"),
};

export function renderPlugin(opts: RenderOptions): Plugin {
  const sunDir = (opts.sunDirection ?? new Vector3(-0.55, 0.8, 0.35)).clone().normalize();
  return {
    name: "render",
    install(engine) {
      let appliedQuality = -1;
      engine.addSystem({
        name: "render",
        start(world) {
          // Quality tier: from the device, or the viewer's last choice.
          const quality = settingsFor(savedTier() ?? detectTier());
          world.setResource(QualityR, quality);
          const renderer = new WebGLRenderer({ antialias: true });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
          renderer.outputColorSpace = SRGBColorSpace;
          renderer.toneMapping = ACESFilmicToneMapping;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = PCFShadowMap;
          opts.container.appendChild(renderer.domElement);

          const scene = new Scene();
          const sky = createSky(renderer);
          scene.background = sky.backdrop;
          // The sky lights everything a little and is what glass reflects.
          scene.environment = sky.environment;
          scene.environmentIntensity = 0.45;
          scene.add(sky.dome);
          scene.fog = new Fog(PALETTE.sky, 4000, 9000);
          scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.1));

          const sun = new DirectionalLight(PALETTE.sun, 2.2);
          sun.castShadow = true;
          sun.shadow.mapSize.setScalar(quality.shadowMapSize);
          appliedQuality = quality.version;
          sun.shadow.bias = -0.0004;
          sun.shadow.normalBias = 0.6;
          scene.add(sun, sun.target);

          world.setResource(RendererR, renderer);
          world.setResource(SceneR, scene);
          world.setResource(SunR, sun);
          world.setResource(SkyR, sky);

          const resize = () => {
            renderer.setSize(opts.container.clientWidth, opts.container.clientHeight);
          };
          resize();
          new ResizeObserver(resize).observe(opts.container);
        },
        onUnload(world) {
          // Remove everything entities put into the scene.
          const scene = world.resource(SceneR);
          for (const e of world.query(SceneObject)) {
            const obj = world.read(e, SceneObject);
            scene.remove(obj);
            obj.traverse((o) => {
              const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
              m.geometry?.dispose();
              if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
              else m.material?.dispose();
            });
          }
        },
        update(world) {
          const camera = world.getResource(ActiveCameraR);
          if (!camera) return;
          const q = world.resource(QualityR);
          if (q.version !== appliedQuality) {
            appliedQuality = q.version;
            const r = world.resource(RendererR);
            r.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatioCap));
            const sunLight = world.resource(SunR);
            sunLight.shadow.mapSize.setScalar(q.shadowMapSize);
            sunLight.shadow.map?.dispose();
            sunLight.shadow.map = null;
          }
          // Keep the shadow frustum fitted around what the camera is looking at.
          const focus = world.getResource(FocusR);
          const sun = world.resource(SunR);
          if (focus) {
            const r = Math.max(60, focus.radius);
            sun.target.position.set(focus.x, focus.y, focus.z);
            sun.position.copy(sun.target.position).addScaledVector(sunDir, r * 3);
            const cam = sun.shadow.camera;
            cam.left = -r;
            cam.right = r;
            cam.top = r;
            cam.bottom = -r;
            cam.near = 1;
            cam.far = r * 6;
            cam.updateProjectionMatrix();
          }
          // Dome at street level, flat gradient behind the orthographic map.
          const scene = world.resource(SceneR);
          const sky = world.resource(SkyR);
          const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
          sky.dome.visible = perspective;
          if (perspective) sky.dome.position.copy(camera.position);
          scene.background = perspective ? SKY.horizon : sky.backdrop;
          world.resource(RendererR).render(scene, camera);
        },
      });
    },
  };
}

/** Add an object to the scene, owned by a fresh entity that is cleaned up on unload. */
export function addToScene(world: World, obj: Object3D): void {
  world.resource(SceneR).add(obj);
  const e = world.spawn();
  world.add(e, SceneObject, obj);
}
