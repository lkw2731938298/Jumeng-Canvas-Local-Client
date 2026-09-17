"use client";

import { usePathname } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullScreen =
    /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i.test(pathname) ||
    pathname.startsWith("/canvas") ||
    pathname === "/projects" ||
    pathname === "/" ||
    pathname === "/settings" ||
    pathname === "/jobs";

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        {!isFullScreen && <TopBar />}
        {!isFullScreen && <Sidebar />}
        <main className={isFullScreen ? "" : "ml-16 pt-14"}>
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
