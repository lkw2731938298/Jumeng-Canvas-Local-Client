"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pause,
  Play,
  Plus,
  Square,
  ChevronDown,
  Undo2,
  Redo2,
  Download,
  Repeat,
  Sparkles,
  Route,
  Eraser,
  PanelBottomClose,
  Video,
  Box,
  PersonStanding,
} from "lucide-react";
import type {
  DirectorAnimTrack,
  DirectorAnimationTimeline,
  DirectorObject,
} from "@jumeng-canvas/shared";
import {
  CAMERA_MOTION_PRESETS,
  type CameraMotionPresetId,
} from "@/lib/director/animation/cameraPresets";
import {
  MOTION_PATH_DRAW_TOOLS,
  motionPathDrawBanner,
  type MotionPathDrawTool,
} from "@/lib/director/animation/motionPathDrawTools";

export interface DirectorTimelinePanelProps {
  timeline: DirectorAnimationTimeline;
  objects: DirectorObject[];
  playhead: number;
  playing: boolean;
  selectedTrackId: string | null;
  drawingTrackId: string | null;
  drawingTool?: MotionPathDrawTool | null;
  selectedObjectId: string | null;
  canUndo?: boolean;
  canRedo?: boolean;
  onPlayheadChange: (t: number) => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onToggleAutoKeyframe: () => void;
  onDurationChange: (d: number) => void;
  onPanelHeightChange: (h: number) => void;
  onZoomChange: (z: number) => void;
  onSelectTrack: (trackId: string | null) => void;
  onCreateTrack: () => void;
  /** tool 缺省为钢笔；延伸已有路径时由上层强制 pen */
  onStartDrawPath: (trackId: string, tool?: MotionPathDrawTool) => void;
  onClearPath: (trackId: string) => void;
  onApplyCameraPreset: (trackId: string, preset: CameraMotionPresetId) => void;
  onDeleteKeyframe: (trackId: string, keyframeId: string) => void;
  onMoveKeyframe: (trackId: string, keyframeId: string, time: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onExportVideo?: () => void;
  /** 导出选中摄像机轨镜头（需已选中 camera 轨） */
  onExportCameraTrackVideo?: () => void;
  onClose: () => void;
}

const TRACK_ROW_H = 36;
const RULER_H = 22;
const TRACK_LABEL_W = 188;

function formatTime(t: number): string {
  return t.toFixed(2);
}

function snapTime(t: number, snap: number, duration: number): number {
  const s = Math.max(0.01, snap);
  const snapped = Math.round(t / s) * s;
  return Math.min(duration, Math.max(0, Number(snapped.toFixed(4))));
}

function trackKindMeta(kind: DirectorAnimTrack["kind"]) {
  if (kind === "camera") {
    return {
      label: "机位",
      Icon: Video,
      tone: "text-amber-200/90 bg-amber-400/15",
    };
  }
  if (kind === "character") {
    return {
      label: "角色",
      Icon: PersonStanding,
      tone: "text-indigo-200/90 bg-indigo-400/15",
    };
  }
  return {
    label: "造具",
    Icon: Box,
    tone: "text-emerald-200/90 bg-emerald-400/15",
  };
}

function ToolDivider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" aria-hidden />;
}

export function DirectorTimelinePanel({
  timeline,
  objects: _objects,
  playhead,
  playing,
  selectedTrackId,
  drawingTrackId,
  drawingTool = null,
  selectedObjectId,
  canUndo = false,
  canRedo = false,
  onPlayheadChange,
  onTogglePlay,
  onStop,
  onToggleLoop,
  onToggleAutoKeyframe,
  onDurationChange,
  onPanelHeightChange,
  onZoomChange,
  onSelectTrack,
  onCreateTrack,
  onStartDrawPath,
  onClearPath,
  onApplyCameraPreset,
  onDeleteKeyframe,
  onMoveKeyframe,
  onUndo,
  onRedo,
  onExportVideo,
  onExportCameraTrackVideo,
  onClose,
}: DirectorTimelinePanelProps) {
  const selectedIsCameraTrack = useMemo(
    () =>
      timeline.tracks.some(
        (t) => t.id === selectedTrackId && t.kind === "camera" && !t.muted
      ),
    [timeline.tracks, selectedTrackId]
  );
  const zoom = timeline.ui?.zoomPxPerSec ?? 48;
  const duration = Math.max(0.5, timeline.duration);
  /** 时间尺至少铺到 15s（可视范围）；真正可播时长仍以 duration 为准 */
  const rulerDuration = Math.max(duration, 15);
  const widthPx = Math.max(400, rulerDuration * zoom);
  const panelHeight = timeline.ui?.panelHeight ?? 140;
  const snapSec = timeline.ui?.snapSec ?? 0.1;
  const autoKeyframe = !!timeline.ui?.autoKeyframe;
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null);
  const lanesScrollRef = useRef<HTMLDivElement | null>(null);

  const canCreateTrack = useMemo(() => {
    if (!selectedObjectId) return false;
    return !timeline.tracks.some((t) => t.targetId === selectedObjectId);
  }, [selectedObjectId, timeline.tracks]);

  const seekFromClientX = useCallback(
    (clientX: number, el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      const t = snapTime((clientX - rect.left) / zoom, snapSec, duration);
      onPlayheadChange(t);
    },
    [zoom, snapSec, duration, onPlayheadChange]
  );

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDrag.current = { startY: e.clientY, startH: panelHeight };
    },
    [panelHeight]
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeDrag.current) return;
      const dy = resizeDrag.current.startY - e.clientY;
      const next = Math.min(360, Math.max(100, resizeDrag.current.startH + dy));
      onPanelHeightChange(next);
    },
    [onPanelHeightChange]
  );

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    resizeDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div
      className="pointer-events-auto relative flex w-full flex-col border-t border-white/[0.08] bg-[#16161f] text-white shadow-[0_-18px_48px_rgba(0,0,0,0.28)]"
      style={{ height: panelHeight }}
      data-practice-anchor="director.timeline.panel"
    >
      {/* 顶边拖拽改高度 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整时间轴高度"
        title="拖拽调整高度"
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize hover:bg-indigo-400/35"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />

      {/* ── 工具栏：播放 | 开关 | 时间 | 编辑 | 收起 ── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-2.5 pb-1.5 pt-2.5">
        <div className="flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5">
          <button
            type="button"
            title={playing ? "暂停（空格）" : "播放（空格）"}
            onClick={onTogglePlay}
            className="flex size-7 items-center justify-center rounded-md bg-indigo-500/30 text-indigo-50 hover:bg-indigo-500/45"
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            title="停止"
            onClick={onStop}
            className="flex size-7 items-center justify-center rounded-md text-white/55 hover:bg-white/10 hover:text-white/80"
          >
            <Square className="h-3 w-3" />
          </button>
        </div>

        <ToolDivider />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="循环播放"
            aria-pressed={timeline.loop}
            onClick={onToggleLoop}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] ${
              timeline.loop
                ? "bg-indigo-500/30 text-indigo-100"
                : "text-white/45 hover:bg-white/8 hover:text-white/70"
            }`}
          >
            <Repeat className="h-3 w-3" />
            循环
          </button>
          <button
            type="button"
            title={
              autoKeyframe
                ? "自动帧已开：拖拽对象松手后在播放头写入关键帧"
                : "自动帧已关：打开后拖拽变换结束会写入关键帧"
            }
            aria-pressed={autoKeyframe}
            onClick={onToggleAutoKeyframe}
            className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] ${
              autoKeyframe
                ? "bg-amber-500/30 text-amber-100"
                : "text-white/45 hover:bg-white/8 hover:text-white/70"
            }`}
          >
            <Sparkles className="h-3 w-3" />
            自动帧
          </button>
        </div>

        <ToolDivider />

        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
          <input
            type="number"
            step={0.1}
            min={0}
            max={duration}
            value={Number(playhead.toFixed(2))}
            onChange={(e) => onPlayheadChange(parseFloat(e.target.value) || 0)}
            className="w-12 bg-transparent px-0.5 py-0.5 text-right text-indigo-100 outline-none"
            aria-label="播放头位置"
            title="播放头（秒）"
          />
          <span className="text-white/25">/</span>
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={60}
            value={Number(duration.toFixed(2))}
            onChange={(e) =>
              onDurationChange(
                Math.min(60, Math.max(0.5, parseFloat(e.target.value) || 10))
              )
            }
            className="w-12 bg-transparent px-0.5 py-0.5 text-right outline-none"
            aria-label="总时长"
            title="时长（秒）"
          />
          <span className="text-white/30">s</span>
        </div>

        <label
          className="flex items-center gap-1.5 text-[10px] text-white/40"
          title="时间尺缩放（[ / ]）"
        >
          <span className="hidden sm:inline">缩放</span>
          <input
            type="range"
            min={24}
            max={120}
            step={4}
            value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value) || 48)}
            className="w-16 accent-indigo-400"
            aria-label="时间尺缩放"
          />
        </label>

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            title="撤销（Ctrl+Z）"
            disabled={!canUndo || !onUndo}
            onClick={onUndo}
            className="flex size-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white/80 disabled:opacity-30"
            aria-label="撤销"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="重做（Ctrl+Shift+Z）"
            disabled={!canRedo || !onRedo}
            onClick={onRedo}
            className="flex size-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white/80 disabled:opacity-30"
            aria-label="重做"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={
              selectedIsCameraTrack
                ? "导出选中摄像机轨的镜头运动录像（全员按时轴动）"
                : "请先在左侧选中一条摄像机轨道"
            }
            disabled={!onExportCameraTrackVideo || !selectedIsCameraTrack}
            onClick={onExportCameraTrackVideo}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] disabled:opacity-30 ${
              selectedIsCameraTrack
                ? "bg-amber-500/30 text-amber-50 hover:bg-amber-500/40"
                : "bg-white/5 text-white/35"
            }`}
          >
            <Video className="h-3 w-3" />
            导机位
          </button>
          <button
            type="button"
            title="导出预演视频到画布素材（当前主视口/默认预演视角）"
            disabled={!onExportVideo}
            onClick={onExportVideo}
            className="flex items-center gap-1 rounded-md bg-indigo-500/25 px-2 py-1 text-[10px] text-indigo-100 hover:bg-indigo-500/35 disabled:opacity-30"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
          <ToolDivider />
          <button
            type="button"
            onClick={onClose}
            title="收起时间轴"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-white/40 hover:bg-white/10 hover:text-white/70"
          >
            <PanelBottomClose className="h-3.5 w-3.5" />
            收起
          </button>
        </div>
      </div>

      {/* ── 主体：轨名列 + 时间尺/泳道（统一竖向滚动） ── */}
      <div
        ref={lanesScrollRef}
        className="tiny-scrollbar min-h-0 flex-1 overflow-auto"
      >
        <div className="flex min-h-full min-w-0">
          {/* 左：轨列表 */}
          <div
            className="sticky left-0 z-[4] flex shrink-0 flex-col border-r border-white/[0.08] bg-[#16161f]"
            style={{ width: TRACK_LABEL_W }}
          >
            <div
              className="sticky top-0 z-[5] flex items-center border-b border-white/[0.08] bg-[#1c1c28] px-2.5 text-[10px] font-medium tracking-wide text-white/35"
              style={{ height: RULER_H }}
            >
              轨道
            </div>
            {timeline.tracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={selectedTrackId === track.id}
                drawing={drawingTrackId === track.id}
                onSelect={() => onSelectTrack(track.id)}
                onDraw={(tool) => onStartDrawPath(track.id, tool)}
                onClearPath={() => onClearPath(track.id)}
                onApplyCameraPreset={(preset) =>
                  onApplyCameraPreset(track.id, preset)
                }
              />
            ))}
            <button
              type="button"
              disabled={!canCreateTrack}
              title={
                canCreateTrack
                  ? "为当前选中对象新建轨道"
                  : selectedObjectId
                    ? "当前对象已有轨道"
                    : "选中角色、道具或摄像机后建立轨道"
              }
              onClick={onCreateTrack}
              className="mx-2 my-1.5 flex items-center justify-center gap-1 rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-[10px] text-indigo-300/80 hover:border-indigo-400/30 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Plus className="h-3 w-3" />
              新建轨道
            </button>
            {timeline.tracks.length === 0 ? (
              <p className="px-2.5 py-2 text-[10px] leading-relaxed text-white/35">
                打开时间轴会自动创建主机位。选中角色 / 造具 / 机位后点「新建轨道」。
              </p>
            ) : null}
          </div>

          {/* 右：时间尺 + 泳道 */}
          <div className="relative min-w-0 flex-1">
            <div className="relative" style={{ width: widthPx, minHeight: "100%" }}>
              {/* 时间尺：仅在此层拖播放头，避免盖住关键帧 */}
              <div
                className="sticky top-0 z-[3] border-b border-white/[0.08] bg-[#1c1c28]"
                style={{ height: RULER_H }}
                role="slider"
                tabIndex={0}
                aria-label="动画时间轴播放头"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={Number(playhead.toFixed(2))}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  seekFromClientX(e.clientX, e.currentTarget);
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  seekFromClientX(e.clientX, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? snapSec * 5 : snapSec;
                  if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    onPlayheadChange(
                      snapTime(playhead - step, snapSec, duration)
                    );
                  } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    onPlayheadChange(
                      snapTime(playhead + step, snapSec, duration)
                    );
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    onPlayheadChange(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    onPlayheadChange(duration);
                  }
                }}
              >
                {Array.from({ length: Math.floor(rulerDuration) + 1 }, (_, i) => (
                  <span
                    key={i}
                    className={`pointer-events-none absolute top-1 text-[9px] tabular-nums ${
                      i > duration ? "text-white/15" : "text-white/40"
                    }`}
                    style={{ left: i * zoom + 2 }}
                  >
                    {i}s
                  </span>
                ))}
                {/* 播放头把手 */}
                <div
                  className="pointer-events-none absolute top-0 z-[1] flex -translate-x-1/2 flex-col items-center"
                  style={{
                    left: Math.min(playhead, rulerDuration) * zoom,
                    height: RULER_H,
                  }}
                  aria-hidden
                >
                  <span className="mt-0.5 h-2 w-2 rotate-45 rounded-[1px] bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.55)]" />
                </div>
              </div>

              {timeline.tracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  duration={duration}
                  zoom={zoom}
                  snapSec={snapSec}
                  selected={selectedTrackId === track.id}
                  onSelect={() => onSelectTrack(track.id)}
                  onDeleteKeyframe={(kfId) => onDeleteKeyframe(track.id, kfId)}
                  onMoveKeyframe={(kfId, time) =>
                    onMoveKeyframe(track.id, kfId, time)
                  }
                  onSeek={onPlayheadChange}
                />
              ))}

              {/* 贯穿泳道的播放头竖线 */}
              <div
                className="pointer-events-none absolute bottom-0 z-[2] w-px bg-indigo-400/90"
                style={{
                  left: Math.min(playhead, rulerDuration) * zoom,
                  top: RULER_H,
                }}
                aria-hidden
              />
            </div>
          </div>
        </div>
      </div>

      {drawingTrackId ? (
        <div className="shrink-0 border-t border-amber-500/25 bg-amber-500/[0.08] px-3 py-1.5 text-[10px] text-amber-100/90">
          {motionPathDrawBanner(drawingTool ?? "pen")}
        </div>
      ) : null}
    </div>
  );
}

function TrackHeader({
  track,
  selected,
  drawing,
  onSelect,
  onDraw,
  onClearPath,
  onApplyCameraPreset,
}: {
  track: DirectorAnimTrack;
  selected: boolean;
  drawing: boolean;
  onSelect: () => void;
  onDraw: (tool?: MotionPathDrawTool) => void;
  onClearPath: () => void;
  onApplyCameraPreset: (preset: CameraMotionPresetId) => void;
}) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [pathMenuOpen, setPathMenuOpen] = useState(false);
  const [pathMenuPos, setPathMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const pathBtnRef = useRef<HTMLButtonElement | null>(null);
  const hasPath = !!track.motionPathId;
  const kind = trackKindMeta(track.kind);
  const KindIcon = kind.Icon;

  useEffect(() => {
    if (!pathMenuOpen) return;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node | null;
      if (pathBtnRef.current?.contains(t)) return;
      const pop = document.querySelector(
        `[data-motion-binding-popover-id="${CSS.escape(track.targetId)}"]`
      );
      if (pop?.contains(t)) return;
      setPathMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pathMenuOpen, track.targetId]);

  return (
    <div
      className={`group flex items-center gap-1 border-b border-white/[0.05] px-1.5 ${
        selected ? "bg-indigo-500/15" : "hover:bg-white/[0.04]"
      }`}
      style={{ height: TRACK_ROW_H }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={track.locked ? `${track.name}（已锁定）` : track.name}
      >
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-md ${kind.tone}`}
          title={kind.label}
        >
          <KindIcon className="h-3 w-3" />
        </span>
        <span className="min-w-0 truncate text-[11px] text-white/85">
          {track.name}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
        {track.kind === "camera" ? (
          <div className="relative">
            <button
              type="button"
              title="运镜预设"
              disabled={track.locked}
              onClick={() => setPresetOpen((v) => !v)}
              className="flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[9px] text-white/50 hover:bg-white/10 hover:text-white/75 disabled:opacity-35"
            >
              运镜
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {presetOpen ? (
              <div className="absolute bottom-full right-0 z-20 mb-1 min-w-[120px] rounded-lg border border-white/10 bg-[rgba(16,16,26,0.98)] py-1 shadow-xl">
                {CAMERA_MOTION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.hint}
                    className="block w-full px-2.5 py-1 text-left text-[10px] text-white/75 hover:bg-white/10"
                    onClick={() => {
                      onApplyCameraPreset(p.id);
                      setPresetOpen(false);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {hasPath ? (
          <button
            type="button"
            title="清除路径（保留关键帧）"
            disabled={track.locked}
            onClick={onClearPath}
            className="flex size-6 items-center justify-center rounded-md text-white/35 hover:bg-white/10 hover:text-red-200/80 disabled:opacity-35"
          >
            <Eraser className="h-3 w-3" />
          </button>
        ) : null}

        <button
          ref={pathBtnRef}
          type="button"
          title={
            track.locked
              ? "轨道已锁定"
              : "绘制轨迹：圆环 / 直线 / 矩形 / 铅笔 / 钢笔"
          }
          disabled={track.locked}
          onClick={() => {
            setPresetOpen(false);
            setPathMenuOpen((open) => {
              const next = !open;
              if (next && pathBtnRef.current) {
                const r = pathBtnRef.current.getBoundingClientRect();
                setPathMenuPos({ left: r.left, top: r.top });
              } else {
                setPathMenuPos(null);
              }
              return next;
            });
          }}
          className={`flex size-6 items-center justify-center rounded-md disabled:opacity-35 ${
            drawing
              ? "bg-amber-500/35 text-amber-100"
              : hasPath
                ? "bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30"
                : "text-white/45 hover:bg-white/10 hover:text-white/75"
          }`}
        >
          <Route className="h-3 w-3" />
        </button>
      </div>

      {pathMenuOpen && pathMenuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              data-motion-binding-popover-id={track.targetId}
              role="menu"
              aria-label="绘制轨迹"
              className="fixed z-[1700] w-[168px] overflow-hidden rounded-lg border border-white/[0.08] bg-[#252525]/[0.98] p-1 text-white shadow-[0_8px_24px_rgba(0,0,0,0.36)] backdrop-blur-[16px]"
              style={{
                left: pathMenuPos.left,
                top: pathMenuPos.top,
                transform: "translateY(-100%)",
              }}
            >
              {hasPath ? (
                <p className="px-2.5 py-1 text-[9px] text-white/35">
                  选工具将重绘；钢笔可从末端延伸
                </p>
              ) : null}
              {MOTION_PATH_DRAW_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  title={t.hint}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/10"
                  onClick={() => {
                    onDraw(t.id);
                    setPathMenuOpen(false);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function TrackLane({
  track,
  duration,
  zoom,
  snapSec,
  selected,
  onSelect,
  onDeleteKeyframe,
  onMoveKeyframe,
  onSeek,
}: {
  track: DirectorAnimTrack;
  duration: number;
  zoom: number;
  snapSec: number;
  selected: boolean;
  onSelect: () => void;
  onDeleteKeyframe: (id: string) => void;
  onMoveKeyframe: (id: string, time: number) => void;
  onSeek: (t: number) => void;
}) {
  const pathSpan =
    track.motionPathId != null
      ? {
          start: (track.motionPathStart ?? 0) * duration,
          end: (track.motionPathEnd ?? 1) * duration,
        }
      : null;
  const empty = track.keyframes.length === 0 && !track.motionPathId;
  const dragRef = useRef<{
    id: string;
    startX: number;
    startTime: number;
    moved: boolean;
  } | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={laneRef}
      className={`relative border-b border-white/[0.05] ${
        selected ? "bg-indigo-500/[0.07]" : "hover:bg-white/[0.02]"
      }`}
      style={{ height: TRACK_ROW_H }}
      onClick={onSelect}
      onPointerDown={(e) => {
        // 空白处单击定位播放头（关键帧按钮会 stopPropagation）
        if (e.button !== 0) return;
        if (
          e.target !== e.currentTarget &&
          (e.target as HTMLElement).closest("button")
        ) {
          return;
        }
        const el = laneRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const t = snapTime((e.clientX - rect.left) / zoom, snapSec, duration);
        onSeek(t);
      }}
    >
      {pathSpan ? (
        <div
          className="pointer-events-none absolute top-2 h-5 rounded-md bg-indigo-500/30 ring-1 ring-indigo-400/20"
          style={{
            left: pathSpan.start * zoom,
            width: Math.max(4, (pathSpan.end - pathSpan.start) * zoom),
          }}
          title="运动路径"
        />
      ) : (
        <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-white/[0.08]" />
      )}
      {empty ? (
        <p className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 truncate text-[9px] text-white/25">
          绘制轨迹，或打开自动帧后移动对象
        </p>
      ) : null}
      {track.keyframes.map((kf) => (
        <button
          key={kf.id}
          type="button"
          title={`${formatTime(kf.time)}s · 拖拽改时 · 右键删除`}
          className="absolute top-1/2 z-[5] size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-indigo-200/80 bg-indigo-400 shadow touch-none hover:scale-110"
          style={{ left: kf.time * zoom }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
              id: kf.id,
              startX: e.clientX,
              startTime: kf.time,
              moved: false,
            };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || d.id !== kf.id) return;
            e.stopPropagation();
            const dx = e.clientX - d.startX;
            if (Math.abs(dx) > 2) d.moved = true;
            if (!d.moved) return;
            let t = snapTime(d.startTime + dx / zoom, snapSec, duration);
            for (const other of track.keyframes) {
              if (other.id === kf.id) continue;
              if (Math.abs(other.time - t) < snapSec * 0.5) {
                t =
                  other.time >= t ? other.time - snapSec : other.time + snapSec;
                t = Math.min(duration, Math.max(0, t));
              }
            }
            onMoveKeyframe(kf.id, t);
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            dragRef.current = null;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            e.stopPropagation();
            if (!d?.moved) onSeek(kf.time);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDeleteKeyframe(kf.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              onDeleteKeyframe(kf.id);
            }
          }}
        />
      ))}
    </div>
  );
}

export { formatTime };
