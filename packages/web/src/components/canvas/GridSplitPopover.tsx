"use client";

import { useEffect, useId, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { GRID_SPLIT_MAX, GRID_SPLIT_MIN } from "@/lib/canvas/gridSplitImage";
import { CANVAS_OVERLAY_DROPDOWN_CLASS } from "@/lib/canvas/canvasOverlayTransform";
import { cn } from "@/lib/utils";

interface GridSplitPopoverProps {
  open: boolean;
  creditLabel: string;
  busy: boolean;
  progressText?: string;
  onConfirm: (rows: number, cols: number) => void;
  onClose: () => void;
}

const PRESETS: Array<{ rows: number; cols: number; label: string }> = [
  { rows: 2, cols: 2, label: "4宫格 (2×2)" },
  { rows: 3, cols: 3, label: "9宫格 (3×3)" },
  { rows: 4, cols: 4, label: "16宫格 (4×4)" },
  { rows: 5, cols: 5, label: "25宫格 (5×5)" },
];

function clampDim(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(GRID_SPLIT_MIN, Math.min(GRID_SPLIT_MAX, Math.round(value)));
}

/** 宫格切分：预设列表 + 自定义 5×5 点选面板（对齐产品截图） */
export function GridSplitPopover({
  open,
  creditLabel,
  busy,
  progressText,
  onConfirm,
  onClose,
}: GridSplitPopoverProps) {
  const titleId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(2);
  const [hoverCols, setHoverCols] = useState(2);

  useEffect(() => {
    if (!open) {
      setCustomOpen(false);
      setHoverRows(2);
      setHoverCols(2);
    }
  }, [open]);

  if (!open) return null;

  const pick = (rows: number, cols: number) => {
    if (busy) return;
    onConfirm(clampDim(rows), clampDim(cols));
  };

  return (
    <div
      className={`absolute left-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 flex items-start gap-1.5`}
      role="dialog"
      aria-labelledby={titleId}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="min-w-[168px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl">
        <div id={titleId} className="sr-only">
          宫格切分
        </div>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={busy}
            onClick={() => pick(preset.rows, preset.cols)}
            className="flex w-full items-center px-3.5 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {preset.label}
          </button>
        ))}
        <div className="mx-2.5 my-1 h-px bg-white/10" aria-hidden />
        <button
          type="button"
          disabled={busy}
          onMouseEnter={() => setCustomOpen(true)}
          onFocus={() => setCustomOpen(true)}
          onClick={() => setCustomOpen((v) => !v)}
          className={cn(
            "flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            customOpen
              ? "bg-white/[0.08] text-white"
              : "text-white/85 hover:bg-white/[0.08]"
          )}
        >
          <span>自定义</span>
          <ChevronRight className="size-4 shrink-0 text-white/45" />
        </button>
        {busy && progressText ? (
          <div className="flex items-center gap-1.5 border-t border-white/10 px-3.5 py-2 text-[11px] text-purple-200/90">
            <Loader2 className="h-3 w-3 animate-spin" />
            {progressText}
            {creditLabel ? ` · ${creditLabel}` : ""}
          </div>
        ) : null}
      </div>

      {customOpen ? (
        <div
          className="w-[188px] rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] p-3 shadow-2xl backdrop-blur-xl"
          onMouseLeave={() => {
            if (!busy) setHoverRows(2);
            setHoverCols(2);
          }}
        >
          <div className="mb-2.5 text-[13px] font-medium text-white/90">自定义宫格</div>
          <div
            className="grid grid-cols-5 gap-1.5"
            onMouseLeave={() => {
              setHoverRows(2);
              setHoverCols(2);
            }}
          >
            {Array.from({ length: GRID_SPLIT_MAX * GRID_SPLIT_MAX }, (_, index) => {
              const row = Math.floor(index / GRID_SPLIT_MAX) + 1;
              const col = (index % GRID_SPLIT_MAX) + 1;
              const active = row <= hoverRows && col <= hoverCols;
              return (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  disabled={busy}
                  aria-label={`${row}×${col}`}
                  onMouseEnter={() => {
                    setHoverRows(row);
                    setHoverCols(col);
                  }}
                  onClick={() => pick(row, col)}
                  className={cn(
                    "aspect-square rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    active
                      ? "border-white/25 bg-white/25"
                      : "border-white/10 bg-white/[0.06] hover:bg-white/10"
                  )}
                />
              );
            })}
          </div>
          <p className="mt-2.5 text-center text-[12px] tabular-nums text-white/45">
            {hoverRows} × {hoverCols}
            {creditLabel ? ` · ${creditLabel}` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
