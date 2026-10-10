"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Pause, Play, Plus, Square, ChevronDown } from "lucide-react";
import type {
  DirectorAnimTrack,
  DirectorAnimationTimeline,
  DirectorObject,
} from "@jumeng-canvas/shared";
import {
  CAMERA_MOTION_PRESETS,
  type CameraMotionPresetId,
} from "@/lib/director/animation/cameraPresets";

export interface DirectorTimelinePanelProps {
  timeline: DirectorAnimationTimeline;
  objects: DirectorObject[];
  playhead: number;
  playing: boolean;
  selectedTrackId: string | null;
  drawingTrackId: string | null;
  selectedObjectId: string | null;
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
  onStartDrawPath: (trackId: string) => void;
  onClearPath: (trackId: string) => void;
  onApplyCameraPreset: (trackId: string, preset: CameraMotionPresetId) => void;
  onDeleteKeyframe: (trackId: string, keyframeId: string) => void;
  onMoveKeyframe: (trackId: string, keyframeId: string, time: number) => void;
  onClose: () => void;
}

function formatTime(t: number): string {
  return t.toFixed(2);
}

function snapTime(t: number, snap: number, duration: number): number {
  const s = Math.max(0.01, snap);
  const snapped = Math.round(t / s) * s;
  return Math.min(duration, Math.max(0, Number(snapped.toFixed(4))));
}

export function DirectorTimelinePanel({
  timeline,
  objects,
  playhead,
  playing,
  selectedTrackId,
  drawingTrackId,
  selectedObjectId,
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
  onClose,
}: DirectorTimelinePanelProps) {
  const zoom = timeline.ui?.zoomPxPerSec ?? 48;
  const duration = Math.max(0.5, timeline.duration);
  const widthPx = Math.max(400, duration * zoom);
  const panelHeight = timeline.ui?.panelHeight ?? 140;
  const snapSec = timeline.ui?.snapSec ?? 0.1;
  const autoKeyframe = !!timeline.ui?.autoKeyframe;
  const resizeDrag = useRef<{ startY: number; startH: number } | null>(null);

  const canCreateTrack = useMemo(() => {
    if (!selectedObjectId) return false;
    return !timeline.tracks.some((t) => t.targetId === selectedObjectId);
  }, [selectedObjectId, timeline.tracks]);

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
      className="pointer-events-auto relative flex w-full flex-col border-t border-white/10 bg-[#1f1f1f] text-white shadow-[0_-18px_48px_rgba(0,0,0,0.24)]"
      style={{ height: panelHeight }}
      data-practice-anchor="director.timeline.panel"
    >
      {/* 顶边拖拽改高度 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整时间轴高度"
        title="拖拽调整高度"
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize hover:bg-indigo-400/40"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />

      {/* Transport */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5 pt-2.5">
        <button
          type="button"
          title={playing ? "暂停（空格）" : "播放（空格）"}
          onClick={onTogglePlay}
          className="flex size-7 items-center justify-center rounded-md bg-white/10 hover:bg-white/15"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          title="停止"
          onClick={onStop}
          className="flex size-7 items-center justify-center rounded-md bg-white/5 hover:bg-white/10"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="循环播放"
          aria-pressed={timeline.loop}
          onClick={onToggleLoop}
          className={`rounded-md px-2 py-1 text-[10px] ${
            timeline.loop ? "bg-indigo-500/30 text-indigo-100" : "bg-white/5 text-white/50"
          }`}
        >
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
          className={`rounded-md px-2 py-1 text-[10px] ${
            autoKeyframe ? "bg-amber-500/30 text-amber-100" : "bg-white/5 text-white/50"
          }`}
        >
          自动帧
        </button>
        <label className="flex items-center gap-1 text-[10px] text-white/45">
          <span>播放头</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={duration}
            value={Number(playhead.toFixed(2))}
            onChange={(e) => onPlayheadChange(parseFloat(e.target.value) || 0)}
            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-white/80"
            aria-label="播放头位置"
          />
        </label>
        <span className="text-[10px] text-white/30">/</span>
        <label className="flex items-center gap-1 text-[10px] text-white/45">
          <span>时长</span>
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={60}
            value={Number(duration.toFixed(2))}
            onChange={(e) =>
              onDurationChange(Math.min(60, Math.max(0.5, parseFloat(e.target.value) || 10)))
            }
            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-white/80"
            aria-label="总时长"
          />
          <span>s</span>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-white/45" title="时间尺缩放（[ / ]）">
          <span>缩放</span>
          <input
            type="range"
            min={24}
            max={120}
            step={4}
            value={zoom}
            onChange={(e) => onZoomChange(parseFloat(e.target.value) || 48)}
            className="w-20"
            aria-label="时间尺缩放"
          />
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[10px] text-white/45 hover:bg-white/10 hover:text-white/70"
        >
          收起
        </button>
      </div>

      {/* Tracks */}
      <div className="tiny-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full min-w-0 gap-[2px]">
          <div className="flex w-44 shrink-0 flex-col border-r border-white/10">
            {timeline.tracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={selectedTrackId === track.id}
                drawing={drawingTrackId === track.id}
                onSelect={() => onSelectTrack(track.id)}
                onDraw={() => onStartDrawPath(track.id)}
                onClearPath={() => onClearPath(track.id)}
                onApplyCameraPreset={(preset) => onApplyCameraPreset(track.id, preset)}
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
              className="flex items-center gap-1 px-2 py-2 text-[10px] text-indigo-300/80 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Plus className="h-3 w-3" />
              新建轨道
            </button>
            {timeline.tracks.length === 0 ? (
              <p className="px-2 py-3 text-[10px] leading-relaxed text-white/35">
                打开时间轴会自动创建主机位。选中角色后点「新建轨道」再「绘制轨迹」，或打开自动帧后移动对象。
              </p>
            ) : null}
          </div>

          <div className="relative min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width: widthPx, minHeight: "100%" }}>
              <div className="sticky top-0 z-[1] h-5 border-b border-white/10 bg-[#252525]">
                {Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
                  <span
                    key={i}
                    className="absolute top-0.5 text-[9px] text-white/30"
                    style={{ left: i * zoom + 2 }}
                  >
                    {i}s
                  </span>
                ))}
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
                  onMoveKeyframe={(kfId, time) => onMoveKeyframe(track.id, kfId, time)}
                  onSeek={onPlayheadChange}
                />
              ))}

              <div
                className="pointer-events-none absolute bottom-0 top-0 z-[2] w-px bg-indigo-400"
                style={{ left: playhead * zoom }}
                aria-hidden
              />
              <input
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={playhead}
                aria-label="动画时间轴播放头"
                onChange={(e) => onPlayheadChange(parseFloat(e.target.value))}
                className="absolute inset-x-0 bottom-0 z-[3] h-full cursor-ew-resize opacity-0"
                style={{ width: widthPx }}
              />
            </div>
          </div>
        </div>
      </div>

      {drawingTrackId ? (
        <div className="shrink-0 border-t border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] text-amber-100">
          绘制中 · 在地面单击加点 · Enter/双击完成 · Esc 取消 · ⌫ 撤点
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
  onDraw: () => void;
  onClearPath: () => void;
  onApplyCameraPreset: (preset: CameraMotionPresetId) => void;
}) {
  const [presetOpen, setPresetOpen] = useState(false);
  const hasPath = !!track.motionPathId;

  return (
    <div
      className={`flex h-9 items-center gap-0.5 border-b border-white/5 px-1 ${
        selected ? "bg-white/8" : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate text-left text-[11px] text-white/80"
        title={track.locked ? `${track.name}（已锁定）` : track.name}
      >
        {track.name}
      </button>
      {track.kind === "camera" ? (
        <div className="relative shrink-0">
          <button
            type="button"
            title="运镜预设"
            disabled={track.locked}
            onClick={() => setPresetOpen((v) => !v)}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-white/55 hover:bg-white/10 disabled:opacity-35"
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
          className="shrink-0 rounded px-1 py-0.5 text-[9px] text-white/40 hover:bg-white/10 hover:text-white/70 disabled:opacity-35"
        >
          清路径
        </button>
      ) : null}
      <button
        type="button"
        title={
          track.locked
            ? "轨道已锁定"
            : hasPath
              ? "延伸轨迹：从末端继续加点"
              : "绘制轨迹：地面单击加点"
        }
        disabled={track.locked}
        onClick={onDraw}
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] disabled:opacity-35 ${
          drawing ? "bg-amber-500/30 text-amber-100" : "bg-white/5 text-white/55 hover:bg-white/10"
        }`}
      >
        {hasPath ? "延伸" : "绘制轨迹"}
      </button>
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

  return (
    <div
      className={`relative h-9 border-b border-white/5 ${selected ? "bg-white/[0.04]" : ""}`}
      onClick={onSelect}
    >
      {pathSpan ? (
        <div
          className="absolute top-2 h-5 rounded-sm bg-indigo-500/25"
          style={{
            left: pathSpan.start * zoom,
            width: Math.max(4, (pathSpan.end - pathSpan.start) * zoom),
          }}
          title="运动路径"
        />
      ) : (
        <div className="pointer-events-none absolute inset-x-2 top-3 h-px border-t border-dashed border-white/10" />
      )}
      {empty ? (
        <p className="pointer-events-none absolute inset-x-3 top-2.5 truncate text-[9px] text-white/25">
          绘制轨迹，或打开自动帧后移动对象
        </p>
      ) : null}
      {track.keyframes.map((kf) => (
        <button
          key={kf.id}
          type="button"
          title={`${formatTime(kf.time)}s · 拖拽改时 · 右键删除`}
          className="absolute top-2 size-3 -translate-x-1/2 rotate-45 border border-indigo-200/80 bg-indigo-400 shadow touch-none"
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
            // 避开其他关键帧
            for (const other of track.keyframes) {
              if (other.id === kf.id) continue;
              if (Math.abs(other.time - t) < snapSec * 0.5) {
                t = other.time >= t ? other.time - snapSec : other.time + snapSec;
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
