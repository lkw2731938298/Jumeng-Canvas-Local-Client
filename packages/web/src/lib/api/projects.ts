import { withBasePath } from "@/lib/basePath";
import { isLocalDesktop } from "@/lib/localDesktop";
import { localStore } from "@/lib/local/store";
import { apiFetch, ApiError } from "./client";
import type { Project } from "@/types";

function metaToProject(meta: {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  coverUrl?: string | null;
}): Project {
  return {
    id: meta.id,
    projectNo: meta.id.slice(0, 8),
    title: meta.title,
    description: "",
    coverUrl: meta.coverUrl || undefined,
    ownerId: "local-user",
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    role: "owner",
  };
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function convertKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [snakeToCamel(k), convertKeys(v)])
    );
  }
  return obj;
}

function authHeaders(): Record<string, string> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("jm_canvas_session_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listProjects(): Promise<Project[]> {
  if (isLocalDesktop) {
    const list = await localStore().listProjects();
    return list.map(metaToProject);
  }
  return apiFetch<Project[]>("/api/v1/projects");
}

export async function getProject(id: string): Promise<Project> {
  if (isLocalDesktop) {
    const meta = await localStore().getProject(id);
    if (!meta) throw new ApiError(404, "项目不存在");
    return metaToProject(meta);
  }
  return apiFetch<Project>(`/api/v1/projects/${id}`);
}

export async function createProject(title: string): Promise<Project> {
  if (isLocalDesktop) {
    const meta = await localStore().createProject(title);
    return metaToProject(meta);
  }
  return apiFetch<Project>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function updateProject(
  id: string,
  data: Partial<Pick<Project, "title" | "description" | "coverUrl">>
): Promise<Project> {
  if (isLocalDesktop) {
    const meta = await localStore().updateProject(id, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl } : {}),
    });
    return metaToProject(meta);
  }
  return apiFetch<Project>(`/api/v1/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.coverUrl !== undefined ? { coverUrl: data.coverUrl } : {}),
    }),
  });
}

/** 读取 File 为纯 base64（不含 data: 前缀） */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error || new Error("读取封面文件失败"));
    reader.readAsDataURL(file);
  });
}

/** 从本机素材地址中取出文件名（/api/local/asset?...&file=xxx） */
function localAssetFileName(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/api/local/asset")) return null;
  try {
    return new URL(url, "http://local").searchParams.get("file");
  } catch {
    return null;
  }
}

/**
 * 本机封面：写入项目 assets 目录，文件名以 "." 开头，素材面板扫描时会跳过，不会混进素材列表。
 * 每次上传用新文件名，避免浏览器缓存旧封面；成功后删掉上一张封面文件。
 */
async function uploadLocalProjectCover(projectId: string, file: File): Promise<Project> {
  if (!file.type.startsWith("image/")) throw new ApiError(400, "封面只支持图片文件");
  const store = localStore();
  const prev = await store.getProject(projectId);
  if (!prev) throw new ApiError(404, "项目不存在");
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "png").toLowerCase();
  const { fileUrl } = await store.writeAsset(
    projectId,
    `.cover-${Date.now()}.${ext}`,
    await fileToBase64(file)
  );
  const meta = await store.updateProject(projectId, { coverUrl: fileUrl });
  const oldFile = localAssetFileName(prev.coverUrl);
  if (oldFile && oldFile !== localAssetFileName(fileUrl)) {
    await store.deleteAsset(projectId, oldFile).catch(() => undefined);
  }
  return metaToProject(meta);
}

export async function uploadProjectCover(projectId: string, file: File): Promise<Project> {
  if (isLocalDesktop) return uploadLocalProjectCover(projectId, file);
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(withBasePath(`/api/projects/${projectId}/cover`), {
    method: "POST",
    body: fd,
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const record = body as { detail?: string; message?: string; error?: string };
    throw new ApiError(
      res.status,
      record.detail || record.error || record.message || "封面上传失败"
    );
  }
  const text = await res.text();
  const raw = JSON.parse(text) as unknown;
  // 兼容 SEC-042 { code, content } 与直接 Project JSON
  let payload: unknown = raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const code = rec.code != null ? String(rec.code) : null;
    if ((code === "0000" || code === "OK") && rec.content !== undefined) {
      payload = rec.content;
    }
  }
  return convertKeys(payload) as Project;
}

export async function deleteProject(id: string): Promise<void> {
  if (isLocalDesktop) {
    await localStore().deleteProject(id);
    return;
  }
  return apiFetch(`/api/v1/projects/${id}`, { method: "DELETE" });
}

/** 回收站列表（软删除项目） */
export async function listTrashProjects(): Promise<Project[]> {
  if (isLocalDesktop) return [];
  return apiFetch<Project[]>("/api/v1/projects/trash");
}

/** 从回收站恢复 */
export async function restoreProject(id: string): Promise<Project> {
  return apiFetch<Project>(`/api/v1/projects/${id}/restore`, { method: "POST" });
}

/** 永久删除（仅回收站内） */
export async function purgeProject(id: string): Promise<void> {
  return apiFetch(`/api/v1/projects/${id}/permanent`, { method: "DELETE" });
}

export interface ProjectBatchResult {
  okCount: number;
  failedIds: string[];
}

async function batchProjectAction(
  path: "hide" | "restore" | "purge",
  projectIds: string[]
): Promise<ProjectBatchResult> {
  return apiFetch<ProjectBatchResult>(`/api/v1/projects/batch/${path}`, {
    method: "POST",
    body: JSON.stringify({ projectIds }),
  });
}

/** 批量移入回收站 */
export function batchHideProjects(projectIds: string[]) {
  return batchProjectAction("hide", projectIds);
}

/** 批量恢复 */
export function batchRestoreProjects(projectIds: string[]) {
  return batchProjectAction("restore", projectIds);
}

/** 批量永久删除 */
export function batchPurgeProjects(projectIds: string[]) {
  return batchProjectAction("purge", projectIds);
}

export interface ProjectMember {
  userId: string;
  displayName: string;
  phoneMasked: string;
  status?: "pending" | "active";
  invitedAt?: string;
  firstAccessedAt?: string | null;
  lastAccessedAt?: string | null;
}

export interface ProjectMemberLookup {
  userId: string;
  displayName: string;
  phoneMasked: string;
}

export interface ProjectBillingBalance {
  creditsEnabled: boolean;
  balance: number | null;
  availableForModel?: number | null;
  ownerDisplayName: string;
  isCollaborator: boolean;
}

export async function listSharedProjects(): Promise<Project[]> {
  if (isLocalDesktop) return [];
  return apiFetch<Project[]>("/api/v1/projects/shared");
}

export interface ProjectInvite {
  projectId: string;
  projectNo?: string | null;
  title: string;
  coverUrl?: string | null;
  inviterDisplayName: string;
  invitedAt?: string;
}

export async function listProjectInvites(): Promise<ProjectInvite[]> {
  const raw = await apiFetch<ProjectInvite[] | ProjectInvite>(
    "/api/v1/projects/pending-invites"
  );
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "projectId" in raw) return [raw];
  return [];
}

export async function getProjectInviteCount(): Promise<number> {
  const res = await apiFetch<{ count?: number } | number>(
    "/api/v1/projects/invites/count"
  );
  if (typeof res === "number") return res;
  return res.count ?? 0;
}

export async function acceptProjectInvite(projectId: string): Promise<Project> {
  return apiFetch<Project>(`/api/v1/projects/invites/${projectId}/accept`, {
    method: "POST",
  });
}

export async function declineProjectInvite(projectId: string): Promise<void> {
  return apiFetch(`/api/v1/projects/invites/${projectId}/decline`, {
    method: "POST",
  });
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return apiFetch<ProjectMember[]>(`/api/v1/projects/${projectId}/members`);
}

export async function lookupProjectMember(
  projectId: string,
  phone: string
): Promise<ProjectMemberLookup> {
  const search = new URLSearchParams({ phone });
  return apiFetch<ProjectMemberLookup>(
    `/api/v1/projects/${projectId}/members/lookup?${search.toString()}`
  );
}

export async function inviteProjectMember(
  projectId: string,
  userId: string
): Promise<ProjectMember> {
  return apiFetch<ProjectMember>(`/api/v1/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<void> {
  return apiFetch(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

export async function leaveSharedProject(projectId: string): Promise<void> {
  return apiFetch(`/api/v1/projects/${projectId}/members/leave`, {
    method: "POST",
  });
}

export async function recordProjectAccess(projectId: string): Promise<void> {
  return apiFetch(`/api/v1/projects/${projectId}/access`, { method: "POST" });
}

export async function getProjectBillingBalance(
  _projectId: string,
  _model?: string
): Promise<ProjectBillingBalance> {
  // 开源本地版：无项目算力池
  return {
    balance: null,
    availableForModel: null,
    creditsEnabled: false,
    ownerDisplayName: "",
    isCollaborator: false,
  };
}

export interface ProjectPresenceUser {
  userId: string;
  displayName: string;
}

export interface ProjectPresence {
  users: ProjectPresenceUser[];
}

export async function getProjectPresence(_projectId: string): Promise<ProjectPresence> {
  return { users: [] };
}

export async function touchProjectPresence(_projectId: string): Promise<void> {
  return;
}

export async function clearProjectPresence(_projectId: string): Promise<void> {
  return;
}

export interface ProjectCollaborationSettings {
  collaboratorDailyCap: number | null;
  collaboratorTotalCap: number | null;
  collaboratorApprovalThreshold: number | null;
  dailySpent: number;
  totalSpent: number;
  pendingApprovalCount: number;
}

export interface ProjectPendingApproval {
  jobId: string;
  nodeId?: string | null;
  actorUserId?: string | null;
  actorDisplayName: string;
  model?: string | null;
  modelDisplayName?: string | null;
  category?: string | null;
  creditCost: number;
  createdAt?: string;
}

export async function getCollaborationSettings(
  projectId: string
): Promise<ProjectCollaborationSettings> {
  return apiFetch<ProjectCollaborationSettings>(
    `/api/v1/projects/${projectId}/collaboration-settings`
  );
}

export async function updateCollaborationSettings(
  projectId: string,
  data: {
    collaboratorDailyCap?: number | null;
    collaboratorTotalCap?: number | null;
    collaboratorApprovalThreshold?: number | null;
  }
): Promise<ProjectCollaborationSettings> {
  return apiFetch<ProjectCollaborationSettings>(
    `/api/v1/projects/${projectId}/collaboration-settings`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...(data.collaboratorDailyCap !== undefined
          ? { collaboratorDailyCap: data.collaboratorDailyCap }
          : {}),
        ...(data.collaboratorTotalCap !== undefined
          ? { collaboratorTotalCap: data.collaboratorTotalCap }
          : {}),
        ...(data.collaboratorApprovalThreshold !== undefined
          ? { collaboratorApprovalThreshold: data.collaboratorApprovalThreshold }
          : {}),
      }),
    }
  );
}

export async function listPendingApprovals(
  projectId: string
): Promise<ProjectPendingApproval[]> {
  return apiFetch<ProjectPendingApproval[]>(
    `/api/v1/projects/${projectId}/pending-approvals`
  );
}

export async function approvePendingGeneration(
  projectId: string,
  jobId: string
): Promise<void> {
  return apiFetch(`/api/v1/projects/${projectId}/approvals/${jobId}/approve`, {
    method: "POST",
  });
}

export async function rejectPendingGeneration(
  projectId: string,
  jobId: string
): Promise<void> {
  return apiFetch(`/api/v1/projects/${projectId}/approvals/${jobId}/reject`, {
    method: "POST",
  });
}
