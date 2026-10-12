/** Registry of mounted audio elements on canvas nodes (for trim duration). */

const refs = new Map<string, HTMLAudioElement>();

export function registerAudioNodeRef(nodeId: string, element: HTMLAudioElement | null) {
  if (element) refs.set(nodeId, element);
  else refs.delete(nodeId);
}

export function getAudioNodeRef(nodeId: string): HTMLAudioElement | undefined {
  return refs.get(nodeId);
}
