import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/QueryProvider";
import { AppThemeProvider } from "@/components/providers/AppThemeProvider";
import { GlobalWatermarkProvider } from "@/components/providers/GlobalWatermarkProvider";
import { ChunkReloadRecovery } from "@/components/ChunkReloadRecovery";
import { DISCOVER_SEO } from "@/lib/pageSeo";
import "@/styles/selfHostedFonts";
import "./globals.css";

/** 默认跟发现页；项目 / 技能 / 个人中心由各自 layout 覆盖 */
export const metadata: Metadata = DISCOVER_SEO;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" data-app-theme="dark" suppressHydrationWarning>
      <head>
        {/* 首屏前同步 localStorage 主题，避免发现页等先渲染默认深色 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var id=localStorage.getItem("jm_app_theme_v1")||"dark";var dark=id==="dark"||id==="dark-blue"||id==="dark-green";var r=document.documentElement;r.dataset.appTheme=id;r.classList.toggle("dark",dark);r.style.colorScheme=dark?"dark":"light";}catch(e){}})();`,
          }}
        />
      </head>
      {/* 抑制扩展/预览工具改写 body 样式（如 cursor:none）引起的 hydration 告警 */}
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ChunkReloadRecovery />
        <AppThemeProvider>
          <GlobalWatermarkProvider>
            <QueryProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </QueryProvider>
            <Toaster />
          </GlobalWatermarkProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
