"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useCanvasStore } from "@/stores/canvasStore";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { X, Trash2, Save, Play } from "lucide-react";

interface Preset { id: string; projectId: string; title: string; nodes: unknown[]; edges: unknown[]; createdAt: string; }

const OFFICIAL = [
  { id:"t2i", label:"文生图", nodes:[{type:"text_input",position:{x:300,y:200}},{type:"image_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"text",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"t2v", label:"文生视频", nodes:[{type:"text_input",position:{x:300,y:200}},{type:"video_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"text",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"t2i2v", label:"文生图生视频", nodes:[{type:"text_input",position:{x:300,y:200}},{type:"image_input",position:{x:580,y:200}},{type:"video_input",position:{x:860,y:200}}], edges:[{source:0,target:1,sourceHandle:"text",targetHandle:REFERENCE_INPUT_ID},{source:1,target:2,sourceHandle:"image",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"i2v", label:"图生视频", nodes:[{type:"image_input",position:{x:300,y:200}},{type:"video_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"image",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"i2t", label:"图生文", nodes:[{type:"image_input",position:{x:300,y:200}},{type:"text_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"image",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"v2t", label:"视频转文本", nodes:[{type:"video_input",position:{x:300,y:200}},{type:"text_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"video",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"v2f", label:"视频抽帧", nodes:[{type:"video_input",position:{x:300,y:200}},{type:"text_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"video",targetHandle:REFERENCE_INPUT_ID}] },
  { id:"t2a", label:"文生音频", nodes:[{type:"text_input",position:{x:300,y:200}},{type:"audio_input",position:{x:580,y:200}}], edges:[{source:0,target:1,sourceHandle:"text",targetHandle:REFERENCE_INPUT_ID}] },
];

export function PresetWorkflowPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const params = useParams<{ id: string }>();
  const projectId = params.id || "";
  const [tab, setTab] = useState<"official"|"mine">("official");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchPresets = useCallback(async () => {
    const res = await fetch(`/api/workflow-presets?projectId=${projectId}`);
    if (res.ok) setPresets(await res.json());
  }, [projectId]);

  useEffect(() => { if (isOpen && tab==="mine") fetchPresets(); }, [isOpen, tab, fetchPresets]);

  const handleApply = (nodes: { type: string; position: { x: number; y: number } }[], edges: { source: number; target: number; sourceHandle?: string; targetHandle?: string }[]) => {
    useCanvasStore.getState().addTemplate(nodes, edges);
    onClose();
  };

  const handleSaveCurrent = async () => {
    setSaving(true);
    const { nodes, edges } = useCanvasStore.getState();
    const simpleNodes = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
    const simpleEdges = edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle || undefined, targetHandle: e.targetHandle || undefined }));
    try {
      const res = await fetch("/api/workflow-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: `我的工作流_${presets.length+1}`, nodes: simpleNodes, edges: simpleEdges }),
      });
      if (res.ok) fetchPresets();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/workflow-presets/${id}`, { method: "DELETE" });
    fetchPresets();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <div className="flex w-[520px] max-h-[560px] flex-col rounded-xl"
          style={{ background:"rgba(10,10,30,0.97)", backdropFilter:"blur(32px)", WebkitBackdropFilter:"blur(32px)", border:"1px solid rgba(255,255,255,0.08)" }}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-medium text-white/80">预设工作流</span>
            <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4"/></button>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 border-b border-white/5 px-4">
            {(["official","mine"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs border-b-2 transition-colors ${
                  tab===t ? "border-primary text-white" : "border-transparent text-white/40 hover:text-white/70"
                }`}>
                {t==="official"?"官方":"我的"}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tab === "official" ? (
              <div className="grid grid-cols-2 gap-2">
                {OFFICIAL.map((wf) => (
                  <button key={wf.id}
                    onClick={() => handleApply(wf.nodes, wf.edges)}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-left hover:border-white/15 hover:bg-white/[0.04] transition-colors group">
                    <Play className="h-4 w-4 text-white/25 group-hover:text-primary transition-colors" />
                    <span className="text-sm text-white/80">{wf.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <button onClick={handleSaveCurrent} disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 py-2.5 text-xs text-white/40 hover:border-white/25 hover:text-white/70 transition-colors mb-3">
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中..." : "保存当前画布为工作流"}
                </button>
                {presets.length===0 ? (
                  <div className="py-8 text-center text-xs text-white/25">暂无保存的工作流</div>
                ) : (
                  <div className="space-y-1">
                    {presets.map((p) => (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 hover:border-white/15 transition-colors group">
                        <button onClick={() => handleApply(p.nodes as never[], p.edges as never[])}
                          className="flex items-center gap-2 text-left flex-1">
                          <Play className="h-3.5 w-3.5 text-white/25 group-hover:text-primary transition-colors" />
                          <span className="text-xs text-white/70">{p.title}</span>
                        </button>
                        <button onClick={() => handleDelete(p.id)}
                          className="text-white/15 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}