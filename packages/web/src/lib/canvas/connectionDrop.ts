import type { HandleType } from "@xyflow/react";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { NODE_REGISTRY } from "@/types/node-registry";

export interface PendingWire {
  nodeId: string;
  handleId: string | null;
  handleType: HandleType;
}

export function buildConnectionFromPendingWire(
  pending: PendingWire,
  newNodeId: string,
  newNodeType: string,
  originNodeType?: string
) {
  const newDef = NODE_REGISTRY[newNodeType];
  const originDef = originNodeType ? NODE_REGISTRY[originNodeType] : undefined;
  const defaultOut = newDef?.outputs[0]?.id;
  const originOut = originDef?.outputs[0]?.id;

  if (pending.handleType === "source") {
    return {
      source: pending.nodeId,
      target: newNodeId,
      sourceHandle: pending.handleId ?? originOut,
      targetHandle: REFERENCE_INPUT_ID,
    };
  }

  return {
    source: newNodeId,
    target: pending.nodeId,
    sourceHandle: defaultOut,
    targetHandle: pending.handleId ?? REFERENCE_INPUT_ID,
  };
}
