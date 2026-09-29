/**
 * 外观设置（设置页「外观」）：
 * - 主题模式：深色 / 浅色 / 跟随系统（html[data-app-theme] 只会是 dark 或 light）
 * - 强调色：紫 / 蓝 / 青 / 红 / 橙（html[data-app-accent]，globals.css 覆盖 --primary 等变量）
 * - 毛玻璃、动态光晕：html[data-app-glass] / [data-app-glow]，仅项目/任务/设置页样式读取
 * - 网格吸附：项目画板拖动卡片时按网格对齐
 * - 界面缩放：80–120%，作用于 html zoom
 * 旧版 5 个固定主题（jm_app_theme_v1）首次读取时自动迁移为「底色 × 强调色」。
 */

export type ThemeMode = "dark" | "light" | "system";
export type AccentId = "violet" | "blue" | "teal" | "red" | "orange";

export interface AppearanceSettings {
  mode: ThemeMode;
  accent: AccentId;
  glass: boolean;
  glow: boolean;
  gridSnap: boolean;
  /** 界面缩放百分比 80–120 */
  scale: number;
}

/** 兼容旧调用方：themeId 仅作依赖标识（如画布背景重算），形如 dark-violet */
export type AppThemeId = string;

export interface AppThemeDefinition {
  id: AppThemeId;
  label: string;
  isDark: boolean;
  preview: { bg: string; fg: string; accent: string };
}

export const ACCENTS: { id: AccentId; label: string; color: string; lightColor: string }[] = [
  { id: "violet", label: "紫", color: "#8b7cf8", lightColor: "#7c3aed" },
  { id: "blue", label: "蓝", color: "#2aabfe", lightColor: "#1d7fe0" },
  { id: "teal", label: "青", color: "#14d9bd", lightColor: "#0d9f8a" },
  { id: "red", label: "红", color: "#f7506a", lightColor: "#e0334f" },
  { id: "orange", label: "橙", color: "#f3b352", lightColor: "#d98a14" },
];

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "dark", label: "深色" },
  { id: "light", label: "浅色" },
  { id: "system", label: "跟随系统" },
];

export const SCALE_MIN = 80;
export const SCALE_MAX = 120;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  mode: "dark",
  accent: "violet",
  glass: true,
  glow: true,
  gridSnap: false,
  scale: 100,
};

const STORAGE_KEY = "jm_appearance_v1";
const LEGACY_THEME_KEY = "jm_app_theme_v1";

/** 旧主题 id → 新外观（底色 × 强调色） */
const LEGACY_MAP: Record<string, Pick<AppearanceSettings, "mode" | "accent">> = {
  dark: { mode: "dark", accent: "violet" },
  light: { mode: "light", accent: "violet" },
  "dark-blue": { mode: "dark", accent: "blue" },
  "dark-green": { mode: "dark", accent: "teal" },
  "light-blue": { mode: "light", accent: "blue" },
};

const MODE_SET = new Set<ThemeMode>(["dark", "light", "system"]);
const ACCENT_SET = new Set<AccentId>(ACCENTS.map((a) => a.id));

/** 清洗外部数据，缺失字段回落默认值 */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<AppearanceSettings>;
  const scale = Number(o.scale);
  return {
    mode: MODE_SET.has(o.mode as ThemeMode) ? (o.mode as ThemeMode) : DEFAULT_APPEARANCE.mode,
    accent: ACCENT_SET.has(o.accent as AccentId) ? (o.accent as AccentId) : DEFAULT_APPEARANCE.accent,
    glass: typeof o.glass === "boolean" ? o.glass : DEFAULT_APPEARANCE.glass,
    glow: typeof o.glow === "boolean" ? o.glow : DEFAULT_APPEARANCE.glow,
    gridSnap: typeof o.gridSnap === "boolean" ? o.gridSnap : DEFAULT_APPEARANCE.gridSnap,
    scale: Number.isFinite(scale)
      ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(scale)))
      : DEFAULT_APPEARANCE.scale,
  };
}

export function loadAppearance(): AppearanceSettings {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeAppearance(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy && LEGACY_MAP[legacy]) {
      return { ...DEFAULT_APPEARANCE, ...LEGACY_MAP[legacy] };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_APPEARANCE;
}

export function saveAppearance(settings: AppearanceSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeAppearance(settings)));
  } catch {
    /* ignore */
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveIsDark(mode: ThemeMode): boolean {
  return mode === "system" ? systemPrefersDark() : mode === "dark";
}

export function accentColor(accent: AccentId, isDark: boolean): string {
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0];
  return isDark ? a.color : a.lightColor;
}

export function getThemeDefinition(settings: AppearanceSettings, isDark = resolveIsDark(settings.mode)): AppThemeDefinition {
  return {
    id: `${isDark ? "dark" : "light"}-${settings.accent}`,
    label: isDark ? "深色" : "浅色",
    isDark,
    preview: {
      bg: isDark ? "#030013" : "#f6f5fb",
      fg: isDark ? "#e2e8f0" : "#0f172a",
      accent: accentColor(settings.accent, isDark),
    },
  };
}

/** 把外观写到 <html>：底色、强调色、毛玻璃、光晕、缩放 */
export function applyAppearance(settings: AppearanceSettings) {
  if (typeof document === "undefined") return;
  const isDark = resolveIsDark(settings.mode);
  const root = document.documentElement;
  root.dataset.appTheme = isDark ? "dark" : "light";
  root.dataset.appAccent = settings.accent;
  root.dataset.appGlass = settings.glass ? "on" : "off";
  root.dataset.appGlow = settings.glow ? "on" : "off";
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
  root.style.zoom = settings.scale === 100 ? "" : String(settings.scale / 100);
}

/** layout.tsx 首屏前内联脚本（与 applyAppearance 逻辑保持一致） */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var s=null;var raw=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY
)});if(raw){s=JSON.parse(raw);}else{var l=localStorage.getItem(${JSON.stringify(
  LEGACY_THEME_KEY
)});var m=${JSON.stringify(LEGACY_MAP)};if(l&&m[l]){s=m[l];}}s=s||{};var mode=s.mode||"dark";var dark=mode==="system"?(window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)").matches:true):mode!=="light";var r=document.documentElement;r.dataset.appTheme=dark?"dark":"light";r.dataset.appAccent=s.accent||"violet";r.dataset.appGlass=s.glass===false?"off":"on";r.dataset.appGlow=s.glow===false?"off":"on";r.classList.toggle("dark",dark);r.style.colorScheme=dark?"dark":"light";var sc=Number(s.scale);if(sc&&sc!==100&&sc>=80&&sc<=120){r.style.zoom=String(sc/100);}}catch(e){}})();`;
