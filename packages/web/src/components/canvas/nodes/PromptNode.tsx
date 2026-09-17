"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";

export const PromptNode = memo(function PromptNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  return (
    <BaseNode {...props} data={data} icon="MessageSquare" color="#8b5cf6" status={data.status ?? "idle"}>
      <div className="flex h-full flex-col justify-center space-y-1 text-xs">
        <div className="text-white/50">正向提示词</div>
        <div className="line-clamp-2 text-white/80">{(data.params?.positive as string) || "(空)"}</div>
        <div className="mt-2 text-white/50">反向提示词</div>
        <div className="line-clamp-2 text-white/60">{(data.params?.negative as string) || "(空)"}</div>
      </div>
    </BaseNode>
  );
});
