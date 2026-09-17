"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Pencil, Redo2, Square, Type, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  INLINE_IMAGE_DRAW_ACTION_EVENT,
  type InlineImageDrawActionDetail,
} from "@/components/canvas/nodes/InlineImageDrawingOverlay";

/** 截图同款标注工具：画笔 / 框选 / 文字 */
type AnnotateToolId = "brush" | "rect" | "text";

interface ImageAnnotateToolbarProps {
  nodeId: string;
  hasStrokes: boolean;
  saving?: boolean;
  onSave: () => void;
  onClose: () => void;
}

/** 图片节点标注浮条：可拖动；关闭 / 工具 / 颜色粗细 / 撤销重做 / 保存 */
export function ImageAnnotateToolbar({
  nodeId,
  hasStrokes,
  saving = false,
  onSave,
  onClose,
}: ImageAnnotateToolbarProps) {
  const tool = useCanvasStore((s) => s.inlineImageDrawTool);
  const color = useCanvasStore((s) => s.inlineImageDrawColor);
  const size = useCanvasStore((s) => s.inlineImageDrawSize);
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  const setTool = useCanvasStore((s) => s.setInlineImageDrawTool);
  const setColor = useCanvasStore((s) => s.setInlineImageDrawColor);
  const setSize = useCanvasStore((s) => s.setInlineImageDrawSize);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const activeTool: AnnotateToolId =
    tool === "rect" || tool === "text" || tool === "brush" ? tool : "brush";

  const dispatchDrawAction = (action: InlineImageDrawActionDetail["action"]) => {
    window.dispatchEvent(
      new CustomEvent(INLINE_IMAGE_DRAW_ACTION_EVENT, {
        detail: { nodeId, action } satisfies InlineImageDrawActionDetail,
      })
    );
  };

  const onDragPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // 仅左键拖动工具条位置
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
      className="nodrag nopan nowheel pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-2 py-1.5 shadow-2xl backdrop-blur-xl"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* 左侧：关闭 + 拖动手柄 */}
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
          className="flex h-8 cursor-grab items-center px-1 active:cursor-grabbing"
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
        </div>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="画笔"
          onClick={() => setTool("brush")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "brush"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <Pencil className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="框选"
          onClick={() => setTool("rect")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "rect"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <Square className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="文字"
          onClick={() => setTool("text")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "text"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <Type className="size-[16px]" strokeWidth={1.75} />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-2 px-1">
        <label
          className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full ring-1 ring-white/25"
          title="颜色"
        >
          <span className="absolute inset-0 rounded-full" style={{ backgroundColor: color }} />
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="标注颜色"
          />
        </label>
        <div className="flex items-center gap-1.5">
          <Pencil className="size-3.5 text-white/40" strokeWidth={1.5} aria-hidden />
          <input
            type="range"
            title={
              activeTool === "text" ? `字号约 ${Math.max(12, size * 3)}px` : `粗细 ${size}px`
            }
            min={2}
            max={80}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-[88px] accent-sky-400"
          />
        </div>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="撤销"
          disabled={!hasStrokes}
          onPointerDown={(e) => {
            // 用 pointerdown 立即撤销，避免 click 被画布/浮层吞掉需点两次
            e.stopPropagation();
            e.preventDefault();
            if (!hasStrokes) return;
            dispatchDrawAction("undo");
          }}
          className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Undo2 className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="重做"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            dispatchDrawAction("redo");
          }}
          className="inline-flex size-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Redo2 className="size-[16px]" strokeWidth={1.75} />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <button
        type="button"
        disabled={saving || !hasStrokes}
        onClick={onSave}
        className="ml-0.5 rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
