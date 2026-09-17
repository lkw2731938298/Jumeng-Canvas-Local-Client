import type { LightDirection } from "@/lib/canvas/renderToolPrompt";

export type LightingViewMode = "perspective" | "front";

export interface LightingOptions {
  smartMode: boolean;
  brightness: number;
  color: string | null;
  direction: LightDirection;
  rimLight: boolean;
  viewMode: LightingViewMode;
}

export const DEFAULT_LIGHTING: LightingOptions = {
  smartMode: false,
  brightness: 50,
  color: null,
  direction: "front",
  rimLight: false,
  viewMode: "perspective",
};

export const LIGHT_DIRECTION_ORDER: LightDirection[] = [
  "left",
  "top",
  "right",
  "front",
  "bottom",
  "back",
];

/** Map main light direction to orbit angles for 3D preview. */
export function directionToAngles(direction: LightDirection): { azimuth: number; elevation: number } {
  switch (direction) {
    case "front":
      return { azimuth: 0, elevation: 0 };
    case "right":
      return { azimuth: 90, elevation: 0 };
    case "back":
      return { azimuth: 180, elevation: 0 };
    case "left":
      return { azimuth: 270, elevation: 0 };
    case "top":
      return { azimuth: 0, elevation: 90 };
    case "bottom":
      return { azimuth: 0, elevation: -90 };
    default:
      return { azimuth: 0, elevation: 0 };
  }
}

export function normalizeLightingOptions(raw: unknown): LightingOptions {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LIGHTING };
  const obj = raw as Record<string, unknown>;
  const direction = String(obj.direction ?? "front") as LightDirection;
  const validDirection = LIGHT_DIRECTION_ORDER.includes(direction) ? direction : "front";
  const brightness = Number(obj.brightness);
  const viewMode = obj.viewMode === "front" ? "front" : "perspective";
  const colorRaw = obj.color;
  const color =
    colorRaw === null || colorRaw === undefined || colorRaw === ""
      ? null
      : String(colorRaw);
  return {
    smartMode: Boolean(obj.smartMode),
    brightness: Number.isFinite(brightness) ? Math.max(0, Math.min(100, brightness)) : 50,
    color,
    direction: validDirection,
    rimLight: Boolean(obj.rimLight),
    viewMode,
  };
}
