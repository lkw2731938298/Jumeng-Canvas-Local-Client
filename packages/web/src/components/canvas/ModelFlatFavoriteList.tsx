"use client";

/**
 * 节点卡片模型下拉：扁平展示全部模型展示名 + 顶部搜索 + 右侧收藏（收藏置顶）。
 * 搜索固定在顶部，仅下方列表滚动，避免 sticky 与名称重叠。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Star } from "lucide-react";
import type { ModelOption } from "@/lib/canvas/nodeModelRouting";
import {
  isFavoriteModel,
  loadFavoriteModelIds,
  toggleFavoriteModel,
} from "@/lib/canvas/favoriteModels";
import { cn } from "@/lib/utils";

interface ModelFlatFavoriteListProps {
  options: ModelOption[];
  selectedModel?: string;
  onSelectModel: (modelName: string) => void;
  /** 外层 Select 打开态：关闭时清空搜索 */
  open?: boolean;
}

export function ModelFlatFavoriteList({
  options,
  selectedModel,
  onSelectModel,
  open = true,
}: ModelFlatFavoriteListProps) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => loadFavoriteModelIds());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setQuery("");
    else {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter((o) => {
          const hay = `${o.label} ${o.value} ${o.description ?? ""} ${o.series ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : options.slice();

    filtered.sort((a, b) => {
      const af = isFavoriteModel(a.value, favorites) ? 0 : 1;
      const bf = isFavoriteModel(b.value, favorites) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.label.localeCompare(b.label, "zh-CN");
    });
    return filtered;
  }, [options, query, favorites]);

  return (
    <div className="flex min-h-0 min-w-[220px] max-w-[min(420px,calc(100vw-24px))] flex-1 flex-col">
      {/* 固定搜索条：不参与列表滚动 */}
      <div
        className="shrink-0 border-b border-white/10 bg-[#1a1a28] px-2 pb-2 pt-1.5"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
      >
        <label className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 text-white/50 focus-within:border-white/25">
          <Search className="size-3.5 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none placeholder:text-white/35"
            aria-label="搜索模型"
          />
        </label>
      </div>

      {/* 仅此区域滚动 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1">
        {sorted.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-white/45">
            {query.trim() ? "没有匹配的模型" : "暂无模型"}
          </div>
        ) : (
          sorted.map((opt) => {
            const selected = opt.value === selectedModel;
            const fav = isFavoriteModel(opt.value, favorites);
            return (
              <div
                key={opt.value}
                className={cn(
                  "group flex w-full items-center gap-1 rounded-md px-1.5 py-0.5",
                  selected ? "bg-white/12" : "hover:bg-white/[0.06]"
                )}
              >
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 px-1.5 py-1.5 text-left transition-colors",
                    selected ? "text-white" : "text-white/80"
                  )}
                  title={opt.description || opt.value}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectModel(opt.value);
                  }}
                >
                  <span className="block truncate text-[13px] font-medium leading-snug">
                    {opt.label}
                  </span>
                  {opt.series ? (
                    <span className="mt-0.5 block truncate text-[10px] text-white/35">
                      {opt.series}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                    fav
                      ? "text-amber-400 hover:bg-white/10"
                      : "text-white/25 hover:bg-white/10 hover:text-white/70"
                  )}
                  title={fav ? "取消收藏" : "收藏（置顶）"}
                  aria-label={fav ? `取消收藏 ${opt.label}` : `收藏 ${opt.label}`}
                  aria-pressed={fav}
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFavorites(toggleFavoriteModel(opt.value));
                  }}
                >
                  <Star
                    className="size-3.5"
                    strokeWidth={1.8}
                    fill={fav ? "currentColor" : "none"}
                  />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
