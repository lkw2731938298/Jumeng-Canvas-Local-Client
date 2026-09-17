import type { QueryClient } from "@tanstack/react-query";
import { consumeLocalCanvasTool, resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import { getCreditQuote } from "@/lib/api/credits";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { CANVAS_TOOL_I2I_MODEL } from "@/lib/canvas/canvasToolImageModel";
import { cutoutImageToAsset } from "@/lib/canvas/imageCutout";
import { getNodeWorldPosition } from "@/lib/canvas/canvasOverlayTransform";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastAwaitingApproval,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import { toast } from "sonner";

export const CUTOUT_CANVAS_TOOL = "cutout";

/** 读取后台「抠图」提示词（写入结果节点，便于追溯） */
export async function loadCutoutAdminPrompt(): Promise<string> {
  const fallback = PROMPT_SUFFIX_FALLBACKS.cutout.content;
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.cutout as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append" && tool.appendText?.trim()) {
      return tool.appendText.trim();
    }
  } catch {
    /* 回退默认 */
  }
  return fallback;
}

/** 后台模型开关中的抠图主模型；缺省回退全能 Pro 图生图 */
async function resolveCutoutModelName(fallback: string): Promise<string> {
  const primary = await resolveCanvasToolPrimaryModel(
    CUTOUT_CANVAS_TOOL,
    fallback || CANVAS_TOOL_I2I_MODEL
  );
  return primary || CANVAS_TOOL_I2I_MODEL;
}

/**
 * 抠图：固定算力扣费（后台模型名结算）→ 浏览器本地去背景 → 右侧结果节点。
 * 提示词来自后台 Prompt 模板，写入结果节点便于审计。
 */
export async function runCutoutGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  sourceUrl: string;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  /** 前端工具模型兜底名 */
  fallbackModelName?: string;
  onRefetchPricing?: () => void;
}): Promise<boolean> {
  const store = useCanvasStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!sourceNode) {
    toast.error("源节点不存在");
    return false;
  }

  const modelName = await resolveCutoutModelName(opts.fallbackModelName || "");
  const adminPrompt = await loadCutoutAdminPrompt();
  const toastId = toast.loading("正在抠图，请稍候…");
  const sourceLabel =
    String(sourceNode.data?.label ?? "图片").trim() || "图片";

  try {
    const quote = await getCreditQuote({
      model: modelName,
      category: "image",
      generationOptions: {},
      canvasTool: CUTOUT_CANVAS_TOOL,
    });

    const charged = await consumeLocalCanvasTool(
      {
        projectId: opts.projectId,
        nodeId: opts.sourceNodeId,
        workflowId: opts.workflowId ?? undefined,
        model: modelName,
        canvasTool: CUTOUT_CANVAS_TOOL,
        quoteToken: quote.quoteToken,
      },
      { idempotencyKey: newIdempotencyKey(`${opts.sourceNodeId}-cutout`) }
    );

    if (charged.status === "awaiting_approval") {
      toastAwaitingApproval(charged.message);
      toast.dismiss(toastId);
      return false;
    }

    maybeToastCreditCharged(charged, opts.creditsEnabled);

    const asset = await cutoutImageToAsset({
      projectId: opts.projectId,
      nodeId: opts.sourceNodeId,
      sourceUrl: opts.sourceUrl,
      title: `${sourceLabel} · 抠图`,
    });

    const { width } = resolveNodeSize(sourceNode.width, sourceNode.height);
    const worldPos = getNodeWorldPosition(sourceNode, store.nodes);
    const edges = useCanvasStore.getState().edges;
    const siblingOffset =
      edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === "image").length *
      32;

    store.addNodeFromAsset(
      {
        id: asset.id,
        category: "image",
        fileUrl: asset.fileUrl,
        title: "抠图",
      },
      { x: worldPos.x + width + 48, y: worldPos.y + siblingOffset }
    );

    const newNodeId = useCanvasStore.getState().selectedNodeId;
    if (newNodeId) {
      store.connectNodes({
        source: opts.sourceNodeId,
        target: newNodeId,
        sourceHandle: "image",
        targetHandle: REFERENCE_INPUT_ID,
      });
      store.updateNodeParam(newNodeId, "toolMode", "cutout");
      store.updateNodeParam(newNodeId, "prompt", adminPrompt);
      store.updateNodeParam(newNodeId, "model", modelName);
      store.updateNodeData(newNodeId, { label: "抠图" });
    }

    notifyAssetsUpdated();
    toast.success("已生成抠图节点", { id: toastId });
    return true;
  } catch (err) {
    if (isPricingChangedError(err)) {
      toast.dismiss(toastId);
      toastPricingChanged(opts.onRefetchPricing);
      return false;
    }
    if (handleCollaboratorSpendCapError(err)) {
      toast.dismiss(toastId);
      return false;
    }
    toast.error(err instanceof Error ? err.message : "抠图失败", { id: toastId });
    return false;
  } finally {
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
  }
}
