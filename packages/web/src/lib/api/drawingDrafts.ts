import { apiFetch, ApiError } from "@/lib/api/client";
import type { DrawingDocument } from "@/lib/canvas/drawingBoard/documentModel";

export interface DrawingDraftRecord {
  projectId: string;
  nodeId: string;
  document: DrawingDocument | Record<string, never>;
  revision: number;
  ossKey: string;
  updatedAt: string;
}

export async function fetchDrawingDraft(
  projectId: string,
  nodeId: string
): Promise<DrawingDraftRecord> {
  // 须带 /api 前缀，与其它 apiFetch 一致（经 /api/proxy 转到 FastAPI /api/v1/...）
  return apiFetch<DrawingDraftRecord>(
    `/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`
  );
}

export async function saveDrawingDraft(
  projectId: string,
  nodeId: string,
  document: DrawingDocument,
  expectedRevision?: number
): Promise<DrawingDraftRecord> {
  return apiFetch<DrawingDraftRecord>(
    `/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        document,
        expectedRevision: expectedRevision ?? undefined,
      }),
    }
  );
}

/**
 * 显式保存（应用到节点 / 取消保存并返回）：不传 expectedRevision，
 * 直接覆盖该节点 OSS 上一份草稿（同 projectId+nodeId 唯一路径）。
 */
export async function saveDrawingDraftReplace(
  projectId: string,
  nodeId: string,
  document: DrawingDocument
): Promise<DrawingDraftRecord> {
  return apiFetch<DrawingDraftRecord>(
    `/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`,
    {
      method: "PUT",
      body: JSON.stringify({ document }),
    }
  );
}

export async function deleteDrawingDraft(projectId: string, nodeId: string): Promise<void> {
  await apiFetch(`/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`, {
    method: "DELETE",
  });
}

export function isDrawingDraftConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === "REVISION_CONFLICT";
}
