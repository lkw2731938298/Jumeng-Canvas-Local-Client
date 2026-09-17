"use client";

import { useCanvasStore } from "@/stores/canvasStore";
import { NODE_REGISTRY } from "@/types/node-registry";
import { ParamField } from "./ParamField";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { X } from "lucide-react";
import type { WorkflowNodeData } from "@/types/workflow";

export function NodePropertyPanel() {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const nodes = useCanvasStore((s) => s.nodes);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);

  if (!selectedNodeId) return null;

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const data = node.data as WorkflowNodeData | undefined;
  if (!data) return null;

  const def = NODE_REGISTRY[node.type || ""];
  const hasOutputs = (data.outputAssets?.length ?? 0) > 0;

  return (
    <div className="glass-panel absolute right-3 top-20 z-20 flex w-72 flex-col rounded-xl" style={{ maxHeight: "calc(100vh - 140px)" }}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">节点属性</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => selectNode(null)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {def && (
          <div className="space-y-3">
            {def.params.map((param) => (
              <ParamField key={param.key} definition={param} value={data.params?.[param.key]} onChange={(v) => updateNodeParam(selectedNodeId, param.key, v)} />
            ))}
          </div>
        )}
        {hasOutputs && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">输出预览</label>
              {data.outputAssets?.map((asset, i) => (
                <img key={i} src={asset.url} alt={`output-${i}`} className="w-full rounded object-contain" />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
