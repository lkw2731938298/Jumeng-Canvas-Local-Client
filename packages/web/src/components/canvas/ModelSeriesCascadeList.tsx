"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import type { ModelOption } from "@/lib/canvas/nodeModelRouting";
import { compareSeriesLabels } from "@/lib/canvas/modelSeries";
import { listModelUiSeries } from "@/lib/api/models";
import { cn } from "@/lib/utils";

interface ModelSeriesCascadeListProps {
  options: ModelOption[];
  selectedModel?: string;
  onSelectModel: (modelName: string) => void;
  /** 当前媒体类目，用于拉取对应系列顺序配置 */
  category?: string;
  /**
   * 外层 Select 是否打开。飞出层 portal 到 body，必须随下拉关闭一并清掉，
   * 否则关菜单/换节点后旧联级会残留，与新菜单叠在一起像「重复」。
   */
  open?: boolean;
}

type SeriesGroup = {
  series: string;
  models: ModelOption[];
};

type FlyoutPos = {
  top: number;
  left: number;
  maxHeight: number;
  /** 系列行与飞出层之间的桥接带，避免高度/空隙导致误关 */
  bridge: { top: number; left: number; width: number; height: number };
};

/**
 * 模型下拉主列表按系列分组；悬停/点击系列时在旁侧展开具体模型。
 * 飞出层用 fixed+portal 对齐系列行，视频/图片/文本等所有节点卡片共用，避免高度差误关。
 */
export function ModelSeriesCascadeList({
  options,
  selectedModel,
  onSelectModel,
  category,
  open = true,
}: ModelSeriesCascadeListProps) {
  const [hoverSeries, setHoverSeries] = useState<string | null>(null);
  /** 多模型系列钉住，便于鼠标移入右侧飞出层；必须随当前悬停系列切换，否则会钉在旧系列上 */
  const [pinnedSeries, setPinnedSeries] = useState<string | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<FlyoutPos | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const activeSeriesRef = useRef<string | null>(null);

  /**
   * 悬停优先于钉住：鼠标移到别的系列时立刻切飞出层，避免「可灵」的子项还挂在「Seedance」旁边。
   * 仅当鼠标已离开列表、停在飞出层上时，才靠 pinnedSeries 保持展开。
   */
  const activeSeries = open ? hoverSeries ?? pinnedSeries : null;
  activeSeriesRef.current = activeSeries;

  const { data: seriesCfg } = useQuery({
    queryKey: ["models", "ui-series", category ?? ""],
    queryFn: () => listModelUiSeries({ category: category || undefined }),
    staleTime: 60_000,
  });

  const seriesOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of seriesCfg?.series ?? []) {
      const label = String(item.label || "").trim();
      if (!label) continue;
      map.set(label, Number(item.sortOrder) || 0);
    }
    return map;
  }, [seriesCfg]);

  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const opt of options) {
      const key = (opt.series || "其他").trim() || "其他";
      const list = map.get(key) ?? [];
      list.push(opt);
      map.set(key, list);
    }
    const ordered: SeriesGroup[] = [];
    for (const [series, models] of map.entries()) {
      ordered.push({ series, models });
    }
    ordered.sort((a, b) => compareSeriesLabels(a.series, b.series, seriesOrder));
    return ordered;
  }, [options, seriesOrder]);

  const hoverGroup = groups.find((g) => g.series === activeSeries) ?? null;

  const clearLeaveTimer = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const closeAll = () => {
    setHoverSeries(null);
    setPinnedSeries(null);
    setFlyoutPos(null);
  };

  const scheduleClose = () => {
    clearLeaveTimer();
    leaveTimer.current = setTimeout(closeAll, 280);
  };

  /** 按系列行视口坐标放置飞出层（可左右翻转、上下钳制） */
  const repositionFlyout = (series: string) => {
    const row = rowRefs.current.get(series);
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 48);
    const gap = 6;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.left - width - gap);
    }

    const maxHeight = Math.min(300, window.innerHeight - 16);
    const flyoutH = flyoutRef.current?.offsetHeight || Math.min(maxHeight, 160);
    let top = rect.top;
    const maxTop = window.innerHeight - 8 - Math.min(flyoutH, maxHeight);
    top = Math.max(8, Math.min(top, maxTop));

    const bridgeLeft = Math.min(rect.right, left);
    const bridgeRight = Math.max(rect.right, left);
    const bridge: FlyoutPos["bridge"] = {
      top: Math.min(rect.top, top),
      left: bridgeLeft,
      width: Math.max(gap + 2, bridgeRight - bridgeLeft),
      height: Math.max(rect.height, 48),
    };

    setFlyoutPos({ top, left, maxHeight, bridge });
  };

  useLayoutEffect(() => {
    if (!activeSeries || !hoverGroup || hoverGroup.models.length <= 1) {
      setFlyoutPos(null);
      return;
    }
    repositionFlyout(activeSeries);
  }, [activeSeries, hoverGroup?.models.length, hoverGroup?.series]);

  useEffect(() => {
    if (!activeSeries) return;
    const sync = () => {
      const series = activeSeriesRef.current;
      if (series) repositionFlyout(series);
    };
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [activeSeries]);

  useEffect(() => () => clearLeaveTimer(), []);

  /** 下拉关闭或选项集变化时强制收起飞出层（portal 逃出 Select，不会随 Popup 隐藏） */
  useEffect(() => {
    if (!open) {
      clearLeaveTimer();
      closeAll();
    }
  }, [open]);

  useEffect(() => {
    if (!activeSeries) return;
    if (!groups.some((g) => g.series === activeSeries)) {
      clearLeaveTimer();
      closeAll();
    }
  }, [groups, activeSeries]);

  if (!groups.length) {
    return <div className="px-3 py-2 text-[12px] text-white/45">暂无模型</div>;
  }

  const openSeries = (series: string, modelCount: number) => {
    if (!open) return;
    clearLeaveTimer();
    setHoverSeries(series);
    if (modelCount <= 1) {
      // 单模型系列不展开飞出层，避免子菜单叠在相邻选项上
      setPinnedSeries(null);
      setFlyoutPos(null);
      return;
    }
    setPinnedSeries(series);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => repositionFlyout(series));
    });
  };

  const flyout =
    open && hoverGroup && hoverGroup.models.length > 1 && flyoutPos && typeof document !== "undefined"
      ? createPortal(
          <>
            {/* 系列行 ↔ 飞出层命中桥，避免斜移穿过空隙误关 */}
            <div
              data-series-flyout
              aria-hidden
              className="fixed z-[1999]"
              style={{
                top: flyoutPos.bridge.top,
                left: flyoutPos.bridge.left,
                width: flyoutPos.bridge.width,
                height: flyoutPos.bridge.height,
              }}
              onMouseEnter={clearLeaveTimer}
              onMouseLeave={scheduleClose}
            />
            <div
              ref={flyoutRef}
              data-series-flyout
              className="fixed z-[2000] w-[min(280px,calc(100vw-48px))]"
              style={{ top: flyoutPos.top, left: flyoutPos.left, maxHeight: flyoutPos.maxHeight }}
              onMouseEnter={clearLeaveTimer}
              onMouseLeave={scheduleClose}
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="max-h-[inherit] overflow-y-auto rounded-lg border border-white/10 bg-[#161622] py-1 shadow-xl">
                <div className="px-2.5 pb-1 pt-1.5 text-[10px] tracking-wide text-white/35">
                  {hoverGroup.series}
                </div>
                {hoverGroup.models.map((opt) => {
                  const selected = opt.value === selectedModel;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors",
                        selected ? "bg-purple-500/25 text-white" : "hover:bg-purple-500/20"
                      )}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelectModel(opt.value);
                        closeAll();
                      }}
                    >
                      <span className="text-[13px] font-medium leading-snug text-white/90">
                        {opt.label}
                      </span>
                      {opt.description ? (
                        <span className="text-[11px] leading-snug text-white/40">{opt.description}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div
      className="relative flex min-h-0"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-series-row],[data-series-flyout]")) {
          e.preventDefault();
        }
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-series-row],[data-series-flyout]")) {
          e.preventDefault();
        }
      }}
    >
      <div className="max-h-[280px] min-w-[168px] flex-1 overflow-y-auto py-0.5">
        {groups.map((group) => {
          const hasSelected = group.models.some((m) => m.value === selectedModel);
          const active = activeSeries === group.series;
          return (
            <button
              key={group.series}
              type="button"
              data-series-row
              ref={(el) => {
                if (el) rowRefs.current.set(group.series, el);
                else rowRefs.current.delete(group.series);
              }}
              onMouseEnter={() => openSeries(group.series, group.models.length)}
              onMouseLeave={scheduleClose}
              onClick={() => {
                if (group.models.length === 1) {
                  onSelectModel(group.models[0]!.value);
                  closeAll();
                  return;
                }
                openSeries(group.series, group.models.length);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                active
                  ? "bg-purple-500/20 text-white"
                  : hasSelected
                    ? "bg-white/[0.06] text-white/90"
                    : "text-white/75 hover:bg-white/[0.06] hover:text-white"
              )}
            >
              <span className="min-w-0 truncate font-medium">{group.series}</span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-white/35">
                {group.models.length}
                {group.models.length > 1 ? (
                  <ChevronRight className="size-3.5" aria-hidden />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {flyout}
    </div>
  );
}
