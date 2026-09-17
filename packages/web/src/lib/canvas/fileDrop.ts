import type { AssetCategory } from "@/lib/api/assets";
import { NODE_IMAGE_SUBCATEGORY } from "@/lib/api/assets";
import { isDocumentFileName, isDocumentMime } from "@/lib/canvas/documentUploadPolicy";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);

export function inferAssetCategory(file: File): AssetCategory | null {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (isDocumentMime(mime) || isDocumentFileName(file.name)) return "document";

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return null;
}

export function defaultSubcategoryForCategory(category: AssetCategory): string | null {
  if (category === "image") return NODE_IMAGE_SUBCATEGORY;
  return null;
}

export function isOsFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}
