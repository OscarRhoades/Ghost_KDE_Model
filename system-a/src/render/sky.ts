/**
 * Sky: one vertical gradient used three ways. As a prefiltered environment map
 * it gives glass something to reflect, as a dome it is the street-level sky,
 * and as a flat backdrop it sits behind the isometric view.
 */
import {
  BackSide,
  BufferAttribute,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  type WebGLRenderer,
} from "three";

export const SKY = {
  zenith: new Color("#5d9bd3"),
  upper: new Color("#9cc4e4"),
  horizon: new Color("#e2ecf0"),
  ground: new Color("#b9c0b6"),
};

/** Sky color for a direction with vertical component `y` in [-1, 1]. */
export function skyColor(y: number, out = new Color()): Color {
  if (y < 0) return out.copy(SKY.horizon).lerp(SKY.ground, Math.min(1, -y * 4));
  if (y < 0.25) return out.copy(SKY.horizon).lerp(SKY.upper, y / 0.25);
  return out.copy(SKY.upper).lerp(SKY.zenith, Math.min(1, (y - 0.25) / 0.75));
}

function gradientSphere(radius: number): Mesh {
  const g = new SphereGeometry(radius, 48, 24);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let k = 0; k < pos.count; k++) {
    skyColor(pos.getY(k) / radius, c);
    colors.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
}

export interface Sky {
  environment: Texture;
  /** Screen-space gradient for orthographic views. */
  backdrop: Texture;
  /** Camera-centered dome for perspective views. */
  dome: Mesh;
}

export function createSky(renderer: WebGLRenderer): Sky {
  const envScene = new Scene();
  envScene.add(gradientSphere(10));
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `#${SKY.upper.getHexString()}`);
  grad.addColorStop(1, `#${SKY.horizon.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const backdrop = new CanvasTexture(canvas);
  backdrop.colorSpace = SRGBColorSpace;

  const dome = gradientSphere(3000);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.name = "sky-dome";
  return { environment, backdrop, dome };
}
