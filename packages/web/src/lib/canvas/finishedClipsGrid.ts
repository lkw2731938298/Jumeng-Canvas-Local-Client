/**
 * 爆款 / 出海专用「成片表」节点：仅批量成片时创建，不出现在节点面板。
 */

import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

export const FINISHED_CLIPS_GRID_TYPE = "finished_clips_grid" as const;

export type FinishedClipsSkillKind = "viral_remake" | "overseas_localize";

function newestNodeId(before: Set<string>, type: string): string {
  return (
    useCanvasStore
      .getState()
      .nodes.find((n) => n.type === type && !before.has(n.id))?.id ?? ""
  );
}

/**
 * 确保存在绑定到指定分镜表的成片表节点；已有则复用并移到分镜表右侧。
 * 返回成片表 nodeId（失败返回空串）。
 */
export function ensureFinishedClipsGridNode(opts: {
  gridNodeId: string;
  skillKind: FinishedClipsSkillKind;
}): string {
  const gridNodeId = (opts.gridNodeId || "").trim();
  if (!gridNodeId) return "";

  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === gridNodeId && n.type === "storyboard_grid");
  if (!grid) return "";

  const label = opts.skillKind === "overseas_localize" ? "出海成片表" : "爆款成片表";
  const pos = {
    x: (grid.position?.x ?? 80) + (grid.width && grid.width > 0 ? grid.width : 880) + 48,
    y: grid.position?.y ?? 80,
  };

  const existing = store.nodes.find((n) => {
    if (n.type !== FINISHED_CLIPS_GRID_TYPE) return false;
    const p = (n.data as WorkflowNodeData | undefined)?.params ?? {};
    return String(p.sourceGridNodeId || "") === gridNodeId;
  });

  if (existing) {
    const { nodes, setNodes, updateNodeData } = useCanvasStore.getState();
    setNodes(
      nodes.map((n) => (n.id === existing.id ? { ...n, position: { ...pos } } : n))
    );
    updateNodeData(existing.id, {
      label,
      params: {
        ...((existing.data as WorkflowNodeData).params ?? {}),
        sourceGridNodeId: gridNodeId,
        skillKind: opts.skillKind,
      },
    });
    // 写入分镜 meta，便于刷新后定位
    const gParams = (grid.data as WorkflowNodeData).params ?? {};
    const meta = {
      ...((gParams.viralRemakeMeta as Record<string, unknown> | undefined) ?? {}),
      finishedClipsNodeId: existing.id,
    };
    useCanvasStore.getState().updateNodeData(gridNodeId, {
      params: { ...gParams, viralRemakeMeta: meta },
    });
    return existing.id;
  }

  const before = new Set(store.nodes.map((n) => n.id));
  useCanvasStore.getState().addNode(FINISHED_CLIPS_GRID_TYPE, pos, { label });
  const id = newestNodeId(before, FINISHED_CLIPS_GRID_TYPE);
  if (!id) return "";

  useCanvasStore.getState().updateNodeData(id, {
    label,
    params: {
      sourceGridNodeId: gridNodeId,
      skillKind: opts.skillKind,
    },
  });

  const g2 = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const gParams = (g2?.data as WorkflowNodeData | undefined)?.params ?? {};
  const meta = {
    ...((gParams.viralRemakeMeta as Record<string, unknown> | undefined) ?? {}),
    finishedClipsNodeId: id,
  };
  useCanvasStore.getState().updateNodeData(gridNodeId, {
    params: { ...gParams, viralRemakeMeta: meta },
  });

  return id;
}
