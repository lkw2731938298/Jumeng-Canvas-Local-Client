import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { fetchAssetById, notifyAssetsUpdated } from "@/lib/api/assets";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { type HdUpscaleMediaKind } from "@/lib/canvas/createHdUpscaleNode";
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
import { VOLC_ENHANCE_STANDARD_PRO_MODEL } from "@/lib/local/volcVideoEnhance";
import { listModels, type CanvasModel } from "@/lib/api/models";
import {
  DEFAULT_HD_ASPECT_RATIO,
  DEFAULT_HD_CLARITY_TIER,
  HD_NANO_BANANA_I2I_CATALOG,
  HD_NANO_BANANA_I2I_DISPLAY,
  HD_NANO_BANANA_I2I_UPSTREAM,
  buildHdImageGenerationOptions,
  computeHdOutputSizePx,
  hdAspectRatioById,
  hdClarityTierById,
  isHdClarityTierId,
  pickHdNanoBananaCatalogModel,
  probeImageNaturalSize,
  resolveHdUpstreamModelId,
} from "@/lib/local/topazHdUpscale";

/** 图片高清固定算力工具 */
export const HD_UPSCALE_CANVAS_TOOL = "hd_upscale";
/** 视频画质增强：按时长计费，固定火山标准专业版模型 */
export const HD_UPSCALE_VIDEO_CANVAS_TOOL = "hd_upscale_video";

/** 本地目录中解析「火山画质增强-标准专业版」的内部 name */
async function resolveVolcEnhanceStandardProModelName(
  fallback?: string
): Promise<string> {
  try {
    const list = await listModels({ category: "video" });
    const hit = list.find((m) => {
      const upstream = String(
        (m.parameters as { upstreamModel?: string } | undefined)?.upstreamModel || ""
      );
      const blob = `${upstream} ${m.displayName || ""} ${m.name || ""}`;
      return (
        blob.includes(VOLC_ENHANCE_STANDARD_PRO_MODEL) ||
        /火山画质增强[-_]?标准专业/.test(blob)
      );
    });
    if (hit?.name) return hit.name;
  } catch {
    /* ignore */
  }
  return fallback || "";
}

/** 解析固定高清模型 gemini-nano-banana-2.1（优先本地已启用模型的 name，便于官方文件上传凭据） */
async function resolveHdNanoBananaI2iModel(
  fallback?: string
): Promise<{ name: string; model: CanvasModel | null; upstreamModel: string }> {
  try {
    const list = await listModels({ category: "image" });
    const hit = pickHdNanoBananaCatalogModel(list);
    if (hit?.name) {
      return {
        name: hit.name,
        model: hit,
        upstreamModel: resolveHdUpstreamModelId({
          name: hit.name,
          displayName: hit.displayName,
          upstreamModel: String(
            (hit.parameters as { upstreamModel?: string } | undefined)?.upstreamModel || ""
          ),
        }),
      };
    }
  } catch {
    /* ignore */
  }
  return {
    name: fallback || HD_NANO_BANANA_I2I_CATALOG,
    model: null,
    upstreamModel: HD_NANO_BANANA_I2I_UPSTREAM,
  };
}

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

function buildHdPrompt(adminPrompt: string, clarityLabel: string, size: string): string {
  return [adminPrompt, HD_NANO_BANANA_I2I_UPSTREAM, `清晰度${clarityLabel}`, `size ${size}`]
    .filter(Boolean)
    .join("，");
}

/**
 * 图片高清 / 视频画质增强：结果写回当前工具节点。
 * 图片固定 gemini-nano-banana-2.1 + 1K/2K/4K；视频固定火山标准专业版。
 */
export async function runHdUpscaleGenerate(opts: {
  projectId: string;
  nodeId: string;
  hdModel: string;
  hdScale: number;
  hdProvider?: string;
  /** 图片高清：1k / 2k / 4k */
  hdClarityTier?: string;
  /** 图片比例：original | 16:9 | … */
  hdAspectRatio?: string;
  /** @deprecated 旧 MP 档字段，等同 hdClarityTier */
  hdMpTier?: string;
  hdMpPlusSteps?: number;
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
    toast.error(mediaKind === "video" ? "画质增强节点不存在" : "高清节点不存在");
    return false;
  }

  const params = (node.data?.params ?? {}) as Record<string, unknown>;
  const adminPrompt = await loadHdUpscaleAdminPrompt(mediaKind);

  let modelName = opts.modelName;
  let hdCatalogModel: CanvasModel | null = null;
  if (mediaKind === "video") {
    modelName =
      (await resolveVolcEnhanceStandardProModelName(opts.modelName)) || opts.modelName;
    if (!modelName) {
      toast.error(
        `视频画质增强模型未配置（请在后台配置「${VOLC_ENHANCE_STANDARD_PRO_MODEL}」或「模型开关 → 视频高清」）`
      );
      return false;
    }
  } else {
    const resolved = await resolveHdNanoBananaI2iModel(opts.modelName);
    modelName = resolved.name || HD_NANO_BANANA_I2I_CATALOG;
    hdCatalogModel = resolved.model;
    if (!modelName) {
      toast.error(
        `高清模型未配置（请确保设置中已添加「${HD_NANO_BANANA_I2I_DISPLAY}」）`
      );
      return false;
    }
  }

  const generationOptions: GenerationOptions = {
    ...opts.generationOptions,
    hdProvider: String(opts.hdProvider || "jumengai"),
    // 固定上游模型族：gemini-nano-banana-2.1
    hdModel: HD_NANO_BANANA_I2I_UPSTREAM,
    hdScale: String(opts.hdScale || 2),
  };
  if (mediaKind === "video") {
    Object.assign(generationOptions, {
      enhanceMode: String(params.enhanceMode || opts.generationOptions.enhanceMode || "standard"),
      enhanceResolution: String(
        params.enhanceResolution || opts.generationOptions.enhanceResolution || "1080p"
      ),
      enhanceFps: String(params.enhanceFps ?? opts.generationOptions.enhanceFps ?? ""),
      enhanceScene: String(params.enhanceScene || opts.generationOptions.enhanceScene || "common"),
      enhanceStyle: String(params.enhanceStyle || opts.generationOptions.enhanceStyle || "hd"),
      enhanceBitrateLevel: String(
        params.enhanceBitrateLevel || opts.generationOptions.enhanceBitrateLevel || "medium"
      ),
      enhanceBitDepth: String(
        params.enhanceBitDepth || opts.generationOptions.enhanceBitDepth || "8"
      ),
      resolution: String(
        params.enhanceResolution || opts.generationOptions.enhanceResolution || "1080p"
      ),
      mode: String(params.enhanceMode || opts.generationOptions.enhanceMode || "standard"),
    });
  }

  store.setNodeStatus(opts.nodeId, "running");

  try {
    const sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, urlParamKey);
    if (!sourceUrl) {
      store.setNodeStatus(opts.nodeId, "idle");
      toast.error(mediaKind === "video" ? "请先连接参考视频" : "请先连接参考图片");
      return false;
    }

    let prompt = "";
    if (mediaKind === "video") {
      const mounted = mediaDurationToBillSeconds(getVideoNodeRef(opts.nodeId)?.duration);
      const probed = mounted ?? mediaDurationToBillSeconds(await probeVideoDurationSec(sourceUrl));
      const billSec = probed ?? resolveCanvasVideoBillSeconds(node, mounted);
      Object.assign(generationOptions, canvasVideoToolBillingOptions(billSec));
      prompt =
        [adminPrompt, "火山画质增强", `档次${params.enhanceMode || "standard"}`]
          .filter(Boolean)
          .join("，") || "视频画质增强";
    } else {
      // 图片：固定 gemini-nano-banana-2.1；清晰档 + 原图比例 → WxH
      const rawTier =
        opts.hdClarityTier ||
        params.hdClarityTier ||
        opts.hdMpTier ||
        params.hdMpTier;
      const tierId = isHdClarityTierId(rawTier) ? rawTier : DEFAULT_HD_CLARITY_TIER;
      const tier = hdClarityTierById(String(tierId));
      // 比例固定跟原图，忽略节点/面板里旧的比例选择
      const aspect = hdAspectRatioById(DEFAULT_HD_ASPECT_RATIO);
      let srcW = 0;
      let srcH = 0;
      try {
        const nat = await probeImageNaturalSize(sourceUrl);
        srcW = nat.width;
        srcH = nat.height;
      } catch {
        /* 下方统一报错 */
      }
      if (!(srcW >= 2 && srcH >= 2)) {
        store.setNodeStatus(opts.nodeId, "idle");
        toast.error("无法读取原图像素尺寸，请确认参考图已加载后重试");
        return false;
      }
      const out = computeHdOutputSizePx({
        srcW,
        srcH,
        clarityTier: tier.id,
        aspectRatio: aspect.id,
      });
      Object.assign(
        generationOptions,
        buildHdImageGenerationOptions({
          clarityTier: tier.id,
          aspectRatio: aspect.id,
          outputSize: out.size,
          model: hdCatalogModel,
        })
      );
      store.updateNodeParam(opts.nodeId, "hdClarityTier", tier.id);
      store.updateNodeParam(opts.nodeId, "hdAspectRatio", aspect.id);
      store.updateNodeParam(opts.nodeId, "hdMpTier", tier.id);
      store.updateNodeParam(opts.nodeId, "hdOutputSize", out.size);
      prompt = buildHdPrompt(adminPrompt, tier.label, out.size);
    }

    if (!prompt.trim()) {
      store.setNodeStatus(opts.nodeId, "idle");
      toast.error(
        mediaKind === "video"
          ? "画质增强提示词为空"
          : "请在后台「Prompt 模板 → 高清」配置提示词"
      );
      return false;
    }

    const quote = await getCreditQuote({
      model: modelName,
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
        model: modelName,
        sourceUrl,
        references:
          mediaKind === "video"
            ? [
                {
                  nodeId: opts.nodeId,
                  type: "video",
                  url: sourceUrl,
                  label: "画质增强",
                },
              ]
            : [
                {
                  nodeId: opts.nodeId,
                  type: "image",
                  url: sourceUrl,
                  label: "高清参考",
                },
              ],
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
      toast.error(resolved.errorMessage || (mediaKind === "video" ? "画质增强失败" : "高清生成失败"));
      return false;
    }

    const asset = await fetchAssetById(opts.projectId, resolved.assetId);
    if (!asset?.fileUrl) {
      store.setNodeStatus(opts.nodeId, "error");
      toast.error("生成结果无法加载");
      return false;
    }

    store.updateNodeParam(opts.nodeId, "assetId", asset.id);
    store.updateNodeParam(opts.nodeId, urlParamKey, asset.fileUrl);
    store.updateNodeParam(opts.nodeId, "prompt", prompt);
    store.updateNodeParam(opts.nodeId, "model", modelName);
    store.updateNodeParam(opts.nodeId, "generationOptions", generationOptions);
    store.updateNodeData(opts.nodeId, {
      label: asset.title?.trim() || (mediaKind === "video" ? "画质增强" : "高清"),
    });
    store.setNodeStatus(opts.nodeId, "success");
    notifyAssetsUpdated();
    toast.success(mediaKind === "video" ? "画质增强完成" : "高清图片已生成");
    return true;
  } catch (err) {
    store.setNodeStatus(opts.nodeId, "error");
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.onRefetchPricing);
      return false;
    }
    if (handleCollaboratorSpendCapError(err)) return false;
    const detail = err instanceof ApiError ? err.message : undefined;
    toast.error(detail || (mediaKind === "video" ? "画质增强失败" : "高清生成失败"));
    return false;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
