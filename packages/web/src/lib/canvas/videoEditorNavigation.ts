/**
 * 项目级剪辑台导航：与导演台类似，离开画布进入全屏多轨剪辑工作区。
 * 与节点顶栏「切段」（内联入/出点）不同入口。
 */

import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

export type VideoEditorNavOpts = {
  /** 预选视频素材，空轨时自动入轨 */
  assetId?: string | null;
  /** 从成片节点 composeMeta 回填时间线 */
  fromNodeId?: string | null;
};

export function videoEditorHref(projectId: string, opts?: VideoEditorNavOpts | string | null): string {
  const base = `/${projectId}/editor`;
  // 兼容旧调用：第二个参数直接传 assetId 字符串
  const normalized: VideoEditorNavOpts =
    typeof opts === "string" || opts == null
      ? { assetId: opts }
      : opts;
  const params = new URLSearchParams();
  const assetId = (normalized.assetId || "").trim();
  const fromNodeId = (normalized.fromNodeId || "").trim();
  if (assetId) params.set("assetId", assetId);
  if (fromNodeId) params.set("fromNodeId", fromNodeId);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/** 从当前选中视频节点读取 assetId（若有） */
export function selectedVideoAssetId(): string | null {
  const state = useCanvasStore.getState();
  const node = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : null;
  if (!node || node.type !== "video_input") return null;
  const params = (node.data as WorkflowNodeData | undefined)?.params as
    | Record<string, unknown>
    | undefined;
  const assetId = String(params?.assetId ?? "").trim();
  return assetId || null;
}

/** 选中节点若为完整剪辑成片（含 composeMeta），返回 nodeId */
export function selectedComposeNodeId(): string | null {
  const state = useCanvasStore.getState();
  const node = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : null;
  if (!node || node.type !== "video_input") return null;
  const params = (node.data as WorkflowNodeData | undefined)?.params as
    | Record<string, unknown>
    | undefined;
  if (!params) return null;
  const mode = String(params.toolMode ?? "").trim();
  const meta = params.composeMeta;
  if (mode === "video_compose" && meta && typeof meta === "object") {
    return node.id;
  }
  return null;
}

/** 尽量保存工作流后进入剪辑台（保存失败不阻断） */
export async function navigateToVideoEditor(
  projectId: string,
  push: (href: string) => void,
  opts?: VideoEditorNavOpts | string | null
): Promise<void> {
  try {
    await useCanvasStore.getState().saveWorkflow(true);
  } catch {
    toast.message("工作流自动保存失败，仍进入剪辑台");
  }
  push(videoEditorHref(projectId, opts));
}
