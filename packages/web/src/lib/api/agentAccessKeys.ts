/** Agent Access Key 管理 API */

import { apiFetch } from "./client";

export type AgentAccessKeyItem = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  note?: string | null;
  /** 仅创建接口返回一次 */
  accessKey?: string;
};

export async function listAgentAccessKeys(): Promise<AgentAccessKeyItem[]> {
  const res = await apiFetch<{ items: AgentAccessKeyItem[] }>("/api/v1/agent/keys");
  return res.items ?? [];
}

export async function createAgentAccessKey(input?: {
  name?: string;
  note?: string;
}): Promise<AgentAccessKeyItem> {
  return apiFetch<AgentAccessKeyItem>("/api/v1/agent/keys", {
    method: "POST",
    body: JSON.stringify({
      name: input?.name ?? "default",
      note: input?.note,
    }),
  });
}

export async function revokeAgentAccessKey(keyId: string): Promise<AgentAccessKeyItem> {
  return apiFetch<AgentAccessKeyItem>(`/api/v1/agent/keys/${encodeURIComponent(keyId)}`, {
    method: "DELETE",
  });
}
