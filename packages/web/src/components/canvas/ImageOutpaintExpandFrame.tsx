"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  clampOutpaintMargins,
  outpaintOutputSize,
  type OutpaintMargins,
} from "@/lib/canvas/imageOutpaint";
import { CANVAS_OVERLAY_Z_TOP_MENU } from "@/lib/canvas/canvasOverlayTransform";

type EdgeKey = "n" | "s" | "e" | "w";
type CornerKey = "nw" | "ne" | "sw" | "se";
type HandleKey = EdgeKey | CornerKey;

interface ImageOutpaintExpandFrameProps {
  worldX: number;
  worldY: number;
  nodeWidth: number;
  nodeHeight: number;
  imageUrl: string;
}

function applyHandleDelta(
  start: OutpaintMargins,
  handle: HandleKey,
  dx: number,
  dy: number
): OutpaintMargins {
  const next = { ...start };
  if (handle.includes("e")) next.right = start.right + dx;
  if (handle.includes("w")) next.left = start.left - dx;
  if (handle.includes("s")) next.bottom = start.bottom + dy;
  if (handle.includes("n")) next.top = start.top - dy;
  return next;
}

/** 扩图：原图四周可拖动手柄 / + 按钮外扩画布，显示目标像素尺寸 */
export function ImageOutpaintExpandFrame({
  worldX,
  worldY,
  nodeWidth,
  nodeHeight,
  imageUrl,
}: ImageOutpaintExpandFrameProps) {
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  const outpaint = useCanvasStore((s) => s.inlineImageOutpaint);
  const patchOutpaint = useCanvasStore((s) => s.patchInlineImageOutpaint);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{
    handle: HandleKey;
    startX: number;
    startY: number;
    margins: OutpaintMargins;
  } | null>(null);

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      setNatural({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const margins = outpaint?.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const frameW = nodeWidth + margins.left + margins.right;
  const frameH = nodeHeight + margins.top + margins.bottom;
  const output = outpaintOutputSize({
    nodeWidth,
    nodeHeight,
    naturalWidth: natural.width || nodeWidth,
    naturalHeight: natural.height || nodeHeight,
    margins,
  });

  const commitMargins = useCallback(
    (next: OutpaintMargins) => {
      patchOutpaint({
        margins: clampOutpaintMargins(next, nodeWidth, nodeHeight),
      });
    },
    [nodeHeight, nodeWidth, patchOutpaint]
  );

  const onHandlePointerDown = (handle: HandleKey) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      margins: { ...margins },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const z = Math.max(0.01, zoom);
    const dx = (e.clientX - dragRef.current.startX) / z;
    const dy = (e.clientY - dragRef.current.startY) / z;
    commitMargins(applyHandleDelta(dragRef.current.margins, dragRef.current.handle, dx, dy));
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handlePointerProps = (handle: HandleKey) => ({
    onPointerDown: onHandlePointerDown(handle),
    onPointerMove: onHandlePointerMove,
    onPointerUp: onHandlePointerUp,
    onPointerCancel: onHandlePointerUp,
  });

  if (!outpaint) return null;

  const pill =
    "nodrag nopan pointer-events-auto absolute z-20 h-3 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[#3a3a48] shadow-md";
  const pillV =
    "nodrag nopan pointer-events-auto absolute z-20 h-8 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[#3a3a48] shadow-md";
  const corner =
    "nodrag nopan pointer-events-auto absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-[#3a3a48] shadow-md";

  return (
    <div
      className="canvas-node-overlay pointer-events-none"
      style={{
        position: "absolute",
        left: worldX - margins.left,
        top: worldY - margins.top,
        width: frameW,
        height: frameH,
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU,
      }}
    >
      {/* 扩展区域底色（原图外的外扩带） */}
      <div className="absolute inset-0 rounded-sm bg-white/[0.04]" />

      {/* 外框白边 */}
      <div className="pointer-events-none absolute inset-0 rounded-sm border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />

      {/* 尺寸角标 */}
      <div className="pointer-events-none absolute right-0 top-0 z-10 -translate-y-[calc(100%+6px)] rounded-md bg-black/70 px-2 py-0.5 text-[11px] tabular-nums text-white/85 backdrop-blur-sm">
        {output.width} × {output.height}
      </div>

      {/* 边手柄 */}
      <div
        title="上边外扩"
        className={cn(pill, "cursor-ns-resize")}
        style={{ left: "50%", top: 0 }}
        {...handlePointerProps("n")}
      />
      <div
        title="下边外扩"
        className={cn(pill, "cursor-ns-resize")}
        style={{ left: "50%", top: "100%" }}
        {...handlePointerProps("s")}
      />
      <div
        title="左边外扩"
        className={cn(pillV, "cursor-ew-resize")}
        style={{ left: 0, top: "50%" }}
        {...handlePointerProps("w")}
      />
      <div
        title="右边外扩"
        className={cn(pillV, "cursor-ew-resize")}
        style={{ left: "100%", top: "50%" }}
        {...handlePointerProps("e")}
      />

      {/* 角手柄 */}
      <div
        title="左上外扩"
        className={cn(corner, "cursor-nwse-resize")}
        style={{ left: 0, top: 0 }}
        {...handlePointerProps("nw")}
      />
      <div
        title="右上外扩"
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left: "100%", top: 0 }}
        {...handlePointerProps("ne")}
      />
      <div
        title="左下外扩"
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left: 0, top: "100%" }}
        {...handlePointerProps("sw")}
      />
      <div
        title="右下外扩"
        className={cn(corner, "cursor-nwse-resize")}
        style={{ left: "100%", top: "100%" }}
        {...handlePointerProps("se")}
      />
    </div>
  );
}
