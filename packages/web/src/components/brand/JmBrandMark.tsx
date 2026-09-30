/**
 * 聚梦画布品牌标：使用本地 logo 图片（public/brand/logo.png）。
 * 项目页顶栏与画布顶栏共用此组件。
 */
import { withBasePath } from "@/lib/basePath";

export function JmBrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        overflow: "hidden",
        background: "transparent",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 静态品牌资源，无需 next/image 优化 */}
      <img
        src={withBasePath("/brand/logo.png")}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
      />
    </span>
  );
}
