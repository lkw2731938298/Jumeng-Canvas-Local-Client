import type { Asset } from "@/lib/api/assets";
import { hasExpiringSignedAssetUrls, isSignedUrlExpired } from "@/lib/signedUrl";
import { idbGet, idbSet } from "@/lib/canvas/idbCache";

const MANIFEST_STORE = "manifests";
/** Shorter than OSS signature TTL — force refetch before URLs expire. */
const MANIFEST_TTL_MS = 30 * 60 * 1000;

export interface CachedManifestEntry {
  assets: Asset[];
  savedAt: number;
}

function assetUrlsStillValid(assets: Asset[]): boolean {
  return !assets.some(
    (asset) =>
      (asset.fileUrl && isSignedUrlExpired(asset.fileUrl)) ||
      (asset.thumbnailUrl && isSignedUrlExpired(asset.thumbnailUrl))
  );
}

export async function readCachedManifest(projectId: string): Promise<Asset[] | null> {
  if (!projectId) return null;
  const entry = await idbGet<CachedManifestEntry>(MANIFEST_STORE, projectId);
  if (!entry?.assets?.length) return null;
  if (Date.now() - (entry.savedAt ?? 0) > MANIFEST_TTL_MS) return null;
  if (!assetUrlsStillValid(entry.assets)) return null;
  return entry.assets;
}

export async function writeCachedManifest(projectId: string, assets: Asset[]): Promise<void> {
  if (!projectId || assets.length === 0) return;
  await idbSet<CachedManifestEntry>(MANIFEST_STORE, projectId, {
    assets,
    savedAt: Date.now(),
  });
}

export { hasExpiringSignedAssetUrls };
