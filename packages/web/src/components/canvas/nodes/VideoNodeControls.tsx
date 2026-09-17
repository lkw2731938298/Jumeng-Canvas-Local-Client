"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVideoTime } from "@/lib/canvas/captureVideoLastFrame";
import { clampTrimRange, MIN_VIDEO_TRIM_SEC } from "@/lib/canvas/videoTrim";
import { useCanvasStore } from "@/stores/canvasStore";

interface VideoNodeControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  visible: boolean;
  framePickActive?: boolean;
  /** 内联剪辑模式：双柄选入/出点 */
  trimActive?: boolean;
  nodeId?: string;
  frameRate?: number;
  /** 用户点击播放/暂停时回调（true=播放，false=暂停），用于节点保持暂停帧 */
  onUserPlaybackChange?: (playing: boolean) => void;
}

type ScrubTarget = "playhead" | "in" | "out";

export function VideoNodeControls({
  videoRef,
  src,
  visible,
  framePickActive = false,
  trimActive = false,
  nodeId,
  frameRate = 24,
  onUserPlaybackChange,
}: VideoNodeControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const seekingRef = useRef(false);
  const scrubTargetRef = useRef<ScrubTarget>("playhead");
  const trackRef = useRef<HTMLDivElement>(null);
  const setFramePickTime = useCanvasStore((s) => s.setFramePickTime);
  const inlineVideoTrim = useCanvasStore((s) => s.inlineVideoTrim);
  const patchInlineVideoTrim = useCanvasStore((s) => s.patchInlineVideoTrim);

  const frameStep = 1 / Math.max(1, frameRate);
  const fineStep = 0.1;
  const trimForNode =
    inlineVideoTrim && inlineVideoTrim.nodeId === nodeId ? inlineVideoTrim : null;
  const trimIn = trimForNode?.inSec ?? 0;
  const trimOut =
    trimForNode?.outSec ?? (duration > 0 ? duration : MIN_VIDEO_TRIM_SEC);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!seekingRef.current) {
        setCurrentTime(video.currentTime);
        if (framePickActive) setFramePickTime(video.currentTime);
        // 剪辑模式：播到出点自动暂停
        if (trimActive && !video.paused && video.currentTime >= trimOut - 0.02) {
          video.pause();
          video.currentTime = Math.max(trimIn, Math.min(trimOut, video.currentTime));
          onUserPlaybackChange?.(false);
        }
      }
    };
    const onLoadedMetadata = () => {
      const d = video.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      setCurrentTime(video.currentTime);
      // 截取模式：src 切到 stream 时 currentTime 会归零，勿把选帧时刻写回 store
      if (framePickActive) return;
    };
    const onSeeked = () => {
      if (seekingRef.current) return;
      setCurrentTime(video.currentTime);
      if (framePickActive) setFramePickTime(video.currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      if (!framePickActive && !trimActive) setCurrentTime(0);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);

    setPlaying(!video.paused);
    const d0 = video.duration;
    setDuration(Number.isFinite(d0) && d0 > 0 ? d0 : 0);
    setCurrentTime(video.currentTime);
    setVolume(video.muted ? 0 : video.volume);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
    };
  }, [
    videoRef,
    src,
    framePickActive,
    trimActive,
    trimIn,
    trimOut,
    setFramePickTime,
    onUserPlaybackChange,
  ]);

  // src 切换后偶发拿不到 duration：短轮询直到就绪，避免进度条一直 disabled
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration);
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) {
        setDuration(d);
        window.clearInterval(id);
      } else if (tries >= 40) {
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [videoRef, src, framePickActive, trimActive]);

  // 剪辑模式：片长就绪后把出点默认拉满（若仍是占位最短段）
  useEffect(() => {
    if (!trimActive || !nodeId || duration <= 0) return;
    const state = useCanvasStore.getState().inlineVideoTrim;
    if (!state || state.nodeId !== nodeId) return;
    const looksDefault =
      state.inSec <= 0.001 &&
      state.outSec <= MIN_VIDEO_TRIM_SEC + 0.05 &&
      duration > MIN_VIDEO_TRIM_SEC + 0.05;
    if (looksDefault || state.outSec > duration + 0.05) {
      const range = clampTrimRange(state.inSec, Math.min(state.outSec, duration) || duration, duration);
      if (
        Math.abs(range.inSec - state.inSec) > 0.001 ||
        Math.abs(range.outSec - state.outSec) > 0.001
      ) {
        patchInlineVideoTrim(range);
      }
    }
  }, [trimActive, nodeId, duration, patchInlineVideoTrim]);

  const stopBubble = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const seek = useCallback(
    (value: number, options?: { syncPickTime?: boolean }) => {
      const video = videoRef.current;
      if (!video) return;
      const max =
        (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration) || 0;
      let next = Math.max(0, Math.min(value, max > 0 ? max - 0.001 : value));
      // 剪辑预览：播放头限制在入出点内
      if (trimActive) {
        next = Math.max(trimIn, Math.min(next, Math.max(trimIn, trimOut - 0.001)));
      }
      video.currentTime = next;
      setCurrentTime(next);
      if (framePickActive && options?.syncPickTime !== false) {
        setFramePickTime(next);
      }
    },
    [videoRef, duration, framePickActive, setFramePickTime, trimActive, trimIn, trimOut]
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (trimActive) {
        // 区间外或已到出点：从入点起播
        if (video.currentTime < trimIn || video.currentTime >= trimOut - 0.02) {
          video.currentTime = trimIn;
          setCurrentTime(trimIn);
        }
      }
      onUserPlaybackChange?.(true);
      void video.play().catch(() => {});
    } else {
      onUserPlaybackChange?.(false);
      video.pause();
    }
  }, [videoRef, onUserPlaybackChange, trimActive, trimIn, trimOut]);

  const finalizeScrub = useCallback(
    (finalValue?: number) => {
      const video = videoRef.current;
      if (!video) return;
      const max =
        (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration) || 0;
      const requested = Number.isFinite(finalValue) ? Number(finalValue) : video.currentTime;
      let actual = Math.max(0, Math.min(requested, max > 0 ? max - 0.001 : requested));
      if (trimActive && scrubTargetRef.current === "playhead") {
        actual = Math.max(trimIn, Math.min(actual, Math.max(trimIn, trimOut - 0.001)));
      }
      video.currentTime = actual;
      setCurrentTime(actual);
      if (framePickActive) {
        setFramePickTime(actual);
        return;
      }
      video.pause();
      onUserPlaybackChange?.(false);
    },
    [
      videoRef,
      duration,
      framePickActive,
      setFramePickTime,
      onUserPlaybackChange,
      trimActive,
      trimIn,
      trimOut,
    ]
  );

  const nudge = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      seek(video.currentTime + delta);
    },
    [seek, videoRef]
  );

  const applyTrimFromRatio = useCallback(
    (ratio: number, target: ScrubTarget) => {
      if (duration <= 0 || !trimActive) return currentTime;
      const t = Math.max(0, Math.min(1, ratio)) * duration;
      if (target === "in") {
        const range = clampTrimRange(t, trimOut, duration);
        patchInlineVideoTrim(range);
        seek(range.inSec);
        return range.inSec;
      }
      if (target === "out") {
        const range = clampTrimRange(trimIn, t, duration);
        patchInlineVideoTrim(range);
        seek(Math.max(range.inSec, range.outSec - 0.001));
        return range.outSec;
      }
      seek(t);
      return t;
    },
    [duration, trimActive, currentTime, trimIn, trimOut, patchInlineVideoTrim, seek]
  );

  const seekFromClientX = useCallback(
    (clientX: number, target: ScrubTarget = "playhead") => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || duration <= 0) return currentTime;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (trimActive && target !== "playhead") {
        return applyTrimFromRatio(ratio, target);
      }
      const next = ratio * duration;
      seek(next);
      return next;
    },
    [duration, currentTime, seek, trimActive, applyTrimFromRatio]
  );

  const setVideoVolume = useCallback(
    (next: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(1, next));
      video.volume = clamped;
      video.muted = clamped === 0;
      setVolume(clamped);
    },
    [videoRef]
  );

  useEffect(() => {
    if ((!framePickActive && !trimActive) || !nodeId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // 剪辑：I/O 设入出点
      if (trimActive) {
        if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          const range = clampTrimRange(currentTime, trimOut, duration);
          patchInlineVideoTrim(range);
          return;
        }
        if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          const range = clampTrimRange(trimIn, currentTime, duration);
          patchInlineVideoTrim(range);
          return;
        }
      }

      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? fineStep : frameStep;
      nudge(e.key === "ArrowLeft" ? -step : step);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    framePickActive,
    trimActive,
    nodeId,
    nudge,
    frameStep,
    fineStep,
    currentTime,
    trimIn,
    trimOut,
    duration,
    patchInlineVideoTrim,
  ]);

  const volumeRangeClass =
    "nodrag nopan h-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-red-500 [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white";
  const progressPercent =
    duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const inPercent = duration > 0 ? Math.max(0, Math.min(100, (trimIn / duration) * 100)) : 0;
  const outPercent = duration > 0 ? Math.max(0, Math.min(100, (trimOut / duration) * 100)) : 100;

  const beginTrackPointer = (
    e: ReactPointerEvent<HTMLElement>,
    target: ScrubTarget
  ) => {
    if (duration <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    // 统一挂到轨道上，避免手柄自身 rect 导致定位错误
    trackRef.current?.setPointerCapture(e.pointerId);
    seekingRef.current = true;
    scrubTargetRef.current = target;
    const video = videoRef.current;
    if (video) {
      if (!framePickActive) {
        onUserPlaybackChange?.(false);
      }
      if (!video.paused) video.pause();
    }
    seekFromClientX(e.clientX, target);
  };

  return (
    <div
      className={cn(
        "nodrag nopan absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-1.5 pt-5 transition-opacity duration-150",
        visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      )}
      onClick={stopBubble}
      onPointerDown={stopBubble}
    >
      {framePickActive || trimActive ? (
        <div className="mb-1 flex items-center justify-center gap-1 text-[9px] text-white/45">
          <button
            type="button"
            className="nodrag nopan flex h-5 w-5 items-center justify-center rounded text-white/70 hover:bg-white/10"
            onClick={() => nudge(-frameStep)}
            title="上一帧 (←)"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="tabular-nums">{formatVideoTime(currentTime)}</span>
          <button
            type="button"
            className="nodrag nopan flex h-5 w-5 items-center justify-center rounded text-white/70 hover:bg-white/10"
            onClick={() => nudge(frameStep)}
            title="下一帧 (→)"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          <span className="text-white/30">·</span>
          <span>
            {trimActive
              ? "拖柄选区 · I/O 入出点 · ←/→ 逐帧"
              : "←/→ 逐帧 · Shift 微调 0.1s"}
          </span>
        </div>
      ) : null}

      <div
        ref={trackRef}
        role="slider"
        tabIndex={duration > 0 ? 0 : -1}
        aria-label={trimActive ? "视频切段时间轴" : "视频播放进度"}
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={Math.min(currentTime, duration || 0)}
        className={cn(
          "nodrag nopan relative mb-1.5 flex h-4 w-full touch-none items-center",
          duration > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-40"
        )}
        onPointerDown={(e) => beginTrackPointer(e, "playhead")}
        onPointerMove={(e) => {
          if (!seekingRef.current) return;
          seekFromClientX(e.clientX, scrubTargetRef.current);
        }}
        onPointerUp={(e) => {
          if (!seekingRef.current) return;
          const finalValue = seekFromClientX(e.clientX, scrubTargetRef.current);
          seekingRef.current = false;
          if (trackRef.current?.hasPointerCapture(e.pointerId)) {
            trackRef.current.releasePointerCapture(e.pointerId);
          }
          finalizeScrub(finalValue);
        }}
        onPointerCancel={(e) => {
          if (!seekingRef.current) return;
          const finalValue = seekFromClientX(e.clientX, scrubTargetRef.current);
          seekingRef.current = false;
          finalizeScrub(finalValue);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const delta = e.key === "ArrowLeft" ? -1 : 1;
          seek(currentTime + delta);
          if (!framePickActive) onUserPlaybackChange?.(false);
        }}
      >
        <span className="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-white/20" />
        {trimActive ? (
          <>
            {/* 选中区间高亮 */}
            <span
              className="pointer-events-none absolute h-1 rounded-full bg-red-500/80"
              style={{
                left: `${inPercent}%`,
                width: `${Math.max(0, outPercent - inPercent)}%`,
              }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-white shadow"
              style={{ left: `${progressPercent}%` }}
            />
            {/* 入点柄 */}
            <button
              type="button"
              aria-label="入点"
              title="入点"
              className="nodrag nopan absolute z-[1] h-4 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow ring-1 ring-black/30"
              style={{ left: `${inPercent}%` }}
              onPointerDown={(e) => beginTrackPointer(e, "in")}
            />
            {/* 出点柄 */}
            <button
              type="button"
              aria-label="出点"
              title="出点"
              className="nodrag nopan absolute z-[1] h-4 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow ring-1 ring-black/30"
              style={{ left: `${outPercent}%` }}
              onPointerDown={(e) => beginTrackPointer(e, "out")}
            />
          </>
        ) : (
          <>
            <span
              className="pointer-events-none absolute left-0 h-1 rounded-full bg-red-500"
              style={{ width: `${progressPercent}%` }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-white shadow"
              style={{ left: `${progressPercent}%` }}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10"
          onClick={togglePlay}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>

        <span className="min-w-0 shrink text-[9px] tabular-nums text-white/55">
          {trimActive
            ? `${formatVideoTime(trimIn)} – ${formatVideoTime(trimOut)}`
            : `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`}
        </span>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button
            type="button"
            className="nodrag nopan flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10"
            onClick={() => setVideoVolume(volume > 0 ? 0 : 0.8)}
            aria-label={volume > 0 ? "静音" : "取消静音"}
          >
            {volume > 0 ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            className={cn(volumeRangeClass, "w-14")}
            onChange={(e) => setVideoVolume(Number(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
