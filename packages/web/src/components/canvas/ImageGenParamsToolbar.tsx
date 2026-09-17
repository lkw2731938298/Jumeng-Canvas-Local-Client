"use client";

import { ArrowUp, Ratio, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  estimateOutpaintCreditCost,
  OUTPAINT_ASPECT_RATIOS,
  OUTPAINT_COUNTS,
  OUTPAINT_MODELS,
  OUTPAINT_RESOLUTIONS,
  type OutpaintAspectRatio,
  type OutpaintCount,
  type OutpaintModel,
  type OutpaintResolution,
} from "@/lib/canvas/imageOutpaint";
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

/** 截图同款生成参数（模型 / 比例 / 清晰度 / 张数） */
export interface ImageGenParamsValue {
  model: OutpaintModel;
  aspectRatio: OutpaintAspectRatio;
  resolution: OutpaintResolution;
  count: OutpaintCount;
}

export const DEFAULT_IMAGE_GEN_PARAMS: ImageGenParamsValue = {
  model: "pro",
  aspectRatio: "4:3",
  resolution: "2k",
  count: 1,
};

interface ImageGenParamsToolbarProps {
  value: ImageGenParamsValue;
  onChange: (patch: Partial<ImageGenParamsValue>) => void;
  onGenerate: () => void;
  generateTitle?: string;
  /** card=独立浮条；bare=嵌入其它工具条 */
  variant?: "card" | "bare";
  /** 权威算力展示（如画布工具固定价）；不传则用本地估算 */
  creditCostLabel?: string | number;
  generateDisabled?: boolean;
}

const COMPACT_TRIGGER =
  "nodrag nopan inline-flex h-8 w-auto min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent px-1.5 text-[13px] text-white/80 shadow-none hover:bg-white/[0.08] focus-visible:ring-0 data-[size=default]:h-8 [&_svg:last-child]:size-3.5 [&_svg:last-child]:text-white/45";

/** 图片节点生成参数条：PRO / 比例 / 2K / 张数 / 算力 / 提交 */
export function ImageGenParamsToolbar({
  value,
  onChange,
  onGenerate,
  generateTitle = "开始生成",
  variant = "card",
  creditCostLabel,
  generateDisabled = false,
}: ImageGenParamsToolbarProps) {
  const modelLabel = OUTPAINT_MODELS.find((o) => o.value === value.model)?.label ?? "PRO";
  const aspectLabel =
    OUTPAINT_ASPECT_RATIOS.find((o) => o.value === value.aspectRatio)?.label ?? "原图比例";
  const resLabel = OUTPAINT_RESOLUTIONS.find((o) => o.value === value.resolution)?.label ?? "2K";
  const creditCost =
    creditCostLabel ??
    estimateOutpaintCreditCost({
      ...value,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    });

  const body = (
    <>
      <Select
        value={value.model}
        onValueChange={(next) => {
          if (next) onChange({ model: next as OutpaintModel });
        }}
      >
        <SelectTrigger className={cn(COMPACT_TRIGGER, "font-medium tracking-wide")}>
          <SelectValue placeholder={modelLabel}>{modelLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
          {OUTPAINT_MODELS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} label={opt.label} className={CANVAS_SELECT_ITEM_CLASS}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.aspectRatio}
        onValueChange={(next) => {
          if (next) onChange({ aspectRatio: next as OutpaintAspectRatio });
        }}
      >
        <SelectTrigger className={COMPACT_TRIGGER}>
          <Ratio className="size-3.5 shrink-0 text-white/55" strokeWidth={1.75} />
          <SelectValue placeholder={aspectLabel}>{aspectLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
          {OUTPAINT_ASPECT_RATIOS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} label={opt.label} className={CANVAS_SELECT_ITEM_CLASS}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={value.resolution}
        onValueChange={(next) => {
          if (next) onChange({ resolution: next as OutpaintResolution });
        }}
      >
        <SelectTrigger className={cn(COMPACT_TRIGGER, "font-medium")}>
          <SelectValue placeholder={resLabel}>{resLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
          {OUTPAINT_RESOLUTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} label={opt.label} className={CANVAS_SELECT_ITEM_CLASS}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(value.count)}
        onValueChange={(next) => {
          if (!next) return;
          const n = Number(next) as OutpaintCount;
          if ((OUTPAINT_COUNTS as readonly number[]).includes(n)) {
            onChange({ count: n });
          }
        }}
      >
        <SelectTrigger className={COMPACT_TRIGGER}>
          <SelectValue placeholder={`${value.count}张`}>{`${value.count}张`}</SelectValue>
        </SelectTrigger>
        <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
          {OUTPAINT_COUNTS.map((n) => (
            <SelectItem key={n} value={String(n)} label={`${n}张`} className={CANVAS_SELECT_ITEM_CLASS}>
              {n}张
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div
        className="mx-0.5 inline-flex items-center gap-1 px-1.5 text-[13px] text-white/45"
        title="预计算力"
      >
        <Zap className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="tabular-nums">{creditCost}</span>
      </div>

      <button
        type="button"
        title={generateTitle}
        disabled={generateDisabled}
        onClick={onGenerate}
        className="ml-0.5 inline-flex size-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowUp className="size-4" strokeWidth={2.25} />
      </button>
    </>
  );

  if (variant === "bare") {
    return <div className="flex items-center gap-0.5">{body}</div>;
  }

  return (
    <div
      className="nodrag nopan nowheel pointer-events-auto flex items-center gap-0.5 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-1.5 py-1.5 shadow-2xl backdrop-blur-xl"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {body}
    </div>
  );
}
