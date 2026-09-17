"use client";

/**
 * 独立「成片表」节点：仅爆款拉片复刻 / 一键出海批量成片时创建。
 * 数据读来源分镜表 shots（outputVideoAssetId / clipAssetId / 提示词），不重复权威状态。
 */

import { memo, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { BaseNode } from "./BaseNode";
import { useCanvasStore } from "@/stores/canvasStore";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { resolveLocalMediaUrl } from "@/lib/canvas/resolveNodeMedia";
import { NODE_TITLE_HEIGHT } from "@/lib/canvas/nodeSizing";
import {
  isStoryboardGenActive,
  STORYBOARD_CELL_GENERATING_OVERLAY_CLASS,
} from "@/lib/canvas/storyboardGeneratingUi";
import {
  computeShotsTimeline,
  formatTimecodeShort,
  formatTimelineDuration,
  parseTableRowsParam,
  type StoryboardSketchStatus,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";

const MIN_SCROLL = 160;

function MediaThumb({
  kind,
  url,
  label,
  status,
  error,
  tall,
}: {
  kind: "video" | "image";
  url: string;
  label: string;
  status?: StoryboardSketchStatus;
  error?: string;
  tall?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const generating = isStoryboardGenActive(status);
  const h = tall ? "h-[140px]" : "h-[88px]";

  /** 指针悬浮预览播放；离开暂停并回到片头（静音，避免浏览器拦自动播放） */
  const playPreview = () => {
    const el = videoRef.current;
    if (!el) return;
    void el.play().catch(() => {
      /* 忽略自动播放被拒 */
    });
  };
  const stopPreview = () => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    try {
      el.currentTime = 0;
    } catch {
      /* seek 未就绪时忽略 */
    }
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[9px] text-white/40">{label}</span>
        <div
          className={`relative flex ${h} w-full items-center justify-center overflow-hidden rounded-lg border bg-white/[0.03] ${
            generating
              ? "border-sky-400/60 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
              : "border-white/10"
          }`}
        >
          {generating ? (
            <div className={STORYBOARD_CELL_GENERATING_OVERLAY_CLASS}>
              <Loader2 className="h-4 w-4 animate-spin text-sky-200" />
              <span className="text-[8px] text-sky-100">生成中</span>
            </div>
          ) : url ? (
            <button
              type="button"
              className="h-full w-full"
              onClick={(e) => {
                e.stopPropagation();
                stopPreview();
                setOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerEnter={() => {
                if (kind === "video") playPreview();
              }}
              onPointerLeave={() => {
                if (kind === "video") stopPreview();
              }}
              aria-label={`查看${label}`}
            >
              {kind === "video" ? (
                <video
                  ref={videoRef}
                  src={url}
                  className="h-full w-full object-cover"
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="h-full w-full object-cover" />
              )}
            </button>
          ) : status === "failed" ? (
            <span className="px-2 text-center text-[9px] text-red-300/85" title={error || "失败"}>
              {error || "失败"}
            </span>
          ) : (
            <span className="text-[9px] text-white/25">暂无</span>
          )}
        </div>
      </div>
      {open && url ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {kind === "video" ? (
            <video
              src={url}
              className="max-h-[85vh] max-w-[90vw] rounded-lg border border-white/15 shadow-2xl"
              controls
              autoPlay
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              className="max-h-[85vh] max-w-[90vw] rounded-lg border border-white/15 object-contain shadow-2xl"
            />
          )}
        </div>
      ) : null}
    </>
  );
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="min-w-0">
      <div className="mb-0.5 text-[9px] font-medium text-white/40">{title}</div>
      <p className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-white/70">
        {text.trim()}
      </p>
    </div>
  );
}

function FinishedClipCard({
  row,
  outputUrl,
  clipUrl,
  sketchUrl,
  timeRangeLabel,
}: {
  row: StoryboardTableRow;
  outputUrl: string;
  clipUrl: string;
  sketchUrl: string;
  /** 该镜在整条时间线中的起止时刻（随任意一镜时长/顺序变化自动重排） */
  timeRangeLabel?: string;
}) {
  const videoStatus: StoryboardSketchStatus =
    row.videoStatus ?? (row.outputVideoAssetId ? "succeeded" : "idle");

  return (
    <article className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <strong className="text-[11px] font-medium text-white/85">
          镜头 {row.shotNo || row.index}
        </strong>
        <span className="text-[9px] text-white/35">
          {timeRangeLabel ? `${timeRangeLabel} · ` : ""}
          {row.duration?.trim() || "—"}
          {videoStatus === "succeeded"
            ? " · 已完成"
            : videoStatus === "failed"
              ? " · 失败"
              : isStoryboardGenActive(videoStatus)
                ? " · 生成中"
                : " · 待生成"}
        </span>
      </header>

      <MediaThumb
        kind="video"
        url={outputUrl}
        label="成片"
        status={videoStatus}
        error={row.videoError}
        tall
      />

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <MediaThumb kind="video" url={clipUrl} label="参考片段" />
        <MediaThumb kind="image" url={sketchUrl} label="参考草图" />
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5 border-t border-white/[0.06] pt-2">
        <PromptBlock title="运镜提示词" text={row.cameraPrompt || ""} />
        <PromptBlock title="视频提示词" text={row.videoPrompt || ""} />
        <PromptBlock title="替换指令" text={row.replaceCue || ""} />
        <PromptBlock title="画面描述" text={row.description || ""} />
        {!row.cameraPrompt?.trim() &&
        !row.videoPrompt?.trim() &&
        !row.replaceCue?.trim() &&
        !row.description?.trim() ? (
          <p className="text-[9px] text-white/30">暂无提示词，可在分镜表中编辑</p>
        ) : null}
      </div>
    </article>
  );
}

export const FinishedClipsGridNode = memo(function FinishedClipsGridNode(props: NodeProps) {
  const nodeId = props.id;
  const data = props.data as WorkflowNodeData;
  const projectId = useCanvasStore((s) => s.projectId);
  const sourceGridNodeId = String(
    useCanvasStore(
      useShallow((s) => s.nodes.find((n) => n.id === nodeId)?.data?.params?.sourceGridNodeId ?? "")
    ) || ""
  );
  const shotsParam = useCanvasStore(
    useShallow((s) => {
      const sid = String(
        s.nodes.find((n) => n.id === nodeId)?.data?.params?.sourceGridNodeId ?? ""
      );
      if (!sid) return undefined;
      return s.nodes.find((n) => n.id === sid)?.data?.params?.shots;
    })
  );
  const rows = useMemo(() => parseTableRowsParam(shotsParam), [shotsParam]);
  const { lookupMap } = useProjectAssetManifest(projectId || "");

  const mediaUrls = useMemo(() => {
    const manifestLookup = (id: string) => lookupMap?.get(id);
    const output = new Map<string, string>();
    const clip = new Map<string, string>();
    const sketch = new Map<string, string>();
    for (const row of rows) {
      if (row.outputVideoAssetId) {
        const u = resolveLocalMediaUrl({ assetId: row.outputVideoAssetId }, "videoUrl", manifestLookup);
        if (u) output.set(row.id, u);
      }
      if (row.clipAssetId) {
        const u = resolveLocalMediaUrl({ assetId: row.clipAssetId }, "videoUrl", manifestLookup);
        if (u) clip.set(row.id, u);
      }
      if (row.sketchAssetId) {
        const u = resolveLocalMediaUrl({ assetId: row.sketchAssetId }, "imageUrl", manifestLookup);
        if (u) sketch.set(row.id, u);
      }
    }
    return { output, clip, sketch };
  }, [rows, lookupMap]);

  const scrollHeight = useMemo(() => {
    const nodeHeight = props.height && props.height > 0 ? props.height : 480;
    return Math.max(MIN_SCROLL, nodeHeight - NODE_TITLE_HEIGHT - 28);
  }, [props.height]);

  // 整条时间线汇总：任意一镜（时长/生成状态）变化后，这里都会重新算出新的总时长与
  // 各镜起止时刻——即「改单镜后自动 reflow 整条时间线」，不需要额外手动重新汇总。
  const timeline = useMemo(() => computeShotsTimeline(rows), [rows]);
  const timeRangeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const seg of timeline.segments) {
      map.set(seg.id, `${formatTimecodeShort(seg.startSec)}–${formatTimecodeShort(seg.endSec)}`);
    }
    return map;
  }, [timeline]);

  const doneCount = timeline.readyCount;
  const runningCount = rows.filter((r) => isStoryboardGenActive(r.videoStatus)).length;
  const status = (data.status ?? "idle") as WorkflowNodeData["status"];

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Film"
      color="#0ea5e9"
      status={status}
      bodyFlush
      unboundedResize
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-1">
          <span className="rounded px-2 py-0.5 text-[10px] bg-sky-500/20 text-sky-200">成片表</span>
          <span className="ml-auto text-[10px] text-white/30">
            {!sourceGridNodeId
              ? "未绑定分镜表"
              : rows.length > 0
                ? `${doneCount}/${rows.length} 完成${runningCount > 0 ? ` · ${runningCount} 生成中` : ""} · 共计约 ${formatTimelineDuration(timeline.totalSec)}`
                : "等待批量成片"}
          </span>
        </div>
        {!sourceGridNodeId ? (
          <div className="flex items-center justify-center px-4 py-8 text-center text-[11px] text-white/28">
            未绑定来源分镜表（仅爆款/出海成片流程会创建本表）
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-center text-[11px] leading-relaxed text-white/28">
            分镜表尚无镜头行。
            <br />
            拉片并确认生成后，成片会出现在此。
          </div>
        ) : (
          <div
            className="nowheel overflow-auto px-2 pb-2 pt-1"
            style={{ maxHeight: scrollHeight, minHeight: 120 }}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {rows.map((row) => (
                <FinishedClipCard
                  key={row.id}
                  row={row}
                  outputUrl={mediaUrls.output.get(row.id) ?? ""}
                  clipUrl={mediaUrls.clip.get(row.id) ?? ""}
                  sketchUrl={mediaUrls.sketch.get(row.id) ?? ""}
                  timeRangeLabel={timeRangeById.get(row.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </BaseNode>
  );
});
