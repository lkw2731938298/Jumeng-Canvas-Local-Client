import type { Edge } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import type { CreativeToolActionId } from "@/lib/canvas/imageCreativeToolsCatalog";

/** 创作工具节点前缀，避免与 hd_upscale / cutout 等冲突 */
export const CREATIVE_TOOL_MODE_PREFIX = "creative_";

export function creativeToolModeId(toolId: CreativeToolActionId): string {
  return `${CREATIVE_TOOL_MODE_PREFIX}${toolId}`;
}

export function isCreativeToolMode(toolMode: unknown): boolean {
  return typeof toolMode === "string" && toolMode.startsWith(CREATIVE_TOOL_MODE_PREFIX);
}

/**
 * 从源图片节点右侧新建创作工具图片节点并连线选中。
 * 注意：九宫格创作工具主路径已改为直接图生图（见 runCreativeToolDirectGenerate），
 * 本方法仅保留兼容/兜底，不再作为弹层默认行为。
 */
export function createCreativeToolImageNode(opts: {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  edges: Edge[];
  toolId: CreativeToolActionId;
  label: string;
  /** 后台「九宫格」配置的生成提示词；缺省回退为 label */
  prompt?: string;
}): string | null {
  const store = useCanvasStore.getState();
  const beforeIds = new Set(store.nodes.map((n) => n.id));
  const { width } = resolveNodeSize(opts.sourceWidth, opts.sourceHeight);
  const siblingOffset =
    opts.edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === "image").length *
    32;

  store.addNode("image_input", {
    x: opts.sourcePosition.x + width + 48,
    y: opts.sourcePosition.y + siblingOffset,
  });

  const newNode = useCanvasStore
    .getState()
    .nodes.find((n) => !beforeIds.has(n.id) && n.type === "image_input");
  if (!newNode) return null;

  const label = opts.label.trim() || "创作工具";
  const promptText = (opts.prompt || "").trim() || label;
  store.updateNodeData(newNode.id, { label });
  store.updateNodeParam(newNode.id, "toolMode", creativeToolModeId(opts.toolId));
  store.updateNodeParam(newNode.id, "creativeToolId", opts.toolId);
  // 预填后台配置的功能提示词（Prompt 模板 → 九宫格）
  store.updateNodeParam(newNode.id, "prompt", promptText);

  store.connectNodes({
    source: opts.sourceNodeId,
    target: newNode.id,
    sourceHandle: "image",
    targetHandle: REFERENCE_INPUT_ID,
  });
  store.selectNode(newNode.id);

  return newNode.id;
}
