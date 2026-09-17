"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@/lib/api/assets";
import {
  isCdnStorageMode,
  isSignedStorageMode,
  normalizeStorageUrl,
} from "@/lib/api/storageUrl";
import {
  pickCachedAssetDisplayUrl,
  resolveSignedAssetDisplayUrl,
} from "@/lib/canvas/resolveSignedAssetDisplayUrl";

/** Resolve asset file/thumbnail URL for <img>/<video> (CDN or OSS signed in production). */
export function useAssetDisplayUrl(
  asset: Pick<Asset, "fileUrl" | "thumbnailUrl" | "ossKey">,
  preferThumbnail = false
): string {
  const cacheKey = useMemo(
    () =>
      `${preferThumbnail ? "t" : "f"}:${asset.ossKey || ""}:${preferThumbnail ? asset.thumbnailUrl : asset.fileUrl}`,
    [asset.fileUrl, asset.ossKey, asset.thumbnailUrl, preferThumbnail]
  );

  const lastResolvedRef = useRef<{ key: string; url: string }>({ key: "", url: "" });

  const [url, setUrl] = useState(() => {
    const cached = pickCachedAssetDisplayUrl(asset, preferThumbnail);
    if (cached) return cached;
    // CDN / proxy：同步用接口 URL，无需等签权
    if (isCdnStorageMode() || !isSignedStorageMode()) {
      return normalizeStorageUrl(
        preferThumbnail ? asset.thumbnailUrl || asset.fileUrl : asset.fileUrl
      );
    }
    return lastResolvedRef.current.key === cacheKey ? lastResolvedRef.current.url : "";
  });

  useEffect(() => {
    const cached = pickCachedAssetDisplayUrl(asset, preferThumbnail);
    if (cached) {
      lastResolvedRef.current = { key: cacheKey, url: cached };
      setUrl((prev) => (prev === cached ? prev : cached));
      return;
    }

    const prev = lastResolvedRef.current;
    if (prev.key === cacheKey && prev.url) {
      setUrl((current) => (current === prev.url ? current : prev.url));
      return;
    }

    let cancelled = false;
    void resolveSignedAssetDisplayUrl(asset, preferThumbnail).then((resolved) => {
      if (cancelled || !resolved) return;
      lastResolvedRef.current = { key: cacheKey, url: resolved };
      setUrl((prev) => (prev === resolved ? prev : resolved));
    });
    return () => {
      cancelled = true;
    };
  }, [asset, cacheKey, preferThumbnail]);

  return url;
}
