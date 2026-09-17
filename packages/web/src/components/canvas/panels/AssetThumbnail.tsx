"use client";

import { FileText, Video } from "lucide-react";
import type { Asset } from "@/lib/api/assets";
import { useAssetDisplayUrl } from "@/lib/canvas/useAssetDisplayUrl";
import { primeVideoFirstFrame } from "@/lib/canvas/videoFirstFrame";
import { isSignedOssUrl } from "@/lib/signedUrl";

/** Whether we have a dedicated image thumbnail (not the video file itself). */
export function assetHasImageThumbnail(asset: Pick<Asset, "category" | "fileUrl" | "thumbnailUrl">): boolean {
  if (asset.category === "document") return false;
  if (asset.category !== "video") return asset.category === "image";
  const thumb = asset.thumbnailUrl || "";
  const file = asset.fileUrl || "";
  if (!thumb || thumb === file) return false;
  const thumbPath = thumb.split("?")[0]?.toLowerCase() ?? "";
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/.test(thumbPath) || thumbPath.includes(".thumb.");
}

interface AssetThumbnailProps {
  asset: Pick<Asset, "category" | "fileUrl" | "thumbnailUrl" | "title" | "ossKey">;
  className?: string;
  imgClassName?: string;
}

export function AssetThumbnail({
  asset,
  className = "h-full w-full",
  imgClassName = "h-full w-full object-cover",
}: AssetThumbnailProps) {
  const fileUrl = useAssetDisplayUrl(asset);
  const thumbUrl = useAssetDisplayUrl(asset, true);

  if (!fileUrl && !thumbUrl && asset.fileUrl && !isSignedOssUrl(asset.fileUrl)) {
    return <div className={`${className} bg-muted/30`} />;
  }

  if (asset.category === "audio") {
    return (
      <img
        src={thumbUrl || "/uploads/audio-default.svg"}
        alt={asset.title}
        className={imgClassName}
        loading="lazy"
        draggable={false}
      />
    );
  }

  if (asset.category === "document") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-violet-500/15 text-violet-200 ${className}`}
        title={asset.title}
      >
        <FileText className="h-6 w-6 opacity-80" />
        <span className="max-w-[90%] truncate px-1 text-[10px] text-white/60">{asset.title}</span>
      </div>
    );
  }

  if (asset.category === "video") {
    if (assetHasImageThumbnail(asset) && thumbUrl) {
      return (
        <img
          src={thumbUrl}
          alt={asset.title}
          className={imgClassName}
          loading="lazy"
          draggable={false}
          onError={(e) => {
            // 封面失效时隐藏裂图，交给下方无封面视频首帧路径需整卡重渲染；此处先藏图
            e.currentTarget.style.display = "none";
          }}
        />
      );
    }

    return (
      <div className={`relative ${className}`}>
        <video
          src={fileUrl}
          className={imgClassName}
          muted
          playsInline
          preload="metadata"
          draggable={false}
          ref={(el) => {
            if (el) primeVideoFirstFrame(el);
          }}
          onLoadedMetadata={(e) => primeVideoFirstFrame(e.currentTarget)}
        />
        <div className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/55 p-0.5 text-white/80">
          <Video className="h-3 w-3" />
        </div>
      </div>
    );
  }

  return (
    <img
      src={fileUrl}
      alt={asset.title}
      className={imgClassName}
      loading="lazy"
      draggable={false}
    />
  );
}

export function assetDragPreviewElement(root: HTMLElement): HTMLElement | null {
  return root.querySelector("img") ?? root.querySelector("video") ?? null;
}
