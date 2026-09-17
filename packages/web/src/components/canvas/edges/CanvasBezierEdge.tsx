"use client";

import { memo } from "react";
import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";

import { absoluteHandleCenter } from "@/lib/canvas/handleCenter";
import { useCanvasStore } from "@/stores/canvasStore";

export const CanvasBezierEdge = memo(function CanvasBezierEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  style,
  markerEnd,
}: EdgeProps) {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourcePt = absoluteHandleCenter(sourceNode, "source", sourceHandleId) ?? {
    x: sourceX,
    y: sourceY,
  };
  const targetPt = absoluteHandleCenter(targetNode, "target", targetHandleId) ?? {
    x: targetX,
    y: targetY,
  };

  const [edgePath] = getBezierPath({
    sourceX: sourcePt.x,
    sourceY: sourcePt.y,
    sourcePosition,
    targetX: targetPt.x,
    targetY: targetPt.y,
    targetPosition,
  });

  const showFlow = !!selectedNodeId && (source === selectedNodeId || target === selectedNodeId);

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} interactionWidth={20} />
      {showFlow && (
        <path
          d={edgePath}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="48 96"
          className="canvas-edge-flow"
          pointerEvents="none"
        />
      )}
    </>
  );
});
