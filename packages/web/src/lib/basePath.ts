/** Next.js basePath（子路径部署时使用，本机默认空）。 */

export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

export function withBasePath(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  if (!BASE_PATH) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

export function stripBasePath(pathname: string): string {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}

/** Post-login return path: strip duplicate basePath from browser pathname or ?next= */
export function normalizeReturnPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  const stripped = stripBasePath(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
  const normalized = stripped.startsWith("/") ? stripped : `/${stripped}`;
  // 发现首页已迁到 `/`，登录回跳仍兼容旧 next=/discover
  if (normalized === "/discover") return "/";
  return normalized;
}
