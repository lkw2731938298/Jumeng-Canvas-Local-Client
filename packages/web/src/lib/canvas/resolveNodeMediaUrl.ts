import {
  fetchAssetsBatch,
  lookupAsset,
  type Asset,
} from "@/lib/api/assets";
import { normalizeStorageUrl, extractStorageKeyFromUrl, fetchSignedStorageUrl, isCdnStorageMode, cdnUrlForKey } from "@/lib/api/storageUrl";
import { pickCachedAssetDisplayUrl } from "@/lib/canvas/resolveSignedAssetDisplayUrl";

const pendingBatch = new Map<string, Promise<Map<string, Asset>>>();

function batchKey(projectId: string, assetIds: string[]): string {
  return `${projectId}:${[...assetIds].sort().join(",")}`;
}

/** Coalesce concurrent asset lookups into a single batch request per tick. */
export async function resolveAssetFromManifestOrBatch(
  projectId: string,
  assetId: string,
  manifest?: Asset[] | Map<string, Asset>
): Promise<Asset | null> {
  if (!assetId || !projectId) return null;
  const fromManifest = lookupAsset(manifest, assetId);
  if (fromManifest) return fromManifest;

  const ids = [assetId];
  const key = batchKey(projectId, ids);
  let batchPromise = pendingBatch.get(key);
  if (!batchPromise) {
    batchPromise = fetchAssetsBatch(projectId, ids).then((items) => {
      pendingBatch.delete(key);
      return new Map(items.map((item) => [item.id, item]));
    });
    pendingBatch.set(key, batchPromise);
  }
  const map = await batchPromise;
  return map.get(assetId) ?? null;
}

/** Resolve a media node's display / reference URL from manifest cache or batch API. */
export async function resolveNodeMediaUrl(
  projectId: string,
  params: Record<string, unknown>,
  urlParamKey: string,
  manifest?: Asset[] | Map<string, Asset>
): Promise<string> {
  const assetId = String(params.assetId ?? "");
  let asset: Asset | null = null;
  if (assetId && projectId) {
    asset = await resolveAssetFromManifestOrBatch(projectId, assetId, manifest);
    if (asset) {
      const fromManifest = pickCachedAssetDisplayUrl(asset);
      if (fromManifest) return fromManifest;
    }
  }
  const raw = String(params[urlParamKey] ?? "");
  const storageKey =
    extractStorageKeyFromUrl(raw) || (asset?.ossKey ? String(asset.ossKey) : null);
  if (storageKey && projectId) {
    // CDN：直接拼装，禁止再刷 sign-url
    if (isCdnStorageMode()) return cdnUrlForKey(storageKey);
    return fetchSignedStorageUrl(storageKey);
  }
  return normalizeStorageUrl(raw);
}
