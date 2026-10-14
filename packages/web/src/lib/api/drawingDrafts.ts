import { apiFetch, ApiError } from "@/lib/api/client";
import { withBasePath } from "@/lib/basePath";
import type { DrawingDocument } from "@/lib/canvas/drawingBoard/documentModel";
import { isLocalDesktop } from "@/lib/localDesktop";

export interface DrawingDraftRecord {
  projectId: string;
  nodeId: string;
  document: DrawingDocument | Record<string, never>;
  revision: number;
  ossKey: string;
  updatedAt: string;
}

/** 本机画板草稿：走 Next /api/local，不经 FastAPI :8001 */
async function localDrawingDraftFetch<T>(
  projectId: string,
  nodeId: string,
  init?: RequestInit
): Promise<T> {
  const url = withBasePath(
    `/api/local/drawing-drafts/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}`
  );
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string>) || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    content?: T;
  };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.message || `画板草稿失败（HTTP ${res.status}）`,
      body,
      body.code ? String(body.code) : null,
      body.content
    );
  }
  if (body.content !== undefined) return body.content as T;
  return body as unknown as T;
}

export async function fetchDrawingDraft(
  projectId: string,
  nodeId: string
): Promise<DrawingDraftRecord> {
  if (isLocalDesktop) {
    return localDrawingDraftFetch<DrawingDraftRecord>(projectId, nodeId);
  }
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
  if (isLocalDesktop) {
    return localDrawingDraftFetch<DrawingDraftRecord>(projectId, nodeId, {
      method: "PUT",
      body: JSON.stringify({
        document,
        expectedRevision: expectedRevision ?? undefined,
      }),
    });
  }
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
 * 直接覆盖该节点上一份草稿（同 projectId+nodeId 唯一路径）。
 */
export async function saveDrawingDraftReplace(
  projectId: string,
  nodeId: string,
  document: DrawingDocument
): Promise<DrawingDraftRecord> {
  if (isLocalDesktop) {
    return localDrawingDraftFetch<DrawingDraftRecord>(projectId, nodeId, {
      method: "PUT",
      body: JSON.stringify({ document }),
    });
  }
  return apiFetch<DrawingDraftRecord>(
    `/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`,
    {
      method: "PUT",
      body: JSON.stringify({ document }),
    }
  );
}

export async function deleteDrawingDraft(projectId: string, nodeId: string): Promise<void> {
  if (isLocalDesktop) {
    await localDrawingDraftFetch(projectId, nodeId, { method: "DELETE" });
    return;
  }
  await apiFetch(`/api/v1/drawing-drafts/projects/${projectId}/nodes/${nodeId}`, {
    method: "DELETE",
  });
}

export function isDrawingDraftConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === "REVISION_CONFLICT";
}
