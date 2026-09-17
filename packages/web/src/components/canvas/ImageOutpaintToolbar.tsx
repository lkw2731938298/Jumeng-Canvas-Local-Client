"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { ImageGenParamsToolbar } from "@/components/canvas/ImageGenParamsToolbar";
import { useToolImageCreditQuote } from "@/lib/canvas/canvasToolImageModel";
import {
  OUTPAINT_CANVAS_TOOL,
  runOutpaintGenerate,
} from "@/lib/canvas/runOutpaintGenerate";
import { formatCreditLabel } from "@/lib/api/credits";

interface ImageOutpaintToolbarProps {
  onClose: () => void;
}

/** 扩图浮条：关闭 + 生成参数（算力走画布工具固定价） */
export function ImageOutpaintToolbar({ onClose }: ImageOutpaintToolbarProps) {
  const outpaint = useCanvasStore((s) => s.inlineImageOutpaint);
  const patchOutpaint = useCanvasStore((s) => s.patchInlineImageOutpaint);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const closeOutpaint = useCanvasStore((s) => s.closeInlineImageOutpaint);
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const {
    modelName,
    hasModel,
    defaultGenerationOptions,
    total: creditTotal,
    creditsEnabled,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useToolImageCreditQuote(Boolean(outpaint && selectedNodeId), OUTPAINT_CANVAS_TOOL);

  if (!outpaint) return null;

  const creditLabel = quoteLoading
    ? "…"
    : formatCreditLabel(creditTotal, creditsEnabled);

  const handleGenerate = async () => {
    if (!projectId || !selectedNodeId) {
      toast.error("项目或节点未就绪");
      return;
    }
    if (!hasModel || !modelName) {
      toast.error("全能图片 Pro 图生图未配置或不可用");
      return;
    }
    if (generating) return;

    setGenerating(true);
    try {
      const ok = await runOutpaintGenerate({
        projectId,
        sourceNodeId: selectedNodeId,
        outpaint,
        modelName,
        generationOptions: defaultGenerationOptions,
        workflowId,
        creditsEnabled,
        queryClient,
        onRefetchPricing: () => void refetchQuote(),
      });
      if (ok) closeOutpaint();
    } finally {
      setGenerating(false);
    }
  };

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
      <button
        type="button"
        title="关闭"
        disabled={generating}
        onClick={onClose}
        className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <X className="size-[16px]" strokeWidth={1.75} />
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <ImageGenParamsToolbar
        variant="bare"
        value={outpaint}
        onChange={(patch) => patchOutpaint(patch)}
        onGenerate={() => void handleGenerate()}
        generateTitle={generating ? "扩图生成中…" : "开始扩图"}
        creditCostLabel={creditLabel}
        generateDisabled={generating}
      />
    </div>
  );
}
