"use client";

import { useMemo } from "react";
import { Pause, Play, Plus, Square } from "lucide-react";
import type {
  DirectorAnimTrack,
  DirectorAnimationTimeline,
  DirectorObject,
} from "@jumeng-canvas/shared";

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
  onDurationChange: (d: number) => void;
  onSelectTrack: (trackId: string | null) => void;
  onCreateTrack: () => void;
  onStartDrawPath: (trackId: string) => void;
  onDeleteKeyframe: (trackId: string, keyframeId: string) => void;
  onClose: () => void;
}

function formatTime(t: number): string {
  return t.toFixed(2);
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
  onDurationChange,
  onSelectTrack,
  onCreateTrack,
  onStartDrawPath,
  onDeleteKeyframe,
  onClose,
}: DirectorTimelinePanelProps) {
  const zoom = timeline.ui?.zoomPxPerSec ?? 48;
  const duration = Math.max(0.5, timeline.duration);
  const widthPx = Math.max(400, duration * zoom);

  const canCreateTrack = useMemo(() => {
    if (!selectedObjectId) return false;
    return !timeline.tracks.some((t) => t.targetId === selectedObjectId);
  }, [selectedObjectId, timeline.tracks]);

  return (
    <div
      className="pointer-events-auto flex w-full flex-col border-t border-white/10 bg-[#1f1f1f] text-white shadow-[0_-18px_48px_rgba(0,0,0,0.24)]"
      style={{ height: timeline.ui?.panelHeight ?? 140 }}
      data-practice-anchor="director.timeline.panel"
    >
      {/* Transport */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <button
          type="button"
          title={playing ? "暂停" : "播放"}
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
          onClick={onToggleLoop}
          className={`rounded-md px-2 py-1 text-[10px] ${
            timeline.loop ? "bg-indigo-500/30 text-indigo-100" : "bg-white/5 text-white/50"
          }`}
        >
          循环
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
            onChange={(e) => onDurationChange(Math.min(60, Math.max(0.5, parseFloat(e.target.value) || 10)))}
            className="w-14 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-white/80"
            aria-label="总时长"
          />
          <span>s</span>
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
          <div className="flex w-40 shrink-0 flex-col border-r border-white/10">
            {timeline.tracks.map((track) => (
              <TrackHeader
                key={track.id}
                track={track}
                selected={selectedTrackId === track.id}
                drawing={drawingTrackId === track.id}
                onSelect={() => onSelectTrack(track.id)}
                onDraw={() => onStartDrawPath(track.id)}
              />
            ))}
            <button
              type="button"
              disabled={!canCreateTrack}
              title={
                canCreateTrack
                  ? "为当前选中对象新建轨道"
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
                点击新建轨道，或打开时间轴时会自动创建主机位。选中角色后点「绘制轨迹」。
              </p>
            ) : null}
          </div>

          <div className="relative min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width: widthPx, minHeight: "100%" }}>
              {/* ruler */}
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
                  selected={selectedTrackId === track.id}
                  objects={objects}
                  onSelect={() => onSelectTrack(track.id)}
                  onDeleteKeyframe={(kfId) => onDeleteKeyframe(track.id, kfId)}
                  onSeek={onPlayheadChange}
                />
              ))}

              {/* playhead */}
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
}: {
  track: DirectorAnimTrack;
  selected: boolean;
  drawing: boolean;
  onSelect: () => void;
  onDraw: () => void;
}) {
  return (
    <div
      className={`flex h-9 items-center gap-1 border-b border-white/5 px-1.5 ${
        selected ? "bg-white/8" : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate text-left text-[11px] text-white/80"
      >
        {track.name}
      </button>
      <button
        type="button"
        onClick={onDraw}
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
          drawing ? "bg-amber-500/30 text-amber-100" : "bg-white/5 text-white/55 hover:bg-white/10"
        }`}
      >
        绘制轨迹
      </button>
    </div>
  );
}

function TrackLane({
  track,
  duration,
  zoom,
  selected,
  onSelect,
  onDeleteKeyframe,
  onSeek,
}: {
  track: DirectorAnimTrack;
  duration: number;
  zoom: number;
  selected: boolean;
  objects: DirectorObject[];
  onSelect: () => void;
  onDeleteKeyframe: (id: string) => void;
  onSeek: (t: number) => void;
}) {
  const pathSpan =
    track.motionPathId != null
      ? { start: (track.motionPathStart ?? 0) * duration, end: (track.motionPathEnd ?? 1) * duration }
      : null;

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
      {track.keyframes.map((kf) => (
        <button
          key={kf.id}
          type="button"
          title={`${kf.time.toFixed(2)}s · Delete 删除`}
          className="absolute top-2 size-3 -translate-x-1/2 rotate-45 border border-indigo-200/80 bg-indigo-400 shadow"
          style={{ left: kf.time * zoom }}
          onClick={(e) => {
            e.stopPropagation();
            onSeek(kf.time);
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
