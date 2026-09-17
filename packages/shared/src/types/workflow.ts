import type { NodeStatus, PortType } from "./node-registry";

export interface WorkflowNodeData {
  [key: string]: unknown;
  label: string;
  params: Record<string, unknown>;
  inputs: { id: string; type: PortType; label: string }[];
  outputs: { id: string; type: PortType; label: string }[];
  status: NodeStatus;
  progress?: number;
  outputAssets?: { type: string; url: string }[];
  error?: string;
}

export interface WorkflowEdgeData {
  sourcePort: string;
  targetPort: string;
}

export interface Workflow {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  flowJson: string;
  version: number;
  revision: number;
  nodeCount: number;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  projectNo: string;
  title: string;
  description?: string;
  coverUrl?: string;
  workflowCount?: number;
  createdAt: string;
  updatedAt: string;
  role?: "owner" | "editor";
  ownerId?: string;
  ownerDisplayName?: string;
}

export interface User {
  id: string;
  userNo?: string;
  phone?: string;
  displayName: string;
  avatarUrl?: string;
  computePower?: number;
}

export interface SsoLoginResponse {
  sessionToken: string;
  user: User;
  /** 注册携带邀请码时返回发奖摘要 */
  inviteReward?: {
    inviteeAmount?: number;
    inviterPending?: boolean;
  } | null;
  registerBonus?: {
    amount?: number;
  } | null;
}
