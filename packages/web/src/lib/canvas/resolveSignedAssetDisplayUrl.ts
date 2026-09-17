import type { Asset } from "@/lib/api/assets";
import { withBasePath } from "@/lib/basePath";
import {
  cdnUrlForKey,
  extractStorageKeyFromUrl,
  fetchSignedStorageUrl,
  isCdnStorageMode,
  isSignedStorageMode,
  normalizeStorageUrl,
} from "@/lib/api/storageUrl";
import { ensureHttpsOssUrl, isCdnOssUrl, isSignedOssUrl, isSignedUrlExpired } from "@/lib/signedUrl";

function directBrowserUrl(url: string): string {
  const value = ensureHttpsOssUrl(url.trim());
  if (!value) return "";
  // CDN 稳定 URL 直接用，禁止再刷签权
  if (isCdnOssUrl(value) && !isSignedOssUrl(value)) return value;
  if (isSignedOssUrl(value) && !isSignedUrlExpired(value)) return value;
  if (value.startsWith("https://") && !value.includes("/api/storage/object")) return value;
  return "";
}

/** 解析展示用 storage key：缩略图优先从 thumb URL 提 key，避免误用视频本体 ossKey。 */
function storageKeyForDisplay(
  asset: Pick<Asset, "fileUrl" | "thumbnailUrl" | "ossKey">,
  raw: string,
  preferThumbnail: boolean
): string {
  const fromUrl = extractStorageKeyFromUrl(raw) || "";
  if (preferThumbnail) {
    // 封面与文件可能是不同对象；过期签名 URL 仍可从 path 提 key
    return fromUrl || asset.ossKey || "";
  }
  return asset.ossKey || fromUrl || "";
}

/** Prefer manifest CDN/signed URLs; only hit sign-url when signed mode + missing/near expiry. */
export async function resolveSignedAssetDisplayUrl(
  asset: Pick<Asset, "fileUrl" | "thumbnailUrl" | "ossKey">,
  preferThumbnail = false
): Promise<string> {
  const raw = preferThumbnail ? asset.thumbnailUrl || asset.fileUrl : asset.fileUrl;
  const fromManifest = directBrowserUrl(raw);
  if (fromManifest) return fromManifest;

  // CDN 模式：接口 URL 或 ossKey 拼 CDN，禁止走 fetchSignedStorageUrl 刷新
  if (isCdnStorageMode()) {
    const normalized = normalizeStorageUrl(raw);
    if (normalized) return normalized;
    const key = storageKeyForDisplay(asset, raw, preferThumbnail);
    if (key) return cdnUrlForKey(key);
    return "";
  }

  if (!isSignedStorageMode()) {
    const normalized = normalizeStorageUrl(raw);
    if (normalized) return normalized;
    const key = storageKeyForDisplay(asset, raw, preferThumbnail);
    if (key) return withBasePath(`/api/storage/object?key=${encodeURIComponent(key)}`);
    return "";
  }

  const storageKey = storageKeyForDisplay(asset, raw, preferThumbnail);
  if (!storageKey) return "";
  return fetchSignedStorageUrl(storageKey);
}

export function pickCachedAssetDisplayUrl(
  asset: Pick<Asset, "fileUrl" | "thumbnailUrl" | "ossKey">,
  preferThumbnail = false
): string {
  const raw = preferThumbnail ? asset.thumbnailUrl || asset.fileUrl : asset.fileUrl;
  const direct = directBrowserUrl(raw);
  if (direct) return direct;
  if (isCdnStorageMode()) {
    return normalizeStorageUrl(raw);
  }
  if (!isSignedStorageMode()) {
    return normalizeStorageUrl(raw);
  }
  return "";
}
