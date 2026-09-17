"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { EdgeLabelRenderer } from "@xyflow/react";
import {
  Camera,
  CaptionsOff,
  ChevronDown,
  Clapperboard,
  Crop,
  Download,
  Eraser,
  Expand,
  FolderOpen,
  Loader2,
  Maximize2,
  Music2,
  Paintbrush,
  Pencil,
  PencilLine,
  ScanLine,
  Scissors,
  Smile,
  SquarePen,
  SquareSplitVertical,
  Upload,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSelectedCanvasNode } from "@/lib/canvas/useSelectedCanvasNode";
import { NODE_TITLE_HEIGHT, resolveNodeSize } from "@/lib/canvas/nodeSizing";
import {
  buildCanvasOverlayStyle,
  CANVAS_IMAGE_TOP_MENU_MAX_WIDTH,
  CANVAS_OVERLAY_DROPDOWN_CLASS,
  CANVAS_OVERLAY_Z_TOP_MENU,
  CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
  CANVAS_TOP_MENU_MAX_WIDTH,
  CANVAS_TOP_MENU_NODE_GAP,
  CANVAS_VIDEO_TOP_MENU_MAX_WIDTH,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";
import { usePromptSuffixTools, type PromptSuffixMenuItem } from "@/lib/canvas/usePromptSuffixTools";
import { renderAppendPrompt } from "@/lib/canvas/renderToolPrompt";
import {
  isCanvasSuffixI2iTool,
  useCanvasToolImageModel,
} from "@/lib/canvas/canvasToolImageModel";
import { attachMediaGenerationResultNode } from "@/lib/canvas/canvasToolGeneratedImage";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { formatCreditLabel, getCreditQuote } from "@/lib/api/credits";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasToolPricingMap } from "@/lib/canvas/useCanvasToolPricing";
import { useCanvasVideoToolQuoteCosts } from "@/lib/canvas/useCanvasVideoToolQuoteCosts";
import { useCanvasImageToolQuoteCosts } from "@/lib/canvas/useCanvasImageToolQuoteCosts";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { ApiError } from "@/lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  captureDisplayedVideoFramePreferElement,
  captureVideoFrameAtTimePreferElement,
  formatVideoTime,
  frameFileName,
} from "@/lib/canvas/captureVideoLastFrame";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { getVideoNodeRef } from "@/lib/canvas/videoNodeRegistry";
import { NODE_IMAGE_SUBCATEGORY, notifyAssetsUpdated, uploadAsset } from "@/lib/api/assets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import type { WorkflowNodeData } from "@/types/workflow";
import { GridSplitPopover } from "@/components/canvas/GridSplitPopover";
import { CreativeToolsPopoverPanel } from "@/components/canvas/CreativeToolsPopoverPanel";
import { ImageAnnotateToolbar } from "@/components/canvas/ImageAnnotateToolbar";
import { ImageEraseToolbar } from "@/components/canvas/ImageEraseToolbar";
import { ImageGenParamsToolbar } from "@/components/canvas/ImageGenParamsToolbar";
import { ImageRotateToolbar } from "@/components/canvas/ImageRotateToolbar";
import { ImageOutpaintToolbar } from "@/components/canvas/ImageOutpaintToolbar";
import { ImageOutpaintExpandFrame } from "@/components/canvas/ImageOutpaintExpandFrame";
import { ImageCropToolbar } from "@/components/canvas/ImageCropToolbar";
import { ImageCropFrame } from "@/components/canvas/ImageCropFrame";
import { bakeImageCropToAsset } from "@/lib/canvas/imageCrop";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";
import { DEFAULT_VISUAL_STYLE_ID } from "@/lib/canvas/renderToolPrompt";
import { runGridSplitOnNode } from "@/lib/canvas/runGridSplit";
import { bakeInlineDrawingToAsset, parseInlineImageDrawing } from "@/lib/canvas/inlineImageDrawing";
import {
  bakeImageTransformToAsset,
  hasImageTransform,
} from "@/lib/canvas/imageTransform";
import { createHdUpscaleNode, isHdUpscaleToolMode } from "@/lib/canvas/createHdUpscaleNode";
import { isLibraryUiLockedParams } from "@/lib/canvas/materialLibrary";
import { createRotateNode } from "@/lib/canvas/createRotateNode";
import { runCutoutGenerate } from "@/lib/canvas/runCutoutGenerate";
import { MIN_VIDEO_TRIM_SEC, trimVideoAsset } from "@/lib/canvas/videoTrim";
import { navigateToVideoEditor } from "@/lib/canvas/videoEditorNavigation";
import { cropVideoAsset } from "@/lib/canvas/videoCrop";
import { splitVideoAvAsset } from "@/lib/canvas/videoAvSplit";
import { runVideoStoryboardParse } from "@/lib/canvas/videoStoryboardParse";
import { STORYBOARD_FROM_VIDEO_TOOL } from "@/lib/canvas/viralRemakePipeline";
import {
  ensureVideoFrameEditDuration,
  findConnectedReferenceImageUrl,
  MAX_VIDEO_FRAME_EDIT_SEC,
  runLocalVideoFrameEdit,
  runUpstreamVideoFrameEdit,
  VIDEO_FRAME_EDIT_TOOLS,
  type VideoFrameEditMode,
} from "@/lib/canvas/videoFrameEdit";
import {
  runVideoVocalSeparate,
  type VocalSeparateMode,
} from "@/lib/canvas/videoVocalSeparate";
import {
  runVideoSubtitleErase,
  type SubtitleEraseMode,
} from "@/lib/canvas/videoSubtitleErase";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import {
  PORTRAIT_ADJUST_TOOLS,
  runPortraitAdjustGenerate,
  type PortraitAdjustKind,
} from "@/lib/canvas/runPortraitAdjustGenerate";

function TopMenuActionButton({
  label,
  icon,
  active = false,
  disabled = false,
  badge,
  withChevron = false,
  onClick,
  title,
  chevronOpen = false,
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** 右侧角标：可为「NEW」文案，或消耗算力（闪电+数字） */
  badge?: ReactNode;
  withChevron?: boolean;
  onClick: () => void;
  title?: string;
  chevronOpen?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "bg-purple-500/20 text-white ring-1 ring-purple-400/35"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon ? (
        <span className="flex size-[15px] shrink-0 items-center justify-center text-current [&_svg]:size-[15px]">
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
      {badge != null && badge !== false && badge !== "" ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <span className="rounded bg-sky-500/20 px-1 py-0.5 text-[10px] font-semibold leading-none text-sky-200">
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
      {withChevron ? (
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform ${chevronOpen ? "rotate-180" : ""}`}
        />
      ) : null}
    </button>
  );
}

interface TopMenuDropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** 右侧箭头，表示还有子菜单（暂可仅作视觉提示） */
  withChevron?: boolean;
  /** 消耗算力数量（UI：闪电+数字；勿再拼进 label） */
  creditCost?: number;
  creditLoading?: boolean;
  creditsEnabled?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** 顶栏下拉菜单：点击触发器展开，样式对齐产品截图 */
function TopMenuDropdown({
  label,
  icon,
  badge,
  disabled = false,
  active = false,
  open,
  onOpenChange,
  items,
  title,
}: {
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  active?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TopMenuDropdownItem[];
  title?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative">
      <TopMenuActionButton
        label={label}
        icon={icon}
        badge={badge}
        withChevron
        chevronOpen={open}
        disabled={disabled}
        active={open || active}
        title={title}
        onClick={() => onOpenChange(!open)}
      />
      {open ? (
        <div
          className={`absolute left-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 min-w-[156px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {item.icon ? (
                <span className="flex size-5 shrink-0 items-center justify-center text-white/70">
                  {item.icon}
                </span>
              ) : null}
              <span className="flex-1">{item.label}</span>
              {item.creditCost != null || item.creditLoading ? (
                <ToolCreditCostBadge
                  cost={item.creditCost}
                  creditsEnabled={item.creditsEnabled !== false}
                  loading={Boolean(item.creditLoading)}
                />
              ) : null}
              {item.withChevron ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-white/45" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HdMenuIcon() {
  return (
    <span className="rounded-[4px] border border-current px-0.5 text-[9px] font-bold leading-none">
      HD
    </span>
  );
}

/** 重绘菜单 · 标注（马克笔笔尖） */
function AnnotateMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 20 17.2 7.5a1.7 1.7 0 0 1 2.4-.15l.35.35a1.7 1.7 0 0 1-.15 2.4L10.6 21.2" />
      <path d="M7 18.2 9.6 20.6" />
      <path d="M14.6 8.2 17.8 11" />
    </svg>
  );
}

/** 重绘菜单 · 旋转（竖轴 + 水平轨道箭头） */
function RotateAxisMenuIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3.5v17" />
      <ellipse cx="12" cy="12" rx="8" ry="3.6" />
      <path d="M5.2 11.2 3.9 13.5 6.6 13.7" />
    </svg>
  );
}

/** 下拉项/按钮消耗算力：闪电 + 数字（与顶栏/生成条一致，文案放 title） */
function ToolCreditCostBadge({
  cost,
  creditsEnabled,
  loading,
}: {
  cost: number | undefined;
  creditsEnabled: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[12px] tabular-nums text-white/40">
        <Zap className="size-3 fill-current text-primary" aria-hidden />
        <span>…</span>
      </span>
    );
  }
  if (cost == null) return null;
  const title = formatCreditLabel(cost, creditsEnabled);
  const display = cost > 0 ? cost.toLocaleString() : "—";
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[12px] tabular-nums text-white/45"
      title={title}
      aria-label={title}
    >
      <Zap className="size-3 fill-current text-primary" aria-hidden />
      <span className="font-mono text-white/70">{display}</span>
    </span>
  );
}

const OVERLAY_STYLE = {
  background: "rgba(18, 18, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(139, 92, 246, 0.35)",
} as const;

function guessExtension(url: string, fallback: string): string {
  const clean = url.split("?")[0] ?? "";
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() || fallback;
}

/** 顶栏上传菜单：本地上传 / 从资产选择 */
function requestImageUploadAction(nodeId: string, action: "local" | "asset") {
  window.dispatchEvent(
    new CustomEvent(`canvas:image-upload-${action}`, { detail: { nodeId } })
  );
}

/** 视频顶栏上传菜单：本地上传 / 从资产选择 */
function requestVideoUploadAction(nodeId: string, action: "local" | "asset") {
  window.dispatchEvent(
    new CustomEvent(`canvas:video-upload-${action}`, { detail: { nodeId } })
  );
}

function resolveFrameCaptureTimeSec(
  kind: "first" | "last" | "current",
  video: HTMLVideoElement | undefined
): number {
  if (kind === "first") return 0;
  if (kind === "current") {
    if (video && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
      return video.currentTime;
    }
    return 0;
  }
  // 尾帧：优先用已加载时长；否则传大数，由 capture 侧在 metadata 就绪后 clamp
  // 余量与 captureVideoLastFrame.LAST_FRAME_EPSILON 对齐，避免贴 duration 定格首帧
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.max(0, video.duration - 0.08);
  }
  return Number.MAX_SAFE_INTEGER;
}

async function downloadMediaUrl(
  mediaUrl: string,
  filename: string,
  emptyMessage: string
) {
  const url = ensureHttpsOssUrl(mediaUrl);
  if (!url) {
    toast.error(emptyMessage);
    return;
  }
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }
}

export function NodeTopMenuOverlay() {
  const router = useRouter();
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const isCanvasDragging = useCanvasStore((s) => s.isCanvasDragging);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const edges = useCanvasStore((s) => s.edges);
  const multiAngleNodeId = useCanvasStore((s) => s.multiAngleNodeId);
  const lightingNodeId = useCanvasStore((s) => s.lightingNodeId);
  const drawingBoardNodeId = useCanvasStore((s) => s.drawingBoardNodeId);
  const framePickNodeId = useCanvasStore((s) => s.framePickNodeId);
  const framePickTimeSec = useCanvasStore((s) => s.framePickTimeSec);
  const inlineVideoTrim = useCanvasStore((s) => s.inlineVideoTrim);
  const openInlineVideoTrim = useCanvasStore((s) => s.openInlineVideoTrim);
  const closeInlineVideoTrim = useCanvasStore((s) => s.closeInlineVideoTrim);
  const inlineVideoCrop = useCanvasStore((s) => s.inlineVideoCrop);
  const openInlineVideoCrop = useCanvasStore((s) => s.openInlineVideoCrop);
  const closeInlineVideoCrop = useCanvasStore((s) => s.closeInlineVideoCrop);
  const patchInlineVideoCrop = useCanvasStore((s) => s.patchInlineVideoCrop);
  const topMenuCloseSeq = useCanvasStore((s) => s.topMenuCloseSeq);
  const setGenerationOptionsExpanded = useCanvasStore((s) => s.setGenerationOptionsExpanded);
  const node = useSelectedCanvasNode();
  const isImageNode = node?.type === "image_input";
  const isVideoNode = node?.type === "video_input";
  const isAudioNode = node?.type === "audio_input";
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const openMultiAngle = useCanvasStore((s) => s.openMultiAngle);
  const openLighting = useCanvasStore((s) => s.openLighting);
  const openDrawingBoard = useCanvasStore((s) => s.openDrawingBoard);
  const closeFramePick = useCanvasStore((s) => s.closeFramePick);
  const inlineImageDrawTool = useCanvasStore((s) => s.inlineImageDrawTool);
  const setInlineImageDrawTool = useCanvasStore((s) => s.setInlineImageDrawTool);
  const setInlineImageDrawColor = useCanvasStore((s) => s.setInlineImageDrawColor);
  const clearInlineImageDrawTool = useCanvasStore((s) => s.clearInlineImageDrawTool);
  const inlineImageEraseMode = useCanvasStore((s) => s.inlineImageEraseMode);
  const inlineImageEraseParams = useCanvasStore((s) => s.inlineImageEraseParams);
  const openInlineImageErase = useCanvasStore((s) => s.openInlineImageErase);
  const closeInlineImageErase = useCanvasStore((s) => s.closeInlineImageErase);
  const patchInlineImageEraseParams = useCanvasStore((s) => s.patchInlineImageEraseParams);
  const inlineImageTransform = useCanvasStore((s) => s.inlineImageTransform);
  const closeInlineImageTransform = useCanvasStore((s) => s.closeInlineImageTransform);
  const inlineImageOutpaint = useCanvasStore((s) => s.inlineImageOutpaint);
  const openInlineImageOutpaint = useCanvasStore((s) => s.openInlineImageOutpaint);
  const closeInlineImageOutpaint = useCanvasStore((s) => s.closeInlineImageOutpaint);
  const inlineImageCrop = useCanvasStore((s) => s.inlineImageCrop);
  const openInlineImageCrop = useCanvasStore((s) => s.openInlineImageCrop);
  const closeInlineImageCrop = useCanvasStore((s) => s.closeInlineImageCrop);
  const addNodeFromAsset = useCanvasStore((s) => s.addNodeFromAsset);
  const connectNodes = useCanvasStore((s) => s.connectNodes);
  const viewportZoom = useCanvasStore((s) => s.viewport.zoom);
  const allNodes = useCanvasStore((s) => s.nodes);
  const setNodeStatus = useCanvasStore((s) => s.setNodeStatus);
  const { items: promptSuffixItems } = usePromptSuffixTools();
  const {
    modelName: toolModelName,
    hasModel: hasToolModel,
    defaultGenerationOptions: toolGenerationOptions,
  } = useCanvasToolImageModel();
  /** 画面编辑·主体消除/修改/替换：后台可切换的视频主模型与默认生成参数 */
  const {
    modelName: videoFrameRemoveModelName,
    defaultGenerationOptions: videoFrameRemoveGenerationOptions,
  } = useCanvasToolConfiguredModel(
    "video_subject_remove",
    Boolean(selectedNodeId && isVideoNode),
    "video"
  );
  const {
    modelName: videoFrameEditModelName,
    defaultGenerationOptions: videoFrameEditGenerationOptions,
  } = useCanvasToolConfiguredModel(
    "video_subject_edit",
    Boolean(selectedNodeId && isVideoNode),
    "video"
  );
  const {
    modelName: videoFrameReplaceModelName,
    defaultGenerationOptions: videoFrameReplaceGenerationOptions,
  } = useCanvasToolConfiguredModel(
    "video_subject_replace",
    Boolean(selectedNodeId && isVideoNode),
    "video"
  );
  /** 人像质感调节：后台可切换的图片主模型 */
  const {
    modelName: portraitAdjustModelName,
    defaultGenerationOptions: portraitAdjustGenerationOptions,
  } = useCanvasToolConfiguredModel(
    "portrait_adjust",
    Boolean(selectedNodeId && isImageNode),
    "image"
  );
  const {
    modelName: emotionAdjustModelName,
    defaultGenerationOptions: emotionAdjustGenerationOptions,
  } = useCanvasToolConfiguredModel(
    "emotion_adjust",
    Boolean(selectedNodeId && isImageNode),
    "image"
  );
  const {
    costByTool: platformCostByTool,
    creditsEnabled: platformCreditsEnabled,
    isLoading: platformPricingLoading,
    refetch: refetchToolPricing,
  } = useCanvasToolPricingMap(Boolean(selectedNodeId && (isImageNode || isVideoNode)));
  // 图片/分镜工具顶栏：与提交同路径 quote（后台主模型默认档），避免批量定价预览为 0
  const {
    costByTool: imageQuoteCostByTool,
    isLoading: imageToolQuoteLoading,
    creditsEnabled: imageToolCreditsEnabled,
    refetch: refetchImageToolQuotes,
  } = useCanvasImageToolQuoteCosts(Boolean(selectedNodeId && (isImageNode || isVideoNode)));
  const costByTool = useMemo(() => {
    const merged: Record<string, number | undefined> = { ...platformCostByTool };
    for (const [toolId, total] of Object.entries(imageQuoteCostByTool)) {
      if (total != null) merged[toolId] = total;
    }
    return merged;
  }, [imageQuoteCostByTool, platformCostByTool]);
  const toolCreditsEnabled = imageToolCreditsEnabled && platformCreditsEnabled;
  const toolPricingLoading = platformPricingLoading || imageToolQuoteLoading;
  const queryClient = useQueryClient();
  const [savingFrame, setSavingFrame] = useState(false);
  const [savingTrim, setSavingTrim] = useState(false);
  const [savingVideoCrop, setSavingVideoCrop] = useState(false);
  const [parsingVideoStoryboard, setParsingVideoStoryboard] = useState(false);
  const [parseVideoProgress, setParseVideoProgress] = useState("");
  const [splittingAv, setSplittingAv] = useState(false);
  const [vocalSeparateBusy, setVocalSeparateBusy] = useState(false);
  const [subtitleEraseBusy, setSubtitleEraseBusy] = useState(false);
  const [frameEditBusy, setFrameEditBusy] = useState(false);
  const [savingAnnotate, setSavingAnnotate] = useState(false);
  const [savingRotate, setSavingRotate] = useState(false);
  const [savingCrop, setSavingCrop] = useState(false);
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [portraitAdjustBusy, setPortraitAdjustBusy] = useState(false);
  const [cropImageAspect, setCropImageAspect] = useState(1);
  const [videoCropAspect, setVideoCropAspect] = useState(16 / 9);
  const [generatingSuffixTool, setGeneratingSuffixTool] = useState<string | null>(null);
  const [gridSplitOpen, setGridSplitOpen] = useState(false);
  const [gridSplitBusy, setGridSplitBusy] = useState(false);
  const [gridSplitProgress, setGridSplitProgress] = useState("");
  const [portraitMenuOpen, setPortraitMenuOpen] = useState(false);
  const [redrawMenuOpen, setRedrawMenuOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [creativeToolsMenuOpen, setCreativeToolsMenuOpen] = useState(false);
  const [frameCaptureMenuOpen, setFrameCaptureMenuOpen] = useState(false);
  const [videoSubtitleMenuOpen, setVideoSubtitleMenuOpen] = useState(false);
  const [videoAudioMenuOpen, setVideoAudioMenuOpen] = useState(false);
  const [videoFrameEditMenuOpen, setVideoFrameEditMenuOpen] = useState(false);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const creativeToolsMenuRef = useRef<HTMLDivElement>(null);
  const frameCaptureMenuRef = useRef<HTMLDivElement>(null);
  /** 应用内全屏预览（替代 window.open，便于右上角关闭） */
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);

  const closeAllTopMenus = useCallback(() => {
    setGridSplitOpen(false);
    setPortraitMenuOpen(false);
    setRedrawMenuOpen(false);
    setUploadMenuOpen(false);
    setCreativeToolsMenuOpen(false);
    setFrameCaptureMenuOpen(false);
    setVideoSubtitleMenuOpen(false);
    setVideoAudioMenuOpen(false);
    setVideoFrameEditMenuOpen(false);
  }, []);

  // 切换选中节点时关闭切分面板与下拉菜单
  useEffect(() => {
    setGridSplitBusy(false);
    setGridSplitProgress("");
    closeAllTopMenus();
    setMediaPreviewUrl(null);
    setGenerationOptionsExpanded(false);
  }, [selectedNodeId, closeAllTopMenus, setGenerationOptionsExpanded]);

  // 底部参数面板展开时关闭顶栏下拉，避免菜单压住分辨率/比例弹层
  useEffect(() => {
    if (topMenuCloseSeq <= 0) return;
    closeAllTopMenus();
  }, [topMenuCloseSeq, closeAllTopMenus]);

  // 点击外部关闭上传下拉
  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!uploadMenuRef.current?.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUploadMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [uploadMenuOpen]);

  // 点击外部关闭九宫格创作工具下拉
  useEffect(() => {
    if (!creativeToolsMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!creativeToolsMenuRef.current?.contains(e.target as Node)) setCreativeToolsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreativeToolsMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [creativeToolsMenuOpen]);

  // 点击外部关闭视频截帧下拉
  useEffect(() => {
    if (!frameCaptureMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!frameCaptureMenuRef.current?.contains(e.target as Node)) setFrameCaptureMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFrameCaptureMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [frameCaptureMenuOpen]);

  // Esc 关闭全屏预览
  useEffect(() => {
    if (!mediaPreviewUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMediaPreviewUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mediaPreviewUrl]);

  // Esc 退出标注 / 擦除 / 旋转 / 扩图 / 裁剪模式
  useEffect(() => {
    if (!inlineImageDrawTool && !inlineImageTransform && !inlineImageOutpaint && !inlineImageCrop) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (inlineImageEraseMode) closeInlineImageErase();
      else if (inlineImageDrawTool) clearInlineImageDrawTool();
      if (inlineImageTransform) closeInlineImageTransform();
      if (inlineImageOutpaint) closeInlineImageOutpaint();
      if (inlineImageCrop) closeInlineImageCrop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    clearInlineImageDrawTool,
    closeInlineImageCrop,
    closeInlineImageErase,
    closeInlineImageOutpaint,
    closeInlineImageTransform,
    inlineImageCrop,
    inlineImageDrawTool,
    inlineImageEraseMode,
    inlineImageOutpaint,
    inlineImageTransform,
  ]);

  const framePickActive = Boolean(isVideoNode && selectedNodeId && framePickNodeId === selectedNodeId);
  const trimActive = Boolean(
    isVideoNode && selectedNodeId && inlineVideoTrim?.nodeId === selectedNodeId
  );
  const videoCropActive = Boolean(
    isVideoNode && selectedNodeId && inlineVideoCrop?.nodeId === selectedNodeId
  );
  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  /** 完整剪辑导出的成片节点：可回填时间线再编辑 */
  const isComposeNode =
    String(params.toolMode ?? "") === "video_compose" &&
    Boolean(params.composeMeta && typeof params.composeMeta === "object");
  const { url: imageUrl } = useNodeAssetMedia(selectedNodeId ?? "", { urlParamKey: "imageUrl" });
  const { url: videoUrl } = useNodeAssetMedia(selectedNodeId ?? "", { urlParamKey: "videoUrl" });
  const { url: audioUrl } = useNodeAssetMedia(selectedNodeId ?? "", { urlParamKey: "audioUrl" });
  // 视频顶栏报价：必须用当前节点可播放地址读真实片长（3s/15s 不同价）
  const {
    videoToolCost,
    isLoading: videoToolQuoteLoading,
    creditsEnabled: videoToolCreditsEnabled,
    refetch: refetchVideoToolQuotes,
  } = useCanvasVideoToolQuoteCosts(
    node ?? undefined,
    Boolean(selectedNodeId && isVideoNode),
    videoUrl
  );
  const refetchAllToolPricing = useCallback(() => {
    void refetchToolPricing();
    void refetchImageToolQuotes();
    void refetchVideoToolQuotes();
  }, [refetchImageToolQuotes, refetchToolPricing, refetchVideoToolQuotes]);

  // 进入裁剪时读取原图宽高比，供「原图比例」锁定
  useEffect(() => {
    if (!inlineImageCrop || !imageUrl) {
      setCropImageAspect(1);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      setCropImageAspect(Math.max(0.01, w / h));
    };
    img.onerror = () => {
      if (!cancelled) setCropImageAspect(1);
    };
    // 与烘焙一致：优先同源 stream，避免跨域污染
    img.src = canvasStreamUrlFromUrl(imageUrl) || imageUrl;
    return () => {
      cancelled = true;
    };
  }, [inlineImageCrop, imageUrl]);

  const hasInlineStrokes = Boolean(
    parseInlineImageDrawing((node?.data as WorkflowNodeData | undefined)?.params?.inlineImageDrawing)
      ?.strokes.length
  );
  const panoramaItem = promptSuffixItems.find((item) => item.tool === "panorama");
  const grid9Item = promptSuffixItems.find((item) => item.tool === "grid_9");
  const drawingMeta = params.drawingMeta as { source?: string } | undefined;
  const drawingDraft = params.drawingDraft as { ossKey?: string } | undefined;
  const canContinueDrawingBoard = Boolean(
    imageUrl && (drawingMeta?.source === "drawing_board" || drawingDraft?.ossKey)
  );
  const visualStyleId =
    typeof params.visualStyleId === "string" && params.visualStyleId.trim()
      ? params.visualStyleId.trim()
      : DEFAULT_VISUAL_STYLE_ID;
  const nodeModelName = typeof params.model === "string" ? params.model : "";

  useEffect(() => {
    if (!framePickActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFramePick();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [framePickActive, closeFramePick]);

  useEffect(() => {
    if (!trimActive || savingTrim) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInlineVideoTrim();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trimActive, savingTrim, closeInlineVideoTrim]);

  useEffect(() => {
    if (!videoCropActive || savingVideoCrop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInlineVideoCrop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoCropActive, savingVideoCrop, closeInlineVideoCrop]);

  // 视频裁剪：用 video 元素宽高比作「原图比例」
  useEffect(() => {
    if (!videoCropActive || !selectedNodeId) {
      setVideoCropAspect(16 / 9);
      return;
    }
    const video = getVideoNodeRef(selectedNodeId);
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoCropAspect(video.videoWidth / video.videoHeight);
      return;
    }
    setVideoCropAspect(16 / 9);
  }, [videoCropActive, selectedNodeId, videoUrl]);

  const appendPromptSuffix = useCallback(
    (item: Pick<PromptSuffixMenuItem, "content" | "joiner">, currentPrompt: string) => {
      const current = currentPrompt.trim();
      const suffix = item.content.trim();
      if (!suffix) return current;
      if (current.includes(suffix)) return current;
      return renderAppendPrompt(
        { kind: "append", menuLabel: "", appendText: item.content, joiner: item.joiner ?? "，" },
        { base: current }
      );
    },
    []
  );

  const handleSuffixToolClick = useCallback(
    async (item: PromptSuffixMenuItem) => {
      if (!selectedNodeId || !projectId || !node || !isImageNode) return;

      const currentPrompt = String(params.prompt ?? "").trim();
      const nextPrompt = appendPromptSuffix(item, currentPrompt);
      if (!nextPrompt.trim()) {
        toast.error("请在后台配置该工具的追加文案");
        return;
      }

      if (!isCanvasSuffixI2iTool(item.tool)) {
        if (nextPrompt === currentPrompt) {
          toast.message("该文案已在 prompt 中");
          return;
        }
        updateNodeParam(selectedNodeId, "prompt", nextPrompt);
        return;
      }

      // 图生图工具（全景/九宫格等）无参考图时禁止进入生成
      if (!imageUrl) {
        toast.error("请先上传参考图片");
        return;
      }

      if (!hasToolModel || !toolModelName) {
        toast.error("全能图片 Pro 图生图未配置或不可用");
        return;
      }

      if (generatingSuffixTool) return;

      setGeneratingSuffixTool(item.tool);
      updateNodeParam(selectedNodeId, "prompt", nextPrompt);
      setNodeStatus(selectedNodeId, "running");

      try {
        const sourceUrl = await resolveNodeMediaUrl(projectId, params, "imageUrl");
        if (!sourceUrl) {
          setNodeStatus(selectedNodeId, "idle");
          toast.error("请先上传参考图片");
          return;
        }

        const quote = await getCreditQuote({
          model: toolModelName,
          category: "image",
          generationOptions: toolGenerationOptions,
          canvasTool: item.tool,
        });

        const result = await generateFromMediaNode(
          {
            projectId,
            nodeId: selectedNodeId,
            workflowId: workflowId ?? undefined,
            category: "image",
            prompt: nextPrompt,
            model: toolModelName,
            sourceUrl,
            generationOptions: toolGenerationOptions,
            canvasTool: item.tool,
          },
          {
            idempotencyKey: newIdempotencyKey(`${selectedNodeId}-${item.tool}`),
            quoteToken: quote.quoteToken,
          }
        );

        maybeToastCreditCharged(result, toolCreditsEnabled);

        const attached = await attachMediaGenerationResultNode({
          projectId,
          result,
          sourceNodeId: selectedNodeId,
          sourcePosition: node.position,
          sourceWidth: node.width,
          sourceHeight: node.height,
          sourceLabel: node.data.label,
          edges,
          nodeTitle: `${item.label} · ${node.data.label || "图片"}`,
          prompt: nextPrompt,
          model: toolModelName,
          generationOptions: toolGenerationOptions,
        });

        if (!attached.ok) {
          setNodeStatus(selectedNodeId, "error");
          toast.error(attached.errorMessage);
          return;
        }

        setNodeStatus(selectedNodeId, "success");
        toast.success(`${item.label}图片已生成并已连接原图`);
      } catch (err) {
        setNodeStatus(selectedNodeId, "error");
        if (isPricingChangedError(err)) {
          toastPricingChanged(() => void refetchAllToolPricing());
          return;
        }
        if (handleCollaboratorSpendCapError(err)) return;
        const detail = err instanceof ApiError ? err.message : undefined;
        toast.error(detail || `${item.label}生成失败`);
      } finally {
        setGeneratingSuffixTool(null);
        void invalidateCanvasCreditQueries(queryClient, projectId);
      }
    },
    [
      selectedNodeId,
      projectId,
      node,
      isImageNode,
      params,
      appendPromptSuffix,
      imageUrl,
      hasToolModel,
      toolModelName,
      generatingSuffixTool,
      updateNodeParam,
      setNodeStatus,
      workflowId,
      toolGenerationOptions,
      toolCreditsEnabled,
      edges,
      refetchAllToolPricing,
      queryClient,
    ]
  );

  const handleGridSplitConfirm = useCallback(
    async (rows: number, cols: number) => {
      if (!selectedNodeId || !projectId || !isImageNode) return;
      if (!imageUrl) {
        toast.error("请先上传参考图片");
        return;
      }
      if (!hasToolModel || !toolModelName) {
        toast.error("全能图片 Pro 图生图未配置或不可用（用于算力结算）");
        return;
      }
      if (gridSplitBusy || generatingSuffixTool) return;

      setGridSplitBusy(true);
      setGridSplitProgress("准备中…");
      try {
        const ok = await runGridSplitOnNode({
          projectId,
          nodeId: selectedNodeId,
          workflowId,
          modelName: toolModelName,
          rows,
          cols,
          creditsEnabled: toolCreditsEnabled,
          queryClient,
          onProgress: setGridSplitProgress,
          refetchPricing: refetchAllToolPricing,
        });
        if (ok) setGridSplitOpen(false);
      } finally {
        setGridSplitBusy(false);
        setGridSplitProgress("");
      }
    },
    [
      selectedNodeId,
      projectId,
      isImageNode,
      imageUrl,
      hasToolModel,
      toolModelName,
      gridSplitBusy,
      generatingSuffixTool,
      workflowId,
      toolCreditsEnabled,
      queryClient,
      refetchAllToolPricing,
    ]
  );

  const handleDownloadImage = useCallback(async () => {
    if (!selectedNodeId) return;
    await downloadMediaUrl(
      imageUrl,
      `image-${selectedNodeId}.${guessExtension(imageUrl, "png")}`,
      "请先上传图片"
    );
  }, [imageUrl, selectedNodeId]);

  const handleDownloadVideo = useCallback(async () => {
    if (!selectedNodeId) return;
    await downloadMediaUrl(
      videoUrl,
      `video-${selectedNodeId}.${guessExtension(videoUrl, "mp4")}`,
      "请先上传视频"
    );
  }, [videoUrl, selectedNodeId]);

  // 音频节点顶栏下载（与图片/视频同一套 fetch blob 逻辑）
  const handleDownloadAudio = useCallback(async () => {
    if (!selectedNodeId) return;
    await downloadMediaUrl(
      audioUrl,
      `audio-${selectedNodeId}.${guessExtension(audioUrl, "mp3")}`,
      "请先上传或生成音频"
    );
  }, [audioUrl, selectedNodeId]);

  const handleOpenMediaPreview = useCallback(() => {
    const targetUrl = ensureHttpsOssUrl(
      isImageNode ? imageUrl : isVideoNode ? videoUrl : audioUrl
    );
    if (!targetUrl) {
      toast.error(
        isImageNode ? "请先上传图片" : isVideoNode ? "请先上传视频" : "请先上传或生成音频"
      );
      return;
    }
    setMediaPreviewUrl(targetUrl);
  }, [audioUrl, imageUrl, isImageNode, isVideoNode, videoUrl]);

  const handleOpenDrawingBoard = useCallback(() => {
    if (!selectedNodeId || !imageUrl) {
      toast.error("请先上传图片");
      return;
    }
    // 重绘入口统一切到全屏画板，后续再补充更细的重绘工作流。
    openDrawingBoard(selectedNodeId, "draw");
  }, [imageUrl, openDrawingBoard, selectedNodeId]);

  const closeOtherImageMenus = useCallback(
    (except?: "portrait" | "redraw" | "gridSplit" | "upload" | "creativeTools") => {
      if (except !== "portrait") setPortraitMenuOpen(false);
      if (except !== "redraw") setRedrawMenuOpen(false);
      if (except !== "gridSplit") setGridSplitOpen(false);
      if (except !== "upload") setUploadMenuOpen(false);
      if (except !== "creativeTools") setCreativeToolsMenuOpen(false);
      // 打开顶栏菜单时收起底部参数面板，两边互斥
      setGenerationOptionsExpanded(false);
    },
    [setGenerationOptionsExpanded]
  );

  /** 关闭视频顶栏其它下拉，避免多层叠开 */
  const closeOtherVideoMenus = useCallback(
    (except?: "subtitle" | "audio" | "frameEdit" | "upload" | "capture") => {
      if (except !== "subtitle") setVideoSubtitleMenuOpen(false);
      if (except !== "audio") setVideoAudioMenuOpen(false);
      if (except !== "frameEdit") setVideoFrameEditMenuOpen(false);
      if (except !== "upload") setUploadMenuOpen(false);
      if (except !== "capture") setFrameCaptureMenuOpen(false);
      setGenerationOptionsExpanded(false);
    },
    [setGenerationOptionsExpanded]
  );

  /** 智能擦除：整段视频去字幕 */
  const handleVideoSubtitleErase = useCallback(
    async (mode: SubtitleEraseMode, eraseRect?: { x: number; y: number; w: number; h: number }) => {
      if (!selectedNodeId || !projectId || !videoUrl || !node || subtitleEraseBusy) return;
      const assetId = String(params.assetId ?? "").trim();
      if (!assetId) {
        toast.error("当前视频缺少素材 ID，请重新上传后再试");
        return;
      }
      setSubtitleEraseBusy(true);
      setVideoSubtitleMenuOpen(false);
      try {
        await runVideoSubtitleErase({
          projectId,
          sourceNodeId: selectedNodeId,
          videoAssetId: assetId,
          videoUrl,
          mode,
          eraseRect,
          queryClient,
        });
        void refetchAllToolPricing();
      } finally {
        setSubtitleEraseBusy(false);
      }
    },
    [
      node,
      params.assetId,
      projectId,
      queryClient,
      refetchAllToolPricing,
      selectedNodeId,
      subtitleEraseBusy,
      videoUrl,
    ]
  );

  /** 进入框选去字幕（复用视频裁剪框 UI） */
  const handleOpenSubtitleBoxErase = useCallback(() => {
    if (!selectedNodeId || !videoUrl) {
      toast.error("请先上传视频");
      return;
    }
    closeOtherVideoMenus();
    openInlineVideoCrop(selectedNodeId, "subtitle_box_erase");
  }, [selectedNodeId, videoUrl, closeOtherVideoMenus, openInlineVideoCrop]);

  /** 进入节点内联切段（时间轴入/出点）；完整多轨请用侧栏「剪辑台」 */
  const handleOpenVideoTrim = useCallback(() => {
    if (!selectedNodeId || !videoUrl) {
      toast.error("请先上传视频");
      return;
    }
    closeOtherVideoMenus();
    const video = getVideoNodeRef(selectedNodeId);
    const dur =
      video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
    openInlineVideoTrim(selectedNodeId, dur);
  }, [selectedNodeId, videoUrl, closeOtherVideoMenus, openInlineVideoTrim]);

  /** 成片节点：打开剪辑台并回填 composeMeta */
  const handleReopenVideoEditor = useCallback(() => {
    if (!projectId || !selectedNodeId) return;
    void navigateToVideoEditor(projectId, router.push, { fromNodeId: selectedNodeId });
  }, [projectId, selectedNodeId, router]);

  /** 进入视频空间裁剪 */
  const handleOpenVideoCrop = useCallback(() => {
    if (!selectedNodeId || !videoUrl) {
      toast.error("请先上传视频");
      return;
    }
    closeOtherVideoMenus();
    openInlineVideoCrop(selectedNodeId, "crop");
  }, [selectedNodeId, videoUrl, closeOtherVideoMenus, openInlineVideoCrop]);

  /** 确认视频裁剪 / 框选去字幕 */
  const handleConfirmVideoCrop = useCallback(async () => {
    if (!selectedNodeId || !projectId || !videoUrl || !node || !inlineVideoCrop || savingVideoCrop) {
      return;
    }
    // 框选去字幕：确认选区后提交 RunningHub 火山字幕擦除
    if ((inlineVideoCrop.purpose ?? "crop") === "subtitle_box_erase") {
      if (subtitleEraseBusy) return;
      setSavingVideoCrop(true);
      try {
        await handleVideoSubtitleErase("box", inlineVideoCrop.rect);
        closeInlineVideoCrop();
      } finally {
        setSavingVideoCrop(false);
      }
      return;
    }

    const assetId = String(
      ((node.data as WorkflowNodeData)?.params as Record<string, unknown> | undefined)?.assetId ?? ""
    ).trim();
    if (!assetId) {
      toast.error("当前视频缺少素材 ID，请重新上传后再裁剪");
      return;
    }

    setSavingVideoCrop(true);
    const sourceLabel =
      String((node.data as WorkflowNodeData)?.label ?? "视频").trim() || "视频";
    try {
      const { asset } = await cropVideoAsset({
        projectId,
        videoAssetId: assetId,
        rect: inlineVideoCrop.rect,
        title: `${sourceLabel} · 裁剪`,
      });

      const { width: nodeW } = resolveNodeSize(node.width, node.height);
      const worldPos = getNodeWorldPosition(node, allNodes);
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "video").length * 32;

      addNodeFromAsset(
        {
          id: asset.id,
          category: "video",
          fileUrl: asset.fileUrl,
          title: "裁剪",
        },
        { x: worldPos.x + nodeW + 48, y: worldPos.y + siblingOffset }
      );

      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: newNodeId,
          sourceHandle: "video",
          targetHandle: REFERENCE_INPUT_ID,
        });
        updateNodeParam(newNodeId, "toolMode", "video_crop");
        updateNodeParam(newNodeId, "cropMeta", {
          sourceAssetId: assetId,
          rect: inlineVideoCrop.rect,
        });
        updateNodeData(newNodeId, { label: "裁剪" });
      }

      closeInlineVideoCrop();
      notifyAssetsUpdated();
      toast.success("已生成裁剪节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "裁剪失败");
    } finally {
      setSavingVideoCrop(false);
    }
  }, [
    addNodeFromAsset,
    allNodes,
    closeInlineVideoCrop,
    connectNodes,
    edges,
    handleVideoSubtitleErase,
    inlineVideoCrop,
    node,
    projectId,
    savingVideoCrop,
    selectedNodeId,
    subtitleEraseBusy,
    updateNodeData,
    updateNodeParam,
    videoUrl,
  ]);

  /** 确认切段：后端切段 → 右侧新建视频节点并连线 */
  const handleConfirmVideoTrim = useCallback(async () => {
    if (!selectedNodeId || !projectId || !videoUrl || !node || !inlineVideoTrim || savingTrim) {
      return;
    }
    const assetId = String(
      ((node.data as WorkflowNodeData)?.params as Record<string, unknown> | undefined)?.assetId ?? ""
    ).trim();
    if (!assetId) {
      toast.error("当前视频缺少素材 ID，请重新上传后再切段");
      return;
    }
    const { inSec, outSec } = inlineVideoTrim;
    if (!(outSec - inSec >= MIN_VIDEO_TRIM_SEC)) {
      toast.error(`片段至少 ${MIN_VIDEO_TRIM_SEC} 秒`);
      return;
    }

    setSavingTrim(true);
    const sourceLabel =
      String((node.data as WorkflowNodeData)?.label ?? "视频").trim() || "视频";
    try {
      const { asset } = await trimVideoAsset({
        projectId,
        videoAssetId: assetId,
        inSec,
        outSec,
        title: `${sourceLabel} · 切段`,
      });

      const { width } = resolveNodeSize(node.width, node.height);
      const worldPos = getNodeWorldPosition(node, allNodes);
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "video").length * 32;

      addNodeFromAsset(
        {
          id: asset.id,
          category: "video",
          fileUrl: asset.fileUrl,
          title: "切段",
        },
        { x: worldPos.x + width + 48, y: worldPos.y + siblingOffset }
      );

      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: newNodeId,
          sourceHandle: "video",
          targetHandle: REFERENCE_INPUT_ID,
        });
        updateNodeParam(newNodeId, "toolMode", "video_trim");
        updateNodeParam(newNodeId, "trimMeta", {
          sourceAssetId: assetId,
          inSec,
          outSec,
        });
        updateNodeData(newNodeId, { label: "切段" });
      }

      closeInlineVideoTrim();
      notifyAssetsUpdated();
      toast.success("已生成切段节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切段失败");
    } finally {
      setSavingTrim(false);
    }
  }, [
    addNodeFromAsset,
    allNodes,
    closeInlineVideoTrim,
    connectNodes,
    edges,
    inlineVideoTrim,
    node,
    projectId,
    savingTrim,
    selectedNodeId,
    updateNodeData,
    updateNodeParam,
    videoUrl,
  ]);

  /** 人声分离 / 消除人声：RunningHub Vocals / Other → 右侧音频节点 */
  const handleVideoVocalSeparate = useCallback(
    async (mode: VocalSeparateMode) => {
      if (!selectedNodeId || !projectId || !videoUrl || !node || vocalSeparateBusy) return;
      const assetId = String(params.assetId ?? "").trim();
      if (!assetId) {
        toast.error("当前视频缺少素材 ID，请重新上传后再试");
        return;
      }
      setVocalSeparateBusy(true);
      setVideoAudioMenuOpen(false);
      try {
        await runVideoVocalSeparate({
          projectId,
          sourceNodeId: selectedNodeId,
          videoAssetId: assetId,
          videoUrl,
          mode,
          queryClient,
        });
        void refetchAllToolPricing();
      } finally {
        setVocalSeparateBusy(false);
      }
    },
    [
      node,
      params.assetId,
      projectId,
      queryClient,
      refetchAllToolPricing,
      selectedNodeId,
      videoUrl,
      vocalSeparateBusy,
    ]
  );

  /** 音视频分离：右侧新建无声视频 + 分离音频节点并连线 */
  const handleVideoAvSplit = useCallback(async () => {
    if (!selectedNodeId || !projectId || !videoUrl || !node || splittingAv) return;
    const assetId = String(params.assetId ?? "").trim();
    if (!assetId) {
      toast.error("当前视频缺少素材 ID，请重新上传后再分离");
      return;
    }
    setSplittingAv(true);
    const sourceLabel =
      String((node.data as WorkflowNodeData)?.label ?? "视频").trim() || "视频";
    try {
      const { audioAsset, videoAsset } = await splitVideoAvAsset({
        projectId,
        videoAssetId: assetId,
        audioTitle: `${sourceLabel} · 分离音频`,
        videoTitle: `${sourceLabel} · 无声视频`,
      });

      const { width } = resolveNodeSize(node.width, node.height);
      const worldPos = getNodeWorldPosition(node, allNodes);
      const baseX = worldPos.x + width + 48;
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "video").length * 32;

      // 先无声视频，再分离音频（纵向错开）
      addNodeFromAsset(
        {
          id: videoAsset.id,
          category: "video",
          fileUrl: videoAsset.fileUrl,
          title: "无声视频",
        },
        { x: baseX, y: worldPos.y + siblingOffset }
      );
      const silentNodeId = useCanvasStore.getState().selectedNodeId;
      if (silentNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: silentNodeId,
          sourceHandle: "video",
          targetHandle: REFERENCE_INPUT_ID,
        });
        updateNodeParam(silentNodeId, "toolMode", "video_av_split");
        updateNodeParam(silentNodeId, "avSplitMeta", {
          sourceAssetId: assetId,
          role: "silent_video",
        });
        updateNodeData(silentNodeId, { label: "无声视频" });
      }

      addNodeFromAsset(
        {
          id: audioAsset.id,
          category: "audio",
          fileUrl: audioAsset.fileUrl,
          title: "分离音频",
        },
        { x: baseX, y: worldPos.y + siblingOffset + 200 }
      );
      const audioNodeId = useCanvasStore.getState().selectedNodeId;
      if (audioNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: audioNodeId,
          sourceHandle: "video",
          targetHandle: REFERENCE_INPUT_ID,
        });
        updateNodeParam(audioNodeId, "toolMode", "video_av_split");
        updateNodeParam(audioNodeId, "avSplitMeta", {
          sourceAssetId: assetId,
          role: "audio",
        });
        updateNodeData(audioNodeId, { label: "分离音频" });
      }

      toast.success("已生成无声视频与分离音频节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "音视频分离失败");
    } finally {
      setSplittingAv(false);
    }
  }, [
    addNodeFromAsset,
    allNodes,
    connectNodes,
    edges,
    node,
    params.assetId,
    projectId,
    selectedNodeId,
    splittingAv,
    updateNodeData,
    updateNodeParam,
    videoUrl,
  ]);

  /** 画面编辑：先校验 ≤N 秒，本地抠像/消除或上游修改/替换 */
  const handleVideoFrameEdit = useCallback(
    async (mode: VideoFrameEditMode) => {
      if (!selectedNodeId || !projectId || !videoUrl || !node || frameEditBusy) return;
      const assetId = String(params.assetId ?? "").trim();
      if (!assetId) {
        toast.error("当前视频缺少素材 ID，请重新上传后再编辑");
        return;
      }

      const mounted = getVideoNodeRef(selectedNodeId);
      const knownDur =
        mounted && Number.isFinite(mounted.duration) && mounted.duration > 0
          ? mounted.duration
          : null;
      const okDur = await ensureVideoFrameEditDuration({
        nodeId: selectedNodeId,
        videoUrl,
        knownDurationSec: knownDur,
        openTrim: (nid) => {
          const video = getVideoNodeRef(nid);
          const dur =
            video && Number.isFinite(video.duration) && video.duration > 0
              ? video.duration
              : undefined;
          openInlineVideoTrim(nid, dur);
        },
      });
      if (!okDur) return;

      // 先收齐用户输入与参考图，再进入 busy，避免取消弹窗仍占住「编辑中」
      let userPrompt = "";
      let refImageUrl: string | undefined;
      if (mode === "subject_remove") {
        // 主体消除：必须带上本节点提示词 + 源视频提交上游（不再走本地 rembg）
        userPrompt = String(params.prompt ?? "").trim();
        if (!userPrompt) {
          toast.error("请先在视频节点填写提示词，再点「主体消除」");
          return;
        }
      } else if (mode === "subject_edit" || mode === "subject_replace") {
        if (mode === "subject_edit") {
          const typed = window.prompt(
            `主体修改说明（源片须 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒）`,
            ""
          );
          if (typed == null) return;
          userPrompt = typed.trim();
          if (!userPrompt) {
            toast.error("请填写修改说明");
            return;
          }
        } else {
          refImageUrl =
            (await findConnectedReferenceImageUrl(projectId, selectedNodeId)) ?? undefined;
          if (!refImageUrl) {
            toast.error("主体替换需要参考图：请将图片节点连到本视频左侧「参考」口后再试");
            return;
          }
          const typed = window.prompt(
            `主体替换说明（源片须 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒）`,
            "将视频主体替换为参考图主体"
          );
          if (typed == null) return;
          userPrompt = typed.trim() || "将视频主体替换为参考图主体";
        }
      }

      setFrameEditBusy(true);
      setVideoFrameEditMenuOpen(false);
      try {
        if (mode === "smart_matting") {
          await runLocalVideoFrameEdit({
            projectId,
            sourceNodeId: selectedNodeId,
            videoAssetId: assetId,
            mode,
            queryClient,
          });
          void refetchAllToolPricing();
          return;
        }

        const toolKey = VIDEO_FRAME_EDIT_TOOLS[mode].canvasTool;
        // 生成时长对齐源片（向上取整并钳到 4–12），避免默认档位与短源片不一致
        const baseOpts =
          toolKey === "video_subject_replace"
            ? videoFrameReplaceGenerationOptions
            : toolKey === "video_subject_remove"
              ? videoFrameRemoveGenerationOptions
              : videoFrameEditGenerationOptions;
        const generationOptions = {
          ...(knownDur && knownDur > 0
            ? {
                ...baseOpts,
                duration: String(
                  Math.max(4, Math.min(MAX_VIDEO_FRAME_EDIT_SEC, Math.ceil(knownDur)))
                ),
              }
            : baseOpts),
          // 画面编辑源片常含真人；默认开真人模式，避免上游 1505
          realPerson: "on",
        };
        const resolvedModel =
          toolKey === "video_subject_replace"
            ? videoFrameReplaceModelName
            : toolKey === "video_subject_remove"
              ? videoFrameRemoveModelName
              : videoFrameEditModelName;
        await runUpstreamVideoFrameEdit({
          projectId,
          sourceNodeId: selectedNodeId,
          videoAssetId: assetId,
          videoUrl,
          mode,
          prompt: userPrompt,
          refImageUrl,
          // 后台「模型开关」为权威；消除 / 修改 / 替换可分别配置
          modelName: resolvedModel || "rh_seedance_20_r2v",
          generationOptions,
          queryClient,
        });
        void refetchAllToolPricing();
      } finally {
        setFrameEditBusy(false);
      }
    },
    [
      frameEditBusy,
      node,
      openInlineVideoTrim,
      params.assetId,
      params.prompt,
      projectId,
      queryClient,
      refetchAllToolPricing,
      selectedNodeId,
      videoFrameEditGenerationOptions,
      videoFrameEditModelName,
      videoFrameRemoveGenerationOptions,
      videoFrameRemoveModelName,
      videoFrameReplaceGenerationOptions,
      videoFrameReplaceModelName,
      videoUrl,
    ]
  );

  const handleVisualStyleChange = useCallback(
    (nextStyleId: string) => {
      if (!selectedNodeId) return;
      updateNodeParam(selectedNodeId, "visualStyleId", nextStyleId);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handlePortraitMenuSelect = useCallback(
    async (kind: PortraitAdjustKind) => {
      if (!selectedNodeId || !projectId || !imageUrl || !node || portraitAdjustBusy) return;
      const meta = PORTRAIT_ADJUST_TOOLS[kind];
      const modelName =
        (kind === "emotion" ? emotionAdjustModelName : portraitAdjustModelName) ||
        toolModelName ||
        "nano_pro_i2i";
      if (!modelName.trim()) {
        toast.error("请先在后台「模型开关」配置该功能的主模型");
        return;
      }
      const typed = window.prompt(
        kind === "portrait"
          ? "人像调节说明（如：提升肤质细腻度、淡妆、柔和光影）"
          : "情绪调节说明（如：微笑、略带惊讶、温柔眼神）",
        ""
      );
      if (typed == null) return;
      const userPrompt = typed.trim();
      if (!userPrompt) {
        toast.error(`请填写${meta.label}说明`);
        return;
      }

      setPortraitAdjustBusy(true);
      setPortraitMenuOpen(false);
      try {
        await runPortraitAdjustGenerate({
          kind,
          projectId,
          sourceNodeId: selectedNodeId,
          modelName,
          generationOptions:
            kind === "emotion"
              ? emotionAdjustGenerationOptions
              : portraitAdjustGenerationOptions,
          workflowId,
          creditsEnabled: toolCreditsEnabled,
          queryClient,
          userPrompt,
          onRefetchPricing: () => void refetchAllToolPricing(),
        });
      } finally {
        setPortraitAdjustBusy(false);
      }
    },
    [
      emotionAdjustGenerationOptions,
      emotionAdjustModelName,
      imageUrl,
      node,
      portraitAdjustBusy,
      portraitAdjustGenerationOptions,
      portraitAdjustModelName,
      projectId,
      queryClient,
      refetchAllToolPricing,
      selectedNodeId,
      toolCreditsEnabled,
      toolModelName,
      workflowId,
    ]
  );

  /** 抠图：固定算力扣费 → 本地去背景 → 右侧结果节点（模型/提示词走后台配置） */
  const handleCutout = useCallback(async () => {
    if (!selectedNodeId || !projectId || !imageUrl || cutoutBusy) return;

    setCutoutBusy(true);
    setRedrawMenuOpen(false);
    try {
      await runCutoutGenerate({
        projectId,
        sourceNodeId: selectedNodeId,
        sourceUrl: imageUrl,
        workflowId,
        creditsEnabled: toolCreditsEnabled,
        queryClient,
        fallbackModelName: toolModelName,
        onRefetchPricing: () => void refetchAllToolPricing(),
      });
    } finally {
      setCutoutBusy(false);
    }
  }, [
    cutoutBusy,
    imageUrl,
    projectId,
    queryClient,
    refetchAllToolPricing,
    selectedNodeId,
    toolCreditsEnabled,
    toolModelName,
    workflowId,
  ]);

  const handleRedrawMenuSelect = useCallback(
    (kind: "hd" | "annotate" | "rotate" | "outpaint" | "repaint" | "erase" | "cutout" | "crop") => {
      if (!imageUrl) {
        toast.error("请先上传图片");
        return;
      }
      switch (kind) {
        case "hd": {
          if (!selectedNodeId || !node) return;
          const assetId = String(params.assetId ?? "").trim();
          if (!assetId || !imageUrl) {
            toast.error("请先上传图片");
            return;
          }
          const created = createHdUpscaleNode({
            sourceNodeId: selectedNodeId,
            sourcePosition: node.position,
            sourceWidth: node.width,
            sourceHeight: node.height,
            sourceAsset: {
              id: assetId,
              fileUrl: imageUrl,
              title: "高清",
            },
            edges,
          });
          if (!created) {
            toast.error("创建高清节点失败");
            return;
          }
          setRedrawMenuOpen(false);
          return;
        }
        case "annotate":
          // 在当前图片上打开标注工具条（画笔默认红色）
          closeInlineImageErase();
          setInlineImageDrawTool("brush");
          setInlineImageDrawColor("#ef4444");
          setRedrawMenuOpen(false);
          return;
        case "rotate": {
          // 右侧新建旋转图片节点（复制源图）并打开旋转工具条
          if (!selectedNodeId || !node) return;
          const assetId = String(params.assetId ?? "").trim();
          if (!assetId) {
            toast.error("请先上传图片");
            return;
          }
          const created = createRotateNode({
            sourceNodeId: selectedNodeId,
            sourcePosition: node.position,
            sourceWidth: node.width,
            sourceHeight: node.height,
            sourceAsset: {
              id: assetId,
              fileUrl: imageUrl,
              title: "旋转",
            },
            edges,
          });
          if (!created) {
            toast.error("创建旋转节点失败");
            return;
          }
          setRedrawMenuOpen(false);
          return;
        }
        case "outpaint":
          // 在当前图片上打开扩图工具条（截图同款）
          openInlineImageOutpaint();
          setRedrawMenuOpen(false);
          return;
        case "repaint":
          handleOpenDrawingBoard();
          return;
        case "erase":
          // 在当前图片节点上进入擦除（顶栏工具 + 底部参数条），不新建节点
          openInlineImageErase();
          setRedrawMenuOpen(false);
          return;
        case "cutout":
          void handleCutout();
          return;
        case "crop":
          // 在当前图片上打开裁剪框（可缩小选区），确认后新建节点
          openInlineImageCrop();
          setRedrawMenuOpen(false);
          return;
        default:
          toast.message("功能即将接入");
      }
    },
    [
      closeInlineImageErase,
      edges,
      handleCutout,
      handleOpenDrawingBoard,
      imageUrl,
      node,
      openInlineImageCrop,
      openInlineImageErase,
      openInlineImageOutpaint,
      params.assetId,
      selectedNodeId,
      setInlineImageDrawColor,
      setInlineImageDrawTool,
    ]
  );

  const persistCapturedFrame = useCallback(
    async (blob: Blob, timeSec: number) => {
      if (!selectedNodeId || !projectId || !node) return;
      const label = String((node.data as WorkflowNodeData)?.label ?? "视频节点").trim();
      const timeLabel = formatVideoTime(timeSec);
      const file = new File([blob], frameFileName(selectedNodeId, timeSec), {
        type: "image/jpeg",
      });
      const asset = await uploadAsset({
        file,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: `${label} ${timeLabel}`,
      });

      updateNodeParam(selectedNodeId, "lastFramePickTime", timeSec);

      const { width } = resolveNodeSize(node.width, node.height);
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "video").length * 32;
      addNodeFromAsset(
        {
          id: asset.id,
          category: "image",
          fileUrl: asset.fileUrl,
          title: `${timeLabel} · ${label}`,
        },
        { x: node.position.x + width + 48, y: node.position.y + siblingOffset }
      );

      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: newNodeId,
          sourceHandle: "video",
          targetHandle: REFERENCE_INPUT_ID,
        });
      }

      notifyAssetsUpdated();
      closeFramePick();
      toast.success("画面已保存并已连接图片节点");
    },
    [
      selectedNodeId,
      projectId,
      node,
      updateNodeParam,
      edges,
      addNodeFromAsset,
      connectNodes,
      closeFramePick,
    ]
  );

  const handleCaptureFrameAt = useCallback(
    async (timeSec: number) => {
      if (!selectedNodeId || !projectId || !videoUrl || !node || savingFrame) return;

      setSavingFrame(true);
      try {
        const video = getVideoNodeRef(selectedNodeId);
        // 以目标时刻为准强制对准后再截；元素不可用则走同源 stream 回退
        const blob = await captureVideoFrameAtTimePreferElement(video, videoUrl, timeSec);
        await persistCapturedFrame(blob, timeSec);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "画面截取失败");
      } finally {
        setSavingFrame(false);
      }
    },
    [selectedNodeId, projectId, videoUrl, node, savingFrame, persistCapturedFrame]
  );

  /** 「截取当前帧」：抓节点上正在显示的画面，不重新 seek */
  const handleCaptureCurrentFrame = useCallback(async () => {
    if (!selectedNodeId || !projectId || !videoUrl || !node || savingFrame) return;

    setSavingFrame(true);
    try {
      const video = getVideoNodeRef(selectedNodeId);
      if (!video) {
        toast.error("请先播放或暂停视频到目标画面，再截取当前帧");
        return;
      }
      const timeSec =
        Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
      const blob = await captureDisplayedVideoFramePreferElement(video, videoUrl);
      await persistCapturedFrame(blob, timeSec);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "画面截取失败");
    } finally {
      setSavingFrame(false);
    }
  }, [selectedNodeId, projectId, videoUrl, node, savingFrame, persistCapturedFrame]);

  /** 下拉：截取首帧 / 尾帧 / 当前帧 */
  const handleCaptureFrameKind = useCallback(
    (kind: "first" | "last" | "current") => {
      if (!selectedNodeId || !videoUrl || savingFrame) return;
      if (kind === "current") {
        void handleCaptureCurrentFrame();
        return;
      }
      const video = getVideoNodeRef(selectedNodeId);
      const timeSec = resolveFrameCaptureTimeSec(kind, video);
      void handleCaptureFrameAt(timeSec);
    },
    [selectedNodeId, videoUrl, savingFrame, handleCaptureCurrentFrame, handleCaptureFrameAt]
  );

  /** 选帧模式下「保存此帧」：使用 store 中的选帧时刻 */
  const handleSaveFrame = useCallback(async () => {
    await handleCaptureFrameAt(framePickTimeSec);
  }, [handleCaptureFrameAt, framePickTimeSec]);

  /** 保存标注：合成图上传后在右侧新建图片节点并连线 */
  const handleSaveAnnotate = useCallback(async () => {
    if (!selectedNodeId || !projectId || !imageUrl || !node || savingAnnotate) return;
    if (!hasInlineStrokes) {
      toast.error("请先在图片上标注");
      return;
    }

    setSavingAnnotate(true);
    const sourceLabel = String((node.data as WorkflowNodeData)?.label ?? "图片").trim() || "图片";
    const nodeParams = ((node.data as WorkflowNodeData)?.params ?? {}) as Record<string, unknown>;

    try {
      const asset = await bakeInlineDrawingToAsset({
        projectId,
        nodeId: selectedNodeId,
        nodeParams,
        sourceUrl: imageUrl,
        title: `${sourceLabel} · 标注`,
      });
      if (!asset) {
        toast.error("没有可保存的标注");
        return;
      }

      const { width } = resolveNodeSize(node.width, node.height);
      const world = getNodeWorldPosition(node, allNodes);
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "image").length * 32;

      addNodeFromAsset(
        {
          id: asset.id,
          category: "image",
          fileUrl: asset.fileUrl,
          title: asset.title,
        },
        { x: world.x + width + 48, y: world.y + siblingOffset }
      );

      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: newNodeId,
          sourceHandle: "image",
          targetHandle: REFERENCE_INPUT_ID,
        });
      }

      // 源节点清空笔迹层，标注已固化到新节点图片
      const drawing = parseInlineImageDrawing(nodeParams.inlineImageDrawing);
      updateNodeParam(selectedNodeId, "inlineImageDrawing", {
        sourceAssetId: drawing?.sourceAssetId ?? "",
        imageWidth: drawing?.imageWidth ?? 1,
        imageHeight: drawing?.imageHeight ?? 1,
        strokes: [],
      });

      clearInlineImageDrawTool();
      notifyAssetsUpdated();
      toast.success("已生成标注图片节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "标注保存失败");
    } finally {
      setSavingAnnotate(false);
    }
  }, [
    selectedNodeId,
    projectId,
    imageUrl,
    node,
    savingAnnotate,
    hasInlineStrokes,
    allNodes,
    edges,
    addNodeFromAsset,
    connectNodes,
    updateNodeParam,
    clearInlineImageDrawTool,
  ]);

  /** 保存旋转/镜像：烘焙后写回当前旋转节点（点击菜单时已新建） */
  const handleSaveRotate = useCallback(async () => {
    if (!selectedNodeId || !projectId || !imageUrl || !node || savingRotate) return;
    if (!hasImageTransform(inlineImageTransform)) {
      toast.error("请先旋转或镜像");
      return;
    }

    setSavingRotate(true);
    const sourceLabel = String((node.data as WorkflowNodeData)?.label ?? "图片").trim() || "图片";

    try {
      const asset = await bakeImageTransformToAsset({
        projectId,
        nodeId: selectedNodeId,
        sourceUrl: imageUrl,
        transform: inlineImageTransform!,
        title: `${sourceLabel} · 旋转`,
      });
      if (!asset) {
        toast.error("没有可保存的变换");
        return;
      }

      updateNodeParam(selectedNodeId, "assetId", asset.id);
      updateNodeParam(selectedNodeId, "imageUrl", asset.fileUrl);
      updateNodeData(selectedNodeId, { label: asset.title });
      // 保留当前 AABB 尺寸，交由 useMediaNodeSize 按烘焙后新图再适配
      closeInlineImageTransform({ restoreBaseSize: false });
      notifyAssetsUpdated();
      toast.success("已保存旋转图片");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "旋转保存失败");
    } finally {
      setSavingRotate(false);
    }
  }, [
    selectedNodeId,
    projectId,
    imageUrl,
    node,
    savingRotate,
    inlineImageTransform,
    updateNodeParam,
    updateNodeData,
    closeInlineImageTransform,
  ]);

  /** 确认裁剪：烘焙选区后右侧新建图片节点并连线 */
  const handleConfirmCrop = useCallback(async () => {
    if (!selectedNodeId || !projectId || !imageUrl || !node || !inlineImageCrop || savingCrop) {
      return;
    }

    setSavingCrop(true);
    const sourceLabel = String((node.data as WorkflowNodeData)?.label ?? "图片").trim() || "图片";
    const bodyH = Math.max(1, resolveNodeSize(node.width, node.height).height - NODE_TITLE_HEIGHT);
    const bodyW = resolveNodeSize(node.width, node.height).width;

    try {
      const asset = await bakeImageCropToAsset({
        projectId,
        nodeId: selectedNodeId,
        sourceUrl: imageUrl,
        rect: inlineImageCrop.rect,
        displayWidth: bodyW,
        displayHeight: bodyH,
        title: `${sourceLabel} · 裁剪`,
      });

      const { width } = resolveNodeSize(node.width, node.height);
      const worldPos = getNodeWorldPosition(node, allNodes);
      const siblingOffset =
        edges.filter((e) => e.source === selectedNodeId && e.sourceHandle === "image").length * 32;

      addNodeFromAsset(
        {
          id: asset.id,
          category: "image",
          fileUrl: asset.fileUrl,
          title: "裁剪",
        },
        { x: worldPos.x + width + 48, y: worldPos.y + siblingOffset }
      );

      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        connectNodes({
          source: selectedNodeId,
          target: newNodeId,
          sourceHandle: "image",
          targetHandle: REFERENCE_INPUT_ID,
        });
        updateNodeParam(newNodeId, "toolMode", "crop");
        updateNodeData(newNodeId, { label: "裁剪" });
      }

      closeInlineImageCrop();
      notifyAssetsUpdated();
      toast.success("已生成裁剪节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "裁剪失败");
    } finally {
      setSavingCrop(false);
    }
  }, [
    addNodeFromAsset,
    allNodes,
    closeInlineImageCrop,
    connectNodes,
    edges,
    imageUrl,
    inlineImageCrop,
    node,
    projectId,
    savingCrop,
    selectedNodeId,
    updateNodeData,
    updateNodeParam,
  ]);

  if (!selectedNodeId || !node) return null;
  if (!isImageNode && !isVideoNode && !isAudioNode) return null;
  // 节点拖动中隐藏顶栏工具弹窗，避免「移动即弹窗」
  if (isCanvasDragging) return null;
  // 全屏画板打开时隐藏节点顶栏，避免与画板工具栏重叠
  if (drawingBoardNodeId) return null;
  // 高清放大节点只保留底部参数面板，不显示图片/视频顶栏工具
  if ((isImageNode || isVideoNode) && isHdUpscaleToolMode(params.toolMode)) return null;
  // 素材库锁定媒体节点：无上下弹窗，仅作参考源（提示词库文本可编辑）
  if (isLibraryUiLockedParams(params)) return null;

  const { width, height } = resolveNodeSize(node.width, node.height);
  const world = getNodeWorldPosition(node, allNodes);
  const anchorX = world.x + width / 2;
  const anchorY = world.y - CANVAS_TOP_MENU_NODE_GAP;

  // 擦除模式：顶部擦除工具 + 底部生成参数条
  if (isImageNode && selectedNodeId && inlineImageEraseMode && inlineImageDrawTool && imageUrl) {
    const eraseTopStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    // 锚在图片本体底边（不含标题栏）
    const eraseBottomStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y + height + 10,
      viewportZoom,
      "below",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={eraseTopStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageEraseToolbar
            nodeId={selectedNodeId}
            hasStrokes={hasInlineStrokes}
            onClose={() => closeInlineImageErase()}
          />
        </div>
        {inlineImageEraseParams ? (
          <div
            className="canvas-node-overlay nodrag nopan pointer-events-auto"
            style={eraseBottomStyle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <ImageGenParamsToolbar
              value={inlineImageEraseParams}
              onChange={(patch) => patchInlineImageEraseParams(patch)}
              onGenerate={() => toast.message("擦除即将接入")}
              generateTitle="开始擦除"
            />
          </div>
        ) : null}
      </EdgeLabelRenderer>
    );
  }

  // 标注模式：工具条固定在图片顶部（与常规顶栏同锚点）
  if (isImageNode && selectedNodeId && inlineImageDrawTool && !inlineImageEraseMode && imageUrl) {
    const annotateStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={annotateStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageAnnotateToolbar
            nodeId={selectedNodeId}
            hasStrokes={hasInlineStrokes}
            saving={savingAnnotate}
            onClose={() => clearInlineImageDrawTool()}
            onSave={() => {
              void handleSaveAnnotate();
            }}
          />
        </div>
      </EdgeLabelRenderer>
    );
  }

  // 旋转与镜像：工具条在图片顶部，预览作用在节点图片上
  if (isImageNode && selectedNodeId && inlineImageTransform && imageUrl) {
    const rotateStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={rotateStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageRotateToolbar
            saving={savingRotate}
            onClose={() => closeInlineImageTransform()}
            onSave={() => {
              void handleSaveRotate();
            }}
          />
        </div>
      </EdgeLabelRenderer>
    );
  }

  // 扩图：参数浮条 + 四周可拖动手柄外扩框
  if (isImageNode && selectedNodeId && inlineImageOutpaint && imageUrl) {
    const outpaintStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <ImageOutpaintExpandFrame
          worldX={world.x}
          // 只包住图片本体，不含节点标题栏
          worldY={world.y + NODE_TITLE_HEIGHT}
          nodeWidth={width}
          nodeHeight={Math.max(1, height - NODE_TITLE_HEIGHT)}
          imageUrl={imageUrl}
        />
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={outpaintStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageOutpaintToolbar onClose={() => closeInlineImageOutpaint()} />
        </div>
      </EdgeLabelRenderer>
    );
  }

  // 裁剪：顶部确认条 + 可缩放裁剪框（三分线 / 白手柄）
  if (isImageNode && selectedNodeId && inlineImageCrop && imageUrl) {
    const bodyH = Math.max(1, height - NODE_TITLE_HEIGHT);
    const cropStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <ImageCropFrame
          worldX={world.x}
          worldY={world.y + NODE_TITLE_HEIGHT}
          nodeWidth={width}
          nodeHeight={bodyH}
          imageAspect={cropImageAspect}
        />
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={cropStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageCropToolbar
            imageAspect={cropImageAspect}
            saving={savingCrop}
            onClose={() => closeInlineImageCrop()}
            onConfirm={() => {
              void handleConfirmCrop();
            }}
          />
        </div>
      </EdgeLabelRenderer>
    );
  }

  // 视频空间裁剪：复用图片裁剪框 UI
  if (isVideoNode && selectedNodeId && videoCropActive && inlineVideoCrop && videoUrl) {
    const bodyH = Math.max(1, height - NODE_TITLE_HEIGHT);
    const cropStyle = buildCanvasOverlayStyle(
      world.x + width / 2,
      world.y - CANVAS_TOP_MENU_NODE_GAP,
      viewportZoom,
      "above",
      {
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU_OPEN,
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    );
    return (
      <EdgeLabelRenderer>
        <ImageCropFrame
          worldX={world.x}
          worldY={world.y + NODE_TITLE_HEIGHT}
          nodeWidth={width}
          nodeHeight={bodyH}
          imageAspect={videoCropAspect}
          controlled={{
            rect: inlineVideoCrop.rect,
            aspectRatio: inlineVideoCrop.aspectRatio,
            onPatch: (patch) => patchInlineVideoCrop(patch),
          }}
        />
        <div
          className="canvas-node-overlay nodrag nopan pointer-events-auto"
          style={cropStyle}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ImageCropToolbar
            imageAspect={videoCropAspect}
            saving={savingVideoCrop || subtitleEraseBusy}
            onClose={() => closeInlineVideoCrop()}
            onConfirm={() => {
              void handleConfirmVideoCrop();
            }}
            confirmLabel={
              inlineVideoCrop.purpose === "subtitle_box_erase" ? "确认擦除" : "确认"
            }
            confirmTitle={
              inlineVideoCrop.purpose === "subtitle_box_erase" ? "确认框选擦除" : "确认裁剪"
            }
            controlled={{
              aspectRatio: inlineVideoCrop.aspectRatio,
              onPatch: (patch) => patchInlineVideoCrop(patch),
            }}
          />
        </div>
      </EdgeLabelRenderer>
    );
  }

  const anyMenuOpen =
    portraitMenuOpen ||
    redrawMenuOpen ||
    uploadMenuOpen ||
    creativeToolsMenuOpen ||
    frameCaptureMenuOpen ||
    videoSubtitleMenuOpen ||
    videoAudioMenuOpen ||
    videoFrameEditMenuOpen ||
    gridSplitOpen ||
    Boolean(inlineImageDrawTool) ||
    Boolean(inlineImageTransform) ||
    Boolean(inlineImageOutpaint) ||
    Boolean(inlineImageCrop);
  const overlayStyle = buildCanvasOverlayStyle(anchorX, anchorY, viewportZoom, "above", {
    maxWidth: isImageNode
      ? CANVAS_IMAGE_TOP_MENU_MAX_WIDTH
      : isVideoNode
        ? CANVAS_VIDEO_TOP_MENU_MAX_WIDTH
        : CANVAS_TOP_MENU_MAX_WIDTH,
    ...OVERLAY_STYLE,
    // 有下拉展开时再抬高，确保盖住底部编辑浮层
    zIndex: anyMenuOpen ? CANVAS_OVERLAY_Z_TOP_MENU_OPEN : CANVAS_OVERLAY_Z_TOP_MENU,
    ...(framePickActive || trimActive
      ? { border: "1px solid rgba(167, 139, 250, 0.55)" }
      : {}),
  });

  return (
    <>
    <EdgeLabelRenderer>
      <div
        className="canvas-node-overlay nodrag nopan pointer-events-auto flex flex-nowrap items-center gap-0.5 rounded-xl px-1.5 py-1 shadow-2xl"
        style={overlayStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 视频顶栏工具区：剪辑…画面编辑 → 截图 → 上传 → | → 下载/全屏 */}
        {isVideoNode && !framePickActive && !trimActive && !videoCropActive ? (
          <>
            <TopMenuActionButton
              label="切段"
              icon={<Scissors strokeWidth={1.75} />}
              disabled={!videoUrl}
              title={!videoUrl ? "请先上传视频" : "切段：选入/出点并导出新节点（完整多轨请用左侧剪辑台）"}
              onClick={handleOpenVideoTrim}
            />
            {isComposeNode ? (
              <TopMenuActionButton
                label="再编辑"
                icon={<Clapperboard strokeWidth={1.75} />}
                title="打开剪辑台并回填本成片的时间线"
                onClick={handleReopenVideoEditor}
              />
            ) : null}
            <TopMenuActionButton
              label="裁剪"
              icon={<Crop strokeWidth={1.75} />}
              disabled={!videoUrl}
              title={!videoUrl ? "请先上传视频" : "裁剪"}
              onClick={handleOpenVideoCrop}
            />
            <TopMenuActionButton
              label="高清"
              icon={<HdMenuIcon />}
              disabled={!videoUrl}
              badge={
                videoToolQuoteLoading || videoToolCost("hd_upscale_video") != null ? (
                  <ToolCreditCostBadge
                    cost={videoToolCost("hd_upscale_video")}
                    creditsEnabled={videoToolCreditsEnabled}
                    loading={videoToolQuoteLoading}
                  />
                ) : undefined
              }
              title={
                !videoUrl
                  ? "请先上传视频"
                  : videoToolCost("hd_upscale_video") != null
                    ? `高清 · ${formatCreditLabel(videoToolCost("hd_upscale_video")!, videoToolCreditsEnabled)}`
                    : "高清"
              }
              onClick={() => {
                closeOtherVideoMenus();
                if (!selectedNodeId || !node || !videoUrl) {
                  toast.error("请先上传视频");
                  return;
                }
                const assetId = String(params.assetId ?? "").trim();
                if (!assetId) {
                  toast.error("请先上传视频");
                  return;
                }
                const created = createHdUpscaleNode({
                  sourceNodeId: selectedNodeId,
                  sourcePosition: node.position,
                  sourceWidth: node.width,
                  sourceHeight: node.height,
                  sourceAsset: {
                    id: assetId,
                    fileUrl: videoUrl,
                    title: "高清",
                  },
                  edges,
                  mediaKind: "video",
                });
                if (!created) {
                  toast.error("创建高清节点失败");
                }
              }}
            />
            <TopMenuActionButton
              label={parsingVideoStoryboard ? "解析中" : "解析"}
              icon={
                parsingVideoStoryboard ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <SquareSplitVertical strokeWidth={1.75} />
                )
              }
              disabled={!videoUrl || parsingVideoStoryboard}
              badge={
                !parsingVideoStoryboard &&
                (toolPricingLoading || costByTool[STORYBOARD_FROM_VIDEO_TOOL] != null) ? (
                  <ToolCreditCostBadge
                    cost={costByTool[STORYBOARD_FROM_VIDEO_TOOL]}
                    creditsEnabled={toolCreditsEnabled}
                    loading={toolPricingLoading}
                  />
                ) : undefined
              }
              title={
                !videoUrl
                  ? "请先上传视频"
                  : parsingVideoStoryboard
                    ? parseVideoProgress || "正在解析…"
                    : `解析：新建分镜表并提取分镜${
                        costByTool[STORYBOARD_FROM_VIDEO_TOOL] != null
                          ? ` · ${formatCreditLabel(costByTool[STORYBOARD_FROM_VIDEO_TOOL], toolCreditsEnabled)}`
                          : ""
                      }`
              }
              onClick={() => {
                closeOtherVideoMenus();
                if (!selectedNodeId || !projectId || !node || parsingVideoStoryboard) return;
                const assetId = String(params.assetId ?? "").trim();
                if (!assetId || !videoUrl) {
                  toast.error("请先上传视频");
                  return;
                }
                setParsingVideoStoryboard(true);
                setParseVideoProgress("正在创建分镜表…");
                void (async () => {
                  try {
                    await runVideoStoryboardParse({
                      projectId,
                      videoNodeId: selectedNodeId,
                      videoAssetId: assetId,
                      videoFileUrl: videoUrl,
                      sourcePosition: node.position,
                      sourceWidth: node.width,
                      sourceHeight: node.height,
                      edges,
                      videoParams: params,
                      onProgress: setParseVideoProgress,
                    });
                    void invalidateCanvasCreditQueries(queryClient, projectId);
                  } catch (err) {
                    if (handleCollaboratorSpendCapError(err)) return;
                    if (isPricingChangedError(err)) {
                      toastPricingChanged();
                      void refetchAllToolPricing();
                      return;
                    }
                    toast.error(err instanceof Error ? err.message : "解析失败");
                  } finally {
                    setParsingVideoStoryboard(false);
                    setParseVideoProgress("");
                  }
                })();
              }}
            />
            <TopMenuDropdown
              label="智能去字幕"
              icon={<CaptionsOff strokeWidth={1.75} />}
              disabled={!videoUrl}
              badge={
                videoToolQuoteLoading || videoToolCost("video_subtitle_smart_erase") != null ? (
                  <ToolCreditCostBadge
                    cost={videoToolCost("video_subtitle_smart_erase")}
                    creditsEnabled={videoToolCreditsEnabled}
                    loading={videoToolQuoteLoading}
                  />
                ) : undefined
              }
              title={
                !videoUrl
                  ? "请先上传视频"
                  : `智能去字幕${
                      videoToolCost("video_subtitle_smart_erase") != null
                        ? ` · ${formatCreditLabel(videoToolCost("video_subtitle_smart_erase")!, videoToolCreditsEnabled)}`
                        : ""
                    }`
              }
              open={videoSubtitleMenuOpen}
              onOpenChange={(next) => {
                if (next) closeOtherVideoMenus("subtitle");
                setVideoSubtitleMenuOpen(next);
              }}
              items={[
                {
                  id: "smart-erase",
                  label: "智能擦除",
                  creditCost: videoToolCost("video_subtitle_smart_erase"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: subtitleEraseBusy || !videoUrl,
                  onSelect: () => {
                    void handleVideoSubtitleErase("smart");
                  },
                },
                {
                  id: "box-erase",
                  label: "框选擦除",
                  creditCost: videoToolCost("video_subtitle_box_erase"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: subtitleEraseBusy || !videoUrl,
                  onSelect: () => handleOpenSubtitleBoxErase(),
                },
              ]}
            />
            <TopMenuDropdown
              label={
                vocalSeparateBusy || splittingAv ? "分离中…" : "音频分离"
              }
              icon={
                vocalSeparateBusy || splittingAv ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <Music2 strokeWidth={1.75} />
                )
              }
              disabled={!videoUrl || splittingAv || vocalSeparateBusy}
              title={
                !videoUrl
                  ? "请先上传视频"
                  : vocalSeparateBusy
                    ? "正在人声处理…"
                    : splittingAv
                      ? "正在音视频分离…"
                      : "音频分离：人声分离 / 消除人声 / 音视频分离"
              }
              open={videoAudioMenuOpen}
              onOpenChange={(next) => {
                if (next) closeOtherVideoMenus("audio");
                setVideoAudioMenuOpen(next);
              }}
              items={[
                {
                  id: "vocal-separate",
                  label: "人声分离",
                  creditCost: videoToolCost("vocal_separate"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: vocalSeparateBusy || splittingAv,
                  onSelect: () => {
                    void handleVideoVocalSeparate("vocals");
                  },
                },
                {
                  id: "vocal-remove",
                  label: "消除人声",
                  creditCost: videoToolCost("vocal_remove"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: vocalSeparateBusy || splittingAv,
                  onSelect: () => {
                    void handleVideoVocalSeparate("other");
                  },
                },
                {
                  id: "av-separate",
                  label: "音视频分离",
                  disabled: vocalSeparateBusy || splittingAv,
                  onSelect: () => {
                    void handleVideoAvSplit();
                  },
                },
              ]}
            />
            <TopMenuDropdown
              label={frameEditBusy ? "编辑中…" : "画面编辑"}
              icon={
                frameEditBusy ? (
                  <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <SquarePen strokeWidth={1.75} />
                )
              }
              disabled={!videoUrl || frameEditBusy}
              title={
                !videoUrl
                  ? "请先上传视频"
                  : frameEditBusy
                    ? "画面编辑处理中…"
                    : `画面编辑（源片须先 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒；结果 WebM）`
              }
              open={videoFrameEditMenuOpen}
              onOpenChange={(next) => {
                if (next) closeOtherVideoMenus("frameEdit");
                setVideoFrameEditMenuOpen(next);
              }}
              items={[
                {
                  id: "subject-remove",
                  label: "主体消除",
                  creditCost: videoToolCost("video_subject_remove"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: frameEditBusy,
                  onSelect: () => {
                    void handleVideoFrameEdit("subject_remove");
                  },
                },
                {
                  id: "subject-edit",
                  label: "主体修改",
                  creditCost: videoToolCost("video_subject_edit"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: frameEditBusy,
                  onSelect: () => {
                    void handleVideoFrameEdit("subject_edit");
                  },
                },
                {
                  id: "subject-replace",
                  label: "主体替换",
                  creditCost: videoToolCost("video_subject_replace"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: frameEditBusy,
                  onSelect: () => {
                    void handleVideoFrameEdit("subject_replace");
                  },
                },
                {
                  id: "smart-matting",
                  label: "智能抠像",
                  creditCost: videoToolCost("video_smart_matting"),
                  creditLoading: videoToolQuoteLoading,
                  creditsEnabled: videoToolCreditsEnabled,
                  disabled: frameEditBusy,
                  onSelect: () => {
                    void handleVideoFrameEdit("smart_matting");
                  },
                },
              ]}
            />
            <div ref={frameCaptureMenuRef} className="relative">
              <button
                type="button"
                disabled={!videoUrl || savingFrame}
                onClick={() => {
                  closeOtherVideoMenus("capture");
                  setFrameCaptureMenuOpen((open) => !open);
                }}
                className={`inline-flex items-center rounded-md p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  frameCaptureMenuOpen
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
                title={!videoUrl ? "请先上传视频" : "截图"}
                aria-label="截图"
                aria-expanded={frameCaptureMenuOpen}
                aria-haspopup="menu"
              >
                {savingFrame ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                )}
              </button>
              {frameCaptureMenuOpen ? (
                <div
                  role="menu"
                  className={`absolute left-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 min-w-[132px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {(
                    [
                      { id: "first", label: "截取首帧" },
                      { id: "last", label: "截取尾帧" },
                      { id: "current", label: "截取当前帧" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      disabled={savingFrame}
                      onClick={() => {
                        setFrameCaptureMenuOpen(false);
                        handleCaptureFrameKind(item.id);
                      }}
                      className="flex w-full items-center px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {!framePickActive && !trimActive && !videoCropActive && !isImageNode ? (
          <div ref={uploadMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                closeOtherVideoMenus("upload");
                setUploadMenuOpen((open) => !open);
              }}
              className={`inline-flex items-center rounded-md p-2 transition-colors ${
                uploadMenuOpen
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
              title="上传视频"
              aria-label="上传视频"
              aria-expanded={uploadMenuOpen}
            >
              <Upload className="h-4 w-4 shrink-0" />
            </button>
            {uploadMenuOpen ? (
              <div
                className={`absolute left-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 min-w-[168px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedNodeId) return;
                    requestVideoUploadAction(selectedNodeId, "local");
                    setUploadMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                >
                  <Upload className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                  本地上传
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedNodeId) return;
                    requestVideoUploadAction(selectedNodeId, "asset");
                    setUploadMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                >
                  <FolderOpen className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                  从资产选择
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {isImageNode ? (
          <>
            {/* 图片顶栏改成截图同款的固定顺序入口，右侧只保留图标操作。 */}
            <TopMenuDropdown
              label={portraitAdjustBusy ? "调节中…" : "人像质感调节"}
              // 算力只在展开子项展示；外层仅保留 NEW
              badge="NEW"
              open={portraitMenuOpen}
              onOpenChange={(next) => {
                if (next) closeOtherImageMenus("portrait");
                setPortraitMenuOpen(next);
              }}
              items={[
                {
                  id: "portrait",
                  label: "人像调节",
                  icon: <UserRound className="size-[18px]" strokeWidth={1.75} />,
                  creditCost: costByTool.portrait_adjust,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  disabled: portraitAdjustBusy || !imageUrl,
                  onSelect: () => void handlePortraitMenuSelect("portrait"),
                },
                {
                  id: "emotion",
                  label: "情绪调节",
                  icon: <Smile className="size-[18px]" strokeWidth={1.75} />,
                  creditCost: costByTool.emotion_adjust,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  disabled: portraitAdjustBusy || !imageUrl,
                  onSelect: () => void handlePortraitMenuSelect("emotion"),
                },
              ]}
            />
            <TopMenuActionButton
              label={panoramaItem?.label || "全景"}
              disabled={!imageUrl || !panoramaItem || Boolean(generatingSuffixTool) || gridSplitBusy}
              active={generatingSuffixTool === "panorama"}
              badge={
                toolPricingLoading || costByTool.panorama != null ? (
                  <ToolCreditCostBadge
                    cost={costByTool.panorama}
                    creditsEnabled={toolCreditsEnabled}
                    loading={toolPricingLoading}
                  />
                ) : undefined
              }
              title={
                !imageUrl
                  ? "请先上传图片"
                  : costByTool.panorama != null
                    ? `${panoramaItem?.label || "全景"} · ${formatCreditLabel(costByTool.panorama, toolCreditsEnabled)}`
                    : undefined
              }
              onClick={() => {
                if (panoramaItem) void handleSuffixToolClick(panoramaItem);
              }}
            />
            <TopMenuActionButton
              label="多角度"
              disabled={!imageUrl}
              active={multiAngleNodeId === selectedNodeId}
              badge={
                toolPricingLoading || costByTool.multi_angle != null ? (
                  <ToolCreditCostBadge
                    cost={costByTool.multi_angle}
                    creditsEnabled={toolCreditsEnabled}
                    loading={toolPricingLoading}
                  />
                ) : undefined
              }
              title={
                !imageUrl
                  ? "请先上传图片"
                  : costByTool.multi_angle != null
                    ? `多角度 · ${formatCreditLabel(costByTool.multi_angle, toolCreditsEnabled)}`
                    : undefined
              }
              onClick={() => selectedNodeId && openMultiAngle(selectedNodeId)}
            />
            <TopMenuActionButton
              label="打光"
              disabled={!imageUrl}
              active={lightingNodeId === selectedNodeId}
              badge={
                toolPricingLoading || costByTool.lighting != null ? (
                  <ToolCreditCostBadge
                    cost={costByTool.lighting}
                    creditsEnabled={toolCreditsEnabled}
                    loading={toolPricingLoading}
                  />
                ) : undefined
              }
              title={
                !imageUrl
                  ? "请先上传图片"
                  : costByTool.lighting != null
                    ? `打光 · ${formatCreditLabel(costByTool.lighting, toolCreditsEnabled)}`
                    : undefined
              }
              onClick={() => selectedNodeId && openLighting(selectedNodeId)}
            />
            <div ref={creativeToolsMenuRef} className="relative">
              <TopMenuActionButton
                label={grid9Item?.label || "九宫格"}
                withChevron
                chevronOpen={creativeToolsMenuOpen}
                disabled={Boolean(generatingSuffixTool) || gridSplitBusy}
                active={creativeToolsMenuOpen || generatingSuffixTool === "grid_9"}
                // 算力在展开面板各工具行展示，不挂在外层按钮
                title={
                  costByTool.grid_9 != null
                    ? `${grid9Item?.label || "九宫格"} · ${formatCreditLabel(costByTool.grid_9, toolCreditsEnabled)}`
                    : undefined
                }
                onClick={() => {
                  closeOtherImageMenus("creativeTools");
                  setCreativeToolsMenuOpen((open) => !open);
                }}
              />
              {creativeToolsMenuOpen ? (
                <div className={`absolute left-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 w-[520px]`}>
                  <CreativeToolsPopoverPanel
                    nodeId={selectedNodeId}
                    hasImage={Boolean(imageUrl)}
                    visualStyleId={visualStyleId}
                    onVisualStyleChange={handleVisualStyleChange}
                    modelName={nodeModelName}
                    costByTool={costByTool}
                    creditLoading={toolPricingLoading}
                    creditsEnabled={toolCreditsEnabled}
                    onItemSelected={() => setCreativeToolsMenuOpen(false)}
                    onGeneratingChange={(toolId) => setGeneratingSuffixTool(toolId)}
                    className="w-full"
                  />
                </div>
              ) : null}
            </div>
            <TopMenuDropdown
              label="编辑"
              disabled={!imageUrl}
              active={Boolean(
                imageUrl &&
                  selectedNodeId &&
                  (drawingBoardNodeId === selectedNodeId || inlineImageDrawTool != null)
              )}
              open={redrawMenuOpen}
              title={!imageUrl ? "请先上传图片" : undefined}
              onOpenChange={(next) => {
                if (next) closeOtherImageMenus("redraw");
                setRedrawMenuOpen(next);
              }}
              items={[
                {
                  id: "hd",
                  label: "高清",
                  icon: <HdMenuIcon />,
                  creditCost: costByTool.hd_upscale,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  onSelect: () => handleRedrawMenuSelect("hd"),
                },
                {
                  id: "annotate",
                  label: "标注",
                  icon: <AnnotateMenuIcon className="size-[18px]" />,
                  onSelect: () => handleRedrawMenuSelect("annotate"),
                },
                {
                  id: "rotate",
                  label: "旋转",
                  icon: <RotateAxisMenuIcon className="size-[18px]" />,
                  onSelect: () => handleRedrawMenuSelect("rotate"),
                },
                {
                  id: "outpaint",
                  label: "扩图",
                  icon: <Expand className="size-[18px]" strokeWidth={1.75} />,
                  creditCost: costByTool.outpaint,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  onSelect: () => handleRedrawMenuSelect("outpaint"),
                },
                {
                  id: "repaint",
                  label: "画板",
                  icon: <PencilLine className="size-[18px]" strokeWidth={1.75} />,
                  creditCost: costByTool.drawing_board_ai,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  onSelect: () => handleRedrawMenuSelect("repaint"),
                },
                {
                  id: "erase",
                  label: "擦除",
                  icon: <Eraser className="size-[18px]" strokeWidth={1.75} />,
                  onSelect: () => handleRedrawMenuSelect("erase"),
                },
                {
                  id: "cutout",
                  label: "抠图",
                  icon: cutoutBusy ? (
                    <Loader2 className="size-[18px] animate-spin" strokeWidth={1.75} />
                  ) : (
                    <ScanLine className="size-[18px]" strokeWidth={1.75} />
                  ),
                  creditCost: costByTool.cutout,
                  creditLoading: toolPricingLoading,
                  creditsEnabled: toolCreditsEnabled,
                  disabled: cutoutBusy || !imageUrl,
                  onSelect: () => handleRedrawMenuSelect("cutout"),
                },
                {
                  id: "crop",
                  label: "裁剪",
                  icon: <Crop className="size-[18px]" strokeWidth={1.75} />,
                  onSelect: () => handleRedrawMenuSelect("crop"),
                },
              ]}
            />
            <div className="relative">
              <TopMenuActionButton
                label="宫格切分"
                withChevron
                chevronOpen={gridSplitOpen}
                disabled={!imageUrl || Boolean(generatingSuffixTool) || gridSplitBusy}
                active={gridSplitOpen || gridSplitBusy}
                badge={
                  toolPricingLoading || costByTool.grid_split != null ? (
                    <ToolCreditCostBadge
                      cost={costByTool.grid_split}
                      creditsEnabled={toolCreditsEnabled}
                      loading={toolPricingLoading}
                    />
                  ) : undefined
                }
                title={
                  !imageUrl
                    ? "请先上传图片"
                    : costByTool.grid_split != null
                      ? `宫格切分 · ${formatCreditLabel(costByTool.grid_split, toolCreditsEnabled)}`
                      : undefined
                }
                onClick={() => {
                  closeOtherImageMenus("gridSplit");
                  setGridSplitOpen((open) => !open);
                }}
              />
              <GridSplitPopover
                open={gridSplitOpen}
                creditLabel={
                  costByTool.grid_split != null && !toolPricingLoading
                    ? formatCreditLabel(costByTool.grid_split, toolCreditsEnabled)
                    : ""
                }
                busy={gridSplitBusy}
                progressText={gridSplitProgress}
                onConfirm={(rows, cols) => void handleGridSplitConfirm(rows, cols)}
                onClose={() => {
                  if (!gridSplitBusy) setGridSplitOpen(false);
                }}
              />
            </div>
            <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden />

            <div ref={uploadMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  closeOtherImageMenus("upload");
                  setUploadMenuOpen((open) => !open);
                }}
                className={`inline-flex items-center rounded-md p-2 transition-colors ${
                  uploadMenuOpen
                    ? "bg-white/15 text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
                title="上传图片"
                aria-label="上传图片"
                aria-expanded={uploadMenuOpen}
              >
                <Upload className="h-4 w-4 shrink-0" />
              </button>
              {uploadMenuOpen ? (
                <div
                  className={`absolute right-0 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1.5 min-w-[168px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedNodeId) return;
                      requestImageUploadAction(selectedNodeId, "local");
                      setUploadMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                  >
                    <Upload className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                    本地上传
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedNodeId) return;
                      requestImageUploadAction(selectedNodeId, "asset");
                      setUploadMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                  >
                    <FolderOpen className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                    从资产选择
                  </button>
                  {canContinueDrawingBoard ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedNodeId) return;
                        openDrawingBoard(selectedNodeId, "continue");
                        setUploadMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                    >
                      <Pencil className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                      继续编辑画板
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedNodeId) return;
                      openDrawingBoard(selectedNodeId, "draw");
                      setUploadMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] text-white/85 transition-colors hover:bg-white/[0.08]"
                  >
                    <Paintbrush className="size-[18px] shrink-0 text-white/70" strokeWidth={1.75} />
                    画图绘制
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={!imageUrl}
              onClick={handleDownloadImage}
              className="inline-flex items-center rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              title={!imageUrl ? "请先上传图片" : "下载"}
            >
              <Download className="h-4 w-4 shrink-0" />
            </button>
            <button
              type="button"
              disabled={!imageUrl}
              onClick={handleOpenMediaPreview}
              className="inline-flex items-center rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              title={!imageUrl ? "请先上传图片" : "全屏查看"}
            >
              <Maximize2 className="h-4 w-4 shrink-0" />
            </button>
          </>
        ) : null}

        {isVideoNode ? (
          <>
            {!framePickActive && !trimActive && !videoCropActive ? (
              <>
                {/* 右侧工具区：下载 / 全屏 */}
                <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden />
                <button
                  type="button"
                  disabled={!videoUrl}
                  onClick={handleDownloadVideo}
                  className="inline-flex items-center rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  title={!videoUrl ? "请先上传视频" : "下载"}
                  aria-label="下载"
                >
                  <Download className="h-4 w-4 shrink-0" />
                </button>
                <button
                  type="button"
                  disabled={!videoUrl}
                  onClick={handleOpenMediaPreview}
                  className="inline-flex items-center rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  title={!videoUrl ? "请先上传视频" : "全屏查看"}
                  aria-label="全屏查看"
                >
                  <Maximize2 className="h-4 w-4 shrink-0" />
                </button>
              </>
            ) : framePickActive ? (
              <>
                <span className="px-2 text-[13px] tabular-nums text-purple-200/90">
                  选帧 {formatVideoTime(framePickTimeSec)}
                </span>
                <button
                  type="button"
                  disabled={savingFrame}
                  onClick={() => void handleSaveFrame()}
                  className="inline-flex items-center gap-1 rounded-md bg-purple-500/25 px-2.5 py-1.5 text-[13px] text-purple-100 ring-1 ring-purple-400/35 transition-colors hover:bg-purple-500/35 disabled:opacity-50"
                >
                  <Camera className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {savingFrame ? "保存中…" : "保存此帧"}
                </button>
                <button
                  type="button"
                  disabled={savingFrame}
                  onClick={closeFramePick}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  title="取消 (Esc)"
                >
                  <X className="h-3.5 w-3.5 shrink-0" />
                  取消
                </button>
              </>
            ) : (
              <>
                {/* 剪辑模式：展示选区时长 + 导出 / 取消 */}
                <span className="px-2 text-[13px] tabular-nums text-purple-200/90">
                  {formatVideoTime(inlineVideoTrim?.inSec ?? 0)} –{" "}
                  {formatVideoTime(inlineVideoTrim?.outSec ?? 0)}
                  <span className="ml-1 text-white/40">
                    (
                    {formatVideoTime(
                      Math.max(0, (inlineVideoTrim?.outSec ?? 0) - (inlineVideoTrim?.inSec ?? 0))
                    )}
                    )
                  </span>
                </span>
                <button
                  type="button"
                  disabled={savingTrim}
                  onClick={() => void handleConfirmVideoTrim()}
                  className="inline-flex items-center gap-1 rounded-md bg-purple-500/25 px-2.5 py-1.5 text-[13px] text-purple-100 ring-1 ring-purple-400/35 transition-colors hover:bg-purple-500/35 disabled:opacity-50"
                >
                  <Scissors className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {savingTrim ? "导出中…" : "导出片段"}
                </button>
                <button
                  type="button"
                  disabled={savingTrim}
                  onClick={closeInlineVideoTrim}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-white/55 transition-colors hover:bg-white/10 hover:text-white"
                  title="取消 (Esc)"
                >
                  <X className="h-3.5 w-3.5 shrink-0" />
                  取消
                </button>
              </>
            )}
          </>
        ) : null}

        {/* 音频顶栏：下载 */}
        {isAudioNode ? (
          <>
            <button
              type="button"
              disabled={!audioUrl}
              onClick={() => void handleDownloadAudio()}
              className="inline-flex items-center rounded-md p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
              title={!audioUrl ? "请先上传或生成音频" : "下载"}
              aria-label="下载"
            >
              <Download className="h-4 w-4 shrink-0" />
            </button>
          </>
        ) : null}
      </div>
    </EdgeLabelRenderer>
    {mediaPreviewUrl && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-[#0e0e0e]"
            role="dialog"
            aria-modal="true"
            aria-label="媒体预览"
            onClick={() => setMediaPreviewUrl(null)}
          >
            <button
              type="button"
              className="absolute right-4 top-4 z-[301] flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="关闭预览"
              title="关闭"
              onClick={(e) => {
                e.stopPropagation();
                setMediaPreviewUrl(null);
              }}
            >
              <X className="size-5" strokeWidth={2} />
            </button>
            {isVideoNode ? (
              <video
                src={mediaPreviewUrl}
                controls
                autoPlay
                className="max-h-[100vh] max-w-[100vw] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            ) : isAudioNode ? (
              <audio
                src={mediaPreviewUrl}
                controls
                autoPlay
                className="w-[min(520px,90vw)]"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaPreviewUrl}
                alt="预览"
                className="max-h-[100vh] max-w-[100vw] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>,
          document.body
        )
      : null}
    </>
  );
}

