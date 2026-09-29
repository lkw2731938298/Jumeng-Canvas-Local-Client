"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  getThemeDefinition,
  loadAppearance,
  normalizeAppearance,
  resolveIsDark,
  saveAppearance,
  type AppearanceSettings,
  type AppThemeDefinition,
  type AppThemeId,
} from "@/lib/theme/appThemes";

interface AppThemeContextValue {
  /** 当前生效外观（含设置页未保存的预览草稿） */
  appearance: AppearanceSettings;
  /** 已持久化的外观 */
  savedAppearance: AppearanceSettings;
  /** 是否存在未保存的预览改动 */
  dirty: boolean;
  /** 实时预览（不落盘） */
  previewAppearance: (patch: Partial<AppearanceSettings>) => void;
  /** 保存预览草稿 */
  commitAppearance: () => void;
  /** 丢弃预览草稿，恢复已保存外观 */
  discardAppearance: () => void;
  /** 立即修改并保存（用户菜单快捷切换） */
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  themeId: AppThemeId;
  theme: AppThemeDefinition;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function sameAppearance(a: AppearanceSettings, b: AppearanceSettings) {
  return (
    a.mode === b.mode &&
    a.accent === b.accent &&
    a.glass === b.glass &&
    a.glow === b.glow &&
    a.gridSnap === b.gridSnap &&
    a.scale === b.scale
  );
}

/**
 * 已保存外观的外部 store（localStorage 为源）：
 * 服务端快照用默认值、客户端读真实值，由 useSyncExternalStore 处理水合差异，避免 effect 内 setState。
 */
let savedCache: AppearanceSettings | null = null;
const savedListeners = new Set<() => void>();

function readSavedAppearance(): AppearanceSettings {
  if (!savedCache) savedCache = loadAppearance();
  return savedCache;
}

function getServerAppearance(): AppearanceSettings {
  return DEFAULT_APPEARANCE;
}

function subscribeSavedAppearance(cb: () => void) {
  savedListeners.add(cb);
  return () => {
    savedListeners.delete(cb);
  };
}

/** 持久化并通知订阅者 */
function writeSavedAppearance(next: AppearanceSettings) {
  saveAppearance(next);
  savedCache = next;
  savedListeners.forEach((l) => l());
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const saved = useSyncExternalStore(subscribeSavedAppearance, readSavedAppearance, getServerAppearance);
  const [draft, setDraft] = useState<AppearanceSettings | null>(null);
  /** 系统深浅色变化计数，用于「跟随系统」时重算 */
  const [systemTick, setSystemTick] = useState(0);

  const appearance = draft ?? saved;

  // 直接读 store 而非水合期的默认快照，避免首次 effect 用默认值覆盖首屏内联脚本已设好的外观
  useEffect(() => {
    applyAppearance(draft ?? readSavedAppearance());
  }, [draft, saved, systemTick]);

  // 跟随系统：监听操作系统深浅色切换
  useEffect(() => {
    if (appearance.mode !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTick((n) => n + 1);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance.mode]);

  const previewAppearance = useCallback(
    (patch: Partial<AppearanceSettings>) => {
      setDraft((prev) => normalizeAppearance({ ...(prev ?? saved), ...patch }));
    },
    [saved]
  );

  const commitAppearance = useCallback(() => {
    if (draft) writeSavedAppearance(draft);
    setDraft(null);
  }, [draft]);

  const discardAppearance = useCallback(() => setDraft(null), []);

  const updateAppearance = useCallback(
    (patch: Partial<AppearanceSettings>) => {
      const next = normalizeAppearance({ ...saved, ...patch });
      writeSavedAppearance(next);
      setDraft(null);
    },
    [saved]
  );

  const value = useMemo(() => {
    const isDark = resolveIsDark(appearance.mode);
    const theme = getThemeDefinition(appearance, isDark);
    return {
      appearance,
      savedAppearance: saved,
      dirty: draft != null && !sameAppearance(draft, saved),
      previewAppearance,
      commitAppearance,
      discardAppearance,
      updateAppearance,
      themeId: theme.id,
      theme,
    };
    // systemTick 变化时需重算 isDark
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance, saved, draft, systemTick, previewAppearance, commitAppearance, discardAppearance, updateAppearance]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}
