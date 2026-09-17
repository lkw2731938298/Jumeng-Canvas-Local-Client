"use client";

import { memo, useCallback, useState, useRef, useEffect } from "react";
import type { NodeProps } from "@xyflow/react";
import { Layers, Lock, Unlock, ChevronDown, ChevronRight } from "lucide-react";
import type { WorkflowNodeData } from "@/types/workflow";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveNodeSizeUnbounded } from "@/lib/canvas/nodeSizing";

/**
 * 节点组框：矩形液态玻璃背景；仅标题条可点选/拖动，主体不挡成员。
 */
export const NodeGroupFrame = memo(function NodeGroupFrame({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps & { data: WorkflowNodeData }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const setGroupLocked = useCanvasStore((s) => s.setGroupLocked);
  const setGroupCollapsed = useCanvasStore((s) => s.setGroupCollapsed);
  const storeSelected = useCanvasStore((s) => s.selectedNodeId === id);
  const isSelected = selected || storeSelected;
  const memberCount = Array.isArray(data.memberIds) ? data.memberIds.length : 0;
  const locked = Boolean(data.locked);
  const collapsed = Boolean(data.collapsed);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const { width: w, height: h } = resolveNodeSizeUnbounded(width, height);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitLabel = useCallback(() => {
    const next = editValue.trim() || "未命名组";
    updateNodeData(id, { label: next });
    setEditing(false);
  }, [editValue, id, updateNodeData]);

  const borderColor = isSelected
    ? "color-mix(in srgb, var(--primary) 55%, transparent)"
    : locked
      ? "rgba(251, 191, 36, 0.45)"
      : "rgba(255, 255, 255, 0.12)";

  const shadow = isSelected
    ? "0 10px 36px color-mix(in srgb, var(--primary) 28%, transparent), inset 0 1px 0 rgba(255,255,255,0.12)"
    : "0 8px 28px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255,255,255,0.08)";

  return (
    // 主体 pointer-events:none，避免挡住组内成员；标题条再打开交互
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        width: w,
        height: h,
        pointerEvents: "none",
        background: "linear-gradient(145deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.03) 48%, var(--canvas-glass-tint) 100%)",
        backdropFilter: "blur(22px) saturate(1.25)",
        WebkitBackdropFilter: "blur(22px) saturate(1.25)",
        border: `1px solid ${borderColor}`,
        boxShadow: shadow,
        opacity: collapsed ? 0.92 : 1,
      }}
    >
      {!collapsed ? (
        <>
          {/* 液态玻璃光晕：强度低于项目列表，避免画布晃眼 */}
          <div
            className="pointer-events-none absolute -inset-[20%] rounded-full opacity-70"
            style={{
              background:
                "radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 55%)",
              animation: "liquid-spin 14s linear infinite",
              filter: "blur(28px)",
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -inset-[25%] rounded-full opacity-50"
            style={{
              background:
                "radial-gradient(circle at 70% 80%, rgba(56, 189, 248, 0.14), transparent 50%)",
              animation: "liquid-spin 18s linear infinite reverse",
              filter: "blur(36px)",
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 42%, rgba(0,0,0,0.08) 100%)",
            }}
            aria-hidden
          />
        </>
      ) : null}

      {/* 标题条：可拖动整组（配合节点 dragHandle） */}
      <div
        className="node-group-drag-handle relative z-10 flex h-10 cursor-grab items-center gap-1.5 border-b border-white/10 px-2 active:cursor-grabbing"
        style={{
          pointerEvents: "auto",
          background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))",
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (locked) return;
          setEditValue(data.label || "未命名组");
          setEditing(true);
        }}
      >
        <button
          type="button"
          title={collapsed ? "展开" : "折叠"}
          className="nodrag nopan rounded p-0.5 text-white/45 hover:bg-white/10 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            setGroupCollapsed(id, !collapsed);
          }}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <Layers className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setEditValue(data.label || "未命名组");
                setEditing(false);
              }
              e.stopPropagation();
            }}
            className="nodrag nopan min-w-0 flex-1 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/85">
            {data.label || "未命名组"}
          </span>
        )}
        <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums text-white/45">
          {memberCount}
        </span>
        <button
          type="button"
          title={locked ? "解锁" : "锁定"}
          className={`nodrag nopan rounded p-0.5 hover:bg-white/10 ${locked ? "text-amber-300" : "text-white/45 hover:text-white"}`}
          onClick={(e) => {
            e.stopPropagation();
            setGroupLocked(id, !locked);
          }}
        >
          {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
});
