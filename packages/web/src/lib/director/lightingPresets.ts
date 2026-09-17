export type LightingPresetId =
  | "classic_three_point"
  | "dramatic_low"
  | "soft_portrait"
  | "backlight_silhouette";

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  ambient: number;
  lights: Array<{
    position: [number, number, number];
    intensity: number;
    color: string;
    castShadow?: boolean;
  }>;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: "classic_three_point",
    label: "经典三点布光",
    ambient: 0.35,
    lights: [
      { position: [6, 8, 5], intensity: 1.1, color: "#fff5e6", castShadow: true },
      { position: [-5, 4, 3], intensity: 0.45, color: "#e8eeff" },
      { position: [-2, 6, -6], intensity: 0.55, color: "#f0f0ff" },
    ],
  },
  {
    id: "dramatic_low",
    label: "戏剧低光",
    ambient: 0.12,
    lights: [
      { position: [8, 3, 0], intensity: 1.2, color: "#ffd9b3", castShadow: true },
      { position: [0, 8, -2], intensity: 0.25, color: "#8090ff" },
    ],
  },
  {
    id: "soft_portrait",
    label: "柔光人像",
    ambient: 0.5,
    lights: [
      { position: [0, 5, 6], intensity: 0.85, color: "#ffffff", castShadow: true },
      { position: [-4, 3, 4], intensity: 0.35, color: "#f5f5ff" },
      { position: [4, 3, 4], intensity: 0.35, color: "#f5f5ff" },
    ],
  },
  {
    id: "backlight_silhouette",
    label: "逆光剪影",
    ambient: 0.08,
    lights: [
      { position: [0, 4, -8], intensity: 1.3, color: "#ffe8cc", castShadow: true },
      { position: [0, 1, 6], intensity: 0.2, color: "#a0b0ff" },
    ],
  },
];

export function getLightingPreset(id: LightingPresetId): LightingPreset {
  return LIGHTING_PRESETS.find((p) => p.id === id) ?? LIGHTING_PRESETS[0]!;
}
