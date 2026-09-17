"use client";

/**
 * 剪辑台工作区：多轨时间线（视频+音轨）+ 片段拖动/边缘拉长 + 高轨优先预览 + compose 导出。
 * 入口：画布侧栏「剪辑台」；与节点顶栏「切段」（内联入/出点）区分。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Eraser,
  Film,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  SplitSquareHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { canvasHref } from "@/lib/canvas/directorNavigation";
import { composeVideoAssets, MIN_VIDEO_TRIM_SEC } from "@/lib/canvas/videoTrim";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import type { Asset } from "@/lib/api/assets";
import {
  canRedo,
  canUndo,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type TimelineHistory,
} from "@/lib/canvas/videoEditorHistory";
import {
  audioClipsForExport,
  audioTrackLabel,
  clearTimelineDraft,
  clipDuration,
  clipEndSec,
  createAutoSplitClipsFromAsset,
  createClipFromAsset,
  DEFAULT_AUDIO_TRACKS,
  DEFAULT_VIDEO_TRACKS,
  formatTimecode,
  hydrateTimelineClips,
  loadTimelineDraft,
  mapAudioAtTime,
  mapTimelineTime,
  MAX_AUDIO_TRACKS,
  MAX_CLIP_DURATION_SEC,
  MAX_TIMELINE_CLIPS,
  MAX_TIMELINE_TOTAL_SEC,
  MAX_VIDEO_TRACKS,
  mediaWindow,
  MIN_AUDIO_TRACKS,
  MIN_VIDEO_TRACKS,
  nextStartOnTrack,
  nudgeClipStart,
  parseTimelineClipsFromUnknown,
  patchClipTrim,
  resizeClipLeft,
  resizeClipRight,
  resolveAudioTrackCount,
  resolveDrop,
  resolveTrackCount,
  saveTimelineDraft,
  sourceToTimelineSec,
  splitClipAtPlayhead,
  timelineClipsFromComposeMeta,
  timelineTotalDuration,
  trackDisplayOrder,
  trackLabel,
  videoClipsOf,
  type TimelineClip,
  type TimelineClipKind,
} from "@/lib/canvas/videoEditorTimeline";
import {
  deleteVideoEditorDraft,
  fetchVideoEditorDraft,
  saveVideoEditorDraft,
} from "@/lib/api/videoEditorDrafts";
import type { WorkflowNodeData } from "@/types/workflow";

/** 拖拽类型：播放头 / 片段平移 / 左右缘拉长缩小 */
type DragKind = "playhead" | "resize-left" | "resize-right" | "clip";

const CLIP_COLORS = [
  "bg-violet-500/40 ring-violet-400/50",
  "bg-sky-500/40 ring-sky-400/50",
  "bg-amber-500/40 ring-amber-400/50",
  "bg-rose-500/40 ring-rose-400/50",
  "bg-fuchsia-500/40 ring-fuchsia-400/50",
];
/** 音频片段统一翠绿，与视频轨区分 */
const AUDIO_CLIP_COLOR = "bg-emerald-500/40 ring-emerald-400/50";

/** 时间轴缩放：默认 24px/s；最大放大到约 1 帧（1/30s）占 48px */
const BASE_PX_PER_SEC = 24;
const ASSUMED_FPS = 30;
const FRAME_SEC = 1 / ASSUMED_FPS;
const FRAME_ZOOM_PX = 48;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = FRAME_ZOOM_PX / (FRAME_SEC * BASE_PX_PER_SEC); // ≈ 60
const TRACK_ROW_H = 44;
const DRAG_THRESHOLD_PX = 4;
const MIN_TRACK_WIDTH_PX = 640;
const JM_ASSET_DRAG_MIME = "jm-asset-id";

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** 使整条时间线约铺满可视宽度 */
function fitZoomForDuration(totalDur: number, viewportW: number): number {
  const span = totalDur > 0.05 ? totalDur : 1;
  const usable = Math.max(320, viewportW * 0.92);
  return clampZoom(usable / (span * BASE_PX_PER_SEC));
}

type LongClipPrompt = {
  asset: Asset;
  sourceDuration: number;
};

interface Props {
  projectId: string;
}

export function VideoEditorWorkspace({ projectId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAssetId = (searchParams.get("assetId") || "").trim();
  const fromNodeId = (searchParams.get("fromNodeId") || "").trim();

  const projectName = useCanvasStore((s) => s.projectName);
  const projectNo = useCanvasStore((s) => s.projectNo);
  const nodes = useCanvasStore((s) => s.nodes);
  const { assets, isLoading: assetsLoading } = useProjectAssetManifest(projectId);

  const videoAssets = useMemo(
    () => assets.filter((a) => a.category === "video" && a.fileUrl),
    [assets]
  );
  const audioAssets = useMemo(
    () => assets.filter((a) => a.category === "audio" && a.fileUrl),
    [assets]
  );
  /** 时间线 hydrate 需要视频+音频素材索引 */
  const mediaAssets = useMemo(() => [...videoAssets, ...audioAssets], [videoAssets, audioAssets]);

  const [history, setHistory] = useState<TimelineHistory>(() => createHistory([]));
  const clips = history.present;
  const [trackCount, setTrackCount] = useState(DEFAULT_VIDEO_TRACKS);
  const [audioTrackCount, setAudioTrackCount] = useState(DEFAULT_AUDIO_TRACKS);
  /** 当前激活轨：视频或音轨各自一套 trackIndex */
  const [activeKind, setActiveKind] = useState<TimelineClipKind>("video");
  const [activeTrack, setActiveTrack] = useState(DEFAULT_VIDEO_TRACKS - 1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [timelineSec, setTimelineSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 异步导出进度 0–100；null 表示未在导出 */
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportProgressMsg, setExportProgressMsg] = useState("");
  /** 导出下拉：避免误触「继续编辑」与「返回」 */
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [probeAssetId, setProbeAssetId] = useState<string | null>(null);
  /** 本次进入仅尝试一次带入 URL 中的 assetId，避免重复追加 */
  const didImportInitialRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [longPrompt, setLongPrompt] = useState<LongClipPrompt | null>(null);
  const [ghost, setGhost] = useState<{
    id: string;
    kind: TimelineClipKind;
    trackIndex: number;
    startSec: number;
  } | null>(null);
  const ghostRef = useRef(ghost);
  ghostRef.current = ghost;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** 预览用音频元素，与主时钟 mapAudioAtTime 对齐 */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragKind | null>(null);
  const clipDragRef = useRef<{
    id: string;
    kind: TimelineClipKind;
    originX: number;
    originY: number;
    originStart: number;
    originTrack: number;
    active: boolean;
  } | null>(null);
  const clipsRef = useRef(clips);
  const selectedRef = useRef(selectedClipId);
  const playingRef = useRef(playing);
  const timelineSecRef = useRef(timelineSec);
  const activeClipIdRef = useRef<string | null>(null);
  const historyRef = useRef(history);
  const trackCountRef = useRef(trackCount);
  const audioTrackCountRef = useRef(audioTrackCount);
  const activeKindRef = useRef(activeKind);
  const activeTrackRef = useRef(activeTrack);
  /** 边缘 resize / 键盘 trim 前的快照，pointerup 时 commit 进历史 */
  const resizeDragBaseRef = useRef<TimelineClip[] | null>(null);
  const resizeClipIdRef = useRef<string | null>(null);
  const handleSplitRef = useRef<() => void>(() => {});
  const totalDurRef = useRef(0);
  const zoomRef = useRef(zoom);
  const bodyUserSelectBackupRef = useRef<string | null>(null);

  clipsRef.current = clips;
  selectedRef.current = selectedClipId;
  playingRef.current = playing;
  timelineSecRef.current = timelineSec;
  historyRef.current = history;
  trackCountRef.current = trackCount;
  audioTrackCountRef.current = audioTrackCount;
  activeKindRef.current = activeKind;
  activeTrackRef.current = activeTrack;
  zoomRef.current = zoom;

  const totalDur = timelineTotalDuration(clips);
  totalDurRef.current = totalDur;
  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  );
  const previewMapped = useMemo(
    () => mapTimelineTime(clips, timelineSec),
    [clips, timelineSec]
  );
  const previewClip = previewMapped?.clip ?? null;
  activeClipIdRef.current = previewClip?.id ?? null;

  const displayTracks = useMemo(() => trackDisplayOrder(trackCount), [trackCount]);
  const displayAudioTracks = useMemo(
    () => Array.from({ length: audioTrackCount }, (_, i) => i),
    [audioTrackCount]
  );
  const tracksBodyHeight = (trackCount + audioTrackCount) * TRACK_ROW_H;
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const trackWidthPx = Math.max(
    MIN_TRACK_WIDTH_PX,
    (totalDur > 0 ? totalDur : 2) * pxPerSec + 80
  );

  const applyFitZoom = useCallback(() => {
    const vw = scrollRef.current?.clientWidth ?? 800;
    setZoom(fitZoomForDuration(timelineTotalDuration(clipsRef.current), vw));
  }, []);

  // 从空时间线首次加入片段时自动「适应」铺满，避免短片挤成细线
  const didAutoFitRef = useRef(false);
  useEffect(() => {
    if (!clips.length) {
      didAutoFitRef.current = false;
      return;
    }
    if (!draftReady || didAutoFitRef.current) return;
    didAutoFitRef.current = true;
    const id = window.requestAnimationFrame(() => applyFitZoom());
    return () => window.cancelAnimationFrame(id);
  }, [draftReady, clips.length, applyFitZoom]);

  /** 拖拽期间禁止页面文本选中，避免拖播放头/片段时刷蓝 */
  const setBodyUserSelectNone = useCallback((on: boolean) => {
    if (typeof document === "undefined") return;
    if (on) {
      if (bodyUserSelectBackupRef.current == null) {
        bodyUserSelectBackupRef.current = document.body.style.userSelect;
      }
      document.body.style.userSelect = "none";
      return;
    }
    if (bodyUserSelectBackupRef.current != null) {
      document.body.style.userSelect = bodyUserSelectBackupRef.current;
      bodyUserSelectBackupRef.current = null;
    } else {
      document.body.style.userSelect = "";
    }
  }, []);

  const applyClips = useCallback((next: TimelineClip[], opts?: { selectId?: string | null }) => {
    setHistory((h) => commitHistory(h, next));
    setTrackCount((n) => resolveTrackCount(next, n));
    setAudioTrackCount((n) => resolveAudioTrackCount(next, n));
    if (opts && "selectId" in opts) setSelectedClipId(opts.selectId ?? null);
  }, []);

  const replaceClipsSilent = useCallback((next: TimelineClip[]) => {
    setHistory((h) => ({ ...h, present: structuredClone(next) }));
  }, []);

  // 恢复草稿优先级：fromNodeId 成片回填 > 服务端 OSS > sessionStorage > 空轨 + assetId
  useEffect(() => {
    if (!draftReady && mediaAssets.length === 0 && assetsLoading) return;
    if (draftReady) return;
    let cancelled = false;

    const applyValid = (
      draft: TimelineClip[],
      opts?: { trackCount?: number | null; audioTrackCount?: number | null }
    ) => {
      const hydrated = hydrateTimelineClips(draft, mediaAssets);
      const valid = hydrated.filter((c) =>
        mediaAssets.some((a) => a.id === c.assetId || a.legacyId === c.assetId)
      );
      if (!valid.length) return false;
      setHistory(createHistory(valid));
      setTrackCount(
        opts?.trackCount != null
          ? resolveTrackCount(valid, opts.trackCount)
          : resolveTrackCount(valid)
      );
      setAudioTrackCount(
        opts?.audioTrackCount != null
          ? resolveAudioTrackCount(valid, opts.audioTrackCount)
          : resolveAudioTrackCount(valid)
      );
      const first = valid[0]!;
      setActiveKind(first.kind === "audio" ? "audio" : "video");
      setActiveTrack(first.trackIndex);
      setSelectedClipId(first.id);
      return true;
    };

    (async () => {
      // 1) 显式从成片节点回填（覆盖当前草稿意图）
      if (fromNodeId) {
        const node = nodes.find((n) => n.id === fromNodeId);
        const params = (node?.data as WorkflowNodeData | undefined)?.params as
          | Record<string, unknown>
          | undefined;
        const meta =
          params?.composeMeta && typeof params.composeMeta === "object"
            ? (params.composeMeta as Record<string, unknown>)
            : null;
        const fromCompose = timelineClipsFromComposeMeta(meta, mediaAssets);
        if (!cancelled && fromCompose?.length && applyValid(fromCompose, {
          trackCount: typeof meta?.trackCount === "number" ? meta.trackCount : null,
          audioTrackCount:
            typeof meta?.audioTrackCount === "number" ? meta.audioTrackCount : null,
        })) {
          toast.message("已从成片节点回填时间线");
          if (initialAssetId) setProbeAssetId(initialAssetId);
          setDraftReady(true);
          return;
        }
      }

      // 2) 服务端项目草稿
      try {
        const remote = await fetchVideoEditorDraft(projectId);
        if (cancelled) return;
        const remoteClips = parseTimelineClipsFromUnknown(remote.clips);
        if (remoteClips?.length && applyValid(remoteClips, {
          trackCount: remote.trackCount,
          audioTrackCount: remote.audioTrackCount,
        })) {
          // 同步一份到 session 作离线兜底
          saveTimelineDraft(projectId, remoteClips);
          if (initialAssetId) setProbeAssetId(initialAssetId);
          setDraftReady(true);
          return;
        }
      } catch {
        /* 网络失败时降级本地 */
      }
      if (cancelled) return;

      // 3) sessionStorage
      const local = loadTimelineDraft(projectId);
      if (local?.length && applyValid(local)) {
        if (initialAssetId) setProbeAssetId(initialAssetId);
        setDraftReady(true);
        return;
      }

      if (initialAssetId) setProbeAssetId(initialAssetId);
      setDraftReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    initialAssetId,
    fromNodeId,
    mediaAssets,
    assetsLoading,
    draftReady,
    nodes,
  ]);

  useEffect(() => {
    if (!draftReady || !clips.length || !mediaAssets.length) return;
    const next = hydrateTimelineClips(clips, mediaAssets);
    const changed = next.some((c, i) => c.fileUrl !== clips[i]?.fileUrl);
    if (changed) replaceClipsSilent(next);
  }, [mediaAssets, draftReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // 本地 session + 服务端 OSS 双写（防抖）；空轨不主动覆盖服务端，除非用户清空
  useEffect(() => {
    if (!draftReady) return;
    if (!clips.length) {
      saveTimelineDraft(projectId, []);
      return;
    }
    const t = window.setTimeout(() => {
      saveTimelineDraft(projectId, clips);
      void saveVideoEditorDraft(projectId, {
        clips,
        trackCount,
        audioTrackCount,
      }).catch(() => {
        /* 静默：本地 session 仍可用 */
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [clips, trackCount, audioTrackCount, projectId, draftReady]);

  const appendClips = useCallback(
    (incoming: TimelineClip[], truncated?: boolean) => {
      if (!incoming.length) return;
      let next = [...clipsRef.current];
      for (const clip of incoming) {
        if (next.length >= MAX_TIMELINE_CLIPS) {
          toast.error(`最多 ${MAX_TIMELINE_CLIPS} 个片段`);
          break;
        }
        const placed = { ...clip };
        if (timelineTotalDuration([...next, placed]) > MAX_TIMELINE_TOTAL_SEC + 0.05) {
          toast.error(`时间线总时长不能超过 ${MAX_TIMELINE_TOTAL_SEC} 秒`);
          break;
        }
        const trial = [...next, placed];
        const resolved = resolveDrop(trial, placed.id, placed.trackIndex, placed.startSec);
        if (!resolved.ok) {
          toast.error(resolved.reason);
          break;
        }
        next = resolved.clips;
      }
      if (next.length === clipsRef.current.length) return;
      applyClips(next, { selectId: incoming[0]!.id });
      const first = next.find((c) => c.id === incoming[0]!.id) ?? incoming[0]!;
      setActiveKind(first.kind === "audio" ? "audio" : "video");
      setActiveTrack(first.trackIndex);
      setTimelineSec(first.startSec);
      timelineSecRef.current = first.startSec;
      if (truncated) toast.message("已按上限截断，部分片尾未加入");
    },
    [applyClips]
  );

  const addAssetResolved = useCallback(
    (asset: Asset, sourceDuration: number, mode: "head" | "split") => {
      // 视频素材强制 video，音频强制 audio；优先落到当前激活的同类轨
      const clipKind: TimelineClipKind = asset.category === "audio" ? "audio" : "video";
      const maxTracks =
        clipKind === "audio" ? audioTrackCountRef.current : trackCountRef.current;
      const preferTrack =
        activeKindRef.current === clipKind
          ? activeTrackRef.current
          : clipKind === "audio"
            ? 0
            : Math.max(0, trackCountRef.current - 1);
      const track = Math.max(0, Math.min(maxTracks - 1, preferTrack));

      if (mode === "split" && clipKind === "video" && sourceDuration > MAX_CLIP_DURATION_SEC + 0.05) {
        const { clips: parts, truncated } = createAutoSplitClipsFromAsset(asset, sourceDuration, {
          existingClips: clipsRef.current,
          trackIndex: track,
        });
        if (!parts.length) {
          toast.error("时间线已满，无法加入");
          return;
        }
        appendClips(parts, truncated);
        toast.success(`已切成 ${parts.length} 段加入`);
        return;
      }
      const timelineStart = nextStartOnTrack(clipsRef.current, clipKind, track);
      const clip = createClipFromAsset(asset, sourceDuration, {
        sourceStartSec: 0,
        trackIndex: track,
        timelineStartSec: timelineStart,
        kind: clipKind,
      });
      if (sourceDuration > MAX_CLIP_DURATION_SEC + 0.05) {
        toast.message(`已截取前 ${MAX_CLIP_DURATION_SEC} 秒`);
      }
      appendClips([clip]);
    },
    [appendClips]
  );

  /** 探测素材时长后加入；音频用 Audio，视频用 Video */
  const probeAndAdd = useCallback(
    (asset: Asset) => {
      const isAudio = asset.category === "audio";
      const el = isAudio ? document.createElement("audio") : document.createElement("video");
      el.preload = "metadata";
      el.src = asset.fileUrl;
      el.onloadedmetadata = () => {
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
        el.removeAttribute("src");
        el.load();
        if (!isAudio && dur > MAX_CLIP_DURATION_SEC + 0.05) {
          setLongPrompt({ asset, sourceDuration: dur });
          return;
        }
        addAssetResolved(asset, dur, "head");
      };
      el.onerror = () => {
        toast.error(isAudio ? "无法读取音频时长" : "无法读取视频时长");
        addAssetResolved(asset, MIN_VIDEO_TRIM_SEC, "head");
      };
    },
    [addAssetResolved]
  );

  useEffect(() => {
    if (!probeAssetId || !mediaAssets.length || !draftReady) return;
    if (didImportInitialRef.current) {
      setProbeAssetId(null);
      return;
    }
    const asset =
      mediaAssets.find((a) => a.id === probeAssetId || a.legacyId === probeAssetId) ?? null;
    setProbeAssetId(null);
    didImportInitialRef.current = true;
    if (!asset) {
      toast.message("未找到要带入的视频素材，请从左侧素材箱加入");
      return;
    }
    // 已在时间线上：选中首个匹配片段，避免重复追加
    const existing = clipsRef.current.find(
      (c) => c.assetId === asset.id || c.assetId === asset.legacyId
    );
    if (existing) {
      setSelectedClipId(existing.id);
      setActiveKind(existing.kind === "audio" ? "audio" : "video");
      setActiveTrack(existing.trackIndex);
      setTimelineSec(existing.startSec);
      timelineSecRef.current = existing.startSec;
      toast.message("已定位到时间线上的当前视频");
      return;
    }
    // 空轨或草稿上尚无该素材：探测时长后加入（长片会弹切段确认，不在此预告 toast）
    probeAndAdd(asset);
  }, [probeAssetId, mediaAssets, draftReady, probeAndAdd]);

  /**
   * 客户端 X → 时间线秒。
   * 播放头默认钳在总时长内；边缘拉长须 allowBeyond，否则右缘永远拖不过当前片尾。
   */
  const clientXToTimelineSec = useCallback(
    (clientX: number, opts?: { allowBeyond?: boolean }) => {
      const body = tracksBodyRef.current;
      const total = totalDurRef.current;
      if (!body) return 0;
      const rect = body.getBoundingClientRect();
      const x = Math.max(0, clientX - rect.left);
      const pps = BASE_PX_PER_SEC * zoomRef.current;
      if (pps <= 0) return 0;
      const raw = x / pps;
      if (opts?.allowBeyond) {
        return Math.max(0, Math.min(MAX_TIMELINE_TOTAL_SEC, raw));
      }
      const span = total > 0 ? total : 10;
      return Math.max(0, Math.min(span, raw));
    },
    []
  );

  /** 按 Y 映射到视频轨（同类内高轨在上） */
  const clientYToVideoTrack = useCallback((clientY: number) => {
    const body = tracksBodyRef.current;
    const n = trackCountRef.current;
    if (!body) return 0;
    const rect = body.getBoundingClientRect();
    const y = clientY - rect.top;
    const row = Math.floor(y / TRACK_ROW_H);
    const displayIdx = Math.max(0, Math.min(n - 1, row));
    return n - 1 - displayIdx;
  }, []);

  /** 按 Y 映射到音轨（视频区下方，A1 在上） */
  const clientYToAudioTrack = useCallback((clientY: number) => {
    const body = tracksBodyRef.current;
    const vn = trackCountRef.current;
    const an = audioTrackCountRef.current;
    if (!body) return 0;
    const rect = body.getBoundingClientRect();
    const y = clientY - rect.top - vn * TRACK_ROW_H;
    const row = Math.floor(y / TRACK_ROW_H);
    return Math.max(0, Math.min(an - 1, row));
  }, []);

  /** 素材拖放到时间线：上半视频区 / 下半音轨区 */
  const clientYToDropPlacement = useCallback(
    (clientY: number): { kind: TimelineClipKind; trackIndex: number } => {
      const body = tracksBodyRef.current;
      const vn = trackCountRef.current;
      if (!body) return { kind: "video", trackIndex: 0 };
      const rect = body.getBoundingClientRect();
      const y = clientY - rect.top;
      if (y >= vn * TRACK_ROW_H) {
        return { kind: "audio", trackIndex: clientYToAudioTrack(clientY) };
      }
      return { kind: "video", trackIndex: clientYToVideoTrack(clientY) };
    },
    [clientYToAudioTrack, clientYToVideoTrack]
  );

  /** 片段纵向换轨：仅在同类轨内移动 */
  const clientYToTrackForKind = useCallback(
    (clientY: number, kind: TimelineClipKind) => {
      return kind === "audio" ? clientYToAudioTrack(clientY) : clientYToVideoTrack(clientY);
    },
    [clientYToAudioTrack, clientYToVideoTrack]
  );

  /** 片段在 tracks body 上的 top（px） */
  const clipRowTop = useCallback(
    (clip: Pick<TimelineClip, "kind" | "trackIndex">) => {
      if (clip.kind === "audio") {
        return (trackCount + clip.trackIndex) * TRACK_ROW_H + 4;
      }
      return (trackCount - 1 - clip.trackIndex) * TRACK_ROW_H + 4;
    },
    [trackCount]
  );

  const seekTimeline = useCallback((t: number, opts?: { select?: boolean }) => {
    const list = clipsRef.current;
    const total = timelineTotalDuration(list);
    const next = Math.max(0, total > 0 ? Math.min(t, Math.max(0, total - 0.001)) : 0);
    setTimelineSec(next);
    timelineSecRef.current = next;
    const mapped = mapTimelineTime(list, next);
    if (mapped && opts?.select !== false) setSelectedClipId(mapped.clip.id);
    const video = videoRef.current;
    if (video && mapped) {
      try {
        if (Math.abs(video.currentTime - mapped.sourceTime) > 0.08) {
          video.currentTime = mapped.sourceTime;
        }
      } catch {
        /* ignore */
      }
    }
    // 同步预览音频到当前时间点
    const audioMapped = mapAudioAtTime(list, next);
    const audio = audioRef.current;
    if (audio) {
      if (audioMapped) {
        if (audio.src !== audioMapped.clip.fileUrl) {
          audio.src = audioMapped.clip.fileUrl;
        }
        try {
          if (Math.abs(audio.currentTime - audioMapped.sourceTime) > 0.08) {
            audio.currentTime = audioMapped.sourceTime;
          }
        } catch {
          /* ignore */
        }
      } else {
        audio.pause();
      }
    }
  }, []);

  const syncVideoToMapped = useCallback(() => {
    const video = videoRef.current;
    const mapped = mapTimelineTime(clipsRef.current, timelineSecRef.current);
    if (!video || !mapped) {
      video?.pause();
      return;
    }
    try {
      if (Math.abs(video.currentTime - mapped.sourceTime) > 0.12) {
        video.currentTime = mapped.sourceTime;
      }
    } catch {
      /* ignore */
    }
    if (playingRef.current && video.paused) {
      void video.play().catch(() => setPlaying(false));
    }
  }, []);

  /** 按主时钟对齐预览音频 */
  const syncAudioToMapped = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const mapped = mapAudioAtTime(clipsRef.current, timelineSecRef.current);
    if (!mapped) {
      audio.pause();
      return;
    }
    if (audio.src !== mapped.clip.fileUrl) {
      audio.src = mapped.clip.fileUrl;
    }
    try {
      if (Math.abs(audio.currentTime - mapped.sourceTime) > 0.12) {
        audio.currentTime = mapped.sourceTime;
      }
    } catch {
      /* ignore */
    }
    if (playingRef.current && audio.paused) {
      void audio.play().catch(() => {});
    }
  }, []);

  const onVideoLoaded = () => {
    syncVideoToMapped();
  };

  // 主时钟：空隙走黑场推进，片段驱动 video；音频经 mapAudioAtTime 同步
  useEffect(() => {
    if (!playing) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const list = clipsRef.current;
      const total = timelineTotalDuration(list);
      if (total <= 0) {
        setPlaying(false);
        return;
      }
      let t = timelineSecRef.current + dt;
      if (t >= total - 0.001) {
        setTimelineSec(total);
        timelineSecRef.current = total;
        setPlaying(false);
        videoRef.current?.pause();
        audioRef.current?.pause();
        return;
      }
      setTimelineSec(t);
      timelineSecRef.current = t;
      const mapped = mapTimelineTime(list, t);
      if (mapped) {
        if (activeClipIdRef.current !== mapped.clip.id) {
          setSelectedClipId(mapped.clip.id);
        }
        const video = videoRef.current;
        if (video && activeClipIdRef.current === mapped.clip.id) {
          try {
            if (Math.abs(video.currentTime - mapped.sourceTime) > 0.3) {
              video.currentTime = mapped.sourceTime;
            }
          } catch {
            /* ignore */
          }
          if (video.paused) void video.play().catch(() => {});
        }
      } else {
        videoRef.current?.pause();
      }
      // 预览音频：有内容则对齐并播放，空隙则暂停
      const audioMapped = mapAudioAtTime(list, t);
      const audio = audioRef.current;
      if (audio) {
        if (audioMapped) {
          if (audio.src !== audioMapped.clip.fileUrl) {
            audio.src = audioMapped.clip.fileUrl;
          }
          try {
            if (Math.abs(audio.currentTime - audioMapped.sourceTime) > 0.3) {
              audio.currentTime = audioMapped.sourceTime;
            }
          } catch {
            /* ignore */
          }
          if (audio.paused) void audio.play().catch(() => {});
        } else {
          audio.pause();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 切到新片段/素材时对齐源时间并续播
  useEffect(() => {
    if (!previewClip) {
      videoRef.current?.pause();
      return;
    }
    syncVideoToMapped();
  }, [previewClip?.id, previewClip?.fileUrl, syncVideoToMapped]);

  useEffect(() => {
    syncAudioToMapped();
  }, [timelineSec, clips, syncAudioToMapped]);

  const togglePlay = useCallback(() => {
    const list = clipsRef.current;
    if (!list.length) return;
    if (playingRef.current) {
      videoRef.current?.pause();
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    const total = timelineTotalDuration(list);
    let t = timelineSecRef.current;
    if (t >= total - 0.02) t = 0;
    setTimelineSec(t);
    timelineSecRef.current = t;
    const mapped = mapTimelineTime(list, t);
    if (mapped) setSelectedClipId(mapped.clip.id);
    setPlaying(true);
  }, []);

  const doUndo = useCallback(() => {
    const next = undoHistory(historyRef.current);
    if (!next) return;
    setHistory(next);
    setTrackCount(resolveTrackCount(next.present, trackCountRef.current));
    setAudioTrackCount(resolveAudioTrackCount(next.present, audioTrackCountRef.current));
    setSelectedClipId(next.present[0]?.id ?? null);
    setPlaying(false);
  }, []);

  const doRedo = useCallback(() => {
    const next = redoHistory(historyRef.current);
    if (!next) return;
    setHistory(next);
    setTrackCount(resolveTrackCount(next.present, trackCountRef.current));
    setAudioTrackCount(resolveAudioTrackCount(next.present, audioTrackCountRef.current));
    setSelectedClipId(next.present[0]?.id ?? null);
    setPlaying(false);
  }, []);

  // playhead / clip drag / 左右缘 resize
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const kind = dragRef.current;
      if (!kind) return;

      if (kind === "playhead") {
        seekTimeline(clientXToTimelineSec(e.clientX));
        return;
      }

      if (kind === "clip") {
        const drag = clipDragRef.current;
        if (!drag) return;
        const dx = e.clientX - drag.originX;
        const dy = e.clientY - drag.originY;
        if (!drag.active) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          drag.active = true;
        }
        const pps = BASE_PX_PER_SEC * zoomRef.current;
        const startSec = Math.max(0, drag.originStart + dx / pps);
        const trackIndex = clientYToTrackForKind(e.clientY, drag.kind);
        setGhost({ id: drag.id, kind: drag.kind, trackIndex, startSec });
        return;
      }

      // 边缘拉长/缩小：相对按下时的 base 快照绝对换算，拖动中 silent replace
      if (kind === "resize-left" || kind === "resize-right") {
        const base = resizeDragBaseRef.current ?? clipsRef.current;
        const id = resizeClipIdRef.current ?? selectedRef.current;
        if (!id || !base.some((c) => c.id === id)) return;
        e.preventDefault();
        // 中文：拉长必须允许超出当前总时长，否则右缘被钳死在片尾
        const t = clientXToTimelineSec(e.clientX, { allowBeyond: true });
        const patched =
          kind === "resize-left"
            ? resizeClipLeft(base, id, t)
            : resizeClipRight(base, id, t);
        replaceClipsSilent(patched);
        clipsRef.current = patched;
      }
    };

    const onUp = (e: PointerEvent) => {
      const kind = dragRef.current;
      setBodyUserSelectNone(false);
      try {
        (e.target as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      if (kind === "clip") {
        const drag = clipDragRef.current;
        const g = ghostRef.current;
        clipDragRef.current = null;
        dragRef.current = null;
        setGhost(null);
        if (drag?.active && g) {
          const resolved = resolveDrop(clipsRef.current, g.id, g.trackIndex, g.startSec);
          if (resolved.ok) {
            applyClips(resolved.clips, { selectId: g.id });
            setActiveKind(g.kind);
            setActiveTrack(g.trackIndex);
          } else {
            toast.error(resolved.reason);
          }
        }
        return;
      }
      if (kind === "resize-left" || kind === "resize-right") {
        const base = resizeDragBaseRef.current;
        const present = clipsRef.current;
        const selId = resizeClipIdRef.current;
        if (base) {
          setHistory((h) => {
            const withBase = { ...h, present: structuredClone(base) };
            return commitHistory(withBase, present);
          });
          setTrackCount((n) => resolveTrackCount(present, n));
          setAudioTrackCount((n) => resolveAudioTrackCount(present, n));
          if (selId) setSelectedClipId(selId);
        }
        resizeDragBaseRef.current = null;
        resizeClipIdRef.current = null;
        dragRef.current = null;
        return;
      }
      if (kind === "playhead") {
        dragRef.current = null;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [
    clientXToTimelineSec,
    clientYToTrackForKind,
    seekTimeline,
    applyClips,
    replaceClipsSilent,
    setBodyUserSelectNone,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(e.deltaY > 0 ? z / 1.2 : z * 1.2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedRef.current) return;
        e.preventDefault();
        const id = selectedRef.current;
        const next = clipsRef.current.filter((c) => c.id !== id);
        applyClips(next, { selectId: next[0]?.id ?? null });
        setPlaying(false);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const sel = selectedRef.current;
        if (sel && (e.altKey || e.shiftKey)) {
          const step = e.shiftKey ? 1 : 0.1;
          const delta = e.key === "ArrowLeft" ? -step : step;
          applyClips(nudgeClipStart(clipsRef.current, sel, delta), { selectId: sel });
          return;
        }
        const step = e.shiftKey ? 1 : 0.1;
        seekTimeline(timelineSecRef.current + (e.key === "ArrowLeft" ? -step : step));
        return;
      }
      const sel = selectedRef.current;
      const list = clipsRef.current;
      const clip = list.find((c) => c.id === sel);
      if (!clip) return;
      const mapped = mapTimelineTime(list, timelineSecRef.current);
      // I/O 仍作源片 trim（与边缘 resize 互补）
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        if (clip.kind === "audio") {
          // 音频用时间线时刻映射到源时间
          const am = mapAudioAtTime(list, timelineSecRef.current);
          const src = am && am.clip.id === clip.id ? am.sourceTime : clip.inSec;
          applyClips(patchClipTrim(list, clip.id, src, clip.outSec), { selectId: clip.id });
          return;
        }
        const src = mapped && mapped.clip.id === clip.id ? mapped.sourceTime : clip.inSec;
        applyClips(patchClipTrim(list, clip.id, src, clip.outSec), { selectId: clip.id });
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        if (clip.kind === "audio") {
          const am = mapAudioAtTime(list, timelineSecRef.current);
          const src = am && am.clip.id === clip.id ? am.sourceTime : clip.outSec;
          applyClips(patchClipTrim(list, clip.id, clip.inSec, src), { selectId: clip.id });
          return;
        }
        const src = mapped && mapped.clip.id === clip.id ? mapped.sourceTime : clip.outSec;
        applyClips(patchClipTrim(list, clip.id, clip.inSec, src), { selectId: clip.id });
        return;
      }
      if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleSplitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekTimeline, applyClips, doUndo, doRedo]);

  /** 分割选中片段（视频/音频）；播放头不在媒体窗内时落到中点 */
  const handleSplit = useCallback(() => {
    const selectedId = selectedRef.current;
    if (!selectedId) {
      toast.message("请先选中片段");
      return;
    }
    const list = clipsRef.current;
    const clip = list.find((c) => c.id === selectedId);
    if (!clip) return;
    const { mediaStart, mediaEnd } = mediaWindow(clip);
    let t = timelineSecRef.current;
    if (t < mediaStart || t >= mediaEnd) {
      const mid = (mediaStart + mediaEnd) / 2;
      if (
        mid <= mediaStart + MIN_VIDEO_TRIM_SEC ||
        mid >= mediaEnd - MIN_VIDEO_TRIM_SEC
      ) {
        toast.error(
          `片段太短，无法分割（两侧均须 ≥ ${MIN_VIDEO_TRIM_SEC} 秒）`
        );
        return;
      }
      t = mid;
      setTimelineSec(t);
      timelineSecRef.current = t;
      toast.message(
        clip.kind === "audio"
          ? "播放头已移到音频中点并分割"
          : "播放头已移到片段中点并分割"
      );
    }
    const next = splitClipAtPlayhead(list, selectedId, t);
    if (!next) {
      toast.error(
        `请将播放头放在片段有内容的区域内，且两侧均须 ≥ ${MIN_VIDEO_TRIM_SEC} 秒`
      );
      return;
    }
    // 分割会换新 id：选中切点右侧同轨同类型片段（勿优先选视频轨）
    const kind = clip.kind || "video";
    const right =
      next.find(
        (c) =>
          (c.kind || "video") === kind &&
          c.trackIndex === clip.trackIndex &&
          Math.abs(c.startSec - t) < 1e-3
      ) ?? null;
    applyClips(next, { selectId: right?.id ?? null });
    if (kind === "audio") {
      setActiveKind("audio");
      setActiveTrack(clip.trackIndex);
    }
  }, [applyClips]);
  handleSplitRef.current = handleSplit;

  const handleDelete = () => {
    if (!selectedClipId) return;
    const next = clips.filter((c) => c.id !== selectedClipId);
    applyClips(next, { selectId: next[0]?.id ?? null });
    setPlaying(false);
  };

  const handleClear = () => {
    if (!clips.length) return;
    applyClips([], { selectId: null });
    setTimelineSec(0);
    setPlaying(false);
    clearTimelineDraft(projectId);
    void deleteVideoEditorDraft(projectId).catch(() => {});
    toast.message("已清空时间线");
  };

  const addVideoTrack = () => {
    if (trackCount >= MAX_VIDEO_TRACKS) {
      toast.message(`最多 ${MAX_VIDEO_TRACKS} 条视频轨`);
      return;
    }
    const n = trackCount + 1;
    setTrackCount(n);
    setActiveKind("video");
    setActiveTrack(n - 1);
  };

  const addAudioTrack = () => {
    if (audioTrackCount >= MAX_AUDIO_TRACKS) {
      toast.message(`最多 ${MAX_AUDIO_TRACKS} 条音轨（至少 ${MIN_AUDIO_TRACKS}）`);
      return;
    }
    const n = Math.min(MAX_AUDIO_TRACKS, Math.max(MIN_AUDIO_TRACKS, audioTrackCount + 1));
    setAudioTrackCount(n);
    setActiveKind("audio");
    setActiveTrack(n - 1);
  };

  const removeEmptyTopTrack = () => {
    if (trackCount <= MIN_VIDEO_TRACKS) return;
    const top = trackCount - 1;
    if (clips.some((c) => (c.kind || "video") === "video" && c.trackIndex === top)) {
      toast.error("请先清空该轨道上的片段");
      return;
    }
    setTrackCount(trackCount - 1);
    if (activeKind === "video") {
      setActiveTrack((t) => Math.min(t, trackCount - 2));
    }
  };

  /** 从素材箱拖放到时间线 */
  const handleTracksDragOver = (e: ReactDragEvent) => {
    // 浏览器可能把自定义 MIME 小写化，同时接受 text/plain 兜底
    const types = Array.from(e.dataTransfer.types || []).map((t) => t.toLowerCase());
    if (!types.includes(JM_ASSET_DRAG_MIME) && !types.includes("text/plain")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleTracksDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    const assetId =
      e.dataTransfer.getData(JM_ASSET_DRAG_MIME) || e.dataTransfer.getData("text/plain");
    if (!assetId) return;
    const asset =
      mediaAssets.find((a) => a.id === assetId || a.legacyId === assetId) ?? null;
    if (!asset?.fileUrl) {
      toast.error("素材不存在或无法使用");
      return;
    }
    const placement = clientYToDropPlacement(e.clientY);
    // 视频素材只能落视频区；音频只能落音轨区（错区则落到该类默认轨）
    const kind: TimelineClipKind = asset.category === "audio" ? "audio" : "video";
    const trackIndex =
      kind === placement.kind
        ? placement.trackIndex
        : kind === "audio"
          ? 0
          : Math.max(0, trackCountRef.current - 1);
    const timelineStart = clientXToTimelineSec(e.clientX);

    const isAudio = kind === "audio";
    const el = isAudio ? document.createElement("audio") : document.createElement("video");
    el.preload = "metadata";
    el.src = asset.fileUrl;
    el.onloadedmetadata = () => {
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : MIN_VIDEO_TRIM_SEC;
      el.removeAttribute("src");
      el.load();
      if (!isAudio && dur > MAX_CLIP_DURATION_SEC + 0.05) {
        setActiveKind("video");
        setActiveTrack(trackIndex);
        setLongPrompt({ asset, sourceDuration: dur });
        return;
      }
      const clip = createClipFromAsset(asset, dur, {
        sourceStartSec: 0,
        trackIndex,
        timelineStartSec: timelineStart,
        kind,
      });
      appendClips([clip]);
    };
    el.onerror = () => {
      toast.error(isAudio ? "无法读取音频时长" : "无法读取视频时长");
      const clip = createClipFromAsset(asset, MIN_VIDEO_TRIM_SEC, {
        trackIndex,
        timelineStartSec: timelineStart,
        kind,
      });
      appendClips([clip]);
    };
  };

  const backToCanvas = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await useCanvasStore.getState().flushAutoSave();
    } catch {
      /* ignore */
    }
    router.push(canvasHref(projectId));
  };

  /** 导出成片到画布；stay=保留时间线继续编辑，return=清空草稿并回画布 */
  const handleExport = async (mode: "return" | "stay" = "return") => {
    if (!clips.length || exporting) return;
    const videoClips = videoClipsOf(clips);
    if (!videoClips.length) {
      toast.error("导出至少需要 1 个视频片段");
      return;
    }
    for (let i = 0; i < clips.length; i++) {
      if (clipDuration(clips[i]!) < MIN_VIDEO_TRIM_SEC) {
        toast.error(`第 ${i + 1} 个片段过短`);
        return;
      }
    }
    if (timelineTotalDuration(clips) > MAX_TIMELINE_TOTAL_SEC + 0.05) {
      toast.error(`总时长不能超过 ${MAX_TIMELINE_TOTAL_SEC} 秒`);
      return;
    }
    setExportMenuOpen(false);
    setExporting(true);
    setExportProgress(0);
    setExportProgressMsg("提交拼接任务…");
    setPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
    try {
      const exportAudio = audioClipsForExport(clips);
      const { asset, clipCount } = await composeVideoAssets({
        projectId,
        clips: videoClips.map((c) => ({
          videoAssetId: c.assetId,
          inSec: c.inSec,
          outSec: c.outSec,
          startSec: c.startSec,
          trackIndex: c.trackIndex,
          padBeforeSec: c.padBeforeSec || 0,
          padAfterSec: c.padAfterSec || 0,
        })),
        audioClips: exportAudio.length ? exportAudio : undefined,
        title: clips.length > 1 ? "剪辑成片" : `${clips[0]!.title} · 剪辑`,
        onProgress: (pct, msg) => {
          setExportProgress(pct);
          if (msg) setExportProgressMsg(msg);
        },
      });
      const store = useCanvasStore.getState();
      const position = resolveAddNodePosition("video_input", store.nodes, {
        viewport: store.viewport,
        paneSize: store.flowPaneSize,
        selectedNodeId: store.selectedNodeId,
      });
      store.addNodeFromAsset(
        { id: asset.id, category: "video", fileUrl: asset.fileUrl, title: "剪辑" },
        position
      );
      const newNodeId = useCanvasStore.getState().selectedNodeId;
      if (newNodeId) {
        store.updateNodeParam(newNodeId, "toolMode", "video_compose");
        store.updateNodeParam(newNodeId, "composeMeta", {
          clipCount,
          multiTrack: true,
          trackCount,
          audioTrackCount,
          clips: videoClips.map((c) => ({
            assetId: c.assetId,
            inSec: c.inSec,
            outSec: c.outSec,
            startSec: c.startSec,
            trackIndex: c.trackIndex,
            padBeforeSec: c.padBeforeSec || 0,
            padAfterSec: c.padAfterSec || 0,
          })),
          audioClips: exportAudio,
        });
        store.updateNodeData(newNodeId, { label: "剪辑" });
      }
      await store.saveWorkflow(true);
      if (mode === "stay") {
        // 保留时间线草稿，方便继续改后再导出
        void saveVideoEditorDraft(projectId, {
          clips,
          trackCount,
          audioTrackCount,
        }).catch(() => {});
        toast.success(
          clipCount > 1 ? `已导出 ${clipCount} 段成片到画布，可继续编辑` : "已导出到画布，可继续编辑"
        );
      } else {
        clearTimelineDraft(projectId);
        void deleteVideoEditorDraft(projectId).catch(() => {});
        setHistory(createHistory([]));
        toast.success(clipCount > 1 ? `已导出 ${clipCount} 段成片` : "已导出到画布");
        router.push(canvasHref(projectId));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
      setExportProgress(null);
      setExportProgressMsg("");
    }
  };

  const rulerTicks = useMemo(() => {
    const total = totalDur > 0 ? totalDur : 2;
    const px = BASE_PX_PER_SEC * zoom;
    let step = 1;
    if (px >= 600) step = FRAME_SEC;
    else if (px >= 200) step = 0.1;
    else if (px >= 80) step = 0.5;
    else if (total > 60) step = 10;
    else if (total > 20) step = 5;
    else if (total > 5) step = 1;
    else step = 0.5;
    const ticks: number[] = [];
    const maxT = total + step * 0.01;
    for (let t = 0; t <= maxT; t += step) {
      ticks.push(Math.round(t * 1000) / 1000);
      if (ticks.length > 400) break;
    }
    return ticks;
  }, [totalDur, zoom]);

  const renderBinItem = (asset: Asset) => {
    const onTimeline = clips.some((c) => c.assetId === asset.id);
    const isAudio = asset.category === "audio";
    return (
      <div
        key={asset.id}
        draggable
        className="group flex w-full cursor-grab items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 active:cursor-grabbing"
        onDoubleClick={() => probeAndAdd(asset)}
        onDragStart={(e) => {
          e.dataTransfer.setData(JM_ASSET_DRAG_MIME, asset.id);
          e.dataTransfer.setData("text/plain", asset.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded bg-white/5">
          {isAudio ? (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-emerald-300/80">
              音频
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.thumbnailUrl || asset.fileUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span
              className={`shrink-0 rounded px-1 py-px text-[9px] ${
                isAudio ? "bg-emerald-500/20 text-emerald-300/90" : "bg-violet-500/20 text-violet-300/90"
              }`}
            >
              {isAudio ? "音频" : "视频"}
            </span>
            <span className="line-clamp-2 text-[11px] text-white/75">
              {asset.title || (isAudio ? "未命名音频" : "未命名视频")}
            </span>
          </div>
          {onTimeline ? (
            <span className="text-[10px] text-violet-300/70">已在时间线</span>
          ) : null}
        </div>
        <button
          type="button"
          title="加入当前轨"
          className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 opacity-0 hover:bg-white/10 group-hover:opacity-100"
          onClick={() => probeAndAdd(asset)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  const activeTrackLabel =
    activeKind === "audio"
      ? audioTrackLabel(activeTrack)
      : trackLabel(activeTrack, trackCount);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#0c0b10] text-white">
      {/* 预览音频：隐藏，由主时钟驱动 */}
      <audio ref={audioRef} preload="auto" className="hidden" />

      {exporting ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-violet-300" />
          <p className="text-sm text-white/80">
            {exportProgressMsg ||
              `正在拼接导出${clips.length > 1 ? `（${clips.length} 段）` : ""}…`}
          </p>
          <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-violet-400 transition-[width] duration-300"
              style={{
                width: `${Math.max(2, Math.min(100, exportProgress ?? 0))}%`,
              }}
            />
          </div>
          <p className="text-xs tabular-nums text-white/45">
            {Math.round(Math.max(0, Math.min(100, exportProgress ?? 0)))}%
          </p>
        </div>
      ) : null}

      {longPrompt ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#16141c] p-5 shadow-2xl">
            <h3 className="text-sm font-medium text-white">长视频处理</h3>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              「{longPrompt.asset.title || "视频"}」约{" "}
              <strong className="text-violet-300">
                {formatTimecode(longPrompt.sourceDuration)}
              </strong>
              ，单段上限 {MAX_CLIP_DURATION_SEC} 秒。请选择加入方式：
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className="rounded-lg bg-violet-500 px-3 py-2.5 text-left text-sm text-white hover:bg-violet-400"
                onClick={() => {
                  addAssetResolved(longPrompt.asset, longPrompt.sourceDuration, "split");
                  setLongPrompt(null);
                }}
              >
                自动按 {MAX_CLIP_DURATION_SEC}s 切成多段加入
                <span className="mt-0.5 block text-[11px] text-white/70">
                  落到当前轨 · 可覆盖更长内容
                </span>
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-2.5 text-left text-sm text-white/85 hover:bg-white/5"
                onClick={() => {
                  addAssetResolved(longPrompt.asset, longPrompt.sourceDuration, "head");
                  setLongPrompt(null);
                }}
              >
                仅截取前 {MAX_CLIP_DURATION_SEC} 秒
              </button>
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-white/45 hover:text-white/70"
                onClick={() => setLongPrompt(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-black/50 px-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void backToCanvas()}
            disabled={leaving || exporting}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
            返回画布
          </button>
          <span className="text-white/25">|</span>
          <div className="flex min-w-0 items-center gap-2">
            <Scissors className="h-4 w-4 shrink-0 text-violet-300" />
            <span className="truncate text-sm font-medium text-white/90">剪辑台</span>
            {clips.length > 0 ? (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                {clips.length} 段 · V{trackCount}/A{audioTrackCount}
              </span>
            ) : null}
          </div>
          {projectNo ? (
            <span className="hidden truncate text-xs text-white/40 sm:inline">
              · {projectNo}
              {projectName ? ` / ${projectName}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canUndo(history) || exporting}
            onClick={doUndo}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-30"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canRedo(history) || exporting}
            onClick={doRedo}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-30"
            title="重做 (Ctrl+Y)"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!clips.length || exporting}
            onClick={handleClear}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5" />
            清空
          </button>
          <div className="relative">
            <div className="flex">
              <button
                type="button"
                disabled={!clips.length || exporting}
                onClick={() => void handleExport("return")}
                className="inline-flex h-9 items-center gap-2 rounded-l-lg bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40"
                title="导出成片到画布并返回"
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                导出并返回
              </button>
              <button
                type="button"
                disabled={!clips.length || exporting}
                onClick={() => setExportMenuOpen((v) => !v)}
                className="inline-flex h-9 w-8 items-center justify-center rounded-r-lg border-l border-violet-400/40 bg-violet-500 text-white hover:bg-violet-400 disabled:opacity-40"
                title="更多导出选项"
                aria-expanded={exportMenuOpen}
              >
                <span className="text-xs leading-none">▾</span>
              </button>
            </div>
            {exportMenuOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="关闭导出菜单"
                  onClick={() => setExportMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl">
                  <button
                    type="button"
                    disabled={exporting}
                    className="block w-full px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10 disabled:opacity-40"
                    onClick={() => void handleExport("return")}
                  >
                    导出并返回画布
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    className="block w-full px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10 disabled:opacity-40"
                    onClick={() => void handleExport("stay")}
                  >
                    导出并继续编辑
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-black/30">
          <div className="border-b border-white/10 px-3 py-2.5 text-xs font-medium text-white/50">
            项目素材 · 拖入时间线 / 双击加入
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
            {assetsLoading ? (
              <div className="flex items-center gap-2 px-2 py-6 text-xs text-white/40">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载素材…
              </div>
            ) : videoAssets.length === 0 && audioAssets.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-white/35">
                暂无视频/音频素材
                <br />
                请先在画布上传
              </p>
            ) : (
              <>
                {videoAssets.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-white/35">
                      视频
                    </div>
                    {videoAssets.map(renderBinItem)}
                  </div>
                ) : null}
                {audioAssets.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="px-1 text-[10px] font-medium uppercase tracking-wide text-white/35">
                      音频
                    </div>
                    {audioAssets.map(renderBinItem)}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_center,_#1a1722_0%,_#0c0b10_70%)] p-6">
            {previewClip ? (
              <video
                key={previewClip.assetId}
                ref={videoRef}
                src={previewClip.fileUrl}
                className="max-h-full max-w-full rounded-lg shadow-2xl shadow-black/50"
                playsInline
                preload="auto"
                onLoadedMetadata={onVideoLoaded}
                onClick={togglePlay}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-white/35">
                <div className="flex h-40 w-64 items-center justify-center rounded-lg bg-black/50 ring-1 ring-white/10">
                  <Film className="h-12 w-12" strokeWidth={1.2} />
                </div>
                <span className="text-sm">
                  {clips.length
                    ? playing
                      ? "空隙（黑场）…"
                      : "当前时间点无画面（空隙）"
                    : "从左侧拖入或双击素材加入时间线"}
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 bg-[#121018] px-4 pb-4 pt-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-40"
                  disabled={!clips.length}
                  onClick={() => seekTimeline(0)}
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/15 disabled:opacity-40"
                  disabled={!clips.length}
                  onClick={togglePlay}
                >
                  {playing ? (
                    <Pause className="h-4 w-4" fill="currentColor" />
                  ) : (
                    <Play className="h-4 w-4 translate-x-0.5" fill="currentColor" />
                  )}
                </button>
                <span className="mx-1 h-5 w-px bg-white/10" />
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
                  disabled={!selectedClip}
                  onClick={handleSplit}
                >
                  <SplitSquareHorizontal className="h-3.5 w-3.5" />
                  分割
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-300/80 hover:bg-rose-500/15 disabled:opacity-40"
                  disabled={!selectedClip}
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <span className="mx-1 h-5 w-px bg-white/10" />
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
                  disabled={trackCount >= MAX_VIDEO_TRACKS}
                  onClick={addVideoTrack}
                  title="增加视频轨"
                >
                  <Plus className="h-3.5 w-3.5" />
                  视频轨
                </button>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
                  disabled={audioTrackCount >= MAX_AUDIO_TRACKS}
                  onClick={addAudioTrack}
                  title={`增加音轨（最多 ${MAX_AUDIO_TRACKS}）`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  音轨
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 text-[11px] text-white/45 hover:bg-white/5 hover:text-white/70 disabled:opacity-30"
                  disabled={trackCount <= MIN_VIDEO_TRACKS}
                  onClick={removeEmptyTopTrack}
                >
                  删空轨
                </button>
                <span className="mx-1 h-5 w-px bg-white/10" />
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30"
                  disabled={zoom <= ZOOM_MIN + 1e-6}
                  onClick={() => setZoom((z) => clampZoom(z / 1.35))}
                  title="缩小"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-[3.5rem] text-center font-mono text-[11px] text-white/45">
                  {zoom >= 10 ? `${Math.round(zoom)}×` : `${Math.round(zoom * 100)}%`}
                </span>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 disabled:opacity-30"
                  disabled={zoom >= ZOOM_MAX - 1e-6}
                  onClick={() => setZoom((z) => clampZoom(z * 1.35))}
                  title={`放大（最大约单帧 ${Math.round(FRAME_ZOOM_PX)}px）`}
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 text-[11px] text-white/45 hover:bg-white/5 hover:text-white/70"
                  onClick={applyFitZoom}
                  title="铺满可视宽度"
                >
                  适应
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 text-[11px] text-white/45 hover:bg-white/5 hover:text-white/70"
                  onClick={() => setZoom(ZOOM_MAX)}
                  title="放大到单帧级"
                >
                  单帧
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-white/55">
                <span>
                  当前轨{" "}
                  <strong
                    className={
                      activeKind === "audio" ? "text-emerald-300" : "text-violet-300"
                    }
                  >
                    {activeTrackLabel}
                  </strong>
                </span>
                {selectedClip ? (
                  <span>
                    片长{" "}
                    <strong className="text-white/80">
                      {formatTimecode(clipDuration(selectedClip))}
                    </strong>
                  </span>
                ) : null}
                <span>
                  总长 <strong className="text-white/85">{formatTimecode(totalDur)}</strong>
                </span>
                <span>
                  {formatTimecode(timelineSec)} / {formatTimecode(totalDur)}
                </span>
              </div>
            </div>

            <div className="flex gap-0">
              {/* 轨头：视频轨 + 音轨 */}
              <div className="w-14 shrink-0">
                <div className="h-5" />
                {displayTracks.map((ti) => (
                  <button
                    key={`v-${ti}`}
                    type="button"
                    onClick={() => {
                      setActiveKind("video");
                      setActiveTrack(ti);
                    }}
                    className={`flex h-11 w-full items-center justify-center border-b border-white/5 text-[11px] font-medium ${
                      activeKind === "video" && activeTrack === ti
                        ? "bg-violet-500/20 text-violet-200"
                        : "text-white/45 hover:bg-white/5"
                    }`}
                    style={{ height: TRACK_ROW_H }}
                  >
                    {trackLabel(ti, trackCount)}
                  </button>
                ))}
                {displayAudioTracks.map((ti) => (
                  <button
                    key={`a-${ti}`}
                    type="button"
                    onClick={() => {
                      setActiveKind("audio");
                      setActiveTrack(ti);
                    }}
                    className={`flex h-11 w-full items-center justify-center border-b border-white/5 text-[11px] font-medium ${
                      activeKind === "audio" && activeTrack === ti
                        ? "bg-emerald-500/20 text-emerald-200"
                        : "text-white/45 hover:bg-white/5"
                    }`}
                    style={{ height: TRACK_ROW_H }}
                  >
                    {audioTrackLabel(ti)}
                  </button>
                ))}
              </div>

              <div
                ref={scrollRef}
                className="min-w-0 flex-1 select-none overflow-x-auto overflow-y-hidden pb-1"
              >
                <div style={{ width: trackWidthPx }}>
                  {/* 标尺 */}
                  <div
                    className="relative h-5 border-b border-white/10"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setBodyUserSelectNone(true);
                      dragRef.current = "playhead";
                      seekTimeline(clientXToTimelineSec(e.clientX));
                    }}
                  >
                    {rulerTicks.map((t) => (
                      <span
                        key={t}
                        className="absolute top-0.5 -translate-x-1/2 font-mono text-[9px] text-white/35"
                        style={{ left: t * BASE_PX_PER_SEC * zoom }}
                      >
                        {formatTimecode(t)}
                      </span>
                    ))}
                  </div>

                  <div
                    ref={tracksBodyRef}
                    className="relative"
                    style={{ height: tracksBodyHeight }}
                    onDragOver={handleTracksDragOver}
                    onDrop={handleTracksDrop}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).closest("[data-clip-block]")) return;
                      if ((e.target as HTMLElement).closest("[data-resize-handle]")) return;
                      e.preventDefault();
                      setBodyUserSelectNone(true);
                      const placement = clientYToDropPlacement(e.clientY);
                      setActiveKind(placement.kind);
                      setActiveTrack(placement.trackIndex);
                      dragRef.current = "playhead";
                      seekTimeline(clientXToTimelineSec(e.clientX));
                    }}
                  >
                    {displayTracks.map((ti, row) => (
                      <div
                        key={`vr-${ti}`}
                        className={`absolute left-0 right-0 border-b border-white/5 ${
                          activeKind === "video" && activeTrack === ti
                            ? "bg-violet-500/5"
                            : "bg-white/[0.03]"
                        }`}
                        style={{ top: row * TRACK_ROW_H, height: TRACK_ROW_H }}
                      />
                    ))}
                    {displayAudioTracks.map((ti) => (
                      <div
                        key={`ar-${ti}`}
                        className={`absolute left-0 right-0 border-b border-white/5 ${
                          activeKind === "audio" && activeTrack === ti
                            ? "bg-emerald-500/5"
                            : "bg-white/[0.02]"
                        }`}
                        style={{
                          top: (trackCount + ti) * TRACK_ROW_H,
                          height: TRACK_ROW_H,
                        }}
                      />
                    ))}

                    {clips.length === 0 ? (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-white/25">
                        时间线为空 — 拖入或双击左侧素材
                      </div>
                    ) : null}

                    {clips.map((clip, i) => {
                      const dur = clipDuration(clip);
                      const pps = BASE_PX_PER_SEC * zoom;
                      const left = clip.startSec * pps;
                      const width = Math.max(dur * pps, 8);
                      const isGhost = ghost?.id === clip.id;
                      const isAudio = clip.kind === "audio";
                      const colorClass = isAudio
                        ? AUDIO_CLIP_COLOR
                        : CLIP_COLORS[i % CLIP_COLORS.length];
                      const padBefore = Math.max(0, clip.padBeforeSec || 0);
                      const padAfter = Math.max(0, clip.padAfterSec || 0);
                      const { mediaStart, mediaEnd } = mediaWindow(clip);
                      // 空镜区占槽位比例，用于条纹可视化
                      const padBeforePct =
                        dur > 0 ? ((mediaStart - clip.startSec) / dur) * 100 : 0;
                      const padAfterPct =
                        dur > 0 ? ((clipEndSec(clip) - mediaEnd) / dur) * 100 : 0;
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          data-clip-block
                          title={`${clip.title} · 拖动改位置/换轨`}
                          className={`absolute overflow-hidden rounded-md ring-1 ${colorClass} ${
                            clip.id === selectedClipId ? "z-[6] ring-2 ring-white/80" : "z-[4]"
                          } ${isGhost ? "opacity-35" : ""}`}
                          style={{
                            left,
                            width,
                            top: clipRowTop(clip),
                            height: TRACK_ROW_H - 8,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setBodyUserSelectNone(true);
                            setPlaying(false);
                            videoRef.current?.pause();
                            audioRef.current?.pause();
                            setSelectedClipId(clip.id);
                            setActiveKind(isAudio ? "audio" : "video");
                            setActiveTrack(clip.trackIndex);
                            clipDragRef.current = {
                              id: clip.id,
                              kind: isAudio ? "audio" : "video",
                              originX: e.clientX,
                              originY: e.clientY,
                              originStart: clip.startSec,
                              originTrack: clip.trackIndex,
                              active: false,
                            };
                            dragRef.current = "clip";
                            seekTimeline(sourceToTimelineSec(clips, clip, clip.inSec), {
                              select: false,
                            });
                            setSelectedClipId(clip.id);
                          }}
                        >
                          {/* 片头空镜条纹 */}
                          {padBefore > 0.001 ? (
                            <span
                              className="pointer-events-none absolute inset-y-0 left-0 bg-[repeating-linear-gradient(-45deg,transparent,transparent_3px,rgba(0,0,0,0.35)_3px,rgba(0,0,0,0.35)_6px)]"
                              style={{ width: `${padBeforePct}%` }}
                            />
                          ) : null}
                          {/* 片尾空镜条纹 */}
                          {padAfter > 0.001 ? (
                            <span
                              className="pointer-events-none absolute inset-y-0 right-0 bg-[repeating-linear-gradient(-45deg,transparent,transparent_3px,rgba(0,0,0,0.35)_3px,rgba(0,0,0,0.35)_6px)]"
                              style={{ width: `${padAfterPct}%` }}
                            />
                          ) : null}
                          <span className="relative block truncate px-1.5 pt-1 text-left text-[10px] text-white/90">
                            {clip.title}
                          </span>
                          <span className="relative block px-1.5 text-left text-[9px] text-white/50">
                            {formatTimecode(dur)}
                          </span>
                        </button>
                      );
                    })}

                    {ghost ? (
                      <div
                        className="pointer-events-none absolute z-[7] rounded-md bg-amber-300/35 ring-1 ring-amber-200/70"
                        style={{
                          left: ghost.startSec * BASE_PX_PER_SEC * zoom,
                          width: Math.max(
                            (clips.find((c) => c.id === ghost.id)
                              ? clipDuration(clips.find((c) => c.id === ghost.id)!)
                              : 1) *
                              BASE_PX_PER_SEC *
                              zoom,
                            8
                          ),
                          top: clipRowTop({
                            kind: ghost.kind,
                            trackIndex: ghost.trackIndex,
                          }),
                          height: TRACK_ROW_H - 8,
                        }}
                      />
                    ) : null}

                    {/* 选中片段左右缘：与视频条同 top/高；外层加宽热区便于拖 */}
                    {selectedClip ? (
                      <>
                        <button
                          type="button"
                          data-resize-handle="true"
                          aria-label="左缘拉长/缩小"
                          className="absolute z-30 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none items-stretch justify-center"
                          style={{
                            left: selectedClip.startSec * BASE_PX_PER_SEC * zoom,
                            top: clipRowTop({
                              kind: selectedClip.kind || "video",
                              trackIndex: selectedClip.trackIndex,
                            }),
                            height: TRACK_ROW_H - 8,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            setBodyUserSelectNone(true);
                            setPlaying(false);
                            videoRef.current?.pause();
                            audioRef.current?.pause();
                            resizeDragBaseRef.current = structuredClone(clipsRef.current);
                            resizeClipIdRef.current = selectedClip.id;
                            dragRef.current = "resize-left";
                          }}
                        >
                          <span
                            className={`pointer-events-none w-1.5 rounded-sm ${
                              selectedClip.kind === "audio" ? "bg-emerald-300" : "bg-violet-300"
                            }`}
                          />
                        </button>
                        <button
                          type="button"
                          data-resize-handle="true"
                          aria-label="右缘拉长/缩小"
                          className="absolute z-30 flex w-4 -translate-x-1/2 cursor-ew-resize touch-none items-stretch justify-center"
                          style={{
                            left: clipEndSec(selectedClip) * BASE_PX_PER_SEC * zoom,
                            top: clipRowTop({
                              kind: selectedClip.kind || "video",
                              trackIndex: selectedClip.trackIndex,
                            }),
                            height: TRACK_ROW_H - 8,
                          }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            setBodyUserSelectNone(true);
                            setPlaying(false);
                            videoRef.current?.pause();
                            audioRef.current?.pause();
                            resizeDragBaseRef.current = structuredClone(clipsRef.current);
                            resizeClipIdRef.current = selectedClip.id;
                            dragRef.current = "resize-right";
                          }}
                        >
                          <span
                            className={`pointer-events-none w-1.5 rounded-sm ${
                              selectedClip.kind === "audio" ? "bg-emerald-300" : "bg-violet-300"
                            }`}
                          />
                        </button>
                      </>
                    ) : null}

                    {clips.length > 0 || totalDur > 0 ? (
                      <div
                        className="pointer-events-none absolute top-0 z-20 w-0.5 -translate-x-1/2 bg-white shadow"
                        style={{
                          left: timelineSec * BASE_PX_PER_SEC * zoom,
                          height: tracksBodyHeight,
                        }}
                      >
                        <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-2 text-center text-[11px] text-white/30">
              拖片段改位置/换轨 · 拖左右缘拉长（空镜）或缩小 · 素材可拖入时间线 · Ctrl+滚轮缩放 ·
              I/O 裁切 · Ctrl+Z 撤销 · 单段≤{MAX_CLIP_DURATION_SEC}s · 合计≤
              {MAX_TIMELINE_TOTAL_SEC}s
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}