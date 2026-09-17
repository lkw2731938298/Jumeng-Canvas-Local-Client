"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  Mic,
  Search,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  AUDIO_VOICE_CATALOG,
  type AudioVoiceItem,
  type AudioVoiceTab,
} from "@/lib/canvas/audioVoiceStyles";
import { uploadAsset } from "@/lib/api/assets";
import {
  cloneVoice,
  deleteVoiceClone,
  listVoices,
  setVoiceFavorite,
  type CanvasVoiceItem,
} from "@/lib/api/voices";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const TAB_ITEMS: { id: AudioVoiceTab; label: string }[] = [
  { id: "library", label: "音色库" },
  { id: "mine", label: "我的音色" },
  { id: "favorite", label: "收藏音色" },
];

interface VoiceSelectModalProps {
  open: boolean;
  selectedName: string;
  selectedVoiceId?: string;
  projectId?: string | null;
  /** 触发按钮屏幕矩形，用于贴边打开 */
  anchorRect: {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  onClose: () => void;
  onSelect: (voice: AudioVoiceItem) => void;
}

const PANEL_WIDTH = 560;
const PANEL_MAX_HEIGHT = 560;
const VIEW_PAD = 12;
const ANCHOR_GAP = 10;

function resolvePanelStyle(
  anchor: VoiceSelectModalProps["anchorRect"]
): CSSProperties {
  if (typeof window === "undefined") {
    return { left: VIEW_PAD, top: VIEW_PAD, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_WIDTH, vw - VIEW_PAD * 2);
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, vh - VIEW_PAD * 2);

  if (!anchor) {
    return {
      left: Math.max(VIEW_PAD, (vw - width) / 2),
      top: Math.max(VIEW_PAD, (vh - maxHeight) / 2),
      width,
      maxHeight,
    };
  }

  let left = anchor.right - width;
  left = Math.min(Math.max(VIEW_PAD, left), vw - width - VIEW_PAD);

  const spaceAbove = anchor.top - VIEW_PAD - ANCHOR_GAP;
  const spaceBelow = vh - anchor.bottom - VIEW_PAD - ANCHOR_GAP;
  const openAbove = spaceAbove >= Math.min(360, maxHeight) || spaceAbove >= spaceBelow;
  let top: number;
  let height = maxHeight;
  if (openAbove) {
    height = Math.min(maxHeight, Math.max(280, spaceAbove));
    top = anchor.top - ANCHOR_GAP - height;
  } else {
    height = Math.min(maxHeight, Math.max(280, spaceBelow));
    top = anchor.bottom + ANCHOR_GAP;
  }
  top = Math.min(Math.max(VIEW_PAD, top), vh - height - VIEW_PAD);

  return { left, top, width, maxHeight: height, height };
}

function mapApiVoice(v: CanvasVoiceItem): AudioVoiceItem {
  return {
    id: v.id,
    name: v.name,
    lang: v.lang || "中文(普通话)",
    gender: v.gender || "",
    voiceId: v.voiceId,
    kind: v.kind === "cloned" ? "cloned" : "library",
    ttsModel: v.ttsModel || (v.kind === "cloned" ? "cosyvoice-v3.5-plus" : "cosyvoice-v3-flash"),
    tabs:
      v.kind === "cloned"
        ? (["mine", ...(v.favorite ? (["favorite"] as const) : [])] as AudioVoiceTab[])
        : (["library"] as AudioVoiceTab[]),
    cloneId: v.cloneId,
    favorite: Boolean(v.favorite),
  };
}

/** 音色选择弹窗：系统库 + 我的复刻 + 克隆新音色 */
export function VoiceSelectModal({
  open,
  selectedName,
  selectedVoiceId,
  projectId,
  anchorRect,
  onClose,
  onSelect,
}: VoiceSelectModalProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<AudioVoiceTab>("library");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [jumpInput, setJumpInput] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() =>
    resolvePanelStyle(anchorRect)
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["voices", "list"],
    queryFn: () => listVoices("all"),
    enabled: open,
    staleTime: 30_000,
  });

  const libraryVoices = useMemo(() => {
    const fromApi = (data?.library ?? []).map(mapApiVoice);
    return fromApi.length ? fromApi : AUDIO_VOICE_CATALOG;
  }, [data]);

  const mineVoices = useMemo(
    () => (data?.mine ?? []).map(mapApiVoice),
    [data]
  );

  useEffect(() => {
    if (!open) return;
    setTab("library");
    setQuery("");
    setPage(1);
    setJumpInput("");
    setShowCloneForm(false);
    setCloneName("");
    setPanelStyle(resolvePanelStyle(anchorRect));
  }, [open, anchorRect]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setPanelStyle(resolvePanelStyle(anchorRect));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, anchorRect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let source: AudioVoiceItem[] = [];
    if (tab === "library") source = libraryVoices;
    else if (tab === "mine") source = mineVoices;
    else source = mineVoices.filter((v) => v.favorite);
    if (!q) return source;
    return source.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.lang.toLowerCase().includes(q) ||
        v.gender.includes(q) ||
        v.voiceId.toLowerCase().includes(q)
    );
  }, [tab, query, libraryVoices, mineVoices]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [tab, query, pageSize]);

  if (!open || typeof document === "undefined") return null;

  const toggleFavorite = async (voice: AudioVoiceItem) => {
    if (!voice.cloneId) {
      toast.message("系统音色暂不支持云端收藏");
      return;
    }
    try {
      await setVoiceFavorite(voice.cloneId, !voice.favorite);
      await queryClient.invalidateQueries({ queryKey: ["voices"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "收藏失败");
    }
  };

  const handleCloneFile = async (file: File) => {
    if (!projectId) {
      toast.error("请先打开项目后再克隆音色");
      return;
    }
    const name = cloneName.trim() || file.name.replace(/\.[^.]+$/, "") || "我的复刻音色";
    setCloning(true);
    try {
      const asset = await uploadAsset({
        file,
        projectId,
        category: "audio",
        title: name,
        subcategory: "音色参考",
      });
      const created = await cloneVoice({
        audioUrl: asset.fileUrl,
        displayName: name,
        sourceAssetId: asset.id,
        projectId,
      });
      toast.success(`已复刻「${created.name}」`);
      setShowCloneForm(false);
      setCloneName("");
      setTab("mine");
      await queryClient.invalidateQueries({ queryKey: ["voices"] });
      onSelect(mapApiVoice(created));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "声音复刻失败");
    } finally {
      setCloning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const pageNumbers = buildPageNumbers(safePage, totalPages);

  return createPortal(
    <div
      className="fixed inset-0 z-[320] bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="音色选择"
      onClick={onClose}
    >
      <div
        className="fixed flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c22] shadow-2xl"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
          <h2 className="text-[16px] font-medium text-white">音色选择</h2>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-5 py-3">
          <div className="inline-flex rounded-lg bg-white/[0.06] p-0.5">
            {TAB_ITEMS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] transition-colors",
                  tab === t.id
                    ? "bg-white/[0.14] text-white"
                    : "text-white/55 hover:text-white/85"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={cloning}
            onClick={() => setShowCloneForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-purple-400 disabled:opacity-50"
          >
            {cloning ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Mic className="size-3.5" strokeWidth={1.75} />
            )}
            克隆新音色
          </button>
          <div className="relative min-w-[160px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35"
              strokeWidth={1.75}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索音色库"
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/30 focus:border-white/25"
            />
          </div>
          <button
            type="button"
            onClick={() => toast.message("筛选即将上线")}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white/90"
          >
            <Filter className="size-3.5" strokeWidth={1.75} />
            筛选
          </button>
        </div>

        {showCloneForm ? (
          <div className="space-y-2 border-b border-white/[0.08] bg-white/[0.03] px-5 py-3">
            <p className="text-[12px] text-white/45">
              上传 10～20 秒清晰人声参考音，经百炼 CosyVoice 复刻后写入「我的音色」。
            </p>
            <input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="音色名称（可选）"
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white/90 outline-none placeholder:text-white/30"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleCloneFile(f);
              }}
            />
            <button
              type="button"
              disabled={cloning || !projectId}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
            >
              {cloning ? "复刻中…" : "选择音频文件"}
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {isLoading || isFetching ? (
            <p className="px-2 py-10 text-center text-[13px] text-white/40">加载中…</p>
          ) : pageItems.length === 0 ? (
            <p className="px-2 py-10 text-center text-[13px] text-white/40">
              {tab === "mine" || tab === "favorite"
                ? "暂无复刻音色，点击「克隆新音色」上传参考音"
                : "暂无匹配音色"}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {pageItems.map((voice) => {
                const selected =
                  (selectedVoiceId && voice.voiceId === selectedVoiceId) ||
                  voice.name === selectedName;
                const starred = Boolean(voice.favorite);
                return (
                  <li
                    key={voice.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/70">
                      <AudioLines className="size-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-white/90">{voice.name}</p>
                      {/* 官方音色：小字=年龄·语言；复刻音色保留性别标注 */}
                      <p className="truncate text-[12px] text-white/40">
                        {voice.lang}
                        {voice.kind === "cloned" && voice.gender ? ` · ${voice.gender}` : ""}
                        {voice.kind === "cloned" ? " · 复刻" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={selected}
                      onClick={() => {
                        onSelect(voice);
                        onClose();
                      }}
                      className={cn(
                        "h-8 shrink-0 rounded-full px-4 text-[13px] font-medium transition-colors",
                        selected
                          ? "cursor-default bg-white/15 text-white/50"
                          : "bg-white text-black hover:bg-white/90"
                      )}
                    >
                      {selected ? "已选" : "选择"}
                    </button>
                    {voice.cloneId ? (
                      <>
                        <button
                          type="button"
                          title={starred ? "取消收藏" : "收藏"}
                          aria-label={starred ? "取消收藏" : "收藏"}
                          onClick={() => void toggleFavorite(voice)}
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/[0.08]",
                            starred ? "text-amber-300" : "text-white/35 hover:text-white/70"
                          )}
                        >
                          <Star
                            className="size-4"
                            strokeWidth={1.75}
                            fill={starred ? "currentColor" : "none"}
                          />
                        </button>
                        <button
                          type="button"
                          title="删除"
                          aria-label="删除"
                          onClick={async () => {
                            try {
                              await deleteVoiceClone(voice.cloneId!);
                              toast.success("已删除");
                              await queryClient.invalidateQueries({ queryKey: ["voices"] });
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "删除失败");
                            }
                          }}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/[0.08] hover:text-red-300"
                        >
                          <X className="size-3.5" strokeWidth={1.75} />
                        </button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.08] px-5 py-3 text-[12px] text-white/55">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex size-7 items-center justify-center rounded-md hover:bg-white/[0.08] disabled:opacity-30"
              aria-label="上一页"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            {pageNumbers.map((n, i) =>
              n === "…" ? (
                <span key={`e-${i}`} className="px-1 text-white/30">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md tabular-nums transition-colors",
                    n === safePage
                      ? "bg-white/[0.14] text-white"
                      : "hover:bg-white/[0.08] hover:text-white/85"
                  )}
                >
                  {n}
                </button>
              )
            )}
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex size-7 items-center justify-center rounded-md hover:bg-white/[0.08] disabled:opacity-30"
              aria-label="下一页"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          <select
            value={pageSize}
            onChange={(e) =>
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
            }
            className="h-7 rounded-md border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white/70 outline-none"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}条/页
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <span>跳至</span>
            <input
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const n = Number(jumpInput);
                if (Number.isFinite(n) && n >= 1) {
                  setPage(Math.min(totalPages, Math.max(1, Math.floor(n))));
                  setJumpInput("");
                }
              }}
              className="h-7 w-10 rounded-md border border-white/10 bg-white/[0.04] px-1.5 text-center tabular-nums text-white/80 outline-none"
            />
            <span>页</span>
          </div>

          <span className="ml-auto tabular-nums text-white/40">共 {total} 条</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function buildPageNumbers(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, total, current]);
  for (let i = current - 1; i <= current + 1; i++) {
    if (i >= 1 && i <= total) pages.add(i);
  }
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
    pages.add(5);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
    pages.add(total - 4);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}
