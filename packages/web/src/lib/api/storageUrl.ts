/** Normalize storage URLs for browser display — CDN / signed / same-origin proxy. */

import { BASE_PATH, stripBasePath, withBasePath } from "@/lib/basePath";
import { ensureHttpsOssUrl, isCdnOssUrl, isSignedOssUrl } from "@/lib/signedUrl";

/** 本机 OSS 对象 key 前缀（用户自配 Bucket） */
const STORAGE_KEY_PREFIXES = ["canvas/", "jumeng-refs/"];

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
/** Keep signed URLs stable across manifest refresh (OSS signature rotates on each API response). */
const SIGNED_URL_CACHE_MS = 30 * 60_000;

const DEFAULT_CDN_BASE = "https://cdn.example.com";

/** CDN 公共读模式：稳定 URL，不再请求 sign-url。 */
export function isCdnStorageMode(): boolean {
  return process.env.NEXT_PUBLIC_STORAGE_URL_MODE === "cdn";
}

/** 预签名 OSS URL 模式（可选回退）。 */
export function isSignedStorageMode(): boolean {
  return process.env.NEXT_PUBLIC_STORAGE_URL_MODE === "signed";
}

/** CDN 根地址（无尾斜杠）；cdn 模式拼装兜底用。 */
export function storageCdnBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_OSS_CDN_BASE_URL || DEFAULT_CDN_BASE).trim();
  return raw.replace(/\/$/, "") || DEFAULT_CDN_BASE;
}

/** 用 oss key 拼稳定 CDN URL。 */
export function cdnUrlForKey(storageKey: string): string {
  const key = storageKey.replace(/^\//, "");
  if (!key) return "";
  return `${storageCdnBaseUrl()}/${key}`;
}

/**
 * 列表封面：长边 640 + WebP，保持宽高比。
 * 禁止用 w+h+m_fill，以免裁切改变构图。
 */
export const GALLERY_COVER_OSS_PROCESS = "image/resize,l_640/format,webp/quality,q_70";

/**
 * 为本站 CDN / OSS 直链追加 x-oss-process；blob/data/外链/签权串原样返回。
 * 已有 x-oss-process 时替换为新 process，避免重复参数。
 */
export function withOssImageProcess(
  url: string | null | undefined,
  process: string
): string {
  const raw = (url || "").trim();
  const proc = (process || "").trim();
  if (!raw || !proc) return raw;
  if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/uploads/")) return raw;

  const https = ensureHttpsOssUrl(raw);
  // 签权 URL 改 query 会破坏签名，禁止叠加
  if (isSignedOssUrl(https)) return https;

  const isCdn = isCdnOssUrl(https);
  const isAliyun =
    https.startsWith("http://") || https.startsWith("https://")
      ? (() => {
          try {
            return new URL(https).hostname.toLowerCase().includes(".aliyuncs.com");
          } catch {
            return false;
          }
        })()
      : false;

  if (!isCdn && !isAliyun) return raw;

  try {
    const parsed = new URL(https);
    parsed.searchParams.delete("x-oss-process");
    parsed.searchParams.set("x-oss-process", proc);
    return parsed.toString();
  } catch {
    return raw;
  }
}

function isSignedOssUrlLocal(url: string): boolean {
  return isSignedOssUrl(url);
}

function isStorageObjectKey(key: string): boolean {
  return STORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Extract storage key from an OSS signed / CDN URL. */
function extractStorageKeyFromSignedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Try to get key from query parameter
    const keyParam = parsed.searchParams.get("key");
    if (keyParam) {
      const decoded = decodeURIComponent(keyParam);
      if (isStorageObjectKey(decoded)) return decoded;
    }
    // Try to extract from pathname (OSS/CDN URL format: https://host/key)
    const pathname = parsed.pathname.replace(/^\//, "");
    if (isStorageObjectKey(pathname)) return pathname;
    // Check if pathname ends with a storage-like path
    for (const prefix of STORAGE_KEY_PREFIXES) {
      const idx = pathname.indexOf(prefix);
      if (idx >= 0) {
        const candidate = pathname.slice(idx);
        if (isStorageObjectKey(candidate)) return candidate;
      }
    }
  } catch {
    // invalid URL
  }
  return null;
}

function stripStorageUrlBase(url: string): string {
  if (!BASE_PATH) return url;
  if (url.startsWith(`${BASE_PATH}/api/storage/object`)) {
    return url.slice(BASE_PATH.length);
  }
  if (url.startsWith(`${BASE_PATH}/uploads/`)) {
    return url.slice(BASE_PATH.length);
  }
  return url;
}

/** Extract logical storage key from a same-origin proxy URL. */
export function extractStorageKeyFromUrl(url: string): string | null {
  return storageKeyFromUrl(url);
}

function authHeaders(): Record<string, string> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("jm_canvas_session_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resolve a storage key to a browser-loadable URL.
 * cdn 模式直接拼 CDN，禁止再打 sign-url；signed 才刷新签权。
 */
export async function fetchSignedStorageUrl(storageKey: string): Promise<string> {
  if (isCdnStorageMode()) {
    return cdnUrlForKey(storageKey);
  }

  const cached = signedUrlCache.get(storageKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const endpoint = withBasePath(
    `/api/storage/sign-url?key=${encodeURIComponent(storageKey)}`
  );
  const res = await fetch(endpoint, {
    cache: "no-store",
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    return isSignedStorageMode() ? proxyUrlForKey(storageKey) : "";
  }
  const body = (await res.json()) as { url?: string };
  const resolved = ensureHttpsOssUrl(body.url?.trim() || "");
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
    signedUrlCache.set(storageKey, { url: resolved, expiresAt: Date.now() + SIGNED_URL_CACHE_MS });
    return resolved;
  }
  return proxyUrlForKey(storageKey);
}

function storageKeyFromProxyUrl(url: string): string | null {
  const bare = stripStorageUrlBase(url);
  if (!bare.startsWith("/api/storage/object")) return null;
  const query = bare.split("?", 2)[1];
  if (!query) return null;
  const key = new URLSearchParams(query).get("key");
  return key ? decodeURIComponent(key) : null;
}

function storageKeyFromUrl(url: string): string | null {
  try {
    const proxyKey = storageKeyFromProxyUrl(url);
    if (proxyKey) return proxyKey;

    if (url.startsWith("http://") || url.startsWith("https://")) {
      const parsed = new URL(url);
      const key = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
      if (isStorageObjectKey(key)) return key;
      if (isSignedOssUrl(url) || isCdnOssUrl(url)) {
        const fromQuery = new URLSearchParams(parsed.search).get("key");
        if (fromQuery && isStorageObjectKey(decodeURIComponent(fromQuery))) {
          return decodeURIComponent(fromQuery);
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function proxyUrlForKey(key: string): string {
  return withBasePath(`/api/storage/object?key=${encodeURIComponent(key)}`);
}

/** Same-origin stream URL for canvas/video frame capture (bypasses OSS redirect). */
export function canvasStreamUrlForKey(storageKey: string): string {
  return withBasePath(
    `/api/storage/object?key=${encodeURIComponent(storageKey)}&stream=1`
  );
}

/** Resolve any storage URL or OSS signed URL to a canvas-safe same-origin stream URL. */
export function canvasStreamUrlFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;

  const key =
    storageKeyFromUrl(trimmed) ||
    (trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? extractStorageKeyFromSignedUrl(trimmed)
      : null);
  if (key) return canvasStreamUrlForKey(key);

  if (trimmed.includes("/api/storage/object")) {
    const bare = stripBasePath(trimmed);
    const query = bare.split("?", 2)[1] ?? "";
    const params = new URLSearchParams(query);
    const existingKey = params.get("key");
    if (existingKey) {
      return canvasStreamUrlForKey(decodeURIComponent(existingKey));
    }
  }

  return trimmed;
}

function withAppBaseForRelative(url: string): string {
  if (!url.startsWith("/")) return url;
  // 兼容旧书签里带 /canvas 前缀的相对路径
  let path = url;
  if (path.startsWith("/canvas/")) path = path.slice("/canvas".length);
  if (path.startsWith("/api/") || path.startsWith("/uploads/")) {
    return withBasePath(path);
  }
  return path;
}

/** 项目封面：CDN/预签名禁止乱改 query；相对代理路径补 basePath 并剥 /canvas。 */
export function resolveProjectCoverDisplayUrl(
  coverUrl: string | null | undefined,
  revision = 0
): string | null {
  if (!coverUrl?.trim()) return null;
  let url = ensureHttpsOssUrl(coverUrl.trim());
  if (!url) return null;
  if (url.startsWith("/canvas/")) url = url.slice("/canvas".length);
  if (isSignedOssUrlLocal(url) || isCdnOssUrl(url)) return url;
  if (url.startsWith("/api/") || url.startsWith("/uploads/")) {
    url = withBasePath(url);
  }
  if (revision <= 0) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}v=${revision}`;
}

/** Resolve GLTF/GLB sibling resources (e.g. buffer.bin) against a storage proxy base URL. */
export function resolveStorageResourceUrl(baseUrl: string, resourceUrl: string): string {
  const trimmed = resourceUrl.trim();
  if (!trimmed) return trimmed;
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return normalizeStorageUrl(trimmed);
  }
  if (trimmed.startsWith("/api/storage/object") || (BASE_PATH && trimmed.startsWith(`${BASE_PATH}/api/storage/object`))) {
    return normalizeStorageUrl(trimmed);
  }

  const baseKey = storageKeyFromUrl(baseUrl);
  if (baseKey) {
    const slash = baseKey.lastIndexOf("/");
    const dir = slash >= 0 ? baseKey.slice(0, slash + 1) : "";
    const relative = trimmed.replace(/^\.\//, "");
    if (isCdnStorageMode()) return cdnUrlForKey(`${dir}${relative}`);
    return proxyUrlForKey(`${dir}${relative}`);
  }

  const relative = trimmed.replace(/^\.\//, "");
  if (relative.startsWith("/")) {
    return withBasePath(stripBasePath(relative));
  }
  if (/^https?:\/\//i.test(baseUrl)) {
    try {
      return new URL(relative, baseUrl).href;
    } catch {
      return trimmed;
    }
  }

  const basePath = stripBasePath(baseUrl.split("?", 2)[0] ?? baseUrl);
  const slash = basePath.lastIndexOf("/");
  if (slash < 0) return trimmed;
  return withBasePath(`${basePath.slice(0, slash + 1)}${relative}`);
}

/** Normalize storage URLs for browser display. */
export function normalizeStorageUrl(url: string | undefined | null): string {
  if (!url) return "";

  // CDN 模式：禁止把 URL 改写成 /api/storage/object；能提 key 则拼 CDN
  if (isCdnStorageMode()) {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const https = ensureHttpsOssUrl(url);
      if (isCdnOssUrl(https) || isSignedOssUrlLocal(https)) return https;
      const keyFromHttp = extractStorageKeyFromSignedUrl(https);
      if (keyFromHttp) return cdnUrlForKey(keyFromHttp);
      return https;
    }
    const storageKey = storageKeyFromUrl(url) || extractStorageKeyFromSignedUrl(url);
    if (storageKey) return cdnUrlForKey(storageKey);
    let normalized = stripBasePath(url)
      .replace(/^\/canvas(?=\/)/, "")
      .replace("/api/proxy/v1/storage/object", "/api/storage/object")
      .replace("/api/proxy/api/v1/storage/object", "/api/storage/object");
    const key2 = storageKeyFromUrl(normalized);
    if (key2) return cdnUrlForKey(key2);
    return withAppBaseForRelative(normalized);
  }

  // proxy 模式：抽 key 走同源代理，避免 CORS
  if (!isSignedStorageMode()) {
    const storageKey = storageKeyFromUrl(url);
    if (storageKey) {
      return proxyUrlForKey(storageKey);
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const signedKey = extractStorageKeyFromSignedUrl(url);
      if (signedKey) {
        return proxyUrlForKey(signedKey);
      }
    }
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (isSignedOssUrlLocal(url) || isCdnOssUrl(url)) return ensureHttpsOssUrl(url);
  }

  let normalized = stripBasePath(url)
    .replace(/^\/canvas(?=\/)/, "")
    .replace("/api/proxy/v1/storage/object", "/api/storage/object")
    .replace("/api/proxy/api/v1/storage/object", "/api/storage/object");

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    if (isSignedOssUrl(normalized) || isCdnOssUrl(normalized)) return ensureHttpsOssUrl(normalized);
    return normalized;
  }

  const storageKey = storageKeyFromUrl(normalized);
  if (storageKey) {
    if (isSignedStorageMode()) {
      return "";
    }
    return proxyUrlForKey(storageKey);
  }

  return withAppBaseForRelative(normalized);
}
