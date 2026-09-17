/**
 * 画布视频工具计费：总价 = (输入参考视频秒数 + 生成视频秒数) × 每秒算力。
 * 处理类工具出片时长通常等于源片，两端按同一秒数计。
 */
import type { Node } from "@xyflow/react";
import { roundCreditAmount } from "@/lib/api/credits";

export const CANVAS_VIDEO_BILLING_TOOL_IDS = new Set([
  "hd_upscale_video",
  "video_smart_matting",
  "video_subject_remove",
  "video_subject_edit",
  "video_subject_replace",
  "video_subtitle_smart_erase",
  "video_subtitle_box_erase",
  "vocal_separate",
  "vocal_remove",
]);

const MIN_SEC = 1;
const MAX_SEC = 600;
const DEFAULT_SEC = 5;

function nodeParams(node: Node | null | undefined): Record<string, unknown> {
  if (!node) return {};
  const data = node.data as { params?: Record<string, unknown> };
  return data?.params ?? {};
}

/** 把媒体时长收成计费秒数；非法返回 null（不把生成档位 duration 当片长）。 */
export function mediaDurationToBillSeconds(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_SEC) return null;
  return Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(n)));
}

/**
 * 从视频节点估算计费秒数。
 * 优先用当前节点上视频的真实片长（HTMLVideo / 探测结果）；
 * 禁止用 params.duration（生成档位，常为 5/10/15，会让 3s 片误报成固定价）。
 */
export function resolveCanvasVideoBillSeconds(
  node: Node | null | undefined,
  liveMediaDurationSec?: number | null
): number {
  const fromLive = mediaDurationToBillSeconds(liveMediaDurationSec);
  if (fromLive != null) return fromLive;

  const params = nodeParams(node);
  // 仅认明确写入的片长，不读 params.duration / generationOptions.duration
  const fromParams = mediaDurationToBillSeconds(
    params.durationSec ?? params.duration_sec
  );
  if (fromParams != null) return fromParams;

  return DEFAULT_SEC;
}

/** 写入报价/提交的 generationOptions（输入秒 + 输出秒）。 */
export function canvasVideoToolBillingOptions(
  durationSec: number,
  overrides?: { inputSec?: number; outputSec?: number }
): Record<string, string> {
  const input =
    overrides?.inputSec != null
      ? Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(overrides.inputSec)))
      : Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(durationSec)));
  const output =
    overrides?.outputSec != null
      ? Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(overrides.outputSec)))
      : input;
  return {
    inputVideoSeconds: String(input),
    outputVideoSeconds: String(output),
  };
}

/** 估算总价：(输入+输出)×每秒；缺省两端同长。 */
export function estimateCanvasVideoToolCredits(
  creditsPerSecond: number,
  durationSec: number
): number {
  const sec = Math.max(MIN_SEC, Math.min(MAX_SEC, Math.round(durationSec)));
  return roundCreditAmount(creditsPerSecond * (sec + sec));
}

export function isCanvasVideoBillingTool(toolId: string | undefined | null): boolean {
  return Boolean(toolId && CANVAS_VIDEO_BILLING_TOOL_IDS.has(toolId));
}
