"use client";

import { useEffect, useRef } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { sizeFromMedia } from "./nodeSizing";

function isLikelyVideoUrl(url: string): boolean {
  return url.startsWith("data:video") || /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

function isLikelyImageUrl(url: string): boolean {
  if (url.startsWith("data:image")) return true;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i.test(url)) return true;
  if (url.includes("/api/storage/object")) return true;
  // 本机画布资产常无扩展名：/api/local/asset?id=...
  if (/\/api\/local\//i.test(url)) return true;
  if (/^https?:\/\//i.test(url)) return true;
  return false;
}

export function useMediaNodeSize(nodeId: string, mediaUrl?: string | null) {
  const updateNodeSize = useCanvasStore((s) => s.updateNodeSize);
  const updateNodeInternals = useUpdateNodeInternals();
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mediaUrl || mediaUrl === lastUrlRef.current) return;
    lastUrlRef.current = mediaUrl;

    const applySize = (naturalWidth: number, naturalHeight: number) => {
      const { width, height } = sizeFromMedia(naturalWidth, naturalHeight);
      updateNodeSize(nodeId, width, height);
      requestAnimationFrame(() => updateNodeInternals(nodeId));
    };

    if (isLikelyVideoUrl(mediaUrl)) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => applySize(video.videoWidth, video.videoHeight);
      video.src = mediaUrl;
      return;
    }

    if (isLikelyImageUrl(mediaUrl) || mediaUrl.includes("/api/storage/object") || /\/api\/local\//i.test(mediaUrl)) {
      const img = new Image();
      img.onload = () => applySize(img.naturalWidth, img.naturalHeight);
      img.onerror = () => {
        /* keep default node size if proxy URL fails to probe */
      };
      img.src = mediaUrl;
    }
  }, [mediaUrl, nodeId, updateNodeSize, updateNodeInternals]);
}
