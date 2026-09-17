"use client";

import { useState, useRef, useCallback, useEffect, useMemo, useId, useDeferredValue } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { NODE_REGISTRY } from "@/types/node-registry";
import { Grip, X } from "lucide-react";
import { defaultNodeSize } from "@/lib/canvas/nodeSizing";

const MINIMAP_W = 240;
const MINIMAP_H = 160;
const HEADER_H = 28;
const PAD = 12;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  boundsW: number;
  boundsH: number;
};

function computeBounds(nodes: ReturnType<typeof useCanvasStore.getState>["nodes"]): Bounds {
  const fallback = defaultNodeSize();
  if (nodes.length === 0) {
    return { minX: -400, minY: -300, maxX: 400, maxY: 300, boundsW: 800, boundsH: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.position.x;
    const y = node.position.y;
    const w = node.width ?? fallback.width;
    const h = node.height ?? fallback.height;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  const margin = 120;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;
  return {
    minX,
    minY,
    maxX,
    maxY,
    boundsW: Math.max(maxX - minX, 200),
    boundsH: Math.max(maxY - minY, 200),
  };
}

function clampPanelPos(x: number, y: number, panelW: number, panelH: number) {
  if (typeof window === "undefined") return { x, y };
  const maxX = Math.max(8, window.innerWidth - panelW - 8);
  const maxY = Math.max(8, window.innerHeight - panelH - 8);
  return {
    x: Math.min(Math.max(8, x), maxX),
    y: Math.min(Math.max(8, y), maxY),
  };
}

export function MinimapOverlay() {
  const minimapVisible = useCanvasStore((s) => s.minimapVisible);
  if (!minimapVisible) return null;
  return <MinimapContent />;
}

function MinimapContent() {
  const nodes = useDeferredValue(useCanvasStore((s) => s.nodes));
  const viewport = useCanvasStore((s) => s.viewport);
  const flowPaneSize = useCanvasStore((s) => s.flowPaneSize);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const centerFlowView = useCanvasStore((s) => s.centerFlowView);
  const panFlowView = useCanvasStore((s) => s.panFlowView);
  const fitView = useCanvasStore((s) => s.fitView);

  const clipId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const panelDragging = useRef(false);
  const panelDragStart = useRef({ x: 0, y: 0 });
  const vpDragging = useRef(false);
  const vpDragLast = useRef({ x: 0, y: 0 });

  const panelH = MINIMAP_H + HEADER_H;
  const canvasH = MINIMAP_H;

  useEffect(() => {
    if (pos !== null || typeof window === "undefined") return;
    setPos(
      clampPanelPos(16, window.innerHeight - panelH - 72, MINIMAP_W, panelH)
    );
  }, [pos, panelH]);

  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    panelDragging.current = true;
    const current = pos ?? { x: 0, y: 0 };
    panelDragStart.current = { x: e.clientX - current.x, y: e.clientY - current.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panelDragging.current) {
        setPos(
          clampPanelPos(
            e.clientX - panelDragStart.current.x,
            e.clientY - panelDragStart.current.y,
            MINIMAP_W,
            panelH
          )
        );
        return;
      }
      if (vpDragging.current && panFlowView) {
        const dx = e.clientX - vpDragLast.current.x;
        const dy = e.clientY - vpDragLast.current.y;
        vpDragLast.current = { x: e.clientX, y: e.clientY };
        const scale = scaleRef.current;
        if (scale > 0) {
          panFlowView(dx / scale, dy / scale);
        }
      }
    };
    const onUp = () => {
      panelDragging.current = false;
      vpDragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panFlowView, panelH]);

  const nodeKey = nodes
    .map((n) => `${n.id}:${n.position.x},${n.position.y},${n.width},${n.height}`)
    .join("|");
  const bounds = useMemo(() => computeBounds(nodes), [nodeKey]);

  const innerW = MINIMAP_W - PAD * 2;
  const innerH = canvasH - PAD * 2;
  const scaleX = innerW / bounds.boundsW;
  const scaleY = innerH / bounds.boundsH;
  const scale = Math.min(scaleX, scaleY);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const paneW = flowPaneSize.width > 0 ? flowPaneSize.width : 800;
  const paneH = flowPaneSize.height > 0 ? flowPaneSize.height : 600;

  const flowLeft = -viewport.x / viewport.zoom;
  const flowTop = -viewport.y / viewport.zoom;
  const flowW = paneW / viewport.zoom;
  const flowH = paneH / viewport.zoom;

  const vpX = PAD + (flowLeft - bounds.minX) * scale;
  const vpY = PAD + (flowTop - bounds.minY) * scale;
  const vpW = Math.max(4, flowW * scale);
  const vpH = Math.max(4, flowH * scale);

  const clientToFlow = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const localX = clientX - rect.left - PAD;
      const localY = clientY - rect.top - PAD;
      if (localX < 0 || localY < 0 || localX > innerW || localY > innerH) return null;
      return {
        x: bounds.minX + localX / scale,
        y: bounds.minY + localY / scale,
      };
    },
    [bounds.minX, bounds.minY, innerW, innerH, scale]
  );

  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.classList.contains("minimap-vp-rect")) {
        vpDragging.current = true;
        vpDragLast.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const flow = clientToFlow(e.clientX, e.clientY);
      if (flow && centerFlowView) {
        centerFlowView(flow.x, flow.y);
      }
    },
    [centerFlowView, clientToFlow]
  );

  if (pos === null) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-40 rounded-xl border border-purple-400/30 bg-[rgba(18,18,36,0.94)] shadow-2xl overflow-hidden select-none"
      style={{ left: pos.x, top: pos.y, width: MINIMAP_W, height: panelH }}
    >
      <div
        className="flex items-center justify-between px-2 border-b border-white/10 cursor-move hover:bg-white/5"
        style={{ height: HEADER_H }}
        onMouseDown={onPanelMouseDown}
      >
        <Grip className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">小地图</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => fitView?.()}
            className="rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-white/10 hover:text-white"
            title="适应画布"
          >
            适应
          </button>
          <button
            type="button"
            onClick={() => useCanvasStore.setState({ minimapVisible: false })}
            className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-white"
            title="关闭"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        width={MINIMAP_W}
        height={canvasH}
        viewBox={`0 0 ${MINIMAP_W} ${canvasH}`}
        className="cursor-crosshair"
        onMouseDown={onCanvasMouseDown}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD} y={PAD} width={innerW} height={innerH} rx={4} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={MINIMAP_W} height={canvasH} fill="rgba(12,12,20,0.8)" />
        <rect
          x={PAD}
          y={PAD}
          width={innerW}
          height={innerH}
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.08)"
          rx={4}
        />
        <g clipPath={`url(#${clipId})`}>
          {nodes.length === 0 ? (
            <text
              x={MINIMAP_W / 2}
              y={canvasH / 2}
              textAnchor="middle"
              fill="rgba(255,255,255,0.25)"
              fontSize={10}
            >
              暂无节点
            </text>
          ) : (
            nodes.map((node) => {
              const fallback = defaultNodeSize();
              const nw = node.width ?? fallback.width;
              const nh = node.height ?? fallback.height;
              const x = PAD + (node.position.x - bounds.minX) * scale;
              const y = PAD + (node.position.y - bounds.minY) * scale;
              const w = Math.max(4, nw * scale);
              const h = Math.max(3, nh * scale);
              const color = NODE_REGISTRY[node.type || ""]?.color || "#8b5cf6";
              const selected = node.id === selectedNodeId;
              return (
                <rect
                  key={node.id}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={1}
                  fill={color}
                  fillOpacity={selected ? 0.95 : 0.75}
                  stroke={selected ? "#fff" : "rgba(0,0,0,0.35)"}
                  strokeWidth={selected ? 1 : 0.5}
                />
              );
            })
          )}
          <rect
            className="minimap-vp-rect"
            x={vpX}
            y={vpY}
            width={vpW}
            height={vpH}
            fill="rgba(139,92,246,0.12)"
            stroke="rgba(139,92,246,0.75)"
            strokeWidth={1.5}
            rx={2}
            style={{ cursor: "grab" }}
          />
        </g>
      </svg>
    </div>
  );
}
