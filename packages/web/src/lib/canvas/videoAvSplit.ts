/** 视频节点音视频分离：抽出音频 + 无声视频 */

import { apiFetch } from "@/lib/api/client";
import { notifyAssetsUpdated, type Asset, type AssetCategory } from "@/lib/api/assets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";

function normalizeAsset(raw: Record<string, unknown>, fallbackCategory: AssetCategory): Asset {
  const fileUrl = ensureHttpsOssUrl(String(raw.fileUrl ?? raw.file_url ?? ""));
  const thumbnailUrl = ensureHttpsOssUrl(
    String(raw.thumbnailUrl ?? raw.thumbnail_url ?? fileUrl)
  );
  const categoryRaw = String(raw.category ?? fallbackCategory);
  const category: AssetCategory =
    categoryRaw === "audio" ||
    categoryRaw === "video" ||
    categoryRaw === "image" ||
    categoryRaw === "model"
      ? categoryRaw
      : fallbackCategory;
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    title: String(raw.title ?? ""),
    category,
    subcategory: (raw.subcategory as string | null) ?? null,
    ossKey: String(raw.ossKey ?? raw.oss_key ?? ""),
    fileUrl,
    thumbnailUrl: thumbnailUrl || fileUrl,
    fileType: String(raw.fileType ?? raw.file_type ?? ""),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

export type VideoAvSplitResult = {
  audioAsset: Asset;
  videoAsset: Asset;
  sourceAssetId: string;
};

/** 调用后端音视频分离，返回分离音频 + 无声视频素材 */
export async function splitVideoAvAsset(params: {
  projectId: string;
  videoAssetId: string;
  audioTitle?: string;
  videoTitle?: string;
}): Promise<VideoAvSplitResult> {
  const content = await apiFetch<{
    audioAsset: Record<string, unknown>;
    videoAsset: Record<string, unknown>;
    sourceAssetId: string;
  }>("/api/v1/assets/video-av-split", {
    method: "POST",
    body: JSON.stringify({
      projectId: params.projectId,
      videoAssetId: params.videoAssetId,
      audioTitle: params.audioTitle,
      videoTitle: params.videoTitle,
    }),
  });

  const audioAsset = normalizeAsset(content.audioAsset ?? {}, "audio");
  const videoAsset = normalizeAsset(content.videoAsset ?? {}, "video");
  if (!audioAsset.id || !audioAsset.fileUrl) {
    throw new Error("分离音频未返回有效素材");
  }
  if (!videoAsset.id || !videoAsset.fileUrl) {
    throw new Error("无声视频未返回有效素材");
  }

  notifyAssetsUpdated();
  return {
    audioAsset,
    videoAsset,
    sourceAssetId: String(content.sourceAssetId ?? params.videoAssetId),
  };
}
