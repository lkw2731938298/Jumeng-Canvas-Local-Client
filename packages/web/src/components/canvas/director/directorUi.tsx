"use client";

/**
 * 导演台控制台 UI 公共样式：毛玻璃浮层 + 分区标题。
 * 3D 画布铺满视口，所有面板以浮层形式叠在其上（z-index 须高于画布的 25）。
 */

import type { ReactNode } from "react";

/** 毛玻璃浮层卡片 */
export const GLASS_PANEL =
  "rounded-2xl border border-white/[0.08] bg-[rgba(13,13,21,0.78)] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl";

/** 浮层内小号按钮 */
export const GHOST_BTN =
  "flex items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30";

export function PanelSection({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">{title}</span>
        <span className="h-px flex-1 bg-white/[0.06]" />
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 垂直视场角（度）→ 全画幅等效焦距（mm，传感器高 24mm） */
export function fovToFocalMm(fov: number): number {
  const rad = ((fov || 45) * Math.PI) / 180;
  return Math.round(12 / Math.tan(rad / 2));
}
