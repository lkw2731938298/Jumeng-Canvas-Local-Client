/**
 * 多角度图生图：无头执行（Agent / 面板共用）。
 * 合成提示词 → generateFromMediaNode（canvasTool=multi_angle）→ 右侧结果节点。
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
  DEFAULT_MULTI_ANGLE,
  formatAngleNumber,
  normalizeAzimuth,
  normalizeElevation,
  type ShotScale,
} from "@/lib/canvas/multiAnglePresets";
import {
  buildMultiAnglePrompt,
  resolveMultiAngleBasePrompt,
} from "@/lib/canvas/resolveMultiAnglePrompt";
import { resolveCreativeGridToolModel } from "@/lib/canvas/resolveCreativeGridToolModel";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import {
  mergeComposerBase,
  type ComposerPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import type { WorkflowNodeData } from "@/types/workflow";
import { toast } from "sonner";

export const MULTI_ANGLE_CANVAS_TOOL = "multi_angle";

/** 与面板 hook 一致的默认 composer（后台不可用时兜底） */
const FALLBACK_COMPOSER: ComposerPromptToolConfig = {
  kind: "composer",
  template: "{base} → $h → $e → $s → $c → {extra?}",
  static: {
    j: "，",
    base: "基于参考图对同一主体重新取景，除摄像机机位外人物、服装、场景与画风保持不变",
    baseMode: "admin",
    c: "严格保持参考图同一人物身份与造型，禁止换脸换衣或改变场景，仅改变观察角度与构图",
  },
  formats: {
    h: "水平环绕{azimuth}度（{azimuthDesc}）",
    e: "俯仰{elevation}度（{elevationDesc}）",
  },
  lookups: {
    h: {
      "0": "正面机位",
      "45": "右前45度机位",
      "90": "右侧机位",
      "135": "右后45度机位",
      "180": "背面机位",
      "225": "左后45度机位",
      "270": "左侧机位",
      "315": "左前45度机位",
    },
    e: {
      "-90": "仰拍机位",
      "-45": "微仰机位",
      "0": "平视机位",
      "45": "微俯机位",
      "90": "顶视机位",
    },
    s: {
      close: "特写镜头，主体占画面主体且细节清晰",
      medium: "中景镜头，主体半身或全身可见",
      wide: "全景镜头，完整呈现主体与环境关系",
    },
  },
};

async function loadMultiAngleComposer(): Promise<ComposerPromptToolConfig> {
  try {
    const res = await getPromptToolConfig(MULTI_ANGLE_CANVAS_TOOL);
    if (res.config?.kind === "composer") return res.config;
  } catch {
    /* 回退默认 */
  }
  return FALLBACK_COMPOSER;
}

/**
 * 执行多角度生成。
 * - 若传入 `prompt`：直接使用（面板已合成）
 * - 否则按 azimuth/elevation/shot/extraPrompt 无头合成
 */
export async function runMultiAngleGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  /** 已合成提示词（面板路径）；缺省则按角度参数合成 */
  prompt?: string;
  azimuth?: number;
  elevation?: number;
  shot?: ShotScale;
  extraPrompt?: string;
  modelName?: string;
  generationOptions?: GenerationOptions;
  quoteToken?: string;
  onRefetchPricing?: () => void;
}): Promise<boolean> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!node || node.type !== "image_input") {
    toast.error("请选择图片节点");
    return false;
  }

  const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const azimuth = normalizeAzimuth(opts.azimuth ?? DEFAULT_MULTI_ANGLE.azimuth);
  const elevation = normalizeElevation(opts.elevation ?? DEFAULT_MULTI_ANGLE.elevation);
  const shot = (opts.shot || DEFAULT_MULTI_ANGLE.shot) as ShotScale;
  const extraPrompt = String(opts.extraPrompt ?? "").trim();

  let modelName = (opts.modelName || "").trim();
  let generationOptions = opts.generationOptions;
  if (!modelName || !generationOptions) {
    try {
      const resolved = await resolveCreativeGridToolModel(MULTI_ANGLE_CANVAS_TOOL);
      modelName = modelName || resolved.modelName;
      generationOptions = generationOptions || resolved.generationOptions;
    } catch {
      toast.error("无法读取多角度模型配置");
      return false;
    }
  }
  if (!modelName) {
    toast.error("多角度模型未配置或不可用");
    return false;
  }

  let prompt = String(opts.prompt ?? "").trim();
  if (!prompt) {
    const composer = await loadMultiAngleComposer();
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
    prompt = buildMultiAnglePrompt(composer, {
      base,
      extra: extraPrompt,
      azimuth,
      elevation,
      shot,
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

  try {
    let quoteToken = opts.quoteToken;
    if (!quoteToken) {
      try {
        const q = await getCreditQuote({
          model: modelName,
          category: "image",
          generationOptions,
          canvasTool: MULTI_ANGLE_CANVAS_TOOL,
        });
        quoteToken = q.quoteToken;
      } catch {
        /* 无 quote 仍尝试提交 */
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
        canvasTool: MULTI_ANGLE_CANVAS_TOOL,
      },
      {
        idempotencyKey: newIdempotencyKey(`${opts.sourceNodeId}-multi_angle`),
        quoteToken: quoteToken ?? undefined,
      }
    );

    maybeToastCreditCharged(result, opts.creditsEnabled);

    const angleLabel = `${formatAngleNumber(azimuth)}°`;
    const attached = await attachMediaGenerationResultNode({
      projectId: opts.projectId,
      result,
      sourceNodeId: opts.sourceNodeId,
      sourcePosition: node.position,
      sourceWidth: node.width,
      sourceHeight: node.height,
      sourceLabel: node.data.label,
      edges: store.edges,
      nodeTitle: `${angleLabel} · ${node.data.label || "图片"}`,
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
    toast.success("多角度图片已生成并已连接原图");
    return true;
  } catch (err) {
    store.setNodeStatus(opts.sourceNodeId, "error");
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.onRefetchPricing);
      return false;
    }
    if (handleCollaboratorSpendCapError(err)) return false;
    const detail = err instanceof ApiError ? err.message : undefined;
    toast.error(detail || "多角度生成失败，请检查模型是否已启用");
    return false;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
