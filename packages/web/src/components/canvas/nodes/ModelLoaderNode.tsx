"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";

export const ModelLoaderNode = memo(function ModelLoaderNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  const checkpoint = data.params?.checkpoint as string ?? "-";
  const label = ({ sd_xl_base: "SD XL Base", sd_xl_turbo: "SD XL Turbo", flux_dev: "Flux Dev", flux_schnell: "Flux Schnell" } as Record<string, string>)[checkpoint] || checkpoint;
  return (
    <BaseNode {...props} data={data} icon="Box" color="#3b82f6" status={data.status ?? "idle"}>
      <div className="space-y-1 text-xs">
        <div className="text-white/50">模型</div>
        <div className="text-white/80">{label}</div>
      </div>
    </BaseNode>
  );
});
