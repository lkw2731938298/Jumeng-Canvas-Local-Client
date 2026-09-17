"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, Image as ImageIcon, Sparkles, Type, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  resolveAddNodePosition,
  viewportCenterFlowPosition,
} from "@/lib/canvas/nodePlacement";
import { libraryNodeTypeForItem } from "@/lib/canvas/materialLibrary";
import {
  listMaterialLibrary,
  materialLibraryKey,
  type MaterialLibraryCategory,
  type MaterialLibraryItem,
} from "@/lib/api/materialLibrary";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import {
  PROMPT_LIBRARY_FILTER_ALL,
  PromptLibraryCategoryFilter,
  filterPromptLibraryItems,
  type PromptLibraryFilterId,
} from "@/components/canvas/PromptLibraryCategoryFilter";

const TABS: {
  key: MaterialLibraryCategory;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "style", label: "风格库", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: "effect", label: "特效库", icon: <Film className="h-3.5 w-3.5" /> },
  { key: "character", label: "角色库", icon: <UserRound className="h-3.5 w-3.5" /> },
  { key: "prompt", label: "提示词库", icon: <Type className="h-3.5 w-3.5" /> },
];

/**
 * 画布左侧「素材库」面板：风格 / 特效 / 角色 / 提示词只读选用（上传仅管理后台）。
 */
export function MaterialLibraryPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MaterialLibraryCategory>("style");
  const [promptFilter, setPromptFilter] = useState<PromptLibraryFilterId>(PROMPT_LIBRARY_FILTER_ALL);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: materialLibraryKey(tab),
    queryFn: () => listMaterialLibrary(tab),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const promptCategories = useMemo(
    () => data?.promptCategories ?? [],
    [data?.promptCategories]
  );
  const visibleItems = useMemo(
    () => (tab === "prompt" ? filterPromptLibraryItems(items, promptFilter) : items),
    [tab, items, promptFilter]
  );
  const loading = isOpen && (isLoading || isFetching) && items.length === 0;

  const handleSelect = useCallback(
    (item: MaterialLibraryItem) => {
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
    [onClose]
  );

  if (!isOpen) return null;

  const hint =
    tab === "effect"
      ? "视频特效落视频节点（可连 Seedance 2.0）；GIF/WebP 动图落图节点作参考"
      : tab === "prompt"
        ? "选择后落可编辑文本节点（可连图片/视频节点作参考）"
        : "选择后落图片节点（无上下弹窗，可连图片/视频节点作参考）";

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
                  setPromptFilter(PROMPT_LIBRARY_FILTER_ALL);
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

          <p className="px-4 pt-2 text-[11px] text-white/35">
            {hint}
            · 仅管理员可在后台上传
          </p>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tab === "prompt" ? (
              <PromptLibraryCategoryFilter
                categories={promptCategories}
                items={items}
                value={promptFilter}
                onChange={setPromptFilter}
              />
            ) : null}
            {loading ? (
              <div className="py-8 text-center text-xs text-white/25">加载中...</div>
            ) : visibleItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/25">暂无素材</div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {/* 一行 5 个；面板加宽加高后约可同时看到 4 行 */}
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item)}
                    className="group flex flex-col overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] text-left transition-colors hover:border-purple-400/40"
                    title={`添加「${item.title}」到画布`}
                  >
                    {/* 封面统一 1:1；提示词库横竖图 object-contain 适应 */}
                    <div className="relative aspect-square overflow-hidden bg-black/30">
                      {item.mediaType === "video" ? (
                        <video
                          src={ensureHttpsOssUrl(item.mediaUrl) || item.mediaUrl}
                          className={`h-full w-full ${
                            tab === "prompt" ? "object-contain" : "object-cover"
                          }`}
                          muted
                          playsInline
                          loop
                          preload="metadata"
                        />
                      ) : item.mediaUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ensureHttpsOssUrl(item.mediaUrl) || item.mediaUrl}
                          alt=""
                          className={`h-full w-full ${
                            tab === "prompt" ? "object-contain" : "object-cover"
                          }`}
                          draggable={false}
                        />
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
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
