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
  ShaderMaterial,
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
  g.setAttribute("color", new BufferAttribute(new Float32Array(g.getAttribute("position").count * 3), 3));
  const mesh = new Mesh(g, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  recolor(mesh, radius);
  return mesh;
}

/** Repaint a gradient sphere from the current SKY colors. */
function recolor(mesh: Mesh, radius: number) {
  const pos = mesh.geometry.getAttribute("position");
  const col = mesh.geometry.getAttribute("color") as BufferAttribute;
  const c = new Color();
  for (let k = 0; k < pos.count; k++) {
    skyColor(pos.getY(k) / radius, c);
    col.setXYZ(k, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

function paintBackdrop(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `#${SKY.upper.getHexString()}`);
  grad.addColorStop(1, `#${SKY.horizon.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
}

/** Uniforms for the painted clouds on the street-level sky dome. */
export const cloudUniforms = {
  uCloudColor: { value: new Color("#ffffff") },
  uCloudShade: { value: new Color("#c9d6e8") },
  uCover: { value: 0.45 },
  uTime: { value: 0 },
};

/** Sky gradient from vertex colors with soft, painted cumulus drifting across it. */
function cloudMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: cloudUniforms,
    vertexColors: true,
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vDir;
      void main() {
        vColor = color;
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCloudColor, uCloudShade;
      uniform float uCover, uTime;
      varying vec3 vColor;
      varying vec3 vDir;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int k = 0; k < 5; k++) { s += a * n(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 col = vColor;
        if (vDir.y > 0.0) {
          // Project onto a cloud deck; clouds thin out toward the horizon.
          vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
          float d = fbm(uv);
          float shape = smoothstep(1.0 - uCover, 1.0 - uCover + 0.18, d);
          float lit = smoothstep(0.35, 0.9, fbm(uv * 1.7 + 4.0 + vec2(0.15, 0.25)));
          vec3 cloud = mix(uCloudShade, uCloudColor, 0.55 + 0.45 * lit);
          float fade = smoothstep(0.0, 0.18, vDir.y);
          col = mix(col, cloud, shape * fade * 0.92);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export interface Sky {
  environment: Texture;
  /** Repaint everything for new sky colors. */
  repaint(colors: typeof SKY): void;
  /** Screen-space gradient for orthographic views. */
  backdrop: Texture;
  /** Camera-centered dome for perspective views. */
  dome: Mesh;
}

export function createSky(renderer: WebGLRenderer): Sky {
  const envScene = new Scene();
  const envSphere = gradientSphere(10);
  envScene.add(envSphere);
  const pmrem = new PMREMGenerator(renderer);

  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  paintBackdrop(canvas);
  const backdrop = new CanvasTexture(canvas);
  backdrop.colorSpace = SRGBColorSpace;

  const dome = gradientSphere(3000);
  dome.material = cloudMaterial();
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.name = "sky-dome";

  let target = pmrem.fromScene(envScene, 0.02);
  const sky: Sky = {
    environment: target.texture,
    backdrop,
    dome,
    repaint(colors) {
      for (const k of Object.keys(SKY) as (keyof typeof SKY)[]) SKY[k].copy(colors[k]);
      recolor(envSphere, 10);
      recolor(dome, 3000);
      paintBackdrop(canvas);
      backdrop.needsUpdate = true;
      target.dispose();
      target = pmrem.fromScene(envScene, 0.02);
      sky.environment = target.texture;
    },
  };
  return sky;
}
