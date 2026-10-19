"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, X } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useToolImageCreditQuote } from "@/lib/canvas/canvasToolImageModel";
import {
  OUTPAINT_CANVAS_TOOL,
  runOutpaintGenerate,
} from "@/lib/canvas/runOutpaintGenerate";

interface ImageOutpaintToolbarProps {
  onClose: () => void;
}

/**
 * 扩图浮条：仅关闭 + 提交。
 * PRO / 比例 / 2K / 张数已无效（模型固定 nano-banana-2.1，尺寸跟外扩框 WxH）。
 */
export function ImageOutpaintToolbar({ onClose }: ImageOutpaintToolbarProps) {
  const outpaint = useCanvasStore((s) => s.inlineImageOutpaint);
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
    creditsEnabled,
    refetch: refetchQuote,
  } = useToolImageCreditQuote(Boolean(outpaint && selectedNodeId), OUTPAINT_CANVAS_TOOL);

  if (!outpaint) return null;

  const handleGenerate = async () => {
    if (!projectId || !selectedNodeId) {
      toast.error("项目或节点未就绪");
      return;
    }
    if (!hasModel || !modelName) {
      toast.error("请先确保目录含「gemini-nano-banana-2.1」");
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

      <button
        type="button"
        title={generating ? "扩图生成中…" : "开始扩图"}
        disabled={generating}
        onClick={() => void handleGenerate()}
        className="inline-flex size-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowUp className="size-4" strokeWidth={2.25} />
      </button>
    </div>
  );
}
