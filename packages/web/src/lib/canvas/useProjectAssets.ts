"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildAssetLookup,
  fetchProjectAssetManifest,
  lookupAsset,
  projectAssetsKey,
  type Asset,
} from "@/lib/api/assets";
import { readCachedManifest, writeCachedManifest } from "@/lib/canvas/assetManifestCache";
import {
  acquireProjectManifestSync,
  releaseProjectManifestSync,
} from "@/lib/canvas/projectManifestRefresh";

/** OSS presign TTL is 24h; refresh manifest only on upload events or near URL expiry. */
const MANIFEST_STALE_MS = 30 * 60 * 1000;

/** Cached project-wide asset manifest for O(1) node lookups. */
export function useProjectAssetManifest(projectId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void readCachedManifest(projectId).then((cached) => {
      if (cancelled || !cached?.length) return;
      const existing = queryClient.getQueryData<Asset[]>(projectAssetsKey(projectId));
      if (!existing?.length) {
        queryClient.setQueryData(projectAssetsKey(projectId), cached);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, queryClient]);

  const query = useQuery({
    queryKey: projectAssetsKey(projectId),
    queryFn: async () => {
      const assets = await fetchProjectAssetManifest(projectId);
      if (assets.length > 0) {
        void writeCachedManifest(projectId, assets);
      }
      return assets;
    },
    enabled: Boolean(projectId),
    staleTime: MANIFEST_STALE_MS,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!projectId) return;
    acquireProjectManifestSync(projectId, queryClient);
    return () => {
      releaseProjectManifestSync(projectId);
    };
  }, [projectId, queryClient]);

  const lookup = (assetId: string): Asset | null =>
    lookupAsset(query.data, assetId);

  const lookupMap = query.data ? buildAssetLookup(query.data) : undefined;

  return {
    ...query,
    assets: query.data ?? [],
    lookup,
    lookupMap,
  };
}
