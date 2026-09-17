"use client";

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Clapperboard } from "lucide-react";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";

export const DirectorStageNode = memo(function DirectorStageNode(props: NodeProps) {
  const data = props.data as WorkflowNodeData;
  const status = data.status ?? "idle";
  const params = data.params ?? {};
  const { url: screenshotUrl } = useNodeAssetMedia(props.id, { urlParamKey: "imageUrl" });
  const channelCount = [
    params.assetId || params.imageUrl,
    params.depthAssetId || params.depthUrl,
    params.normalAssetId || params.normalUrl,
    params.segmentationAssetId || params.segmentationUrl,
    params.openposeAssetId || params.openposeUrl,
  ].filter(Boolean).length;

  return (
    <BaseNode
      {...props}
      data={data}
      icon="Clapperboard"
      color="#6366f1"
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
          {channelCount > 1 ? (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[8px] text-indigo-200">
              {channelCount === 5 ? "五通道" : `${channelCount} 通道`}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center">
          <Clapperboard className="h-8 w-8 text-indigo-300/50" />
          <p className="text-[10px] leading-relaxed text-white/45">
            双击打开导演台页面进行 3D 构图
          </p>
        </div>
      )}
    </BaseNode>
  );
});
