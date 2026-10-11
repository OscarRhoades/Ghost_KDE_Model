/**
 * Post effects for the high quality tier: ambient occlusion (GTAO), bloom
 * (strong at night, so lamps and windows glow) and the output transform.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: WebGLRenderer, scene: Scene, readonly camera: Camera) {
    const size = renderer.getSize(new Vector2());
    const target = new WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, size.x, size.y);
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
    gtao.updateGtaoMaterial({ radius: perspective ? 1.6 : 6, distanceExponent: 1.5, thickness: perspective ? 1.5 : 6, scale: 1, samples: 12 });
    gtao.blendIntensity = 0.85;
    this.composer.addPass(gtao);
    this.bloom = new UnrealBloomPass(size.clone(), 0.2, 0.1, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setBloom(strength: number, night: number): void {
    // Only light sources (lit panes and lamps, brighter than white) bloom.
    this.bloom.strength = strength * 0.25;
    this.bloom.threshold = night > 0.5 ? 1.0 : 1.2;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
