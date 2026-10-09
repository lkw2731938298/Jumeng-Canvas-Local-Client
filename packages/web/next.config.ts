import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getLanHost, getLanPort } = require("../../scripts/detect-lan.mjs");

const lanHost = getLanHost();
const lanPort = getLanPort();
const isProdBuild = process.env.NODE_ENV === "production";
/** Electron / NSIS 桌面安装包构建：standalone + 本机 proxy，不走 CDN */
const isDesktopBuild = process.env.JUMENG_DESKTOP_BUILD === "1";
const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");
const distDir = (process.env.NEXT_DIST_DIR || ".next").replace(/\/$/, "") || ".next";
const buildId = process.env.CANVAS_BUILD_ID || process.env.NEXT_PUBLIC_BUILD_ID || "dev";

const storageUrlMode =
  process.env.NEXT_PUBLIC_STORAGE_URL_MODE ??
  (isDesktopBuild ? "proxy" : isProdBuild ? "cdn" : "proxy");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  ...(isDesktopBuild ? { output: "standalone" as const } : {}),
  distDir,
  generateBuildId: async () => buildId,
  // 局域网设备通过固定 IP 访问 dev 时，允许加载 /_next 资源与 HMR
  allowedDevOrigins: [lanHost, "localhost", "127.0.0.1"],
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_LAN_HOST: lanHost,
    NEXT_PUBLIC_LAN_PORT: lanPort,
    // 开源本地版默认关闭管理鉴权；仅当显式设为 false 时才要求登录
    NEXT_PUBLIC_ADMIN_AUTH_DISABLED:
      process.env.NEXT_PUBLIC_ADMIN_AUTH_DISABLED ?? "true",
    // 桌面包强制同源 proxy；其它生产构建默认可走 CDN
    NEXT_PUBLIC_STORAGE_URL_MODE: storageUrlMode,
    NEXT_PUBLIC_OSS_CDN_BASE_URL:
      process.env.NEXT_PUBLIC_OSS_CDN_BASE_URL ?? "https://cdn.example.com",
    NEXT_PUBLIC_BUILD_ID: buildId,
    NEXT_PUBLIC_LOCAL_DESKTOP: isDesktopBuild
      ? "1"
      : (process.env.NEXT_PUBLIC_LOCAL_DESKTOP ?? ""),
  },
  experimental: {
    optimizePackageImports: ["@xyflow/react", "lucide-react"],
  },
  // 抠图 ONNX 运行时勿打进服务端包，仅客户端动态加载
  serverExternalPackages: ["@imgly/background-removal", "onnxruntime-web"],
  async redirects() {
    // 发现首页改为根路径 `/`；旧书签 /discover 跳回首页（含空 basePath 与 /canvas）
    const discoverToHome = [
      {
        source: "/discover",
        destination: "/",
        permanent: false,
      },
    ];
    if (!basePath) {
      return discoverToHome;
    }
    // 子路径部署（BASE_PATH=/canvas）时兼容旧 /canvas/:id 书签
    return [
      ...discoverToHome,
      {
        source: "/canvas/:id",
        destination: "/:id",
        permanent: true,
      },
      {
        source: "/canvas/:id/director/:nodeId",
        destination: "/:id/director/:nodeId",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/admin",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
