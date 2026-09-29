"use client";

/**
 * 导演台画布节点：预览最近一次构图截图，双击进入完整导演台。
 * 不再展示「五通道」角标（多通道导出已从镜头页下线）。
 */

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Clapperboard, Maximize2 } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";

export const DirectorStageNode = memo(function DirectorStageNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  const status = data.status ?? "idle";
  const { url: screenshotUrl } = useNodeAssetMedia(props.id, { urlParamKey: "imageUrl" });

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Clapperboard"
      color="#818cf8"
      status={status}
      bodyFlush={!!screenshotUrl}
    >
      {screenshotUrl ? (
        <div className="relative h-full w-full">
          <img
            src={screenshotUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-2.5 pb-2 pt-8">
            <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-100/90 backdrop-blur-sm">
              <Clapperboard className="h-3 w-3 opacity-80" />
              导演台
            </span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-white/55">
              <Maximize2 className="h-3 w-3" />
              双击进入
            </span>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2.5 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.12),transparent_65%)] px-4 py-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-300/20 bg-indigo-500/10">
            <Clapperboard className="h-5 w-5 text-indigo-300/80" />
          </div>
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-white/70">3D 构图 · 机位</p>
            <p className="text-[10px] leading-relaxed text-white/40">双击打开导演台，摆人物与镜头</p>
          </div>
        </div>
      )}
    </BaseNode>
  );
});
