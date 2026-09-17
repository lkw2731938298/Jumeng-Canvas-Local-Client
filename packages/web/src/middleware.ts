import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 开源本地版：拦截云端账号/后台路径，统一落到项目列表或设置。
 * 源码树内文件可保留作参考，但运行时不可达。
 */
const BLOCKED_PREFIXES = [
  "/admin",
  "/login",
  "/register",
  "/reset-password",
  "/account",
  "/activities",
  "/referral",
  "/invites",
  "/discover",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hit = BLOCKED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!hit) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = pathname.startsWith("/account") ? "/settings" : "/projects";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/login",
    "/register",
    "/reset-password",
    "/account/:path*",
    "/activities/:path*",
    "/referral/:path*",
    "/invites/:path*",
    "/discover/:path*",
  ],
};
