import { consumeLocalCanvasTool } from "@/lib/api/canvasTools";
import { getCreditQuote } from "@/lib/api/credits";
import { CANVAS_TOOL_I2I_MODEL } from "@/lib/canvas/canvasToolImageModel";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastAwaitingApproval,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { splitImageIntoGridTiles } from "@/lib/canvas/gridSplitImage";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { getAbsolutePosition } from "@/lib/canvas/nodeGroup";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** 执行宫格切分：扣费 → 本地切图上传 → 铺节点并成组。 */
export async function runGridSplitOnNode(opts: {
  projectId: string;
  nodeId: string;
  workflowId?: string | null;
  modelName: string;
  rows: number;
  cols: number;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  onProgress?: (text: string) => void;
  refetchPricing?: () => void;
}): Promise<boolean> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.nodeId);
  if (!node || node.type !== "image_input") {
    toast.error("请选择图片节点");
    return false;
  }

  const params = (node.data.params || {}) as Record<string, unknown>;
  opts.onProgress?.("校验素材…");
  const sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, "imageUrl");
  if (!sourceUrl) {
    toast.error("请先上传参考图片");
    return false;
  }

  const model = opts.modelName || CANVAS_TOOL_I2I_MODEL;

  try {
    opts.onProgress?.("报价中…");
    const quote = await getCreditQuote({
      model,
      category: "image",
      generationOptions: {},
      canvasTool: "grid_split",
    });

    opts.onProgress?.("扣费中…");
    const charged = await consumeLocalCanvasTool(
      {
        projectId: opts.projectId,
        nodeId: opts.nodeId,
        workflowId: opts.workflowId ?? undefined,
        model,
        canvasTool: "grid_split",
        quoteToken: quote.quoteToken,
        rows: opts.rows,
        cols: opts.cols,
      },
      { idempotencyKey: newIdempotencyKey(`${opts.nodeId}-grid_split`) }
    );

    if (charged.status === "awaiting_approval") {
      toastAwaitingApproval(charged.message);
      return false;
    }

    maybeToastCreditCharged(charged, opts.creditsEnabled);
    invalidateCanvasCreditQueries(opts.queryClient);

    const labelBase = String(node.data.label || "图片").trim() || "图片";
    opts.onProgress?.(`切分中 0/${opts.rows * opts.cols}`);
    const tiles = await splitImageIntoGridTiles({
      projectId: opts.projectId,
      mediaUrl: sourceUrl,
      rows: opts.rows,
      cols: opts.cols,
      titlePrefix: labelBase,
      onProgress: (done, total) => opts.onProgress?.(`切分中 ${done}/${total}`),
    });

    const abs = getAbsolutePosition(node, store.nodes);
    const { width: srcW, height: srcH } = resolveNodeSize(node.width, node.height);
    const tileW = Math.max(40, Math.round(srcW / opts.cols));
    const tileH = Math.max(40, Math.round(srcH / opts.rows));
    const originX = abs.x + srcW + 48;
    const originY = abs.y;

    opts.onProgress?.("创建节点组…");
    const groupId = useCanvasStore.getState().addGridSplitTileGroup(
      tiles.map((t) => ({
        asset: {
          id: t.asset.id,
          fileUrl: t.asset.fileUrl,
          title: t.asset.title,
        },
        position: {
          x: originX + t.col * tileW,
          y: originY + t.row * tileH,
        },
        width: tileW,
        height: tileH,
      })),
      `宫格切分 · ${labelBase}`
    );

    if (!groupId) {
      toast.error("切块已上传，但成组失败，请手动框选成组");
      return false;
    }

    toast.success(`已切成 ${opts.rows}×${opts.cols} 并打成节点组`);
    return true;
  } catch (err) {
    if (handleCollaboratorSpendCapError(err)) return false;
    if (isPricingChangedError(err)) {
      toastPricingChanged(opts.refetchPricing);
      return false;
    }
    const message = err instanceof Error ? err.message : "宫格切分失败";
    toast.error(message);
    return false;
  }
}
