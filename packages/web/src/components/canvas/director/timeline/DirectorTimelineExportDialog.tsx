"use client";

/**
 * 导出动画预演到画布：确认时长 / fps / 分辨率后开始编码。
 */

import { useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

export type TimelineExportConfirm = {
  fps: 30 | 60;
  durationSec: number;
};

export function DirectorTimelineExportDialog({
  open,
  durationSec,
  defaultFps,
  aspectLabel,
  sizeLabel,
  exporting,
  progress,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  durationSec: number;
  defaultFps: 30 | 60;
  aspectLabel: string;
  sizeLabel: string;
  exporting: boolean;
  progress: number;
  onConfirm: (opts: TimelineExportConfirm) => void;
  onCancel: () => void;
}) {
  const [fps, setFps] = useState<30 | 60>(defaultFps);
  const clampedDuration = useMemo(
    () => Math.min(60, Math.max(0.5, durationSec)),
    [durationSec]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4">
      <div
        role="dialog"
        aria-modal
        aria-label="导出动画预演"
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161f] p-4 text-white shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">导出视频到画布</h2>
          <button
            type="button"
            disabled={exporting}
            onClick={onCancel}
            className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-white/50">
          将按当前时间轴逐帧预演并编码为 WebM，写入本项目素材库（不重新扣费）。
        </p>
        <dl className="mb-3 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 text-[11px]">
          <dt className="text-white/40">时长</dt>
          <dd>{clampedDuration.toFixed(1)}s（硬顶 60s）</dd>
          <dt className="text-white/40">画幅</dt>
          <dd>
            {aspectLabel} · {sizeLabel}
          </dd>
          <dt className="text-white/40">帧率</dt>
          <dd>
            <select
              value={fps}
              disabled={exporting}
              onChange={(e) => setFps(Number(e.target.value) === 60 ? 60 : 30)}
              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5"
              aria-label="导出帧率"
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </dd>
        </dl>
        {exporting ? (
          <div className="mb-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-indigo-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              导出中… {Math.round(progress * 100)}%
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-indigo-400 transition-[width] duration-150"
                style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
              />
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[11px] text-white/55 hover:bg-white/10"
          >
            {exporting ? "取消导出" : "取消"}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => onConfirm({ fps, durationSec: clampedDuration })}
            className="rounded-lg bg-indigo-500/80 px-3 py-1.5 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            开始导出
          </button>
        </div>
      </div>
    </div>
  );
}
