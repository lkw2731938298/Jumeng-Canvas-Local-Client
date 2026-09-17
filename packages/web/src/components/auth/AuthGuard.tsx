"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { isAuthRelaxed } from "@/lib/authConfig";
import { isLocalDesktop, LOCAL_USER } from "@/lib/localDesktop";
import * as authApi from "@/lib/api/auth";
import { performLogout } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/authCookie";
import { useAuthStore } from "@/stores/authStore";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const login = useAuthStore((s) => s.login);
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const [ready, setReady] = useState(false);
  // 发现页是公开营销首页（根路径 `/`）；旧 /discover 仅跳转兼容。个性化项目区块由页面自行按登录态隐藏。
  const isPublicPage = pathname === "/" || pathname === "/discover";

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (typeof window === "undefined") {
        setReady(true);
        return;
      }

      // 开源本地桌面：固定本地用户，跳过登录
      if (isLocalDesktop) {
        login("local-desktop-session", {
          id: LOCAL_USER.id,
          phone: LOCAL_USER.phone,
          displayName: LOCAL_USER.displayName,
        });
        if (!cancelled) setReady(true);
        return;
      }

      const storedToken = localStorage.getItem("jm_canvas_session_token");
      const storedUserRaw = localStorage.getItem("jm_canvas_user");

      if (isAuthRelaxed) {
        if (storedToken && storedUserRaw) {
          try {
            const user = JSON.parse(storedUserRaw);
            login(storedToken, user);
          } catch {
            performLogout();
          }
        }
        if (!cancelled) setReady(true);
        return;
      }

      if (!storedToken) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const res = await authApi.getSession();
        const token = res.sessionToken || storedToken;
        setSessionCookie(token);
        login(token, res.user);
      } catch {
        await performLogout();
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [login]);

  useEffect(() => {
    if (!ready || isAuthRelaxed || isPublicPage) return;
    if (!sessionToken && !localStorage.getItem("jm_canvas_session_token")) {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [ready, sessionToken, pathname, router, isPublicPage]);

  // 公开页（首页）先渲染内容，避免 SSR/首屏整页转圈；登录态在后台 bootstrap。
  if (!ready && !isPublicPage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-sm text-white/40">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中…
      </div>
    );
  }

  if (
    !isPublicPage &&
    !isAuthRelaxed &&
    !sessionToken &&
    !localStorage.getItem("jm_canvas_session_token")
  ) {
    return null;
  }

  return <>{children}</>;
}

