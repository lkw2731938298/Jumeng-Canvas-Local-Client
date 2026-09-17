/** 画布节点内部剪贴板：Ctrl+C / Ctrl+V（与系统图片粘贴并存） */

import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { WorkflowNodeData } from "@/types/workflow";

type AppNode = Node<WorkflowNodeData>;

export type CanvasNodeClipboardSnapshot = {
  nodes: AppNode[];
  edges: Edge[];
  /** 复制时选区根 id（用于粘贴后选中） */
  seedIds: string[];
};

let snapshot: CanvasNodeClipboardSnapshot | null = null;

export function hasCanvasNodeClipboard(): boolean {
  return Boolean(snapshot && snapshot.nodes.length > 0);
}

export function clearCanvasNodeClipboard(): void {
  snapshot = null;
}

export function setCanvasNodeClipboard(next: CanvasNodeClipboardSnapshot): void {
  snapshot = {
    nodes: structuredClone(next.nodes),
    edges: structuredClone(next.edges),
    seedIds: [...next.seedIds],
  };
}

export function getCanvasNodeClipboard(): CanvasNodeClipboardSnapshot | null {
  return snapshot;
}

export function defaultPasteOffset(): XYPosition {
  return { x: 48, y: 48 };
}
