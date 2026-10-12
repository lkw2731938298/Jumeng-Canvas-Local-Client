"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { formatVideoTime } from "@/lib/canvas/captureVideoLastFrame";
import { clampTrimRange, MIN_AUDIO_TRIM_SEC } from "@/lib/canvas/audioTrim";
import { useCanvasStore } from "@/stores/canvasStore";
import { cn } from "@/lib/utils";

interface AudioNodeControlsProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  src: string;
  /** 节点参数音量（0–2），用于播放时同步到 audio 元素 */
  volume?: number;
  /** 内联分段：双柄选入/出点（复用 inlineVideoTrim 状态） */
  trimActive?: boolean;
  nodeId?: string;
  className?: string;
}

type ScrubTarget = "playhead" | "in" | "out";

/** 从 audio 元素读取有效片长 */
function readAudioDuration(audio: HTMLAudioElement | null, fallback = 0): number {
  if (!audio) return fallback;
  const d = audio.duration;
  return Number.isFinite(d) && d > 0 ? d : fallback;
}

/** 音频节点卡片底部进度条与时间（播放按钮在卡片中央） */
export function AudioNodeControls({
  audioRef,
  src,
  volume = 1,
  trimActive = false,
  nodeId,
  className,
}: AudioNodeControlsProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seekingRef = useRef(false);
  const scrubTargetRef = useRef<ScrubTarget>("playhead");
  const trackRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef(0);
  const inlineVideoTrim = useCanvasStore((s) => s.inlineVideoTrim);
  const patchInlineVideoTrim = useCanvasStore((s) => s.patchInlineVideoTrim);

  const trimForNode =
    inlineVideoTrim && inlineVideoTrim.nodeId === nodeId ? inlineVideoTrim : null;
  const trimIn = trimForNode?.inSec ?? 0;
  const trimOut =
    trimForNode?.outSec ?? (duration > 0 ? duration : MIN_AUDIO_TRIM_SEC);

  const syncDuration = useCallback(() => {
    const d = readAudioDuration(audioRef.current, durationRef.current);
    if (d > 0 && Math.abs(d - durationRef.current) > 0.001) {
      durationRef.current = d;
      setDuration(d);
    }
    return d;
  }, [audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!seekingRef.current) {
        setCurrentTime(audio.currentTime);
        if (trimActive && !audio.paused && audio.currentTime >= trimOut - 0.02) {
          audio.pause();
          audio.currentTime = Math.max(trimIn, Math.min(trimOut, audio.currentTime));
        }
      }
    };
    const onLoadedMetadata = () => {
      syncDuration();
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => {
      syncDuration();
    };
    const onEnded = () => {
      if (!trimActive) setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    syncDuration();
    setCurrentTime(audio.currentTime);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, src, trimActive, trimIn, trimOut, syncDuration]);

  // src 切换后偶发拿不到 duration：短轮询直到就绪
  useEffect(() => {
    syncDuration();
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      const d = syncDuration();
      if (d > 0 || tries >= 40) window.clearInterval(id);
    }, 100);
    return () => window.clearInterval(id);
  }, [audioRef, src, trimActive, syncDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    audio.volume = clamped;
  }, [audioRef, volume, src]);

  useEffect(() => {
    setCurrentTime(0);
    durationRef.current = 0;
    setDuration(0);
  }, [src]);

  // 片长就绪后把出点默认拉满
  useEffect(() => {
    if (!trimActive || !nodeId || duration <= 0) return;
    const state = useCanvasStore.getState().inlineVideoTrim;
    if (!state || state.nodeId !== nodeId) return;
    const looksDefault =
      state.inSec <= 0.001 &&
      state.outSec <= MIN_AUDIO_TRIM_SEC + 0.05 &&
      duration > MIN_AUDIO_TRIM_SEC + 0.05;
    if (looksDefault || state.outSec > duration + 0.05) {
      const range = clampTrimRange(
        state.inSec,
        Math.min(state.outSec, duration) || duration,
        duration
      );
      if (
        Math.abs(range.inSec - state.inSec) > 0.001 ||
        Math.abs(range.outSec - state.outSec) > 0.001
      ) {
        patchInlineVideoTrim(range);
      }
    }
  }, [trimActive, nodeId, duration, patchInlineVideoTrim]);

  const seek = useCallback(
    (value: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const max = readAudioDuration(audio, durationRef.current);
      let next = Math.max(0, Math.min(value, max > 0 ? max - 0.001 : value));
      if (trimActive) {
        const out = trimOut > trimIn ? trimOut : max || trimIn + MIN_AUDIO_TRIM_SEC;
        next = Math.max(trimIn, Math.min(next, Math.max(trimIn, out - 0.001)));
      }
      try {
        audio.currentTime = next;
      } catch {
        /* ignore seek errors while metadata loading */
      }
      setCurrentTime(next);
    },
    [audioRef, trimActive, trimIn, trimOut]
  );

  const applyTrimFromRatio = useCallback(
    (ratio: number, target: ScrubTarget, dur: number) => {
      if (dur <= 0 || !trimActive) return currentTime;
      const t = Math.max(0, Math.min(1, ratio)) * dur;
      if (target === "in") {
        const range = clampTrimRange(t, trimOut, dur);
        patchInlineVideoTrim(range);
        seek(range.inSec);
        return range.inSec;
      }
      if (target === "out") {
        const range = clampTrimRange(trimIn, t, dur);
        patchInlineVideoTrim(range);
        seek(Math.max(range.inSec, range.outSec - 0.001));
        return range.outSec;
      }
      seek(t);
      return t;
    },
    [trimActive, currentTime, trimIn, trimOut, patchInlineVideoTrim, seek]
  );

  const seekFromClientX = useCallback(
    (clientX: number, target: ScrubTarget = "playhead") => {
      const rect = trackRef.current?.getBoundingClientRect();
      const dur = syncDuration();
      if (!rect || rect.width <= 0 || dur <= 0) return currentTime;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (trimActive && target !== "playhead") {
        return applyTrimFromRatio(ratio, target, dur);
      }
      const next = ratio * dur;
      seek(next);
      return next;
    },
    [currentTime, seek, trimActive, applyTrimFromRatio, syncDuration]
  );

  useEffect(() => {
    if (!trimActive || !nodeId) return;
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
      const dur = syncDuration();
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        patchInlineVideoTrim(clampTrimRange(currentTime, trimOut, dur));
        return;
      }
      if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        patchInlineVideoTrim(clampTrimRange(trimIn, currentTime, dur));
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.05;
      seek(currentTime + (e.key === "ArrowLeft" ? -step : step));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    trimActive,
    nodeId,
    currentTime,
    trimIn,
    trimOut,
    patchInlineVideoTrim,
    seek,
    syncDuration,
  ]);

  const beginTrackPointer = (
    e: ReactPointerEvent<HTMLElement>,
    target: ScrubTarget
  ) => {
    const dur = syncDuration();
    if (dur <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    // 挂到轨道上，避免手柄自身 rect 导致定位错误；并阻止 React Flow 拖节点
    trackRef.current?.setPointerCapture(e.pointerId);
    seekingRef.current = true;
    scrubTargetRef.current = target;
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    seekFromClientX(e.clientX, target);
  };

  const progressPercent =
    duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const inPercent = duration > 0 ? Math.max(0, Math.min(100, (trimIn / duration) * 100)) : 0;
  const outPercent = duration > 0 ? Math.max(0, Math.min(100, (trimOut / duration) * 100)) : 100;

  return (
    <div
      className={cn(
        // nodrag/nopan：分段拖柄必须禁止画布拖节点，否则进度条看起来「拖不动」
        "nodrag nopan pointer-events-auto absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-2 pb-1.5 pt-5",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {trimActive ? (
        <div className="mb-1 text-center text-[9px] text-white/45">
          拖柄选区 · I/O 入出点 · ←/→ 微调
        </div>
      ) : null}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={duration > 0 ? 0 : -1}
        aria-label={trimActive ? "音频分段时间轴" : "音频播放进度"}
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={Math.min(currentTime, duration || 0)}
        className={cn(
          "nodrag nopan relative mb-1 flex h-4 w-full touch-none items-center",
          duration > 0 ? "cursor-pointer" : "cursor-not-allowed opacity-40"
        )}
        onPointerDown={(e) => beginTrackPointer(e, "playhead")}
        onPointerMove={(e) => {
          if (!seekingRef.current) return;
          seekFromClientX(e.clientX, scrubTargetRef.current);
        }}
        onPointerUp={(e) => {
          if (!seekingRef.current) return;
          seekFromClientX(e.clientX, scrubTargetRef.current);
          seekingRef.current = false;
          if (trackRef.current?.hasPointerCapture(e.pointerId)) {
            trackRef.current.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (!seekingRef.current) return;
          seekingRef.current = false;
          if (trackRef.current?.hasPointerCapture(e.pointerId)) {
            trackRef.current.releasePointerCapture(e.pointerId);
          }
        }}
      >
        <span className="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-white/20" />
        {trimActive ? (
          <>
            <span
              className="pointer-events-none absolute h-1 rounded-full bg-pink-400/85"
              style={{
                left: `${inPercent}%`,
                width: `${Math.max(0, outPercent - inPercent)}%`,
              }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-white shadow"
              style={{ left: `${progressPercent}%` }}
            />
            <button
              type="button"
              aria-label="入点"
              title="入点"
              className="nodrag nopan absolute z-[1] h-4 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow ring-1 ring-black/30"
              style={{ left: `${inPercent}%` }}
              onPointerDown={(e) => beginTrackPointer(e, "in")}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              aria-label="出点"
              title="出点"
              className="nodrag nopan absolute z-[1] h-4 w-2.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-white shadow ring-1 ring-black/30"
              style={{ left: `${outPercent}%` }}
              onPointerDown={(e) => beginTrackPointer(e, "out")}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </>
        ) : (
          <>
            <span
              className="pointer-events-none absolute left-0 h-1 rounded-full bg-pink-400"
              style={{ width: `${progressPercent}%` }}
            />
            <span
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-white shadow"
              style={{ left: `${progressPercent}%` }}
            />
          </>
        )}
      </div>
      <span className="block text-center text-[9px] tabular-nums text-white/55">
        {trimActive
          ? `${formatVideoTime(trimIn)} – ${formatVideoTime(trimOut)}`
          : `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`}
      </span>
    </div>
  );
}
