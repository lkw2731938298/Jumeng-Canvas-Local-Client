import type { Asset, AssetCategory } from "@/lib/api/assets";
import { normalizeStorageUrl } from "@/lib/api/storageUrl";

export const CANVAS_ASSET_MIME = "application/canvas-asset";

export interface AssetDragPayload {
  id: string;
  category: AssetCategory;
  fileUrl: string;
  title: string;
}

const NODE_TYPE_BY_CATEGORY: Partial<Record<AssetCategory, string>> = {
  image: "image_input",
  video: "video_input",
  audio: "audio_input",
  document: "document_input",
};

const URL_PARAM_BY_CATEGORY: Partial<Record<AssetCategory, string>> = {
  image: "imageUrl",
  video: "videoUrl",
  audio: "audioUrl",
  document: "fileUrl",
};

export function assetToDragPayload(asset: Asset): AssetDragPayload {
  return {
    id: asset.id,
    category: asset.category,
    fileUrl: normalizeStorageUrl(asset.fileUrl),
    title: asset.title,
  };
}

export function parseAssetDragPayload(raw: string): AssetDragPayload | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as AssetDragPayload;
    if (!data?.id || !data.category || !data.fileUrl) return null;
    if (!NODE_TYPE_BY_CATEGORY[data.category]) return null;
    return {
      ...data,
      fileUrl: normalizeStorageUrl(data.fileUrl),
    };
  } catch {
    return null;
  }
}

export function nodeTypeForAssetCategory(category: AssetCategory): string {
  return NODE_TYPE_BY_CATEGORY[category] ?? "";
}

export function urlParamForAssetCategory(category: AssetCategory): string {
  return URL_PARAM_BY_CATEGORY[category] ?? "";
}

export function setAssetDragData(dataTransfer: DataTransfer, asset: Asset) {
  dataTransfer.setData(CANVAS_ASSET_MIME, JSON.stringify(assetToDragPayload(asset)));
  dataTransfer.effectAllowed = "copy";
}
