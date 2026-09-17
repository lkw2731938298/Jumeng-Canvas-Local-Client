"use client";

import { Crop, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  CROP_ASPECT_RATIOS,
  enforceCropAspect,
  fitCenteredRect,
  resolveCropAspect,
  type CropAspectRatio,
} from "@/lib/canvas/imageCrop";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANVAS_SELECT_CONTENT_CLASS,
  CANVAS_SELECT_ITEM_CLASS,
} from "@/lib/canvas/canvasSelectStyles";

interface ImageCropToolbarProps {
  /** 节点图片显示宽高比（用于「原图比例」） */
  imageAspect: number;
  saving?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** 确认按钮文案（框选去字幕等场景可覆盖） */
  confirmLabel?: string;
  confirmTitle?: string;
  /** 受控：视频裁剪复用同一浮条 */
  controlled?: {
    aspectRatio: CropAspectRatio;
    onPatch: (patch: {
      aspectRatio?: CropAspectRatio;
      rect?: ReturnType<typeof fitCenteredRect>;
    }) => void;
  };
}

const COMPACT_TRIGGER =
  "nodrag nopan inline-flex h-8 w-auto min-w-0 items-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 text-[13px] text-white/85 shadow-none hover:bg-white/10 focus-visible:ring-0 data-[size=default]:h-8 [&_svg:last-child]:size-3.5 [&_svg:last-child]:text-white/45";

/** 裁剪浮条：关闭 / 比例 / 确认 */
export function ImageCropToolbar({
  imageAspect,
  saving = false,
  onConfirm,
  onClose,
  confirmLabel = "确认",
  confirmTitle = "确认裁剪",
  controlled,
}: ImageCropToolbarProps) {
  const storeCrop = useCanvasStore((s) => s.inlineImageCrop);
  const storePatch = useCanvasStore((s) => s.patchInlineImageCrop);
  const aspectRatio = controlled?.aspectRatio ?? storeCrop?.aspectRatio;
  const patchCrop = controlled?.onPatch ?? storePatch;

  if (!aspectRatio) return null;

  const aspectLabel =
    CROP_ASPECT_RATIOS.find((o) => o.value === aspectRatio)?.label ?? "自由";

  return (
    <div
      className="nodrag nopan nowheel pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-2 py-1.5 shadow-2xl backdrop-blur-xl"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <button
        type="button"
        title="关闭"
        onClick={onClose}
        className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="size-[16px]" strokeWidth={1.75} />
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <Select
        value={aspectRatio}
        onValueChange={(next) => {
          if (!next) return;
          const nextAspect = next as CropAspectRatio;
          const aspect = resolveCropAspect(nextAspect, imageAspect);
          // 自由：只改模式，保留当前框；其它比例：重设居中锁定框
          if (aspect == null) {
            patchCrop({ aspectRatio: nextAspect });
            return;
          }
          patchCrop({
            aspectRatio: nextAspect,
            rect: enforceCropAspect(fitCenteredRect(aspect), aspect),
          });
        }}
      >
        <SelectTrigger className={cn(COMPACT_TRIGGER, "min-w-[108px]")}>
          <Crop className="size-3.5 shrink-0 text-white/70" strokeWidth={1.75} />
          <SelectValue placeholder={aspectLabel}>{aspectLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="bottom" sideOffset={6}>
          {CROP_ASPECT_RATIOS.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              label={opt.label}
              className={CANVAS_SELECT_ITEM_CLASS}
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        title={confirmTitle}
        disabled={saving}
        onClick={onConfirm}
        className="ml-1 inline-flex h-8 items-center justify-center rounded-lg bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-50"
      >
        {saving ? "处理中…" : confirmLabel}
      </button>
    </div>
  );
}
