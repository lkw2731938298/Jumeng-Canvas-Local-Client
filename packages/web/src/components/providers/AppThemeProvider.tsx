"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  applyAppTheme,
  getAppTheme,
  getAppThemeDefinition,
  setAppTheme,
  type AppThemeDefinition,
  type AppThemeId,
} from "@/lib/theme/appThemes";

interface AppThemeContextValue {
  themeId: AppThemeId;
  theme: AppThemeDefinition;
  selectTheme: (id: AppThemeId) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<AppThemeId>(() => getAppTheme());

  useEffect(() => {
    const stored = getAppTheme();
    setThemeId(stored);
    applyAppTheme(stored);
  }, []);

  const selectTheme = useCallback((id: AppThemeId) => {
    setAppTheme(id);
    setThemeId(id);
    applyAppTheme(id);
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      theme: getAppThemeDefinition(themeId),
      selectTheme,
    }),
    [themeId, selectTheme]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}
