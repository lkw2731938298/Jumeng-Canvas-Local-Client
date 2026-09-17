"use client";

/**
 * 发现页创作框：从平台素材库选用参考（风格 / 特效 / 角色）。
 * 必须 portal 到 body：创作框有 backdrop-filter，会把 fixed 弹层锁在局部叠层，
 * 导致与下方「爆款/出海」推荐条重叠、点击异常。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Film, Image as ImageIcon, Sparkles, Type, UserRound, X } from "lucide-react";
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
  icon: ReactNode;
}[] = [
  { key: "style", label: "风格库", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { key: "effect", label: "特效库", icon: <Film className="h-3.5 w-3.5" /> },
  { key: "character", label: "角色库", icon: <UserRound className="h-3.5 w-3.5" /> },
  { key: "prompt", label: "提示词库", icon: <Type className="h-3.5 w-3.5" /> },
];

export function CreationMaterialLibraryDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MaterialLibraryItem) => void;
}) {
  const [tab, setTab] = useState<MaterialLibraryCategory>("style");
  const [promptFilter, setPromptFilter] = useState<PromptLibraryFilterId>(PROMPT_LIBRARY_FILTER_ALL);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 打开时锁定背景滚动，避免与页面推荐条抢滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: materialLibraryKey(tab),
    queryFn: () => listMaterialLibrary(tab),
    enabled: open,
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
  const loading = open && (isLoading || isFetching) && items.length === 0;

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[220] bg-black/65" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[221] w-[min(780px,94vw)] -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex max-h-[min(820px,88vh)] flex-col rounded-xl shadow-2xl"
          style={{
            background: "rgba(10,10,30,0.98)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <span className="text-sm font-medium text-white/85">素材库</span>
              <p className="mt-0.5 text-[11px] text-white/35">
                选用后作为创作参考，不覆盖已有附件
              </p>
            </div>
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
                    onClick={() => onSelect(item)}
                    className="group flex flex-col overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] text-left transition-colors hover:border-[var(--panel-accent-border)]"
                    title={`选用「${item.title}」`}
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
    </>,
    document.body
  );
}
