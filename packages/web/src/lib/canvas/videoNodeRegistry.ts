/** Registry of mounted video elements on canvas nodes (for frame capture). */

const refs = new Map<string, HTMLVideoElement>();

export function registerVideoNodeRef(nodeId: string, element: HTMLVideoElement | null) {
  if (element) refs.set(nodeId, element);
  else refs.delete(nodeId);
}

export function getVideoNodeRef(nodeId: string): HTMLVideoElement | undefined {
  return refs.get(nodeId);
}
