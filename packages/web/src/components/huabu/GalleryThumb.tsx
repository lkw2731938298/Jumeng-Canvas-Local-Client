"use client";

import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Orient = "portrait" | "landscape" | "square";

function orientFromSize(w: number, h: number): Orient | null {
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio > 1.05) return "landscape";
  if (ratio < 0.95) return "portrait";
  return "square";
}

interface GalleryThumbProps {
  videoUrl?: string | null;
  coverUrl?: string | null;
  className?: string;
  children?: ReactNode;
  onMouseEnter?: (e: MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLDivElement>) => void;
}

/**
 * 发现页作品缩略图：容器固定 9:16 竖框；横屏内容 contain 居中 letterbox。
 * 方向类名仅作样式钩子，不改盒子比例（详情弹层另按真实横竖屏展示）。
 */
export function GalleryThumb({
  videoUrl,
  coverUrl,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: GalleryThumbProps) {
  const [orient, setOrient] = useState<Orient | null>(null);

  const applySize = useCallback((w: number, h: number) => {
    const next = orientFromSize(w, h);
    if (!next) return;
    setOrient(next);
  }, []);

  return (
    <div
      className={cn("gallery-thumb", orient ? `is-${orient}` : null, className)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {videoUrl ? (
        <video
          src={videoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          controls={false}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            applySize(v.videoWidth, v.videoHeight);
          }}
        />
      ) : null}
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="gallery-thumb-cover"
          src={coverUrl}
          alt=""
          onLoad={(e) => {
            // 无视频时用封面定方向钩子；有视频时以视频元数据为准
            if (videoUrl) return;
            const img = e.currentTarget;
            applySize(img.naturalWidth, img.naturalHeight);
          }}
        />
      ) : null}
      {!videoUrl && !coverUrl ? <div className="gallery-thumb-fallback" /> : null}
      {children}
    </div>
  );
}
