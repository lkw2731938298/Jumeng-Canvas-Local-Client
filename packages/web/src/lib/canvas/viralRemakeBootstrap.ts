/**
 * 爆款复刻 / 一键出海：预置参考视频 + 分镜表（+ 可选替换图）。
 * 禁止误占用户已有普通分镜表：仅复用「同来源」或显式指定的 grid。
 */

import { useCanvasStore } from "@/stores/canvasStore";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import type { ViralRemakeSession } from "@/lib/canvas/viralRemakeSession";
import type { AppNode } from "@/lib/canvas/nodeGroup";
import type { WorkflowNodeData } from "@/types/workflow";

function newestNodeId(beforeIds: Set<string>, type: string): string | null {
  const nodes = useCanvasStore.getState().nodes;
  const found = nodes.find((n) => n.type === type && !beforeIds.has(n.id));
  return found?.id ?? null;
}

function gridMetaSource(node: AppNode): string {
  const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const meta = (params.viralRemakeMeta as Record<string, unknown> | undefined) ?? {};
  return String(meta.source || "").trim();
}

function gridShotCount(node: AppNode): number {
  const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const shots = params.shots;
  return Array.isArray(shots) ? shots.length : 0;
}

export type ViralRemakeBootstrapOptions = {
  /**
   * 优先复用该分镜表（重新拉片 / 出海节点已绑定）。
   * 须仍为 storyboard_grid，否则忽略。
   */
  preferGridNodeId?: string;
  /**
   * 仅复用 viralRemakeMeta.source 等于该值的分镜表（如 overseas_localize）。
   * 传入后：绝不占用用户普通分镜 / 其它技能分镜。
   */
  reuseMetaSource?: string;
  /**
   * 爆款复刻默认：只复用「已有爆款 meta 且非其它技能 source」的表；
   * 有镜头的无 meta 普通分镜一律新建，避免改掉用户已有分镜。
   */
  gridLabel?: string;
  videoLabel?: string;
};

export type ViralRemakeBootstrapResult = {
  videoNodeId: string;
  gridNodeId: string;
  replaceImageNodeIds: string[];
};

/** 解析可复用的分镜表；无合适候选则返回 undefined（由调用方新建） */
function resolveReusableGrid(
  nodes: AppNode[],
  opts?: ViralRemakeBootstrapOptions
): AppNode | undefined {
  const prefer = (opts?.preferGridNodeId || "").trim();
  if (prefer) {
    const hit = nodes.find((n) => n.id === prefer && n.type === "storyboard_grid");
    if (hit) return hit;
  }

  const wantSource = (opts?.reuseMetaSource || "").trim();
  if (wantSource) {
    // 同来源分镜：取最新一条（允许重新拉片覆盖出海专用表）
    const matches = nodes.filter(
      (n) => n.type === "storyboard_grid" && gridMetaSource(n) === wantSource
    );
    return matches.at(-1);
  }

  // 爆款复刻：禁止占用「已有镜头且无爆款 meta」的用户分镜表
  const viralish = nodes.filter((n) => {
    if (n.type !== "storyboard_grid") return false;
    const source = gridMetaSource(n);
    // 其它技能专用表不可复用
    if (source === "overseas_localize") return false;
    if (source === "video_node_parse" || source === "image_node_parse") return false;
    if (source && source !== "viral_remake") return false;
    // 有镜头但完全无 viralRemakeMeta → 视为用户自建分镜，勿动
    const params = (n.data as WorkflowNodeData | undefined)?.params ?? {};
    const hasMeta = Boolean(params.viralRemakeMeta);
    if (gridShotCount(n) > 0 && !hasMeta) return false;
    // 空表或已有爆款 meta 可复用
    return hasMeta || gridShotCount(n) === 0;
  });
  return viralish.at(-1);
}

/** 预置画布拓扑；复用规则见 ViralRemakeBootstrapOptions（默认保护用户已有分镜）。 */
export function bootstrapViralRemakeCanvas(
  session: ViralRemakeSession,
  opts?: ViralRemakeBootstrapOptions
): ViralRemakeBootstrapResult {
  const store = useCanvasStore.getState();
  const existingGrid = resolveReusableGrid(store.nodes, opts);
  const existingVideo = store.nodes.find((n) => {
    if (n.type !== "video_input") return false;
    const params = (n.data as { params?: Record<string, unknown> })?.params ?? {};
    return String(params.assetId ?? "") === session.videoAssetId;
  });

  let videoNodeId = existingVideo?.id ?? "";
  let gridNodeId = existingGrid?.id ?? "";
  const replaceImageNodeIds: string[] = [];

  const videoLabel = (opts?.videoLabel || "").trim() || "参考爆款视频";
  const gridLabel = (opts?.gridLabel || "").trim() || "爆款拉片分镜";

  if (!videoNodeId) {
    const before = new Set(store.nodes.map((n) => n.id));
    const position = resolveAddNodePosition("video_input", store.nodes, {
      viewport: store.viewport,
      paneSize: store.flowPaneSize,
      selectedNodeId: store.selectedNodeId,
    });
    store.addNodeFromAsset(
      {
        id: session.videoAssetId,
        category: "video",
        fileUrl: session.videoFileUrl,
        title: session.videoTitle || videoLabel,
      },
      position
    );
    videoNodeId = newestNodeId(before, "video_input") ?? "";
    if (videoNodeId) {
      store.updateNodeData(videoNodeId, {
        label: videoLabel,
      });
    }
  }

  if (!gridNodeId) {
    const latest = useCanvasStore.getState();
    const before = new Set(latest.nodes.map((n) => n.id));
    // 新建分镜：避开已有节点，勿叠在用户分镜上
    const position = resolveAddNodePosition("storyboard_grid", latest.nodes, {
      viewport: latest.viewport,
      paneSize: latest.flowPaneSize,
      selectedNodeId: videoNodeId || latest.selectedNodeId,
    });
    useCanvasStore.getState().addNode("storyboard_grid", position);
    gridNodeId = newestNodeId(before, "storyboard_grid") ?? "";
    if (gridNodeId) {
      useCanvasStore.getState().updateNodeData(gridNodeId, {
        label: gridLabel,
      });
      useCanvasStore.getState().updateNodeSize(gridNodeId, 920, 420);
    }
  }

  if (videoNodeId && gridNodeId) {
    const edges = useCanvasStore.getState().edges;
    const linked = edges.some((e) => e.source === videoNodeId && e.target === gridNodeId);
    if (!linked) {
      useCanvasStore.getState().connectNodes({
        source: videoNodeId,
        target: gridNodeId,
        sourceHandle: "video",
        targetHandle: REFERENCE_INPUT_ID,
      });
    }
  }

  // 替换参考图节点（用户上传的角色/产品）——排在分镜表下方，避免与表格重叠
  const gridNode = gridNodeId
    ? useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId)
    : undefined;
  const replaceOriginX = gridNode?.position?.x ?? 420;
  const replaceOriginY =
    (gridNode?.position?.y ?? 80) +
    (gridNode?.height && gridNode.height > 0 ? gridNode.height : 420) +
    64;
  const replaceCellW = 320;
  const replaceGap = 48;

  session.replaceImageAssetIds.forEach((assetId, i) => {
    const url = session.replaceImageUrls[i] || "";
    const already = useCanvasStore.getState().nodes.find((n) => {
      if (n.type !== "image_input") return false;
      const params = (n.data as { params?: Record<string, unknown> })?.params ?? {};
      return String(params.assetId ?? "") === assetId;
    });
    if (already) {
      replaceImageNodeIds.push(already.id);
      return;
    }
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNodeFromAsset(
      {
        id: assetId,
        category: "image",
        fileUrl: url,
        title: `替换素材${i + 1}`,
      },
      {
        x: replaceOriginX + (i % 4) * (replaceCellW + replaceGap),
        y: replaceOriginY + Math.floor(i / 4) * 220,
      }
    );
    const id = newestNodeId(before, "image_input");
    if (id) {
      useCanvasStore.getState().updateNodeData(id, { label: `替换素材${i + 1}` });
      replaceImageNodeIds.push(id);
      if (gridNodeId) {
        useCanvasStore.getState().connectNodes({
          source: id,
          target: gridNodeId,
          sourceHandle: "image",
          targetHandle: REFERENCE_INPUT_ID,
        });
      }
    }
  });

  if (gridNodeId) {
    useCanvasStore.getState().selectNode(gridNodeId);
  }

  return { videoNodeId, gridNodeId, replaceImageNodeIds };
}

/** 查找爆款复刻用分镜表（排除出海 / 视频解析专用表） */
export function findViralRemakeGridNode(): AppNode | undefined {
  return resolveReusableGrid(useCanvasStore.getState().nodes, undefined);
}
