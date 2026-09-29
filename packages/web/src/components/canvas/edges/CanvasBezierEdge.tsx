"use client";

import { memo, useEffect, useState } from "react";
import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";

import { absoluteHandleCenter } from "@/lib/canvas/handleCenter";
import { useCanvasStore } from "@/stores/canvasStore";

/** 连线成功短闪时长 */
const CONNECT_FLASH_MS = 700;

function edgeHasConnectFlash(data: EdgeProps["data"]): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as { connectFlash?: boolean; connectFlashAt?: number };
  return Boolean(d.connectFlash) || typeof d.connectFlashAt === "number";
}

/**
 * 流光连线（对齐 Chokcoco Line Animation Effect / jORErXW）：
 * 底线 + 短亮段（pathLength=1）沿路径循环 + 头部更亮光斑层。
 */
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
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const flagged = edgeHasConnectFlash(data);
  const [flashing, setFlashing] = useState(flagged);

  useEffect(() => {
    if (!flagged) return;
    setFlashing(true);
    const clearTimer = window.setTimeout(() => {
      setFlashing(false);
      useCanvasStore.setState((state) => ({
        edges: state.edges.map((edge) => {
          if (edge.id !== id) return edge;
          const prev = (edge.data && typeof edge.data === "object" ? edge.data : {}) as Record<
            string,
            unknown
          >;
          if (!prev.connectFlash && prev.connectFlashAt == null) return edge;
          const { connectFlash: _a, connectFlashAt: _b, ...rest } = prev;
          return { ...edge, data: Object.keys(rest).length ? rest : undefined };
        }),
      }));
    }, CONNECT_FLASH_MS);
    return () => window.clearTimeout(clearTimer);
  }, [flagged, id, data]);

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

  const stroke = (style?.stroke as string | undefined) || "rgba(167, 139, 250, 0.72)";

  return (
    <>
      {/* 常驻柔光底 */}
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={7}
        strokeLinecap="round"
        opacity={0.2}
        style={{ filter: "blur(2.5px)" }}
        pointerEvents="none"
      />

      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} interactionWidth={20} />

      {/* 流光体：短亮 + 长间隔（Chokcoco: dasharray 亮段, 空隙） */}
      <path
        d={edgePath}
        fill="none"
        pathLength={1}
        stroke="#c7d2fe"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="0.16 0.84"
        className="canvas-edge-flow"
        pointerEvents="none"
      />
      {/* 流光头：更短更亮 + drop-shadow */}
      <path
        d={edgePath}
        fill="none"
        pathLength={1}
        stroke="#ffffff"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="0.05 0.95"
        className="canvas-edge-flow-head"
        pointerEvents="none"
      />

      {flashing ? (
        <path
          d={edgePath}
          fill="none"
          stroke="#e0e7ff"
          strokeWidth={4}
          strokeLinecap="round"
          className="canvas-edge-connect-flash"
          style={{ filter: "drop-shadow(0 0 8px rgba(224, 231, 255, 0.95))" }}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
});
