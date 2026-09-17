"use client";

import { Droplets } from "lucide-react";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import { cn } from "@/lib/utils";

interface GlobalWatermarkToggleProps {
  itemClass?: string;
  labelClass?: string;
}

/** 用户菜单内全局模型水印开关 */
export function GlobalWatermarkToggle({
  itemClass = "text-foreground/80 hover:bg-muted hover:text-foreground",
  labelClass = "text-muted-foreground",
}: GlobalWatermarkToggleProps) {
  const { enabled, setEnabled } = useGlobalWatermark();

  return (
    <div
      className="flex w-full items-center gap-2 px-3 py-2"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Droplets className={cn("h-4 w-4 shrink-0", labelClass)} />
      <span className="min-w-0 flex-1 text-left text-sm">模型水印</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "关闭模型水印" : "开启模型水印"}
        onClick={() => setEnabled(!enabled)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          enabled ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
    </div>
  );
}
