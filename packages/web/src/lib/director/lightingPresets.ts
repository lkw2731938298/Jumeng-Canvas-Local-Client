export type LightingPresetId =
  | "classic_three_point"
  | "dramatic_low"
  | "soft_portrait"
  | "backlight_silhouette"
  | "golden_hour"
  | "noon_overhead"
  | "neon_night"
  | "film_noir"
  | "overcast_soft"
  | "rim_beauty"
  | "candle_warm"
  | "stage_spot";

export interface LightingLightDef {
  position: [number, number, number];
  intensity: number;
  color: string;
  castShadow?: boolean;
}

export interface LightingPreset {
  id: LightingPresetId;
  label: string;
  /** 短说明，卡片副标题 */
  note: string;
  ambient: number;
  lights: LightingLightDef[];
}

/** 场景布光状态（预设 + 可调角度） */
export interface DirectorLightingState {
  preset: LightingPresetId;
  /** 水平旋转灯组（度），绕场景 Y 轴，-180~180 */
  yawDeg?: number;
  /** 俯仰偏移（度），正值抬高灯光、负值压低，约 -45~45 */
  pitchDeg?: number;
}

export const DEFAULT_LIGHTING_STATE: DirectorLightingState = {
  preset: "classic_three_point",
  yawDeg: 0,
  pitchDeg: 0,
};

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: "classic_three_point",
    label: "经典三点布光",
    note: "主光 + 辅光 + 轮廓光，通用均衡",
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
    note: "低位硬光、高反差，悬疑 / 冲突",
    ambient: 0.12,
    lights: [
      { position: [8, 3, 0], intensity: 1.2, color: "#ffd9b3", castShadow: true },
      { position: [0, 8, -2], intensity: 0.25, color: "#8090ff" },
    ],
  },
  {
    id: "soft_portrait",
    label: "柔光人像",
    note: "大面积柔光，人物肤质友好",
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
    note: "强逆光勾边，剪影 / 氛围感",
    ambient: 0.08,
    lights: [
      { position: [0, 4, -8], intensity: 1.3, color: "#ffe8cc", castShadow: true },
      { position: [0, 1, 6], intensity: 0.2, color: "#a0b0ff" },
    ],
  },
  {
    id: "golden_hour",
    label: "黄金时刻",
    note: "暖色侧逆光，傍晚电影感",
    ambient: 0.22,
    lights: [
      { position: [9, 3.5, -4], intensity: 1.25, color: "#ffb070", castShadow: true },
      { position: [-3, 2, 5], intensity: 0.3, color: "#8899cc" },
      { position: [0, 7, 2], intensity: 0.2, color: "#ffe8d0" },
    ],
  },
  {
    id: "noon_overhead",
    label: "正午顶光",
    note: "高位直射，硬阴影、纪实感",
    ambient: 0.4,
    lights: [
      { position: [0.5, 12, 0.5], intensity: 1.15, color: "#fffaf0", castShadow: true },
      { position: [-3, 2, 4], intensity: 0.2, color: "#d0d8ff" },
    ],
  },
  {
    id: "neon_night",
    label: "霓虹夜景",
    note: "冷暖对撞色，赛博 / 都市夜",
    ambient: 0.1,
    lights: [
      { position: [5, 2.5, 4], intensity: 0.9, color: "#ff4d8d", castShadow: true },
      { position: [-6, 3, 2], intensity: 0.85, color: "#2de2e6" },
      { position: [0, 8, -3], intensity: 0.25, color: "#6b5cff" },
    ],
  },
  {
    id: "film_noir",
    label: "黑色电影",
    note: "硬侧光、深阴影，悬疑叙事",
    ambient: 0.06,
    lights: [
      { position: [7, 5, 1], intensity: 1.35, color: "#f2eee6", castShadow: true },
      { position: [-4, 1.5, -3], intensity: 0.15, color: "#4050a0" },
    ],
  },
  {
    id: "overcast_soft",
    label: "阴天漫射",
    note: "低对比柔光，情绪克制",
    ambient: 0.62,
    lights: [
      { position: [2, 9, 3], intensity: 0.55, color: "#eef2ff" },
      { position: [-3, 7, 2], intensity: 0.45, color: "#f5f7ff" },
      { position: [0, 4, 6], intensity: 0.35, color: "#ffffff" },
    ],
  },
  {
    id: "rim_beauty",
    label: "轮廓美颜",
    note: "双侧勾边 + 正面柔光，广告感",
    ambient: 0.32,
    lights: [
      { position: [0, 4, 7], intensity: 0.55, color: "#fff8f0", castShadow: true },
      { position: [6, 5, -2], intensity: 0.75, color: "#ffe0c8" },
      { position: [-6, 5, -2], intensity: 0.75, color: "#d8e8ff" },
    ],
  },
  {
    id: "candle_warm",
    label: "烛光暖调",
    note: "低位暖点光，亲密 / 怀旧",
    ambient: 0.14,
    lights: [
      { position: [1.5, 1.8, 3], intensity: 1.1, color: "#ff9a4d", castShadow: true },
      { position: [-2, 3, -2], intensity: 0.25, color: "#4060a0" },
    ],
  },
  {
    id: "stage_spot",
    label: "舞台追光",
    note: "单束顶侧追光，戏剧聚焦",
    ambient: 0.05,
    lights: [
      { position: [2, 10, 4], intensity: 1.5, color: "#fff6e8", castShadow: true },
      { position: [-5, 2, -4], intensity: 0.12, color: "#304080" },
    ],
  },
];

export function getLightingPreset(id: LightingPresetId | string): LightingPreset {
  return LIGHTING_PRESETS.find((p) => p.id === id) ?? LIGHTING_PRESETS[0]!;
}

export function normalizeLightingState(
  raw: Partial<DirectorLightingState> | null | undefined
): DirectorLightingState {
  const preset = (raw?.preset && LIGHTING_PRESETS.some((p) => p.id === raw.preset)
    ? raw.preset
    : DEFAULT_LIGHTING_STATE.preset) as LightingPresetId;
  const yawDeg = clampNum(raw?.yawDeg, -180, 180, 0);
  const pitchDeg = clampNum(raw?.pitchDeg, -45, 45, 0);
  return { preset, yawDeg, pitchDeg };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 按 yaw / pitch 旋转灯位（绕原点，面向场景中心） */
export function resolveLightingLights(
  preset: LightingPreset,
  yawDeg = 0,
  pitchDeg = 0
): LightingLightDef[] {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  return preset.lights.map((light) => {
    let [x, y, z] = light.position;
    // 先绕 Y：水平转灯组
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    // 再绕 X：俯仰（抬高/压低）
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    return {
      ...light,
      position: [x1, Math.max(0.3, y2), z2] as [number, number, number],
    };
  });
}
