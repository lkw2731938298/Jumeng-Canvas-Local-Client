"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Film,
  Image as ImageIcon,
  LayoutTemplate,
  Sparkles,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  resolveAddNodePosition,
  viewportCenterFlowPosition,
} from "@/lib/canvas/nodePlacement";
import { libraryNodeTypeForItem } from "@/lib/canvas/materialLibrary";
import {
  isVideoMediaUrl,
  listMaterialLibrary,
  materialLibraryKey,
  type MaterialLibraryCategory,
  type MaterialLibraryItem,
} from "@/lib/api/materialLibrary";
import { importProjectPackIntoCurrent } from "@/lib/canvas/projectPack";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import {
  PROMPT_LIBRARY_FILTER_ALL,
  MaterialLibraryCategoryFilter,
  filterLibraryItemsByTag,
  type PromptLibraryFilterId,
} from "@/components/canvas/PromptLibraryCategoryFilter";

/** 封面停在稍靠后的一帧，避免 mp4 首帧全黑 */
function coverPosterTime(video: HTMLVideoElement): number {
  const dur = video.duration;
  return Number.isFinite(dur) && dur > 0 ? Math.min(0.12, dur * 0.08) : 0.1;
}

/**
 * 素材封面。视频默认只显示一帧；鼠标移入才静音播放，移出暂停并回到封面帧。
 * 不要整页 autoplay，否则会同时拉取并解码全部 mp4。
 */
function LibraryItemCard({
  item,
  fit,
  disabled,
  title,
  onSelect,
}: {
  item: MaterialLibraryItem;
  fit: string;
  disabled: boolean;
  title: string;
  onSelect: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const src = item.mediaUrl ? ensureHttpsOssUrl(item.mediaUrl) || item.mediaUrl : "";
  const isVideo = Boolean(src) && (item.mediaType === "video" || isVideoMediaUrl(src));

  const playCover = () => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => {
      /* 未缓冲完或被浏览器拦住时保持静帧 */
    });
  };

  const stopCover = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    try {
      video.currentTime = coverPosterTime(video);
    } catch {
      /* 部分源不允许 seek */
    }
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      onMouseEnter={isVideo ? playCover : undefined}
      onMouseLeave={isVideo ? stopCover : undefined}
      className="group flex flex-col overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] text-left transition-colors hover:border-purple-400/40 disabled:opacity-50"
      title={title}
    >
      <div className="relative aspect-square overflow-hidden bg-black/30">
        {isVideo ? (
          <video
            ref={videoRef}
            src={src}
            className={`h-full w-full ${fit}`}
            muted
            playsInline
            loop
            preload="metadata"
            onLoadedData={(e) => {
              const video = e.currentTarget;
              // 正在悬停播放时不要把进度拽回封面帧
              if (!video.paused) return;
              try {
                video.currentTime = coverPosterTime(video);
              } catch {
                /* 部分源不允许 seek */
              }
            }}
          />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className={`h-full w-full ${fit}`} draggable={false} />
        ) : (
          <div className="flex h-full items-center justify-center text-white/20">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="truncate px-1.5 py-1.5 text-[11px] text-white/70 group-hover:text-white">
        {item.title}
      </div>
    </button>
  );
}

const TABS: {
  key: MaterialLibraryCategory;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "style", label: "风格库", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: "effect", label: "特效库", icon: <Film className="h-3.5 w-3.5" /> },
  { key: "character", label: "角色库", icon: <UserRound className="h-3.5 w-3.5" /> },
  { key: "prompt", label: "提示词库", icon: <Type className="h-3.5 w-3.5" /> },
  { key: "template", label: "模板库", icon: <LayoutTemplate className="h-3.5 w-3.5" /> },
];

/**
 * 画布左侧「素材库」面板：风格 / 特效 / 角色 / 提示词 / 模板只读选用（上传仅管理后台）。
 */
export function MaterialLibraryPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MaterialLibraryCategory>("style");
  // 各库共用二级分类筛选（风格/特效/角色/提示词/模板）
  const [tagFilter, setTagFilter] = useState<PromptLibraryFilterId>(PROMPT_LIBRARY_FILTER_ALL);
  const [importingId, setImportingId] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: materialLibraryKey(tab),
    queryFn: () => listMaterialLibrary(tab),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const tagCategories = useMemo(() => data?.categories ?? [], [data?.categories]);
  const visibleItems = useMemo(
    () => filterLibraryItemsByTag(items, tagFilter, tab),
    [tab, items, tagFilter]
  );
  const loading = isOpen && (isLoading || isFetching) && items.length === 0;

  /** 模板库：下载 zip 后合并导入当前项目，锚点为视口中心 */
  const handleImportTemplate = useCallback(
    async (item: MaterialLibraryItem) => {
      const url = ensureHttpsOssUrl(item.packageUrl || "") || item.packageUrl;
      if (!url) {
        toast.error("该模板缺少压缩包地址");
        return;
      }
      if (!useCanvasStore.getState().projectId) {
        toast.error("请先打开项目");
        return;
      }
      setImportingId(item.id);
      const toastId = toast.loading(`正在导入模板「${item.title}」…`);
      try {
        // 经本机代拉，避开浏览器直连 OSS 的 CORS
        const proxy = `/api/local/fetch-media?url=${encodeURIComponent(url)}`;
        const res = await fetch(proxy);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(
            (errBody as { error?: string }).error || `下载模板失败（${res.status}）`
          );
        }
        const buf = await res.arrayBuffer();
        const file = new File([buf], `${item.title || "template"}.zip`, {
          type: "application/zip",
        });
        const result = await importProjectPackIntoCurrent(file, {
          anchorFlow: viewportCenterFlowPosition(
            useCanvasStore.getState().viewport,
            useCanvasStore.getState().flowPaneSize
          ),
        });
        toast.success(`已导入「${item.title}」（${result.nodeCount} 个节点）`, { id: toastId });
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "导入模板失败", { id: toastId });
      } finally {
        setImportingId(null);
      }
    },
    [onClose]
  );

  const handleSelect = useCallback(
    (item: MaterialLibraryItem) => {
      if (item.category === "template" || tab === "template") {
        void handleImportTemplate(item);
        return;
      }
      const store = useCanvasStore.getState();
      // 提示词库落可编辑文本节点；其它按媒体类型落图/视频节点
      const nodeType = libraryNodeTypeForItem(item);
      // 落在当前视角中心（不贴选中节点、不用画布绝对原点）
      const preferredCenter = viewportCenterFlowPosition(store.viewport, store.flowPaneSize);
      const position = resolveAddNodePosition(nodeType, store.nodes, {
        viewport: store.viewport,
        paneSize: store.flowPaneSize,
        preferredCenter,
      });
      store.addNodeFromLibraryItem(item, position);
      toast.success(`已添加「${item.title}」`);
      onClose();
    },
    [onClose, tab, handleImportTemplate]
  );

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex w-[780px] max-h-[min(820px,88vh)] flex-col rounded-xl"
          style={{
            background: "rgba(10,10,30,0.97)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-medium text-white/80">素材库</span>
            <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-0.5 border-b border-white/5 px-4 py-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  setTagFilter(PROMPT_LIBRARY_FILTER_ALL);
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  tab === t.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <MaterialLibraryCategoryFilter
              categories={tagCategories}
              items={items}
              library={tab}
              value={tagFilter}
              onChange={setTagFilter}
            />
            {loading ? (
              <div className="py-8 text-center text-xs text-white/25">加载中...</div>
            ) : visibleItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/25">暂无素材</div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {/* 一行 5 个；面板加宽加高后约可同时看到 4 行 */}
                {visibleItems.map((item, index) => (
                  <LibraryItemCard
                    key={`${item.id}::${item.packageUrl || item.mediaUrl || index}`}
                    item={item}
                    fit={tab === "prompt" ? "object-contain" : "object-cover"}
                    disabled={importingId === item.id}
                    title={
                      tab === "template"
                        ? `导入模板「${item.title}」到当前画布`
                        : `添加「${item.title}」到画布`
                    }
                    onSelect={() => handleSelect(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
