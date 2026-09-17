import type { Edge } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";

/** 旋转工具模式标记（写在 image_input.params.toolMode） */
export const ROTATE_TOOL_MODE = "rotate";

export function isRotateToolMode(toolMode: unknown): boolean {
  return toolMode === ROTATE_TOOL_MODE;
}

/**
 * 从源图片节点右侧新建「旋转」图片节点（复制源图）、连线并进入旋转工具条。
 * 返回新节点 id；失败返回 null。
 */
export function createRotateNode(opts: {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  sourceAsset: { id: string; fileUrl: string; title?: string };
  edges: Edge[];
}): string | null {
  const store = useCanvasStore.getState();
  const beforeIds = new Set(store.nodes.map((n) => n.id));
  const { width, height } = resolveNodeSize(opts.sourceWidth, opts.sourceHeight);
  const siblingOffset =
    opts.edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === "image").length *
    32;

  store.addNodeFromAsset(
    {
      id: opts.sourceAsset.id,
      category: "image",
      fileUrl: opts.sourceAsset.fileUrl,
      title: "旋转",
    },
    {
      x: opts.sourcePosition.x + width + 48,
      y: opts.sourcePosition.y + siblingOffset,
    }
  );

  const newNode = useCanvasStore
    .getState()
    .nodes.find((n) => !beforeIds.has(n.id) && n.type === "image_input");
  if (!newNode) return null;

  // 与源节点同尺寸，便于旋转预览对齐
  useCanvasStore.setState((state) => ({
    nodes: state.nodes.map((n) =>
      n.id === newNode.id ? { ...n, width, height } : n
    ),
  }));

  store.updateNodeParam(newNode.id, "toolMode", ROTATE_TOOL_MODE);
  store.connectNodes({
    source: opts.sourceNodeId,
    target: newNode.id,
    sourceHandle: "image",
    targetHandle: REFERENCE_INPUT_ID,
  });

  // 选中已由 addNodeFromAsset 完成；打开旋转工具条
  store.openInlineImageTransform();

  return newNode.id;
}
