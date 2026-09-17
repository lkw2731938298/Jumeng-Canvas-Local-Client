import type { Edge, Node } from "@xyflow/react";
import { normalizeStorageUrl } from "@/lib/api/storageUrl";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { isReferenceTargetHandle } from "@/lib/canvas/referencePort";
import type { WorkflowNodeData } from "@/types/workflow";

export type AssetLookup = (assetId: string) => { fileUrl?: string } | undefined;

const URL_PARAM_BY_NODE_TYPE: Record<string, string> = {
  image_input: "imageUrl",
  video_input: "videoUrl",
  audio_input: "audioUrl",
  document_input: "fileUrl",
};

function nodeParams(node: Node): Record<string, unknown> {
  return ((node.data as WorkflowNodeData)?.params ?? {}) as Record<string, unknown>;
}

export function urlParamKeyForNodeType(nodeType: string): string | null {
  return URL_PARAM_BY_NODE_TYPE[nodeType] ?? null;
}

/** Resolve a node's own media URL from params + optional asset manifest lookup. */
export function resolveLocalMediaUrl(
  params: Record<string, unknown>,
  urlParamKey: string,
  lookup?: AssetLookup
): string {
  const assetId = String(params.assetId ?? "");
  if (assetId && lookup) {
    const asset = lookup(assetId);
    if (asset?.fileUrl) return normalizeStorageUrl(asset.fileUrl);
  }
  return normalizeStorageUrl(String(params[urlParamKey] ?? ""));
}

function upstreamReferenceEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter((edge) => edge.target === nodeId && isReferenceTargetHandle(edge.targetHandle));
}

/**
 * Walk incoming reference edges and resolve the first available media URL.
 * Supports chained video/image nodes (A → B → C).
 */
export function resolveUpstreamMediaUrlSync(
  nodeId: string,
  urlParamKey: string,
  nodes: Node[],
  edges: Edge[],
  lookup?: AssetLookup,
  visited = new Set<string>()
): string {
  if (visited.has(nodeId)) return "";
  visited.add(nodeId);

  for (const edge of upstreamReferenceEdges(nodeId, edges)) {
    const upstream = nodes.find((n) => n.id === edge.source);
    if (!upstream) continue;

    const upstreamKey = urlParamKeyForNodeType(upstream.type ?? "") ?? urlParamKey;
    const local = resolveLocalMediaUrl(nodeParams(upstream), upstreamKey, lookup);
    if (local) return local;

    const chained = resolveUpstreamMediaUrlSync(
      upstream.id,
      upstreamKey,
      nodes,
      edges,
      lookup,
      visited
    );
    if (chained) return chained;
  }

  return "";
}

export async function resolveNodeMediaUrlWithUpstream(
  projectId: string,
  nodeId: string,
  urlParamKey: string,
  nodes: Node[],
  edges: Edge[],
  visited = new Set<string>()
): Promise<string> {
  if (visited.has(nodeId)) return "";
  visited.add(nodeId);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return "";

  const local = await resolveNodeMediaUrl(projectId, nodeParams(node), urlParamKey);
  if (local) return local;

  for (const edge of upstreamReferenceEdges(nodeId, edges)) {
    const upstream = nodes.find((n) => n.id === edge.source);
    if (!upstream) continue;

    const upstreamKey = urlParamKeyForNodeType(upstream.type ?? "") ?? urlParamKey;
    const url = await resolveNodeMediaUrlWithUpstream(
      projectId,
      upstream.id,
      upstreamKey,
      nodes,
      edges,
      visited
    );
    if (url) return url;
  }

  return "";
}
