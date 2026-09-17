/** 视频节点空间裁剪：归一化矩形 + 导出 API */

import { apiFetch } from "@/lib/api/client";
import { notifyAssetsUpdated, type Asset } from "@/lib/api/assets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import {
  DEFAULT_CROP_RECT,
  DEFAULT_INLINE_IMAGE_CROP,
  type CropAspectRatio,
  type CropRect,
  type InlineImageCropState,
} from "@/lib/canvas/imageCrop";

export type InlineVideoCropPurpose = "crop" | "subtitle_box_erase";

export type InlineVideoCropState = InlineImageCropState & {
  nodeId: string;
  /** crop=空间裁剪；subtitle_box_erase=框选去字幕 */
  purpose?: InlineVideoCropPurpose;
};

export const DEFAULT_INLINE_VIDEO_CROP: Omit<InlineVideoCropState, "nodeId"> = {
  /** 视频裁剪默认自由框选，宽高可独立拖动 */
  aspectRatio: "free",
  rect: { ...DEFAULT_CROP_RECT },
  purpose: "crop",
};

export interface VideoCropResult {
  asset: Asset;
  rect: CropRect;
  sourceAssetId: string;
}

function normalizeCropAsset(raw: Record<string, unknown>): Asset {
  const fileUrl = ensureHttpsOssUrl(String(raw.fileUrl ?? raw.file_url ?? ""));
  const thumbnailUrl = ensureHttpsOssUrl(
    String(raw.thumbnailUrl ?? raw.thumbnail_url ?? fileUrl)
  );
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    title: String(raw.title ?? ""),
    category: "video",
    subcategory: (raw.subcategory as string | null) ?? "裁剪",
    ossKey: String(raw.ossKey ?? raw.oss_key ?? ""),
    fileUrl,
    thumbnailUrl: thumbnailUrl || fileUrl,
    fileType: String(raw.fileType ?? raw.file_type ?? "video/mp4"),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

/** 调用后端 ffmpeg 空间裁剪，返回新视频素材 */
export async function cropVideoAsset(params: {
  projectId: string;
  videoAssetId: string;
  rect: CropRect;
  title?: string;
}): Promise<VideoCropResult> {
  const { x, y, w, h } = params.rect;
  if (!(w > 0.05 && h > 0.05)) {
    throw new Error("裁剪区域过小");
  }

  const content = await apiFetch<{
    asset: Record<string, unknown>;
    rect: CropRect;
    sourceAssetId: string;
  }>("/api/v1/assets/video-crop", {
    method: "POST",
    body: JSON.stringify({
      projectId: params.projectId,
      videoAssetId: params.videoAssetId,
      rect: { x, y, w, h },
      title: params.title,
    }),
  });

  const asset = normalizeCropAsset(content.asset ?? {});
  if (!asset.id || !asset.fileUrl) {
    throw new Error("裁剪结果无效");
  }
  notifyAssetsUpdated();
  return {
    asset,
    rect: content.rect ?? params.rect,
    sourceAssetId: String(content.sourceAssetId || params.videoAssetId),
  };
}

export type { CropAspectRatio, CropRect };
