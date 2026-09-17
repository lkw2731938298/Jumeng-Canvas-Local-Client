"use client";

import { useState } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVisualStyles } from "@/lib/canvas/useVisualStyles";
import { DEFAULT_VISUAL_STYLE_ID, findVisualStyle } from "@/lib/canvas/renderToolPrompt";
import { VisualStylePickerDialog } from "./VisualStylePickerDialog";

interface VisualStyleBarProps {
  value: string;
  onChange: (styleId: string) => void;
  className?: string;
  /** compact = icon-only for merged toolbar row */
  compact?: boolean;
}

/** Collapsed visual style selector for image/video node editor. */
export function VisualStyleBar({ value, onChange, className, compact = false }: VisualStyleBarProps) {
  const [open, setOpen] = useState(false);
  const { styles, config, isLoading } = useVisualStyles();
  const selectedId = value?.trim() || DEFAULT_VISUAL_STYLE_ID;
  const selected = findVisualStyle(config, selectedId);
  const hasCustomStyle = selectedId !== DEFAULT_VISUAL_STYLE_ID && Boolean(selected);

  return (
    <>
      {compact ? (
        <button
          type="button"
          className={cn(
            "relative flex size-8 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white",
            className
          )}
          onClick={() => setOpen(true)}
          aria-label="选择视觉风格"
          title={isLoading ? "加载中…" : `视觉风格：${selected?.label ?? "无"}`}
        >
          <LayoutGrid className="size-[18px]" strokeWidth={1.75} />
          {hasCustomStyle ? (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-sky-400" aria-hidden />
          ) : null}
        </button>
      ) : (
        <div className={cn("border-b border-white/10", className)}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
            onClick={() => setOpen(true)}
            aria-label="选择视觉风格"
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] text-white/70">
              <LayoutGrid className="h-4 w-4 shrink-0 text-white/40" />
              <span className="text-white/45">视觉风格</span>
              <span className="truncate text-white/80">
                {isLoading ? "加载中…" : selected?.label ?? "无"}
              </span>
            </span>
            <span className="shrink-0 text-[12px] text-white/35">选择</span>
          </button>
        </div>
      )}

      <VisualStylePickerDialog
        open={open}
        onOpenChange={setOpen}
        styles={styles}
        value={selectedId}
        onSelect={onChange}
      />
    </>
  );
}
