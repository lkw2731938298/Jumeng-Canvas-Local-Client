import type { Edge, Node } from "@xyflow/react";
import { fetchNodeText } from "@/lib/api/nodeText";
import { isReferenceTargetHandle } from "@/lib/canvas/referencePort";
import { parseTableRowsParam, rowToShotRowsJson } from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";

const TEXT_NODE_TYPES = new Set(["text_input", "prompt", "llm_text", "storyboard_grid"]);

export function findUpstreamScriptNode(
  nodeId: string,
  edges: Edge[],
  nodes: Node[]
): Node | null {
  const edge = edges.find(
    (e) => e.target === nodeId && isReferenceTargetHandle(e.targetHandle)
  );
  if (!edge) {
    const anyText = edges.find((e) => {
      if (e.target !== nodeId) return false;
      const src = nodes.find((n) => n.id === e.source);
      return src && TEXT_NODE_TYPES.has(src.type ?? "");
    });
    if (!anyText) return null;
    return nodes.find((n) => n.id === anyText.source) ?? null;
  }
  return nodes.find((n) => n.id === edge.source) ?? null;
}

export async function resolveUpstreamScriptContent(
  projectId: string,
  nodeId: string,
  edges: Edge[],
  nodes: Node[]
): Promise<{ content: string; sourceNodeId: string | null }> {
  const upstream = findUpstreamScriptNode(nodeId, edges, nodes);
  if (!upstream) return { content: "", sourceNodeId: null };

  const params = (upstream.data as WorkflowNodeData)?.params ?? {};
  let content = String(
    params.content ?? params.libraryPromptText ?? params.prompt ?? ""
  ).trim();

  if (upstream.type === "text_input" && projectId) {
    try {
      const record = await fetchNodeText(projectId, upstream.id);
      if (record?.content?.trim()) content = record.content.trim();
    } catch {
      /* use params */
    }
  }

  if (upstream.type === "storyboard_grid") {
    const rows = parseTableRowsParam(params.shots);
    if (rows.length > 0) {
      content = JSON.stringify(
        {
          shotRows: rows.map((r) => rowToShotRowsJson(r)),
        },
        null,
        2
      );
    }
  }

  return { content, sourceNodeId: upstream.id };
}
