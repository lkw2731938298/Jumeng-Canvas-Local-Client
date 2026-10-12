/** 音频节点内联分段：入/出点与导出 API（本机 ffmpeg） */

import { notifyAssetsUpdated, type Asset } from "@/lib/api/assets";
import { withBasePath } from "@/lib/basePath";
import { isLocalDesktop } from "@/lib/localDesktop";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import { clampTrimRange, MIN_VIDEO_TRIM_SEC } from "@/lib/canvas/videoTrim";

/** 与视频切段一致的最短时长 */
export const MIN_AUDIO_TRIM_SEC = MIN_VIDEO_TRIM_SEC;

export interface AudioTrimResult {
  asset: Asset;
  inSec: number;
  outSec: number;
  durationSec: number;
  sourceAssetId: string;
}

function normalizeAudioAsset(raw: Record<string, unknown>): Asset {
  const fileUrl = ensureHttpsOssUrl(String(raw.fileUrl ?? raw.file_url ?? ""));
  const thumbnailUrl = ensureHttpsOssUrl(
    String(raw.thumbnailUrl ?? raw.thumbnail_url ?? fileUrl)
  );
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    title: String(raw.title ?? ""),
    category: "audio",
    subcategory: (raw.subcategory as string | null) ?? "分段",
    ossKey: String(raw.ossKey ?? raw.oss_key ?? ""),
    fileUrl,
    thumbnailUrl: thumbnailUrl || fileUrl,
    fileType: String(raw.fileType ?? raw.file_type ?? "audio/mp4"),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

/** 本机：/api/local/audio-trim */
async function trimAudioAssetLocal(params: {
  projectId: string;
  audioAssetId: string;
  inSec: number;
  outSec: number;
  title?: string;
}): Promise<AudioTrimResult> {
  const res = await fetch(withBasePath("/api/local/audio-trim"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: params.projectId,
      audioAssetId: params.audioAssetId,
      inSec: params.inSec,
      outSec: params.outSec,
      title: params.title,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    message?: string;
    content?: {
      asset?: Record<string, unknown>;
      inSec?: number;
      outSec?: number;
      durationSec?: number;
      sourceAssetId?: string;
    };
  };
  if (!res.ok) {
    throw new Error(String(body.message || `音频分段失败（${res.status}）`));
  }
  const content = body.content;
  const asset = normalizeAudioAsset(content?.asset ?? {});
  if (!asset.id || !asset.fileUrl) {
    throw new Error("分段结果无效");
  }
  notifyAssetsUpdated();
  return {
    asset,
    inSec: Number(content?.inSec) || params.inSec,
    outSec: Number(content?.outSec) || params.outSec,
    durationSec:
      Number(content?.durationSec) || Math.max(0, params.outSec - params.inSec),
    sourceAssetId: String(content?.sourceAssetId || params.audioAssetId),
  };
}

/** 调用本机 ffmpeg 切段，返回新音频素材 */
export async function trimAudioAsset(params: {
  projectId: string;
  audioAssetId: string;
  inSec: number;
  outSec: number;
  title?: string;
}): Promise<AudioTrimResult> {
  const inSec = Math.max(0, params.inSec);
  const outSec = params.outSec;
  if (!(outSec - inSec >= MIN_AUDIO_TRIM_SEC)) {
    throw new Error(`片段至少 ${MIN_AUDIO_TRIM_SEC} 秒`);
  }
  if (!isLocalDesktop) {
    throw new Error("当前环境暂不支持音频分段，请使用本机画布");
  }
  return trimAudioAssetLocal({ ...params, inSec, outSec });
}

export { clampTrimRange };
