import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { fetchAssetById, notifyAssetsUpdated } from "@/lib/api/assets";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import {
  HD_UPSCALE_MODELS,
  hdModelPromptHint,
  type HdUpscaleMediaKind,
} from "@/lib/canvas/createHdUpscaleNode";
import { resolveMediaGenerationAssetId } from "@/lib/canvas/canvasToolGeneratedImage";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import {
  canvasVideoToolBillingOptions,
  mediaDurationToBillSeconds,
  resolveCanvasVideoBillSeconds,
} from "@/lib/canvas/canvasVideoToolBilling";
import { getVideoNodeRef } from "@/lib/canvas/videoNodeRegistry";
import { probeVideoDurationSec } from "@/lib/canvas/videoFrameEdit";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

/** 图片高清固定算力工具 */
export const HD_UPSCALE_CANVAS_TOOL = "hd_upscale";
/** 视频高清：按时长 (输入秒+输出秒)×每秒算力 */
export const HD_UPSCALE_VIDEO_CANVAS_TOOL = "hd_upscale_video";

export function hdUpscaleCanvasTool(mediaKind: HdUpscaleMediaKind): string {
  return mediaKind === "video" ? HD_UPSCALE_VIDEO_CANVAS_TOOL : HD_UPSCALE_CANVAS_TOOL;
}

/** 读取后台「高清 / 视频高清」追加提示词 */
export async function loadHdUpscaleAdminPrompt(
  mediaKind: HdUpscaleMediaKind = "image"
): Promise<string> {
  const toolId = hdUpscaleCanvasTool(mediaKind);
  const fallback =
    mediaKind === "video"
      ? PROMPT_SUFFIX_FALLBACKS.hd_upscale_video?.content ??
        PROMPT_SUFFIX_FALLBACKS.hd_upscale.content
      : PROMPT_SUFFIX_FALLBACKS.hd_upscale.content;
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.[toolId] as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append" && tool.appendText?.trim()) {
      return tool.appendText.trim();
    }
    // 视频未单独配置时回退图片高清文案
    if (mediaKind === "video") {
      const imageTool = cfg.tools?.hd_upscale as AppendPromptToolConfig | undefined;
      if (imageTool?.kind === "append" && imageTool.appendText?.trim()) {
        return imageTool.appendText.trim();
      }
    }
  } catch {
    /* 回退默认 */
  }
  return fallback;
}

function buildHdPrompt(adminPrompt: string, hdModel: string, hdScale: number): string {
  const modelLabel =
    HD_UPSCALE_MODELS.find((m) => m.value === hdModel)?.label || "通用";
  const hint = hdModelPromptHint(hdModel);
  return [adminPrompt, hint, `放大约${hdScale}倍`, `预设「${modelLabel}」`]
    .filter(Boolean)
    .join("，");
}

/**
 * 高清超分：图片固定算力 / 视频按时长算力 + 后台提示词 → 图生图 / 视频参考生成，结果写回当前高清节点。
 */
export async function runHdUpscaleGenerate(opts: {
  projectId: string;
  nodeId: string;
  hdModel: string;
  hdScale: number;
  hdProvider?: string;
  modelName: string;
  generationOptions: GenerationOptions;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  onRefetchPricing?: () => void;
  mediaKind?: HdUpscaleMediaKind;
}): Promise<boolean> {
  const mediaKind: HdUpscaleMediaKind = opts.mediaKind ?? "image";
  const canvasTool = hdUpscaleCanvasTool(mediaKind);
  const urlParamKey = mediaKind === "video" ? "videoUrl" : "imageUrl";
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.nodeId);
  if (!node) {
    toast.error("高清节点不存在");
    return false;
  }

  const params = (node.data?.params ?? {}) as Record<string, unknown>;
  const adminPrompt = await loadHdUpscaleAdminPrompt(mediaKind);
  const prompt = buildHdPrompt(adminPrompt, opts.hdModel, opts.hdScale);
  if (!prompt.trim()) {
    toast.error(
      mediaKind === "video"
        ? "请在后台「Prompt 模板 → 视频高清」配置提示词"
        : "请在后台「Prompt 模板 → 高清」配置提示词"
    );
    return false;
  }

  const generationOptions: GenerationOptions = {
    ...opts.generationOptions,
    hdProvider: String(opts.hdProvider || "topazlabs"),
    hdModel: String(opts.hdModel || "general"),
    hdScale: String(opts.hdScale || 2),
  };

  store.setNodeStatus(opts.nodeId, "running");

  try {
    // 优先用本节点已复制的源素材；无则失败（创建时应已复制）
    const sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, urlParamKey);
    if (!sourceUrl) {
      store.setNodeStatus(opts.nodeId, "idle");
      toast.error(mediaKind === "video" ? "请先连接参考视频" : "请先连接参考图片");
      return false;
    }

    if (mediaKind === "video") {
      const mounted = mediaDurationToBillSeconds(getVideoNodeRef(opts.nodeId)?.duration);
      const probed = mounted ?? mediaDurationToBillSeconds(await probeVideoDurationSec(sourceUrl));
      const billSec = probed ?? resolveCanvasVideoBillSeconds(node, mounted);
      Object.assign(generationOptions, canvasVideoToolBillingOptions(billSec));
    }

    const quote = await getCreditQuote({
      model: opts.modelName,
      category: mediaKind,
      generationOptions,
      canvasTool,
    });

    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: opts.nodeId,
        workflowId: opts.workflowId ?? undefined,
        category: mediaKind,
        prompt,
        model: opts.modelName,
        sourceUrl,
        // 视频模型多从 references 取参考视频 URL
        references:
          mediaKind === "video"
            ? [
                {
                  nodeId: opts.nodeId,
                  type: "video",
                  url: sourceUrl,
                  label: "高清",
                },
              ]
            : undefined,
        generationOptions,
        canvasTool,
      },
      {
        idempotencyKey: newIdempotencyKey(`${opts.nodeId}-${canvasTool}`),
        quoteToken: quote.quoteToken,
      }
    );

    maybeToastCreditCharged(result, opts.creditsEnabled);

    const resolved = await resolveMediaGenerationAssetId(result);
    if (!resolved.assetId) {
      store.setNodeStatus(opts.nodeId, "error");
      toast.error(resolved.errorMessage || "高清生成失败");
      return false;
    }

    const asset = await fetchAssetById(opts.projectId, resolved.assetId);
    if (!asset?.fileUrl) {
      store.setNodeStatus(opts.nodeId, "error");
      toast.error("生成结果无法加载");
      return false;
    }

    // 写回当前高清节点，保留 toolMode / hd 参数
    store.updateNodeParam(opts.nodeId, "assetId", asset.id);
    store.updateNodeParam(opts.nodeId, urlParamKey, asset.fileUrl);
    store.updateNodeParam(opts.nodeId, "prompt", prompt);
    store.updateNodeParam(opts.nodeId, "model", opts.modelName);
    store.updateNodeParam(opts.nodeId, "generationOptions", generationOptions);
    store.updateNodeData(opts.nodeId, { label: asset.title?.trim() || "高清" });
    store.setNodeStatus(opts.nodeId, "success");
    notifyAssetsUpdated();
    toast.success(mediaKind === "video" ? "高清视频已生成" : "高清图片已生成");
    return true;
  } catch (err) {
    store.setNodeStatus(opts.nodeId, "error");
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.onRefetchPricing);
      return false;
    }
    if (handleCollaboratorSpendCapError(err)) return false;
    const detail = err instanceof ApiError ? err.message : undefined;
    toast.error(detail || "高清生成失败");
    return false;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
