"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import { hasImageTransform, normalizeRotation } from "@/lib/canvas/imageTransform";

interface ImageRotateToolbarProps {
  saving?: boolean;
  onSave: () => void;
  onClose: () => void;
}

function AngleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M3 3v10h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10a4 4 0 0 0 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 旋转与镜像浮条：关闭 / 角度输入 / 旋转90° / 水平镜像 / 垂直镜像 / 保存 */
export function ImageRotateToolbar({ saving = false, onSave, onClose }: ImageRotateToolbarProps) {
  const transform = useCanvasStore((s) => s.inlineImageTransform);
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  const rotate90 = useCanvasStore((s) => s.rotateInlineImageTransform90);
  const setRotation = useCanvasStore((s) => s.setInlineImageTransformRotation);
  const toggleFlipH = useCanvasStore((s) => s.toggleInlineImageTransformFlipH);
  const toggleFlipV = useCanvasStore((s) => s.toggleInlineImageTransformFlipV);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [degreeDraft, setDegreeDraft] = useState("0");
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const rotation = normalizeRotation(transform?.rotation ?? 0);
  const flipH = transform?.flipH ?? false;
  const flipV = transform?.flipV ?? false;
  const canSave = hasImageTransform(transform);

  // 外部旋转（点 90°）时同步输入框
  useEffect(() => {
    setDegreeDraft(String(rotation));
  }, [rotation]);

  const commitDegree = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setDegreeDraft(String(rotation));
      return;
    }
    const next = normalizeRotation(parsed);
    setRotation(next);
    setDegreeDraft(String(next));
  };

  const onDragPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const z = Math.max(0.01, zoom);
    setOffset({
      x: dragRef.current.originX + (e.clientX - dragRef.current.startX) / z,
      y: dragRef.current.originY + (e.clientY - dragRef.current.startY) / z,
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

  return (
    <div
      className="nodrag nopan nowheel pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-1.5 py-1.5 shadow-2xl backdrop-blur-xl"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="关闭"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-[16px]" strokeWidth={1.75} />
        </button>
        <div
          title="拖动工具条"
          className="flex h-8 cursor-grab items-center gap-1.5 rounded-lg px-1.5 text-white/80 active:cursor-grabbing"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
        >
          <span className="grid grid-cols-2 gap-0.5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="size-1 rounded-full bg-white/35" />
            ))}
          </span>
          <span className="text-[13px] font-medium whitespace-nowrap">旋转与镜像</span>
        </div>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-1 px-1 text-[13px] text-white/80" title="设置旋转角度">
        <AngleMark className="size-3.5 shrink-0 text-white/50" />
        <input
          type="number"
          min={0}
          max={359}
          step={1}
          value={degreeDraft}
          aria-label="旋转角度"
          className="nodrag nopan w-12 rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-1 text-center tabular-nums text-white outline-none focus:border-white/35"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setDegreeDraft(e.target.value)}
          onBlur={() => commitDegree(degreeDraft)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitDegree(degreeDraft);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDegreeDraft(String(rotation));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="text-white/55">°</span>
      </div>

      <button
        type="button"
        title="顺时针旋转 90°"
        onClick={rotate90}
        className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
      >
        <RotateCw className="size-[16px]" strokeWidth={1.75} />
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <button
        type="button"
        title="水平镜像"
        onClick={toggleFlipH}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
          flipH ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
        )}
      >
        <FlipHorizontal2 className="size-[16px]" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        title="垂直镜像"
        onClick={toggleFlipV}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
          flipV ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
        )}
      >
        <FlipVertical2 className="size-[16px]" strokeWidth={1.75} />
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <button
        type="button"
        disabled={saving || !canSave}
        onClick={onSave}
        className="ml-0.5 rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
