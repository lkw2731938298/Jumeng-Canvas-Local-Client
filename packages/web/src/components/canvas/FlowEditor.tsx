"use client";

import { useCallback, useRef, useEffect, useState, useMemo, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { ReactFlow, Background, BackgroundVariant, useUpdateNodeInternals, type FinalConnectionState, type Node, type OnBeforeDelete, type OnConnectStart, type OnNodeDrag, type ReactFlowInstance, type Viewport } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "@/stores/canvasStore";
import { NODE_COMPONENTS } from "./nodes";
import type { WorkflowNodeData } from "@/types/workflow";

type CanvasFlowNode = Node<WorkflowNodeData>;
import { NODE_REGISTRY } from "@/types/node-registry";
import { Layers, FolderPlus, Ungroup, Play } from "lucide-react";
import dagre from "dagre";
import { defaultNodeSize } from "@/lib/canvas/nodeSizing";
import { navigateToDirectorStage } from "@/lib/canvas/directorNavigation";
import {
  ensureStoryboardGridNodeId,
  linkDirectorToStoryboard,
} from "@/lib/canvas/storyboardNarrativeBootstrap";
import { CANVAS_ASSET_MIME, parseAssetDragPayload, nodeTypeForAssetCategory } from "@/lib/canvas/assetDrag";
import { CANVAS_GROUP_MIME, parseGroupDragPayload } from "@/lib/canvas/groupDrag";
import { buildGroupSnapshot, getAbsolutePosition, isGroupNode, listUnboundMediaLabels } from "@/lib/canvas/nodeGroup";
import { createNodeGroup as createNodeGroupApi, getNodeGroup } from "@/lib/api/nodeGroups";
import {
  nodeSizeForType,
  resolveAddNodePosition,
  resolveNonOverlappingPosition,
  screenToFlowPosition,
  topLeftFromCenter,
} from "@/lib/canvas/nodePlacement";
import {
  defaultSubcategoryForCategory,
  inferAssetCategory,
  isOsFileDrag,
} from "@/lib/canvas/fileDrop";
import { NODE_IMAGE_SUBCATEGORY, notifyAssetsUpdated, uploadAsset } from "@/lib/api/assets";
import { validateCanvasImageFile } from "@/lib/canvas/imageSizePolicy";
import { usePendingGenerationJobPolling } from "@/lib/canvas/usePendingGenerationJobPolling";
import { runSelectionBatch } from "@/lib/canvas/selectionBatchRun";
import { isCanvasTypingTarget } from "@/lib/canvas/isCanvasTypingTarget";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import { toast } from "sonner";
import { buildConnectionFromPendingWire, type PendingWire } from "@/lib/canvas/connectionDrop";
import {
  allowedAddNodeTypesForLibrarySource,
  DEFAULT_EFFECT_LIBRARY_TARGET_MODEL,
  getLibraryCategory,
  isLibraryLockedNode,
  validateLibraryConnection,
} from "@/lib/canvas/materialLibrary";
import { isSeedance20Model } from "@/lib/canvas/videoGenerationModes";
import { CanvasBezierEdge } from "./edges/CanvasBezierEdge";
import { AddNodeMenuList } from "./AddNodeMenu";
import {
  CanvasPaneContextMenu,
  type CanvasPaneMenuAction,
} from "./CanvasPaneContextMenu";
import { CanvasScreenshotOverlay, type ScreenRect } from "./CanvasScreenshotOverlay";
import { bakeCanvasScreenshotToAsset } from "@/lib/canvas/canvasScreenshot";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Handle center is 16px outside card; snap through gap + ~32px into card edge. */
const CANVAS_CONNECTION_RADIUS = 48;

const edgeTypes = { default: CanvasBezierEdge, canvas: CanvasBezierEdge };

const NodeEditorOverlay = dynamic(
  () => import("./NodeEditorOverlay").then((m) => m.NodeEditorOverlay),
  { ssr: false }
);
const NodeTopMenuOverlay = dynamic(
  () => import("./NodeTopMenuOverlay").then((m) => m.NodeTopMenuOverlay),
  { ssr: false }
);
const StoryboardGridTopMenuOverlay = dynamic(
  () => import("./StoryboardGridTopMenuOverlay").then((m) => m.StoryboardGridTopMenuOverlay),
  { ssr: false }
);
const MultiAnglePanel = dynamic(
  () => import("./MultiAnglePanel").then((m) => m.MultiAnglePanel),
  { ssr: false }
);
const LightingPanel = dynamic(
  () => import("./LightingPanel").then((m) => m.LightingPanel),
  { ssr: false }
);
const StoryboardSheetComposerPanel = dynamic(
  () => import("./StoryboardSheetComposerPanel").then((m) => m.StoryboardSheetComposerPanel),
  { ssr: false }
);
const DrawingBoardModal = dynamic(
  () => import("./DrawingBoardModal").then((m) => m.DrawingBoardModal),
  { ssr: false }
);

const nodeTypes = NODE_COMPONENTS;

/** Re-measure handle positions after new edges are added. */
function ConnectEdgeSync() {
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeInternals = useUpdateNodeInternals();
  const edgeCountRef = useRef(0);

  useEffect(() => {
    if (edges.length <= edgeCountRef.current) {
      edgeCountRef.current = edges.length;
      return;
    }
    edgeCountRef.current = edges.length;
    const latest = edges[edges.length - 1];
    if (!latest) return;
    requestAnimationFrame(() => {
      updateNodeInternals(latest.source);
      updateNodeInternals(latest.target);
    });
  }, [edges, updateNodeInternals]);

  return null;
}

function scheduleViewportSync(viewport: Viewport) {
  useCanvasStore.getState().setViewport(viewport);
}

export function FlowEditor() {
  const router = useRouter();
  usePendingGenerationJobPolling();
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const {
    gridVisible,
    gridPattern,
    snapToGrid,
    canvasMode,
    selectedNodeId,
    multiAngleNodeId,
    lightingNodeId,
    storyboardSheetKind,
    drawingBoardNodeId,
    inlineImageDrawTool,
    inlineImageCrop,
    projectId,
    onNodesChange,
    onEdgesChange,
    onConnect,
    connectNodes,
    setConnecting,
    selectNode,
    addNode,
    addNodeFromAsset,
    addGroupFromLibrary,
    createNodeGroup,
    ungroupNode,
    duplicateSelectedNodes,
    copySelectionToClipboard,
    pasteClipboardNodes,
    onNodeDragStop,
    isCanvasDragging,
    setCanvasDragging,
  } = useCanvasStore(
    useShallow((s) => ({
      gridVisible: s.gridVisible,
      gridPattern: s.gridPattern,
      snapToGrid: s.snapToGrid,
      canvasMode: s.canvasMode,
      selectedNodeId: s.selectedNodeId,
      multiAngleNodeId: s.multiAngleNodeId,
      lightingNodeId: s.lightingNodeId,
      storyboardSheetKind: s.storyboardSheetKind,
      drawingBoardNodeId: s.drawingBoardNodeId,
      inlineImageDrawTool: s.inlineImageDrawTool,
      inlineImageCrop: s.inlineImageCrop,
      projectId: s.projectId,
      onNodesChange: s.onNodesChange,
      onEdgesChange: s.onEdgesChange,
      onConnect: s.onConnect,
      connectNodes: s.connectNodes,
      setConnecting: s.setConnecting,
      selectNode: s.selectNode,
      addNode: s.addNode,
      addNodeFromAsset: s.addNodeFromAsset,
      addGroupFromLibrary: s.addGroupFromLibrary,
      createNodeGroup: s.createNodeGroup,
      ungroupNode: s.ungroupNode,
      duplicateSelectedNodes: s.duplicateSelectedNodes,
      copySelectionToClipboard: s.copySelectionToClipboard,
      pasteClipboardNodes: s.pasteClipboardNodes,
      onNodeDragStop: s.onNodeDragStop,
      isCanvasDragging: s.isCanvasDragging,
      setCanvasDragging: s.setCanvasDragging,
    }))
  );

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const rfInstanceRef = useRef<ReactFlowInstance<CanvasFlowNode> | null>(null);
  const deleteResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState({
    title: "确认删除",
    description: "确定删除选中内容吗？",
  });
  const isPointerMode = canvasMode === "pointer";
  const { themeId } = useAppTheme();
  const canvasSurface = useMemo(() => {
    if (typeof window === "undefined") {
      return { bg: "#000000", gridLine: "rgba(80, 80, 120, 0.2)", gridDot: "rgba(80, 80, 120, 0.35)" };
    }
    const style = getComputedStyle(document.documentElement);
    return {
      bg: style.getPropertyValue("--canvas-bg").trim() || "#000000",
      gridLine: style.getPropertyValue("--grid-color").trim() || "rgba(80, 80, 120, 0.2)",
      gridDot: style.getPropertyValue("--grid-color-dot").trim() || "rgba(80, 80, 120, 0.35)",
    };
  }, [themeId]);
  const [selectedFlowIds, setSelectedFlowIds] = useState<string[]>([]);
  const [saveBtnStyle, setSaveBtnStyle] = useState<{left:number;top:number}|null>(null);

  const safeEdges = useMemo(
    () => edges.filter((e) => e.source && e.target && e.id),
    [edges]
  );

  // Double-click / connection-drop add-node popup（与左侧工具栏同款扁平菜单）
  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null);
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null);
  const pendingWireRef = useRef<PendingWire | null>(null);
  /** 画布空白右键菜单（屏幕坐标） */
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(
    null
  );
  /** 框选截图模式 */
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [screenshotSaving, setScreenshotSaving] = useState(false);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const paneUploadInputRef = useRef<HTMLInputElement>(null);
  const historyIndex = useCanvasStore((s) => s.historyIndex);
  const historyFutureLen = useCanvasStore((s) => s.historyFuture.length);

  // 素材库节点拉线落空：菜单仅高亮可连接类型
  const libraryWireEnabledTypes = useMemo(() => {
    if (!pendingWire) return null;
    const origin = useCanvasStore
      .getState()
      .nodes.find((n) => n.id === pendingWire.nodeId);
    return allowedAddNodeTypesForLibrarySource(origin);
  }, [pendingWire]);

  const closeAddNodePopup = useCallback(() => {
    setPopup(null);
    setPendingWire(null);
    pendingWireRef.current = null;
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    if (!isPointerMode) return;
    const types = Array.from(e.dataTransfer.types);
    if (
      types.includes(CANVAS_ASSET_MIME) ||
      types.includes(CANVAS_GROUP_MIME) ||
      types.includes("application/node-type") ||
      isOsFileDrag(e.dataTransfer)
    ) {
      e.preventDefault();
      if (
        isOsFileDrag(e.dataTransfer) ||
        types.includes(CANVAS_ASSET_MIME) ||
        types.includes(CANVAS_GROUP_MIME)
      ) {
        e.dataTransfer.dropEffect = "copy";
      } else {
        e.dataTransfer.dropEffect = "move";
      }
    }
  }, [isPointerMode]);

  const onDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    if (!isPointerMode) return;
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const state = useCanvasStore.getState();
    const dropCenter = screenToFlowPosition(e.clientX, e.clientY, bounds, state.viewport);

    // 组库拖入：整组还原
    const groupPayload = parseGroupDragPayload(e.dataTransfer.getData(CANVAS_GROUP_MIME));
    if (groupPayload) {
      try {
        const detail = await getNodeGroup(groupPayload.projectId, groupPayload.groupId);
        const gw = detail.snapshot?.group?.width || 400;
        const gh = detail.snapshot?.group?.height || 300;
        const position = {
          x: dropCenter.x - gw / 2,
          y: dropCenter.y - gh / 2,
        };
        addGroupFromLibrary(detail.snapshot, position);
        // 刷新素材清单，使节点卡片能解析组内 assetId 预览
        const { notifyAssetsUpdated } = await import("@/lib/api/assets");
        notifyAssetsUpdated();
        toast.success("已添加组到画布");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "加载组失败");
      }
      return;
    }

    const assetPayload = parseAssetDragPayload(e.dataTransfer.getData(CANVAS_ASSET_MIME));
    if (assetPayload) {
      const nodeType = nodeTypeForAssetCategory(assetPayload.category);
      const size = nodeSizeForType(nodeType);
      const position = resolveNonOverlappingPosition(
        topLeftFromCenter(dropCenter, size),
        size,
        state.nodes
      );
      addNodeFromAsset(assetPayload, position);
      return;
    }

    const type = e.dataTransfer.getData("application/node-type");
    if (type && NODE_REGISTRY[type]) {
      const size = nodeSizeForType(type);
      const position = resolveNonOverlappingPosition(
        topLeftFromCenter(dropCenter, size),
        size,
        state.nodes
      );
      addNode(type, position);
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const projectId = state.projectId;
    if (!projectId) {
      toast.error("项目未加载，无法上传文件");
      return;
    }

    const toastId = toast.loading(files.length > 1 ? `正在上传 ${files.length} 个文件…` : "正在上传文件…");
    let successCount = 0;

    try {
      for (const file of files) {
        const category = inferAssetCategory(file);
        if (!category) {
          toast.error(`不支持的文件类型：${file.name}`);
          continue;
        }

        if (category === "image") {
          const sizeError = validateCanvasImageFile(file);
          if (sizeError) {
            toast.error(`${file.name}：${sizeError}`);
            continue;
          }
        }

        const nodeType = nodeTypeForAssetCategory(category);
        const size = nodeSizeForType(nodeType);
        const currentNodes = useCanvasStore.getState().nodes;
        const position = resolveNonOverlappingPosition(
          topLeftFromCenter(dropCenter, size),
          size,
          currentNodes
        );

        const asset = await uploadAsset({
          file,
          projectId,
          category,
          subcategory: defaultSubcategoryForCategory(category),
          title: file.name.replace(/\.[^.]+$/, "") || "未命名",
        });

        addNodeFromAsset(
          {
            id: asset.id,
            category: asset.category,
            fileUrl: asset.fileUrl,
            title: asset.title,
          },
          position
        );
        successCount += 1;
      }

      if (successCount > 0) {
        toast.success(successCount > 1 ? `已上传并添加 ${successCount} 个节点` : "已上传并添加到画布", {
          id: toastId,
        });
      } else {
        toast.dismiss(toastId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败", { id: toastId });
    }
  }, [isPointerMode, addNode, addNodeFromAsset, addGroupFromLibrary]);

  const handleFitView = useCallback(() => {
    rfInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

  const handleOrganize = useCallback(() => {
    const { nodes, edges, setNodes, pushHistory } = useCanvasStore.getState();
    if (nodes.length === 0) return;
    pushHistory();
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 100 });
    for (const node of nodes) {
      const { width, height } = defaultNodeSize();
      g.setNode(node.id, { width: node.width ?? width, height: node.height ?? height });
    }
    for (const edge of edges) { g.setEdge(edge.source, edge.target); }
    dagre.layout(g);
    const positioned = nodes.map((n) => {
      const d = g.node(n.id);
      return { ...n, position: { x: (d?.x ?? 0) - ((n.width ?? defaultNodeSize().width) / 2), y: (d?.y ?? 0) - ((n.height ?? defaultNodeSize().height) / 2) } };
    });
    setNodes(positioned as unknown as Node<WorkflowNodeData>[]);
    useCanvasStore.getState().scheduleAutoSave();
  }, []);

  useEffect(() => {
    useCanvasStore.setState({
      fitView: () => handleFitView(),
      organizeNodes: () => handleOrganize(),
      centerFlowView: (flowX: number, flowY: number) => {
        const inst = rfInstanceRef.current;
        const { width, height } = useCanvasStore.getState().flowPaneSize;
        if (!inst || width <= 0 || height <= 0) return;
        const zoom = inst.getZoom();
        inst.setViewport({
          x: -flowX * zoom + width / 2,
          y: -flowY * zoom + height / 2,
          zoom,
        });
      },
      panFlowView: (deltaFlowX: number, deltaFlowY: number) => {
        const inst = rfInstanceRef.current;
        if (!inst) return;
        const vp = inst.getViewport();
        inst.setViewport({
          x: vp.x - deltaFlowX * vp.zoom,
          y: vp.y - deltaFlowY * vp.zoom,
          zoom: vp.zoom,
        });
      },
      applyZoom: (newZoom: number) => {
        const inst = rfInstanceRef.current;
        const { width, height } = useCanvasStore.getState().flowPaneSize;
        if (!inst) return;
        const vp = inst.getViewport();
        const w = width > 0 ? width : 800;
        const h = height > 0 ? height : 600;
        const centerFlowX = (w / 2 - vp.x) / vp.zoom;
        const centerFlowY = (h / 2 - vp.y) / vp.zoom;
        inst.setViewport({
          x: w / 2 - centerFlowX * newZoom,
          y: h / 2 - centerFlowY * newZoom,
          zoom: newZoom,
        });
      },
    });
  }, [handleFitView, handleOrganize]);

  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      useCanvasStore.setState({ flowPaneSize: { width: rect.width, height: rect.height } });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onSelectionChange = useCallback(({ nodes: selNodes, edges: selEdges }: { nodes: Node[]; edges: { id: string }[] }) => {
    const ids = selNodes.map(function(n:Node){return n.id;});
    setSelectedFlowIds(ids);
    // 多选权威来源：始终写 store，供 Header「运行」读取（勿被随后的 selectNode(null) 清掉）
    useCanvasStore.getState().setSelectedFlowIds(ids);
    // 拖动中不写入单选编辑焦点，避免移动节点时弹出编辑层（点击选中由 onNodeClick 负责）
    const dragging = useCanvasStore.getState().isCanvasDragging;
    if (selEdges.length > 0 && ids.length === 0) {
      if (!dragging) selectNode(null);
    } else if (selEdges.length > 0 && ids.length > 0) {
      // 框选连带选中边：只清单选编辑焦点，保留 selectedFlowIds
      if (!dragging) useCanvasStore.setState({ selectedNodeId: null });
    } else if (ids.length === 1) {
      if (!dragging) {
        const cur = useCanvasStore.getState().selectedNodeId;
        if (cur !== ids[0]) {
          useCanvasStore.setState({ selectedNodeId: ids[0] });
        }
      }
    } else if (ids.length === 0) {
      if (!dragging) selectNode(null);
    } else if (ids.length >= 2) {
      // 多选节点：编辑器按「无单一选中」处理
      if (!dragging) useCanvasStore.setState({ selectedNodeId: null });
    }
    // 多选 ≥2 或单选组节点时显示浮层操作
    const stateNodes = useCanvasStore.getState().nodes;
    const onlyGroup = ids.length === 1 && isGroupNode(stateNodes.find((n) => n.id === ids[0]));
    if (ids.length < 2 && !onlyGroup) { setSaveBtnStyle(null); return; }
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const { viewport } = useCanvasStore.getState();
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const id of ids) {
      const n = stateNodes.find(function(n2:Node){return n2.id===id;});
      if (!n) continue;
      // 嵌套组：用完整祖先链解算世界坐标
      const abs = getAbsolutePosition(n, stateNodes);
      const w = n.width ?? 320;
      minX = Math.min(minX, abs.x);
      minY = Math.min(minY, abs.y);
      maxX = Math.max(maxX, abs.x + w);
    }
    if (!Number.isFinite(minX)) { setSaveBtnStyle(null); return; }
    const midX = (minX + maxX) / 2;
    const sx = midX * viewport.zoom + viewport.x + bounds.left;
    const sy = minY * viewport.zoom + viewport.y + bounds.top - 52;
    setSaveBtnStyle({ left: sx - bounds.left, top: Math.max(8, sy - bounds.top) });
  }, [selectNode]);

  /** 多选 → 成组 */
  const handleCreateGroup = useCallback(() => {
    const id = createNodeGroup(selectedFlowIds);
    if (id) {
      toast.success("已成组");
      setSaveBtnStyle(null);
      setSelectedFlowIds([id]);
      useCanvasStore.getState().setSelectedFlowIds([id]);
    }
  }, [createNodeGroup, selectedFlowIds]);

  /** 合并分镜组：至少选中两个组框，合成外层组 */
  const handleMergeGroups = useCallback(() => {
    const state = useCanvasStore.getState();
    const groupIds = selectedFlowIds.filter((id) =>
      isGroupNode(state.nodes.find((n) => n.id === id))
    );
    if (groupIds.length < 2) {
      toast.error("请至少选择 2 个组再合并");
      return;
    }
    const id = createNodeGroup(groupIds, "合并组");
    if (id) {
      toast.success("已合并分镜组");
      setSaveBtnStyle(null);
      setSelectedFlowIds([id]);
      useCanvasStore.getState().setSelectedFlowIds([id]);
    }
  }, [createNodeGroup, selectedFlowIds]);

  /** 选中组 → 解组（多选时先解最内层，避免嵌套坐标错乱） */
  const handleUngroup = useCallback(() => {
    const state = useCanvasStore.getState();
    const groupIds = selectedFlowIds.filter((id) =>
      isGroupNode(state.nodes.find((n) => n.id === id))
    );
    if (groupIds.length === 0) {
      toast.error("请先选中一个组");
      return;
    }
    const depthOf = (id: string) => {
      let d = 0;
      let pid = state.nodes.find((n) => n.id === id)?.parentId;
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        d += 1;
        pid = state.nodes.find((n) => n.id === pid)?.parentId;
      }
      return d;
    };
    const ordered = [...groupIds].sort((a, b) => depthOf(b) - depthOf(a));
    for (const groupId of ordered) {
      // 上一轮解组后节点可能已不存在
      if (!isGroupNode(useCanvasStore.getState().nodes.find((n) => n.id === groupId))) continue;
      ungroupNode(groupId);
    }
    toast.success(ordered.length > 1 ? `已解组 ${ordered.length} 个` : "已解组");
    setSaveBtnStyle(null);
    setSelectedFlowIds([]);
    useCanvasStore.getState().setSelectedFlowIds([]);
  }, [selectedFlowIds, ungroupNode]);

  /** 连线：按位置从左到右串联选中节点 */
  const handleConnectSelected = useCallback(() => {
    const state = useCanvasStore.getState();
    const ids = selectedFlowIds.filter((id) => {
      const n = state.nodes.find((x) => x.id === id);
      return n && !isGroupNode(n);
    });
    if (ids.length < 2) {
      toast.error("请至少选中 2 个节点再连线");
      return;
    }
    const ordered = [...ids].sort((a, b) => {
      const na = state.nodes.find((n) => n.id === a)!;
      const nb = state.nodes.find((n) => n.id === b)!;
      const pa = getAbsolutePosition(na, state.nodes);
      const pb = getAbsolutePosition(nb, state.nodes);
      if (Math.abs(pa.x - pb.x) > 8) return pa.x - pb.x;
      return pa.y - pb.y;
    });
    let linked = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
      const source = ordered[i]!;
      const target = ordered[i + 1]!;
      const before = useCanvasStore.getState().edges.length;
      connectNodes({ source, target });
      if (useCanvasStore.getState().edges.length > before) linked += 1;
    }
    if (linked > 0) toast.success(`已连接 ${linked} 条线`);
    else toast.message("选中节点已存在连线或无法连接");
  }, [connectNodes, selectedFlowIds]);

  /** Tab：在视口中心打开新建节点菜单 */
  const openAddNodeAtCenter = useCallback(() => {
    if (!isPointerMode) return;
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    setPendingWire(null);
    pendingWireRef.current = null;
    setPopup({ x: bounds.width / 2, y: bounds.height / 2 });
    requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
  }, [isPointerMode]);

  /** 保存组到左侧组库 */
  const handleSaveToLibrary = useCallback(async () => {
    const state = useCanvasStore.getState();
    if (!state.projectId) {
      toast.error("项目未加载");
      return;
    }
    let groupId =
      selectedFlowIds.length === 1 && isGroupNode(state.nodes.find((n) => n.id === selectedFlowIds[0]))
        ? selectedFlowIds[0]
        : null;
    // 多选未成组时先成组再保存
    if (!groupId && selectedFlowIds.length >= 2) {
      groupId = createNodeGroup(selectedFlowIds);
    }
    if (!groupId) {
      toast.error("请先成组或选中一个组");
      return;
    }
    const latest = useCanvasStore.getState();
    const snapshot = buildGroupSnapshot(groupId, latest.nodes, latest.edges);
    if (!snapshot) {
      toast.error("无法生成组快照");
      return;
    }
    // 保存前校验：媒体节点未绑定项目素材时提示（仍允许保存结构）
    const memberIds = new Set(snapshot.nodes.map((n) => n.tempId));
    const members = latest.nodes.filter((n) => memberIds.has(n.id));
    const unbound = listUnboundMediaLabels(members);
    if (unbound.length > 0) {
      toast.warning(
        `有 ${unbound.length} 个媒体节点未绑定项目素材（${unbound.slice(0, 3).join("、")}${unbound.length > 3 ? "…" : ""}），拖出后可能无预览`
      );
    }
    try {
      await createNodeGroupApi({
        projectId: latest.projectId,
        title: snapshot.title,
        snapshot,
        coverAssetId: snapshot.assets[0]?.assetId ?? null,
      });
      toast.success("已保存到组库");
      window.dispatchEvent(new CustomEvent("canvas:node-groups-updated"));
      setSaveBtnStyle(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    }
  }, [createNodeGroup, selectedFlowIds]);

  const selectionHasGroup = useMemo(() => {
    return selectedFlowIds.some((id) => isGroupNode(nodes.find((n) => n.id === id)));
  }, [nodes, selectedFlowIds]);

  // 支持嵌套：选中顶层节点或顶层组即可成组
  const canCreateGroup = useMemo(() => {
    if (selectedFlowIds.length < 2) return false;
    return selectedFlowIds.every((id) => {
      const n = nodes.find((x) => x.id === id);
      return Boolean(n) && !n!.parentId;
    });
  }, [nodes, selectedFlowIds]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    selectNode(node.id);
  }, [selectNode]);

  const onPaneClick = useCallback(() => {
    setSaveBtnStyle(null);
    setSelectedFlowIds([]);
    setPaneMenu(null);
    const state = useCanvasStore.getState();
    state.closeMultiAngle();
    state.closeLighting();
    state.selectNode(null);
    state.setSelectedFlowIds([]);
  }, []);

  // 量测画布容器尺寸（截图框选用）
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setPaneSize({ width: r.width, height: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      e.preventDefault();
      if (!isPointerMode || screenshotMode) return;
      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return;
      const bounds = wrapper.getBoundingClientRect();
      const state = useCanvasStore.getState();
      const flow = screenToFlowPosition(e.clientX, e.clientY, bounds, state.viewport);
      closeAddNodePopup();
      // 菜单贴边防溢出
      const menuW = 200;
      const menuH = 280;
      const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
      const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
      setPaneMenu({ x: Math.max(8, x), y: Math.max(8, y), flowX: flow.x, flowY: flow.y });
    },
    [closeAddNodePopup, isPointerMode, screenshotMode]
  );

  const handlePaneUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const state = useCanvasStore.getState();
      const projectId = state.projectId;
      if (!projectId) {
        toast.error("项目未加载，无法上传文件");
        return;
      }
      const wrapper = reactFlowWrapper.current;
      const bounds = wrapper?.getBoundingClientRect();
      const anchor = paneMenu
        ? { x: paneMenu.flowX, y: paneMenu.flowY }
        : bounds
          ? screenToFlowPosition(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
              bounds,
              state.viewport
            )
          : { x: 0, y: 0 };

      const toastId = toast.loading(list.length > 1 ? `正在上传 ${list.length} 个文件…` : "正在上传文件…");
      let successCount = 0;
      try {
        for (const file of list) {
          const category = inferAssetCategory(file);
          if (!category) {
            toast.error(`不支持的文件类型：${file.name}`);
            continue;
          }
          if (category === "image") {
            const sizeError = validateCanvasImageFile(file);
            if (sizeError) {
              toast.error(`${file.name}：${sizeError}`);
              continue;
            }
          }
          const nodeType = nodeTypeForAssetCategory(category);
          const size = nodeSizeForType(nodeType);
          const position = resolveNonOverlappingPosition(
            topLeftFromCenter(anchor, size),
            size,
            useCanvasStore.getState().nodes
          );
          const asset = await uploadAsset({
            file,
            projectId,
            category,
            subcategory: defaultSubcategoryForCategory(category),
            title: file.name.replace(/\.[^.]+$/, "") || "未命名",
          });
          addNodeFromAsset(
            {
              id: asset.id,
              category: asset.category,
              fileUrl: asset.fileUrl,
              title: asset.title,
            },
            position
          );
          successCount += 1;
        }
        if (successCount > 0) {
          notifyAssetsUpdated();
          toast.success(successCount > 1 ? `已上传并添加 ${successCount} 个节点` : "已上传并添加到画布", {
            id: toastId,
          });
        } else {
          toast.dismiss(toastId);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败", { id: toastId });
      }
    },
    [addNodeFromAsset, paneMenu]
  );

  const handlePaneMenuAction = useCallback(
    async (action: CanvasPaneMenuAction) => {
      const menu = paneMenu;
      setPaneMenu(null);
      const state = useCanvasStore.getState();

      switch (action) {
        case "upload":
          paneUploadInputRef.current?.click();
          return;
        case "saveAsset": {
          const node = state.nodes.find((n) => n.id === state.selectedNodeId);
          const assetId = String((node?.data as WorkflowNodeData | undefined)?.params?.assetId ?? "").trim();
          if (!assetId) {
            toast.message("请先选中已有素材的图片节点");
            return;
          }
          toast.success("素材已在项目资产中");
          return;
        }
        case "addNode": {
          const wrapper = reactFlowWrapper.current;
          if (!wrapper || !menu) return;
          const bounds = wrapper.getBoundingClientRect();
          setPopup({ x: menu.x - bounds.left, y: menu.y - bounds.top });
          return;
        }
        case "screenshot":
          setScreenshotMode(true);
          return;
        case "undo":
          state.undo();
          return;
        case "redo":
          state.redo();
          return;
        case "paste": {
          try {
            const items = await navigator.clipboard.read();
            const files: File[] = [];
            for (const item of items) {
              const type = item.types.find((t) => t.startsWith("image/"));
              if (!type) continue;
              const blob = await item.getType(type);
              const ext = type.split("/")[1] || "png";
              files.push(new File([blob], `paste-${Date.now()}.${ext}`, { type }));
            }
            if (files.length === 0) {
              toast.message("剪贴板中没有图片");
              return;
            }
            await handlePaneUploadFiles(files);
          } catch {
            toast.error("无法读取剪贴板，请检查浏览器权限");
          }
          return;
        }
        default:
          return;
      }
    },
    [handlePaneUploadFiles, paneMenu]
  );

  const handleScreenshotConfirm = useCallback(
    async (screenRect: ScreenRect) => {
      const wrapper = reactFlowWrapper.current;
      const projectId = useCanvasStore.getState().projectId;
      if (!wrapper || !projectId) {
        toast.error("项目未加载，无法截图");
        return;
      }
      setScreenshotSaving(true);
      try {
        const bounds = wrapper.getBoundingClientRect();
        const state = useCanvasStore.getState();
        const { viewport } = state;
        const topLeft = screenToFlowPosition(
          bounds.left + screenRect.x,
          bounds.top + screenRect.y,
          bounds,
          viewport
        );
        const bottomRight = screenToFlowPosition(
          bounds.left + screenRect.x + screenRect.w,
          bounds.top + screenRect.y + screenRect.h,
          bounds,
          viewport
        );
        const flowRect = {
          x: topLeft.x,
          y: topLeft.y,
          w: Math.max(1, bottomRight.x - topLeft.x),
          h: Math.max(1, bottomRight.y - topLeft.y),
        };
        const asset = await bakeCanvasScreenshotToAsset({
          projectId,
          flowRect,
          nodes: state.nodes,
          title: "画布截图",
        });
        addNodeFromAsset(
          {
            id: asset.id,
            category: "image",
            fileUrl: asset.fileUrl,
            title: asset.title,
          },
          { x: flowRect.x, y: flowRect.y }
        );
        notifyAssetsUpdated();
        setScreenshotMode(false);
        toast.success("已生成截图节点");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "截图失败");
      } finally {
        setScreenshotSaving(false);
      }
    },
    [addNodeFromAsset]
  );

  const finishDeleteConfirm = useCallback((confirmed: boolean) => {
    setDeleteConfirmOpen(false);
    const resolve = deleteResolverRef.current;
    deleteResolverRef.current = null;
    resolve?.(confirmed);
  }, []);

  const onBeforeDelete: OnBeforeDelete<CanvasFlowNode> = useCallback(({ nodes: nodesToRemove, edges: edgesToRemove }) => {
    if (deleteResolverRef.current) return Promise.resolve(false);

    const labels = nodesToRemove.map((n) => {
      const label = String((n.data as WorkflowNodeData | undefined)?.label ?? "").trim();
      return label || n.id;
    });

    let description: string;
    if (nodesToRemove.length === 1) {
      description = `确定删除节点「${labels[0]}」吗？`;
    } else if (nodesToRemove.length > 1) {
      const preview = labels.slice(0, 3).join("、");
      const more = labels.length > 3 ? ` 等 ${labels.length} 个` : "";
      description = `确定删除选中的 ${nodesToRemove.length} 个节点（${preview}${more}）吗？`;
    } else if (edgesToRemove.length > 0) {
      description = `确定删除选中的 ${edgesToRemove.length} 条连线吗？`;
    } else {
      return Promise.resolve(false);
    }

    setDeleteConfirmText({ title: "确认删除", description });
    setDeleteConfirmOpen(true);

    return new Promise<boolean>((resolve) => {
      deleteResolverRef.current = resolve;
    });
  }, []);

  const handlePopupAddNode = useCallback((type: string) => {
    if (!popup) return;
    const state = useCanvasStore.getState();
    const preferredCenter = {
      x: (popup.x - state.viewport.x) / state.viewport.zoom,
      y: (popup.y - state.viewport.y) / state.viewport.zoom,
    };
    const position = resolveAddNodePosition(type, state.nodes, {
      viewport: state.viewport,
      paneSize: state.flowPaneSize,
      selectedNodeId: state.selectedNodeId,
      preferredCenter,
    });
    const wire = pendingWireRef.current;
    const originNode = wire
      ? state.nodes.find((n) => n.id === wire.nodeId)
      : undefined;
    // 素材库拉线：仅允许选用可连接类型
    const allowedTypes = allowedAddNodeTypesForLibrarySource(originNode);
    if (allowedTypes && !allowedTypes.includes(type)) {
      toast.error("当前素材库节点不能连接到该类型");
      return;
    }

    // 一键出海 Skill 卡已下线
    if (type === "overseas_localize") {
      toast.message("一键出海请在 Agent 对话中操作，无需添加节点卡");
      return;
    }
    addNode(type, position);
    let newNodeId = useCanvasStore.getState().nodes.at(-1)?.id || "";

    // 特效库 → 新建视频：确保目标为 SD2.0，否则连线会被校验拦截
    if (
      wire &&
      newNodeId &&
      type === "video_input" &&
      isLibraryLockedNode(originNode) &&
      getLibraryCategory(
        (originNode?.data as { params?: Record<string, unknown> } | undefined)?.params
      ) === "effect"
    ) {
      const created = useCanvasStore.getState().nodes.find((n) => n.id === newNodeId);
      const model = String(
        (created?.data as { params?: Record<string, unknown> } | undefined)?.params?.model ?? ""
      );
      if (!isSeedance20Model(model)) {
        useCanvasStore
          .getState()
          .updateNodeParam(newNodeId, "model", DEFAULT_EFFECT_LIBRARY_TARGET_MODEL);
      }
    }

    if (wire && newNodeId) {
      const newNode = useCanvasStore.getState().nodes.find((n) => n.id === newNodeId);
      if (newNode && newNode.type === type) {
        const connection = buildConnectionFromPendingWire(
          wire,
          newNode.id,
          type,
          originNode?.type
        );
        if (connection.sourceHandle) {
          connectNodes(connection);
        }
      }
    }

    if (type === "director_stage" && projectId) {
      const node = useCanvasStore.getState().nodes.filter((n) => n.type === "director_stage").at(-1);
      if (node) {
        const gridId = ensureStoryboardGridNodeId({ preferSelected: false });
        if (gridId) {
          linkDirectorToStoryboard({ gridNodeId: gridId, directorNodeId: node.id });
        }
        void navigateToDirectorStage(projectId, node.id, router.push);
      }
    }
    closeAddNodePopup();
  }, [popup, addNode, connectNodes, projectId, router, closeAddNodePopup]);

  // 素材库节点连线规则：风格/角色→图/视频；特效→SD2.0 视频
  const isValidConnection = useCallback((connection: { source: string | null; target: string | null }) => {
    if (!connection.source || !connection.target) return true;
    const nodes = useCanvasStore.getState().nodes;
    const source = nodes.find((n) => n.id === connection.source);
    const target = nodes.find((n) => n.id === connection.target);
    return validateLibraryConnection(source, target) == null;
  }, []);

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    setConnecting(true);
    if (params.nodeId && params.handleType) {
      pendingWireRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
      };
    } else {
      pendingWireRef.current = null;
    }
  }, [setConnecting]);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      setTimeout(() => setConnecting(false), 100);

      const started = pendingWireRef.current;
      pendingWireRef.current = null;
      if (!isPointerMode || !started || connectionState.isValid === true || connectionState.toNode) {
        return;
      }

      const wrapper = reactFlowWrapper.current;
      if (!wrapper) return;

      const clientX = "clientX" in event ? event.clientX : event.changedTouches?.[0]?.clientX;
      const clientY = "clientY" in event ? event.clientY : event.changedTouches?.[0]?.clientY;
      if (clientX == null || clientY == null) return;

      const bounds = wrapper.getBoundingClientRect();
      setPendingWire(started);
      pendingWireRef.current = started;
      window.getSelection()?.removeAllRanges();
      setPopup({ x: clientX - bounds.left, y: clientY - bounds.top });
    },
    [isPointerMode, setConnecting]
  );

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    scheduleViewportSync(viewport);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddNodePopup();
    };
    const clickHandler = () => closeAddNodePopup();
    document.addEventListener("keydown", handler);
    const timer = window.setTimeout(() => {
      document.addEventListener("click", clickHandler);
    }, 0);
    return () => {
      document.removeEventListener("keydown", handler);
      window.clearTimeout(timer);
      document.removeEventListener("click", clickHandler);
    };
  }, [popup, closeAddNodePopup]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 提示词/输入框内：把 Ctrl+Z 等留给浏览器，不要撤画布
      if (isCanvasTypingTarget(e)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const mod = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;

      // —— 创作快捷键（与帮助面板「创作」一致）——
      // 合并分镜组：Ctrl/Cmd + Alt + G
      if (mod && alt && !shift && key === "g") {
        e.preventDefault();
        handleMergeGroups();
        return;
      }
      // 解组：Ctrl/Cmd/Alt + Shift + G
      if (shift && key === "g" && (mod || alt) && !(mod && alt)) {
        e.preventDefault();
        handleUngroup();
        return;
      }
      // 成组：Ctrl/Cmd + G 或 Alt + G（不含 Ctrl+Alt）
      if (!shift && key === "g" && ((mod && !alt) || (alt && !mod))) {
        e.preventDefault();
        handleCreateGroup();
        return;
      }
      // 连线：Ctrl/Cmd + L
      if (mod && !alt && !shift && key === "l") {
        e.preventDefault();
        handleConnectSelected();
        return;
      }
      // 复制节点和连线：Ctrl/Cmd + D
      if (mod && !alt && !shift && key === "d") {
        e.preventDefault();
        duplicateSelectedNodes({ includeEdges: true });
        return;
      }
      // 复制到剪贴板：Ctrl/Cmd + C
      if (mod && !alt && !shift && key === "c") {
        e.preventDefault();
        copySelectionToClipboard();
        return;
      }
      // 粘贴：Ctrl/Cmd + V（优先内部节点剪贴板，否则系统图片）
      if (mod && !alt && !shift && key === "v") {
        e.preventDefault();
        const pasted = pasteClipboardNodes();
        if (pasted.length > 0) return;
        void (async () => {
          try {
            const items = await navigator.clipboard.read();
            const files: File[] = [];
            for (const item of items) {
              const type = item.types.find((t) => t.startsWith("image/"));
              if (!type) continue;
              const blob = await item.getType(type);
              const ext = type.split("/")[1] || "png";
              files.push(new File([blob], `paste-${Date.now()}.${ext}`, { type }));
            }
            if (files.length === 0) {
              toast.message("剪贴板为空：请先复制节点，或复制图片后再粘贴");
              return;
            }
            await handlePaneUploadFiles(files);
          } catch {
            toast.error("无法读取剪贴板，请检查浏览器权限");
          }
        })();
        return;
      }
      // 生成：Ctrl/Cmd + Enter
      if (mod && !alt && !shift && key === "Enter") {
        e.preventDefault();
        void runSelectionBatch({ selectedFlowIds });
        return;
      }
      // 新建节点：Tab
      if (!mod && !alt && !shift && key === "Tab") {
        e.preventDefault();
        openAddNodeAtCenter();
        return;
      }

      if (mod && key === "z" && !shift) {
        e.preventDefault();
        useCanvasStore.getState().undo();
      } else if (mod && key === "z" && shift) {
        e.preventDefault();
        useCanvasStore.getState().redo();
      } else if (mod && !shift && key === "y") {
        // Windows 习惯：Ctrl+Y 重做
        e.preventDefault();
        useCanvasStore.getState().redo();
      } else if (mod && key === "a") {
        e.preventDefault();
        useCanvasStore.getState().selectAllNodes();
      } else if (mod && key === "s") {
        e.preventDefault();
        useCanvasStore.getState().saveWorkflow();
      } else if (mod && key === "0") {
        e.preventDefault();
        rfInstanceRef.current?.fitView({ padding: 0.2 });
      } else if (mod && key === " ") {
        e.preventDefault();
        const current = useCanvasStore.getState().canvasMode;
        useCanvasStore.getState().setCanvasMode(current === "pointer" ? "drag" : "pointer");
      } else if (e.key === "Escape") {
        const state = useCanvasStore.getState();
        if (screenshotMode) {
          setScreenshotMode(false);
          return;
        }
        if (paneMenu) {
          setPaneMenu(null);
          return;
        }
        if (state.multiAngleNodeId) state.closeMultiAngle();
        else if (state.lightingNodeId) state.closeLighting();
        else state.selectNode(null);
        closeAddNodePopup();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    closeAddNodePopup,
    copySelectionToClipboard,
    duplicateSelectedNodes,
    handleConnectSelected,
    handleCreateGroup,
    handleMergeGroups,
    handlePaneUploadFiles,
    handleUngroup,
    openAddNodeAtCenter,
    paneMenu,
    pasteClipboardNodes,
    screenshotMode,
    selectedFlowIds,
  ]);

  const onNodeDragStart = useCallback<OnNodeDrag<CanvasFlowNode>>(
    (event, node) => {
      setCanvasDragging(true);
      // Alt+拖动：留下节点副本；Ctrl/Cmd+Alt+拖动：副本带选区内部连线
      if (!event.altKey) return;
      const state = useCanvasStore.getState();
      const ids =
        state.selectedFlowIds.includes(node.id) && state.selectedFlowIds.length > 0
          ? state.selectedFlowIds
          : [node.id];
      duplicateSelectedNodes({
        ids,
        includeEdges: event.ctrlKey || event.metaKey,
        leaveInPlace: true,
        silent: true,
      });
    },
    [duplicateSelectedNodes, setCanvasDragging]
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: { id: string }) => {
      setCanvasDragging(false);
      // 传入被拖节点，避免组内挪动对照旧组框误离组
      onNodeDragStop(node?.id);
    },
    [onNodeDragStop, setCanvasDragging]
  );

  return (
    <div
      ref={reactFlowWrapper}
      className={`relative h-full w-full ${isPointerMode ? "" : "cursor-grab"}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClickCapture={function (e) {
        if (!isPointerMode) return;
        const target = e.target as HTMLElement;
        // 节点本体双击保留给 onNodeDoubleClick（如导演台）
        if (target.closest(".react-flow__node")) return;
        // 编辑浮层、下拉（含 Portal）、输入控件内双击：阻断，不弹出「添加节点」
        if (
          target.closest(".canvas-node-overlay") ||
          target.closest("textarea") ||
          target.closest("input") ||
          target.closest("select") ||
          target.closest("[contenteditable='true']") ||
          target.closest("[data-slot='select-trigger']") ||
          target.closest("[data-slot='select-content']") ||
          target.closest("[data-slot='select-item']") ||
          target.closest("[role='combobox']") ||
          target.closest("[role='listbox']") ||
          target.closest("[role='option']") ||
          target.closest("[data-base-ui-portal]")
        ) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        // 双击会选中文字；清选区，避免菜单弹出后整表被选中高亮
        window.getSelection()?.removeAllRanges();
        const wrapper = reactFlowWrapper.current;
        if (wrapper) {
          const bounds = wrapper.getBoundingClientRect();
          setPendingWire(null);
          pendingWireRef.current = null;
          setPopup({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
          // 下一帧再清一次，防止新挂载菜单文本被连入选区
          requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
        }
      }}
    >
      <ReactFlow
        nodes={nodes} edges={safeEdges}
        onNodesChange={onNodesChange as any} onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick} onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeDoubleClick={(_, node) => {
          if (node.type === "director_stage" && projectId) {
            void navigateToDirectorStage(projectId, node.id, router.push);
          }
        }}
        onEdgeClick={function() {
          const state = useCanvasStore.getState();
          state.closeMultiAngle();
          state.closeLighting();
          state.closeStoryboardSheet();
          state.selectNode(null);
        }}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={onMoveEnd}
        onInit={(instance) => {
          rfInstanceRef.current = instance;
          scheduleViewportSync(instance.getViewport());
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        onlyRenderVisibleElements
        elevateNodesOnSelect
        // 拖动节点不自动选中；编辑弹窗仅在点击选中后出现
        selectNodesOnDrag={false}
        panOnDrag={isPointerMode ? [1, 2] : [0, 1, 2]}
        selectionOnDrag={isPointerMode && !inlineImageDrawTool && !inlineImageCrop && !screenshotMode}
        nodesDraggable={isPointerMode && !inlineImageDrawTool && !inlineImageCrop && !screenshotMode}
        nodesConnectable={isPointerMode}
        elementsSelectable={isPointerMode}
        deleteKeyCode={isPointerMode ? ["Delete", "Backspace"] : null}
        onBeforeDelete={onBeforeDelete}
        connectionRadius={CANVAS_CONNECTION_RADIUS}
        defaultEdgeOptions={{ type: "default", style: { strokeWidth: 2 }, animated: false, selectable: true, interactionWidth: 20 }}
        style={{ background: canvasSurface.bg }} minZoom={0.1} maxZoom={5}
        noDragClassName="nodrag"
        noPanClassName="nopan"
      >
        {gridVisible && (
          <Background
            variant={gridPattern === "dot" ? BackgroundVariant.Dots : BackgroundVariant.Lines}
            gap={20}
            size={1}
            color={gridPattern === "dot" ? canvasSurface.gridDot : canvasSurface.gridLine}
          />
        )}
        {/* 拖动节点时隐藏底部编辑弹窗，松手后若仍选中再显示 */}
        {selectedNodeId &&
        !isCanvasDragging &&
        !multiAngleNodeId &&
        !lightingNodeId &&
        !storyboardSheetKind &&
        !drawingBoardNodeId ? (
          <NodeEditorOverlay />
        ) : null}
        {/* 顶栏菜单后挂载，保证下拉叠在编辑浮层之上 */}
        <NodeTopMenuOverlay />
        <ConnectEdgeSync />
        <StoryboardGridTopMenuOverlay />
        {multiAngleNodeId ? <MultiAnglePanel /> : null}
        {lightingNodeId ? <LightingPanel /> : null}
        {/* 故事板/调度故事板：锚定在对应图片节点下方 */}
        {storyboardSheetKind ? <StoryboardSheetComposerPanel /> : null}
      </ReactFlow>

      {saveBtnStyle && (
        <div
          className="absolute z-40 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/70 p-1 shadow-lg"
          style={{
            left: saveBtnStyle.left,
            top: saveBtnStyle.top,
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {canCreateGroup ? (
            <button
              type="button"
              onClick={handleCreateGroup}
              title="成组 (Ctrl/Alt+G)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/85 hover:bg-primary/30 hover:text-white transition-colors"
            >
              <Layers className="h-3 w-3" />成组
            </button>
          ) : null}
          {selectionHasGroup ? (
            <button
              type="button"
              onClick={handleUngroup}
              title="解组 (Ctrl/Alt+Shift+G)"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/85 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Ungroup className="h-3 w-3" />解组
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void runSelectionBatch({ selectedFlowIds })}
            title="批量生成 (Ctrl+Enter)"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/85 hover:bg-primary/30 hover:text-white transition-colors"
          >
            <Play className="h-3 w-3" />批量生成
          </button>
          <button
            type="button"
            onClick={() => void handleSaveToLibrary()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/85 hover:bg-primary/30 hover:text-white transition-colors"
          >
            <FolderPlus className="h-3 w-3" />保存到组库
          </button>
        </div>
      )}

      <DrawingBoardModal />

      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) finishDeleteConfirm(false);
        }}
      >
        <DialogContent
          className="border-white/10 bg-[#14141f] text-white ring-white/10"
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>{deleteConfirmText.title}</DialogTitle>
            <DialogDescription className="text-white/55">
              {deleteConfirmText.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-white/10 bg-transparent">
            <Button
              type="button"
              variant="outline"
              className="border-white/15 bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => finishDeleteConfirm(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => finishDeleteConfirm(true)}
            >
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {popup && (
        <div
          className="absolute z-50 shadow-2xl"
          style={{ left: popup.x, top: popup.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <AddNodeMenuList
            useMouseDown
            onSelect={handlePopupAddNode}
            hint={pendingWire ? "松手位置将添加节点并自动连线" : undefined}
            enabledTypes={libraryWireEnabledTypes}
          />
        </div>
      )}

      {paneMenu ? (
        <CanvasPaneContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          canUndo={historyIndex >= 0}
          canRedo={historyFutureLen > 0}
          canSaveAsset={Boolean(
            (() => {
              const n = nodes.find((x) => x.id === selectedNodeId);
              return String((n?.data as WorkflowNodeData | undefined)?.params?.assetId ?? "").trim();
            })()
          )}
          onAction={(action) => {
            void handlePaneMenuAction(action);
          }}
          onClose={() => setPaneMenu(null)}
        />
      ) : null}

      {screenshotMode && paneSize.width > 0 ? (
        <CanvasScreenshotOverlay
          paneWidth={paneSize.width}
          paneHeight={paneSize.height}
          saving={screenshotSaving}
          onClose={() => setScreenshotMode(false)}
          onConfirm={(rect) => {
            void handleScreenshotConfirm(rect);
          }}
        />
      ) : null}

      <input
        ref={paneUploadInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void handlePaneUploadFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
