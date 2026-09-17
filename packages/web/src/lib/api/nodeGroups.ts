/**
 * 节点组库 API 客户端（MySQL 元数据 + OSS 快照）。
 */
import { apiFetch } from "./client";
import type { GroupSnapshot } from "@/lib/canvas/nodeGroup";

export interface NodeGroupListItem {
  id: string;
  projectId: string;
  title: string;
  coverAssetId?: string | null;
  assetIds: string[];
  tags: string[];
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NodeGroupDetail extends NodeGroupListItem {
  snapshot: GroupSnapshot;
  ossKey?: string;
}

export type NodeGroupSort = "updated_at" | "created_at" | "title" | "node_count";

export async function listNodeGroups(
  projectId: string,
  opts?: { q?: string; tag?: string; sort?: NodeGroupSort; order?: "asc" | "desc" }
): Promise<NodeGroupListItem[]> {
  const sp = new URLSearchParams();
  if (opts?.q) sp.set("q", opts.q);
  if (opts?.tag) sp.set("tag", opts.tag);
  if (opts?.sort) sp.set("sort", opts.sort);
  if (opts?.order) sp.set("order", opts.order);
  const qs = sp.toString();
  return apiFetch<NodeGroupListItem[]>(
    `/api/v1/node-groups/projects/${projectId}${qs ? `?${qs}` : ""}`
  );
}

export async function getNodeGroup(projectId: string, groupId: string): Promise<NodeGroupDetail> {
  return apiFetch<NodeGroupDetail>(
    `/api/v1/node-groups/${groupId}?projectId=${encodeURIComponent(projectId)}`
  );
}

export async function createNodeGroup(params: {
  projectId: string;
  title: string;
  snapshot: GroupSnapshot;
  coverAssetId?: string | null;
  tags?: string[];
}): Promise<NodeGroupDetail> {
  return apiFetch<NodeGroupDetail>(`/api/v1/node-groups/projects/${params.projectId}`, {
    method: "POST",
    body: JSON.stringify({
      title: params.title,
      snapshot: params.snapshot,
      cover_asset_id: params.coverAssetId ?? null,
      asset_ids: params.snapshot.assets.map((a) => a.assetId),
      tags: params.tags ?? [],
      node_count: params.snapshot.nodes.length,
    }),
  });
}

export async function renameNodeGroup(
  projectId: string,
  groupId: string,
  title: string
): Promise<NodeGroupListItem> {
  return apiFetch<NodeGroupListItem>(`/api/v1/node-groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify({ project_id: projectId, title }),
  });
}

export async function updateNodeGroupTags(
  projectId: string,
  groupId: string,
  tags: string[]
): Promise<NodeGroupListItem> {
  return apiFetch<NodeGroupListItem>(`/api/v1/node-groups/${groupId}`, {
    method: "PATCH",
    body: JSON.stringify({ project_id: projectId, tags }),
  });
}

export async function deleteNodeGroup(projectId: string, groupId: string): Promise<void> {
  await apiFetch(`/api/v1/node-groups/${groupId}?projectId=${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

/** 跨项目深拷贝组（含素材） */
export async function copyNodeGroupToProject(params: {
  groupId: string;
  sourceProjectId: string;
  targetProjectId: string;
  title?: string;
}): Promise<NodeGroupDetail> {
  return apiFetch<NodeGroupDetail>(`/api/v1/node-groups/${params.groupId}/copy-to-project`, {
    method: "POST",
    body: JSON.stringify({
      source_project_id: params.sourceProjectId,
      target_project_id: params.targetProjectId,
      title: params.title,
    }),
  });
}
