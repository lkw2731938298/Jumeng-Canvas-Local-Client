"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_GLOBAL_WATERMARK_ENABLED,
  readGlobalWatermarkEnabled,
  writeGlobalWatermarkEnabled,
} from "@/lib/preferences/globalWatermark";

interface GlobalWatermarkContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

const GlobalWatermarkContext = createContext<GlobalWatermarkContextValue | null>(null);

export function GlobalWatermarkProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(DEFAULT_GLOBAL_WATERMARK_ENABLED);

  useEffect(() => {
    setEnabledState(readGlobalWatermarkEnabled());
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    writeGlobalWatermarkEnabled(next);
    setEnabledState(next);
  }, []);

  const toggle = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  const value = useMemo(
    () => ({
      enabled,
      setEnabled,
      toggle,
    }),
    [enabled, setEnabled, toggle]
  );

  return (
    <GlobalWatermarkContext.Provider value={value}>{children}</GlobalWatermarkContext.Provider>
  );
}

export function useGlobalWatermark() {
  const ctx = useContext(GlobalWatermarkContext);
  if (!ctx) {
    throw new Error("useGlobalWatermark must be used within GlobalWatermarkProvider");
  }
  return ctx;
}
