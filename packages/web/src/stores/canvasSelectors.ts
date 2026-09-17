import type { Edge } from "@xyflow/react";

/** Rebuild set of node ids that participate in at least one edge. */
export function buildConnectedNodeIds(edges: Edge[]): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.source) ids.add(e.source);
    if (e.target) ids.add(e.target);
  }
  return ids;
}

export function isNodeConnected(id: string, connectedNodeIds: Set<string>): boolean {
  return connectedNodeIds.has(id);
}
