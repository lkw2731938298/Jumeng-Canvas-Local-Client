"use client";

import { useEffect, useMemo, useState } from "react";
import type { DirectorAspectRatio } from "@/types/director-scene";
import { aspectRatioToNumber, computeAspectFrame } from "@/lib/director/aspectRatio";

/** LibTV 风格画幅遮罩：安全区内清晰，区外模糊 */
export function DirectorAspectOverlay({
  containerRef,
  aspectRatio,
  showGuides = false,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  aspectRatio: DirectorAspectRatio;
  /** 是否显示三分线 / 中心十字构图辅助 */
  showGuides?: boolean;
}) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, aspectRatio]);

  const frame = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return computeAspectFrame(
      containerSize.width,
      containerSize.height,
      aspectRatioToNumber(aspectRatio)
    );
  }, [containerSize, aspectRatio]);

  if (frame.width <= 0 || frame.height <= 0) return null;

  const { x, y, width, height } = frame;
  const cw = containerSize.width;
  const ch = containerSize.height;

  return (
    <div className="pointer-events-none absolute inset-0 z-[26] overflow-hidden">
      {/* 上 */}
      {y > 0 ? (
        <div
          className="absolute left-0 right-0 top-0 backdrop-blur-md"
          style={{ height: y, background: "rgba(0,0,0,0.45)" }}
        />
      ) : null}
      {/* 下 */}
      {y + height < ch ? (
        <div
          className="absolute bottom-0 left-0 right-0 backdrop-blur-md"
          style={{
            height: ch - y - height,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      ) : null}
      {/* 左 */}
      {x > 0 ? (
        <div
          className="absolute left-0 backdrop-blur-md"
          style={{
            top: y,
            width: x,
            height,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      ) : null}
      {/* 右 */}
      {x + width < cw ? (
        <div
          className="absolute right-0 backdrop-blur-md"
          style={{
            top: y,
            width: cw - x - width,
            height,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      ) : null}
      {/* 取景框边线 + 四角取景标记 */}
      <div className="absolute border border-white/20" style={{ left: x, top: y, width, height }}>
        {(["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"] as const).map((pos) => (
          <span key={pos} className={`absolute h-4 w-4 border-white/70 ${pos}`} />
        ))}
        {/* 构图辅助：三分线 + 中心十字 */}
        {showGuides ? (
          <>
            <span className="absolute inset-y-0 left-1/3 w-px bg-white/20" />
            <span className="absolute inset-y-0 left-2/3 w-px bg-white/20" />
            <span className="absolute inset-x-0 top-1/3 h-px bg-white/20" />
            <span className="absolute inset-x-0 top-2/3 h-px bg-white/20" />
            <span className="absolute left-1/2 top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/50" />
            <span className="absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-white/50" />
          </>
        ) : null}
        <span className="absolute left-2.5 top-2 font-mono text-[10px] tracking-wider text-white/50 [text-shadow:0_1px_2px_#000]">
          {aspectRatio}
        </span>
      </div>
    </div>
  );
}
