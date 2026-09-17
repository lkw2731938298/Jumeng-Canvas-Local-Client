/**
 * 打光图生图：无头执行（Agent / 面板共用）。
 * 合成提示词 → generateFromMediaNode（canvasTool=lighting）→ 右侧结果节点。
 */
import type { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { getPromptToolConfig } from "@/lib/api/promptConfig";
import { attachMediaGenerationResultNode } from "@/lib/canvas/canvasToolGeneratedImage";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import {
  DEFAULT_LIGHTING,
  normalizeLightingOptions,
  type LightingOptions,
} from "@/lib/canvas/lightingPresets";
import { lightingUiLabels, mergeComposerBase, type ComposerPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { buildLightingPromptFromConfig } from "@/lib/canvas/resolveLightingPrompt";
import { resolveMultiAngleBasePrompt } from "@/lib/canvas/resolveMultiAnglePrompt";
import { resolveCreativeGridToolModel } from "@/lib/canvas/resolveCreativeGridToolModel";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import type { WorkflowNodeData } from "@/types/workflow";
import { toast } from "sonner";

export const LIGHTING_CANVAS_TOOL = "lighting";

const FALLBACK_COMPOSER: ComposerPromptToolConfig = {
  kind: "composer",
  template: "$smart → {base} → $dir → $bright → $color → $rim → $c → {extra?}",
  static: {
    j: "，",
    base: "基于参考图对同一主体重新布光，除光照外人物、服装、场景与画风保持不变",
    baseMode: "admin",
    c: "严格保持参考图同一人物身份与造型，仅改变光照方向、强度与色温",
  },
  formats: {
    bright: "光照强度{brightness}",
  },
  lookups: {
    dir: {
      front: "前方主光",
      back: "后方主光",
      left: "左侧主光",
      top: "顶部主光",
      right: "右侧主光",
      bottom: "底部主光",
    },
    rim: { on: "开启轮廓光" },
    smart: { on: "智能布光" },
  },
  labels: {
    dir: {
      front: "前方",
      back: "后方",
      left: "左侧",
      top: "顶部",
      right: "右侧",
      bottom: "底部",
    },
  },
};

async function loadLightingComposer(): Promise<ComposerPromptToolConfig> {
  try {
    const res = await getPromptToolConfig(LIGHTING_CANVAS_TOOL);
    if (res.config?.kind === "composer") return res.config;
  } catch {
    /* 回退默认 */
  }
  return FALLBACK_COMPOSER;
}

/**
 * 执行打光生成。
 * - 若传入 `prompt`：直接使用（面板已合成）
 * - 否则按 lightingOptions / extraPrompt 无头合成
 */
export async function runLightingGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  prompt?: string;
  lightingOptions?: Partial<LightingOptions> | LightingOptions;
  extraPrompt?: string;
  modelName?: string;
  generationOptions?: GenerationOptions;
  quoteToken?: string;
  /** 结果节点标题用的方向文案；缺省从 composer labels 取 */
  directionLabel?: string;
  onRefetchPricing?: () => void;
  /** 是否把 options 写回源节点 params.lightingOptions（面板路径为 true） */
  persistOptions?: boolean;
}): Promise<boolean> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!node || node.type !== "image_input") {
    toast.error("请选择图片节点");
    return false;
  }

  const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const options = normalizeLightingOptions({
    ...DEFAULT_LIGHTING,
    ...normalizeLightingOptions(params.lightingOptions),
    ...(opts.lightingOptions || {}),
  });
  const extraPrompt = String(opts.extraPrompt ?? "").trim();

  let modelName = (opts.modelName || "").trim();
  let generationOptions = opts.generationOptions;
  if (!modelName || !generationOptions) {
    try {
      const resolved = await resolveCreativeGridToolModel(LIGHTING_CANVAS_TOOL);
      modelName = modelName || resolved.modelName;
      generationOptions = generationOptions || resolved.generationOptions;
    } catch {
      toast.error("无法读取打光模型配置");
      return false;
    }
  }
  if (!modelName) {
    toast.error("打光模型未配置或不可用");
    return false;
  }

  const composer = await loadLightingComposer();
  let prompt = String(opts.prompt ?? "").trim();
  if (!prompt) {
    const base = await resolveMultiAngleBasePrompt(
      opts.projectId,
      opts.sourceNodeId,
      String(params.prompt ?? ""),
      store.edges,
      store.nodes,
      [],
      composer
    );
    const effectiveBase = mergeComposerBase(composer, base);
    prompt = buildLightingPromptFromConfig(composer, {
      base,
      extra: extraPrompt,
      direction: options.direction,
      brightness: options.brightness,
      color: options.color,
      rimLight: options.rimLight,
      smartMode: options.smartMode,
    }).trim();
    if (!prompt || !effectiveBase.trim()) {
      toast.error("请在后台配置基础描述，或连接文本节点填写画布 prompt");
      return false;
    }
  }

  const sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, "imageUrl");
  if (!sourceUrl) {
    toast.error("请先上传参考图片");
    return false;
  }

  store.setNodeStatus(opts.sourceNodeId, "running");
  if (opts.persistOptions !== false) {
    store.updateNodeParam(opts.sourceNodeId, "lightingOptions", options);
  }

  try {
    let quoteToken = opts.quoteToken;
    if (!quoteToken) {
      try {
        const q = await getCreditQuote({
          model: modelName,
          category: "image",
          generationOptions,
          canvasTool: LIGHTING_CANVAS_TOOL,
        });
        quoteToken = q.quoteToken;
      } catch {
        /* optional */
      }
    }

    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: opts.sourceNodeId,
        workflowId: opts.workflowId ?? undefined,
        category: "image",
        prompt,
        model: modelName,
        sourceUrl,
        generationOptions,
        canvasTool: LIGHTING_CANVAS_TOOL,
      },
      {
        idempotencyKey: newIdempotencyKey(`${opts.sourceNodeId}-lighting`),
        quoteToken: quoteToken ?? undefined,
      }
    );

    maybeToastCreditCharged(result, opts.creditsEnabled);

    const ui = lightingUiLabels(composer);
    const dirLabel =
      opts.directionLabel ||
      ui.directionLabels[options.direction] ||
      options.direction;
    const attached = await attachMediaGenerationResultNode({
      projectId: opts.projectId,
      result,
      sourceNodeId: opts.sourceNodeId,
      sourcePosition: node.position,
      sourceWidth: node.width,
      sourceHeight: node.height,
      sourceLabel: node.data.label,
      edges: store.edges,
      nodeTitle: `${dirLabel}光 · ${node.data.label || "图片"}`,
      prompt,
      model: modelName,
      generationOptions,
    });

    if (!attached.ok) {
      store.setNodeStatus(opts.sourceNodeId, "error");
      toast.error(attached.errorMessage);
      return false;
    }

    store.setNodeStatus(opts.sourceNodeId, "success");
    toast.success("打光图片已生成并已连接原图");
    return true;
  } catch (err) {
    store.setNodeStatus(opts.sourceNodeId, "error");
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.onRefetchPricing);
      return false;
    }
    if (handleCollaboratorSpendCapError(err)) return false;
    const detail = err instanceof ApiError ? err.message : undefined;
    toast.error(detail || "打光生成失败，请检查模型是否已启用");
    return false;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
