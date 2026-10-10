/** 视频节点内联剪辑：入/出点状态与导出 API */

import { apiFetch } from "@/lib/api/client";
import { notifyAssetsUpdated, uploadAsset, type Asset } from "@/lib/api/assets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import { isLocalDesktop } from "@/lib/localDesktop";
import { withBasePath } from "@/lib/basePath";

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

/** 无 ffmpeg 时：浏览器 captureStream + MediaRecorder 兜底切段 */
async function trimVideoInBrowser(
  sourceUrl: string,
  inSec: number,
  outSec: number
): Promise<File> {
  const href = sourceUrl.startsWith("/") ? withBasePath(sourceUrl) : sourceUrl;
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = href;

  await new Promise<void>((resolve, reject) => {
    const onMeta = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("无法加载源视频用于切段"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onErr);
    void video.load();
  });

  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = Math.max(0, inSec);
    } catch (err) {
      video.removeEventListener("seeked", onSeeked);
      reject(err instanceof Error ? err : new Error("定位入点失败"));
    }
  });

  const capture = (
    video as HTMLVideoElement & { captureStream?: (fps?: number) => MediaStream }
  ).captureStream;
  if (typeof capture !== "function") {
    throw new Error("当前环境不支持浏览器切段，请安装 ffmpeg 并加入 PATH 后重试");
  }
  const stream = capture.call(video, 30);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () =>
      resolve(new Blob(chunks, { type: mime || "video/webm" }));
    recorder.onerror = () => reject(new Error("浏览器录制切段失败"));
  });

  recorder.start(250);
  try {
    await video.play();
  } catch {
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("无法播放源视频进行切段");
  }

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (video.ended || video.currentTime >= outSec - 0.04) {
        video.pause();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });

  if (recorder.state !== "inactive") recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const blob = await stopped;
  if (!blob.size) throw new Error("切段结果为空");
  const ext = blob.type.includes("webm") ? "webm" : "mp4";
  return new File([blob], `trim-${Date.now()}.${ext}`, {
    type: blob.type || `video/${ext}`,
  });
}

/** 本机桌面：优先 /api/local/video-trim（ffmpeg）；失败则浏览器兜底 */
async function trimVideoAssetLocal(params: {
  projectId: string;
  videoAssetId: string;
  inSec: number;
  outSec: number;
  title?: string;
  sourceUrl?: string;
}): Promise<VideoTrimResult> {
  const res = await fetch(withBasePath("/api/local/video-trim"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: params.projectId,
      videoAssetId: params.videoAssetId,
      inSec: params.inSec,
      outSec: params.outSec,
      title: params.title,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    content?: {
      asset?: Record<string, unknown>;
      inSec?: number;
      outSec?: number;
      durationSec?: number;
      sourceAssetId?: string;
    };
    asset?: Record<string, unknown>;
  };

  if (res.ok) {
    const content =
      body.content ??
      (body.asset
        ? {
            asset: body.asset,
            inSec: params.inSec,
            outSec: params.outSec,
            durationSec: params.outSec - params.inSec,
            sourceAssetId: params.videoAssetId,
          }
        : null);
    if (content?.asset) {
      const asset = normalizeTrimAsset(content.asset);
      if (asset.id && asset.fileUrl) {
        notifyAssetsUpdated();
        return {
          asset,
          inSec: Number(content.inSec) || params.inSec,
          outSec: Number(content.outSec) || params.outSec,
          durationSec:
            Number(content.durationSec) ||
            Math.max(0, params.outSec - params.inSec),
          sourceAssetId: String(content.sourceAssetId || params.videoAssetId),
        };
      }
    }
  }

  const serverMsg = String(body.message || "");
  // 仅在 ffmpeg 彻底不可用时才浏览器兜底（音画同步/清晰度较差）
  const needBrowser =
    Boolean(params.sourceUrl) &&
    (!res.ok || res.status >= 500) &&
    /ffmpeg|未找到|PATH|杀毒|下载/i.test(serverMsg);

  if (!needBrowser || !params.sourceUrl) {
    throw new Error(
      serverMsg ||
        (res.ok ? "剪辑结果无效" : `切段失败（${res.status}）`)
    );
  }

  const file = await trimVideoInBrowser(
    params.sourceUrl,
    params.inSec,
    params.outSec
  );
  const asset = await uploadAsset({
    file,
    projectId: params.projectId,
    category: "video",
    subcategory: "剪辑",
    title: params.title || "切段",
  });
  return {
    asset,
    inSec: params.inSec,
    outSec: params.outSec,
    durationSec: Math.max(0, params.outSec - params.inSec),
    sourceAssetId: params.videoAssetId,
  };
}

/** 调用后端 ffmpeg 切段，返回新视频素材 */
export async function trimVideoAsset(params: {
  projectId: string;
  videoAssetId: string;
  inSec: number;
  outSec: number;
  title?: string;
  /** 本机兜底：源视频可播放 URL（/api/local/asset?...） */
  sourceUrl?: string;
}): Promise<VideoTrimResult> {
  const inSec = Math.max(0, params.inSec);
  const outSec = params.outSec;
  if (!(outSec - inSec >= MIN_VIDEO_TRIM_SEC)) {
    throw new Error(`片段至少 ${MIN_VIDEO_TRIM_SEC} 秒`);
  }

  if (isLocalDesktop) {
    return trimVideoAssetLocal({ ...params, inSec, outSec });
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
