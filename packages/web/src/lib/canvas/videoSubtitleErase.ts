/**
 * 视频顶栏「智能擦除 / 框选擦除」：聚梦网关火山字幕擦除（精准版）。
 * 按时长算力（canvasTool）+ 后台可切换视频模型；结果落为右侧视频节点。
 */

import type { Edge } from "@xyflow/react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAssetById, notifyAssetsUpdated } from "@/lib/api/assets";
import { getCreditQuote } from "@/lib/api/credits";
import { resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import { getNodeWorldPosition } from "@/lib/canvas/canvasOverlayTransform";
import type { CropRect } from "@/lib/canvas/imageCrop";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { resolveMediaGenerationAssetId } from "@/lib/canvas/canvasToolGeneratedImage";
import {
  canvasVideoToolBillingOptions,
  resolveCanvasVideoBillSeconds,
} from "@/lib/canvas/canvasVideoToolBilling";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { AppNode } from "@/lib/canvas/nodeGroup";
import type { GenerationOptions } from "@/types/generationPresets";

export type SubtitleEraseMode = "smart" | "box";

export const SUBTITLE_ERASE_TOOLS: Record<
  SubtitleEraseMode,
  { canvasTool: string; label: string; defaultModel: string; prompt: string }
> = {
  smart: {
    canvasTool: "video_subtitle_smart_erase",
    label: "智能擦除",
    defaultModel: "jumengai_volc_subtitle_erase",
    prompt: "智能擦除视频字幕（精准版）",
  },
  box: {
    canvasTool: "video_subtitle_box_erase",
    label: "框选擦除",
    defaultModel: "jumengai_volc_subtitle_erase",
    prompt: "框选区域内擦除视频字幕（精准版）",
  },
};

/** 画布 CropRect → RunningHub eraseRatioLocation（相对坐标 0–1） */
export function cropRectToEraseRatioLocation(rect: CropRect): Array<{
  topLeftX: number;
  topLeftY: number;
  bottomRightX: number;
  bottomRightY: number;
}> {
  const x = Math.max(0, Math.min(1, Number(rect.x) || 0));
  const y = Math.max(0, Math.min(1, Number(rect.y) || 0));
  const w = Math.max(0, Math.min(1 - x, Number(rect.w) || 0));
  const h = Math.max(0, Math.min(1 - y, Number(rect.h) || 0));
  if (!(w > 0.02 && h > 0.02)) {
    throw new Error("擦除区域过小，请放大框选范围");
  }
  return [
    {
      topLeftX: Number(x.toFixed(6)),
      topLeftY: Number(y.toFixed(6)),
      bottomRightX: Number((x + w).toFixed(6)),
      bottomRightY: Number((y + h).toFixed(6)),
    },
  ];
}

async function resolveToolModel(canvasTool: string, fallback: string): Promise<string> {
  return resolveCanvasToolPrimaryModel(canvasTool, fallback);
}

/** 智能擦除 / 框选擦除：提交视频任务，右侧新建视频节点 */
export async function runVideoSubtitleErase(opts: {
  projectId: string;
  sourceNodeId: string;
  videoAssetId: string;
  videoUrl: string;
  mode: SubtitleEraseMode;
  /** 框选擦除必填：归一化选区 */
  eraseRect?: CropRect;
  generationOptions?: GenerationOptions;
  queryClient: QueryClient;
}): Promise<boolean> {
  const meta = SUBTITLE_ERASE_TOOLS[opts.mode];
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.sourceNodeId) as AppNode | undefined;
  if (!node) {
    toast.error("视频节点不存在");
    return false;
  }
  const videoUrl = ensureHttpsOssUrl(opts.videoUrl);
  if (!videoUrl) {
    toast.error("请先上传视频");
    return false;
  }

  const generationOptions: GenerationOptions = {
    ...(opts.generationOptions ?? {}),
    ...canvasVideoToolBillingOptions(resolveCanvasVideoBillSeconds(node)),
    eraseType: "subtitle",
    encodeMode: "size",
  };
  if (opts.mode === "box") {
    if (!opts.eraseRect) {
      toast.error("请先框选擦除区域");
      return false;
    }
    try {
      const boxes = cropRectToEraseRatioLocation(opts.eraseRect);
      generationOptions.eraseRatioLocation = JSON.stringify(boxes);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "擦除区域无效");
      return false;
    }
  }

  const modelName = await resolveToolModel(meta.canvasTool, meta.defaultModel);
  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: modelName,
      category: "video",
      canvasTool: meta.canvasTool,
      generationOptions,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* 仍尝试提交 */
  }

  const { width } = resolveNodeSize(node.width, node.height);
  const worldPos = getNodeWorldPosition(node, store.nodes);
  const edges = store.edges as Edge[];
  const siblingOffset =
    edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === "video").length * 32;

  const before = new Set(store.nodes.map((n) => n.id));
  store.addNode("video_input", {
    x: worldPos.x + width + 48,
    y: worldPos.y + siblingOffset,
  });
  const after = useCanvasStore.getState();
  const newId =
    after.nodes.find((n) => n.type === "video_input" && !before.has(n.id))?.id ?? null;
  if (!newId) {
    toast.error("创建结果节点失败");
    return false;
  }
  after.connectNodes({
    source: opts.sourceNodeId,
    target: newId,
    sourceHandle: "video",
    targetHandle: REFERENCE_INPUT_ID,
  });
  after.updateNodeData(newId, { label: meta.label });
  after.updateNodeParam(newId, "toolMode", meta.canvasTool);
  after.updateNodeParam(newId, "subtitleEraseMeta", {
    mode: opts.mode,
    sourceAssetId: opts.videoAssetId,
    ...(opts.eraseRect ? { eraseRect: opts.eraseRect } : {}),
  });
  after.setNodeStatus(newId, "running");

  try {
    const live = useCanvasStore.getState();
    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: newId,
        workflowId: live.workflowId ?? undefined,
        model: modelName,
        category: "video",
        prompt: meta.prompt,
        generationOptions,
        canvasTool: meta.canvasTool,
        sourceUrl: videoUrl,
        sourceAssetId: opts.videoAssetId,
        references: [
          {
            nodeId: opts.sourceNodeId,
            type: "video",
            label: "源视频",
            url: videoUrl,
          },
        ],
        submitSource: "manual",
        assetTitle: meta.label,
      },
      {
        quoteToken,
        idempotencyKey: newIdempotencyKey(`${newId}-${opts.mode}`),
      }
    );

    const resolved = await resolveMediaGenerationAssetId(result);
    if (resolved.errorMessage) throw new Error(resolved.errorMessage);
    const assetId = resolved.assetId?.trim();
    if (!assetId) throw new Error("生成未返回素材");

    const asset = await fetchAssetById(opts.projectId, assetId);
    if (!asset?.fileUrl) throw new Error("结果素材无效");

    const done = useCanvasStore.getState();
    const fileUrl = ensureHttpsOssUrl(asset.fileUrl);
    done.updateNodeParam(newId, "assetId", asset.id);
    done.updateNodeParam(newId, "videoUrl", fileUrl);
    done.updateNodeData(newId, { label: meta.label });
    done.setNodeStatus(newId, "success");
    maybeToastCreditCharged(result, true);
    notifyAssetsUpdated();
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
    toast.success(`${meta.label}完成`);
    return true;
  } catch (err) {
    useCanvasStore.getState().setNodeStatus(newId, "error");
    if (handleCollaboratorSpendCapError(err)) return false;
    if (isPricingChangedError(err)) {
      toastPricingChanged();
      return false;
    }
    toast.error(err instanceof Error ? err.message : `${meta.label}失败`);
    return false;
  }
}
