import { create } from "zustand";
import { type Node, type Edge, type Connection, type NodeChange, type OnNodesChange, type OnEdgesChange, type OnConnect, type XYPosition, type Viewport, applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";
import type { WorkflowNodeData } from "@/types/workflow";
import type { NodeStatus } from "@/types/node-registry";
import { NODE_REGISTRY } from "@/types/node-registry";
import {
  DEFAULT_NODE_WIDTH,
  MIN_BODY_HEIGHT,
  NODE_TITLE_HEIGHT,
  defaultNodeSize,
  resolveNodeSize,
  resolveNodeSizeUnbounded,
  totalHeightFromWidth,
} from "@/lib/canvas/nodeSizing";
import { buildConnectedNodeIds } from "@/stores/canvasSelectors";
import { nodeTypeForAssetCategory, urlParamForAssetCategory } from "@/lib/canvas/assetDrag";
import {
  defaultPasteOffset,
  setCanvasNodeClipboard,
  getCanvasNodeClipboard,
} from "@/lib/canvas/canvasNodeClipboard";
import { normalizeStorageUrl } from "@/lib/api/storageUrl";
import { ensureHttpsOssUrl, isSignedOssUrl } from "@/lib/signedUrl";
import { nextNodeLabel } from "@/lib/canvas/nodeLabels";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { getLastSelectedModel } from "@/lib/canvas/lastSelectedModel";
import { isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import { getNodeModelCategory } from "@/lib/canvas/nodeModelRouting";
import {
  buildLibraryNodeParams,
  libraryNodeTypeForItem,
  validateLibraryConnection,
} from "@/lib/canvas/materialLibrary";
import type { MaterialLibraryItem } from "@/lib/api/materialLibrary";
import {
  readWorkflowCache,
  writeWorkflowCache,
} from "@/lib/canvas/workflowCache";
import { toast } from "sonner";
import {
  GROUP_BLACKLIST,
  GROUP_COLLAPSED_HEIGHT,
  aabbToGroupGeometry,
  buildGroupSnapshot,
  computeMembersAabb,
  getAbsolutePosition,
  getNodeSize,
  isGroupLocked,
  isGroupNode,
  sortNodesParentsFirst,
} from "@/lib/canvas/nodeGroup";
import {
  DEFAULT_INLINE_IMAGE_TRANSFORM,
  nextRotation90,
  nodeSizeForImageTransform,
  normalizeRotation,
  type InlineImageTransformState,
} from "@/lib/canvas/imageTransform";
import {
  DEFAULT_INLINE_IMAGE_OUTPAINT,
  type InlineImageOutpaintState,
} from "@/lib/canvas/imageOutpaint";
import {
  DEFAULT_INLINE_IMAGE_CROP,
  type InlineImageCropState,
} from "@/lib/canvas/imageCrop";
import {
  clampTrimRange,
  MIN_VIDEO_TRIM_SEC,
  type InlineVideoTrimState,
} from "@/lib/canvas/videoTrim";
import {
  DEFAULT_INLINE_VIDEO_CROP,
  type InlineVideoCropPurpose,
  type InlineVideoCropState,
} from "@/lib/canvas/videoCrop";
import {
  DEFAULT_IMAGE_GEN_PARAMS,
  type ImageGenParamsValue,
} from "@/components/canvas/ImageGenParamsToolbar";

type AppNode = Node<WorkflowNodeData>;
type HistoryEntry = { nodes: AppNode[]; edges: Edge[] };

/** 深拷贝画布快照，避免 React Flow 原地改 position 污染撤销栈 */
function cloneHistoryEntry(nodes: AppNode[], edges: Edge[]): HistoryEntry {
  try {
    return { nodes: structuredClone(nodes), edges: structuredClone(edges) };
  } catch {
    return {
      nodes: JSON.parse(JSON.stringify(nodes)) as AppNode[],
      edges: JSON.parse(JSON.stringify(edges)) as Edge[],
    };
  }
}

/** 重新导出，供面板保存组库时取快照 */
export { buildGroupSnapshot };

/** 判断节点是否为某组的后代（含多层嵌套） */
function isDescendantOf(node: AppNode, ancestorId: string, nodes: AppNode[]): boolean {
  let pid = node.parentId;
  const guard = new Set<string>();
  while (pid) {
    if (pid === ancestorId) return true;
    if (guard.has(pid)) break;
    guard.add(pid);
    const p = nodes.find((n) => n.id === pid);
    pid = p?.parentId;
  }
  return false;
}

/** 右上角批量运行进度（提交串行、层内轮询并行） */
export interface BatchRunProgress {
  total: number;
  submitted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentSubmitNodeId: string | null;
}

interface CanvasState {
  projectId: string; projectNo: string; projectName: string;
  projectRole: "owner" | "editor" | null;
  ownerDisplayName: string;
  workflowId: string | null; workflowRevision: number;
  nodes: AppNode[]; edges: Edge[]; viewport: Viewport;
  connectedNodeIds: Set<string>;
  selectedNodeId: string | null;
  /** React Flow 多选 / 框选 id（含组节点），供右上角批量运行读取 */
  selectedFlowIds: string[];
  setSelectedFlowIds: (ids: string[]) => void;
  /** 批量运行进度；null 表示未在跑 */
  batchRunProgress: BatchRunProgress | null;
  setBatchRunProgress: (progress: BatchRunProgress | null) => void;
  batchRunCancelRequested: boolean;
  setBatchRunCancelRequested: (v: boolean) => void;
  requestCancelBatchRun: () => void;
  /** LibTV-style multi-angle tool: replaces bottom editor for this node */
  multiAngleNodeId: string | null;
  openMultiAngle: (nodeId: string) => void;
  closeMultiAngle: () => void;
  /** 图片节点卡片内标注：画笔 / 擦除 / 框选 / 文字 */
  inlineImageDrawTool: "brush" | "eraser" | "rect" | "text" | null;
  inlineImageDrawColor: string;
  inlineImageDrawSize: number;
  setInlineImageDrawTool: (tool: "brush" | "eraser" | "rect" | "text" | null) => void;
  setInlineImageDrawColor: (color: string) => void;
  setInlineImageDrawSize: (size: number) => void;
  clearInlineImageDrawTool: () => void;
  /** 图片节点「擦除」模式（与标注共用笔迹层，工具条不同） */
  inlineImageEraseMode: boolean;
  inlineImageEraseParams: ImageGenParamsValue | null;
  openInlineImageErase: () => void;
  closeInlineImageErase: () => void;
  patchInlineImageEraseParams: (patch: Partial<ImageGenParamsValue>) => void;
  /** 图片节点旋转与镜像预览态（保存后烘焙为新节点） */
  inlineImageTransform: InlineImageTransformState | null;
  openInlineImageTransform: () => void;
  /** restoreBaseSize：取消时恢复进入前尺寸；保存后应传 false，避免与新图自适应抢尺寸 */
  closeInlineImageTransform: (opts?: { restoreBaseSize?: boolean }) => void;
  rotateInlineImageTransform90: () => void;
  setInlineImageTransformRotation: (deg: number) => void;
  toggleInlineImageTransformFlipH: () => void;
  toggleInlineImageTransformFlipV: () => void;
  /** 图片节点扩图浮条参数 */
  inlineImageOutpaint: InlineImageOutpaintState | null;
  openInlineImageOutpaint: () => void;
  closeInlineImageOutpaint: () => void;
  patchInlineImageOutpaint: (patch: Partial<InlineImageOutpaintState>) => void;
  /** 图片节点裁剪框（归一化 0–1） */
  inlineImageCrop: InlineImageCropState | null;
  openInlineImageCrop: () => void;
  closeInlineImageCrop: () => void;
  patchInlineImageCrop: (patch: Partial<InlineImageCropState>) => void;
  /** LibTV-style lighting tool: replaces bottom editor for this node */
  lightingNodeId: string | null;
  openLighting: (nodeId: string) => void;
  closeLighting: () => void;
  /** 故事板 / 调度故事板：浮动输入条（一张多镜合成图） */
  storyboardSheetKind: "storyboard" | "blocking_storyboard" | null;
  storyboardSheetNodeId: string | null;
  openStoryboardSheet: (
    kind: "storyboard" | "blocking_storyboard",
    nodeId?: string | null
  ) => void;
  closeStoryboardSheet: () => void;
  setStoryboardSheetNodeId: (nodeId: string | null) => void;
  /** Video frame pick mode — user scrubs then saves a still */
  framePickNodeId: string | null;
  framePickTimeSec: number;
  openFramePick: (nodeId: string, initialTimeSec?: number) => void;
  closeFramePick: () => void;
  setFramePickTime: (timeSec: number) => void;
  /** 视频节点内联剪辑：入/出点选区 */
  inlineVideoTrim: InlineVideoTrimState | null;
  openInlineVideoTrim: (nodeId: string, durationSec?: number) => void;
  closeInlineVideoTrim: () => void;
  patchInlineVideoTrim: (patch: Partial<Pick<InlineVideoTrimState, "inSec" | "outSec">>) => void;
  /** 视频节点空间裁剪框 */
  inlineVideoCrop: InlineVideoCropState | null;
  openInlineVideoCrop: (nodeId: string, purpose?: InlineVideoCropPurpose) => void;
  closeInlineVideoCrop: () => void;
  patchInlineVideoCrop: (patch: Partial<Omit<InlineVideoCropState, "nodeId">>) => void;
  /** 图片节点画图绘制全屏画板 */
  drawingBoardNodeId: string | null;
  /** draw=新绘（可带入节点当前图）；continue=恢复草稿 */
  drawingBoardIntent: "draw" | "continue" | null;
  openDrawingBoard: (nodeId: string, intent?: "draw" | "continue") => void;
  closeDrawingBoard: () => void;
  /** 底部生成参数面板是否展开（与顶栏下拉互斥） */
  generationOptionsExpanded: boolean;
  setGenerationOptionsExpanded: (open: boolean) => void;
  /** 递增后顶栏关闭全部下拉菜单 */
  topMenuCloseSeq: number;
  requestCloseTopMenus: () => void;
  isRunning: boolean; nodeExecutionStatus: Record<string, NodeStatus>; isLoading: boolean; loadError: string | null;
  /** Set when auto-save cannot resolve a revision conflict with the server. */
  syncConflict: { serverRevision: number } | null;
  gridVisible: boolean; gridPattern: "line" | "dot"; snapToGrid: boolean; minimapVisible: boolean;
  flowPaneSize: { width: number; height: number };
  centerFlowView: ((flowX: number, flowY: number) => void) | null;
  panFlowView: ((deltaFlowX: number, deltaFlowY: number) => void) | null;
  applyZoom: ((zoom: number) => void) | null;
  canvasMode: "pointer" | "drag";
  isConnecting: boolean; setConnecting: (v: boolean) => void;
  /** True while any node is being dragged — suppresses heavy media decoders. */
  isCanvasDragging: boolean;
  setCanvasDragging: (dragging: boolean) => void;
  history: HistoryEntry[]; historyIndex: number;
  /** 重做栈：撤销时把当前画布压入，新操作会清空 */
  historyFuture: HistoryEntry[];
  pushHistory: () => void; undo: () => void; redo: () => void;
  initProject: (projectId: string) => Promise<void>;
  resetForLogout: () => void;
  addNode: (type: string, position: XYPosition, opts?: { id?: string; label?: string }) => void;
  addNodeFromAsset: (asset: { id: string; category: import("@/lib/api/assets").AssetCategory; fileUrl: string; title: string }, position: XYPosition) => void;
  /** 从平台素材库落锁定参考节点（风格/特效/角色） */
  addNodeFromLibraryItem: (item: MaterialLibraryItem, position: XYPosition) => void;
  connectNodes: (connection: { source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void;
  removeSelectedNodes: () => void;
  onNodesChange: OnNodesChange<AppNode>; onEdgesChange: OnEdgesChange; onConnect: OnConnect;
  selectNode: (id: string | null) => void; selectAllNodes: () => void;
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void;
  updateNodeParam: (id: string, key: string, value: unknown) => void;
  applyNodeGeneratedMedia: (
    id: string,
    urlParamKey: string,
    mediaUrl: string,
    assetId?: string
  ) => void;
  updateNodeSize: (id: string, width: number, height: number, unbounded?: boolean) => void;
  setNodes: (nodes: AppNode[]) => void; setEdges: (edges: Edge[]) => void;
  saveWorkflow: (silent?: boolean) => Promise<void>;
  loadWorkflow: (flowJson: string) => void;
  reloadWorkflowFromServer: () => Promise<void>;
  dismissSyncConflict: () => void;
  scheduleAutoSave: () => void;
  flushAutoSave: () => Promise<void>;
  addTemplate: (nodes: { type: string; position: XYPosition }[], edges: { source: number; target: number; sourceHandle?: string; targetHandle?: string }[]) => void;
  /** 多选节点打成液态玻璃组框；silent 时不写入撤销栈（批量流程已 pushHistory） */
  createNodeGroup: (ids: string[], label?: string, opts?: { silent?: boolean }) => string | null;
  /** 宫格切分：批量落地切块图片节点并自动成组 */
  addGridSplitTileGroup: (
    tiles: Array<{
      asset: { id: string; fileUrl: string; title: string };
      position: XYPosition;
      width: number;
      height: number;
    }>,
    groupLabel?: string
  ) => string | null;
  /** 解组：仅手动触发；成员升为组的父级或顶层世界坐标 */
  ungroupNode: (groupId: string, opts?: { silent?: boolean }) => void;
  /** 按成员 AABB 刷新组框（不自动解组） */
  refreshGroupBounds: (groupId: string) => void;
  /** 拖拽结束：仅刷新被拖成员所属组 AABB，不自动离组/解组 */
  reconcileGroupsAfterDrag: (draggedNodeId?: string) => void;
  /** 锁定/解锁组（锁定后成员不可拖、不可拖出） */
  setGroupLocked: (groupId: string, locked: boolean) => void;
  /** 折叠/展开组 */
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  /** 从组库快照插入整组到画布 */
  addGroupFromLibrary: (
    snapshot: import("@/lib/canvas/nodeGroup").GroupSnapshot,
    dropPosition?: XYPosition
  ) => string | null;
  /**
   * 复制选中节点（含组内成员）与选区内部连线。
   * leaveInPlace：副本落在原位（Alt 拖拽复制）；否则整体偏移。
   * includeEdges：是否复制选区内部连线（Ctrl+D / Ctrl+Alt 拖拽）。
   */
  duplicateSelectedNodes: (opts?: {
    ids?: string[];
    includeEdges?: boolean;
    leaveInPlace?: boolean;
    offset?: XYPosition;
    silent?: boolean;
  }) => string[];
  /** 将当前选区写入内部剪贴板（Ctrl+C） */
  copySelectionToClipboard: () => boolean;
  /** 从内部剪贴板粘贴节点（Ctrl+V）；成功返回新根 id */
  pasteClipboardNodes: (opts?: { offset?: XYPosition }) => string[];
  fitView: (() => void) | null; setFitView: (fn: () => void) => void;
  organizeNodes: (() => void) | null; setOrganizeNodes: (fn: () => void) => void;
  setZoom: (zoom: number) => void;
  setRunning: (running: boolean) => void;
  setNodeStatus: (nodeId: string, status: NodeStatus, progress?: number) => void;
  /** Survives NodeEditorOverlay remount while long media jobs run. */
  activeGenerationNodeIds: Record<string, true>;
  beginNodeGeneration: (nodeId: string) => void;
  endNodeGeneration: (nodeId: string) => void;
  setViewport: (viewport: Viewport) => void;
  onNodeDragStop: (draggedNodeId?: string) => void;
  setCanvasMode: (mode: "pointer" | "drag") => void;
}

let nodeCounter = 0;
function genId(type: string): string { return `${type}_${Date.now()}_${++nodeCounter}`; }
const MAX_HISTORY = 25;

function normalizeNode(node: AppNode): AppNode {
  const unbounded =
    node.type === "storyboard_grid" ||
    node.type === "finished_clips_grid" ||
    node.type === "overseas_localize" ||
    node.type === "node_group";
  const { width, height } = unbounded
    ? resolveNodeSizeUnbounded(node.width, node.height)
    : resolveNodeSize(node.width, node.height);
  const def = NODE_REGISTRY[node.type || ""];
  if (!def) return { ...node, width, height };
  const data = node.data as WorkflowNodeData;
  // 组节点保留 memberIds 等扩展字段，仅补齐空端口定义
  if (node.type === "node_group") {
    return {
      ...node,
      width,
      height,
      style: { ...(node.style as object | undefined), width, height },
      dragHandle: node.dragHandle || ".node-group-drag-handle",
      zIndex: node.zIndex ?? -1,
      data: {
        ...data,
        inputs: [],
        outputs: [],
        memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
      },
    };
  }
  return {
    ...node,
    width,
    height,
    // 大尺寸控制卡与 RF 可见性裁剪：同步 style 尺寸
    ...(unbounded
      ? { style: { ...(node.style as object | undefined), width, height } }
      : {}),
    data: {
      ...data,
      inputs: def.inputs,
      outputs: def.outputs,
    },
  };
}

function persistWorkflowCacheFromState(state: {
  projectId: string;
  projectNo: string;
  projectName: string;
  workflowId: string | null;
  workflowRevision: number;
  nodes: AppNode[];
  edges: Edge[];
}) {
  if (!state.projectId) return;
  const cleanEdges = state.edges.filter((e) => e.source && e.target && e.id);
  writeWorkflowCache(state.projectId, {
    projectNo: state.projectNo,
    projectName: state.projectName,
    workflowId: state.workflowId,
    workflowRevision: state.workflowRevision,
    flowJson: JSON.stringify({ nodes: state.nodes, edges: cleanEdges }),
  });
}

function revisionFromConflictDetail(detail: unknown): number | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as { currentRevision?: number };
  return typeof record.currentRevision === "number" ? record.currentRevision : null;
}

function hydrateWorkflowFromJson(flowJson: string): { nodes: AppNode[]; edges: Edge[] } | null {
  try {
    const data = JSON.parse(flowJson);
    // 加载时保证父节点在子节点之前，修复历史错误顺序
    const nodes = sortNodesParentsFirst((data.nodes || []).map(normalizeNode));
    const edges = normalizeEdges(
      (data.edges || []).filter((e: Edge) => e.source && e.target && e.id),
      nodes
    );
    return { nodes, edges };
  } catch {
    return null;
  }
}

/** Remap legacy per-media target handles to unified `ref_in`；连线描边色跟随终点节点卡片色 */
function normalizeEdges(edges: Edge[], nodes: AppNode[]): Edge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((edge) => {
    let next = edge;
    const target = nodeMap.get(edge.target);
    if (!target) return next;
    const def = NODE_REGISTRY[target.type || ""];
    if (!def) return next;

    const inputIds = new Set(def.inputs.map((port) => port.id));
    if (inputIds.has(REFERENCE_INPUT_ID)) {
      const handle = edge.targetHandle;
      if (handle && !inputIds.has(handle)) {
        next = { ...next, targetHandle: REFERENCE_INPUT_ID };
      }
    }

    // 终点节点类型色 → 连线描边（与卡片主色一致）
    const edgeColor = hexToRgba(def.color || "#8b5cf6", 0.72);
    const prevStroke = (next.style as { stroke?: string } | undefined)?.stroke;
    if (prevStroke !== edgeColor) {
      next = {
        ...next,
        style: { ...(next.style || {}), stroke: edgeColor, strokeWidth: 2 },
      };
    }
    return next;
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Module-level: debounce timer for auto-save (non-reactive)
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 3000;
/** Serialize workflow saves so concurrent PUTs do not fight over revision. */
let saveTail: Promise<void> = Promise.resolve();

function shouldAutoSaveNodeChanges(changes: NodeChange[]): boolean {
  return changes.some((c) => {
    if (c.type === "position") return c.dragging === false;
    if (c.type === "dimensions") return true;
    return c.type === "remove" || c.type === "add" || c.type === "replace";
  });
}

function paramChangeNeedsSave(key: string): boolean {
  // Text body is persisted to OSS separately; avoid full workflow saves on every keystroke.
  return key !== "content";
}

const EPHEMERAL_MEDIA_URL_PARAMS = ["imageUrl", "videoUrl", "audioUrl"] as const;

/** Drop stale proxy/signed URLs from flow_json when assetId is the source of truth. */
function sanitizeNodesForPersist(nodes: AppNode[]): AppNode[] {
  return nodes.map((node) => {
    const params = { ...(node.data.params ?? {}) };
    const assetId = String(params.assetId ?? "");
    if (!assetId) return node;
    for (const key of EPHEMERAL_MEDIA_URL_PARAMS) {
      if (key in params) delete params[key];
    }
    return { ...node, data: { ...node.data, params } };
  });
}

// Module-level: race condition guard for initProject / save
let initRequestId = 0;
/** 切换项目时递增，丢弃过期保存回写，避免 workflowId 串到新项目 */
let workflowSaveEpoch = 0;

async function performWorkflowSave(
  silent: boolean,
  get: () => CanvasState,
  set: (partial: Partial<CanvasState> | ((state: CanvasState) => Partial<CanvasState>)) => void
): Promise<void> {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  const { projectId, nodes, edges, workflowId, workflowRevision, isLoading } = get();
  if (isLoading || !projectId) return;

  // 捕获本次保存所属项目；await 后若已切换项目则禁止回写 store / 缓存
  const saveProjectId = projectId;
  const saveEpoch = workflowSaveEpoch;
  const cleanEdges = edges.filter((e: Edge) => e.source && e.target && e.id);
  const flowJson = JSON.stringify({ nodes: sanitizeNodesForPersist(nodes), edges: cleanEdges });
  const { saveWorkflow: apiSave, getLatestWorkflow } = await import("@/lib/api/workflows");
  const { ApiError } = await import("@/lib/api/client");

  let id = workflowId;
  let rev = workflowRevision;

  const stillOnSaveProject = () =>
    saveEpoch === workflowSaveEpoch && get().projectId === saveProjectId;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!stillOnSaveProject()) return;
    try {
      const result = await apiSave({
        projectId: saveProjectId,
        title: get().projectName,
        flowJson,
        workflowId: id ?? undefined,
        expectedRevision: id ? rev : undefined,
      });
      // 切换项目后丢弃回写，防止把旧 workflowId 写进新项目 store/localStorage
      if (!stillOnSaveProject()) return;
      if (result?.id) {
        // 后端若返回其它项目的工作流，拒绝接纳
        if (result.projectId && String(result.projectId) !== String(saveProjectId)) {
          if (!silent) toast.error("保存结果与当前项目不匹配，已忽略");
          return;
        }
        set({ workflowId: result.id, workflowRevision: result.revision ?? rev, syncConflict: null });
      }
      persistWorkflowCacheFromState(get());
      return;
    } catch (err) {
      if (!stillOnSaveProject()) return;
      const isRevisionConflict =
        err instanceof ApiError &&
        (err.code === "REVISION_CONFLICT" || err.status === 409);
      const isProjectMismatch =
        err instanceof ApiError &&
        (err.status === 403 || err.code === "FORBIDDEN");
      if (isProjectMismatch) {
        // workflowId 与 projectId 不一致：清空错误 id，下次走 POST 重建/拉取
        set({ workflowId: null });
        if (!silent) toast.error("画布绑定异常，请刷新页面后重试");
        return;
      }
      if (!isRevisionConflict) {
        if (!silent) toast.error("保存失败，请检查网络连接");
        return;
      }
      const conflictRev = revisionFromConflictDetail(err.content ?? err.detail);
      const latest = await getLatestWorkflow(saveProjectId).catch(() => null);
      if (!stillOnSaveProject()) return;
      id = latest?.id ?? id;
      rev = conflictRev ?? latest?.revision ?? rev;
      if (id) set({ workflowId: id, workflowRevision: rev });
      if (attempt === 2) {
        set({ syncConflict: { serverRevision: rev } });
        if (!silent) {
          toast.error("画布已被其他协作者更新，请拉取最新版本", { duration: 5000 });
        }
        return;
      }
    }
  }
}

/** 按旋转 AABB 调整节点尺寸，并从中心扩展/收缩，避免卡片裁切倾斜图 */
function resizeNodeForImageTransform<T extends { id: string; width?: number; height?: number; position: { x: number; y: number } }>(
  nodes: T[],
  nodeId: string | null | undefined,
  transform: InlineImageTransformState | null | undefined,
  targetSize?: { width: number; height: number }
): T[] {
  if (!nodeId || !transform) return nodes;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return nodes;
  const raw = targetSize ?? nodeSizeForImageTransform(transform);
  const size = resolveNodeSizeUnbounded(raw.width, raw.height);
  const prevW = node.width && node.width > 0 ? node.width : size.width;
  const prevH = node.height && node.height > 0 ? node.height : size.height;
  const dw = size.width - prevW;
  const dh = size.height - prevH;
  if (dw === 0 && dh === 0) return nodes;
  return nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          width: size.width,
          height: size.height,
          position: {
            x: n.position.x - dw / 2,
            y: n.position.y - dh / 2,
          },
        }
      : n
  );
}

/** 结束旋转预览时恢复进入前的节点尺寸 */
function restoreTransformBaseSize<T extends { id: string; width?: number; height?: number; position: { x: number; y: number } }>(
  nodes: T[],
  nodeId: string | null | undefined,
  transform: InlineImageTransformState | null | undefined
): T[] {
  if (!nodeId || !transform) return nodes;
  return resizeNodeForImageTransform(nodes, nodeId, transform, {
    width: transform.baseWidth,
    height: NODE_TITLE_HEIGHT + transform.baseBodyHeight,
  });
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  projectId: "", projectNo: "", projectName: "", projectRole: null, ownerDisplayName: "",
  workflowId: null, workflowRevision: 1,
  nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  connectedNodeIds: new Set<string>(),
  selectedNodeId: null,
  selectedFlowIds: [],
  setSelectedFlowIds: (ids) => set({ selectedFlowIds: ids }),
  batchRunProgress: null,
  setBatchRunProgress: (progress) => set({ batchRunProgress: progress }),
  batchRunCancelRequested: false,
  setBatchRunCancelRequested: (v) => set({ batchRunCancelRequested: v }),
  requestCancelBatchRun: () => set({ batchRunCancelRequested: true }),
  multiAngleNodeId: null,
  lightingNodeId: null,
  storyboardSheetKind: null,
  storyboardSheetNodeId: null,
  framePickNodeId: null,
  framePickTimeSec: 0,
  inlineVideoTrim: null,
  inlineVideoCrop: null,
  drawingBoardNodeId: null,
  drawingBoardIntent: null,
  generationOptionsExpanded: false,
  topMenuCloseSeq: 0,
  inlineImageDrawTool: null,
  inlineImageDrawColor: "#ef4444",
  inlineImageDrawSize: 16,
  inlineImageEraseMode: false,
  inlineImageEraseParams: null,
  inlineImageTransform: null,
  inlineImageOutpaint: null,
  inlineImageCrop: null,
  isRunning: false, nodeExecutionStatus: {}, isLoading: false, loadError: null, syncConflict: null,
  gridVisible: true, gridPattern: "line", snapToGrid: false, minimapVisible: false,
  flowPaneSize: { width: 0, height: 0 },
  centerFlowView: null,
  panFlowView: null,
  applyZoom: null,
  canvasMode: "pointer",
  isConnecting: false,
  isCanvasDragging: false,
  history: [], historyIndex: -1, historyFuture: [],

  pushHistory: () => {
    // 各操作在变更前调用：把当前画布压入 past，并丢掉 redo 分支
    const { nodes, edges, history, historyIndex } = get();
    const past = history.slice(0, historyIndex + 1);
    past.push(cloneHistoryEntry(nodes, edges));
    if (past.length > MAX_HISTORY) past.shift();
    set({ history: past, historyIndex: past.length - 1, historyFuture: [] });
  },

  undo: () => {
    // history[historyIndex] 是「上一次变更前」的快照，当前画布不在 history 里
    const { history, historyIndex, historyFuture, nodes, edges } = get();
    if (historyIndex < 0) return;
    const entry = history[historyIndex];
    if (!entry) return;
    const restored = cloneHistoryEntry(entry.nodes, entry.edges);
    set({
      nodes: restored.nodes,
      edges: restored.edges,
      connectedNodeIds: buildConnectedNodeIds(restored.edges),
      historyIndex: historyIndex - 1,
      historyFuture: [cloneHistoryEntry(nodes, edges), ...historyFuture],
      selectedNodeId: null,
      selectedFlowIds: [],
    });
    get().scheduleAutoSave();
  },

  redo: () => {
    const { history, historyIndex, historyFuture, nodes, edges } = get();
    const next = historyFuture[0];
    if (!next) return;
    const restored = cloneHistoryEntry(next.nodes, next.edges);
    const past = history.slice(0, historyIndex + 1);
    past.push(cloneHistoryEntry(nodes, edges));
    if (past.length > MAX_HISTORY) past.shift();
    set({
      nodes: restored.nodes,
      edges: restored.edges,
      connectedNodeIds: buildConnectedNodeIds(restored.edges),
      history: past,
      historyIndex: past.length - 1,
      historyFuture: historyFuture.slice(1),
      selectedNodeId: null,
      selectedFlowIds: [],
    });
    get().scheduleAutoSave();
  },

  initProject: async (projectId) => {
    if (!projectId) {
      set({ isLoading: false, loadError: "无效的项目 ID" });
      return;
    }
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    // 使进行中的保存回写失效，避免旧项目 workflowId 污染新项目
    workflowSaveEpoch += 1;
    const reqId = ++initRequestId;
    const cached = readWorkflowCache(projectId);
    const cachedWorkflow = cached?.flowJson ? hydrateWorkflowFromJson(cached.flowJson) : null;

    set({
      projectId,
      projectNo: cached?.projectNo ?? "",
      projectName: cached?.projectName ?? "\u672a\u547d\u540d\u9879\u76ee",
      projectRole: null,
      ownerDisplayName: "",
      workflowId: cached?.workflowId ?? null,
      workflowRevision: cached?.workflowRevision ?? 1,
      nodes: cachedWorkflow?.nodes ?? [],
      edges: cachedWorkflow?.edges ?? [],
      connectedNodeIds: buildConnectedNodeIds(cachedWorkflow?.edges ?? []),
      selectedNodeId: null,
      multiAngleNodeId: null,
      lightingNodeId: null,
      storyboardSheetKind: null,
      storyboardSheetNodeId: null,
      framePickNodeId: null,
      framePickTimeSec: 0,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      history: [],
      historyIndex: -1,
      historyFuture: [],
      isLoading: true,
      loadError: null,
      syncConflict: null,
    });

    const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s）`)), ms)
        ),
      ]);

    const INIT_TIMEOUT_MS = 30_000;

    try {
      const [{ getProject }, { getLatestWorkflow, listWorkflows }] = await Promise.all([
        import("@/lib/api/projects"),
        import("@/lib/api/workflows"),
      ]);
      const [project, latestWorkflow] = await withTimeout(
        Promise.all([
          getProject(projectId),
          getLatestWorkflow(projectId).catch(() => null),
        ]),
        INIT_TIMEOUT_MS,
        "加载项目"
      );
      let workflow = latestWorkflow;
      if (!workflow) {
        const list = await withTimeout(
          listWorkflows(projectId).catch(() => []),
          INIT_TIMEOUT_MS,
          "加载工作流列表"
        );
        workflow = list[0] ?? null;
      }
      if (reqId !== initRequestId) return;
      const projectNo = project.projectNo || "";
      const projectName = project.title || "\u672a\u547d\u540d\u9879\u76ee";
      const projectRole = project.role ?? "owner";
      const ownerDisplayName = project.ownerDisplayName ?? "";
      if (projectRole === "editor") {
        const { recordProjectAccess } = await import("@/lib/api/projects");
        void recordProjectAccess(projectId).catch(() => {});
      }
      if (workflow?.flowJson) {
        const hydrated = hydrateWorkflowFromJson(workflow.flowJson);
        if (hydrated) {
          set({
            projectNo,
            projectName,
            projectRole,
            ownerDisplayName,
            workflowId: workflow.id,
            workflowRevision: workflow.revision ?? 1,
            nodes: hydrated.nodes,
            edges: hydrated.edges,
            connectedNodeIds: buildConnectedNodeIds(hydrated.edges),
            isLoading: false,
            loadError: null,
          });
          persistWorkflowCacheFromState(get());
        } else {
          set({
            projectNo,
            projectName,
            projectRole,
            ownerDisplayName,
            workflowId: workflow.id,
            workflowRevision: workflow.revision ?? 1,
            isLoading: false,
            loadError: null,
          });
        }
      } else {
        set({ projectNo, projectName, projectRole, ownerDisplayName, workflowId: null, workflowRevision: 1, isLoading: false, loadError: null });
      }
    } catch (err) {
      if (reqId !== initRequestId) return;
      const detail = err instanceof Error ? err.message : "";
      const { ApiError } = await import("@/lib/api/client");
      const isAccessDenied =
        err instanceof ApiError && (err.status === 404 || err.status === 403);
      const msg = isAccessDenied
        ? "项目不存在或您没有访问权限"
        : detail.includes("超时")
          ? `${detail}，请确认本机画布已启动`
          : "\u52a0\u8f7d\u9879\u76ee\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5";
      if (!cachedWorkflow) {
        set({ workflowId: null, isLoading: false, loadError: msg });
        toast.error(msg);
      } else {
        set({ isLoading: false, loadError: null });
        toast.error(`${msg}（已显示本地缓存画布）`);
      }
    } finally {
      if (reqId === initRequestId) {
        set({ isLoading: false });
      }
    }
  },

  addNode: (type, position, opts) => {
    const def = NODE_REGISTRY[type];
    if (!def) {
      // 菜单已展示但注册表缺失时勿静默失败（HMR / 旧包常见）
      toast.error(`无法添加节点：未注册类型「${type}」`);
      return;
    }
    get().pushHistory();
    // Agent 投影可指定稳定 id（= tempId），便于连线与续聊引用
    const requested = (opts?.id || "").trim();
    const exists = requested
      ? get().nodes.some((n) => n.id === requested)
      : false;
    const nodeId = requested && !exists ? requested : genId(type);
    const defaults: Record<string, unknown> = {};
    def.params.forEach((p) => { defaults[p.key] = p.default; });
    // 一键出海：布尔参数勿落成空字符串，否则 Boolean("…") 易误判
    if (type === "overseas_localize") {
      defaults.tipDismissed = false;
      defaults.tipIndex = 0;
    }
    if (isEditorNodeType(type)) {
      const category = getNodeModelCategory(type);
      const lastModel = category ? getLastSelectedModel(category) : null;
      if (lastModel) defaults.model = lastModel;
    }
    if (type === "storyboard_grid") defaults.shots = [];
    const size =
      def.defaultWidth && def.defaultHeight
        ? { width: def.defaultWidth, height: def.defaultHeight }
        : defaultNodeSize();
    const label =
      (opts?.label || "").trim() || nextNodeLabel(type, get().nodes);
    const unbounded =
      type === "storyboard_grid" ||
      type === "finished_clips_grid" ||
      type === "overseas_localize" ||
      type === "node_group";
    set((state) => ({
      nodes: [...state.nodes, {
        id: nodeId, type, position, width: size.width, height: size.height,
        // onlyRenderVisibleElements 依赖宽高；style 与 width/height 双写，避免首帧被裁掉
        ...(unbounded ? { style: { width: size.width, height: size.height } } : {}),
        data: { label, params: defaults, inputs: def.inputs, outputs: def.outputs, status: "idle" as NodeStatus },
      } as AppNode],
      selectedNodeId: nodeId,
      selectedFlowIds: [nodeId],
    }));
    get().scheduleAutoSave();
  },

  addNodeFromAsset: (asset, position) => {
    const type = nodeTypeForAssetCategory(asset.category);
    const def = NODE_REGISTRY[type];
    if (!def) return;
    get().pushHistory();
    const nodeId = genId(type);
    const urlKey = urlParamForAssetCategory(asset.category);
    const defaults: Record<string, unknown> = {};
    def.params.forEach((p) => { defaults[p.key] = p.default; });
    if (isEditorNodeType(type)) {
      const category = getNodeModelCategory(type);
      const lastModel = category ? getLastSelectedModel(category) : null;
      if (lastModel) defaults.model = lastModel;
    }
    defaults.assetId = asset.id;
    if (asset.fileUrl && isSignedOssUrl(asset.fileUrl)) {
      defaults[urlKey] = ensureHttpsOssUrl(asset.fileUrl);
    } else if (asset.fileUrl && type === "document_input") {
      // 文档签名模式外也写入 fileUrl，便于立即展示
      defaults[urlKey] = asset.fileUrl;
    }
    if (type === "document_input") {
      defaults.resourceKind = "file";
      defaults.fileName = asset.title?.trim() || "文档";
      defaults.linkUrl = "";
    }
    const { width, height } = defaultNodeSize();
    const nodes = get().nodes;
    const label =
      asset.title?.trim() && asset.title.trim() !== def.label
        ? asset.title.trim()
        : nextNodeLabel(type, nodes);
    set((state) => ({
      nodes: [...state.nodes, {
        id: nodeId, type, position, width, height,
        data: {
          label,
          params: defaults,
          inputs: def.inputs,
          outputs: def.outputs,
          status: "idle" as NodeStatus,
        },
      } as AppNode],
      selectedNodeId: nodeId,
    }));
    get().scheduleAutoSave();
  },

  // 平台素材库：落锁定参考节点（无生成弹窗，仅作上游参考）
  addNodeFromLibraryItem: (item, position) => {
    const type = libraryNodeTypeForItem(item);
    const def = NODE_REGISTRY[type];
    if (!def) {
      toast.error(`无法添加节点：未注册类型「${type}」`);
      return;
    }
    get().pushHistory();
    const nodeId = genId(type);
    const defaults: Record<string, unknown> = {};
    def.params.forEach((p) => {
      defaults[p.key] = p.default;
    });
    Object.assign(defaults, buildLibraryNodeParams(item));
    const { width, height } = defaultNodeSize();
    const label = (item.title || "").trim() || nextNodeLabel(type, get().nodes);
    const projectId = get().projectId;
    const promptBody = String(defaults.content || "").trim();
    set((state) => ({
      nodes: [
        ...state.nodes,
        {
          id: nodeId,
          type,
          position,
          width,
          height,
          data: {
            label,
            params: defaults,
            inputs: def.inputs,
            outputs: def.outputs,
            status: "idle" as NodeStatus,
          },
        } as AppNode,
      ],
      selectedNodeId: nodeId,
      selectedFlowIds: [nodeId],
    }));
    get().scheduleAutoSave();
    // 提示词库：正文同步写入节点文本 OSS，供连线引用；失败时仍保留 params
    if (type === "text_input" && projectId && promptBody) {
      const model = String(defaults.model || "doubao_pro");
      void import("@/lib/api/nodeText")
        .then(({ saveNodeText }) => saveNodeText(projectId, nodeId, promptBody, model))
        .catch(() => {});
    }
  },

  connectNodes: (connection) => {
    const { source, target } = connection;
    if (!source || !target || source === target) return;
    const state = get();
    if (state.edges.some((e) => e.source === source && e.target === target && e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle)) {
      return;
    }
    const sourceNode = state.nodes.find((n) => n.id === source);
    const targetNode = state.nodes.find((n) => n.id === target);
    const libraryErr = validateLibraryConnection(sourceNode, targetNode);
    if (libraryErr) {
      toast.error(libraryErr);
      return;
    }
    get().pushHistory();
    // 连线颜色跟随终点节点卡片色
    const hexColor = targetNode
      ? NODE_REGISTRY[targetNode.type || ""]?.color || "#8b5cf6"
      : "#8b5cf6";
    const edgeColor = hexToRgba(hexColor, 0.72);
    set((s) => {
      const edges = addEdge(
        {
          ...connection,
          style: { stroke: edgeColor, strokeWidth: 2 },
          data: { connectFlash: true, connectFlashAt: Date.now() },
        } as Connection,
        s.edges
      );
      return { edges, connectedNodeIds: buildConnectedNodeIds(edges) };
    });
    get().scheduleAutoSave();
  },

  removeSelectedNodes: () => {
    const {
      selectedNodeId,
      multiAngleNodeId,
      lightingNodeId,
      storyboardSheetNodeId,
      framePickNodeId,
      inlineVideoTrim,
      inlineVideoCrop,
      nodes,
      edges,
    } = get();
    if (!selectedNodeId) return;
    // 删组框：走 ungroup 语义（保留成员）
    if (isGroupNode(nodes.find((n) => n.id === selectedNodeId))) {
      get().ungroupNode(selectedNodeId);
      return;
    }
    get().pushHistory();
    const removed = nodes.find((n) => n.id === selectedNodeId);
    const parentGroupId = removed?.parentId;
    const nextNodes = nodes.filter((n) => n.id !== selectedNodeId).map((n) => {
      if (!isGroupNode(n)) return n;
      const prev = Array.isArray(n.data.memberIds) ? (n.data.memberIds as string[]) : [];
      if (!prev.includes(selectedNodeId)) return n;
      return { ...n, data: { ...n.data, memberIds: prev.filter((id) => id !== selectedNodeId) } };
    });
    const clearSheetHost = storyboardSheetNodeId === selectedNodeId;
    set({
      nodes: nextNodes,
      edges: edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId),
      connectedNodeIds: buildConnectedNodeIds(edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)),
      selectedNodeId: null,
      multiAngleNodeId: multiAngleNodeId === selectedNodeId ? null : multiAngleNodeId,
      lightingNodeId: lightingNodeId === selectedNodeId ? null : lightingNodeId,
      storyboardSheetNodeId: clearSheetHost ? null : storyboardSheetNodeId,
      ...(clearSheetHost ? { storyboardSheetKind: null } : {}),
      framePickNodeId: framePickNodeId === selectedNodeId ? null : framePickNodeId,
      inlineVideoTrim: inlineVideoTrim?.nodeId === selectedNodeId ? null : inlineVideoTrim,
      inlineVideoCrop: inlineVideoCrop?.nodeId === selectedNodeId ? null : inlineVideoCrop,
    });
    // 删成员后收缩组框
    if (parentGroupId) get().refreshGroupBounds(parentGroupId);
    get().scheduleAutoSave();
  },

  onNodesChange: (changes) => {
    const removedIds = changes.filter((c) => c.type === "remove").map((c) => c.id);
    const stateBefore = get().nodes;
    // Delete 键删组框：走 ungroup（支持嵌套坐标），不再走 RF remove
    const groupRemoveIds = removedIds.filter((id) =>
      isGroupNode(stateBefore.find((n) => n.id === id))
    );
    const groupRemoveSet = new Set(groupRemoveIds);
    const effectiveChanges = changes.filter(
      (c) => !(c.type === "remove" && groupRemoveSet.has(c.id))
    );

    if (groupRemoveIds.length > 0 || removedIds.some((id) => !groupRemoveSet.has(id))) {
      get().pushHistory();
    }
    // 多组同时删：先解最内层
    const depthOf = (id: string) => {
      let d = 0;
      let pid = stateBefore.find((n) => n.id === id)?.parentId;
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        d += 1;
        pid = stateBefore.find((n) => n.id === pid)?.parentId;
      }
      return d;
    };
    const orderedGroupRemoves = [...groupRemoveIds].sort((a, b) => depthOf(b) - depthOf(a));
    for (const gid of orderedGroupRemoves) {
      if (!isGroupNode(get().nodes.find((n) => n.id === gid))) continue;
      get().ungroupNode(gid, { silent: true });
    }

    if (effectiveChanges.length === 0) {
      if (groupRemoveIds.length > 0) get().scheduleAutoSave();
      return;
    }

    // 成员删除前记下所属组，便于事后刷新 AABB
    const parentsToRefresh = new Set<string>();
    for (const id of removedIds) {
      if (groupRemoveSet.has(id)) continue;
      const n = stateBefore.find((x) => x.id === id);
      if (n?.parentId) parentsToRefresh.add(n.parentId);
    }

    set((state) => {
      let nodes = applyNodeChanges(effectiveChanges, state.nodes) as AppNode[];
      // 始终保证父在子前，避免拖动后顺序被打乱导致子流失效
      if (nodes.some((n) => n.parentId)) {
        nodes = sortNodesParentsFirst(nodes);
      }

      const memberRemoved = removedIds.filter((id) => !groupRemoveSet.has(id));
      if (memberRemoved.length === 0) {
        return { nodes };
      }

      const removedSet = new Set(memberRemoved);
      nodes = nodes.map((n) => {
        if (!isGroupNode(n)) return n;
        const prev = Array.isArray(n.data.memberIds) ? (n.data.memberIds as string[]) : [];
        const next = prev.filter((mid) => !removedSet.has(mid) && nodes.some((x) => x.id === mid));
        if (next.length === prev.length) return n;
        return { ...n, data: { ...n.data, memberIds: next } };
      });

      const edges = state.edges.filter(
        (e) => !removedSet.has(e.source) && !removedSet.has(e.target)
      );
      return {
        nodes,
        edges,
        connectedNodeIds: buildConnectedNodeIds(edges),
        selectedNodeId:
          state.selectedNodeId && removedSet.has(state.selectedNodeId)
            ? null
            : state.selectedNodeId,
        multiAngleNodeId:
          state.multiAngleNodeId && removedSet.has(state.multiAngleNodeId)
            ? null
            : state.multiAngleNodeId,
        lightingNodeId:
          state.lightingNodeId && removedSet.has(state.lightingNodeId)
            ? null
            : state.lightingNodeId,
        storyboardSheetNodeId:
          state.storyboardSheetNodeId && removedSet.has(state.storyboardSheetNodeId)
            ? null
            : state.storyboardSheetNodeId,
        storyboardSheetKind:
          state.storyboardSheetNodeId && removedSet.has(state.storyboardSheetNodeId)
            ? null
            : state.storyboardSheetKind,
        framePickNodeId:
          state.framePickNodeId && removedSet.has(state.framePickNodeId)
            ? null
            : state.framePickNodeId,
        inlineVideoTrim:
          state.inlineVideoTrim && removedSet.has(state.inlineVideoTrim.nodeId)
            ? null
            : state.inlineVideoTrim,
        inlineVideoCrop:
          state.inlineVideoCrop && removedSet.has(state.inlineVideoCrop.nodeId)
            ? null
            : state.inlineVideoCrop,
      };
    });

    for (const gid of parentsToRefresh) {
      get().refreshGroupBounds(gid);
    }
    if (shouldAutoSaveNodeChanges(effectiveChanges) || groupRemoveIds.length > 0) {
      get().scheduleAutoSave();
    }
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === "remove")) get().pushHistory();
    set((state) => {
      const edges = applyEdgeChanges(changes, state.edges);
      return { edges, connectedNodeIds: buildConnectedNodeIds(edges) };
    });
    get().scheduleAutoSave();
  },
  onConnect: (connection) => {
    const sourceNode = get().nodes.find(function(n) { return n.id === connection.source; });
    const targetNode = get().nodes.find(function(n) { return n.id === connection.target; });
    const libraryErr = validateLibraryConnection(sourceNode, targetNode);
    if (libraryErr) {
      toast.error(libraryErr);
      return;
    }
    get().pushHistory();
    // 连线颜色跟随终点节点卡片色
    const hexColor = targetNode
      ? NODE_REGISTRY[targetNode.type || ""]?.color || "#8b5cf6"
      : "#8b5cf6";
    const edgeColor = hexToRgba(hexColor, 0.72);
    // 新建边打上 connectFlashAt，边组件播一次短闪后自清
    set((state) => {
      const edges = addEdge(
        {
          ...connection,
          style: { stroke: edgeColor, strokeWidth: 2 },
          data: { connectFlash: true, connectFlashAt: Date.now() },
        },
        state.edges
      );
      return { edges, connectedNodeIds: buildConnectedNodeIds(edges) };
    });
    get().scheduleAutoSave();
  },

  selectNode: (id) => {
    const {
      multiAngleNodeId,
      lightingNodeId,
      framePickNodeId,
      drawingBoardNodeId,
      inlineVideoTrim,
      inlineVideoCrop,
      selectedNodeId,
    } = get();
    const trimNodeId = inlineVideoTrim?.nodeId ?? null;
    const cropNodeId = inlineVideoCrop?.nodeId ?? null;
    // 单选：同步 selectedFlowIds；清空单选焦点时不碰多选列表
    // （框选常会连带选中边 → onSelectionChange 里 selectNode(null)，若此处清空会导致 Header「运行」读不到选中）
    if (id) {
      const switchingNode = id !== selectedNodeId;
      if (
        id !== multiAngleNodeId &&
        id !== lightingNodeId &&
        id !== framePickNodeId &&
        id !== drawingBoardNodeId &&
        id !== trimNodeId &&
        id !== cropNodeId
      ) {
        set((state) => ({
          selectedNodeId: id,
          selectedFlowIds: [id],
          multiAngleNodeId: null,
          lightingNodeId: null,
          framePickNodeId: null,
          inlineVideoTrim: null,
          inlineVideoCrop: null,
          drawingBoardNodeId: null,
          drawingBoardIntent: null,
          ...(switchingNode
            ? {
                inlineImageDrawTool: null,
                inlineImageEraseMode: false,
                inlineImageEraseParams: null,
                inlineImageTransform: null,
                inlineImageOutpaint: null,
                inlineImageCrop: null,
                // 切换节点时恢复旋转预览放大的卡片
                nodes: restoreTransformBaseSize(
                  state.nodes,
                  state.selectedNodeId,
                  state.inlineImageTransform
                ),
              }
            : {}),
        }));
      } else {
        set((state) => ({
          selectedNodeId: id,
          selectedFlowIds: [id],
          ...(switchingNode
            ? {
                inlineImageDrawTool: null,
                inlineImageEraseMode: false,
                inlineImageEraseParams: null,
                inlineImageTransform: null,
                inlineImageOutpaint: null,
                inlineImageCrop: null,
                nodes: restoreTransformBaseSize(
                  state.nodes,
                  state.selectedNodeId,
                  state.inlineImageTransform
                ),
              }
            : {}),
        }));
      }
      return;
    }
    if (
      id !== multiAngleNodeId &&
      id !== lightingNodeId &&
      id !== framePickNodeId &&
      id !== drawingBoardNodeId &&
      id !== trimNodeId &&
      id !== cropNodeId
    ) {
      set((state) => ({
        selectedNodeId: null,
        multiAngleNodeId: null,
        lightingNodeId: null,
        framePickNodeId: null,
        inlineVideoTrim: null,
        inlineVideoCrop: null,
        drawingBoardNodeId: null,
        drawingBoardIntent: null,
        inlineImageDrawTool: null,
        inlineImageEraseMode: false,
        inlineImageEraseParams: null,
        inlineImageTransform: null,
        inlineImageOutpaint: null,
        inlineImageCrop: null,
        nodes: restoreTransformBaseSize(
          state.nodes,
          state.selectedNodeId,
          state.inlineImageTransform
        ),
      }));
    } else {
      set((state) => ({
        selectedNodeId: null,
        inlineImageDrawTool: null,
        inlineImageEraseMode: false,
        inlineImageEraseParams: null,
        inlineImageTransform: null,
        inlineImageOutpaint: null,
        inlineImageCrop: null,
        nodes: restoreTransformBaseSize(
          state.nodes,
          state.selectedNodeId,
          state.inlineImageTransform
        ),
      }));
    }
  },
  setInlineImageDrawTool: (tool) =>
    set((state) => ({
      inlineImageDrawTool: tool,
      // 进入标注/擦除笔迹时关闭旋转 / 扩图 / 裁剪
      ...(tool
        ? {
            inlineImageTransform: null,
            inlineImageOutpaint: null,
            inlineImageCrop: null,
            nodes: restoreTransformBaseSize(
              state.nodes,
              state.selectedNodeId,
              state.inlineImageTransform
            ),
          }
        : {}),
    })),
  setInlineImageDrawColor: (color) => set({ inlineImageDrawColor: color }),
  setInlineImageDrawSize: (size) => set({ inlineImageDrawSize: Math.max(2, Math.min(80, size)) }),
  clearInlineImageDrawTool: () =>
    set({ inlineImageDrawTool: null, inlineImageEraseMode: false, inlineImageEraseParams: null }),
  openInlineImageErase: () =>
    set((state) => ({
      inlineImageEraseMode: true,
      inlineImageEraseParams: { ...DEFAULT_IMAGE_GEN_PARAMS },
      inlineImageDrawTool: "brush",
      inlineImageDrawColor: "#000000",
      inlineImageDrawSize: 24,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      nodes: restoreTransformBaseSize(
        state.nodes,
        state.selectedNodeId,
        state.inlineImageTransform
      ),
    })),
  closeInlineImageErase: () =>
    set({
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageDrawTool: null,
    }),
  patchInlineImageEraseParams: (patch) =>
    set((state) => {
      const current = state.inlineImageEraseParams ?? DEFAULT_IMAGE_GEN_PARAMS;
      return {
        inlineImageEraseParams: {
          ...current,
          ...patch,
        },
      };
    }),
  openInlineImageTransform: () =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === state.selectedNodeId);
      const baseWidth =
        node?.width && node.width > 0 ? Math.round(node.width) : DEFAULT_NODE_WIDTH;
      const totalH =
        node?.height && node.height > 0
          ? Math.round(node.height)
          : totalHeightFromWidth(baseWidth);
      const baseBodyHeight = Math.max(MIN_BODY_HEIGHT, totalH - NODE_TITLE_HEIGHT);
      return {
        inlineImageTransform: {
          ...DEFAULT_INLINE_IMAGE_TRANSFORM,
          baseWidth,
          baseBodyHeight,
        },
        inlineImageDrawTool: null,
        inlineImageEraseMode: false,
        inlineImageEraseParams: null,
        inlineImageOutpaint: null,
        inlineImageCrop: null,
      };
    }),
  closeInlineImageTransform: (opts) =>
    set((state) => {
      const restore = opts?.restoreBaseSize !== false;
      return {
        inlineImageTransform: null,
        nodes: restore
          ? restoreTransformBaseSize(
              state.nodes,
              state.selectedNodeId,
              state.inlineImageTransform
            )
          : state.nodes,
      };
    }),
  rotateInlineImageTransform90: () =>
    set((state) => {
      const current = state.inlineImageTransform ?? {
        ...DEFAULT_INLINE_IMAGE_TRANSFORM,
      };
      const next: InlineImageTransformState = {
        ...current,
        rotation: nextRotation90(current.rotation),
      };
      return {
        inlineImageTransform: next,
        nodes: resizeNodeForImageTransform(state.nodes, state.selectedNodeId, next),
      };
    }),
  setInlineImageTransformRotation: (deg) =>
    set((state) => {
      const current = state.inlineImageTransform ?? {
        ...DEFAULT_INLINE_IMAGE_TRANSFORM,
      };
      const next: InlineImageTransformState = {
        ...current,
        rotation: normalizeRotation(deg),
      };
      return {
        inlineImageTransform: next,
        nodes: resizeNodeForImageTransform(state.nodes, state.selectedNodeId, next),
      };
    }),
  toggleInlineImageTransformFlipH: () =>
    set((state) => {
      const current = state.inlineImageTransform ?? {
        ...DEFAULT_INLINE_IMAGE_TRANSFORM,
      };
      return {
        inlineImageTransform: {
          ...current,
          flipH: !current.flipH,
        },
      };
    }),
  toggleInlineImageTransformFlipV: () =>
    set((state) => {
      const current = state.inlineImageTransform ?? {
        ...DEFAULT_INLINE_IMAGE_TRANSFORM,
      };
      return {
        inlineImageTransform: {
          ...current,
          flipV: !current.flipV,
        },
      };
    }),
  openInlineImageOutpaint: () =>
    set((state) => ({
      inlineImageOutpaint: { ...DEFAULT_INLINE_IMAGE_OUTPAINT },
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageCrop: null,
      nodes: restoreTransformBaseSize(
        state.nodes,
        state.selectedNodeId,
        state.inlineImageTransform
      ),
    })),
  closeInlineImageOutpaint: () => set({ inlineImageOutpaint: null }),
  patchInlineImageOutpaint: (patch) =>
    set((state) => {
      const current = state.inlineImageOutpaint ?? DEFAULT_INLINE_IMAGE_OUTPAINT;
      return {
        inlineImageOutpaint: {
          ...current,
          ...patch,
          // 保证 margins 完整
          margins: {
            ...current.margins,
            ...(patch.margins ?? {}),
          },
        },
      };
    }),
  openInlineImageCrop: () =>
    set((state) => ({
      inlineImageCrop: {
        ...DEFAULT_INLINE_IMAGE_CROP,
        rect: { ...DEFAULT_INLINE_IMAGE_CROP.rect },
      },
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      nodes: restoreTransformBaseSize(
        state.nodes,
        state.selectedNodeId,
        state.inlineImageTransform
      ),
    })),
  closeInlineImageCrop: () => set({ inlineImageCrop: null }),
  patchInlineImageCrop: (patch) =>
    set((state) => {
      const current = state.inlineImageCrop ?? DEFAULT_INLINE_IMAGE_CROP;
      return {
        inlineImageCrop: {
          ...current,
          ...patch,
          rect: {
            ...current.rect,
            ...(patch.rect ?? {}),
          },
        },
      };
    }),
  openMultiAngle: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      multiAngleNodeId: nodeId,
      lightingNodeId: null,
      storyboardSheetKind: null,
      storyboardSheetNodeId: null,
      framePickNodeId: null,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
    }),
  closeMultiAngle: () => set({ multiAngleNodeId: null }),
  openLighting: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      lightingNodeId: nodeId,
      multiAngleNodeId: null,
      storyboardSheetKind: null,
      storyboardSheetNodeId: null,
      framePickNodeId: null,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
    }),
  closeLighting: () => set({ lightingNodeId: null }),
  // 故事板/调度故事板：打开底部浮动合成图输入条
  openStoryboardSheet: (kind, nodeId) =>
    set({
      storyboardSheetKind: kind,
      storyboardSheetNodeId: nodeId ?? null,
      multiAngleNodeId: null,
      lightingNodeId: null,
      framePickNodeId: null,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      ...(nodeId ? { selectedNodeId: nodeId } : {}),
    }),
  closeStoryboardSheet: () =>
    set({ storyboardSheetKind: null, storyboardSheetNodeId: null }),
  setStoryboardSheetNodeId: (nodeId) => set({ storyboardSheetNodeId: nodeId }),
  openFramePick: (nodeId, initialTimeSec) =>
    set({
      selectedNodeId: nodeId,
      framePickNodeId: nodeId,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      multiAngleNodeId: null,
      lightingNodeId: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      framePickTimeSec: typeof initialTimeSec === "number" ? initialTimeSec : 0,
    }),
  closeFramePick: () => set({ framePickNodeId: null }),
  setFramePickTime: (timeSec) => set({ framePickTimeSec: timeSec }),
  /** 进入视频剪辑：关闭选帧等互斥模式，默认入点 0、出点为片长（未知时待控件回填） */
  openInlineVideoTrim: (nodeId, durationSec) => {
    const dur = typeof durationSec === "number" && durationSec > MIN_VIDEO_TRIM_SEC ? durationSec : 0;
    const range = clampTrimRange(0, dur > 0 ? dur : MIN_VIDEO_TRIM_SEC, dur);
    set({
      selectedNodeId: nodeId,
      inlineVideoTrim: { nodeId, inSec: range.inSec, outSec: range.outSec },
      inlineVideoCrop: null,
      framePickNodeId: null,
      multiAngleNodeId: null,
      lightingNodeId: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      generationOptionsExpanded: false,
    });
  },
  closeInlineVideoTrim: () => set({ inlineVideoTrim: null }),
  patchInlineVideoTrim: (patch) =>
    set((state) => {
      if (!state.inlineVideoTrim) return state;
      const nextIn = patch.inSec ?? state.inlineVideoTrim.inSec;
      const nextOut = patch.outSec ?? state.inlineVideoTrim.outSec;
      return {
        inlineVideoTrim: {
          ...state.inlineVideoTrim,
          inSec: nextIn,
          outSec: nextOut,
        },
      };
    }),
  /** 进入视频空间裁剪 / 框选去字幕：与剪辑/选帧互斥 */
  openInlineVideoCrop: (nodeId, purpose = "crop") =>
    set({
      selectedNodeId: nodeId,
      inlineVideoCrop: {
        nodeId,
        aspectRatio: DEFAULT_INLINE_VIDEO_CROP.aspectRatio,
        rect: { ...DEFAULT_INLINE_VIDEO_CROP.rect },
        purpose,
      },
      inlineVideoTrim: null,
      framePickNodeId: null,
      multiAngleNodeId: null,
      lightingNodeId: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      generationOptionsExpanded: false,
    }),
  closeInlineVideoCrop: () => set({ inlineVideoCrop: null }),
  patchInlineVideoCrop: (patch) =>
    set((state) => {
      if (!state.inlineVideoCrop) return state;
      return {
        inlineVideoCrop: {
          ...state.inlineVideoCrop,
          ...patch,
          rect: {
            ...state.inlineVideoCrop.rect,
            ...(patch.rect ?? {}),
          },
        },
      };
    }),
  openDrawingBoard: (nodeId, intent = "draw") =>
    set({
      selectedNodeId: nodeId,
      drawingBoardNodeId: nodeId,
      drawingBoardIntent: intent,
      multiAngleNodeId: null,
      lightingNodeId: null,
      framePickNodeId: null,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      inlineImageDrawTool: null,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
    }),
  closeDrawingBoard: () => set({ drawingBoardNodeId: null, drawingBoardIntent: null }),
  setGenerationOptionsExpanded: (open) => set({ generationOptionsExpanded: open }),
  requestCloseTopMenus: () => set((s) => ({ topMenuCloseSeq: s.topMenuCloseSeq + 1 })),
  selectAllNodes: () => { const { nodes } = get(); set({ selectedNodeId: nodes.length > 0 ? nodes[0].id : null }); },

  updateNodeData: (id, data) => {
    set((state) => ({ nodes: state.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)) }));
    get().scheduleAutoSave();
  },
  updateNodeParam: (id, key, value) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, params: { ...(n.data.params ?? {}), [key]: value } } }
          : n
      ),
    }));
    if (paramChangeNeedsSave(key)) get().scheduleAutoSave();
  },
  applyNodeGeneratedMedia: (id, urlParamKey, mediaUrl, assetId) => {
    set((state) => ({
      nodeExecutionStatus: { ...state.nodeExecutionStatus, [id]: "success" },
      nodes: state.nodes.map((n) => {
        if (n.id !== id) return n;
        const params: Record<string, unknown> = { ...(n.data.params ?? {}) };
        // 有 assetId 时仍保留预览 URL，避免 manifest 未刷新前节点空白
        if (assetId) {
          params.assetId = assetId;
          if (mediaUrl) params[urlParamKey] = mediaUrl;
          else delete params[urlParamKey];
        } else if (mediaUrl) {
          params[urlParamKey] = mediaUrl;
        }
        return {
          ...n,
          data: { ...n.data, params, status: "success" as NodeStatus },
        };
      }),
    }));
    get().scheduleAutoSave();
  },
  updateNodeSize: (id, width, height, unbounded = false) => {
    const size = unbounded ? resolveNodeSizeUnbounded(width, height) : resolveNodeSize(width, height);
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, width: size.width, height: size.height } : n)),
    }));
  },
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges, connectedNodeIds: buildConnectedNodeIds(edges) }),

  saveWorkflow: async (silent = false) => {
    const job = saveTail.then(() => performWorkflowSave(silent, get, set));
    saveTail = job.catch(() => {});
    return job;
  },
  loadWorkflow: (flowJson) => {
    try {
      const data = JSON.parse(flowJson);
      const nodes = data.nodes
        ? sortNodesParentsFirst(data.nodes.map(normalizeNode))
        : get().nodes;
      const edges = normalizeEdges(data.edges || [], nodes);
      if (data.nodes) set({ nodes, edges, connectedNodeIds: buildConnectedNodeIds(edges) });
      else if (edges.length) set({ edges, connectedNodeIds: buildConnectedNodeIds(edges) });
    } catch { /* ignore */ }
  },

  reloadWorkflowFromServer: async () => {
    const { projectId, isLoading } = get();
    if (isLoading || !projectId) return;
    const { getLatestWorkflow } = await import("@/lib/api/workflows");
    const latest = await getLatestWorkflow(projectId).catch(() => null);
    if (!latest?.flowJson) {
      toast.error("无法获取最新画布");
      return;
    }
    const hydrated = hydrateWorkflowFromJson(latest.flowJson);
    if (!hydrated) {
      toast.error("最新画布数据无效");
      return;
    }
    set({
      workflowId: latest.id,
      workflowRevision: latest.revision ?? 1,
      nodes: hydrated.nodes,
      edges: hydrated.edges,
      connectedNodeIds: buildConnectedNodeIds(hydrated.edges),
      syncConflict: null,
      history: [],
      historyIndex: -1,
      historyFuture: [],
      selectedNodeId: null,
    });
    persistWorkflowCacheFromState(get());
    toast.success("已同步最新画布");
  },

  dismissSyncConflict: () => set({ syncConflict: null }),

  scheduleAutoSave: () => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => get().saveWorkflow(true), AUTO_SAVE_DELAY);
  },

  flushAutoSave: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    const { projectId, isLoading } = get();
    if (!projectId || isLoading) return Promise.resolve();
    return get().saveWorkflow(true);
  },

  addTemplate: (tNodes, tEdges) => {
    get().pushHistory();
    const idMap: string[] = [];
    const oldToNew: Record<string, string> = {};
    const newNodes: AppNode[] = [];
    const workingNodes = [...get().nodes];
    for (const tn of tNodes) {
      const def = NODE_REGISTRY[tn.type];
      if (!def) continue;
      const nodeId = genId(tn.type);
      idMap.push(nodeId);
      const savedId = (tn as { id?: string }).id;
      if (savedId) oldToNew[savedId] = nodeId;
      const defaults: Record<string, unknown> = {};
      def.params.forEach((p) => { defaults[p.key] = p.default; });
      const { width, height } = defaultNodeSize();
      const label = nextNodeLabel(tn.type, workingNodes);
      const newNode = { id: nodeId, type: tn.type, position: tn.position, width, height, data: { label, params: defaults, inputs: def.inputs, outputs: def.outputs, status: "idle" as NodeStatus } } as AppNode;
      newNodes.push(newNode);
      workingNodes.push(newNode);
    }
    const newEdges: Edge[] = tEdges.map((te) => {
      const src: string | number = te.source as string | number;
      const tgt: string | number = te.target as string | number;
      const isStr = typeof src === "string";
      const srcIdx = isStr ? tNodes.findIndex(function(n: { type: string; id?: string }) { return n.id === String(src); }) : Number(src);
      const tgtIdx = isStr ? tNodes.findIndex(function(n: { type: string; id?: string }) { return n.id === String(tgt); }) : Number(tgt);
      const srcId = isStr ? (oldToNew[String(src)] || "") : idMap[Number(src)];
      const tgtId = isStr ? (oldToNew[String(tgt)] || "") : idMap[Number(tgt)];
      if (!srcId || !tgtId) return null;
      const tgtType = tNodes[tgtIdx]?.type || "";
      const hex = NODE_REGISTRY[tgtType]?.color || "#8b5cf6";
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return { id: `xy-edge__${srcId}-${tgtId}`, source: srcId, target: tgtId, sourceHandle: te.sourceHandle ?? undefined, targetHandle: te.targetHandle ?? undefined, style: { stroke: `rgba(${r},${g},${b},0.72)`, strokeWidth: 2 } };
    }).filter(function(e) { return e !== null; }) as Edge[];
    const allNodes = [...get().nodes, ...newNodes];
    const edges = normalizeEdges([...get().edges, ...newEdges], allNodes);
    set(() => ({ nodes: allNodes, edges, connectedNodeIds: buildConnectedNodeIds(edges) }));
    get().scheduleAutoSave();
  },

  createNodeGroup: (ids, label, opts) => {
    const state = get();
    const unique = [...new Set(ids)].filter(Boolean);
    const candidates = unique
      .map((id) => state.nodes.find((n) => n.id === id))
      .filter((n): n is AppNode => Boolean(n));
    if (candidates.length < 2) {
      toast.error("请至少选择 2 个节点再成组");
      return null;
    }
    for (const n of candidates) {
      if (GROUP_BLACKLIST.has(n.type || "")) {
        toast.error(`节点类型「${n.type}」不可入组`);
        return null;
      }
      // 已在其它组内：须先解组（嵌套时只能选顶层节点/组）
      if (n.parentId) {
        toast.error("已在组内的节点请先解组或拖出后再成组");
        return null;
      }
    }
    // 禁止把祖先与后代同时选入同一新组
    const idSet = new Set(unique);
    for (const n of candidates) {
      if (!isGroupNode(n)) continue;
      const nested = state.nodes.filter((c) => c.parentId === n.id);
      if (nested.some((c) => idSet.has(c.id))) {
        toast.error("请勿同时选中嵌套组与其内部成员");
        return null;
      }
    }
    const memberIds = candidates.map((n) => n.id);
    const aabb = computeMembersAabb(memberIds, state.nodes);
    if (!aabb) {
      toast.error("无法计算选区范围");
      return null;
    }
    const geom = aabbToGroupGeometry(aabb);
    const groupId = genId("node_group");
    const groupLabel = (label || "").trim() || "未命名组";
    if (!opts?.silent) get().pushHistory();

    const groupNode = {
      id: groupId,
      type: "node_group",
      position: geom.position,
      width: geom.width,
      height: geom.height,
      // React Flow 父节点尺寸需写入 style，子节点相对其左上角定位
      style: { width: geom.width, height: geom.height },
      // 仅标题条可拖整组，避免挡住成员
      dragHandle: ".node-group-drag-handle",
      zIndex: -1,
      data: {
        label: groupLabel,
        params: {},
        inputs: [],
        outputs: [],
        status: "idle" as NodeStatus,
        memberIds,
        locked: false,
        collapsed: false,
      },
    } as AppNode;

    const memberSet = new Set(memberIds);
    const nodes = state.nodes.map((n) => {
      if (!memberSet.has(n.id)) return n;
      const abs = getAbsolutePosition(n, state.nodes);
      return {
        ...n,
        parentId: groupId,
        position: {
          x: abs.x - geom.position.x,
          y: abs.y - geom.position.y,
        },
      };
    });

    // 父节点必须排在子节点之前，否则 React Flow 子流失效
    set({
      nodes: sortNodesParentsFirst([...nodes, groupNode]),
      selectedNodeId: groupId,
    });
    get().scheduleAutoSave();
    return groupId;
  },

  addGridSplitTileGroup: (tiles, groupLabel) => {
    if (tiles.length < 2) {
      toast.error("切分结果不足 2 块，无法成组");
      return null;
    }
    const def = NODE_REGISTRY.image_input;
    if (!def) return null;
    get().pushHistory();
    const nodeIds: string[] = [];
    const newNodes: AppNode[] = tiles.map((tile) => {
      const nodeId = genId("image_input");
      nodeIds.push(nodeId);
      // 宫格铺排需精确尺寸，勿套用 MIN_NODE_WIDTH 钳制，否则无法拼回原图
      const size = {
        width: Math.max(40, Math.round(tile.width)),
        height: Math.max(40, Math.round(tile.height)),
      };
      const defaults: Record<string, unknown> = {};
      def.params.forEach((p) => {
        defaults[p.key] = p.default;
      });
      defaults.assetId = tile.asset.id;
      if (tile.asset.fileUrl && isSignedOssUrl(tile.asset.fileUrl)) {
        defaults.imageUrl = ensureHttpsOssUrl(tile.asset.fileUrl);
      } else if (tile.asset.fileUrl) {
        defaults.imageUrl = tile.asset.fileUrl;
      }
      return {
        id: nodeId,
        type: "image_input",
        position: tile.position,
        width: size.width,
        height: size.height,
        data: {
          label: tile.asset.title?.trim() || nextNodeLabel("image_input", get().nodes),
          params: defaults,
          inputs: def.inputs,
          outputs: def.outputs,
          status: "idle" as NodeStatus,
        },
      } as AppNode;
    });

    set((state) => ({
      nodes: [...state.nodes, ...newNodes],
    }));

    const gid = get().createNodeGroup(nodeIds, groupLabel || "宫格切分", { silent: true });
    get().scheduleAutoSave();
    return gid;
  },

  ungroupNode: (groupId, opts) => {
    const state = get();
    const group = state.nodes.find((n) => n.id === groupId && isGroupNode(n));
    if (!group) return;
    if (!opts?.silent) get().pushHistory();
    const parentWorld = group.parentId
      ? (() => {
          const p = state.nodes.find((n) => n.id === group.parentId);
          return p ? getAbsolutePosition(p, state.nodes) : { x: 0, y: 0 };
        })()
      : { x: 0, y: 0 };
    const gw = getAbsolutePosition(group, state.nodes);
    const promotedIds = state.nodes
      .filter((c) => c.parentId === groupId)
      .map((c) => c.id);
    const nodes = state.nodes
      .filter((n) => n.id !== groupId)
      .map((n) => {
        if (n.parentId !== groupId) return n;
        const abs = { x: n.position.x + gw.x, y: n.position.y + gw.y };
        if (group.parentId) {
          return {
            ...n,
            parentId: group.parentId,
            position: {
              x: abs.x - parentWorld.x,
              y: abs.y - parentWorld.y,
            },
          };
        }
        return {
          ...n,
          parentId: undefined,
          position: abs,
        };
      })
      .map((n) => {
        // 嵌套解组：升格成员挂到外层组
        if (!isGroupNode(n) || n.id !== group.parentId) return n;
        const prev = Array.isArray(n.data.memberIds) ? (n.data.memberIds as string[]) : [];
        const next = [...new Set([...prev.filter((id) => id !== groupId), ...promotedIds])];
        return { ...n, data: { ...n.data, memberIds: next } };
      });
    set({
      nodes: sortNodesParentsFirst(nodes),
      selectedNodeId: state.selectedNodeId === groupId ? null : state.selectedNodeId,
    });
    if (group.parentId) get().refreshGroupBounds(group.parentId);
    get().scheduleAutoSave();
  },

  refreshGroupBounds: (groupId) => {
    const state = get();
    const group = state.nodes.find((n) => n.id === groupId && isGroupNode(n));
    if (!group) return;
    // 以 parentId 为准同步成员（不自动解组，即使只剩 0～1 个）
    const liveIds = state.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
    if (liveIds.length === 0) {
      set({
        nodes: state.nodes.map((n) =>
          n.id === groupId ? { ...n, data: { ...n.data, memberIds: [] } } : n
        ),
      });
      return;
    }

    // 世界坐标 AABB（支持嵌套组）
    const aabb = computeMembersAabb(liveIds, state.nodes);
    if (!aabb) return;
    const geom = aabbToGroupGeometry(aabb);
    const parentWorld = group.parentId
      ? (() => {
          const p = state.nodes.find((n) => n.id === group.parentId);
          return p ? getAbsolutePosition(p, state.nodes) : { x: 0, y: 0 };
        })()
      : { x: 0, y: 0 };
    const newGroupPos = {
      x: geom.position.x - parentWorld.x,
      y: geom.position.y - parentWorld.y,
    };

    const nodes = state.nodes.map((n) => {
      if (n.id === groupId) {
        return {
          ...n,
          position: newGroupPos,
          width: geom.width,
          height: geom.height,
          style: { ...(n.style as object | undefined), width: geom.width, height: geom.height },
          data: { ...n.data, memberIds: liveIds },
        };
      }
      if (n.parentId !== groupId) return n;
      const abs = getAbsolutePosition(n, state.nodes);
      return {
        ...n,
        position: {
          x: abs.x - geom.position.x,
          y: abs.y - geom.position.y,
        },
      };
    });
    set({ nodes: sortNodesParentsFirst(nodes) });
  },

  /** 拖拽结束：刷新所属组 AABB；嵌套组拖动时同时刷新外层 */
  reconcileGroupsAfterDrag: (draggedNodeId) => {
    const state = get();
    const dragged = draggedNodeId
      ? state.nodes.find((n) => n.id === draggedNodeId)
      : undefined;
    if (!dragged) {
      get().scheduleAutoSave();
      return;
    }
    // 被拖节点在组内（含嵌套组本身）→ 刷新其父组框
    if (dragged.parentId) {
      get().refreshGroupBounds(dragged.parentId);
    }
    get().scheduleAutoSave();
  },

  setGroupLocked: (groupId, locked) => {
    const state = get();
    const group = state.nodes.find((n) => n.id === groupId && isGroupNode(n));
    if (!group) return;
    get().pushHistory();
    const memberIds = Array.isArray(group.data.memberIds)
      ? (group.data.memberIds as string[])
      : state.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
    const memberSet = new Set(memberIds);
    const nodes = state.nodes.map((n) => {
      if (n.id === groupId) {
        return { ...n, data: { ...n.data, locked } };
      }
      // 锁定时禁止拖动直接成员（组框本身仍可整体拖动）
      if (memberSet.has(n.id)) {
        return { ...n, draggable: !locked };
      }
      return n;
    });
    set({ nodes });
    get().scheduleAutoSave();
  },

  setGroupCollapsed: (groupId, collapsed) => {
    const state = get();
    const group = state.nodes.find((n) => n.id === groupId && isGroupNode(n));
    if (!group) return;
    get().pushHistory();
    const memberIds = Array.isArray(group.data.memberIds)
      ? (group.data.memberIds as string[])
      : state.nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
    const memberSet = new Set(memberIds);

    let nodes: AppNode[];
    if (collapsed) {
      const expandedH = group.height || getNodeSize(group).height;
      nodes = state.nodes.map((n) => {
        if (n.id === groupId) {
          return {
            ...n,
            height: GROUP_COLLAPSED_HEIGHT,
            style: {
              ...(n.style as object | undefined),
              width: n.width,
              height: GROUP_COLLAPSED_HEIGHT,
            },
            data: {
              ...n.data,
              collapsed: true,
              expandedHeight: expandedH,
            },
          };
        }
        if (memberSet.has(n.id) || isDescendantOf(n, groupId, state.nodes)) {
          return { ...n, hidden: true };
        }
        return n;
      });
    } else {
      const restoreH =
        typeof group.data.expandedHeight === "number"
          ? group.data.expandedHeight
          : group.height || 300;
      nodes = state.nodes.map((n) => {
        if (n.id === groupId) {
          const { expandedHeight: _eh, ...rest } = n.data as WorkflowNodeData & {
            expandedHeight?: number;
          };
          return {
            ...n,
            height: restoreH,
            style: {
              ...(n.style as object | undefined),
              width: n.width,
              height: restoreH,
            },
            data: { ...rest, collapsed: false },
          };
        }
        if (memberSet.has(n.id) || isDescendantOf(n, groupId, state.nodes)) {
          return { ...n, hidden: false };
        }
        return n;
      });
      set({ nodes });
      get().refreshGroupBounds(groupId);
      get().scheduleAutoSave();
      return;
    }
    set({ nodes });
    get().scheduleAutoSave();
  },

  addGroupFromLibrary: (snapshot, dropPosition) => {
    if (!snapshot?.groupNode || !Array.isArray(snapshot.nodes)) {
      toast.error("组快照无效");
      return null;
    }
    get().pushHistory();
    const origin: XYPosition = dropPosition
      ? { ...dropPosition }
      : (() => {
          const vp = get().viewport;
          const pane = get().flowPaneSize;
          return {
            x: (-vp.x + pane.width / 2) / (vp.zoom || 1) - (snapshot.group.width || 400) / 2,
            y: (-vp.y + pane.height / 2) / (vp.zoom || 1) - (snapshot.group.height || 300) / 2,
          };
        })();

    const idMap: Record<string, string> = {};
    const groupTempId = snapshot.groupNode.tempId;
    const newGroupId = genId("node_group");
    idMap[groupTempId] = newGroupId;

    for (const sn of snapshot.nodes) {
      idMap[sn.tempId] = genId(sn.type || "node");
    }

    const groupW = snapshot.groupNode.width || snapshot.group.width || 400;
    const groupH = snapshot.groupNode.height || snapshot.group.height || 300;
    const groupLabel = snapshot.groupNode.data?.label || snapshot.title || "未命名组";

    const rootTempId = snapshot.groupNode.tempId;
    const directTempIds = Array.isArray(snapshot.groupNode.data?.memberIds)
      ? (snapshot.groupNode.data.memberIds as string[])
      : snapshot.nodes
          .filter((sn) => sn.parentTempId === rootTempId)
          .map((sn) => sn.tempId);
    const directNewIds = directTempIds.map((tid) => idMap[tid]).filter(Boolean);

    const groupNode = {
      id: newGroupId,
      type: "node_group",
      position: origin,
      width: groupW,
      height: groupH,
      style: { width: groupW, height: groupH },
      dragHandle: ".node-group-drag-handle",
      zIndex: -1,
      data: {
        label: groupLabel,
        params: {},
        inputs: [],
        outputs: [],
        status: "idle" as NodeStatus,
        memberIds: directNewIds,
        locked: Boolean(snapshot.groupNode.data?.locked),
        collapsed: Boolean(snapshot.groupNode.data?.collapsed),
      },
    } as AppNode;

    const newMembers: AppNode[] = [];
    for (const sn of snapshot.nodes) {
      const def = NODE_REGISTRY[sn.type];
      if (!def) continue;
      const newId = idMap[sn.tempId];
      const parentId = sn.parentTempId ? idMap[sn.parentTempId] || newGroupId : newGroupId;
      const params = { ...(sn.data?.params ?? {}) };
      // 组库落画布：只认 assetId，清掉可能指向源项目的临时 URL
      for (const key of ["imageUrl", "videoUrl", "audioUrl"] as const) {
        if (key in params) delete params[key];
      }
      const rawMemberIds = Array.isArray(sn.data?.memberIds)
        ? (sn.data.memberIds as string[])
        : undefined;
      const remappedMembers = rawMemberIds
        ?.map((tid) => idMap[tid])
        .filter(Boolean);
      const data: WorkflowNodeData = {
        label: sn.data?.label || def.label,
        params,
        inputs: sn.type === "node_group" ? [] : def.inputs,
        outputs: sn.type === "node_group" ? [] : def.outputs,
        status: "idle",
        ...(remappedMembers ? { memberIds: remappedMembers } : {}),
        ...(sn.type === "node_group"
          ? {
              locked: Boolean(sn.data?.locked),
              collapsed: Boolean(sn.data?.collapsed),
            }
          : {}),
      };
      newMembers.push({
        id: newId,
        type: sn.type,
        position: { ...sn.position },
        width: sn.width,
        height: sn.height,
        parentId,
        ...(sn.type === "node_group"
          ? {
              style: { width: sn.width, height: sn.height },
              dragHandle: ".node-group-drag-handle",
              zIndex: -1,
            }
          : {}),
        data,
      } as AppNode);
    }

    const newEdges: Edge[] = (snapshot.edges || [])
      .map((e) => {
        const source = idMap[e.sourceTempId];
        const target = idMap[e.targetTempId];
        if (!source || !target) return null;
        // 连线颜色跟随终点节点卡片色
        const tgtType = snapshot.nodes.find((n) => n.tempId === e.targetTempId)?.type || "";
        const hex = NODE_REGISTRY[tgtType]?.color || "#8b5cf6";
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return {
          id: `xy-edge__${source}-${target}-${Date.now()}`,
          source,
          target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
          style: { stroke: `rgba(${r},${g},${b},0.72)`, strokeWidth: 2 },
        } as Edge;
      })
      .filter((e): e is Edge => Boolean(e));

    const allNodes = sortNodesParentsFirst([...get().nodes, groupNode, ...newMembers]);
    const edges = normalizeEdges([...get().edges, ...newEdges], allNodes);
    set({
      nodes: allNodes,
      edges,
      connectedNodeIds: buildConnectedNodeIds(edges),
      selectedNodeId: newGroupId,
    });
    get().scheduleAutoSave();
    return newGroupId;
  },

  duplicateSelectedNodes: (opts) => {
    const state = get();
    const seedIds = [...new Set((opts?.ids?.length ? opts.ids : state.selectedFlowIds).filter(Boolean))];
    if (seedIds.length === 0) {
      if (!opts?.silent) toast.error("请先选中要复制的节点");
      return [];
    }

    // 选中组时带上全部后代成员
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const expand = new Set<string>();
    const stack = [...seedIds];
    while (stack.length) {
      const id = stack.pop()!;
      if (expand.has(id) || !byId.has(id)) continue;
      expand.add(id);
      for (const n of state.nodes) {
        if (n.parentId === id && !expand.has(n.id)) stack.push(n.id);
      }
    }

    const sourceNodes = sortNodesParentsFirst(state.nodes.filter((n) => expand.has(n.id)));
    if (sourceNodes.length === 0) return [];

    const includeEdges = opts?.includeEdges !== false;
    const leaveInPlace = Boolean(opts?.leaveInPlace);
    const offset: XYPosition = opts?.offset ?? (leaveInPlace ? { x: 0, y: 0 } : { x: 48, y: 48 });

    if (!opts?.silent) get().pushHistory();

    const idMap: Record<string, string> = {};
    for (const n of sourceNodes) {
      idMap[n.id] = genId(n.type || "node");
    }

    // 仅对「选区外无父」或「父也在选区」的根做世界偏移；组内相对坐标保持
    const rootIds = new Set(
      sourceNodes
        .filter((n) => !n.parentId || !expand.has(n.parentId))
        .map((n) => n.id)
    );

    const clones: AppNode[] = sourceNodes.map((n) => {
      const newId = idMap[n.id]!;
      const parentInSet = n.parentId && expand.has(n.parentId);
      const nextParent = parentInSet ? idMap[n.parentId!] : n.parentId;
      let position = { ...n.position };
      if (rootIds.has(n.id) && (offset.x !== 0 || offset.y !== 0)) {
        // 根节点：相对坐标若在组外则直接加偏移；若父在选区外仍挂原父，用相对父的偏移
        position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
      }
      const rawMemberIds = Array.isArray(n.data?.memberIds)
        ? (n.data.memberIds as string[])
        : undefined;
      const remappedMembers = rawMemberIds
        ?.map((mid) => idMap[mid])
        .filter((mid): mid is string => Boolean(mid));
      const data: WorkflowNodeData = {
        ...n.data,
        ...(remappedMembers ? { memberIds: remappedMembers } : {}),
        status: "idle",
      };
      return {
        ...n,
        id: newId,
        position,
        parentId: nextParent,
        selected: !leaveInPlace,
        data,
      } as AppNode;
    });

    const newEdges: Edge[] = [];
    if (includeEdges) {
      for (const e of state.edges) {
        if (!expand.has(e.source) || !expand.has(e.target)) continue;
        const source = idMap[e.source];
        const target = idMap[e.target];
        if (!source || !target) continue;
        newEdges.push({
          ...e,
          id: `xy-edge__${source}-${target}-${Date.now()}_${newEdges.length}`,
          source,
          target,
        });
      }
    }

    // 取消原选中，选中副本根（leaveInPlace 时保持拖拽原节点选中）
    const newRootIds = seedIds.map((id) => idMap[id]).filter(Boolean) as string[];
    const allNodes = sortNodesParentsFirst([
      ...state.nodes.map((n) =>
        leaveInPlace ? n : ({ ...n, selected: false } as AppNode)
      ),
      ...clones,
    ]);
    const edges = normalizeEdges([...state.edges, ...newEdges], allNodes);
    set({
      nodes: allNodes,
      edges,
      connectedNodeIds: buildConnectedNodeIds(edges),
      selectedNodeId: leaveInPlace ? state.selectedNodeId : newRootIds[0] ?? null,
      selectedFlowIds: leaveInPlace ? state.selectedFlowIds : newRootIds,
    });
    get().scheduleAutoSave();
    if (!opts?.silent && !leaveInPlace) {
      toast.success(includeEdges ? "已复制节点和连线" : "已复制节点");
    }
    return newRootIds;
  },

  copySelectionToClipboard: () => {
    const state = get();
    const seedIds = [
      ...new Set(
        (state.selectedFlowIds.length > 0
          ? state.selectedFlowIds
          : state.selectedNodeId
            ? [state.selectedNodeId]
            : []
        ).filter(Boolean)
      ),
    ];
    if (seedIds.length === 0) {
      toast.error("请先选中要复制的节点");
      return false;
    }
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const expand = new Set<string>();
    const stack = [...seedIds];
    while (stack.length) {
      const id = stack.pop()!;
      if (expand.has(id) || !byId.has(id)) continue;
      expand.add(id);
      for (const n of state.nodes) {
        if (n.parentId === id && !expand.has(n.id)) stack.push(n.id);
      }
    }
    const nodes = sortNodesParentsFirst(state.nodes.filter((n) => expand.has(n.id)));
    if (nodes.length === 0) {
      toast.error("请先选中要复制的节点");
      return false;
    }
    const edges = state.edges.filter((e) => expand.has(e.source) && expand.has(e.target));
    setCanvasNodeClipboard({ nodes, edges, seedIds });
    toast.success(nodes.length > 1 ? `已复制 ${nodes.length} 个节点` : "已复制");
    return true;
  },

  pasteClipboardNodes: (opts) => {
    const clip = getCanvasNodeClipboard();
    if (!clip || clip.nodes.length === 0) {
      return [];
    }
    const state = get();
    const offset = opts?.offset ?? defaultPasteOffset();
    get().pushHistory();

    const idMap: Record<string, string> = {};
    for (const n of clip.nodes) {
      idMap[n.id] = genId(n.type || "node");
    }
    const expand = new Set(clip.nodes.map((n) => n.id));
    const rootIds = new Set(
      clip.nodes
        .filter((n) => !n.parentId || !expand.has(n.parentId))
        .map((n) => n.id)
    );

    const clones: AppNode[] = clip.nodes.map((n) => {
      const newId = idMap[n.id]!;
      const parentInSet = n.parentId && expand.has(n.parentId);
      const nextParent = parentInSet ? idMap[n.parentId!] : undefined;
      let position = { ...n.position };
      if (rootIds.has(n.id)) {
        position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
      }
      const rawMemberIds = Array.isArray(n.data?.memberIds)
        ? (n.data.memberIds as string[])
        : undefined;
      const remappedMembers = rawMemberIds
        ?.map((mid) => idMap[mid])
        .filter((mid): mid is string => Boolean(mid));
      const data: WorkflowNodeData = {
        ...n.data,
        ...(remappedMembers ? { memberIds: remappedMembers } : {}),
        status: "idle",
      };
      return {
        ...n,
        id: newId,
        position,
        parentId: nextParent,
        selected: true,
        data,
      } as AppNode;
    });

    const newEdges: Edge[] = [];
    for (const e of clip.edges) {
      const source = idMap[e.source];
      const target = idMap[e.target];
      if (!source || !target) continue;
      newEdges.push({
        ...e,
        id: `xy-edge__${source}-${target}-${Date.now()}_${newEdges.length}`,
        source,
        target,
      });
    }

    const newRootIds = clip.seedIds.map((id) => idMap[id]).filter(Boolean) as string[];
    const allNodes = sortNodesParentsFirst([
      ...state.nodes.map((n) => ({ ...n, selected: false } as AppNode)),
      ...clones,
    ]);
    const edges = normalizeEdges([...state.edges, ...newEdges], allNodes);
    set({
      nodes: allNodes,
      edges,
      connectedNodeIds: buildConnectedNodeIds(edges),
      selectedNodeId: newRootIds[0] ?? null,
      selectedFlowIds: newRootIds,
    });
    get().scheduleAutoSave();
    toast.success("已粘贴");
    return newRootIds;
  },

  fitView: null, setFitView: (fn) => set({ fitView: fn }),
  organizeNodes: null, setOrganizeNodes: (fn) => set({ organizeNodes: fn }),
  setZoom: (zoom) => {
    const clamped = Math.min(5, Math.max(0.1, zoom));
    const apply = get().applyZoom;
    if (apply) {
      apply(clamped);
      return;
    }
    set({ viewport: { ...get().viewport, zoom: clamped } });
  },
  setRunning: (running) => set({ isRunning: running }),
  setCanvasMode: (mode) => set({ canvasMode: mode }),
  setConnecting: (v) => set({ isConnecting: v }),
  setCanvasDragging: (dragging) => set({ isCanvasDragging: dragging }),
  activeGenerationNodeIds: {},
  beginNodeGeneration: (nodeId) =>
    set((state) => ({
      activeGenerationNodeIds: { ...state.activeGenerationNodeIds, [nodeId]: true },
    })),
  endNodeGeneration: (nodeId) =>
    set((state) => {
      const next = { ...state.activeGenerationNodeIds };
      delete next[nodeId];
      return { activeGenerationNodeIds: next };
    }),

  setNodeStatus: (nodeId, status, progress) => {
    set((state) => ({
      nodeExecutionStatus: { ...state.nodeExecutionStatus, [nodeId]: status },
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status, ...(progress !== undefined ? { progress } : {}) } }
          : n
      ),
    }));
  },

  setViewport: (viewport) => set({ viewport }),
  onNodeDragStop: (draggedNodeId) => {
    get().reconcileGroupsAfterDrag(draggedNodeId);
  },

  resetForLogout: () => {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    initRequestId += 1;
    set({
      projectId: "",
      projectNo: "",
      projectName: "",
      projectRole: null,
      ownerDisplayName: "",
      workflowId: null,
      workflowRevision: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      connectedNodeIds: new Set<string>(),
      selectedNodeId: null,
      selectedFlowIds: [],
      batchRunProgress: null,
      batchRunCancelRequested: false,
      multiAngleNodeId: null,
      lightingNodeId: null,
      framePickNodeId: null,
      framePickTimeSec: 0,
      inlineVideoTrim: null,
      inlineVideoCrop: null,
      drawingBoardNodeId: null,
      drawingBoardIntent: null,
      generationOptionsExpanded: false,
      topMenuCloseSeq: 0,
      inlineImageDrawTool: null,
      inlineImageDrawColor: "#ef4444",
      inlineImageDrawSize: 16,
      inlineImageEraseMode: false,
      inlineImageEraseParams: null,
      inlineImageTransform: null,
      inlineImageOutpaint: null,
      inlineImageCrop: null,
      isRunning: false,
      nodeExecutionStatus: {},
      isLoading: false,
      loadError: null,
      syncConflict: null,
      history: [],
      historyIndex: -1,
      historyFuture: [],
      activeGenerationNodeIds: {},
    });
  },
}));


