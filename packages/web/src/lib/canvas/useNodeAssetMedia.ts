"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import {
  cdnUrlForKey,
  extractStorageKeyFromUrl,
  fetchSignedStorageUrl,
  isCdnStorageMode,
  isSignedStorageMode,
  normalizeStorageUrl,
} from "@/lib/api/storageUrl";
import { resolveAssetFromManifestOrBatch } from "@/lib/canvas/resolveNodeMediaUrl";
import {
  pickCachedAssetDisplayUrl,
  resolveSignedAssetDisplayUrl,
} from "@/lib/canvas/resolveSignedAssetDisplayUrl";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { useCanvasStore } from "@/stores/canvasStore";
import { ensureHttpsOssUrl, isSignedUrlExpired } from "@/lib/signedUrl";
import { LIBRARY_PARAM_OSS_KEY } from "@/lib/canvas/materialLibrary";

interface UseNodeAssetMediaOptions {
  urlParamKey: string;
}

function ephemeralPreviewUrl(paramUrl: string): string {
  const value = paramUrl.trim();
  if (value.startsWith("blob:") || value.startsWith("data:")) return value;
  return "";
}

function stableParamDisplayUrl(paramUrl: string): string {
  const value = paramUrl.trim();
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return "";
  // CDN：直接用接口 URL / 拼 CDN，禁止改写 proxy、禁止签权刷新
  if (isCdnStorageMode()) {
    return normalizeStorageUrl(value);
  }
  if (!isSignedStorageMode()) {
    const storageKey = extractStorageKeyFromUrl(value);
    if (storageKey) return `/api/storage/object?key=${encodeURIComponent(storageKey)}`;
    return normalizeStorageUrl(value);
  }
  const https = ensureHttpsOssUrl(value);
  if (https && !isSignedUrlExpired(https)) return https;
  return "";
}

/** Bind node card preview to this node's own uploaded / generated media only. */
export function useNodeAssetMedia(nodeId: string, { urlParamKey }: UseNodeAssetMediaOptions) {
  const projectId = useCanvasStore((s) => s.projectId);
  const { assetId, paramUrl, libraryOssKey, nodeStatus, isGenerating } = useCanvasStore(
    useShallow((s) => {
      const node = s.nodes.find((n) => n.id === nodeId);
      const nodeParams = node?.data.params;
      const status = node?.data.status ?? "idle";
      return {
        assetId: String(nodeParams?.assetId ?? ""),
        paramUrl: String(nodeParams?.[urlParamKey] ?? ""),
        // 平台素材库节点：用 libraryOssKey 刷新签名，避免过期直链空白
        libraryOssKey: String(nodeParams?.[LIBRARY_PARAM_OSS_KEY] ?? ""),
        nodeStatus: status,
        isGenerating: Boolean(s.activeGenerationNodeIds[nodeId]) || status === "running",
      };
    })
  );

  const { lookupMap, isLoading: manifestLoading, data: manifestAssets } = useProjectAssetManifest(projectId);

  const asset = useMemo(
    () => (assetId ? lookupMap?.get(assetId) : undefined),
    [assetId, lookupMap]
  );

  const assetFileUrl = asset?.fileUrl ?? "";
  const assetOssKey = asset?.ossKey ?? "";

  // 生成结束后若 manifest 尚未收录 assetId，仍须补拉，否则节点会一直空白
  const needsAssetFetch = Boolean(projectId && assetId && !asset && !manifestLoading);
  const { data: fetchedAsset } = useQuery({
    queryKey: ["asset", projectId, assetId],
    queryFn: () => resolveAssetFromManifestOrBatch(projectId, assetId, manifestAssets),
    enabled: needsAssetFetch,
    staleTime: 30 * 60_000,
    refetchInterval: isGenerating || needsAssetFetch ? 3000 : false,
    refetchOnWindowFocus: false,
  });

  const fetchedFileUrl = fetchedAsset?.fileUrl ?? "";

  const effectiveAsset = asset ?? fetchedAsset ?? undefined;

  const previewUrl = useMemo(() => ephemeralPreviewUrl(paramUrl), [paramUrl]);

  const lastResolvedRef = useRef<{ key: string; url: string }>({ key: "", url: "" });

  const [url, setUrl] = useState(() => {
    if (previewUrl) return previewUrl;
    const fromParam = stableParamDisplayUrl(paramUrl);
    if (fromParam) return fromParam;
    if (effectiveAsset) {
      const cached = pickCachedAssetDisplayUrl(effectiveAsset);
      if (cached) return cached;
    }
    return "";
  });

  useEffect(() => {
    if (!projectId) {
      setUrl("");
      lastResolvedRef.current = { key: "", url: "" };
      return;
    }

    if (previewUrl) {
      setUrl((prev) => (prev === previewUrl ? prev : previewUrl));
      return;
    }

    const fromParam = stableParamDisplayUrl(paramUrl);
    if (fromParam && !isGenerating) {
      const cacheKey = `param:${extractStorageKeyFromUrl(paramUrl) || paramUrl}`;
      lastResolvedRef.current = { key: cacheKey, url: fromParam };
      setUrl((prev) => (prev === fromParam ? prev : fromParam));
      return;
    }

    const resolveKey = assetId
      ? `asset:${assetId}`
      : libraryOssKey
        ? `library:${libraryOssKey}`
        : `param:${extractStorageKeyFromUrl(paramUrl) || paramUrl}`;

    const prev = lastResolvedRef.current;
    if (
      !isGenerating &&
      prev.key === resolveKey &&
      prev.url &&
      !isSignedUrlExpired(prev.url)
    ) {
      setUrl((current) => (current === prev.url ? current : prev.url));
      return;
    }

    if (effectiveAsset) {
      const cached = pickCachedAssetDisplayUrl(effectiveAsset);
      if (cached) {
        lastResolvedRef.current = { key: resolveKey, url: cached };
        setUrl((prev) => (prev === cached ? prev : cached));
        if (!isGenerating) return;
      }
    }

    if (!effectiveAsset && !paramUrl.trim() && !libraryOssKey) {
      setUrl((prev) => (prev === "" ? prev : ""));
      return;
    }

    if (!isGenerating && nodeStatus === "success" && assetId && prev.key === resolveKey && prev.url) {
      return;
    }

    let cancelled = false;
    void (async () => {
      if (effectiveAsset) {
        const resolved = await resolveSignedAssetDisplayUrl(effectiveAsset);
        if (cancelled || !resolved) return;
        lastResolvedRef.current = { key: resolveKey, url: resolved };
        setUrl((prev) => (prev === resolved ? prev : resolved));
        return;
      }

      // 素材库节点：cdn 拼 CDN；signed 才重新签发
      if (libraryOssKey) {
        const resolved = isCdnStorageMode()
          ? cdnUrlForKey(libraryOssKey)
          : await fetchSignedStorageUrl(libraryOssKey);
        if (cancelled || !resolved) return;
        lastResolvedRef.current = { key: resolveKey, url: resolved };
        setUrl((prev) => (prev === resolved ? prev : resolved));
        return;
      }

      if (isCdnStorageMode()) {
        const resolved = normalizeStorageUrl(paramUrl);
        if (cancelled || !resolved) return;
        lastResolvedRef.current = { key: resolveKey, url: resolved };
        setUrl((prev) => (prev === resolved ? prev : resolved));
        return;
      }

      if (!isSignedStorageMode()) {
        const storageKey = extractStorageKeyFromUrl(paramUrl);
        const resolved = storageKey
          ? `/api/storage/object?key=${encodeURIComponent(storageKey)}`
          : normalizeStorageUrl(paramUrl);
        if (cancelled || !resolved) return;
        lastResolvedRef.current = { key: resolveKey, url: resolved };
        setUrl((prev) => (prev === resolved ? prev : resolved));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    previewUrl,
    paramUrl,
    assetId,
    libraryOssKey,
    assetFileUrl,
    assetOssKey,
    fetchedFileUrl,
    isGenerating,
    nodeStatus,
  ]);

  const assetThumbUrl = effectiveAsset?.thumbnailUrl ?? "";
  const [thumbnailUrl, setThumbnailUrl] = useState(() =>
    ensureHttpsOssUrl(
      pickCachedAssetDisplayUrl(effectiveAsset ?? { fileUrl: "", thumbnailUrl: "", ossKey: "" }, true) ||
        ""
    )
  );

  // 封面签名过期时按 thumb key 重签，禁止把过期 thumbnailUrl 直接喂给 <img>
  useEffect(() => {
    if (!effectiveAsset) {
      setThumbnailUrl((prev) => (prev === "" ? prev : ""));
      return;
    }
    const cached = pickCachedAssetDisplayUrl(effectiveAsset, true);
    if (cached) {
      const next = ensureHttpsOssUrl(cached);
      setThumbnailUrl((prev) => (prev === next ? prev : next));
      return;
    }
    let cancelled = false;
    void resolveSignedAssetDisplayUrl(effectiveAsset, true).then((resolved) => {
      if (cancelled || !resolved) return;
      const next = ensureHttpsOssUrl(resolved);
      setThumbnailUrl((prev) => (prev === next ? prev : next));
    });
    return () => {
      cancelled = true;
    };
  }, [assetId, assetFileUrl, assetOssKey, assetThumbUrl, fetchedFileUrl]);

  return { url, thumbnailUrl, asset: effectiveAsset, assetId, paramUrl, refresh: () => undefined };
}
