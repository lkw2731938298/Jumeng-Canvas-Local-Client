"use client";

import { memo, useCallback, useState, useRef, useEffect, type ReactNode } from "react";

import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";

import type { NodeStatus } from "@/types/node-registry";

import type { WorkflowNodeData } from "@/types/workflow";

import { useCanvasStore } from "@/stores/canvasStore";

import {
  MIN_BODY_HEIGHT,
  MIN_NODE_WIDTH,
  NODE_TITLE_HEIGHT,
  resolveNodeSize,
  resolveNodeSizeUnbounded,
} from "@/lib/canvas/nodeSizing";

import { Loader2 } from "lucide-react";

interface BaseNodeProps extends NodeProps {
  data: WorkflowNodeData;
  icon: string;
  color: string;
  status: NodeStatus;
  children: ReactNode;
  /** Remove body padding so media can fill the card edge-to-edge. */
  bodyFlush?: boolean;
  /** 不限制拖拽拉长的最大宽高（分镜表等） */
  unboundedResize?: boolean;
  /** Renders above the node card (e.g. hover upload button). */
  aboveCard?: ReactNode;
  /** Called when the pointer enters or leaves the node card. */
  onHoverChange?: (hovered: boolean) => void;
}

/** 轻雾玻璃底：空闲与选中共用，选中略提亮 */
const glassBgIdle = "rgba(16, 16, 24, 0.72)";
const glassBgSelected = "rgba(24, 24, 36, 0.62)";
const idleBorder = "rgba(255, 255, 255, 0.1)";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return `rgba(129, 140, 248, ${alpha})`;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const BaseNode = memo(function BaseNode({
  id,
  data,
  selected,
  color,
  status,
  children,
  width,
  height,
  bodyFlush = false,
  unboundedResize = false,
  aboveCard,
  onHoverChange,
}: BaseNodeProps) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const [hovered, setHovered] = useState(false);
  /** 按下轻弹：略缩小后回弹 */
  const [pressed, setPressed] = useState(false);
  const isConnecting = useCanvasStore((s) => s.isConnecting);
  const storeSelected = useCanvasStore((s) => s.selectedNodeId === id);
  const isSelected = selected || storeSelected;
  const inputRef = useRef<HTMLInputElement>(null);

  const { width: nodeWidth, height: nodeHeight } = unboundedResize
    ? resolveNodeSizeUnbounded(width, height)
    : resolveNodeSize(width, height);

  const bodyHeight = Math.max(MIN_BODY_HEIGHT, nodeHeight - NODE_TITLE_HEIGHT);

  const startEdit = useCallback(() => {
    setEditing(true);
    setEditValue(data.label);
  }, [data.label]);

  const confirmEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed) updateNodeData(id, { label: trimmed });
    else setEditValue(data.label);
    setEditing(false);
  }, [editValue, id, data.label, updateNodeData]);

  const cancelEdit = useCallback(() => {
    setEditValue(data.label);
    setEditing(false);
  }, [data.label]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const borderColor = isSelected
    ? hexToRgba(color, 0.75)
    : hovered
      ? hexToRgba(color, 0.4)
      : idleBorder;

  const isConnected = useCanvasStore((s) => s.connectedNodeIds.has(id));
  const updateNodeInternals = useUpdateNodeInternals();
  const showHandles = hovered || isSelected || isConnecting || isConnected;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, nodeWidth, nodeHeight, bodyHeight, updateNodeInternals]);

  return (
    <div
      className="group relative flex h-full w-full flex-col"
      style={{
        width: nodeWidth,
        height: nodeHeight,
        minWidth: MIN_NODE_WIDTH,
        minHeight: NODE_TITLE_HEIGHT + MIN_BODY_HEIGHT,
        transform: pressed ? "scale(0.97)" : "scale(1)",
        transition: "transform 140ms ease-out",
        transformOrigin: "center center",
      }}
      onMouseEnter={() => {
        setHovered(true);
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
        onHoverChange?.(false);
      }}
      onPointerDown={(e) => {
        // 仅主键轻弹；避免拖拽手柄等次级交互抢反馈
        if (e.button === 0) setPressed(true);
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
    >
      {aboveCard}

      <NodeResizer
        isVisible={!!isSelected}
        minWidth={MIN_NODE_WIDTH}
        minHeight={NODE_TITLE_HEIGHT + MIN_BODY_HEIGHT}
        {...(unboundedResize ? {} : { maxWidth: 640, maxHeight: NODE_TITLE_HEIGHT + 480 })}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
        onResizeEnd={(_, params) => {
          const nextWidth = Math.round(params.width);
          const nextBodyHeight = Math.max(
            MIN_BODY_HEIGHT,
            Math.round(params.height) - NODE_TITLE_HEIGHT
          );
          useCanvasStore.getState().updateNodeSize(
            id,
            nextWidth,
            NODE_TITLE_HEIGHT + nextBodyHeight,
            unboundedResize
          );
          useCanvasStore.getState().scheduleAutoSave();
        }}
      />

      <div
        className="flex shrink-0 items-center gap-1.5 border-0 bg-transparent px-1.5 pb-1.5 pt-0.5 text-[11px] font-medium tracking-wide"
        style={{ color, height: NODE_TITLE_HEIGHT, background: "transparent", border: "none" }}
      >
        {isSelected && (
          <span
            className="canvas-node-selected-dot h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${hexToRgba(color, 0.8)}` }}
            aria-hidden
          />
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={confirmEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmEdit();
              if (e.key === "Escape") cancelEdit();
            }}
            className="min-w-0 flex-1 border-0 bg-transparent px-0.5 py-0 text-[11px] font-medium text-white/90 shadow-none outline-none"
            style={{ color }}
          />
        ) : (
          <span className="cursor-text truncate opacity-90" onDoubleClick={startEdit}>
            {data.label}
          </span>
        )}

        {status === "running" && (
          <Loader2 className="ml-auto h-4 w-4 flex-shrink-0 animate-spin" style={{ color }} />
        )}
      </div>

      <div
        className="relative min-h-0 flex-1 overflow-visible rounded-2xl"
        style={{
          background: isSelected ? glassBgSelected : glassBgIdle,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid " + borderColor,
          boxShadow: isSelected
            ? `0 0 0 1px ${hexToRgba(color, 0.18)}, 0 8px 28px rgba(0,0,0,0.45), 0 0 32px ${hexToRgba(color, 0.12)}`
            : hovered
              ? "0 4px 18px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.04)"
              : "0 1px 0 rgba(255,255,255,0.04) inset",
          transition:
            "border-color 180ms ease, box-shadow 180ms ease, background 180ms ease",
          height: bodyHeight,
          width: "100%",
        }}
      >
        {isSelected && (
          <div
            className="canvas-node-selected-glow pointer-events-none absolute -inset-px z-10 rounded-[inherit]"
            style={{
              borderColor: hexToRgba(color, 0.75),
              boxShadow: `0 0 18px ${hexToRgba(color, 0.35)}, inset 0 0 16px ${hexToRgba(color, 0.06)}`,
            }}
            aria-hidden
          />
        )}

        <div
          className={
            bodyFlush
              ? unboundedResize
                ? "absolute inset-0 overflow-visible rounded-[inherit]"
                : "absolute inset-0 overflow-hidden rounded-[inherit]"
              : "flex h-full w-full flex-col overflow-hidden px-3 pb-2.5 pt-2 text-sm"
          }
        >
          {children}
        </div>

        {data.inputs?.map((port) => (
          <Handle
            key={"in-" + port.id}
            type="target"
            position={Position.Left}
            id={port.id}
            className="canvas-node-handle canvas-node-handle-left"
            style={{
              opacity: showHandles ? 1 : 0,
              transition: "opacity 0.15s ease",
              top: "50%",
              ["--handle-color" as string]: color,
            }}
            title={port.label}
          />
        ))}

        {data.outputs?.map((port) => (
          <Handle
            key={"out-" + port.id}
            type="source"
            position={Position.Right}
            id={port.id}
            className="canvas-node-handle canvas-node-handle-right"
            style={{
              opacity: showHandles ? 1 : 0,
              transition: "opacity 0.15s ease",
              top: "50%",
              ["--handle-color" as string]: color,
            }}
            title={port.label}
          />
        ))}
      </div>
    </div>
  );
});
