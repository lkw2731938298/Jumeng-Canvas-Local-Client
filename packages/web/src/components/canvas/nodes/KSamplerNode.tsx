"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";

export const KSamplerNode = memo(function KSamplerNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  const p = data.params ?? {};
  const w = p.width as number | undefined;
  const h = p.height as number | undefined;
  return (
    <BaseNode {...props} data={data} icon="Sparkles" color="#8b5cf6" status={data.status ?? "idle"}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-white/50">Seed</span><span className="text-white/80 text-right">{String(p.seed === -1 ? "随机" : p.seed)}</span>
        <span className="text-white/50">步数</span><span className="text-white/80 text-right">{String(p.steps ?? 20)}</span>
        <span className="text-white/50">CFG</span><span className="text-white/80 text-right">{String(p.cfg ?? 7)}</span>
        <span className="text-white/50">尺寸</span><span className="text-white/80 text-right">{w ?? 1024}x{h ?? 1024}</span>
        <span className="text-white/50">采样器</span><span className="text-white/80 text-right">{String(p.sampler ?? "euler")}</span>
        <span className="text-white/50">调度器</span><span className="text-white/80 text-right">{String(p.scheduler ?? "normal")}</span>
        {data.status === "running" && data.progress !== undefined && (
          <div className="col-span-2 mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${data.progress}%` }} />
          </div>
        )}
      </div>
    </BaseNode>
  );
});
