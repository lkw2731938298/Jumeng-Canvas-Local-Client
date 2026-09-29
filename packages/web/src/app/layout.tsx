import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/QueryProvider";
import { AppThemeProvider } from "@/components/providers/AppThemeProvider";
import { GlobalWatermarkProvider } from "@/components/providers/GlobalWatermarkProvider";
import { ChunkReloadRecovery } from "@/components/ChunkReloadRecovery";
import { DISCOVER_SEO } from "@/lib/pageSeo";
import { APPEARANCE_BOOT_SCRIPT } from "@/lib/theme/appThemes";
import "@/styles/selfHostedFonts";
import "./globals.css";

/** 默认跟发现页；项目 / 技能 / 个人中心由各自 layout 覆盖 */
export const metadata: Metadata = DISCOVER_SEO;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className="dark"
      data-app-theme="dark"
      data-app-accent="violet"
      data-app-glass="on"
      data-app-glow="on"
      suppressHydrationWarning
    >
      <head>
        {/* 首屏前同步 localStorage 外观（底色/强调色/毛玻璃/光晕/缩放），避免闪烁 */}
        <script
          dangerouslySetInnerHTML={{
            __html: APPEARANCE_BOOT_SCRIPT,
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
