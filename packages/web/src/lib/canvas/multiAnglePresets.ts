/** LibTV-style camera presets for multi-angle tool */

export type ShotScale = "close" | "medium" | "wide";

/**
 * Horizontal orbit (0–359°), camera looks at subject center:
 * 0° front, 90° right, 180° back, 270° left.
 */
export const HORIZONTAL_AZIMUTH_MIN = 0;
export const HORIZONTAL_AZIMUTH_MAX = 359;

export const HORIZONTAL_AZIMUTH_VALUES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** Elevation: 0° eye level, +90° from above (top-down), -90° from below (low angle). */
export const ELEVATION_MIN = -90;
export const ELEVATION_MAX = 90;

export const ELEVATION_PRESET_VALUES = [-90, -45, 0, 45, 90] as const;

export const SHOT_SCALES: ShotScale[] = ["close", "medium", "wide"];

export const DEFAULT_MULTI_ANGLE = {
  azimuth: 0,
  elevation: 0,
  shot: "medium" as ShotScale,
};

export function normalizeAzimuth(azimuth: number): number {
  const wrapped = ((azimuth % 360) + 360) % 360;
  return wrapped >= 360 ? 0 : wrapped;
}

export function normalizeElevation(elevation: number): number {
  return Math.max(ELEVATION_MIN, Math.min(ELEVATION_MAX, elevation));
}

export function azimuthDelta(a: number, b: number): number {
  const diff = Math.abs(normalizeAzimuth(a) - normalizeAzimuth(b));
  return Math.min(diff, 360 - diff);
}

export function snapAzimuth(azimuth: number): number {
  const normalized = normalizeAzimuth(azimuth);
  let best: number = HORIZONTAL_AZIMUTH_VALUES[0];
  let bestDist = 360;
  for (const preset of HORIZONTAL_AZIMUTH_VALUES) {
    const dist = azimuthDelta(normalized, preset);
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

export function snapElevation(elevation: number): number {
  const normalized = normalizeElevation(elevation);
  let best: number = ELEVATION_PRESET_VALUES[0];
  let bestDist = Infinity;
  for (const preset of ELEVATION_PRESET_VALUES) {
    const dist = Math.abs(normalized - preset);
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }
  return best;
}

/** Format angle for prompt/API (1 decimal when needed, keeps sign). */
export function formatAngleNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function isPresetAzimuth(azimuth: number, preset: number, epsilon = 0.5): boolean {
  return azimuthDelta(azimuth, preset) <= epsilon;
}

export function isPresetElevation(elevation: number, preset: number, epsilon = 0.5): boolean {
  return Math.abs(normalizeElevation(elevation) - preset) <= epsilon;
}

/** Natural-language camera orbit hint for image-model prompts (0°=front, 90°=right). */
export function describeAzimuthForPrompt(azimuth: number): string {
  const az = normalizeAzimuth(azimuth);
  const deg = formatAngleNumber(az);

  if (isPresetAzimuth(az, 0)) return "POV在主体正前方，面向主体正面";
  if (isPresetAzimuth(az, 90)) return "POV在主体正右侧，拍摄主体右侧面";
  if (isPresetAzimuth(az, 180)) return "POV在主体正后方，拍摄主体背面";
  if (isPresetAzimuth(az, 270)) return "POV在主体正左侧，拍摄主体左侧面";
  if (isPresetAzimuth(az, 45)) return "POV在主体右前方45度，斜向拍摄主体";
  if (isPresetAzimuth(az, 135)) return "POV在主体右后方135度，斜向拍摄主体背侧";
  if (isPresetAzimuth(az, 225)) return "POV在主体左后方225度，斜向拍摄主体背侧";
  if (isPresetAzimuth(az, 315)) return "POV在主体左前方315度，斜向拍摄主体";

  if (az > 0 && az < 90) return `POV在主体右前方约${deg}度，斜向拍摄主体`;
  if (az > 90 && az < 180) return `POV在主体右后方约${deg}度，斜向拍摄主体背侧`;
  if (az > 180 && az < 270) return `POV在主体左后方约${deg}度，斜向拍摄主体背侧`;
  if (az > 270 && az < 360) return `POV在主体左前方约${deg}度，斜向拍摄主体`;
  return `POV绕主体水平旋转至${deg}度`;
}

/** Natural-language elevation hint (+90 top-down, 0 eye-level, -90 low angle). */
export function describeElevationForPrompt(elevation: number): string {
  const el = normalizeElevation(elevation);
  const deg = formatAngleNumber(Math.abs(el));

  if (Math.abs(el) < 2) return "POV与主体视线平齐，平视拍摄";
  if (isPresetElevation(el, 90)) return "POV在主体正上方，垂直俯视拍摄";
  if (isPresetElevation(el, -90)) return "POV在主体下方，极低角度仰拍";
  if (isPresetElevation(el, 45)) return "POV明显高于主体，俯拍视角";
  if (isPresetElevation(el, -45)) return "POV低于主体，仰拍视角";
  if (el > 60) return `POV在主体上方约${deg}度，大俯角向下拍摄`;
  if (el > 15) return `POV略高于主体，俯角约${deg}度`;
  if (el < -60) return `POV在主体下方约${deg}度，大仰角向上拍摄`;
  return `POV略低于主体，仰角约${deg}度`;
}
