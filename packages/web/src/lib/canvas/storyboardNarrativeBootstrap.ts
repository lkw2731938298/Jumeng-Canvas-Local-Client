/**
 * 分镜叙事入口：故事板（分镜表）与调度故事板（导演台绑定分镜）。
 * 对齐 LibTV「分镜叙事」菜单的产品入口，复用现有节点类型。
 */

import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import { ensureDirectorStageNodeId, navigateToDirectorStage } from "@/lib/canvas/directorNavigation";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

function newestNodeId(beforeIds: Set<string>, type: string): string | null {
  const nodes = useCanvasStore.getState().nodes;
  return nodes.find((n) => n.type === type && !beforeIds.has(n.id))?.id ?? null;
}

/** 查找或创建分镜表节点，并选中、适应视口 */
export function ensureStoryboardGridNodeId(opts?: {
  label?: string;
  preferSelected?: boolean;
}): string | null {
  const store = useCanvasStore.getState();
  const selected = opts?.preferSelected !== false && store.selectedNodeId
    ? store.nodes.find((n) => n.id === store.selectedNodeId)
    : null;
  if (selected?.type === "storyboard_grid") {
    return selected.id;
  }

  const existing = store.nodes.filter((n) => n.type === "storyboard_grid");
  if (existing.length > 0) {
    const id = existing[existing.length - 1]!.id;
    store.selectNode(id);
    requestAnimationFrame(() => store.fitView?.());
    return id;
  }

  const before = new Set(store.nodes.map((n) => n.id));
  const position = resolveAddNodePosition("storyboard_grid", store.nodes, {
    viewport: store.viewport,
    paneSize: store.flowPaneSize,
    selectedNodeId: store.selectedNodeId,
  });
  store.addNode("storyboard_grid", position);
  const id = newestNodeId(before, "storyboard_grid");
  if (!id) return null;

  store.updateNodeData(id, {
    label: opts?.label?.trim() || "分镜表",
  });
  store.updateNodeSize(id, 920, 420);
  store.selectNode(id);
  requestAnimationFrame(() => store.fitView?.());
  return id;
}

/** 将导演台与分镜表双向绑定；可选绑定当前选中镜头 */
export function linkDirectorToStoryboard(opts: {
  gridNodeId: string;
  directorNodeId: string;
  shotId?: string;
}): void {
  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === opts.gridNodeId);
  const director = store.nodes.find((n) => n.id === opts.directorNodeId);
  if (!grid || !director) return;

  const gridParams = (grid.data as WorkflowNodeData | undefined)?.params ?? {};
  const directorParams = (director.data as WorkflowNodeData | undefined)?.params ?? {};
  const shotId =
    opts.shotId?.trim() ||
    String(gridParams.selectedShotId ?? "").trim() ||
    undefined;

  store.updateNodeData(opts.gridNodeId, {
    params: {
      ...gridParams,
      directorNodeId: opts.directorNodeId,
      ...(shotId ? { selectedShotId: shotId } : {}),
    },
  });
  store.updateNodeData(opts.directorNodeId, {
    label: String((director.data as WorkflowNodeData | undefined)?.label || "").trim() || "导演台",
    params: {
      ...directorParams,
      linkedStoryboardGridId: opts.gridNodeId,
      ...(shotId ? { linkedShotId: shotId } : {}),
    },
  });
}

/**
 * 打开调度故事板：确保分镜表 + 导演台，绑定后进入全屏导演页。
 * 返回导演台节点 id（导航由调用方执行）。
 */
export function openDispatchStoryboard(): {
  gridNodeId: string;
  directorNodeId: string;
} | null {
  const gridNodeId = ensureStoryboardGridNodeId({ label: "分镜表" });
  if (!gridNodeId) return null;

  const directorNodeId = ensureDirectorStageNodeId();
  if (!directorNodeId) return null;

  const grid = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const gridParams = (grid?.data as WorkflowNodeData | undefined)?.params ?? {};
  const shotId = String(gridParams.selectedShotId ?? "").trim() || undefined;

  linkDirectorToStoryboard({ gridNodeId, directorNodeId, shotId });
  return { gridNodeId, directorNodeId };
}

/** 从分镜表顶栏打开调度：绑定当前选中行后进导演台 */
export async function openDispatchStoryboardFromGrid(
  gridNodeId: string,
  projectId: string,
  push: (href: string) => void,
  shotId?: string
): Promise<string | null> {
  const directorNodeId = ensureDirectorStageNodeId();
  if (!directorNodeId) return null;
  linkDirectorToStoryboard({ gridNodeId, directorNodeId, shotId });
  await navigateToDirectorStage(projectId, directorNodeId, push);
  return directorNodeId;
}

/** 导演台截图回写到绑定的分镜行草图列 */
export function writeDirectorCaptureToLinkedShot(opts: {
  directorNodeId: string;
  assetId: string;
  cameraObjectId?: string;
}): boolean {
  const store = useCanvasStore.getState();
  const director = store.nodes.find((n) => n.id === opts.directorNodeId);
  if (!director) return false;
  const dParams = (director.data as WorkflowNodeData | undefined)?.params ?? {};
  const gridId = String(dParams.linkedStoryboardGridId ?? "").trim();
  if (!gridId) return false;

  const grid = store.nodes.find((n) => n.id === gridId);
  if (!grid || grid.type !== "storyboard_grid") return false;
  const gParams = (grid.data as WorkflowNodeData | undefined)?.params ?? {};
  const shots = Array.isArray(gParams.shots) ? [...gParams.shots] : [];
  const linkedShotId = String(dParams.linkedShotId ?? gParams.selectedShotId ?? "").trim();
  if (!linkedShotId || shots.length === 0) return false;

  let hit = false;
  const nextShots = shots.map((raw) => {
    const row = raw as Record<string, unknown>;
    if (String(row.id ?? "") !== linkedShotId) return raw;
    hit = true;
    return {
      ...row,
      sketchAssetId: opts.assetId,
      sketchStatus: "succeeded",
      sketchError: undefined,
      ...(opts.cameraObjectId ? { directorCameraId: opts.cameraObjectId } : {}),
    };
  });
  if (!hit) return false;

  store.updateNodeData(gridId, {
    params: {
      ...gParams,
      shots: nextShots,
      directorNodeId: opts.directorNodeId,
      selectedShotId: linkedShotId,
    },
  });
  return true;
}
