/** Helpers for OSS / CDN media URLs (HTTPS upgrade, signed expiry, CDN recognition). */

const DEFAULT_CDN_HOST = "cdn.example.com";

function configuredCdnHost(): string {
  const base = (process.env.NEXT_PUBLIC_OSS_CDN_BASE_URL || `https://${DEFAULT_CDN_HOST}`).trim();
  try {
    const host = new URL(base.includes("://") ? base : `https://${base}`).hostname;
    return (host || DEFAULT_CDN_HOST).toLowerCase();
  } catch {
    return DEFAULT_CDN_HOST;
  }
}

/** Upgrade http://*.aliyuncs.com / CDN signed URLs to https:// (Mixed Content on HTTPS pages). */
export function ensureHttpsOssUrl(url: string): string {
  const value = url.trim();
  if (!value) return "";
  if (value.startsWith("http://")) {
    const lower = value.toLowerCase();
    if (lower.includes(".aliyuncs.com") || lower.includes(configuredCdnHost())) {
      return `https://${value.slice(7)}`;
    }
  }
  return value;
}

/** 是否为本站 CDN 公共读 URL（无签权参数）。 */
export function isCdnOssUrl(url: string): boolean {
  const value = ensureHttpsOssUrl(url);
  if (!value.startsWith("https://") && !value.startsWith("http://")) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === configuredCdnHost() || host === DEFAULT_CDN_HOST;
  } catch {
    return false;
  }
}

export function parseSignedUrlExpiryMs(url: string): number | null {
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("Expires") ?? parsed.searchParams.get("x-oss-expires");
    if (!raw) return null;
    const seconds = Number.parseInt(raw, 10);
    if (!Number.isFinite(seconds)) return null;
    return seconds * 1000;
  } catch {
    return null;
  }
}

export function isSignedOssUrl(url: string): boolean {
  const lower = ensureHttpsOssUrl(url).toLowerCase();
  return (
    (lower.includes("expires=") || lower.includes("x-oss-expires=")) &&
    (lower.includes("ossaccesskeyid=") || lower.includes("signature="))
  );
}

/** True when the signed URL is expired or within bufferMs of expiry. CDN URLs never expire. */
export function isSignedUrlExpired(url: string, bufferMs = 5 * 60 * 1000): boolean {
  if (isCdnOssUrl(url) && !isSignedOssUrl(url)) return false;
  if (!isSignedOssUrl(url)) return false;
  const expiresAt = parseSignedUrlExpiryMs(url);
  if (expiresAt == null) return false;
  return Date.now() >= expiresAt - bufferMs;
}

export function hasExpiringSignedAssetUrls(
  assets: Array<{ fileUrl?: string; thumbnailUrl?: string }>
): boolean {
  return assets.some(
    (asset) =>
      (asset.fileUrl && isSignedUrlExpired(asset.fileUrl)) ||
      (asset.thumbnailUrl && isSignedUrlExpired(asset.thumbnailUrl))
  );
}
