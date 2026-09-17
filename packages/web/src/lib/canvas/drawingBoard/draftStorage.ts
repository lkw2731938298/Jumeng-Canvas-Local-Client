import type { DrawingDocument } from "./documentModel";
import type { DrawStroke, DrawingBackground } from "./types";

const DRAFT_VERSION_V1 = 1;
const DRAFT_VERSION_V2 = 2;
const DRAFT_KEY_PREFIX = "jm_canvas_drawing_draft:";

/** v1 扁平草稿（兼容） */
export interface DrawingBoardDraftV1 {
  version: typeof DRAFT_VERSION_V1;
  updatedAt: string;
  canvasWidth: number;
  canvasHeight: number;
  background: DrawingBackground;
  strokes: DrawStroke[];
  reference: DrawingReferenceLayer | null;
  color: string;
  brushSize: number;
  strokeOpacity: number;
  fontSize: number;
  pressureEnabled: boolean;
  symmetryEnabled: boolean;
}

/** v2 多图层草稿 */
export interface DrawingBoardDraftV2 {
  version: typeof DRAFT_VERSION_V2;
  updatedAt: string;
  document: DrawingDocument;
  color: string;
  brushSize: number;
  strokeOpacity: number;
  fontSize: number;
  pressureEnabled: boolean;
  symmetryVertical: boolean;
  symmetryHorizontal: boolean;
  cloudRevision?: number;
}

export type DrawingBoardDraft = DrawingBoardDraftV1 | DrawingBoardDraftV2;

export interface DrawingBoardSnapshot {
  document: DrawingDocument;
  color: string;
  brushSize: number;
  strokeOpacity: number;
  fontSize: number;
  pressureEnabled: boolean;
  symmetryVertical: boolean;
  symmetryHorizontal: boolean;
  cloudRevision: number;
}

/** 参考图层字段（v1 兼容导出） */
export interface DrawingReferenceLayer {
  assetId: string;
  url: string;
  opacity: number;
  includeInExport: boolean;
}

function draftKey(projectId: string, nodeId: string): string {
  return `${DRAFT_KEY_PREFIX}${projectId}:${nodeId}`;
}

export function loadDrawingBoardDraft(
  projectId: string,
  nodeId: string
): DrawingBoardDraft | null {
  if (typeof window === "undefined" || !projectId || !nodeId) return null;
  try {
    const raw = localStorage.getItem(draftKey(projectId, nodeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DrawingBoardDraft;
    if (parsed.version !== DRAFT_VERSION_V1 && parsed.version !== DRAFT_VERSION_V2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDrawingBoardDraft(
  projectId: string,
  nodeId: string,
  snapshot: DrawingBoardSnapshot
): void {
  if (typeof window === "undefined" || !projectId || !nodeId) return;
  const draft: DrawingBoardDraftV2 = {
    version: DRAFT_VERSION_V2,
    updatedAt: new Date().toISOString(),
    document: snapshot.document,
    color: snapshot.color,
    brushSize: snapshot.brushSize,
    strokeOpacity: snapshot.strokeOpacity,
    fontSize: snapshot.fontSize,
    pressureEnabled: snapshot.pressureEnabled,
    symmetryVertical: snapshot.symmetryVertical,
    symmetryHorizontal: snapshot.symmetryHorizontal,
    cloudRevision: snapshot.cloudRevision,
  };
  try {
    localStorage.setItem(draftKey(projectId, nodeId), JSON.stringify(draft));
  } catch {
    /* 存储满时静默失败 */
  }
}

export function clearDrawingBoardDraft(projectId: string, nodeId: string): void {
  if (typeof window === "undefined" || !projectId || !nodeId) return;
  localStorage.removeItem(draftKey(projectId, nodeId));
}

export function draftHasContent(draft: DrawingBoardDraft): boolean {
  if (draft.version === DRAFT_VERSION_V2) {
    const doc = draft.document;
    if (doc.background !== "transparent") return true;
    return doc.layers.some(
      (l) => l.reference != null || l.strokes.length > 0
    );
  }
  return (
    draft.strokes.length > 0 ||
    draft.reference !== null ||
    draft.background !== "transparent"
  );
}
