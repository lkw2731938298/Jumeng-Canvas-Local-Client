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



const glassBg = "rgba(139, 92, 246, 0.08)";

const glassBorder = "rgba(139, 92, 246, 0.35)";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return `rgba(139, 92, 246, ${alpha})`;
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}



export const BaseNode = memo(function BaseNode({

  id, data, selected, color, status, children, width, height, bodyFlush = false, unboundedResize = false, aboveCard, onHoverChange,

}: BaseNodeProps) {

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  const [editing, setEditing] = useState(false);

  const [editValue, setEditValue] = useState(data.label);

  const [hovered, setHovered] = useState(false);

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
    ? hexToRgba(color, 0.85)
    : hovered
      ? hexToRgba(color, 0.5)
      : glassBorder;

  const isConnected = useCanvasStore((s) => s.connectedNodeIds.has(id));
  const updateNodeInternals = useUpdateNodeInternals();

  const showHandles = hovered || isSelected || isConnecting || isConnected;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, nodeWidth, nodeHeight, bodyHeight, updateNodeInternals]);



  return (

    <div

      className="group relative flex h-full w-full flex-col"

      style={{ width: nodeWidth, height: nodeHeight, minWidth: MIN_NODE_WIDTH, minHeight: NODE_TITLE_HEIGHT + MIN_BODY_HEIGHT }}

      onMouseEnter={() => {
        setHovered(true);
        onHoverChange?.(true);
      }}

      onMouseLeave={() => {
        setHovered(false);
        onHoverChange?.(false);
      }}

    >

      {aboveCard}

      <NodeResizer
        isVisible={!!isSelected}
        minWidth={MIN_NODE_WIDTH}
        minHeight={NODE_TITLE_HEIGHT + MIN_BODY_HEIGHT}
        {...(unboundedResize
          ? {}
          : { maxWidth: 640, maxHeight: NODE_TITLE_HEIGHT + 480 })}
        handleClassName="node-resize-handle"
        lineClassName="node-resize-line"
        onResizeEnd={(_, params) => {
          const nextWidth = Math.round(params.width);
          const nextBodyHeight = Math.max(MIN_BODY_HEIGHT, Math.round(params.height) - NODE_TITLE_HEIGHT);
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
        className="flex shrink-0 items-center gap-1.5 px-1 pb-1.5 pt-0 text-[8px] font-medium bg-transparent border-0"
        style={{ color, height: NODE_TITLE_HEIGHT, background: "transparent", border: "none" }}
      >
        {isSelected && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full canvas-node-selected-dot"
            style={{ background: color, boxShadow: `0 0 6px ${hexToRgba(color, 0.8)}` }}
            aria-hidden
          />
        )}

        {editing ? (

          <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)}

            onBlur={confirmEdit}

            onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") cancelEdit(); }}

            className="flex-1 min-w-0 border-0 bg-transparent px-0.5 py-0 text-[8px] font-medium text-white/90 outline-none shadow-none"

            style={{ color }} />

        ) : (

          <span className="truncate cursor-text" onDoubleClick={startEdit}>{data.label}</span>

        )}

        {status === "running" && <Loader2 className="ml-auto h-6 w-6 animate-spin flex-shrink-0" style={{ color }} />}

      </div>

      <div
        className="relative min-h-0 flex-1 overflow-visible rounded-xl"
        style={{
          background: isSelected ? glassBg : "rgba(24, 24, 36, 0.92)",
          ...(isSelected ? { backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" } : {}),
          border: "1px solid " + borderColor,
          boxShadow: isSelected
            ? `0 0 0 1px ${hexToRgba(color, 0.2)}, 0 4px 24px ${hexToRgba(color, 0.22)}, 0 0 40px ${hexToRgba(color, 0.1)}`
            : hovered
              ? `0 0 0 1px ${hexToRgba(color, 0.12)}, 0 2px 12px rgba(0, 0, 0, 0.35)`
              : "none",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
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


