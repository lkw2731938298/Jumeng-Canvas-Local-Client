"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreativeToolsPopoverPanel } from "./CreativeToolsPopoverPanel";
import { VisualStylePickerDialog } from "./VisualStylePickerDialog";
import { usePromptSuffixTools } from "@/lib/canvas/usePromptSuffixTools";
import { useVisualStyles } from "@/lib/canvas/useVisualStyles";
import { DEFAULT_VISUAL_STYLE_ID, findVisualStyle } from "@/lib/canvas/renderToolPrompt";
import { CANVAS_OVERLAY_DROPDOWN_CLASS } from "@/lib/canvas/canvasOverlayTransform";
import { toast } from "sonner";

interface ImageCreativeToolsButtonProps {
  nodeId: string | null;
  hasImage: boolean;
  visualStyleId: string;
  onVisualStyleChange: (styleId: string) => void;
  /** Current model — Pro 官方稳定禁用部分工具 */
  modelName?: string;
  /** 摄像机开启时禁止打开创作工具 */
  disabled?: boolean;
  className?: string;
}

/**
 * Toolbar icon → screenshot-style two-column creative tools popover
 * (分镜叙事 / 质感 / 空间机位 / 设定图).
 */
export function ImageCreativeToolsButton({
  nodeId,
  hasImage,
  visualStyleId,
  onVisualStyleChange,
  modelName,
  disabled = false,
  className,
}: ImageCreativeToolsButtonProps) {
  const [open, setOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { items: suffixItems } = usePromptSuffixTools();
  const { styles, config } = useVisualStyles();
  const selectedStyle = findVisualStyle(config, visualStyleId || DEFAULT_VISUAL_STYLE_ID);
  const hasCustomStyle =
    Boolean(visualStyleId?.trim()) &&
    visualStyleId !== DEFAULT_VISUAL_STYLE_ID &&
    Boolean(selectedStyle);

  // 摄像机开启时强制关闭创作工具面板
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setStyleOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // 点到底栏其它菜单（参数 / 摄像机等）时不关：允许多面板同时打开
      if (
        t instanceof Element &&
        t.closest(".canvas-node-overlay") &&
        rootRef.current &&
        !rootRef.current.contains(t)
      ) {
        return;
      }
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const runSuffixToolHint = (tool: "panorama" | "grid_9", label: string) => {
    const item = suffixItems.find((x) => x.tool === tool);
    if (!item) {
      toast.message(`${label}即将上线`);
      return;
    }
    toast.message(`请使用节点顶部菜单「${item.label}」执行${label}`);
  };

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "relative flex size-8 items-center justify-center rounded-md text-white/70 transition-colors",
          disabled
            ? "cursor-not-allowed opacity-35"
            : "hover:bg-purple-500/15 hover:text-white",
          !disabled && open && "bg-purple-500/20 text-white"
        )}
        aria-label="创作工具"
        aria-expanded={open}
        aria-disabled={disabled}
        title={disabled ? "请先关闭摄像机后再使用创作工具" : "创作工具（右键选择视觉风格）"}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (disabled) return;
          setOpen(false);
          setStyleOpen(true);
        }}
      >
        <LayoutGrid className="size-[18px]" strokeWidth={1.75} />
        {hasCustomStyle ? (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-purple-400" aria-hidden />
        ) : null}
      </button>

      {open ? (
        <div className={`absolute bottom-full left-1/2 ${CANVAS_OVERLAY_DROPDOWN_CLASS} mb-2 w-[520px] -translate-x-1/2`}>
          <CreativeToolsPopoverPanel
            nodeId={nodeId}
            hasImage={hasImage}
            visualStyleId={visualStyleId}
            onVisualStyleChange={onVisualStyleChange}
            modelName={modelName}
            onPanorama={() => runSuffixToolHint("panorama", "720全景")}
            onGrid9={() => runSuffixToolHint("grid_9", "多机位九宫格")}
            onItemSelected={() => setOpen(false)}
            className="w-full"
          />
        </div>
      ) : null}

      <VisualStylePickerDialog
        open={styleOpen}
        onOpenChange={setStyleOpen}
        styles={styles}
        value={visualStyleId?.trim() || DEFAULT_VISUAL_STYLE_ID}
        onSelect={(id) => {
          onVisualStyleChange(id);
          setStyleOpen(false);
        }}
      />
    </div>
  );
}
