/**
 * 视频顶栏「人声分离 / 消除人声」：RunningHub 分离音频 Vocals / Other。
 * 按时长算力（canvasTool）+ 后台可切换音频模型；结果落为右侧音频节点。
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

export type VocalSeparateMode = "vocals" | "other";

export const VOCAL_SEPARATE_TOOLS: Record<
  VocalSeparateMode,
  { canvasTool: string; label: string; defaultModel: string; prompt: string }
> = {
  vocals: {
    canvasTool: "vocal_separate",
    label: "人声分离",
    defaultModel: "rh_audio_extract_vocals",
    prompt: "从参考视频提取纯人声（Vocals）",
  },
  other: {
    canvasTool: "vocal_remove",
    label: "消除人声",
    defaultModel: "rh_audio_extract_other",
    prompt: "从参考视频提取伴奏与环境音（消除人声）",
  },
};

async function resolveToolModel(canvasTool: string, fallback: string): Promise<string> {
  return resolveCanvasToolPrimaryModel(canvasTool, fallback);
}

/** 人声分离 / 消除人声：提交音频任务，右侧新建音频节点 */
export async function runVideoVocalSeparate(opts: {
  projectId: string;
  sourceNodeId: string;
  videoAssetId: string;
  videoUrl: string;
  mode: VocalSeparateMode;
  generationOptions?: GenerationOptions;
  queryClient: QueryClient;
}): Promise<boolean> {
  const meta = VOCAL_SEPARATE_TOOLS[opts.mode];
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

  const modelName = await resolveToolModel(meta.canvasTool, meta.defaultModel);
  const generationOptions: GenerationOptions = {
    ...(opts.generationOptions ?? {}),
    ...canvasVideoToolBillingOptions(resolveCanvasVideoBillSeconds(node)),
  };
  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: modelName,
      category: "audio",
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

  // addNode 后必须重新 getState()：先前 snapshot 的 nodes 不会随 set 更新
  const before = new Set(store.nodes.map((n) => n.id));
  store.addNode("audio_input", {
    x: worldPos.x + width + 48,
    y: worldPos.y + siblingOffset,
  });
  const after = useCanvasStore.getState();
  const newId =
    after.nodes.find((n) => n.type === "audio_input" && !before.has(n.id))?.id ?? null;
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
  after.updateNodeParam(newId, "vocalSeparateMeta", {
    mode: opts.mode,
    sourceAssetId: opts.videoAssetId,
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
        category: "audio",
        prompt: meta.prompt,
        generationOptions,
        canvasTool: meta.canvasTool,
        sourceUrl: videoUrl,
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
    done.updateNodeParam(newId, "assetId", asset.id);
    done.updateNodeParam(newId, "audioUrl", ensureHttpsOssUrl(asset.fileUrl));
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
