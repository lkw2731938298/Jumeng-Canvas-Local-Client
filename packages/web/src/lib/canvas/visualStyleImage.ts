import { withBasePath } from "@/lib/basePath";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";

/** Resolve visual style preview URL for admin / canvas (proxy, signed OSS, absolute). */
export function resolveVisualStyleImageUrl(imageUrl: string | undefined | null): string {
  const value = String(imageUrl ?? "").trim();
  if (!value) return "";
  // 兼容旧相对路径里带 /canvas 前缀
  const path = value.startsWith("/canvas/") ? value.slice("/canvas".length) : value;
  if (path.startsWith("/api/") || path.startsWith("/uploads/")) return withBasePath(path);
  return ensureHttpsOssUrl(path);
}
