"use client";

import { useEffect, useMemo, useState } from "react";
import type { DirectorAspectRatio } from "@/types/director-scene";
import { aspectRatioToNumber, computeAspectFrame } from "@/lib/director/aspectRatio";

/** LibTV 风格画幅遮罩：安全区内清晰，区外模糊 */
export function DirectorAspectOverlay({
  containerRef,
  aspectRatio,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  aspectRatio: DirectorAspectRatio;
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
    <div className="pointer-events-none absolute inset-3 z-[26] overflow-hidden rounded-lg">
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
      {/* 取景框边线 */}
      <div
        className="absolute border border-white/25"
        style={{ left: x, top: y, width, height }}
      />
    </div>
  );
}
