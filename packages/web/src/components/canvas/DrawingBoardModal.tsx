"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Hand,
  ImageIcon,
  Loader2,
  Minus,
  MousePointer2,
  Paintbrush,
  PaintBucket,
  Pipette,
  Redo2,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaAssetPicker } from "@/components/canvas/nodes/MediaAssetPicker";
import { NODE_IMAGE_SUBCATEGORY, notifyAssetsUpdated, uploadAsset, lookupAsset, fetchAssetById, type Asset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api/client";
import { formatCreditLabel } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { resolveMediaGenerationAssetId } from "@/lib/canvas/canvasToolGeneratedImage";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { useToolImageCreditQuote } from "@/lib/canvas/canvasToolImageModel";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { validateCanvasImageFile } from "@/lib/canvas/imageSizePolicy";
import { DrawingLayerPanel } from "@/components/canvas/DrawingLayerPanel";
import {
  fetchDrawingDraft,
  isDrawingDraftConflict,
  saveDrawingDraft as saveCloudDrawingDraft,
  saveDrawingDraftReplace,
} from "@/lib/api/drawingDrafts";
import {
  draftHasContent,
  loadDrawingBoardDraft,
  saveDrawingBoardDraft,
  type DrawingBoardDraft,
  type DrawingBoardDraftV1,
  type DrawingBoardSnapshot,
} from "@/lib/canvas/drawingBoard/draftStorage";
import { documentHasContent, migrateFlatSnapshotToDocument } from "@/lib/canvas/drawingBoard/documentModel";
import type { DrawingDocument } from "@/lib/canvas/drawingBoard/documentModel";
import { useDrawingBoardCanvas } from "@/lib/canvas/drawingBoard/useDrawingBoardCanvas";

import { ensureHttpsOssUrl, isSignedOssUrl } from "@/lib/signedUrl";
import type { WorkflowNodeData } from "@/types/workflow";
import {
  DRAWING_CANVAS_MAX_EDGE,
  DRAWING_CANVAS_MIN_EDGE,
  DRAWING_CANVAS_PRESETS,
  DRAWING_COLOR_PRESETS,
  clampDrawingCanvasSize,
  loadImageNaturalSize,
  normalizeDrawingCanvasSize,
  type DrawingBackground,
  type DrawingTool,
} from "@/lib/canvas/drawingBoard/types";

/** 画板 AI 固定算力工具 id（与后台 canvas_tool_pricing / models 对齐） */
const DRAWING_BOARD_AI_TOOL = "drawing_board_ai";

/** 左侧工具：激活态跟系统 primary */
function toolButtonClass(active: boolean): string {
  return `flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150 ${
    active
      ? "bg-primary/20 text-white shadow-[inset_0_0_0_1px_var(--panel-accent-border)]"
      : "text-white/45 hover:bg-white/[0.06] hover:text-white/90"
  }`;
}

/** 右侧栏分区标题：少字、轻量 */
function PanelHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="text-[12px] font-medium tracking-wide text-white/75">{title}</h3>
        {meta ? <span className="truncate text-[10px] text-white/30">{meta}</span> : null}
      </div>
      {action}
    </div>
  );
}

/** 分段选择（尺寸 / 背景 / 导出） */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`min-w-0 flex-1 rounded-md px-1.5 py-1.5 text-[11px] transition-all duration-150 ${
              active
                ? "bg-white/[0.1] text-white shadow-sm"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** 滑块行：标签 + 数值 + range */
function SliderRow({
  label,
  valueLabel,
  children,
  disabled,
}: {
  label: string;
  valueLabel: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-40" : undefined}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-white/40">{label}</span>
        <span className="tabular-nums text-white/55">{valueLabel}</span>
      </div>
      {children}
    </div>
  );
}

function boardRangeClass(disabled?: boolean): string {
  return `h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--primary)] disabled:cursor-not-allowed ${
    disabled ? "opacity-40" : ""
  }`;
}

const TOOL_LABELS: Record<string, string> = {
  select: "选择",
  hand: "平移",
  brush: "画笔",
  eraser: "橡皮",
  fill: "填充",
  line: "直线",
  rect: "矩形",
  ellipse: "椭圆",
  text: "文字",
  eyedropper: "取色",
};

function snapshotFromDraft(
  draft: DrawingBoardDraft,
  migrateFromFlat: typeof migrateFlatSnapshotToDocument
): DrawingBoardSnapshot {
  if (draft.version === 2) {
    return {
      document: draft.document,
      color: draft.color,
      brushSize: draft.brushSize,
      strokeOpacity: draft.strokeOpacity,
      fontSize: draft.fontSize,
      pressureEnabled: draft.pressureEnabled,
      symmetryVertical: draft.symmetryVertical,
      symmetryHorizontal: draft.symmetryHorizontal,
      cloudRevision: draft.cloudRevision ?? 0,
    };
  }
  const v1 = draft as DrawingBoardDraftV1;
  return {
    document: migrateFromFlat({
      canvasWidth: v1.canvasWidth,
      canvasHeight: v1.canvasHeight,
      background: v1.background,
      strokes: v1.strokes,
      reference: v1.reference,
    }),
    color: v1.color,
    brushSize: v1.brushSize,
    strokeOpacity: v1.strokeOpacity,
    fontSize: v1.fontSize,
    pressureEnabled: v1.pressureEnabled,
    symmetryVertical: v1.symmetryEnabled,
    symmetryHorizontal: false,
    cloudRevision: 0,
  };
}

/** 图片节点画图绘制全屏画板 */
export function DrawingBoardModal() {
  const drawingBoardNodeId = useCanvasStore((s) => s.drawingBoardNodeId);
  const drawingBoardIntent = useCanvasStore((s) => s.drawingBoardIntent);
  const closeDrawingBoard = useCanvasStore((s) => s.closeDrawingBoard);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const setNodeStatus = useCanvasStore((s) => s.setNodeStatus);
  const { assets, isLoading: assetsLoading } = useProjectAssetManifest(projectId);
  const queryClient = useQueryClient();
  const toolQuote = useToolImageCreditQuote(Boolean(drawingBoardNodeId), DRAWING_BOARD_AI_TOOL);

  const [applying, setApplying] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [portalMounted, setPortalMounted] = useState(false);
  /** 右侧：绘制工具 / AI 工具 */
  const [rightPanelMode, setRightPanelMode] = useState<"draw" | "ai">("draw");
  /** 画布/参考默认收起，侧栏先看工具与图层 */
  const [canvasPanelOpen, setCanvasPanelOpen] = useState(false);
  const [referencePanelOpen, setReferencePanelOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  /** 自定义画布宽高草稿（侧栏 + 底部尺寸条共用） */
  const [sizeDraftW, setSizeDraftW] = useState("");
  const [sizeDraftH, setSizeDraftH] = useState("");
  const [sizeEditing, setSizeEditing] = useState(false);

  useEffect(() => {
    setPortalMounted(true);
  }, []);

  // 全屏画板打开时锁定页面滚动，避免底层画布滚动穿透
  useEffect(() => {
    if (!drawingBoardNodeId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawingBoardNodeId]);

  const node = useMemo(
    () => (drawingBoardNodeId ? nodes.find((n) => n.id === drawingBoardNodeId) ?? null : null),
    [drawingBoardNodeId, nodes]
  );
  const nodeLabel = String((node?.data as WorkflowNodeData | undefined)?.label ?? "图片节点");
  const nodeParams = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  const nodeAssetId = String(nodeParams.assetId ?? "");
  const nodeImageUrl = String(nodeParams.imageUrl ?? "");

  const board = useDrawingBoardCanvas();
  const boardRef = useRef(board);
  boardRef.current = board;
  /** 防止 assets 刷新时重复 reset 已打开的画板 */
  const boardInitKeyRef = useRef<string | null>(null);

  /** 将图片节点当前图导入为参考层，并适配画布尺寸 */
  const seedNodeImageOntoBoard = useCallback(async () => {
    const fromAsset = nodeAssetId ? lookupAsset(assets, nodeAssetId) : null;
    const rawUrl = fromAsset?.fileUrl || nodeImageUrl;
    const url = rawUrl ? ensureHttpsOssUrl(rawUrl) || rawUrl : "";
    if (!url) return false;
    try {
      const natural = await loadImageNaturalSize(url);
      const size = clampDrawingCanvasSize(natural.width, natural.height);
      board.resizeCanvas(size.width, size.height, false);
      board.setReferenceLayer({
        assetId: nodeAssetId || fromAsset?.id || "node-image",
        url,
        opacity: 1,
        includeInExport: true,
      });
      // 载入节点图属于初始化，不算用户编辑，取消返回不应上传资产
      board.markClean();
      toast.message(`已载入节点图片 ${size.width}×${size.height}`);
      return true;
    } catch {
      toast.error("节点图片载入失败");
      return false;
    }
  }, [assets, board, nodeAssetId, nodeImageUrl]);

  useEffect(() => {
    if (!drawingBoardNodeId || !projectId) {
      boardInitKeyRef.current = null;
      return;
    }

    const intent = drawingBoardIntent ?? "draw";
    const initKey = `${drawingBoardNodeId}:${intent}`;

    // 有 assetId 但 manifest 未就绪时等一下，避免节点图 URL 解析失败
    if (
      intent === "draw" &&
      nodeAssetId &&
      !nodeImageUrl &&
      !lookupAsset(assets, nodeAssetId) &&
      assetsLoading
    ) {
      return;
    }

    if (boardInitKeyRef.current === initKey) return;
    boardInitKeyRef.current = initKey;

    board.resetBoard();
    setConfirmDiscard(false);
    setTextDraft("");
    setReferencePickerOpen(false);
    setRightPanelMode("draw");
    setAiPrompt("");
    setAiGenerating(false);

    void (async () => {
      // 「画图绘制」：不恢复旧草稿，直接带入节点当前图
      if (intent === "draw") {
        await seedNodeImageOntoBoard();
        return;
      }

      // 「继续编辑」：优先恢复草稿
      const local = loadDrawingBoardDraft(projectId, drawingBoardNodeId);
      let cloudDoc: DrawingDocument | null = null;
      let cloudRevision = 0;
      try {
        const cloud = await fetchDrawingDraft(projectId, drawingBoardNodeId);
        if (cloud.document && typeof cloud.document === "object" && cloud.document.version === 2) {
          cloudDoc = cloud.document as DrawingDocument;
          cloudRevision = cloud.revision ?? 0;
        }
      } catch {
        /* 离线时仅用本地草稿 */
      }

      const cloudHas = cloudDoc != null && documentHasContent(cloudDoc);
      const localHas = local != null && draftHasContent(local);

      if (localHas && cloudHas && local?.version === 2 && (local.cloudRevision ?? 0) !== cloudRevision) {
        const useCloud = window.confirm("检测到云端草稿与本地不一致，是否加载云端版本？");
        if (useCloud && cloudDoc) {
          board.loadSnapshot({
            document: cloudDoc,
            color: local.color,
            brushSize: local.brushSize,
            strokeOpacity: local.strokeOpacity,
            fontSize: local.fontSize,
            pressureEnabled: local.pressureEnabled,
            symmetryVertical: local.symmetryVertical,
            symmetryHorizontal: local.symmetryHorizontal,
            cloudRevision,
          });
          board.markClean();
          toast.message("已恢复云端画板草稿");
          return;
        }
      }

      if (localHas) {
        board.loadSnapshot(snapshotFromDraft(local, board.migrateFromFlat));
        board.markClean();
        toast.message("已恢复画板草稿");
        return;
      }

      if (cloudHas && cloudDoc) {
        board.loadSnapshot({
          document: cloudDoc,
          color: "#ffffff",
          brushSize: 8,
          strokeOpacity: 1,
          fontSize: 32,
          pressureEnabled: true,
          symmetryVertical: false,
          symmetryHorizontal: false,
          cloudRevision,
        });
        board.markClean();
        toast.message("已恢复云端画板草稿");
        return;
      }

      // 无草稿时回退为载入节点当前图
      await seedNodeImageOntoBoard();
    })();
  }, [
    assets,
    assetsLoading,
    board,
    drawingBoardIntent,
    drawingBoardNodeId,
    nodeAssetId,
    nodeImageUrl,
    projectId,
    seedNodeImageOntoBoard,
  ]);

  useEffect(() => {
    if (!drawingBoardNodeId || !projectId) return;
    const localTimer = window.setInterval(() => {
      const current = boardRef.current;
      if (current.dirty) {
        saveDrawingBoardDraft(projectId, drawingBoardNodeId, current.getSnapshot());
      }
    }, 3000);
    const cloudTimer = window.setInterval(() => {
      void (async () => {
        const current = boardRef.current;
        if (!current.dirty) return;
        try {
          const snap = current.getSnapshot();
          const saved = await saveCloudDrawingDraft(
            projectId,
            drawingBoardNodeId,
            snap.document,
            snap.cloudRevision
          );
          current.setCloudRevision(saved.revision);
          saveDrawingBoardDraft(projectId, drawingBoardNodeId, {
            ...snap,
            cloudRevision: saved.revision,
          });
        } catch (err) {
          if (isDrawingDraftConflict(err)) {
            toast.message("云端草稿已被其他会话更新");
          }
        }
      })();
    }, 10000);
    return () => {
      window.clearInterval(localTimer);
      window.clearInterval(cloudTimer);
    };
  }, [drawingBoardNodeId, projectId]);

  useEffect(() => {
    if (!board.pendingTextPoint) {
      setTextDraft("");
    }
  }, [board.pendingTextPoint]);

  useEffect(() => {
    if (!drawingBoardNodeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (board.pendingTextPoint) {
        if (e.key === "Escape") {
          e.preventDefault();
          board.setPendingTextPoint(null);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (board.dirty) setConfirmDiscard(true);
        else closeDrawingBoard();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) board.redo();
        else board.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawingBoardNodeId, board, closeDrawingBoard]);

  const handleCancel = useCallback(() => {
    if (board.dirty) {
      setConfirmDiscard(true);
      return;
    }
    closeDrawingBoard();
  }, [board.dirty, closeDrawingBoard]);

  /** 导出当前画板到资产并写回图片节点 */
  const commitDrawingToNode = useCallback(
    async (successMessage: string) => {
      if (!drawingBoardNodeId || !projectId || applying) return;
      if (!board.hasContent) {
        toast.message("请先绘制内容");
        return;
      }

      setApplying(true);
      try {
        const blob = await board.exportPngBlob();
        const sizeError = validateCanvasImageFile({ size: blob.size });
        if (sizeError) {
          toast.error(sizeError);
          return;
        }

        const file = new File(
          [blob],
          `drawing-${drawingBoardNodeId}-${Date.now()}.png`,
          { type: "image/png" }
        );
        const asset = await uploadAsset({
          file,
          projectId,
          category: "image",
          subcategory: NODE_IMAGE_SUBCATEGORY,
          title: `画板绘制 · ${nodeLabel}`,
        });

        const snap = board.getSnapshot();
        // 显式保存：强制覆盖该节点上一份云端草稿（同 nodeId 唯一文件）
        const draftRecord = await saveDrawingDraftReplace(
          projectId,
          drawingBoardNodeId,
          snap.document
        );
        board.setCloudRevision(draftRecord.revision);

        const currentParams =
          useCanvasStore.getState().nodes.find((n) => n.id === drawingBoardNodeId)?.data.params ??
          {};
        const imageUrl = asset.fileUrl
          ? isSignedOssUrl(asset.fileUrl)
            ? ensureHttpsOssUrl(asset.fileUrl)
            : asset.fileUrl
          : undefined;

        updateNodeData(drawingBoardNodeId, {
          params: {
            ...currentParams,
            assetId: asset.id,
            ...(imageUrl ? { imageUrl } : {}),
            drawingMeta: {
              source: "drawing_board",
              canvasWidth: snap.document.canvasWidth,
              canvasHeight: snap.document.canvasHeight,
            },
            // 节点草稿指针同步为本次覆盖写入的结果
            drawingDraft: {
              ossKey: draftRecord.ossKey,
              revision: draftRecord.revision,
              updatedAt: draftRecord.updatedAt,
            },
          },
        });

        notifyAssetsUpdated();
        // 本地草稿同 key 覆盖，下次打开同一节点即为本次内容
        saveDrawingBoardDraft(projectId, drawingBoardNodeId, {
          ...snap,
          cloudRevision: draftRecord.revision,
        });
        board.markClean();
        toast.success(successMessage);
        closeDrawingBoard();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "保存失败");
      } finally {
        setApplying(false);
      }
    },
    [
      applying,
      board,
      closeDrawingBoard,
      drawingBoardNodeId,
      nodeLabel,
      projectId,
      updateNodeData,
    ]
  );

  const handleApply = useCallback(async () => {
    await commitDrawingToNode("已应用到图片节点");
  }, [commitDrawingToNode]);

  /** 取消返回：仅在本次打开后有编辑时才保存到资产 */
  const handleCancelConfirm = useCallback(async () => {
    setConfirmDiscard(false);
    if (boardRef.current.dirty) {
      await commitDrawingToNode("已返回，内容已显示在图片节点");
      return;
    }
    closeDrawingBoard();
  }, [closeDrawingBoard, commitDrawingToNode]);

  /** 应用画布像素尺寸：默认保留图层内容（缩小可能裁切可视区域） */
  const applyCanvasSize = useCallback(
    (nextWidth: number, nextHeight: number, opts?: { confirmShrink?: boolean }) => {
      const size = normalizeDrawingCanvasSize(nextWidth, nextHeight);
      if (size.width === board.canvasWidth && size.height === board.canvasHeight) {
        setSizeDraftW(String(size.width));
        setSizeDraftH(String(size.height));
        return false;
      }
      const shrinking =
        size.width < board.canvasWidth || size.height < board.canvasHeight;
      if (
        opts?.confirmShrink !== false &&
        shrinking &&
        board.hasContent &&
        !window.confirm("缩小画布不会清空图层，但超出新边界的内容可能看不见。是否继续？")
      ) {
        setSizeDraftW(String(board.canvasWidth));
        setSizeDraftH(String(board.canvasHeight));
        return false;
      }
      board.resizeCanvas(size.width, size.height, false);
      setSizeDraftW(String(size.width));
      setSizeDraftH(String(size.height));
      toast.message(`画布已调整为 ${size.width}×${size.height}`);
      return true;
    },
    [board]
  );

  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = DRAWING_CANVAS_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      applyCanvasSize(preset.width, preset.height);
    },
    [applyCanvasSize]
  );

  const handleCustomSizeApply = useCallback(() => {
    const w = Number.parseInt(sizeDraftW, 10);
    const h = Number.parseInt(sizeDraftH, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      toast.error(`请输入 ${DRAWING_CANVAS_MIN_EDGE}–${DRAWING_CANVAS_MAX_EDGE} 的整数宽高`);
      setSizeDraftW(String(board.canvasWidth));
      setSizeDraftH(String(board.canvasHeight));
      return;
    }
    applyCanvasSize(w, h);
    setSizeEditing(false);
  }, [applyCanvasSize, board.canvasHeight, board.canvasWidth, sizeDraftH, sizeDraftW]);

  // 画布尺寸变化时同步侧栏/底部输入草稿
  useEffect(() => {
    setSizeDraftW(String(board.canvasWidth));
    setSizeDraftH(String(board.canvasHeight));
  }, [board.canvasWidth, board.canvasHeight]);

  const handleBackgroundChange = useCallback(
    (next: DrawingBackground) => {
      board.setBackground(next);
    },
    [board]
  );

  const handleTextConfirm = useCallback(() => {
    if (!board.pendingTextPoint) return;
    board.addTextStroke(textDraft, board.pendingTextPoint);
    setTextDraft("");
  }, [board, textDraft]);

  const selectTool = useCallback(
    (next: DrawingTool) => {
      board.setPendingTextPoint(null);
      board.setTool(next);
      setRightPanelMode("draw");
    },
    [board]
  );

  /** 画板 AI：导出当前画布 → 提交图生图任务 → 结果写入资产并新增图层 */
  const handleAiGenerate = useCallback(async () => {
    if (!drawingBoardNodeId || !projectId || aiGenerating || applying) return;
    const prompt = aiPrompt.trim();
    if (!prompt) {
      toast.error("请输入提示词");
      return;
    }
    if (!toolQuote.hasModel || !toolQuote.modelName) {
      toast.error("画板 AI 模型未配置，请在后台设置主模型");
      return;
    }

    setAiGenerating(true);
    try {
      const blob = await board.exportPngBlob();
      const sizeError = validateCanvasImageFile({ size: blob.size });
      if (sizeError) {
        toast.error(sizeError);
        return;
      }
      const sourceFile = new File(
        [blob],
        `drawing-ai-source-${drawingBoardNodeId}-${Date.now()}.png`,
        { type: "image/png" }
      );
      const sourceAsset = await uploadAsset({
        file: sourceFile,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: `画板 AI 输入 · ${nodeLabel}`,
      });
      const sourceUrl = sourceAsset.fileUrl
        ? ensureHttpsOssUrl(sourceAsset.fileUrl) || sourceAsset.fileUrl
        : "";
      if (!sourceUrl) {
        toast.error("画板图上传失败，无法提交生成");
        return;
      }

      setNodeStatus(drawingBoardNodeId, "running");
      const result = await generateFromMediaNode(
        {
          projectId,
          nodeId: drawingBoardNodeId,
          workflowId: workflowId ?? undefined,
          category: toolQuote.category,
          prompt,
          model: toolQuote.modelName,
          sourceUrl,
          generationOptions: toolQuote.defaultGenerationOptions,
          canvasTool: DRAWING_BOARD_AI_TOOL,
          assetSubcategory: NODE_IMAGE_SUBCATEGORY,
          assetTitle: `画板 AI · ${nodeLabel}`,
        },
        {
          idempotencyKey: newIdempotencyKey(`${drawingBoardNodeId}-drawing-ai`),
          quoteToken: toolQuote.quoteToken ?? undefined,
        }
      );

      maybeToastCreditCharged(result, toolQuote.creditsEnabled);

      // 异步入队时 status=pending，须轮询拿到 assetId（与多角度/打光同款）
      const resolved = await resolveMediaGenerationAssetId(result);
      if (!resolved.assetId) {
        if (result.status === "awaiting_approval") {
          setNodeStatus(drawingBoardNodeId, "idle");
          toast.message(resolved.errorMessage || "已提交审批，等待项目创建者确认");
          return;
        }
        setNodeStatus(drawingBoardNodeId, "error");
        toast.error(resolved.errorMessage || "生成失败");
        return;
      }

      const asset = await fetchAssetById(projectId, resolved.assetId);
      const resultUrl = asset?.fileUrl
        ? ensureHttpsOssUrl(asset.fileUrl) || asset.fileUrl
        : result.resultUrl
          ? ensureHttpsOssUrl(result.resultUrl) || result.resultUrl
          : "";
      if (!resultUrl) {
        setNodeStatus(drawingBoardNodeId, "error");
        toast.error("生成完成但未返回图片资产");
        return;
      }

      board.addImageLayer({
        name: `AI ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
        assetId: resolved.assetId,
        url: resultUrl,
        opacity: 1,
      });
      notifyAssetsUpdated();
      setNodeStatus(drawingBoardNodeId, "success");
      toast.success("AI 结果已写入资产并添加到画板图层");
    } catch (err) {
      setNodeStatus(drawingBoardNodeId, "error");
      if (isPricingChangedError(err)) {
        toastPricingChanged(() => void toolQuote.refetch?.());
        return;
      }
      if (handleCollaboratorSpendCapError(err)) return;
      toast.error(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "画板 AI 生成失败");
    } finally {
      setAiGenerating(false);
      void invalidateCanvasCreditQueries(queryClient, projectId);
    }
  }, [
    aiGenerating,
    aiPrompt,
    applying,
    board,
    drawingBoardNodeId,
    nodeLabel,
    projectId,
    queryClient,
    setNodeStatus,
    toolQuote,
    workflowId,
  ]);

  /** 从资产导入参考图：画布尺寸自动对齐图片（超大图等比缩小） */
  const handleReferenceSelect = useCallback(
    (asset: Asset) => {
      const url = ensureHttpsOssUrl(asset.fileUrl);
      if (!url) {
        toast.error("参考图地址无效");
        return;
      }
      void (async () => {
        try {
          const natural = await loadImageNaturalSize(url);
          const size = clampDrawingCanvasSize(natural.width, natural.height);
          if (
            size.width !== board.canvasWidth ||
            size.height !== board.canvasHeight
          ) {
            // 保留已有笔触，仅改画布像素尺寸以匹配参考图
            board.resizeCanvas(size.width, size.height, false);
          }
          // 空参考槽填入，已有则追加新层；不覆盖线稿/上色与已有参考
          board.importReferenceLayer({
            assetId: asset.id,
            url,
            opacity: 0.45,
            includeInExport: false,
          });
          setReferencePickerOpen(false);
          toast.success(`已新增参考图层，画布 ${size.width}×${size.height}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "参考图加载失败");
        }
      })();
    },
    [board]
  );

  if (!drawingBoardNodeId || !portalMounted) return null;

  const checkerboardVisible = board.background === "transparent";
  const activePreset =
    DRAWING_CANVAS_PRESETS.find(
      (p) => p.width === board.canvasWidth && p.height === board.canvasHeight
    )?.id ?? "";

  const activeToolLabel = TOOL_LABELS[board.tool] ?? "工具";
  /** 已导入图片的参考图层（可多层并存） */
  const referenceLayers = board.document.layers.filter(
    (l) => l.type === "reference" && l.reference != null
  );
  const activeReferenceLayer =
    referenceLayers.find((l) => l.id === board.document.activeLayerId) ??
    referenceLayers[referenceLayers.length - 1] ??
    null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col text-white"
      style={{ background: "var(--background)" }}
    >
      <header
        className="flex shrink-0 items-center justify-between border-b px-4 py-2.5"
        style={{ borderColor: "var(--chrome-frost-border)", background: "var(--chrome-frost)" }}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-white/90">画板</h2>
          <p className="truncate text-[11px] text-white/40">{nodeLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!board.canUndo || applying}
            onClick={board.undo}
            title="撤销 (Ctrl+Z)"
            className="h-8 w-8 px-0 text-white/65 hover:bg-white/10 hover:text-white"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!board.canRedo || applying}
            onClick={board.redo}
            title="重做"
            className="h-8 w-8 px-0 text-white/65 hover:bg-white/10 hover:text-white"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!board.dirty || applying}
            onClick={() => {
              if (window.confirm("确定清空画布？")) board.clearCanvas();
            }}
            title="清空画布"
            className="h-8 px-2.5 text-xs text-white/55 hover:bg-white/10 hover:text-white"
          >
            清空
          </Button>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={applying}
            onClick={handleCancel}
            className="h-8 px-2.5 text-xs text-white/55 hover:bg-white/10 hover:text-white"
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={applying || !board.hasContent}
            onClick={() => void handleApply()}
            className="h-8 bg-primary px-3 text-xs text-primary-foreground hover:opacity-90"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            应用到节点
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧工具栏：PS 式竖条，分组简约 */}
        <aside
          className="flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto border-r py-2.5"
          style={{ borderColor: "var(--chrome-frost-border)", background: "var(--sidebar)" }}
        >
          <button type="button" title="选择 (V)" onClick={() => selectTool("select")} className={toolButtonClass(board.tool === "select")}>
            <MousePointer2 className="h-4 w-4" />
          </button>
          <button type="button" title="平移 (H / 空格)" onClick={() => selectTool("hand")} className={toolButtonClass(board.tool === "hand")}>
            <Hand className="h-4 w-4" />
          </button>
          <div className="my-0.5 h-px w-7 bg-white/10" />
          <button type="button" title="画笔 (B)" onClick={() => selectTool("brush")} className={toolButtonClass(board.tool === "brush")}>
            <Paintbrush className="h-4 w-4" />
          </button>
          <button type="button" title="橡皮 (E)" onClick={() => selectTool("eraser")} className={toolButtonClass(board.tool === "eraser")}>
            <Eraser className="h-4 w-4" />
          </button>
          <button type="button" title="填充底色 (G)" onClick={() => selectTool("fill")} className={toolButtonClass(board.tool === "fill")}>
            <PaintBucket className="h-4 w-4" />
          </button>
          <div className="my-0.5 h-px w-7 bg-white/10" />
          <button type="button" title="直线" onClick={() => selectTool("line")} className={toolButtonClass(board.tool === "line")}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" title="矩形 (U)" onClick={() => selectTool("rect")} className={toolButtonClass(board.tool === "rect")}>
            <Square className="h-4 w-4" />
          </button>
          <button type="button" title="椭圆" onClick={() => selectTool("ellipse")} className={toolButtonClass(board.tool === "ellipse")}>
            <Circle className="h-4 w-4" />
          </button>
          <button type="button" title="文字 (T)" onClick={() => selectTool("text")} className={toolButtonClass(board.tool === "text")}>
            <Type className="h-4 w-4" />
          </button>
          <button type="button" title="取色 (I)" onClick={() => selectTool("eyedropper")} className={toolButtonClass(board.tool === "eyedropper")}>
            <Pipette className="h-4 w-4" />
          </button>
          <div className="my-0.5 h-px w-7 bg-white/10" />
          <button
            type="button"
            title="垂直对称绘制"
            onClick={() => board.setSymmetryVertical((v) => !v)}
            className={toolButtonClass(board.symmetryVertical)}
          >
            <FlipHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="水平对称绘制"
            onClick={() => board.setSymmetryHorizontal((v) => !v)}
            className={toolButtonClass(board.symmetryHorizontal)}
          >
            <FlipVertical className="h-4 w-4" />
          </button>
          {board.selectedStrokeId ? (
            <button
              type="button"
              title="删除选中笔画"
              onClick={board.deleteSelectedStroke}
              className={toolButtonClass(false)}
            >
              <Trash2 className="h-4 w-4 text-red-300/90" />
            </button>
          ) : null}
          <div className="my-0.5 h-px w-7 bg-white/10" />
          <button
            type="button"
            title="AI 改图"
            onClick={() => setRightPanelMode("ai")}
            className={toolButtonClass(rightPanelMode === "ai")}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </aside>

        <main
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center p-6 ${
            board.isPanningTool ? "cursor-grab" : ""
          }`}
          onWheel={board.onViewportWheel}
          onPointerDown={board.onViewportPointerDown}
          onPointerMove={board.onViewportPointerMove}
          onPointerUp={board.onViewportPointerUp}
          onPointerLeave={board.onViewportPointerUp}
        >
          <div
            className="relative"
            style={{
              transform: `translate(${board.viewPan.x}px, ${board.viewPan.y}px) scale(${board.viewScale})`,
              transformOrigin: "center center",
            }}
          >
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-lg border border-white/10 shadow-2xl"
            style={{
              aspectRatio: `${board.canvasWidth} / ${board.canvasHeight}`,
              width: `min(100%, calc((100vh - 180px) * ${board.canvasWidth / board.canvasHeight}))`,
              minWidth: 280,
              minHeight: 200,
              backgroundColor: checkerboardVisible ? "#1a1a28" : board.background,
              backgroundImage: checkerboardVisible
                ? "linear-gradient(45deg, #2a2a3a 25%, transparent 25%), linear-gradient(-45deg, #2a2a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a3a 75%), linear-gradient(-45deg, transparent 75%, #2a2a3a 75%)"
                : undefined,
              backgroundSize: checkerboardVisible ? "20px 20px" : undefined,
              backgroundPosition: checkerboardVisible ? "0 0, 0 10px, 10px -10px, -10px 0" : undefined,
            }}
          >
            <canvas
              ref={board.canvasRef}
              className={`absolute inset-0 h-full w-full touch-none pointer-events-auto ${
                board.tool === "eyedropper"
                  ? "cursor-cell"
                  : board.tool === "text"
                    ? "cursor-text"
                    : board.tool === "select"
                      ? "cursor-default"
                      : board.tool === "hand" || board.spacePanning
                        ? "cursor-grab"
                        : board.tool === "fill"
                          ? "cursor-cell"
                          : "cursor-crosshair"
              }`}
              onPointerDown={board.onPointerDown}
              onPointerMove={board.onPointerMove}
              onPointerUp={board.onPointerUp}
              onPointerLeave={board.onPointerLeave}
              onPointerCancel={board.onPointerLeave}
            />
            {/* 选择工具：选中笔触包围盒 */}
            {board.tool === "select" && board.selectedStrokeBounds ? (
              <div
                className="pointer-events-none absolute border border-dashed border-primary/80 bg-primary/10"
                style={{
                  left: `${(board.selectedStrokeBounds.x / board.canvasWidth) * 100}%`,
                  top: `${(board.selectedStrokeBounds.y / board.canvasHeight) * 100}%`,
                  width: `${(board.selectedStrokeBounds.w / board.canvasWidth) * 100}%`,
                  height: `${(board.selectedStrokeBounds.h / board.canvasHeight) * 100}%`,
                }}
              />
            ) : null}
            {/* 文字工具：文本框标识 */}
            {board.tool === "text" && board.pendingTextPoint ? (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-dashed border-sky-400/90 bg-sky-400/10"
                style={{
                  left: `${(board.pendingTextPoint.x / board.canvasWidth) * 100}%`,
                  top: `${(board.pendingTextPoint.y / board.canvasHeight) * 100}%`,
                  width: `${Math.min(40, (220 / board.canvasWidth) * 100)}%`,
                  height: `${Math.max(3, (board.fontSize * 1.3 / board.canvasHeight) * 100)}%`,
                  minWidth: 80,
                  minHeight: 24,
                }}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] text-white">
                  文本框
                </span>
              </div>
            ) : null}
            {board.tool === "text" && !board.pendingTextPoint ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <span className="rounded-md bg-black/55 px-2 py-1 text-[11px] text-white/75">
                  点击画布放置文本框
                </span>
              </div>
            ) : null}
          </div>
          </div>
          {!board.canDrawOnActiveLayer ? (
            <p className="mt-2 text-xs text-amber-300/90">
              当前图层不可绘制，请选择未锁定的「线稿 / 上色 / 图层」后再绘制
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-white/35">
            {sizeEditing ? (
              <span className="inline-flex items-center gap-1.5">
                <Input
                  type="number"
                  min={DRAWING_CANVAS_MIN_EDGE}
                  max={DRAWING_CANVAS_MAX_EDGE}
                  value={sizeDraftW}
                  onChange={(e) => setSizeDraftW(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomSizeApply();
                    if (e.key === "Escape") {
                      setSizeDraftW(String(board.canvasWidth));
                      setSizeDraftH(String(board.canvasHeight));
                      setSizeEditing(false);
                    }
                  }}
                  className="h-7 w-20 border-white/15 bg-white/5 px-2 text-xs text-white"
                  aria-label="画布宽度"
                />
                <span>×</span>
                <Input
                  type="number"
                  min={DRAWING_CANVAS_MIN_EDGE}
                  max={DRAWING_CANVAS_MAX_EDGE}
                  value={sizeDraftH}
                  onChange={(e) => setSizeDraftH(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCustomSizeApply();
                    if (e.key === "Escape") {
                      setSizeDraftW(String(board.canvasWidth));
                      setSizeDraftH(String(board.canvasHeight));
                      setSizeEditing(false);
                    }
                  }}
                  className="h-7 w-20 border-white/15 bg-white/5 px-2 text-xs text-white"
                  aria-label="画布高度"
                />
                <button
                  type="button"
                  className="rounded-md bg-primary/20 px-2 py-1 text-[11px] text-white ring-1 ring-[var(--panel-accent-border)]"
                  onClick={handleCustomSizeApply}
                >
                  应用
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="tabular-nums text-white/45 underline decoration-white/20 underline-offset-2 hover:text-white/70"
                title="点击自定义画布尺寸"
                onClick={() => setSizeEditing(true)}
              >
                {board.canvasWidth} × {board.canvasHeight}
              </button>
            )}
            <span className="text-white/25">·</span>
            <span>滚轮缩放 · 空格平移</span>
            <span className="text-white/25">·</span>
            <button
              type="button"
              className="tabular-nums text-white/45 underline decoration-white/20 underline-offset-2 hover:text-white/70"
              onClick={board.resetViewport}
              title="重置缩放"
            >
              {Math.round(board.viewScale * 100)}%
            </button>
            <span className="text-white/25">·</span>
            <span className="text-white/40">{activeToolLabel}</span>
          </div>

          {board.pendingTextPoint ? (
            <div className="absolute bottom-10 left-1/2 z-10 w-[min(360px,90vw)] -translate-x-1/2 rounded-xl border-2 border-dashed border-sky-400/50 bg-[rgba(18,18,28,0.98)] p-4 shadow-2xl">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] text-white">文本框</span>
                <p className="text-xs text-white/50">在标识位置输入文字，回车或点确定落笔</p>
              </div>
              <Input
                autoFocus
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTextConfirm();
                }}
                placeholder="输入文字…"
                className="border-sky-400/40 bg-white/5 text-white"
              />
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => board.setPendingTextPoint(null)}
                  className="text-white/70 hover:bg-white/10"
                >
                  取消
                </Button>
                <Button type="button" size="sm" onClick={handleTextConfirm}>
                  确定
                </Button>
              </div>
            </div>
          ) : null}
        </main>

        {/* 右侧：简约属性面板（工具 → 图层 → 画布/参考） */}
        <aside
          className="flex w-[248px] shrink-0 flex-col overflow-y-auto border-l"
          style={{
            borderColor: "var(--chrome-frost-border)",
            background: "color-mix(in srgb, var(--sidebar) 92%, black)",
          }}
        >
          <div className="flex flex-col gap-0 px-3 py-3">
            {rightPanelMode === "ai" ? (
              <section className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <PanelHead
                  title="AI 改图"
                  meta="图生图"
                  action={
                    <button
                      type="button"
                      onClick={() => setRightPanelMode("draw")}
                      className="text-[11px] text-white/40 transition-colors hover:text-white/75"
                    >
                      返回
                    </button>
                  }
                />
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="描述希望如何改图…"
                  rows={4}
                  disabled={aiGenerating}
                  className="w-full resize-none rounded-lg bg-black/20 px-2.5 py-2 text-xs text-white placeholder:text-white/25 outline-none ring-1 ring-white/[0.08] focus:ring-[var(--panel-accent-border)]"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    aiGenerating ||
                    applying ||
                    !aiPrompt.trim() ||
                    !toolQuote.hasModel ||
                    toolQuote.isLoading
                  }
                  onClick={() => void handleAiGenerate()}
                  className="mt-2.5 h-8 w-full rounded-lg bg-primary text-xs text-primary-foreground hover:opacity-90"
                >
                  {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {aiGenerating
                    ? "生成中…"
                    : `生成${
                        toolQuote.isLoading
                          ? ""
                          : ` · ${formatCreditLabel(toolQuote.total ?? 0, toolQuote.creditsEnabled)}`
                      }`}
                </Button>
                {!toolQuote.hasModel ? (
                  <p className="mt-2 text-[11px] text-amber-300/90">后台未配置画板 AI 主模型</p>
                ) : null}
              </section>
            ) : (
              <section className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
                <PanelHead title={activeToolLabel} meta="属性" />
                {board.tool !== "select" && board.tool !== "hand" && board.tool !== "eyedropper" ? (
                  <div className="space-y-3">
                    {/* 颜色：色板 + 取色点，避免占满宽的 color input */}
                    <div className={board.tool === "eraser" ? "opacity-40" : undefined}>
                      <div className="mb-1.5 text-[11px] text-white/40">颜色</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {DRAWING_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={board.tool === "eraser"}
                            onClick={() => board.setColor(preset)}
                            className={`h-6 w-6 rounded-full transition-transform ${
                              board.color === preset
                                ? "scale-110 ring-2 ring-primary ring-offset-1 ring-offset-[rgb(12,12,20)]"
                                : "ring-1 ring-white/15 hover:ring-white/35"
                            }`}
                            style={{ backgroundColor: preset }}
                            title={preset}
                          />
                        ))}
                        <label
                          className={`relative ml-0.5 h-6 w-6 overflow-hidden rounded-full ring-1 ring-white/20 ${
                            board.tool === "eraser" ? "pointer-events-none" : "cursor-pointer"
                          }`}
                          title="自定义颜色"
                        >
                          <span
                            className="absolute inset-0"
                            style={{ backgroundColor: board.color }}
                          />
                          <input
                            type="color"
                            value={board.color}
                            disabled={board.tool === "eraser"}
                            onChange={(e) => board.setColor(e.target.value)}
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                        </label>
                      </div>
                    </div>

                    <SliderRow
                      label={board.tool === "text" ? "描边" : "粗细"}
                      valueLabel={`${board.brushSize}px`}
                    >
                      <input
                        type="range"
                        min={1}
                        max={64}
                        value={board.brushSize}
                        onChange={(e) => board.setBrushSize(Number(e.target.value))}
                        className={boardRangeClass()}
                      />
                    </SliderRow>

                    {board.tool === "text" ? (
                      <SliderRow label="字号" valueLabel={`${board.fontSize}px`}>
                        <input
                          type="range"
                          min={12}
                          max={120}
                          value={board.fontSize}
                          onChange={(e) => board.setFontSize(Number(e.target.value))}
                          className={boardRangeClass()}
                        />
                      </SliderRow>
                    ) : null}

                    {board.tool === "rect" || board.tool === "ellipse" ? (
                      <button
                        type="button"
                        onClick={() => board.setShapeFilled(!board.shapeFilled)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ring-1 ${
                          board.shapeFilled
                            ? "bg-primary/15 text-white/85 ring-[var(--panel-accent-border)]"
                            : "bg-transparent text-white/45 ring-white/[0.08] hover:text-white/70"
                        }`}
                      >
                        {board.shapeFilled ? "实心填充 · 开" : "实心填充 · 关"}
                      </button>
                    ) : null}

                    <SliderRow
                      label="不透明度"
                      valueLabel={`${Math.round(board.opacity * 100)}%`}
                      disabled={board.tool === "eraser"}
                    >
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={Math.round(board.opacity * 100)}
                        disabled={board.tool === "eraser"}
                        onChange={(e) => board.setOpacity(Number(e.target.value) / 100)}
                        className={boardRangeClass(board.tool === "eraser")}
                      />
                    </SliderRow>

                    {board.tool === "brush" || board.tool === "eraser" ? (
                      <button
                        type="button"
                        onClick={() => board.setPressureEnabled(!board.pressureEnabled)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ring-1 ${
                          board.pressureEnabled
                            ? "bg-primary/15 text-white/85 ring-[var(--panel-accent-border)]"
                            : "bg-transparent text-white/45 ring-white/[0.08] hover:text-white/70"
                        }`}
                      >
                        {board.pressureEnabled ? "压感粗细 · 开" : "压感粗细 · 关"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] leading-relaxed text-white/35">
                    {board.tool === "select"
                      ? "点选笔画后可删除。"
                      : board.tool === "hand"
                        ? "拖移画布，或按住空格临时平移。"
                        : "点击画布取色后自动回到画笔。"}
                  </p>
                )}
              </section>
            )}

            <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            <section>
              <DrawingLayerPanel
                layers={board.document.layers}
                activeLayerId={board.document.activeLayerId}
                onSelectLayer={board.setActiveLayerId}
                onToggleVisible={(id) => {
                  const layer = board.document.layers.find((l) => l.id === id);
                  if (layer) board.updateLayer(id, { visible: !layer.visible });
                }}
                onToggleLocked={(id) => {
                  const layer = board.document.layers.find((l) => l.id === id);
                  if (layer) board.updateLayer(id, { locked: !layer.locked });
                }}
                onOpacityChange={(id, opacity) => {
                  board.updateLayer(id, { opacity });
                  const layer = board.document.layers.find((l) => l.id === id);
                  if (layer?.type === "reference" && layer.reference) {
                    board.updateReferenceLayer(id, { opacity });
                  }
                }}
                onFillColorChange={(id, fillColor) => board.updateLayer(id, { fillColor })}
                onMove={board.moveLayer}
                onAddLayer={board.addVectorLayer}
                onRemoveLayer={board.removeLayer}
              />
            </section>

            <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* 画布：默认收起，一行看清尺寸 */}
            <section>
              <button
                type="button"
                onClick={() => setCanvasPanelOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left transition-colors hover:bg-white/[0.03]"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-white/75">画布</span>
                  <span className="tabular-nums text-[10px] text-white/30">
                    {board.canvasWidth}×{board.canvasHeight}
                  </span>
                </div>
                {canvasPanelOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-white/30" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-white/30" />
                )}
              </button>
              {canvasPanelOpen ? (
                <div className="mt-2.5 space-y-3 px-0.5">
                  <div>
                    <div className="mb-1.5 text-[11px] text-white/40">比例</div>
                    <Segmented
                      value={activePreset || "__custom__"}
                      onChange={(id) => {
                        if (id !== "__custom__") handlePresetChange(id);
                      }}
                      options={[
                        ...DRAWING_CANVAS_PRESETS.map((p) => ({ id: p.id, label: p.label })),
                        ...(activePreset
                          ? []
                          : [{ id: "__custom__", label: "自定义" }]),
                      ]}
                    />
                    <div className="mt-2 flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={DRAWING_CANVAS_MIN_EDGE}
                        max={DRAWING_CANVAS_MAX_EDGE}
                        value={sizeDraftW}
                        onChange={(e) => setSizeDraftW(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCustomSizeApply();
                        }}
                        className="h-8 flex-1 border-0 bg-white/[0.04] px-2 text-xs text-white ring-1 ring-white/[0.08] focus-visible:ring-[var(--panel-accent-border)]"
                        aria-label="宽度"
                      />
                      <span className="text-white/25">×</span>
                      <Input
                        type="number"
                        min={DRAWING_CANVAS_MIN_EDGE}
                        max={DRAWING_CANVAS_MAX_EDGE}
                        value={sizeDraftH}
                        onChange={(e) => setSizeDraftH(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCustomSizeApply();
                        }}
                        className="h-8 flex-1 border-0 bg-white/[0.04] px-2 text-xs text-white ring-1 ring-white/[0.08] focus-visible:ring-[var(--panel-accent-border)]"
                        aria-label="高度"
                      />
                      <button
                        type="button"
                        onClick={handleCustomSizeApply}
                        className="h-8 shrink-0 rounded-lg bg-primary/20 px-2.5 text-[11px] text-white ring-1 ring-[var(--panel-accent-border)] transition-opacity hover:opacity-90"
                      >
                        应用
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] text-white/40">背景</div>
                    <Segmented
                      value={board.background}
                      onChange={(id) =>
                        handleBackgroundChange(id as "transparent" | "#ffffff" | "#000000")
                      }
                      options={[
                        { id: "transparent", label: "透明" },
                        { id: "#ffffff", label: "白" },
                        { id: "#000000", label: "黑" },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11px] text-white/40">导出</div>
                    <Segmented
                      value={board.exportMode}
                      onChange={(id) =>
                        board.setExportMode(id as "all" | "active-layer")
                      }
                      options={[
                        { id: "all", label: "全部图层" },
                        { id: "active-layer", label: "仅当前层" },
                      ]}
                    />
                  </div>
                </div>
              ) : null}
            </section>

            <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* 参考：一行主操作，细节按需展开 */}
            <section>
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-medium text-white/75">参考</span>
                  <span className="text-[10px] text-white/30">
                    {referenceLayers.length > 0 ? `${referenceLayers.length} 层` : "描摹用"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReferencePanelOpen((v) => !v)}
                  className="text-white/30 hover:text-white/60"
                  aria-label={referencePanelOpen ? "收起参考选项" : "展开参考选项"}
                >
                  {referencePanelOpen ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setReferencePickerOpen(true)}
                className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] text-[12px] text-white/70 ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.07] hover:text-white"
              >
                <ImageIcon className="h-3.5 w-3.5" />
                导入参考图
              </button>
              {referencePanelOpen && activeReferenceLayer?.reference ? (
                <div className="mt-2.5 space-y-2.5 px-0.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-white/40">{activeReferenceLayer.name}</span>
                    <button
                      type="button"
                      onClick={() => board.removeLayer(activeReferenceLayer.id)}
                      className="text-white/35 transition-colors hover:text-red-300/90"
                    >
                      移除
                    </button>
                  </div>
                  <SliderRow
                    label="透明度"
                    valueLabel={`${Math.round(activeReferenceLayer.opacity * 100)}%`}
                  >
                    <input
                      type="range"
                      min={5}
                      max={100}
                      value={Math.round(activeReferenceLayer.opacity * 100)}
                      onChange={(e) => {
                        const opacity = Number(e.target.value) / 100;
                        board.updateLayer(activeReferenceLayer.id, { opacity });
                        board.updateReferenceLayer(activeReferenceLayer.id, { opacity });
                      }}
                      className={boardRangeClass()}
                    />
                  </SliderRow>
                  <button
                    type="button"
                    onClick={() =>
                      board.updateReferenceLayer(activeReferenceLayer.id, {
                        includeInExport: !activeReferenceLayer.reference!.includeInExport,
                      })
                    }
                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors ring-1 ${
                      activeReferenceLayer.reference.includeInExport
                        ? "bg-primary/15 text-white/85 ring-[var(--panel-accent-border)]"
                        : "bg-transparent text-white/45 ring-white/[0.08] hover:text-white/70"
                    }`}
                  >
                    {activeReferenceLayer.reference.includeInExport
                      ? "导出包含参考 · 开"
                      : "导出包含参考 · 关"}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </aside>
      </div>

      {confirmDiscard ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
          <div className="w-[min(380px,90vw)] rounded-xl border border-white/10 bg-[rgba(18,18,28,0.98)] p-5 shadow-2xl">
            <h3 className="text-sm font-medium text-white/90">返回画布？</h3>
            <p className="mt-2 text-xs text-white/50">
              检测到本次有绘制改动。保存后将更新节点卡片图片并覆盖该节点画板草稿；也可点「继续绘制」返回画板。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={applying}
                onClick={() => setConfirmDiscard(false)}
                className="text-white/70 hover:bg-white/10"
              >
                继续绘制
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={applying}
                onClick={() => {
                  setConfirmDiscard(false);
                  closeDrawingBoard();
                }}
                className="text-white/70 hover:bg-white/10"
              >
                不保存返回
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={applying}
                onClick={() => void handleCancelConfirm()}
                className="bg-primary text-primary-foreground hover:opacity-90"
              >
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存并返回
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {referencePickerOpen ? (
        <MediaAssetPicker
          category="image"
          overlayZIndex={90}
          onSelect={handleReferenceSelect}
          onClose={() => setReferencePickerOpen(false)}
        />
      ) : null}
    </div>,
    document.body
  );
}
