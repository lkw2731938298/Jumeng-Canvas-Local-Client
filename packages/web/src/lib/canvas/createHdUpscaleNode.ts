import type { Edge } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";

/** 高清放大工具模式标记（写在 image_input / video_input.params.toolMode） */
export const HD_UPSCALE_TOOL_MODE = "hd_upscale";

/** @deprecated 算力改走后台 canvas_tool_pricing；仅作 UI 兜底展示 */
export const HD_UPSCALE_CREDIT_COST = 15;

export const HD_UPSCALE_PROVIDERS = [
  { value: "topazlabs", label: "Topazlabs" },
] as const;

export const HD_UPSCALE_MODELS = [
  { value: "general", label: "通用" },
  { value: "low_res", label: "低分辨率" },
  { value: "animation_3d", label: "3D动画" },
  { value: "high_fidelity", label: "高保真" },
  { value: "text_optimize", label: "文本优化" },
] as const;

export const HD_UPSCALE_SCALES = [2, 4, 6] as const;

export type HdUpscaleScale = (typeof HD_UPSCALE_SCALES)[number];

export type HdUpscaleMediaKind = "image" | "video";

export function isHdUpscaleToolMode(toolMode: unknown): boolean {
  return toolMode === HD_UPSCALE_TOOL_MODE;
}

/** 预设模型 → 提示词补充说明 */
export function hdModelPromptHint(hdModel: string): string {
  const map: Record<string, string> = {
    general: "通用超分增强",
    low_res: "针对低分辨率素材修复细节",
    animation_3d: "适合3D动画风格的清晰度增强",
    high_fidelity: "高保真细节还原",
    text_optimize: "优化文字与线条清晰度",
  };
  return map[hdModel] || map.general;
}

/**
 * 从源图片/视频节点右侧新建「高清」节点（复制源素材）、连线并选中。
 * 返回新节点 id；失败返回 null。
 */
export function createHdUpscaleNode(opts: {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  sourceAsset?: { id: string; fileUrl: string; title?: string };
  edges: Edge[];
  /** 默认 image；视频顶栏「高清」传 video */
  mediaKind?: HdUpscaleMediaKind;
}): string | null {
  const mediaKind: HdUpscaleMediaKind = opts.mediaKind ?? "image";
  const nodeType = mediaKind === "video" ? "video_input" : "image_input";
  const sourceHandle = mediaKind === "video" ? "video" : "image";

  const store = useCanvasStore.getState();
  const beforeIds = new Set(store.nodes.map((n) => n.id));
  const { width } = resolveNodeSize(opts.sourceWidth, opts.sourceHeight);
  const siblingOffset =
    opts.edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === sourceHandle)
      .length * 32;
  const pos = {
    x: opts.sourcePosition.x + width + 48,
    y: opts.sourcePosition.y + siblingOffset,
  };

  // 有源素材则复制到新节点，便于底部面板直接超分
  if (opts.sourceAsset?.id && opts.sourceAsset.fileUrl) {
    store.addNodeFromAsset(
      {
        id: opts.sourceAsset.id,
        category: mediaKind,
        fileUrl: opts.sourceAsset.fileUrl,
        title: "高清",
      },
      pos
    );
  } else {
    store.addNode(nodeType, pos);
  }

  const newNode = useCanvasStore
    .getState()
    .nodes.find((n) => !beforeIds.has(n.id) && n.type === nodeType);
  if (!newNode) return null;

  store.updateNodeData(newNode.id, { label: "高清" });
  store.updateNodeParam(newNode.id, "toolMode", HD_UPSCALE_TOOL_MODE);
  store.updateNodeParam(newNode.id, "hdProvider", "topazlabs");
  store.updateNodeParam(newNode.id, "hdModel", "general");
  store.updateNodeParam(newNode.id, "hdScale", 2);

  // 视频高清按时长计费：从源节点复制 durationSec / 裁剪区间
  if (mediaKind === "video") {
    const source = store.nodes.find((n) => n.id === opts.sourceNodeId);
    const sp = (source?.data?.params ?? {}) as Record<string, unknown>;
    if (sp.durationSec != null) {
      store.updateNodeParam(newNode.id, "durationSec", sp.durationSec);
    } else if (sp.duration != null) {
      store.updateNodeParam(newNode.id, "durationSec", sp.duration);
    }
    if (sp.inlineVideoTrim) {
      store.updateNodeParam(newNode.id, "inlineVideoTrim", sp.inlineVideoTrim);
    } else if (sp.videoTrim) {
      store.updateNodeParam(newNode.id, "videoTrim", sp.videoTrim);
    }
  }

  store.connectNodes({
    source: opts.sourceNodeId,
    target: newNode.id,
    sourceHandle,
    targetHandle: REFERENCE_INPUT_ID,
  });
  store.selectNode(newNode.id);

  return newNode.id;
}
