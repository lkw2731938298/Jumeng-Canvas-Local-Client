"use client";

/**
 * 画布操控：生图/生视频模型选择菜单（单一触发器 + 菜单内图片|视频 Tab）。
 * Portal + fixed；根据触发器位置自动上方/下方展开，保证顶部 Tab 始终在视口内。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ImageIcon, Video } from "lucide-react";
import { toast } from "sonner";

import { listModels, type CanvasModel } from "@/lib/api/models";
import {
  getAgentCanvasMediaModels,
  setAgentCanvasMediaModels,
  subscribeAgentCanvasMediaModels,
} from "@/lib/canvas/agentCanvasMediaModels";
import { buildModelOptions } from "@/lib/canvas/nodeModelRouting";
import { cn } from "@/lib/utils";

export type MediaTab = "image" | "video";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /** 打开时默认 Tab */
  initialTab?: MediaTab;
  /** Tab 变化时同步到触发器展示 */
  onTabChange?: (tab: MediaTab) => void;
  /** 锚定触发器（用于 fixed 定位） */
  anchorRef?: React.RefObject<HTMLElement | null>;
};

function useMediaPrefs() {
  const [prefs, setPrefs] = useState(getAgentCanvasMediaModels);
  useEffect(() => subscribeAgentCanvasMediaModels(() => setPrefs(getAgentCanvasMediaModels())), []);
  return prefs;
}

/** 单一入口：展示当前 Tab 对应模型名；菜单内再切换图片/视频 */
export function AgentCanvasMediaModelTrigger(props: {
  open: boolean;
  activeTab: MediaTab;
  disabled?: boolean;
  className?: string;
  imageLabel: string;
  videoLabel: string;
  onOpenTab: (tab: MediaTab) => void;
  triggerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const isVideo = props.activeTab === "video";
  const label = isVideo ? props.videoLabel : props.imageLabel;
  const Icon = isVideo ? Video : ImageIcon;
  return (
    <div
      ref={props.triggerRef}
      className={cn("flex shrink-0 items-center", props.className)}
    >
      <button
        type="button"
        className={cn(
          "inline-flex max-w-[140px] items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
          props.open
            ? "border-violet-500/50 bg-violet-500/20 text-violet-200"
            : "border-border-default/70 bg-black/[0.04] text-muted-foreground hover:border-violet-500/35 hover:text-foreground dark:border-white/12 dark:bg-white/[0.06]"
        )}
        disabled={props.disabled}
        title={isVideo ? `生视频模型：${label}` : `生图模型：${label}`}
        aria-label={isVideo ? "选择生视频模型" : "选择生图模型"}
        onClick={() => props.onOpenTab(props.activeTab)}
      >
        <Icon size={11} className="shrink-0 opacity-80" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={10} className="shrink-0 opacity-60" />
      </button>
    </div>
  );
}

type PanelPos = {
  left: number;
  width: number;
  /** 用 top 定位，避免上方空间不足时裁掉 Tab */
  top: number;
  maxHeight: number;
};

/** 模型列表面板：顶部固定「图片 | 视频」切换 */
export function AgentCanvasMediaModelMenu(props: Props) {
  const prefs = useMediaPrefs();
  const [tab, setTab] = useState<MediaTab>(props.initialTab || "image");
  const [pos, setPos] = useState<PanelPos | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.open && props.initialTab) setTab(props.initialTab);
  }, [props.open, props.initialTab]);

  useLayoutEffect(() => {
    if (!props.open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = props.anchorRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(370, window.innerWidth - 16);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      if (left < 8) left = 8;

      const gap = 6;
      const spaceAbove = r.top - 8;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      // 优先向上；上方不够放 Tab+列表时改向下，保证顶部 Tab 可见
      const preferAbove = spaceAbove >= 220 || spaceAbove >= spaceBelow;
      const maxHeight = Math.min(384, Math.max(200, preferAbove ? spaceAbove - gap : spaceBelow - gap));
      const top = preferAbove
        ? Math.max(8, r.top - gap - maxHeight)
        : Math.min(window.innerHeight - maxHeight - 8, r.bottom + gap);

      setPos({ left, width, top, maxHeight });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [props.open, props.anchorRef]);

  useEffect(() => {
    if (!props.open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (props.anchorRef?.current?.contains(t)) return;
      props.onOpenChange(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [props.open, props.anchorRef, props.onOpenChange]);

  const imageQuery = useQuery({
    queryKey: ["models", "agent-canvas", "image"],
    queryFn: () => listModels({ category: "image" }),
    staleTime: 60_000,
    enabled: props.open,
  });
  const videoQuery = useQuery({
    queryKey: ["models", "agent-canvas", "video"],
    queryFn: () => listModels({ category: "video" }),
    staleTime: 60_000,
    enabled: props.open,
  });

  const imageModels = useMemo(() => {
    const api = (imageQuery.data || []).filter(
      (m) => m.isAvailable !== false && m.isConfigured !== false
    );
    return buildModelOptions(api, ["image"], []);
  }, [imageQuery.data]);

  const videoModels = useMemo(() => {
    const api = (videoQuery.data || []).filter(
      (m) => m.isAvailable !== false && m.isConfigured !== false
    );
    return buildModelOptions(api, ["video"], []);
  }, [videoQuery.data]);

  const list = tab === "image" ? imageModels : videoModels;
  const selected = tab === "image" ? prefs.imageModel : prefs.videoModel;
  const loading = tab === "image" ? imageQuery.isLoading : videoQuery.isLoading;

  const metaByName = useMemo(() => {
    const map = new Map<string, CanvasModel>();
    for (const m of [...(imageQuery.data || []), ...(videoQuery.data || [])]) {
      map.set(m.name, m);
    }
    return map;
  }, [imageQuery.data, videoQuery.data]);

  if (!props.open || typeof document === "undefined" || !pos) return null;

  const panel = (
    <div
      ref={panelRef}
      className="pointer-events-auto fixed z-[200] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-default bg-bg-surface shadow-xl dark:border-[#363636] dark:bg-[#1a1a1a]"
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 顶部固定：标题 + 图片/视频切换（不被列表滚动挤走） */}
      <div className="shrink-0 border-b border-border-default/60 px-4 pb-3 pt-3 dark:border-white/10">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">选择模型</div>
        </div>
        <div
          className="flex w-full rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.08]"
          role="tablist"
          aria-label="模型类型"
        >
          {(
            [
              { id: "image" as const, label: "图片", icon: ImageIcon },
              { id: "video" as const, label: "视频", icon: Video },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors",
                  tab === t.id
                    ? "bg-violet-500/30 text-white shadow-sm ring-1 ring-violet-400/50"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => {
                  setTab(t.id);
                  props.onTabChange?.(t.id);
                }}
              >
                <Icon size={14} className="shrink-0" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2.5 text-[11px] font-medium text-muted-foreground">
        {tab === "image" ? "图片模型" : "视频模型"}
        {!loading && list.length > 0 ? ` · ${list.length}` : ""}
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-3 pt-1">
        {loading ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">加载模型…</div>
        ) : list.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">暂无可用模型</div>
        ) : (
          list.map((opt) => {
            const active = opt.value === selected;
            const desc =
              opt.description ||
              String(metaByName.get(opt.value)?.description || "").trim() ||
              undefined;
            return (
              <button
                key={opt.value}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors",
                  active
                    ? "bg-violet-500/15 ring-1 ring-violet-500/35"
                    : "hover:bg-black/5 dark:hover:bg-white/8"
                )}
                onClick={() => {
                  if (tab === "image") {
                    setAgentCanvasMediaModels({ imageModel: opt.value });
                    toast.message(`生图模型：${opt.label}`);
                  } else {
                    setAgentCanvasMediaModels({ videoModel: opt.value });
                    toast.message(`生视频模型：${opt.label}`);
                  }
                  props.onOpenChange(false);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                    <span className="truncate">{opt.label}</span>
                    {active ? <Check size={12} className="shrink-0 text-violet-500" /> : null}
                  </div>
                  {desc ? (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {desc}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
