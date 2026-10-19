import type { QueryClient } from "@tanstack/react-query";
import { consumeLocalCanvasTool } from "@/lib/api/canvasTools";
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

/** 本地扣费接口仍需合法 catalog 模型名；金额走平台固定价，与宫格切分相同 */
const CUTOUT_SETTLEMENT_MODEL = CANVAS_TOOL_I2I_MODEL;

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

/**
 * 抠图：平台固定算力扣费 → 浏览器本地去背景 → 右侧结果节点。
 * 不调用上游模型，也不读「功能模型切换」；提示词来自 Prompt 模板，写入结果节点便于审计。
 */
export async function runCutoutGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  sourceUrl: string;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  /** @deprecated 已忽略；抠图不再绑定工具主模型 */
  fallbackModelName?: string;
  onRefetchPricing?: () => void;
}): Promise<boolean> {
  const store = useCanvasStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!sourceNode) {
    toast.error("源节点不存在");
    return false;
  }

  const modelName = CUTOUT_SETTLEMENT_MODEL;
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
