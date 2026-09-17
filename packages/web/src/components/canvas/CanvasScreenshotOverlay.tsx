"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crop, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HandleKey = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_PX = 48;

function clampRect(rect: ScreenRect, maxW: number, maxH: number): ScreenRect {
  let w = Math.max(MIN_PX, Math.min(maxW, rect.w));
  let h = Math.max(MIN_PX, Math.min(maxH, rect.h));
  let x = Math.max(0, Math.min(maxW - w, rect.x));
  let y = Math.max(0, Math.min(maxH - h, rect.y));
  w = Math.min(w, maxW - x);
  h = Math.min(h, maxH - y);
  return { x, y, w, h };
}

function applyHandle(
  start: ScreenRect,
  handle: HandleKey,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number
): ScreenRect {
  let { x, y, w, h } = start;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("e")) w = right + dx - x;
  if (handle.includes("w")) {
    const nextX = x + dx;
    w = right - nextX;
    x = nextX;
  }
  if (handle.includes("s")) h = bottom + dy - y;
  if (handle.includes("n")) {
    const nextY = y + dy;
    h = bottom - nextY;
    y = nextY;
  }
  return clampRect({ x, y, w, h }, maxW, maxH);
}

interface CanvasScreenshotOverlayProps {
  paneWidth: number;
  paneHeight: number;
  saving?: boolean;
  onConfirm: (rect: ScreenRect) => void;
  onClose: () => void;
}

/** 画布框选截图：三分线选区 + 顶栏关闭/确认（对齐图片裁剪交互） */
export function CanvasScreenshotOverlay({
  paneWidth,
  paneHeight,
  saving = false,
  onConfirm,
  onClose,
}: CanvasScreenshotOverlayProps) {
  const [rect, setRect] = useState<ScreenRect>(() =>
    clampRect(
      {
        x: paneWidth * 0.12,
        y: paneHeight * 0.12,
        w: paneWidth * 0.76,
        h: paneHeight * 0.76,
      },
      paneWidth,
      paneHeight
    )
  );
  const dragRef = useRef<{
    mode: "resize" | "move";
    handle?: HandleKey;
    startX: number;
    startY: number;
    rect: ScreenRect;
  } | null>(null);

  const onHandleDown = (handle: HandleKey) => (e: ReactPointerEvent<HTMLElement>) => {
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

  const onMoveDown = (e: ReactPointerEvent<HTMLElement>) => {
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

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (dragRef.current.mode === "move") {
      const s = dragRef.current.rect;
      setRect(clampRect({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, paneWidth, paneHeight));
      return;
    }
    if (!dragRef.current.handle) return;
    setRect(
      applyHandle(dragRef.current.rect, dragRef.current.handle, dx, dy, paneWidth, paneHeight)
    );
  };

  const onDragUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleProps = (handle: HandleKey) => ({
    onPointerDown: onHandleDown(handle),
    onPointerMove: onDragMove,
    onPointerUp: onDragUp,
    onPointerCancel: onDragUp,
  });

  const edgeH =
    "nodrag nopan pointer-events-auto absolute z-20 h-1.5 w-7 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] cursor-ns-resize";
  const edgeV =
    "nodrag nopan pointer-events-auto absolute z-20 h-7 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] cursor-ew-resize";
  const corner =
    "nodrag nopan pointer-events-auto absolute z-20 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]";

  return (
    <div
      data-canvas-screenshot-ui
      className="absolute inset-0 z-[80] pointer-events-none"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 顶栏 */}
      <div className="pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-2 py-1.5 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          title="关闭"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-[16px]" strokeWidth={1.75} />
        </button>
        <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />
        <span className="inline-flex items-center gap-1.5 px-1.5 text-[13px] text-white/85">
          <Crop className="size-3.5 text-white/70" strokeWidth={1.75} />
          框选截图
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => onConfirm(rect)}
          className="ml-1 inline-flex h-8 items-center justify-center rounded-lg bg-white px-3.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? "处理中…" : "确认"}
        </button>
      </div>

      {/* 选区 */}
      <div
        className="nodrag nopan pointer-events-auto absolute cursor-move"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          border: "1.5px solid rgba(255,255,255,0.95)",
        }}
        onPointerDown={onMoveDown}
        onPointerMove={onDragMove}
        onPointerUp={onDragUp}
        onPointerCancel={onDragUp}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/35" />
          ))}
        </div>
      </div>

      <div className={cn(edgeH)} style={{ left: rect.x + rect.w / 2, top: rect.y }} {...handleProps("n")} />
      <div
        className={cn(edgeH)}
        style={{ left: rect.x + rect.w / 2, top: rect.y + rect.h }}
        {...handleProps("s")}
      />
      <div className={cn(edgeV)} style={{ left: rect.x, top: rect.y + rect.h / 2 }} {...handleProps("w")} />
      <div
        className={cn(edgeV)}
        style={{ left: rect.x + rect.w, top: rect.y + rect.h / 2 }}
        {...handleProps("e")}
      />
      <div className={cn(corner, "cursor-nwse-resize")} style={{ left: rect.x, top: rect.y }} {...handleProps("nw")} />
      <div
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left: rect.x + rect.w, top: rect.y }}
        {...handleProps("ne")}
      />
      <div
        className={cn(corner, "cursor-nesw-resize")}
        style={{ left: rect.x, top: rect.y + rect.h }}
        {...handleProps("sw")}
      />
      <div
        className={cn(corner, "cursor-nwse-resize")}
        style={{ left: rect.x + rect.w, top: rect.y + rect.h }}
        {...handleProps("se")}
      />
    </div>
  );
}
