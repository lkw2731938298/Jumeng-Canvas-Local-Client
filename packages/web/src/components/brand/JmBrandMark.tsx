import { Sparkles } from "lucide-react";

/** 聚梦画布品牌标：蓝紫渐变圆角方块 + 白色星芒（内联样式，任何页面可直接用） */
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
        color: "#fff",
        background: "linear-gradient(135deg, #7c7dff 0%, #56b4ff 55%, #22a4ff 100%)",
        boxShadow: "0 6px 18px rgba(64, 140, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.35)",
      }}
    >
      <Sparkles size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}
