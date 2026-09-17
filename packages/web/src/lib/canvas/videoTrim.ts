/** 视频节点内联剪辑：入/出点状态与导出 API */

import { apiFetch } from "@/lib/api/client";
import { notifyAssetsUpdated, type Asset } from "@/lib/api/assets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";

/** 最短片段（秒），与后端 MIN_USER_TRIM_DURATION_SEC 对齐 */
export const MIN_VIDEO_TRIM_SEC = 0.3;

export interface InlineVideoTrimState {
  nodeId: string;
  inSec: number;
  outSec: number;
}

export interface VideoTrimResult {
  asset: Asset;
  inSec: number;
  outSec: number;
  durationSec: number;
  sourceAssetId: string;
}

function normalizeTrimAsset(raw: Record<string, unknown>): Asset {
  const fileUrl = ensureHttpsOssUrl(String(raw.fileUrl ?? raw.file_url ?? ""));
  const thumbnailUrl = ensureHttpsOssUrl(
    String(raw.thumbnailUrl ?? raw.thumbnail_url ?? fileUrl)
  );
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    title: String(raw.title ?? ""),
    category: "video",
    subcategory: (raw.subcategory as string | null) ?? "剪辑",
    ossKey: String(raw.ossKey ?? raw.oss_key ?? ""),
    fileUrl,
    thumbnailUrl: thumbnailUrl || fileUrl,
    fileType: String(raw.fileType ?? raw.file_type ?? "video/mp4"),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

export interface VideoComposeClipInput {
  videoAssetId: string;
  inSec: number;
  outSec: number;
  /** 合成时间轴起点；缺省则按旧逻辑首尾相接 */
  startSec?: number;
  /** 0=底轨 …；缺省为 0 */
  trackIndex?: number;
  padBeforeSec?: number;
  padAfterSec?: number;
}

export interface VideoComposeAudioInput {
  audioAssetId: string;
  inSec: number;
  outSec: number;
  startSec: number;
  padBeforeSec?: number;
  padAfterSec?: number;
  trackIndex?: number;
}

export interface VideoComposeResult {
  asset: Asset;
  durationSec: number;
  clipCount: number;
}

/** 完整剪辑：多轨压平 + 空隙黑场 + concat；优先异步轮询进度 */
export async function composeVideoAssets(params: {
  projectId: string;
  clips: VideoComposeClipInput[];
  audioClips?: VideoComposeAudioInput[];
  title?: string;
  /** 进度回调：0–100 + 文案（异步模式） */
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}): Promise<VideoComposeResult> {
  if (!params.clips.length) {
    throw new Error("至少需要 1 个片段");
  }
  const body = JSON.stringify({
    projectId: params.projectId,
    clips: params.clips.map((c) => ({
      videoAssetId: c.videoAssetId,
      inSec: c.inSec,
      outSec: c.outSec,
      ...(c.startSec != null ? { startSec: c.startSec } : {}),
      ...(c.trackIndex != null ? { trackIndex: c.trackIndex } : {}),
      ...(c.padBeforeSec != null ? { padBeforeSec: c.padBeforeSec } : {}),
      ...(c.padAfterSec != null ? { padAfterSec: c.padAfterSec } : {}),
    })),
    ...(params.audioClips?.length
      ? {
          audioClips: params.audioClips.map((a) => ({
            audioAssetId: a.audioAssetId,
            inSec: a.inSec,
            outSec: a.outSec,
            startSec: a.startSec,
            padBeforeSec: a.padBeforeSec ?? 0,
            padAfterSec: a.padAfterSec ?? 0,
            trackIndex: a.trackIndex ?? 0,
          })),
        }
      : {}),
    title: params.title,
  });

  const started = await apiFetch<{
    taskId?: string;
    status?: string;
    mode?: string;
    progress?: number;
    message?: string;
    asset?: Record<string, unknown>;
    durationSec?: number;
    clipCount?: number;
  }>("/api/v1/assets/video-compose", {
    method: "POST",
    body,
    signal: params.signal,
  });

  const finishFromPayload = (payload: {
    asset?: Record<string, unknown>;
    durationSec?: number;
    clipCount?: number;
  }): VideoComposeResult => {
    const asset = normalizeTrimAsset(payload.asset ?? {});
    if (!asset.id || !asset.fileUrl) {
      throw new Error("拼接结果无效");
    }
    notifyAssetsUpdated();
    params.onProgress?.(100, "拼接完成");
    return {
      asset,
      durationSec: Number(payload.durationSec) || 0,
      clipCount: Number(payload.clipCount) || params.clips.length,
    };
  };

  // 同步降级或已完成
  if (
    started.mode === "sync_fallback" ||
    started.status === "succeeded" ||
    (started.asset && !started.taskId)
  ) {
    return finishFromPayload(started);
  }

  const taskId = String(started.taskId || "").trim();
  if (!taskId) {
    throw new Error("未返回拼接任务 ID");
  }

  params.onProgress?.(Number(started.progress) || 0, started.message || "排队中…");

  const startedAt = Date.now();
  const maxWaitMs = 30 * 60 * 1000; // 最长等 30 分钟
  let delayMs = 800;

  while (Date.now() - startedAt < maxWaitMs) {
    if (params.signal?.aborted) {
      throw new Error("已取消导出");
    }
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(2500, Math.round(delayMs * 1.15));

    const st = await apiFetch<{
      taskId?: string;
      status?: string;
      progress?: number;
      message?: string;
      error?: string;
      asset?: Record<string, unknown>;
      durationSec?: number;
      clipCount?: number;
    }>(`/api/v1/assets/video-compose/${encodeURIComponent(taskId)}`, {
      signal: params.signal,
    });

    const progress = Number(st.progress) || 0;
    const message = String(st.message || st.error || "");
    params.onProgress?.(progress, message);

    const status = String(st.status || "");
    if (status === "succeeded") {
      return finishFromPayload(st);
    }
    if (status === "failed") {
      throw new Error(message || "拼接失败");
    }
  }

  throw new Error("拼接超时，请稍后在素材库查看或重试");
}

/** 调用后端 ffmpeg 切段，返回新视频素材 */
export async function trimVideoAsset(params: {
  projectId: string;
  videoAssetId: string;
  inSec: number;
  outSec: number;
  title?: string;
}): Promise<VideoTrimResult> {
  const inSec = Math.max(0, params.inSec);
  const outSec = params.outSec;
  if (!(outSec - inSec >= MIN_VIDEO_TRIM_SEC)) {
    throw new Error(`片段至少 ${MIN_VIDEO_TRIM_SEC} 秒`);
  }

  const content = await apiFetch<{
    asset: Record<string, unknown>;
    inSec: number;
    outSec: number;
    durationSec: number;
    sourceAssetId: string;
  }>("/api/v1/assets/video-trim", {
    method: "POST",
    body: JSON.stringify({
      projectId: params.projectId,
      videoAssetId: params.videoAssetId,
      inSec,
      outSec,
      title: params.title,
    }),
  });

  const asset = normalizeTrimAsset(content.asset ?? {});
  if (!asset.id || !asset.fileUrl) {
    throw new Error("剪辑结果无效");
  }
  notifyAssetsUpdated();
  return {
    asset,
    inSec: Number(content.inSec) || inSec,
    outSec: Number(content.outSec) || outSec,
    durationSec: Number(content.durationSec) || Math.max(0, outSec - inSec),
    sourceAssetId: String(content.sourceAssetId || params.videoAssetId),
  };
}

/** 钳制入/出点，保证最短时长与不超过片长 */
export function clampTrimRange(
  inSec: number,
  outSec: number,
  durationSec: number
): { inSec: number; outSec: number } {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  if (dur <= 0) {
    return { inSec: Math.max(0, inSec), outSec: Math.max(inSec + MIN_VIDEO_TRIM_SEC, outSec) };
  }
  let nextIn = Math.max(0, Math.min(inSec, Math.max(0, dur - MIN_VIDEO_TRIM_SEC)));
  let nextOut = Math.max(nextIn + MIN_VIDEO_TRIM_SEC, Math.min(outSec, dur));
  if (nextOut - nextIn < MIN_VIDEO_TRIM_SEC) {
    nextOut = Math.min(dur, nextIn + MIN_VIDEO_TRIM_SEC);
    nextIn = Math.max(0, nextOut - MIN_VIDEO_TRIM_SEC);
  }
  return { inSec: nextIn, outSec: nextOut };
}
