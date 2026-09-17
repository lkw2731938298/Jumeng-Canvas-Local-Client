import type { QueryClient } from "@tanstack/react-query";
import type { Edge } from "@xyflow/react";
import { ApiError } from "@/lib/api/client";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { attachMediaGenerationResultNode } from "@/lib/canvas/canvasToolGeneratedImage";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { getNodeWorldPosition } from "@/lib/canvas/canvasOverlayTransform";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

/** 九宫格创作工具统一走画布工具固定算力（与顶栏全景/九宫格一致） */
export const CREATIVE_TOOLS_CANVAS_TOOL = "grid_9";

/**
 * 节点提示词与后台预设一并提交给模型。
 * 用户描述优先；预设追加；若用户词已包含整段预设则不重复拼接。
 */
export function buildCreativeToolSubmitPrompt(userPrompt: string, adminPrompt: string): string {
  const user = userPrompt.trim();
  const admin = adminPrompt.trim();
  if (user && admin) {
    if (user.includes(admin)) return user;
    return `${user}\n\n${admin}`;
  }
  return user || admin;
}

/**
 * 创作工具直接图生图（对齐全景）：
 * 用后台提示词立即生成，结果落到右侧新节点并连线；不预填源节点/空节点 prompt 等用户点生成。
 */
export async function runCreativeToolDirectGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  label: string;
  prompt: string;
  modelName: string;
  generationOptions: GenerationOptions;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  /** 默认 grid_9 */
  canvasTool?: string;
  /** 额外参考图（故事板等：连图带文字） */
  references?: GenerationReference[];
  /** 为 true 时允许无源节点图：用 references[0] 作 sourceUrl，或纯文生图 */
  allowMissingSourceImage?: boolean;
  /** 写入结果节点卡片的提示词；默认与 prompt 相同。故事板等应只写用户剧情，不暴露后台版式追加词 */
  nodePrompt?: string;
  onRefetchPricing?: () => void;
  /** 失败时回传 toast 同款原因，供 Agent 旁白展示 */
  onError?: (message: string) => void;
}): Promise<string | null> {
  const prompt = opts.prompt.trim();
  const label = opts.label.trim() || "创作工具";
  const nodePrompt = (opts.nodePrompt ?? opts.prompt).trim() || prompt;
  if (!prompt) {
    toast.error("请在后台「Prompt 模板」配置该功能的提示词");
    opts.onError?.("请在后台「Prompt 模板」配置该功能的提示词");
    return null;
  }

  const store = useCanvasStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!sourceNode) {
    toast.error("源节点不存在");
    opts.onError?.("源节点不存在");
    return null;
  }

  const params = (sourceNode.data?.params ?? {}) as Record<string, unknown>;
  const worldPos = getNodeWorldPosition(sourceNode, store.nodes);
  const canvasTool = opts.canvasTool || CREATIVE_TOOLS_CANVAS_TOOL;
  const references = (opts.references ?? []).filter((r) => r.type === "image" && r.url?.trim());

  store.setNodeStatus(opts.sourceNodeId, "running");

  try {
    let sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, "imageUrl");
    if (!sourceUrl && references[0]?.url) {
      sourceUrl = references[0].url.trim();
    }
    if (!sourceUrl && !opts.allowMissingSourceImage) {
      store.setNodeStatus(opts.sourceNodeId, "idle");
      toast.error("请先上传参考图片");
      opts.onError?.("请先上传参考图片");
      return null;
    }

    const quote = await getCreditQuote({
      model: opts.modelName,
      category: "image",
      generationOptions: opts.generationOptions,
      canvasTool,
    });

    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: opts.sourceNodeId,
        workflowId: opts.workflowId ?? undefined,
        category: "image",
        prompt,
        model: opts.modelName,
        sourceUrl: sourceUrl || undefined,
        references,
        generationOptions: opts.generationOptions,
        canvasTool,
      },
      {
        // Header 仅允许 Latin-1：禁止拼中文 label（故事板/调度故事板会直接导致 fetch 抛错）
        idempotencyKey: newIdempotencyKey(`${opts.sourceNodeId}-${canvasTool}`),
        quoteToken: quote.quoteToken,
      }
    );

    maybeToastCreditCharged(result, opts.creditsEnabled);

    const edges: Edge[] = useCanvasStore.getState().edges;
    const attached = await attachMediaGenerationResultNode({
      projectId: opts.projectId,
      result,
      sourceNodeId: opts.sourceNodeId,
      sourcePosition: worldPos,
      sourceWidth: sourceNode.width,
      sourceHeight: sourceNode.height,
      sourceLabel: sourceNode.data.label,
      edges,
      nodeTitle: `${label} · ${sourceNode.data.label || "图片"}`,
      prompt: nodePrompt,
      model: opts.modelName,
      generationOptions: opts.generationOptions,
    });

    if (!attached.ok) {
      store.setNodeStatus(opts.sourceNodeId, "error");
      toast.error(attached.errorMessage);
      opts.onError?.(attached.errorMessage);
      return null;
    }

    store.setNodeStatus(opts.sourceNodeId, "success");
    toast.success(`${label}已生成并已连接原图`);
    return attached.nodeId;
  } catch (err) {
    store.setNodeStatus(opts.sourceNodeId, "error");
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.onRefetchPricing);
      opts.onError?.("价格已更新，请确认后重试");
      return null;
    }
    if (handleCollaboratorSpendCapError(err)) {
      opts.onError?.("已达到协作消费上限");
      return null;
    }
    // 非 ApiError（如 Header 非法字符导致的 TypeError）也要露出真实原因，避免只见「xx生成失败」
    const detail =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : undefined;
    const message = detail || `${label}生成失败`;
    toast.error(message);
    opts.onError?.(message);
    return null;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
