"use client";

import { useState, useMemo } from "react";
import { NODE_REGISTRY, getNodesByCategory, CATEGORY_LABELS, type NodeCategory, type NodeTypeDefinition } from "@/types/node-registry";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";

export function NodePalette() {
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(true);
  const togglePalette = () => setPaletteOpen((v) => !v);

  const grouped = useMemo(() => {
    // 成片表仅由爆款/出海批量成片创建，不进节点面板
    const raw = getNodesByCategory();
    const result: Record<string, NodeTypeDefinition[]> = {};
    for (const [cat, defs] of Object.entries(raw)) {
      const visible = defs.filter((d) => d.type !== "finished_clips_grid");
      if (visible.length > 0) result[cat] = visible;
    }
    return result;
  }, []);
  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    const result: Record<string, NodeTypeDefinition[]> = {};
    for (const [cat, defs] of Object.entries(grouped)) {
      const matching = defs.filter((d) => d.label.toLowerCase().includes(q) || d.type.toLowerCase().includes(q));
      if (matching.length > 0) result[cat] = matching;
    }
    return result;
  }, [search, grouped]);

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => { const n = new Set(prev); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; });
  };

  if (!paletteOpen) {
    return (
      <div className="glass-panel absolute left-3 top-20 z-20">
        <button onClick={togglePalette} className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelLeft className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="glass-panel absolute left-3 top-20 z-20 flex w-56 flex-col rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">节点面板</span>
        <button onClick={togglePalette} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点..." className="h-8 pl-8 text-xs" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(filtered).map(([cat, defs]) => {
          const isCollapsed = collapsedCats.has(cat);
          return (
            <div key={cat} className="mb-1">
              <button onClick={() => toggleCat(cat)} className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {CATEGORY_LABELS[cat as NodeCategory] || cat}
                <span className="ml-auto text-white/30">({defs.length})</span>
              </button>
              {!isCollapsed && defs.map((def) => (
                <button
                  key={def.type}
                  onClick={() => {
                    const store = useCanvasStore.getState();
                    const position = resolveAddNodePosition(def.type, store.nodes, {
                      viewport: store.viewport,
                      paneSize: store.flowPaneSize,
                      selectedNodeId: store.selectedNodeId,
                    });
                    store.addNode(def.type, position);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                  style={{ paddingLeft: 24 }}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/node-type", def.type); e.dataTransfer.effectAllowed = "move"; }}
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: def.color }} />
                  {def.label}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
