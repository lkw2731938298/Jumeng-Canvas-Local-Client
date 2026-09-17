"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";
import { TEXT_MODEL_OPTIONS } from "@/lib/canvas/textModels";

function textModelUserLabel(modelId: string | undefined): string {
  const id = String(modelId || "").trim();
  if (!id) return "文本模型";
  const hit = TEXT_MODEL_OPTIONS.find((o) => o.value === id);
  return hit?.label ?? "文本模型";
}
import { useCanvasStore } from "@/stores/canvasStore";
import { Music, Pause, Play } from "lucide-react";
import { useMediaUpload } from "./useMediaUpload";
import { MediaSourceMenu } from "./MediaSourceMenu";
import { MediaAssetPicker } from "./MediaAssetPicker";
import { MediaUploadOverlay } from "./MediaUploadOverlay";
import { VideoNodeControls } from "./VideoNodeControls";
import { AudioNodeControls } from "./AudioNodeControls";
import { useMediaNodeSize } from "@/lib/canvas/useMediaNodeSize";
import { sizeFromMedia } from "@/lib/canvas/nodeSizing";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";
import { canvasStreamUrlFromUrl, normalizeStorageUrl } from "@/lib/api/storageUrl";
import { registerVideoNodeRef } from "@/lib/canvas/videoNodeRegistry";
import { mediaDurationToBillSeconds } from "@/lib/canvas/canvasVideoToolBilling";
import { assetHasImageThumbnail } from "@/components/canvas/panels/AssetThumbnail";
import { useMediaNodeActive } from "@/lib/canvas/useMediaNodeActive";
import { primeVideoFirstFrame } from "@/lib/canvas/videoFirstFrame";
import { seekVideoToTime } from "@/lib/canvas/captureVideoLastFrame";
import { cn } from "@/lib/utils";
import { InlineImageDrawingOverlay } from "./InlineImageDrawingOverlay";
import { imageTransformCss } from "@/lib/canvas/imageTransform";
import {
  getLibraryCategory,
  isLibraryLockedParams,
  isLibraryUiLockedParams,
} from "@/lib/canvas/materialLibrary";

// -------------------- ImageInput --------------------
export const ImageInputNode = memo(function ImageInputNode(props: NodeProps) {
  const nodeId = props.id;
  const selected = props.selected ?? false;
  const updateNodeInternals = useUpdateNodeInternals();
  const data = props.data as WorkflowNodeData;
  const status = data.status ?? "idle";
  // 素材库锁定节点：仅作参考，禁止上传/画板等编辑入口
  const libraryLocked = isLibraryLockedParams(data.params);
  const { url } = useNodeAssetMedia(nodeId, { urlParamKey: "imageUrl" });
  const imageAssetId = String(data.params?.assetId ?? "");
  const drawingMeta = data.params?.drawingMeta as { source?: string } | undefined;
  const drawingDraft = data.params?.drawingDraft as { ossKey?: string } | undefined;
  const inlineImageDrawing = data.params?.inlineImageDrawing;
  const canContinueEdit = Boolean(
    url && (drawingMeta?.source === "drawing_board" || drawingDraft?.ossKey)
  );
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeSize = useCanvasStore((s) => s.updateNodeSize);
  const openDrawingBoard = useCanvasStore((s) => s.openDrawingBoard);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const inlineImageDrawTool = useCanvasStore((s) => s.inlineImageDrawTool);
  const inlineImageEraseMode = useCanvasStore((s) => s.inlineImageEraseMode);
  const inlineImageTransform = useCanvasStore((s) => s.inlineImageTransform);
  const anchorRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  useMediaNodeSize(nodeId, url);
  // store 焦点与 RF selected 任一成立即显示笔迹层，避免工具条已开但 canvas 未挂载
  const drawingOverlayVisible = selected || selectedNodeId === nodeId;
  const drawingInteractive =
    drawingOverlayVisible &&
    (inlineImageDrawTool != null || inlineImageEraseMode || Boolean(inlineImageTransform));
  const isCutoutNode = data.params?.toolMode === "cutout";
  // 旋转预览：本节点选中且处于旋转态时，卡片按 AABB 放大并完整展示倾斜图
  const transformActive =
    Boolean(inlineImageTransform) &&
    (selected || selectedNodeId === nodeId);
  const transformBaseW = inlineImageTransform?.baseWidth ?? 0;
  const transformBaseH = inlineImageTransform?.baseBodyHeight ?? 0;

  const syncImageSize = useCallback((image: HTMLImageElement | null) => {
    if (!image) return;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0) {
      setImageSize({ width, height });
      // 本机 /api/local/asset 常无扩展名，useMediaNodeSize 以前会跳过，节点停在方框里，
      // object-cover 把 9:16 裁成 1:1，看起来就像比例没传进去。
      const next = sizeFromMedia(width, height);
      updateNodeSize(nodeId, next.width, next.height);
    }
  }, [nodeId, updateNodeSize]);

  useEffect(() => {
    if (url) updateNodeInternals(nodeId);
  }, [url, nodeId, updateNodeInternals]);

  useEffect(() => {
    syncImageSize(imageRef.current);
  }, [url, imageAssetId, syncImageSize]);

  const {
    inputRef,
    handleUpload,
    handleFileChange,
    uploading,
    accept,
    category,
    menuOpen,
    setMenuOpen,
    pickerOpen,
    setPickerOpen,
    openSourceMenu,
    applyAsset,
  } = useMediaUpload(
    { urlParamKey: "imageUrl", accept: "image/*", category: "image" },
    nodeId,
    updateNodeData,
    anchorRef
  );

  useEffect(() => {
    if (libraryLocked) return;
    const onOpenUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) openSourceMenu();
    };
    const onLocalUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) handleUpload();
    };
    const onAssetUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) setPickerOpen(true);
    };
    window.addEventListener("canvas:open-image-upload", onOpenUpload);
    window.addEventListener("canvas:image-upload-local", onLocalUpload);
    window.addEventListener("canvas:image-upload-asset", onAssetUpload);
    return () => {
      window.removeEventListener("canvas:open-image-upload", onOpenUpload);
      window.removeEventListener("canvas:image-upload-local", onLocalUpload);
      window.removeEventListener("canvas:image-upload-asset", onAssetUpload);
    };
  }, [nodeId, openSourceMenu, handleUpload, setPickerOpen, libraryLocked]);

  useEffect(() => {
    if (transformActive) updateNodeInternals(nodeId);
  }, [
    transformActive,
    inlineImageTransform?.rotation,
    transformBaseW,
    transformBaseH,
    nodeId,
    updateNodeInternals,
  ]);

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Image"
      color="#f59e0b"
      status={status}
      bodyFlush
      // 旋转 AABB 可能超过常规 max，临时放开上限
      unboundedResize={transformActive && !libraryLocked}
    >
      <div
        ref={anchorRef}
        className={cn(
          "relative z-20 h-full w-full",
          transformActive ? "overflow-visible" : "overflow-hidden",
          drawingInteractive && "nodrag nopan"
        )}
      >
        {url ? (
          <div
            className={cn(
              "absolute inset-0",
              transformActive && "flex items-center justify-center"
            )}
            style={
              // 抠图透明底：棋盘格衬底，完整显示人物（contain 不裁切）
              isCutoutNode
                ? {
                    backgroundColor: "#c8c8c8",
                    backgroundImage:
                      "linear-gradient(45deg, #f0f0f0 25%, transparent 25%), linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0f0f0 75%), linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)",
                    backgroundSize: "16px 16px",
                    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
                  }
                : undefined
            }
          >
            {transformActive && inlineImageTransform && transformBaseW > 0 && transformBaseH > 0 ? (
              <div
                className="relative shrink-0 transition-transform duration-200"
                style={{
                  width: transformBaseW,
                  height: transformBaseH,
                  transform: imageTransformCss(inlineImageTransform),
                }}
              >
                <img
                  ref={imageRef}
                  key={imageAssetId || nodeId}
                  src={url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  fetchPriority={selected ? "auto" : "low"}
                  className={cn(
                    "h-full w-full pointer-events-none object-cover",
                    inlineImageEraseMode && "invisible"
                  )}
                  draggable={false}
                  onLoad={(event) => {
                    syncImageSize(event.currentTarget);
                    updateNodeInternals(nodeId);
                  }}
                />
                {/* 旋转预览选区描边（对齐产品示意） */}
                <div
                  className="pointer-events-none absolute inset-0 ring-2 ring-sky-400 ring-inset"
                  aria-hidden
                />
              </div>
            ) : (
              <img
                ref={imageRef}
                key={imageAssetId || nodeId}
                src={url}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority={selected ? "auto" : "low"}
                className={cn(
                  "h-full w-full pointer-events-none transition-transform duration-200",
                  isCutoutNode ? "object-contain" : "object-cover",
                  inlineImageEraseMode && "invisible"
                )}
                draggable={false}
                onLoad={(event) => {
                  syncImageSize(event.currentTarget);
                  updateNodeInternals(nodeId);
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center px-3 text-center text-[13px] text-white/35">
            {data.params?.toolMode === "hd_upscale"
              ? "配置参数生成高清图像"
              : typeof data.params?.toolMode === "string" &&
                  String(data.params.toolMode).startsWith("creative_")
                ? `配置参数生成「${data.label || "创作"}」`
                : "选中节点后，在上方菜单点击「上传图片」或选择画图绘制"}
          </div>
        )}
        {url && !libraryLocked ? (
          <InlineImageDrawingOverlay
            nodeId={nodeId}
            sourceAssetId={imageAssetId || String(data.params?.imageUrl ?? "")}
            imageUrl={url}
            imageRef={imageRef}
            imageWidth={imageSize.width}
            imageHeight={imageSize.height}
            value={inlineImageDrawing}
            visible={drawingOverlayVisible}
          />
        ) : null}
        {!libraryLocked && menuOpen && (
          <MediaSourceMenu
            anchorRef={anchorRef}
            onUpload={handleUpload}
            onPickAsset={() => setPickerOpen(true)}
            showDraw
            onDraw={() => openDrawingBoard(nodeId, "draw")}
            showContinueEdit={canContinueEdit}
            onContinueEdit={() => openDrawingBoard(nodeId, "continue")}
            onClose={() => setMenuOpen(false)}
          />
        )}
        {!libraryLocked && pickerOpen && (
          <MediaAssetPicker category={category} onSelect={applyAsset} onClose={() => setPickerOpen(false)} />
        )}
        {!libraryLocked && (
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
        )}
      </div>
    </BaseNode>
  );
});

// -------------------- VideoInput --------------------
export const VideoInputNode = memo(function VideoInputNode(props: NodeProps) {
  const nodeId = props.id;
  const selected = props.selected ?? false;
  const updateNodeInternals = useUpdateNodeInternals();
  const data = props.data as WorkflowNodeData;
  const status = data.status ?? "idle";
  // 素材库锁定：特效库节点自动无声循环，隐藏编辑控件
  const libraryLocked = isLibraryLockedParams(data.params);
  const isEffectLibrary = getLibraryCategory(data.params) === "effect";
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const framePickNodeId = useCanvasStore((s) => s.framePickNodeId);
  const setFramePickTime = useCanvasStore((s) => s.setFramePickTime);
  const inlineVideoTrim = useCanvasStore((s) => s.inlineVideoTrim);
  const inlineVideoCrop = useCanvasStore((s) => s.inlineVideoCrop);
  const framePickActive = !libraryLocked && framePickNodeId === nodeId;
  /** 节点内联剪辑模式（与选帧互斥，需保持 video 挂载） */
  const trimActive = !libraryLocked && inlineVideoTrim?.nodeId === nodeId;
  /** 节点空间裁剪模式 */
  const cropActive = !libraryLocked && inlineVideoCrop?.nodeId === nodeId;
  const mediaToolActive = framePickActive || trimActive || cropActive;
  const anchorRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  /** 用户点过暂停：鼠标移出不回封面/不跳首帧，保持当前暂停画面 */
  const [holdPausedFrame, setHoldPausedFrame] = useState(false);
  /** 封面图加载失败时回退到视频首帧，避免裂图图标 */
  const [posterBroken, setPosterBroken] = useState(false);
  const { url, thumbnailUrl, asset } = useNodeAssetMedia(nodeId, { urlParamKey: "videoUrl" });
  const canvasStreamSrc = useMemo(
    () => (url ? canvasStreamUrlFromUrl(url) : ""),
    [url]
  );
  const videoSrc = framePickActive && canvasStreamSrc ? canvasStreamSrc : url;
  const canPlayVideo = useMediaNodeActive(selected, cardHovered, mediaToolActive);
  const posterUrl =
    !posterBroken && asset && assetHasImageThumbnail(asset)
      ? normalizeStorageUrl(thumbnailUrl || "")
      : "";
  // 用户暂停保持帧时继续显示 video，不盖回封面图
  const showPosterImage =
    Boolean(posterUrl) &&
    !previewPlaying &&
    !mediaToolActive &&
    !cardHovered &&
    !holdPausedFrame;
  const frameRate = Number(data.params?.frameRate) || 24;
  useMediaNodeSize(nodeId, url);

  useEffect(() => {
    setPosterBroken(false);
  }, [thumbnailUrl, asset?.id]);

  useEffect(() => {
    if (!posterBroken) return;
    const video = videoRef.current;
    if (video) primeVideoFirstFrame(video);
  }, [posterBroken]);

  const startVideoPreview = useCallback((video: HTMLVideoElement) => {
    setHoldPausedFrame(false);
    setPreviewPlaying(true);
    void video.play().catch(() => {
      setPreviewPlaying(false);
    });
  }, []);

  const resetVideoPreview = useCallback(
    (video: HTMLVideoElement) => {
      video.pause();
      setPreviewPlaying(false);
      setHoldPausedFrame(false);
      if (posterUrl) {
        video.currentTime = 0;
      } else {
        primeVideoFirstFrame(video);
      }
    },
    [posterUrl]
  );

  const handleUserPlaybackChange = useCallback((playing: boolean) => {
    if (playing) {
      setHoldPausedFrame(false);
      setPreviewPlaying(true);
    } else {
      setHoldPausedFrame(true);
      setPreviewPlaying(false);
    }
  }, []);

  useEffect(() => {
    if (!framePickActive || !url) return;
    const video = videoRef.current;
    if (!video) return;

    video.pause();
    setPreviewPlaying(false);
    // 进入截取后立刻登记，避免顶栏「保存」时拿不到元素
    registerVideoNodeRef(nodeId, video);

    const target = useCanvasStore.getState().framePickTimeSec;
    let cancelled = false;

    void (async () => {
      try {
        // 切到同源 stream 后须等元数据就绪再 seek，否则进度条 duration=0 / 定位失败
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
              cleanup();
              reject(new Error("视频元数据加载超时"));
            }, 15_000);
            const onMeta = () => {
              cleanup();
              resolve();
            };
            const onError = () => {
              cleanup();
              reject(new Error("视频加载失败"));
            };
            const cleanup = () => {
              window.clearTimeout(timer);
              video.removeEventListener("loadedmetadata", onMeta);
              video.removeEventListener("error", onError);
            };
            video.addEventListener("loadedmetadata", onMeta, { once: true });
            video.addEventListener("error", onError, { once: true });
            // 部分浏览器仅改 src 不触发 load，强制拉取
            if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) {
              video.load();
            }
          });
        }
        if (cancelled) return;
        await seekVideoToTime(video, target);
        if (!cancelled) setFramePickTime(video.currentTime);
      } catch {
        // 保存时再暴露错误；此处不 toast，避免重复打扰
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 进入截取 / 切 stream 时执行一次
  }, [framePickActive, nodeId, videoSrc, setFramePickTime]);

  useEffect(() => {
    return () => registerVideoNodeRef(nodeId, null);
  }, [nodeId]);

  useEffect(() => {
    // 剪辑模式进入时登记 video，便于顶栏导出时读 duration
    if (!trimActive || !url) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPreviewPlaying(false);
    registerVideoNodeRef(nodeId, video);
    const inSec = useCanvasStore.getState().inlineVideoTrim?.inSec ?? 0;
    if (Number.isFinite(inSec) && inSec >= 0) {
      void seekVideoToTime(video, inSec).catch(() => {});
    }
  }, [trimActive, nodeId, url, videoSrc]);

  useEffect(() => {
    // 始终登记当前节点 video：顶栏高清等工具要读真实片长，不能只在播放/剪辑时才登记
    registerVideoNodeRef(nodeId, videoRef.current);
  }, [mediaToolActive, previewPlaying, holdPausedFrame, nodeId, videoSrc]);

  useEffect(() => {
    // 特效库节点持续循环，不受悬停/选中预览逻辑打断
    if (isEffectLibrary) return;
    // 用户主动暂停后，取消悬停/选中也必须保留当前帧，不能回封面。
    if (canPlayVideo || mediaToolActive || holdPausedFrame) return;
    const video = videoRef.current;
    if (!video) return;
    resetVideoPreview(video);
  }, [canPlayVideo, mediaToolActive, holdPausedFrame, resetVideoPreview, isEffectLibrary]);

  useEffect(() => {
    if (isEffectLibrary) return;
    if (!cardHovered || mediaToolActive || !url || previewPlaying || holdPausedFrame) return;
    if (useCanvasStore.getState().isCanvasDragging) return;
    const video = videoRef.current;
    if (!video) return;
    startVideoPreview(video);
  }, [
    cardHovered,
    mediaToolActive,
    url,
    previewPlaying,
    holdPausedFrame,
    startVideoPreview,
    isEffectLibrary,
  ]);

  useEffect(() => {
    if (isEffectLibrary) return;
    setPreviewPlaying(false);
    setHoldPausedFrame(false);
  }, [videoSrc, isEffectLibrary]);

  useEffect(() => {
    if (url) updateNodeInternals(nodeId);
  }, [url, nodeId, updateNodeInternals]);

  const handleHoverChange = useCallback(
    (hovered: boolean) => {
      setCardHovered(hovered);
      if (mediaToolActive) return;
      const video = videoRef.current;
      if (!video || !url) return;

      const isCanvasDragging = useCanvasStore.getState().isCanvasDragging;
      if (hovered && !isCanvasDragging) {
        // 用户刚点过暂停：悬停回来也不自动续播，保持静止画面
        if (holdPausedFrame) return;
        startVideoPreview(video);
        return;
      }
      if (!hovered) {
        if (holdPausedFrame) {
          // 暂停后移出：只停播，不跳回封面/首帧
          video.pause();
          setPreviewPlaying(false);
          return;
        }
        resetVideoPreview(video);
      }
    },
    [url, mediaToolActive, holdPausedFrame, startVideoPreview, resetVideoPreview]
  );

  const handleVideoMetadata = useCallback(
    (video: HTMLVideoElement) => {
      if (!previewPlaying && !mediaToolActive && !posterUrl) {
        primeVideoFirstFrame(video);
      }
      // 把真实片长写入节点，供顶栏「高清」按当前视频秒数报价（勿用生成档位 duration）
      const billSec = mediaDurationToBillSeconds(video.duration);
      if (billSec != null) {
        const prev = mediaDurationToBillSeconds(data.params?.durationSec);
        if (prev !== billSec) updateNodeParam(nodeId, "durationSec", billSec);
      }
      updateNodeInternals(nodeId);
    },
    [previewPlaying, mediaToolActive, posterUrl, nodeId, updateNodeInternals, updateNodeParam, data.params?.durationSec]
  );

  const {
    inputRef,
    handleUpload,
    handleFileChange,
    uploading,
    accept,
    category,
    menuOpen,
    setMenuOpen,
    pickerOpen,
    setPickerOpen,
    openSourceMenu,
    applyAsset,
  } = useMediaUpload(
    { urlParamKey: "videoUrl", accept: "video/*", category: "video" },
    nodeId,
    updateNodeData,
    anchorRef
  );

  useEffect(() => {
    if (libraryLocked) return;
    const onOpenUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) openSourceMenu();
    };
    const onLocalUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) handleUpload();
    };
    const onAssetUpload = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail;
      if (detail?.nodeId === nodeId) setPickerOpen(true);
    };
    window.addEventListener("canvas:open-video-upload", onOpenUpload);
    window.addEventListener("canvas:video-upload-local", onLocalUpload);
    window.addEventListener("canvas:video-upload-asset", onAssetUpload);
    return () => {
      window.removeEventListener("canvas:open-video-upload", onOpenUpload);
      window.removeEventListener("canvas:video-upload-local", onLocalUpload);
      window.removeEventListener("canvas:video-upload-asset", onAssetUpload);
    };
  }, [nodeId, openSourceMenu, handleUpload, setPickerOpen, libraryLocked]);

  // 特效库节点：有 URL 后持续无声循环（避开预览暂停链路）
  useEffect(() => {
    if (!isEffectLibrary || !url) return;
    let cancelled = false;
    const tryPlay = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video) return;
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      setPreviewPlaying(true);
      void video.play().catch(() => {
        if (!cancelled) setPreviewPlaying(false);
      });
    };
    tryPlay();
    // 签名 URL / 解码就绪后可能需再试一次
    const timer = window.setTimeout(tryPlay, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isEffectLibrary, url, videoSrc]);

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Video"
      color="#ef4444"
      status={status}
      bodyFlush
      onHoverChange={url && !libraryLocked ? handleHoverChange : undefined}
    >
      <div
        ref={anchorRef}
        className={`relative z-20 h-full w-full${mediaToolActive ? " ring-2 ring-purple-400/70 ring-inset" : ""}`}
      >
        {url ? (
          <>
            {showPosterImage && !isEffectLibrary ? (
              <img
                src={posterUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 z-0 h-full w-full object-cover pointer-events-none"
                draggable={false}
                onError={() => setPosterBroken(true)}
              />
            ) : null}
            <video
              ref={(el) => {
                videoRef.current = el;
                // 挂载即登记，供截帧与按时长报价读取 duration
                if (el) registerVideoNodeRef(nodeId, el);
                // 挂载时立刻尝试播放（特效库）
                if (el && isEffectLibrary) {
                  el.muted = true;
                  el.defaultMuted = true;
                  el.loop = true;
                  void el.play().catch(() => {});
                }
              }}
              src={videoSrc}
              className={cn(
                "relative z-[1] h-full w-full object-cover pointer-events-none",
                showPosterImage && !isEffectLibrary && "opacity-0"
              )}
              crossOrigin="anonymous"
              muted
              playsInline
              loop={isEffectLibrary}
              autoPlay={isEffectLibrary}
              preload={mediaToolActive || isEffectLibrary ? "auto" : "metadata"}
              poster={!isEffectLibrary ? posterUrl || undefined : undefined}
              onLoadedData={(e) => {
                if (!isEffectLibrary) return;
                e.currentTarget.muted = true;
                void e.currentTarget.play().catch(() => {});
              }}
              onLoadedMetadata={(e) => {
                if (isEffectLibrary) {
                  e.currentTarget.muted = true;
                  e.currentTarget.loop = true;
                  void e.currentTarget.play().catch(() => {});
                  setPreviewPlaying(true);
                  return;
                }
                handleVideoMetadata(e.currentTarget);
              }}
            />
            {!libraryLocked && (
              <VideoNodeControls
                videoRef={videoRef}
                src={videoSrc}
                visible={cardHovered || mediaToolActive || previewPlaying || holdPausedFrame}
                framePickActive={framePickActive}
                trimActive={trimActive}
                nodeId={nodeId}
                frameRate={frameRate}
                onUserPlaybackChange={handleUserPlaybackChange}
              />
            )}
          </>
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center px-3 text-center text-[11px] text-white/35">
            {data.params?.toolMode === "hd_upscale"
              ? "配置参数生成高清视频"
              : "选中节点后，在上方菜单点击「上传视频」"}
          </div>
        )}
        {!libraryLocked && menuOpen && (
          <MediaSourceMenu
            anchorRef={anchorRef}
            onUpload={handleUpload}
            onPickAsset={() => setPickerOpen(true)}
            onClose={() => setMenuOpen(false)}
          />
        )}
        {!libraryLocked && pickerOpen && (
          <MediaAssetPicker category={category} onSelect={applyAsset} onClose={() => setPickerOpen(false)} />
        )}
        {!libraryLocked && (
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
        )}
        {!libraryLocked && uploading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] text-white/80">
            上传中...
          </div>
        ) : null}
      </div>
    </BaseNode>
  );
});

// -------------------- AudioInput --------------------
export const AudioInputNode = memo(function AudioInputNode(props: NodeProps) {
  const nodeId = props.id;
  const data = props.data as WorkflowNodeData;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const anchorRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  // 与图片/视频一致：经 manifest / 签名 URL 解析，避免过期直链无法播放
  const { url } = useNodeAssetMedia(nodeId, { urlParamKey: "audioUrl" });
  const volume = Number(data.params?.volume ?? 1);

  const {
    inputRef,
    handleUpload,
    handleFileChange,
    uploading,
    accept,
    category,
    menuOpen,
    setMenuOpen,
    pickerOpen,
    setPickerOpen,
    openSourceMenu,
    applyAsset,
    uploadBtnVisible,
    showUploadButton,
  } = useMediaUpload(
    { urlParamKey: "audioUrl", accept: "audio/*", category: "audio" },
    nodeId,
    updateNodeData,
    anchorRef
  );

  const fileLabel = useMemo(() => {
    if (!url) return "音频文件";
    try {
      return decodeURIComponent(url.split("/").pop()?.split("?")[0] || "音频文件");
    } catch {
      return "音频文件";
    }
  }, [url]);

  // 切换音频源或卸载时停止播放，避免残留声音
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [url]);

  useEffect(() => {
    setPlaying(false);
  }, [url]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [url]);

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Music"
      color="#ec4899"
      status={data.status ?? "idle"}
      bodyFlush
      aboveCard={
        url ? (
          <MediaUploadOverlay
            placement="above"
            visible={uploadBtnVisible}
            uploading={uploading}
            label="点击上传音频"
            iconOnly
            onOpenMenu={openSourceMenu}
          />
        ) : undefined
      }
    >
      <div
        ref={anchorRef}
        className={`relative flex h-full w-full flex-col items-center justify-center gap-2${url ? " cursor-pointer" : ""}`}
        onClick={url ? showUploadButton : undefined}
      >
        {url ? (
          <>
            {/* 隐藏 audio：由卡片中央按钮驱动播放已有音频 */}
            <audio
              ref={audioRef}
              src={url}
              preload="metadata"
              className="hidden"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 pb-8">
              <button
                type="button"
                className="nodrag nopan pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/25 text-pink-100 ring-1 ring-pink-300/40 transition-colors hover:bg-pink-500/40"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                aria-label={playing ? "暂停" : "播放"}
                title={playing ? "暂停" : "播放"}
              >
                {playing ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 translate-x-0.5 fill-current" />
                )}
              </button>
              <span className="max-w-[90%] truncate text-[10px] text-white/45">
                {fileLabel}
              </span>
            </div>
            <Music className="pointer-events-none absolute right-2 top-2 h-4 w-4 text-pink-300/35" />
            <AudioNodeControls audioRef={audioRef} src={url} volume={volume} />
          </>
        ) : (
          <MediaUploadOverlay
            placement="center"
            uploading={uploading}
            label="点击上传音频"
            iconOnly
            onOpenMenu={openSourceMenu}
          />
        )}
        {menuOpen && (
          <MediaSourceMenu
            anchorRef={anchorRef}
            onUpload={handleUpload}
            onPickAsset={() => setPickerOpen(true)}
            onClose={() => setMenuOpen(false)}
          />
        )}
        {pickerOpen && (
          <MediaAssetPicker category={category} onSelect={applyAsset} onClose={() => setPickerOpen(false)} />
        )}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />
      </div>
    </BaseNode>
  );
});

// -------------------- VAEDecode --------------------
export const VAEDecodeNode = memo(function VAEDecodeNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  return (
    <BaseNode {...props} data={data} icon="ImagePlay" color="#8b5cf6" status={data.status ?? "idle"}>
      <div className="flex h-full items-center text-white/50">Latent → 图片</div>
    </BaseNode>
  );
});

// -------------------- ImagePreview --------------------
export const ImagePreviewNode = memo(function ImagePreviewNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  const url = normalizeStorageUrl(data.outputAssets?.[0]?.url);
  useMediaNodeSize(props.id, url);
  return (
    <BaseNode {...props} data={data} icon="Eye" color="#f59e0b" status={data.status ?? "idle"} bodyFlush>
      <div className="flex h-full min-h-0 items-center justify-center">
        {url ? (
          <img src={url} alt="preview" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="text-white/30">等待生成...</span>
        )}
      </div>
    </BaseNode>
  );
});

// -------------------- TextInput --------------------
export const TextInputNode = memo(function TextInputNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  // 提示词库：优先 content，被 overlay 空拉取覆盖时回退 libraryPromptText
  const content =
    String(data.params?.content || data.params?.libraryPromptText || "").trim();
  const libraryCategory = getLibraryCategory(data.params);
  // 提示词库可编辑；其它素材库媒体节点仍可能 UI 锁定
  const uiLocked = isLibraryUiLockedParams(data.params);

  return (
    <BaseNode {...props} data={data} icon="Type" color="#06b6d4" status={data.status ?? "idle"}>
      {/* 固定节点尺寸：不截断行数，正文区滚动以查看全文 */}
      <div className="nowheel h-full min-h-0 w-full overflow-y-auto py-0.5">
        {libraryCategory === "prompt" ? (
          <p className="mb-1 text-[10px] text-cyan-300/70">提示词库</p>
        ) : null}
        {content ? (
          <p className="w-full text-xs leading-relaxed text-white/75 whitespace-pre-wrap break-words">
            {content}
          </p>
        ) : (
          <p className="w-full text-xs italic text-white/25">
            {uiLocked ? "（空提示词）" : "点击编辑文本..."}
          </p>
        )}
      </div>
    </BaseNode>
  );
});

// -------------------- LoRA --------------------
export const LoRANode = memo(function LoRANode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  return (
    <BaseNode {...props} data={data} icon="PlusCircle" color="#3b82f6" status={data.status ?? "idle"}>
      <div className="space-y-1">
        <span className="text-white/50">LoRA</span>
        <div className="text-white/80">{String(data.params?.lora_name || "-")}</div>
        <span className="text-white/50">强度: {String(data.params?.strength ?? 1)}</span>
      </div>
    </BaseNode>
  );
});

// -------------------- Upscale --------------------
export const UpscaleNode = memo(function UpscaleNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  return (
    <BaseNode {...props} data={data} icon="Maximize2" color="#10b981" status={data.status ?? "idle"}>
      <div className="text-white/50">x{String(data.params?.scale ?? 2)} · {String(data.params?.method ?? "esrgan")}</div>
    </BaseNode>
  );
});

// -------------------- LLMText --------------------
export const LLMTextNode = memo(function LLMTextNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  return (
    <BaseNode {...props} data={data} icon="Brain" color="#8b5cf6" status={data.status ?? "idle"}>
      <div className="space-y-1">
        <span className="text-white/50">模型: {textModelUserLabel(data.params?.model as string | undefined)}</span>
        <span className="text-white/50 block">max_tokens: {String(data.params?.max_tokens ?? 2048)}</span>
      </div>
    </BaseNode>
  );
});
