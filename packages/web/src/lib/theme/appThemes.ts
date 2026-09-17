export type AppThemeId = "dark" | "light" | "dark-blue" | "dark-green" | "light-blue";

export interface AppThemeDefinition {
  id: AppThemeId;
  label: string;
  description: string;
  isDark: boolean;
  preview: { bg: string; fg: string; accent: string };
}

export const DEFAULT_APP_THEME_ID: AppThemeId = "dark";

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: "dark",
    label: "深色",
    description: "默认暗色界面",
    isDark: true,
    preview: { bg: "#0f0f1a", fg: "#e2e8f0", accent: "#8b5cf6" },
  },
  {
    id: "light",
    label: "浅色",
    description: "明亮阅读模式",
    isDark: false,
    preview: { bg: "#f8fafc", fg: "#0f172a", accent: "#7c3aed" },
  },
  {
    id: "dark-blue",
    label: "深蓝",
    description: "深色 + 海蓝主色",
    isDark: true,
    preview: { bg: "#020810", fg: "#e2e8f0", accent: "#3b82f6" },
  },
  {
    id: "dark-green",
    label: "墨绿",
    description: "深色 + 翠绿主色",
    isDark: true,
    preview: { bg: "#020a08", fg: "#e2e8f0", accent: "#10b981" },
  },
  {
    id: "light-blue",
    label: "浅蓝",
    description: "浅色 + 海蓝主色",
    isDark: false,
    preview: { bg: "#f0f7ff", fg: "#0f172a", accent: "#2563eb" },
  },
];

const THEME_MAP = new Map(APP_THEMES.map((t) => [t.id, t]));
const STORAGE_KEY = "jm_app_theme_v1";

export function getAppTheme(): AppThemeId {
  if (typeof window === "undefined") return DEFAULT_APP_THEME_ID;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && THEME_MAP.has(raw as AppThemeId)) return raw as AppThemeId;
  } catch {
    /* ignore */
  }
  return DEFAULT_APP_THEME_ID;
}

export function setAppTheme(id: AppThemeId) {
  if (typeof window === "undefined") return;
  if (!THEME_MAP.has(id)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getAppThemeDefinition(id: AppThemeId = getAppTheme()): AppThemeDefinition {
  return THEME_MAP.get(id) ?? THEME_MAP.get(DEFAULT_APP_THEME_ID)!;
}

export function applyAppTheme(id: AppThemeId) {
  if (typeof document === "undefined") return;
  const theme = getAppThemeDefinition(id);
  const root = document.documentElement;
  root.dataset.appTheme = id;
  root.classList.toggle("dark", theme.isDark);
  root.style.colorScheme = theme.isDark ? "dark" : "light";
}
