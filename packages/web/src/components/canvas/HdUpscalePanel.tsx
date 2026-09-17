"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Box, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  HD_UPSCALE_CREDIT_COST,
  HD_UPSCALE_MODELS,
  HD_UPSCALE_SCALES,
  type HdUpscaleMediaKind,
  type HdUpscaleScale,
} from "@/lib/canvas/createHdUpscaleNode";
import {
  hdUpscaleCanvasTool,
  runHdUpscaleGenerate,
} from "@/lib/canvas/runHdUpscaleGenerate";
import { canvasVideoToolBillingOptions } from "@/lib/canvas/canvasVideoToolBilling";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import { useNodeVideoDurationSec } from "@/lib/canvas/useNodeVideoDurationSec";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
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
  CANVAS_SELECT_TRIGGER_CLASS,
} from "@/lib/canvas/canvasSelectStyles";

export interface HdUpscalePanelValues {
  hdProvider: string;
  hdModel: string;
  hdScale: number;
}

interface HdUpscalePanelProps {
  values: HdUpscalePanelValues;
  onChange: (patch: Partial<HdUpscalePanelValues>) => void;
  /** 高清节点 id；用于提交生成 */
  nodeId: string | null;
  hasSourceImage?: boolean;
  /** 图片 / 视频高清（决定 canvasTool 与模型目录） */
  mediaKind?: HdUpscaleMediaKind;
}

/**
 * 高清放大参数面板（对齐方案 A）：
 * - 模型选择：后台「模型开关」主模型（只读展示）
 * - 预设：风格预设 hdModel
 * - 放大倍数：2 / 4 / 6
 * - 算力：Zap + 数字（与普通生成条一致）
 */
export function HdUpscalePanel({
  values,
  onChange,
  nodeId,
  hasSourceImage = false,
  mediaKind = "image",
}: HdUpscalePanelProps) {
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const hdNode = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  const hdVideoUrl = String(
    ((hdNode?.data as WorkflowNodeData | undefined)?.params as Record<string, unknown> | undefined)
      ?.videoUrl ?? ""
  );
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const canvasTool = hdUpscaleCanvasTool(mediaKind);
  const isVideoHd = mediaKind === "video";
  const { durationSec: videoBillSec } = useNodeVideoDurationSec(
    isVideoHd ? nodeId : null,
    hdVideoUrl,
    isVideoHd && Boolean(nodeId)
  );
  const extraGenerationOptions = useMemo(
    () => (isVideoHd && videoBillSec != null ? canvasVideoToolBillingOptions(videoBillSec) : undefined),
    [isVideoHd, videoBillSec]
  );

  const {
    modelName,
    displayName,
    hasModel,
    defaultGenerationOptions,
    total: creditTotal,
    creditsEnabled,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useCanvasToolConfiguredModel(
    canvasTool,
    Boolean(nodeId) && (!isVideoHd || videoBillSec != null),
    mediaKind,
    extraGenerationOptions
  );

  const scale = (HD_UPSCALE_SCALES as readonly number[]).includes(values.hdScale)
    ? (values.hdScale as HdUpscaleScale)
    : 2;
  const presetLabel =
    HD_UPSCALE_MODELS.find((o) => o.value === (values.hdModel || "general"))?.label ?? "通用";

  // 与 NodeEditorOverlay 一致：图标旁只显示数字，完整文案放 title
  const creditNumber = quoteLoading
    ? "…"
    : creditTotal > 0
      ? String(creditTotal)
      : String(HD_UPSCALE_CREDIT_COST);
  const creditTitle =
    creditTotal > 0
      ? `本次消耗 ${creditTotal} 算力`
      : `本次消耗 ${HD_UPSCALE_CREDIT_COST} 算力（默认）`;

  const handleGenerate = async () => {
    if (!projectId || !nodeId) {
      toast.error("项目或节点未就绪");
      return;
    }
    if (!hasSourceImage) {
      toast.error(mediaKind === "video" ? "请先连接参考视频" : "请先连接参考图片");
      return;
    }
    if (!hasModel || !modelName) {
      toast.error(
        mediaKind === "video"
          ? "视频高清模型未配置或不可用（请在后台「模型开关 → 视频高清」配置）"
          : "高清模型未配置或不可用（请在后台「模型开关」配置）"
      );
      return;
    }
    if (generating) return;

    setGenerating(true);
    try {
      await runHdUpscaleGenerate({
        projectId,
        nodeId,
        hdModel: values.hdModel || "general",
        hdScale: scale,
        hdProvider: values.hdProvider || "topazlabs",
        modelName,
        generationOptions: defaultGenerationOptions,
        workflowId,
        creditsEnabled,
        queryClient,
        onRefetchPricing: () => void refetchQuote(),
        mediaKind,
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="px-3 pb-2.5 pt-2"
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <h3 className="mb-3 text-[14px] font-medium text-white/90">
        {mediaKind === "video" ? "视频高清放大" : "高清放大"}
      </h3>

      <div className="space-y-3">
        {/* 主模型：后台配置，画布侧只读展示 */}
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">模型选择</span>
          <div
            className="pointer-events-none flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/10 bg-[#1a1a28] px-2 text-[13px] text-white/75"
            title={
              mediaKind === "video"
                ? "在管理后台「模型开关 → 视频高清」配置实际调用模型"
                : "在管理后台「模型开关 → 高清」配置实际调用模型"
            }
          >
            <Box className="size-4 shrink-0 text-white/70" strokeWidth={1.75} />
            <span className="truncate text-left text-white/85">{displayName}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">预设</span>
          <Select
            value={values.hdModel || "general"}
            onValueChange={(value) => value && onChange({ hdModel: value })}
          >
            <SelectTrigger className={cn(CANVAS_SELECT_TRIGGER_CLASS, "min-w-0 flex-1")}>
              <SelectValue placeholder={presetLabel}>{presetLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
              {HD_UPSCALE_MODELS.map((opt) => (
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
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">放大倍数</span>
          <div className="inline-flex rounded-lg border border-white/10 bg-[#1a1a28] p-0.5">
            {HD_UPSCALE_SCALES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ hdScale: n })}
                className={cn(
                  "min-w-[40px] rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  scale === n
                    ? "bg-white/15 font-medium text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white/80"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2.5">
        <span
          className="flex items-center gap-0.5 text-[13px] tabular-nums text-white/45"
          title={creditTitle}
        >
          <Zap className="size-3.5 fill-current" aria-hidden />
          <span>{creditNumber}</span>
        </span>
        <button
          type="button"
          disabled={generating || !hasSourceImage}
          onClick={() => void handleGenerate()}
          title={generating ? "生成中…" : `生成 · ${creditTitle}`}
          aria-label="生成"
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#c9c9c9] text-black transition-colors hover:bg-[#d6d6d6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {generating ? (
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          ) : (
            <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}
