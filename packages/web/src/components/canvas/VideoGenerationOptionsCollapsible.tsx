"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Music2, RectangleHorizontal } from "lucide-react";
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import {
  VideoGenerationOptionsPanel,
  VideoOptionsSummaryPill,
} from "./VideoGenerationOptionsPanel";
import { useCanvasStore } from "@/stores/canvasStore";
import { cn } from "@/lib/utils";

interface VideoGenerationOptionsCollapsibleProps {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  summaryFallback?: string;
  /** block = full-width row; inline = compact toolbar segment */
  layout?: "block" | "inline";
  /** inline 触发器左侧图标：视频比例框 / 音频音符 */
  leadingIcon?: "ratio" | "music";
}

/** Collapsed: selected options only. Click to expand full settings (reference UI). */
export function VideoGenerationOptionsCollapsible({
  presets,
  value,
  onChange,
  pricing,
  summaryFallback = "点击设置视频参数",
  layout = "block",
  leadingIcon = "ratio",
}: VideoGenerationOptionsCollapsibleProps) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inline = layout === "inline";
  // 与顶栏「编辑」等下拉互斥：展开参数时关顶栏，顶栏打开时收起本面板
  const storeExpanded = useCanvasStore((s) => s.generationOptionsExpanded);
  const setGenerationOptionsExpanded = useCanvasStore((s) => s.setGenerationOptionsExpanded);
  const requestCloseTopMenus = useCanvasStore((s) => s.requestCloseTopMenus);

  useEffect(() => {
    if (!storeExpanded && expanded) setExpanded(false);
  }, [storeExpanded, expanded]);

  useEffect(() => {
    return () => setGenerationOptionsExpanded(false);
  }, [setGenerationOptionsExpanded]);

  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // 点到顶栏浮层时勿收起：由顶栏打开逻辑显式关闭参数面板
      if (
        t instanceof Element &&
        t.closest(".canvas-node-overlay") &&
        rootRef.current &&
        !rootRef.current.contains(t)
      ) {
        return;
      }
      if (rootRef.current && !rootRef.current.contains(t)) {
        setExpanded(false);
        setGenerationOptionsExpanded(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
        setGenerationOptionsExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, setGenerationOptionsExpanded]);

  return (
    <div className={cn("flex min-w-0 items-center", inline ? "gap-1.5" : "flex-col")}>
      <div
        ref={rootRef}
        className={cn("relative", inline ? "min-w-0 max-w-full" : "w-full border-b border-white/10")}
      >
        {expanded ? (
          <div
            className={cn(
              "absolute bottom-full z-[60] mb-1.5 overflow-visible rounded-2xl border border-white/10 bg-[#14141f]/[0.98] shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md",
              inline ? "left-0 w-[min(440px,calc(100vw-48px))]" : "left-2 right-2"
            )}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <VideoGenerationOptionsPanel
              presets={presets}
              value={value}
              onChange={onChange}
              pricing={pricing}
            />
          </div>
        ) : null}

        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 text-left transition-colors",
            inline
              ? "h-8 max-w-full rounded-md px-1.5 hover:bg-white/[0.06]"
              : cn(
                  "w-full justify-between gap-2 px-3 py-2.5",
                  expanded ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
                )
          )}
          onClick={() => {
            // 禁止在 setState updater 内再调 store.set：会触发
            //「渲染 A 时更新 B」(CanvasHeader) 的 React 警告
            const next = !expanded;
            setExpanded(next);
            setGenerationOptionsExpanded(next);
            if (next) requestCloseTopMenus();
          }}
          aria-expanded={expanded}
          aria-label={expanded ? "收起生成参数" : "展开生成参数"}
        >
          {inline ? (
            leadingIcon === "music" ? (
              <Music2 className="size-3.5 shrink-0 text-white/50" aria-hidden />
            ) : (
              <RectangleHorizontal className="size-3.5 shrink-0 text-white/50" aria-hidden />
            )
          ) : null}
          <VideoOptionsSummaryPill
            presets={presets}
            value={value}
            className={cn(
              "min-w-0 border-0 bg-transparent px-0 py-0 text-[13px] text-white/70",
              inline ? "max-w-[min(420px,55vw)] truncate" : "flex-1"
            )}
            fallback={summaryFallback}
          />
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-white/45 transition-transform",
              expanded && "rotate-180"
            )}
            aria-hidden
          />
        </button>
      </div>
    </div>
  );
}
