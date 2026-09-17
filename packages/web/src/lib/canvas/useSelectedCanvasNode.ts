import type { Node } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

export type CanvasAppNode = Node<WorkflowNodeData>;

/** Selected node only — re-renders when that node (or selection) changes, not when others move. */
export function useSelectedCanvasNode(): CanvasAppNode | null {
  return useCanvasStore((s) => {
    const id = s.selectedNodeId;
    if (!id) return null;
    return s.nodes.find((n) => n.id === id) ?? null;
  });
}

export function useCanvasNode(nodeId: string | null | undefined): CanvasAppNode | null {
  return useCanvasStore((s) => {
    if (!nodeId) return null;
    return s.nodes.find((n) => n.id === nodeId) ?? null;
  });
}
