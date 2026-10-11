/**
 * Atmosphere: time of day and weather. A pure function turns the pair into
 * sky colors, sun and ambient light, fog and a night factor; the render
 * plugin applies it, and night-aware materials (windows, lamps, signs) read
 * the night factor.
 */
import { Color, Vector3 } from "three";
import { defineResource } from "../ecs/world";

export const TIMES = ["morning", "day", "golden", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES)[number];
export const WEATHERS = ["clear", "overcast", "rain", "fog", "snow"] as const;
export type Weather = (typeof WEATHERS)[number];

export interface AtmosSettings {
  time: TimeOfDay;
  weather: Weather;
  /** Bumped on every change. */
  version: number;
}
export const AtmosR = defineResource<AtmosSettings>("Atmosphere");

export interface SkyColors {
  zenith: Color;
  upper: Color;
  horizon: Color;
  ground: Color;
}

export interface Atmos {
  sky: SkyColors;
  /** Direction the light comes from (toward the sun or moon). */
  sunDir: Vector3;
  sunColor: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  envIntensity: number;
  fogColor: Color;
  /** Multiplier on fog distances (smaller is thicker). */
  fogScale: number;
  /** 0 by day, 1 at night: drives lit windows, lamps and signs. */
  night: number;
  exposure: number;
  /** Bloom strength for the high tier. */
  bloom: number;
}

const c = (h: string) => new Color(h);

/** Direction from azimuth and elevation in degrees (azimuth 0 = +x, 90 = +z). */
function dir(az: number, el: number): Vector3 {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
}

interface Preset {
  sky: [string, string, string, string];
  sun: [number, number, string, number];
  hemi: [string, string, number];
  env: number;
  night: number;
  exposure: number;
  bloom: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  morning: { sky: ["#6fa3d6", "#b4cde3", "#f1dfcf", "#b9b8a8"], sun: [20, 22, "#ffe0bd", 2.0], hemi: ["#dfeaf6", "#b7a68a", 0.95], env: 0.45, night: 0, exposure: 1.0, bloom: 0.15 },
  day: { sky: ["#5d9bd3", "#9cc4e4", "#e2ecf0", "#b9c0b6"], sun: [150, 53, "#fff4e0", 2.2], hemi: ["#e8f3ff", "#b9a98c", 1.1], env: 0.45, night: 0, exposure: 1.0, bloom: 0.12 },
  golden: { sky: ["#5a80b8", "#c9b6a4", "#f4cf9e", "#a89a84"], sun: [205, 14, "#ffc07e", 2.3], hemi: ["#e4e2dc", "#9a8a72", 0.9], env: 0.42, night: 0.1, exposure: 1.05, bloom: 0.3 },
  dusk: { sky: ["#25345c", "#6e5f86", "#e08a68", "#4a4648"], sun: [215, 2, "#ff8a5c", 0.7], hemi: ["#8f8fb8", "#4a4048", 0.55], env: 0.22, night: 0.75, exposure: 1.1, bloom: 0.7 },
  night: { sky: ["#070d1a", "#101b30", "#25324a", "#151a20"], sun: [120, 48, "#9db2d8", 0.5], hemi: ["#4a5a80", "#22242c", 0.55], env: 0.14, night: 1, exposure: 1.25, bloom: 0.9 },
};

const GREY = c("#b9bfc4");

export function atmosFor(time: TimeOfDay, weather: Weather): Atmos {
  const p = PRESETS[time];
  const [zen, up, hor, gr] = p.sky.map(c);
  const sky: SkyColors = { zenith: zen, upper: up, horizon: hor, ground: gr };
  let sunIntensity = p.sun[3];
  let hemiIntensity = p.hemi[2];
  let fogScale = 1;
  let night = p.night;
  let exposure = p.exposure;
  const hemiSky = c(p.hemi[0]);
  const sunColor = c(p.sun[2]);
  if (weather !== "clear") {
    // Clouds: a flat grey sky at the same brightness, weak direct light.
    const amount = weather === "fog" ? 0.85 : weather === "snow" ? 0.8 : weather === "rain" ? 0.75 : 0.65;
    const lum = (col: Color) => 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;
    for (const k of ["zenith", "upper", "horizon"] as const) {
      const grey = GREY.clone().multiplyScalar(Math.min(1.2, lum(sky[k]) / lum(GREY)));
      sky[k].lerp(grey, amount);
    }
    sky.zenith.lerp(sky.horizon, 0.5);
    sunIntensity *= weather === "overcast" ? 0.35 : 0.22;
    hemiIntensity *= weather === "snow" ? 1.35 : 1.2;
    hemiSky.lerp(GREY, 0.6);
    sunColor.lerp(c("#ffffff"), 0.5);
    fogScale = weather === "fog" ? 0.1 : weather === "rain" ? 0.45 : weather === "snow" ? 0.5 : 0.75;
    if (weather === "rain") exposure *= 0.95;
  }
  return {
    sky,
    sunDir: dir(p.sun[0], p.sun[1]),
    sunColor,
    sunIntensity,
    hemiSky,
    hemiGround: c(p.hemi[1]),
    hemiIntensity,
    envIntensity: p.env,
    fogColor: sky.horizon.clone(),
    fogScale,
    night,
    exposure,
    bloom: p.bloom,
  };
}

/** Settings from the page URL (?time=night&weather=rain), defaulting to a clear day. */
export function atmosFromUrl(search = typeof location !== "undefined" ? location.search : ""): AtmosSettings {
  const q = new URLSearchParams(search);
  const time = q.get("time") as TimeOfDay;
  const weather = q.get("weather") as Weather;
  return {
    time: TIMES.includes(time) ? time : "day",
    weather: WEATHERS.includes(weather) ? weather : "clear",
    version: 0,
  };
}
