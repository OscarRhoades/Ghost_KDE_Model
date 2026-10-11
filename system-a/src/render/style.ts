/**
 * The painted look. One shader patch, applied to every lit material, turns
 * physically based shading into something closer to a hand-painted game:
 *
 * - soft "wrapped" sunlight with a defined but gentle terminator,
 * - broad painterly color variation in world space (no flat fills),
 * - bright painted highlights along the edges of every quad, like bevels,
 *   fading out where they would shrink below a pixel,
 * - a cool rim light on silhouettes and a little extra saturation.
 *
 * The uniforms are shared, so the atmosphere can tune them for night or fog.
 */
import { Color, ShaderChunk, type Material, type MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";

export const styleUniforms = {
  /** Strength of the painterly color variation. */
  uPaint: { value: 0.2 },
  /** Strength of the painted edge highlights. */
  uEdge: { value: 0.55 },
  /** Highlight width in meters (close up). */
  uEdgeWidth: { value: 0.09 },
  uRim: { value: 0.22 },
  uRimColor: { value: new Color("#cfe6ff") },
  /** Saturation multiplier on the lit color. */
  uSat: { value: 1.12 },
  /** How far sunlight wraps around a surface (0 = physical). */
  uWrap: { value: 0.35 },
  /** Seconds, for animated materials (water). */
  uTime: { value: 0 },
};

/**
 * Stylized water: deep teal looking down, bright aqua at grazing angles,
 * slow drifting bands of lighter color and soft glints.
 */
export function stylizeWater<T extends MeshStandardMaterial>(material: T, deep = "#1d7fa8", shallow = "#7fe3ea"): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, styleUniforms, { uDeep: { value: new Color(deep) }, uShallow: { value: new Color(shallow) } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSaWorld;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\nvSaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime;
uniform vec3 uDeep, uShallow;
varying vec3 vSaWorld;
${NOISE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float fres = pow(1.0 - saturate(dot(up, viewDir)), 2.0);
  vec2 p = vSaWorld.xz;
  float bands = sa_noise(vec3(p * 0.012 + vec2(uTime * 0.01, 0.0), uTime * 0.03));
  float ripples = sa_noise(vec3(p * 0.09, uTime * 0.25)) * sa_noise(vec3(p * 0.21 + 3.0, uTime * 0.4));
  vec3 c = mix(uDeep, uShallow, clamp(fres * 0.8 + bands * 0.35, 0.0, 1.0));
  c += smoothstep(0.42, 0.62, ripples) * 0.25;
  diffuseColor.rgb = c;
}`);
  };
  material.customProgramCacheKey = () => `sa-water:${deep}:${shallow}`;
  return material;
}

export interface StyleOptions {
  /** Paving joints on light surfaces (sidewalks, plazas), in meters per slab. */
  paving?: number;
  /** Painted edge highlights (needs the `edge` attribute from MeshBuilder). */
  edges?: boolean;
  /** Multiplier on the painterly variation for this material. */
  paint?: number;
  /** Rim light multiplier. */
  rim?: number;
}

const NOISE = /* glsl */ `
float sa_hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sa_noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sa_hash(i + vec3(0, 0, 0)), sa_hash(i + vec3(1, 0, 0)), f.x),
                 mix(sa_hash(i + vec3(0, 1, 0)), sa_hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sa_hash(i + vec3(0, 0, 1)), sa_hash(i + vec3(1, 0, 1)), f.x),
                 mix(sa_hash(i + vec3(0, 1, 1)), sa_hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** Apply the painted look to a standard material. Composes with an existing onBeforeCompile. */
export function stylize<T extends MeshStandardMaterial>(material: T, opts: StyleOptions = {}): T {
  const previous = material.onBeforeCompile.bind(material);
  const edges = opts.edges !== false;
  const paint = opts.paint ?? 1;
  const rim = opts.rim ?? 1;
  const paving = opts.paving ?? 0;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, styleUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 edge;
varying vec4 vSaEdge;
varying vec3 vSaWorld;`,
      )
      .replace(
        "#include <fog_vertex>",
        `#include <fog_vertex>
vSaEdge = edge;
vSaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uPaint, uEdge, uEdgeWidth, uRim, uSat, uWrap;
uniform vec3 uRimColor;
varying vec4 vSaEdge;
varying vec3 vSaWorld;
${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // Broad painterly variation: big soft patches with a finer brushy layer.
  float n = sa_noise(vSaWorld * 0.07) * 0.55 + sa_noise(vSaWorld * 0.45) * 0.3 + sa_noise(vSaWorld * 2.1) * 0.15;
  diffuseColor.rgb *= 1.0 + (n - 0.5) * uPaint * ${paint.toFixed(2)};
  ${
    paving > 0
      ? `{
    // Slab joints on pale paving only (sidewalks, plazas), fading with distance.
    float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    vec2 g = vSaWorld.xz / ${paving.toFixed(2)};
    g.x += step(1.0, mod(floor(g.y), 2.0)) * 0.5;
    vec2 f = abs(fract(g) - 0.5);
    vec2 w = fwidth(g) * 1.2 + 0.02;
    float joint = max(smoothstep(0.5 - w.x, 0.5, f.x), smoothstep(0.5 - w.y, 0.5, f.y));
    float far = smoothstep(0.08, 0.3, max(fwidth(g).x, fwidth(g).y));
    diffuseColor.rgb *= 1.0 - joint * 0.18 * step(0.55, lum) * (1.0 - far);
  }`
      : ""
  }
  ${
    edges
      ? `if (vSaEdge.z > 0.0 && vSaEdge.w > 0.0) {
    vec2 uv = vSaEdge.xy;
    float d = min(min(uv.x, vSaEdge.z - uv.x), min(uv.y, vSaEdge.w - uv.y));
    float px = fwidth(d);
    float k = 1.0 - smoothstep(0.0, max(uEdgeWidth, px * 1.2), d);
    k *= 1.0 - smoothstep(0.04, 0.2, px);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.05, k * uEdge);
  }`
      : ""
  }
}`,
      )
      .replace(
        "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;",
        `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
{
  vec3 viewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
  float fres = pow(1.0 - saturate(dot(normal, viewDir)), 3.0);
  // Rim tinted by the surface itself, softer from straight above (the map view).
  outgoingLight += uRimColor * diffuseColor.rgb * fres * uRim * ${rim.toFixed(2)} * (isOrthographic ? 0.35 : 1.0);
  float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = max(vec3(0.0), mix(vec3(l), outgoingLight, uSat));
}`,
      );
    // Soft wrapped sunlight with a smooth but readable light/shadow edge.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      ShaderChunkPatched(),
    );
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|sa:${edges}:${paint}:${rim}:${paving}`;
  material.needsUpdate = true;
  return material;
}


let patched: string | null = null;
function ShaderChunkPatched(): string {
  if (patched) return patched;
  const src = ShaderChunk.lights_physical_pars_fragment;
  const from = "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );";
  if (!src.includes(from)) return (patched = src);
  patched = src.replaceAll(
    "float dotNV = saturate( dot( normal, viewDir ) );",
    // Bent foliage normals can face away from the camera: keep specular finite there.
    "float dotNV = max( saturate( dot( normal, viewDir ) ), 0.15 );",
  ).replace(
    from,
    `float ndlRaw = dot( geometryNormal, directLight.direction );
	float dotNL = smoothstep( 0.0, 1.0, saturate( ( ndlRaw + uWrap ) / ( 1.0 + uWrap ) ) );`,
  );
  return patched;
}

/** Whether a material has been stylized (for tests and debugging). */
export function isStylized(m: Material): boolean {
  return m.customProgramCacheKey().includes("|sa:");
}
