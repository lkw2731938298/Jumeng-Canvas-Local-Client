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
import { cn } from "@/lib/utils";

interface AudioNodeControlsProps {
  audioRef: RefObject<HTMLAudioElement | null>;
  src: string;
  /** 节点参数音量（0–2），用于播放时同步到 audio 元素 */
  volume?: number;
  className?: string;
}

/** 音频节点卡片底部进度条与时间（播放按钮在卡片中央） */
export function AudioNodeControls({
  audioRef,
  src,
  volume = 1,
  className,
}: AudioNodeControlsProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seekingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      const d = audio.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => setCurrentTime(0);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    if (audio.readyState >= 1) {
      const d = audio.duration;
      setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      setCurrentTime(audio.currentTime);
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioRef, src]);

  // 同步节点参数音量到播放器（上限 1，HTMLAudio 不支持 >1）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(1, Number(volume) || 0));
    audio.volume = clamped;
  }, [audioRef, volume, src]);

  // src 变更时复位进度展示
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const seekToClientX = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const track = trackRef.current;
      if (!audio || !track || !(duration > 0)) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const next = ratio * duration;
      audio.currentTime = next;
      setCurrentTime(next);
    },
    [audioRef, duration]
  );

  const onTrackPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      seekingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seekToClientX(e.clientX);
    },
    [seekToClientX]
  );

  const onTrackPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!seekingRef.current) return;
      seekToClientX(e.clientX);
    },
    [seekToClientX]
  );

  const onTrackPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-2 pb-1.5 pt-5",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={trackRef}
        className="nodrag nopan relative mb-1 flex h-3 cursor-pointer items-center"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={onTrackPointerUp}
        onPointerCancel={onTrackPointerUp}
      >
        <span className="pointer-events-none absolute inset-x-0 h-1 rounded-full bg-white/20" />
        <span
          className="pointer-events-none absolute left-0 h-1 rounded-full bg-pink-400"
          style={{ width: `${progressPercent}%` }}
        />
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 rounded-full bg-white shadow"
          style={{ left: `${progressPercent}%` }}
        />
      </div>
      <span className="block text-center text-[9px] tabular-nums text-white/55">
        {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
      </span>
    </div>
  );
}
