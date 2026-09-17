import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import { useCanvasStore } from "@/stores/canvasStore";

export function directorStageHref(projectId: string, nodeId: string): string {
  return `/${projectId}/director/${encodeURIComponent(nodeId)}`;
}

export function canvasHref(projectId: string): string {
  return `/${projectId}`;
}

/** Find or create a director_stage node in the current workflow. */
export function ensureDirectorStageNodeId(): string | null {
  const state = useCanvasStore.getState();
  const selected = state.selectedNodeId
    ? state.nodes.find((n) => n.id === state.selectedNodeId)
    : null;
  if (selected?.type === "director_stage") return selected.id;

  const existing = state.nodes.filter((n) => n.type === "director_stage");
  if (existing.length > 0) return existing[existing.length - 1]!.id;

  const position = resolveAddNodePosition("director_stage", state.nodes, {
    viewport: state.viewport,
    paneSize: state.flowPaneSize,
    selectedNodeId: state.selectedNodeId,
  });
  state.addNode("director_stage", position);
  return useCanvasStore.getState().nodes.filter((n) => n.type === "director_stage").at(-1)?.id ?? null;
}

export async function navigateToDirectorStage(
  projectId: string,
  nodeId: string,
  push: (href: string) => void
): Promise<void> {
  await useCanvasStore.getState().saveWorkflow(true);
  push(directorStageHref(projectId, nodeId));
}
