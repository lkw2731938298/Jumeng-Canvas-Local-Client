/** Strip Next.js basePath from incoming request pathnames (server routes). */

export function stripBasePathFromPathname(pathname: string): string {
  const base = (process.env.BASE_PATH || process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
  if (!base) return pathname;
  if (pathname === base) return "/";
  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length) || "/";
  }
  return pathname;
}
