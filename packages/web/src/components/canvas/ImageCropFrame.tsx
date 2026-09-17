"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  clampCropRect,
  resolveCropAspect,
  type CropAspectRatio,
  type CropRect,
  type InlineImageCropState,
} from "@/lib/canvas/imageCrop";
import { CANVAS_OVERLAY_Z_TOP_MENU } from "@/lib/canvas/canvasOverlayTransform";

type HandleKey = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_NORM = 0.08;

interface ImageCropFrameProps {
  worldX: number;
  worldY: number;
  nodeWidth: number;
  nodeHeight: number;
  /** 原图像素宽高比；用于锁定「原图比例」 */
  imageAspect: number;
  /** 受控模式：视频裁剪等复用同一套框选 UI */
  controlled?: {
    rect: CropRect;
    aspectRatio: CropAspectRatio;
    onPatch: (patch: Partial<InlineImageCropState>) => void;
  };
}

function applyHandleDelta(
  start: CropRect,
  handle: HandleKey,
  dxNorm: number,
  dyNorm: number,
  lockAspect: number | null
): CropRect {
  const a = lockAspect;
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;

  // 无比例锁：自由缩放
  if (a == null) {
    if (handle.includes("e")) w = right + dxNorm - x;
    if (handle.includes("w")) {
      const nextX = x + dxNorm;
      w = right - nextX;
      x = nextX;
    }
    if (handle.includes("s")) h = bottom + dyNorm - y;
    if (handle.includes("n")) {
      const nextY = y + dyNorm;
      h = bottom - nextY;
      y = nextY;
    }
    return clampCropRect({ x, y, w, h });
  }

  // 有比例锁：对边/对角为锚点，避免每次强制居中导致跳动
  const fitFromWidth = (nextW: number, anchorX: "left" | "right", anchorY: "top" | "bottom") => {
    let nw = Math.max(MIN_NORM, nextW);
    let nh = nw / a;
    if (nh < MIN_NORM) {
      nh = MIN_NORM;
      nw = nh * a;
    }
    let nx = anchorX === "left" ? x : right - nw;
    let ny = anchorY === "top" ? y : bottom - nh;
    if (nx < 0) {
      nx = 0;
      nw = Math.min(nw, right);
      nh = nw / a;
      if (anchorY === "bottom") ny = bottom - nh;
    }
    if (ny < 0) {
      ny = 0;
      nh = Math.min(nh, bottom);
      nw = nh * a;
      if (anchorX === "right") nx = right - nw;
    }
    if (nx + nw > 1) {
      nw = 1 - nx;
      nh = nw / a;
      if (anchorY === "bottom") ny = bottom - nh;
    }
    if (ny + nh > 1) {
      nh = 1 - ny;
      nw = nh * a;
      if (anchorX === "right") nx = right - nw;
    }
    return clampCropRect({ x: nx, y: ny, w: nw, h: nh });
  };

  const fitFromHeight = (nextH: number, anchorX: "left" | "right", anchorY: "top" | "bottom") => {
    let nh = Math.max(MIN_NORM, nextH);
    let nw = nh * a;
    if (nw < MIN_NORM) {
      nw = MIN_NORM;
      nh = nw / a;
    }
    let nx = anchorX === "left" ? x : right - nw;
    let ny = anchorY === "top" ? y : bottom - nh;
    if (nx < 0) {
      nx = 0;
      nw = Math.min(nw, right);
      nh = nw / a;
      if (anchorY === "bottom") ny = bottom - nh;
    }
    if (ny < 0) {
      ny = 0;
      nh = Math.min(nh, bottom);
      nw = nh * a;
      if (anchorX === "right") nx = right - nw;
    }
    if (nx + nw > 1) {
      nw = 1 - nx;
      nh = nw / a;
      if (anchorY === "bottom") ny = bottom - nh;
    }
    if (ny + nh > 1) {
      nh = 1 - ny;
      nw = nh * a;
      if (anchorX === "right") nx = right - nw;
    }
    return clampCropRect({ x: nx, y: ny, w: nw, h: nh });
  };

  switch (handle) {
    case "e":
      return fitFromWidth(start.w + dxNorm, "left", "top");
    case "w":
      return fitFromWidth(start.w - dxNorm, "right", "top");
    case "s":
      return fitFromHeight(start.h + dyNorm, "left", "top");
    case "n":
      return fitFromHeight(start.h - dyNorm, "left", "bottom");
    case "se": {
      const byW = fitFromWidth(start.w + dxNorm, "left", "top");
      const byH = fitFromHeight(start.h + dyNorm, "left", "top");
      return Math.abs(dxNorm) >= Math.abs(dyNorm) ? byW : byH;
    }
    case "sw": {
      const byW = fitFromWidth(start.w - dxNorm, "right", "top");
      const byH = fitFromHeight(start.h + dyNorm, "right", "top");
      return Math.abs(dxNorm) >= Math.abs(dyNorm) ? byW : byH;
    }
    case "ne": {
      const byW = fitFromWidth(start.w + dxNorm, "left", "bottom");
      const byH = fitFromHeight(start.h - dyNorm, "left", "bottom");
      return Math.abs(dxNorm) >= Math.abs(dyNorm) ? byW : byH;
    }
    case "nw": {
      const byW = fitFromWidth(start.w - dxNorm, "right", "bottom");
      const byH = fitFromHeight(start.h - dyNorm, "right", "bottom");
      return Math.abs(dxNorm) >= Math.abs(dyNorm) ? byW : byH;
    }
    default:
      return clampCropRect(start);
  }
}

/** 裁剪框：三分线 + 边/角白手柄，可缩小扩大选区 */
export function ImageCropFrame({
  worldX,
  worldY,
  nodeWidth,
  nodeHeight,
  imageAspect,
  controlled,
}: ImageCropFrameProps) {
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  const storeCrop = useCanvasStore((s) => s.inlineImageCrop);
  const storePatch = useCanvasStore((s) => s.patchInlineImageCrop);
  const crop = controlled
    ? { rect: controlled.rect, aspectRatio: controlled.aspectRatio }
    : storeCrop;
  const patchCrop = controlled?.onPatch ?? storePatch;
  const dragRef = useRef<{
    mode: "resize" | "move";
    handle?: HandleKey;
    startX: number;
    startY: number;
    rect: CropRect;
  } | null>(null);

  if (!crop) return null;

  const { rect, aspectRatio } = crop;
  const lockAspect = resolveCropAspect(aspectRatio, imageAspect);
  const left = rect.x * nodeWidth;
  const top = rect.y * nodeHeight;
  const boxW = rect.w * nodeWidth;
  const boxH = rect.h * nodeHeight;

  const onHandlePointerDown = (handle: HandleKey) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      mode: "resize",
      handle,
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...rect },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMovePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      rect: { ...rect },
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const z = Math.max(0.01, zoom);
    const dxNorm = (e.clientX - dragRef.current.startX) / z / Math.max(1, nodeWidth);
    const dyNorm = (e.clientY - dragRef.current.startY) / z / Math.max(1, nodeHeight);
    if (dragRef.current.mode === "move") {
      const start = dragRef.current.rect;
      patchCrop({
        rect: clampCropRect({
          x: start.x + dxNorm,
          y: start.y + dyNorm,
          w: start.w,
          h: start.h,
        }),
      });
      return;
    }
    if (!dragRef.current.handle) return;
    patchCrop({
      rect: applyHandleDelta(
        dragRef.current.rect,
        dragRef.current.handle,
        dxNorm,
        dyNorm,
        lockAspect
      ),
    });
  };

  const onDragPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
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
    onPointerMove: onDragPointerMove,
    onPointerUp: onDragPointerUp,
    onPointerCancel: onDragPointerUp,
  });

  // 截图同款：白边手柄
  const edgeH =
    "nodrag nopan pointer-events-auto absolute z-20 h-1.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";
  const edgeV =
    "nodrag nopan pointer-events-auto absolute z-20 h-7 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";
  const corner =
    "nodrag nopan pointer-events-auto absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";

  return (
    <div
      className="canvas-node-overlay pointer-events-none"
      style={{
        position: "absolute",
        left: worldX,
        top: worldY,
        width: nodeWidth,
        height: nodeHeight,
        zIndex: CANVAS_OVERLAY_Z_TOP_MENU,
      }}
    >
      {/* 裁剪框：白边 + 三分线；外侧暗角；内部可拖动平移 */}
      <div
        className="nodrag nopan pointer-events-auto absolute cursor-move"
        style={{
          left,
          top,
          width: boxW,
          height: boxH,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          border: "1.5px solid rgba(255,255,255,0.95)",
        }}
        onPointerDown={onMovePointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/35" />
          ))}
        </div>
      </div>

      {/* 边手柄 */}
      <div
        title="上边"
        className={cn(edgeH, "cursor-ns-resize")}
        style={{ left: left + boxW / 2, top }}
        {...handlePointerProps("n")}
      />
      <div
        title="下边"
        className={cn(edgeH, "cursor-ns-resize")}
        style={{ left: left + boxW / 2, top: top + boxH }}
        {...handlePointerProps("s")}
      />
      <div
        title="左边"
        className={cn(edgeV, "cursor-ew-resize")}
        style={{ left, top: top + boxH / 2 }}
        {...handlePointerProps("w")}
      />
      <div
        title="右边"
        className={cn(edgeV, "cursor-ew-resize")}
        style={{ left: left + boxW, top: top + boxH / 2 }}
        {...handlePointerProps("e")}
      />

      {/* 角手柄 */}
      <div
        title="左上"
        className={cn(corner, "cursor-nwse-resize")}
        style={{ left, top }}
        {...handlePointerProps("nw")}
      />
      <div
        title="右上"
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left: left + boxW, top }}
        {...handlePointerProps("ne")}
      />
      <div
        title="左下"
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left, top: top + boxH }}
        {...handlePointerProps("sw")}
      />
      <div
        title="右下"
        className={cn(corner, "cursor-nwse-resize")}
        style={{ left: left + boxW, top: top + boxH }}
        {...handlePointerProps("se")}
      />
    </div>
  );
}
