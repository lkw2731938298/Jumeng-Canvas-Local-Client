"use client";

import { useState, useRef, useEffect } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { NODE_REGISTRY } from "@/types/node-registry";
import { ParamField } from "./ParamField";
import { X, Trash2, ChevronDown, ChevronRight, List, ArrowLeftRight } from "lucide-react";
import type { WorkflowNodeData } from "@/types/workflow";

export function NodeListPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  const getConnections = (nodeId: string) => ({
    incoming: edges.filter((e) => e.target === nodeId),
    outgoing: edges.filter((e) => e.source === nodeId),
  });

  const getNodeName = (id: string) => {
    const n = nodes.find((n) => n.id === id);
    return (n?.data as WorkflowNodeData)?.label || "未知";
  };

  const handleDelete = (nodeId: string) => {
    useCanvasStore.getState().selectNode(nodeId);
    useCanvasStore.getState().removeSelectedNodes();
    if (expandedId === nodeId) setExpandedId(null);
    if (editingId === nodeId) setEditingId(null);
  };

  const startEditName = (nodeId: string, label: string) => {
    setEditingId(nodeId);
    setEditValue(label);
  };

  const confirmEditName = (nodeId: string, fallback: string) => {
    const trimmed = editValue.trim();
    if (trimmed) updateNodeData(nodeId, { label: trimmed });
    else setEditValue(fallback);
    setEditingId(null);
  };

  const cancelEditName = (fallback: string) => {
    setEditValue(fallback);
    setEditingId(null);
  };

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const toggle = () => setIsOpen((v) => !v);

  // Show toggle button
  if (!isOpen) {
    return (
      <button
        onClick={toggle}
        className="fixed right-4 top-[72px] z-30 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-white/50 hover:text-white/90 hover:bg-white/10 transition-colors"
        style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
        title="节点列表"
      >
        <List className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div
      className="fixed right-0 top-14 z-30 flex h-[calc(100vh-56px)] w-80 flex-col border-l border-white/10"
      style={{ background: "rgba(10,10,30,0.92)", backdropFilter: "blur(32px)", WebkitBackdropFilter: "blur(32px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-sm font-medium text-white/80">
          {"节点列表"} ({nodes.length})
        </span>
        <button
          onClick={toggle}
          className="rounded p-0.5 text-white/40 hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {nodes.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-white/25">画布为空，拖入节点开始创作</div>
        ) : (
          nodes.map((node) => {
            const def = NODE_REGISTRY[node.type || ""];
            const { incoming, outgoing } = getConnections(node.id);
            const data = node.data as WorkflowNodeData;
            const isExpanded = expandedId === node.id;

            return (
              <div key={node.id} className="border-b border-white/5">
                {/* Row */}
                <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-white/[0.04] transition-colors group">
                  {/* Expand */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : node.id)}
                    className="text-white/25 hover:text-white/70 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {/* Color dot */}
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ background: def?.color || "#6b7280" }}
                  />

                  {/* Name + connections */}
                  <div
                    className="flex-1 min-w-0"
                    onClick={() => {
                      if (editingId === node.id) return;
                      setExpandedId(isExpanded ? null : node.id);
                      useCanvasStore.getState().selectNode(node.id);
                    }}
                  >
                    {editingId === node.id ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => confirmEditName(node.id, data?.label || node.type || "")}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          const fallback = data?.label || node.type || "";
                          if (e.key === "Enter") confirmEditName(node.id, fallback);
                          if (e.key === "Escape") cancelEditName(fallback);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-xs font-medium text-white/90 outline-none focus:border-primary/50"
                      />
                    ) : (
                      <div
                        className="text-xs font-medium text-white/80 truncate cursor-text"
                        title="双击修改名称"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEditName(node.id, data?.label || node.type || "");
                        }}
                      >
                        {data?.label || node.type}
                      </div>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      {incoming.length > 0 && (
                        <span className="text-[10px] text-white/25">{incoming.length}入</span>
                      )}
                      {incoming.length > 0 && outgoing.length > 0 && (
                        <ArrowLeftRight className="h-2.5 w-2.5 text-white/15" />
                      )}
                      {outgoing.length > 0 && (
                        <span className="text-[10px] text-white/25">{outgoing.length}出</span>
                      )}
                      {incoming.length === 0 && outgoing.length === 0 && (
                        <span className="text-[10px] text-white/15">无连接</span>
                      )}
                    </div>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(node.id)}
                    className="text-white/15 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover:opacity-100"
                    title="删除节点"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Expanded: properties */}
                {isExpanded && def && (
                  <div className="border-t border-white/5 bg-white/[0.02] px-5 py-3 space-y-3">
                    <div className="text-[10px] text-white/25 uppercase tracking-wide mb-1">
                      节点属性
                    </div>
                    {def.params.map((param) => (
                      <ParamField
                        key={param.key}
                        definition={param}
                        value={data?.params?.[param.key]}
                        onChange={(v) => updateNodeParam(node.id, param.key, v)}
                      />
                    ))}

                    {/* Connections detail */}
                    {(incoming.length > 0 || outgoing.length > 0) && (
                      <div className="pt-2 border-t border-white/5">
                        <div className="text-[10px] text-white/25 uppercase tracking-wide mb-1.5">
                          连接详情
                        </div>
                        {incoming.length > 0 && (
                          <div className="text-[10px] text-white/35 mb-0.5">
                            ← 输入来源: {incoming.map((e) => getNodeName(e.source)).join(", ")}
                          </div>
                        )}
                        {outgoing.length > 0 && (
                          <div className="text-[10px] text-white/35">
                            → 输出到: {outgoing.map((e) => getNodeName(e.target)).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
