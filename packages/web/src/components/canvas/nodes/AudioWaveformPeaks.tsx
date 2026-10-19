"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

const PEAK_COUNT = 72;
const peaksCache = new Map<string, number[]>();

/** 从 AudioBuffer 下采样为对称峰段高度（0–1） */
function computePeaks(buffer: AudioBuffer, count: number): number[] {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = buffer.length;
  if (length <= 0 || count <= 0) return Array.from({ length: count }, () => 0.08);

  const merged = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      merged[i] += data[i] / channels;
    }
  }

  const block = Math.max(1, Math.floor(length / count));
  const peaks: number[] = [];
  let maxPeak = 0;
  for (let i = 0; i < count; i++) {
    const start = i * block;
    const end = Math.min(length, start + block);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(merged[j]);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
    if (peak > maxPeak) maxPeak = peak;
  }
  const norm = maxPeak > 1e-6 ? maxPeak : 1;
  return peaks.map((p) => Math.max(0.06, Math.min(1, p / norm)));
}

async function decodePeaks(src: string): Promise<number[]> {
  const cached = peaksCache.get(src);
  if (cached) return cached;

  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`fetch audio ${res.status}`);
  const ab = await res.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(ab.slice(0));
    const peaks = computePeaks(buffer, PEAK_COUNT);
    peaksCache.set(src, peaks);
    return peaks;
  } finally {
    void ctx.close().catch(() => {});
  }
}

interface AudioWaveformPeaksProps {
  src: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  playing?: boolean;
  className?: string;
}

/**
 * 音频节点主体：静态峰段波形 + 播放进度高亮。
 * 用 Web Audio 解码一次后缓存，避免每帧重算。
 */
export function AudioWaveformPeaks({
  src,
  audioRef,
  playing = false,
  className,
}: AudioWaveformPeaksProps) {
  const [peaks, setPeaks] = useState<number[]>(() => peaksCache.get(src) ?? []);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (peaksCache.has(src)) {
      setPeaks(peaksCache.get(src)!);
      return;
    }
    setPeaks([]);
    void decodePeaks(src)
      .then((p) => {
        if (!cancelled) setPeaks(p);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          // 解码失败时用轻量占位峰，避免空白卡片
          setPeaks(Array.from({ length: PEAK_COUNT }, (_, i) => 0.12 + 0.2 * Math.abs(Math.sin(i * 0.35))));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  // 跟随 audio 当前时间刷新进度（播放中用 rAF，暂停时读一次即可）
  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const d = audio.duration;
        const t = audio.currentTime;
        if (Number.isFinite(d) && d > 0) {
          setProgress(Math.max(0, Math.min(1, t / d)));
        }
      }
      if (playing) rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [audioRef, playing, src]);

  const bars = useMemo(() => peaks, [peaks]);
  const activeIndex = Math.floor(progress * Math.max(1, bars.length));

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-3 top-3 bottom-10 flex items-center",
        className
      )}
      aria-hidden
    >
      <div className="flex h-[58%] w-full items-center gap-[2px]">
        {bars.length === 0 ? (
          <div className="h-full w-full animate-pulse rounded-md bg-pink-400/10" />
        ) : (
          bars.map((h, i) => {
            const on = i <= activeIndex;
            return (
              <span
                key={i}
                className={cn(
                  "min-w-[2px] flex-1 rounded-full transition-colors duration-150",
                  on ? "bg-pink-400/90" : "bg-white/22",
                  failed && !on && "bg-white/14"
                )}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
