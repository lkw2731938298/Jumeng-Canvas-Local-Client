"use client";

/**
 * 画幅安全区 DOM 轨道：尺寸与 DirectorAspectOverlay 取景框一致。
 * 进机位时主 View 追踪此节点，使 cam.aspect / 视锥与右侧监视器、截图完全一致。
 */

import { useEffect, useState, type RefObject } from "react";
import type { DirectorAspectRatio } from "@/types/director-scene";
import { aspectRatioToNumber, computeAspectFrame } from "@/lib/director/aspectRatio";

export function DirectorFilmGateTrack({
  containerRef,
  trackRef,
  aspectRatio,
}: {
  containerRef: RefObject<HTMLElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  aspectRatio: DirectorAspectRatio;
}) {
  const [frame, setFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setFrame(
        computeAspectFrame(rect.width, rect.height, aspectRatioToNumber(aspectRatio))
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, aspectRatio]);

  if (frame.width <= 0 || frame.height <= 0) {
    // 仍挂载节点，保证 ref 可用；View 在尺寸就绪后会随 ResizeObserver 更新
    return (
      <div
        ref={trackRef}
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={trackRef}
      className="pointer-events-none absolute"
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      }}
      aria-hidden
    />
  );
}
