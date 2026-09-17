"use client";

import Lightfall from "@/components/projects/Lightfall";
import { useAppTheme } from "@/components/providers/AppThemeProvider";

/** 个人中心 / 邀请等独立页背景：跟随全局主题，避免写死蓝底白字。 */
export function ThemePageBackdrop() {
  const { theme } = useAppTheme();
  return (
    <div className="absolute inset-0 z-0 bg-background">
      <Lightfall
        colors={
          theme.isDark
            ? ["#a6fff8", theme.preview.accent, "#c89fff"]
            : [theme.preview.accent, "#93c5fd", "#ddd6fe"]
        }
        backgroundColor={theme.preview.bg}
        speed={0.4}
        streakCount={2}
        glow={theme.isDark ? 0.2 : 0.12}
        mouseStrength={0.2}
        density={0.6}
        opacity={theme.isDark ? 1 : 0.28}
        mouseInteraction
      />
    </div>
  );
}
