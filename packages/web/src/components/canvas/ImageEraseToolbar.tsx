"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Paintbrush, Redo2, SquareDashed, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  INLINE_IMAGE_DRAW_ACTION_EVENT,
  type InlineImageDrawActionDetail,
} from "@/components/canvas/nodes/InlineImageDrawingOverlay";

/** 擦除工具：画笔涂抹 / 框选区域 / 橡皮修正 */
type EraseToolId = "brush" | "rect" | "eraser";

interface ImageEraseToolbarProps {
  nodeId: string;
  hasStrokes: boolean;
  onClose: () => void;
}

function EraseLabelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 12h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path
        d="M10 8l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="14"
        y="6"
        width="6"
        height="12"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

/** 图片节点擦除浮条：关闭 / 画笔·框选·橡皮 / 粗细 / 撤销重做 */
export function ImageEraseToolbar({ nodeId, hasStrokes, onClose }: ImageEraseToolbarProps) {
  const tool = useCanvasStore((s) => s.inlineImageDrawTool);
  const size = useCanvasStore((s) => s.inlineImageDrawSize);
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  const setTool = useCanvasStore((s) => s.setInlineImageDrawTool);
  const setSize = useCanvasStore((s) => s.setInlineImageDrawSize);
  const setColor = useCanvasStore((s) => s.setInlineImageDrawColor);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const activeTool: EraseToolId =
    tool === "rect" || tool === "eraser" || tool === "brush" ? tool : "brush";

  const dispatchDrawAction = (action: InlineImageDrawActionDetail["action"]) => {
    window.dispatchEvent(
      new CustomEvent(INLINE_IMAGE_DRAW_ACTION_EVENT, {
        detail: { nodeId, action } satisfies InlineImageDrawActionDetail,
      })
    );
  };

  const pickTool = (id: EraseToolId) => {
    setTool(id);
    // 挖空/修正不依赖颜色；仍写入默认值避免其它路径读到空色
    if (id === "brush" || id === "rect" || id === "eraser") {
      setColor("#000000");
    }
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
      className="nodrag nopan nowheel pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[rgba(28,28,36,0.96)] px-2 py-1.5 shadow-2xl backdrop-blur-xl"
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
          className="flex h-8 cursor-grab items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 text-white/85 active:cursor-grabbing"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
        >
          <EraseLabelIcon className="size-4 shrink-0 text-white/70" />
          <span className="text-[13px] font-medium">擦除</span>
        </div>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="画笔"
          onClick={() => pickTool("brush")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "brush"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <Paintbrush className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="矩形框"
          onClick={() => pickTool("rect")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "rect"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <SquareDashed className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title="橡皮"
          onClick={() => pickTool("eraser")}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
            activeTool === "eraser"
              ? "bg-white/15 text-white"
              : "text-white/65 hover:bg-white/10 hover:text-white"
          )}
        >
          <Eraser className="size-[16px]" strokeWidth={1.75} />
        </button>
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-1.5 px-1">
        <Paintbrush className="size-3.5 text-white/40" strokeWidth={1.5} aria-hidden />
        <input
          type="range"
          title={`粗细 ${size}px`}
          min={2}
          max={80}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="w-[88px] accent-sky-400"
        />
      </div>

      <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="撤销"
          disabled={!hasStrokes}
          onPointerDown={(e) => {
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
    </div>
  );
}
