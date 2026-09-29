/**
 * 文档/链接节点：全画布同时仅允许一个网址 iframe 预览（避免多 iframe 拖垮性能）。
 */

type Listener = () => void;

let activeNodeId: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function getDocumentLinkPreviewNodeId(): string | null {
  return activeNodeId;
}

export function subscribeDocumentLinkPreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 打开某节点预览；传 null 关闭。打开时自动关掉其它节点预览。 */
export function setDocumentLinkPreviewNodeId(nodeId: string | null): void {
  const next = nodeId?.trim() || null;
  if (activeNodeId === next) return;
  activeNodeId = next;
  emit();
}
