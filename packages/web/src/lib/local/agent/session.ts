/**
 * 本地 Agent 会话：按项目持久化多会话（新建 / 历史）；主路径走 Tool Calling Runtime。
 */

import type { QueryClient } from "@tanstack/react-query";

import type { AgentNodeRef } from "@/lib/canvas/agentNodeRefs";
import { localStore } from "@/lib/local/store";
import type { LocalModel } from "@/lib/local/types";
import type { LocalChatToolCall } from "@/lib/local/generate";
import type { LocalAgentOpResult } from "./executor";
import { runAgentRuntimeTurn } from "./runtime";
import type { AgentMemory } from "./memory";

export type { AgentMemory };

export type LocalAgentMessage = {
  id: string;
  /** tool = 工具/画布操作执行结果 */
  role: "user" | "assistant" | "tool";
  /** 展示文本 */
  content: string;
  /** assistant 原始回复（兼容旧 ops 路径） */
  raw?: string;
  /** 用户消息引用的画布节点 */
  refs?: AgentNodeRef[];
  /** tool 消息：各操作结果 */
  results?: LocalAgentOpResult[];
  /** OpenAI tool_call_id（Runtime 回传用） */
  toolCallId?: string;
  /** assistant 发出的 tool_calls */
  toolCalls?: LocalChatToolCall[];
  createdAt: string;
};

/** 单条对话（可在历史中切换） */
export type LocalAgentSession = {
  id: string;
  /** 侧栏标题；默认可由首条用户消息生成 */
  title: string;
  version: 1 | 2 | 3;
  modelId?: string;
  activeSkillSlug?: string | null;
  memory?: AgentMemory;
  messages: LocalAgentMessage[];
  createdAt: string;
  updatedAt: string;
};

/** 项目下的会话收件箱 */
export type LocalAgentInbox = {
  version: 3;
  activeId: string;
  sessions: LocalAgentSession[];
};

/** 持久化保留的最大消息数 / 会话数 */
const MAX_STORED_MESSAGES = 200;
const MAX_SESSIONS = 40;

export function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptySession(partial?: Partial<LocalAgentSession>): LocalAgentSession {
  const now = new Date().toISOString();
  return {
    id: newMessageId(),
    title: "新对话",
    version: 3,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function emptyInbox(): LocalAgentInbox {
  const s = emptySession();
  return { version: 3, activeId: s.id, sessions: [s] };
}

/** 从首条用户消息提炼标题 */
export function titleFromMessages(messages: LocalAgentMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "新对话";
  const t = first.content.replace(/\s+/g, " ").trim();
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

function parseMemory(raw: unknown): AgentMemory | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as AgentMemory;
  if (!Array.isArray(m.notes)) return undefined;
  return {
    notes: m.notes.map(String).filter(Boolean),
    updatedAt: String(m.updatedAt || ""),
  };
}

function coerceSession(raw: Partial<LocalAgentSession> | Record<string, unknown>): LocalAgentSession {
  const now = new Date().toISOString();
  const messages = Array.isArray(raw.messages) ? (raw.messages as LocalAgentMessage[]) : [];
  const id = typeof raw.id === "string" && raw.id ? raw.id : newMessageId();
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : titleFromMessages(messages);
  return {
    id,
    title,
    version: 3,
    modelId: typeof raw.modelId === "string" ? raw.modelId : undefined,
    activeSkillSlug:
      typeof raw.activeSkillSlug === "string"
        ? raw.activeSkillSlug
        : raw.activeSkillSlug === null
          ? null
          : undefined,
    memory: parseMemory(raw.memory),
    messages,
    createdAt: String(raw.createdAt || raw.updatedAt || now),
    updatedAt: String(raw.updatedAt || now),
  };
}

/** 兼容旧版单会话 JSON → inbox */
export function normalizeInbox(raw: unknown): LocalAgentInbox {
  if (!raw || typeof raw !== "object") return emptyInbox();
  const obj = raw as Record<string, unknown>;

  // v3 inbox
  if (obj.version === 3 && Array.isArray(obj.sessions)) {
    const sessions = (obj.sessions as unknown[])
      .map((s) => coerceSession((s || {}) as Record<string, unknown>))
      .filter(Boolean);
    if (!sessions.length) return emptyInbox();
    const activeId =
      typeof obj.activeId === "string" && sessions.some((s) => s.id === obj.activeId)
        ? obj.activeId
        : sessions[0].id;
    return { version: 3, activeId, sessions: sessions.slice(0, MAX_SESSIONS) };
  }

  // 旧版单会话（有 messages 数组）
  if (Array.isArray(obj.messages)) {
    const s = coerceSession(obj);
    return { version: 3, activeId: s.id, sessions: [s] };
  }

  return emptyInbox();
}

export function getActiveSession(inbox: LocalAgentInbox): LocalAgentSession {
  return inbox.sessions.find((s) => s.id === inbox.activeId) || inbox.sessions[0] || emptySession();
}

export function upsertActiveSession(
  inbox: LocalAgentInbox,
  updater: (prev: LocalAgentSession) => LocalAgentSession
): LocalAgentInbox {
  const cur = getActiveSession(inbox);
  const next = updater(cur);
  const titled =
    next.title === "新对话" && next.messages.some((m) => m.role === "user")
      ? { ...next, title: titleFromMessages(next.messages), updatedAt: new Date().toISOString() }
      : { ...next, updatedAt: new Date().toISOString() };
  const sessions = inbox.sessions.map((s) => (s.id === cur.id ? titled : s));
  // 活跃会话置顶
  const rest = sessions.filter((s) => s.id !== titled.id);
  return {
    version: 3,
    activeId: titled.id,
    sessions: [titled, ...rest].slice(0, MAX_SESSIONS),
  };
}

export function createNewSession(inbox: LocalAgentInbox, seed?: Partial<LocalAgentSession>): LocalAgentInbox {
  const active = getActiveSession(inbox);
  const s = emptySession({
    modelId: seed?.modelId ?? active.modelId,
    activeSkillSlug: seed?.activeSkillSlug ?? active.activeSkillSlug ?? null,
  });
  return {
    version: 3,
    activeId: s.id,
    sessions: [s, ...inbox.sessions].slice(0, MAX_SESSIONS),
  };
}

export function switchSession(inbox: LocalAgentInbox, sessionId: string): LocalAgentInbox {
  if (!inbox.sessions.some((s) => s.id === sessionId)) return inbox;
  const hit = inbox.sessions.find((s) => s.id === sessionId)!;
  const rest = inbox.sessions.filter((s) => s.id !== sessionId);
  return { version: 3, activeId: sessionId, sessions: [hit, ...rest] };
}

export function deleteSession(inbox: LocalAgentInbox, sessionId: string): LocalAgentInbox {
  const sessions = inbox.sessions.filter((s) => s.id !== sessionId);
  if (!sessions.length) return emptyInbox();
  const activeId = inbox.activeId === sessionId ? sessions[0].id : inbox.activeId;
  return { version: 3, activeId, sessions };
}

export async function loadAgentInbox(projectId: string): Promise<LocalAgentInbox> {
  const api = localStore();
  if (typeof api.readAgentSession !== "function") return emptyInbox();
  try {
    const raw = await api.readAgentSession(projectId);
    return normalizeInbox(raw);
  } catch {
    return emptyInbox();
  }
}

/** @deprecated 用 loadAgentInbox；保留兼容 */
export async function loadAgentSession(projectId: string): Promise<LocalAgentSession> {
  const inbox = await loadAgentInbox(projectId);
  return getActiveSession(inbox);
}

export async function saveAgentInbox(projectId: string, inbox: LocalAgentInbox): Promise<void> {
  const api = localStore();
  if (typeof api.writeAgentSession !== "function") return;
  const trimmed: LocalAgentInbox = {
    version: 3,
    activeId: inbox.activeId,
    sessions: inbox.sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      version: 3,
      messages: s.messages.slice(-MAX_STORED_MESSAGES),
      updatedAt: s.updatedAt || new Date().toISOString(),
    })),
  };
  await api.writeAgentSession(projectId, trimmed);
}

/** @deprecated 用 saveAgentInbox */
export async function saveAgentSession(projectId: string, session: LocalAgentSession): Promise<void> {
  const inbox = await loadAgentInbox(projectId);
  const sessions = [
    {
      ...session,
      version: 3 as const,
      messages: session.messages.slice(-MAX_STORED_MESSAGES),
      updatedAt: new Date().toISOString(),
    },
    ...inbox.sessions.filter((s) => s.id !== session.id),
  ].slice(0, MAX_SESSIONS);
  await saveAgentInbox(projectId, { version: 3, activeId: session.id, sessions });
}

/**
 * 跑一轮对话（Tool Calling Runtime；不支持 tools 时自动降级 ops）。
 */
export async function runLocalAgentTurn(opts: {
  projectId: string;
  modelId: string;
  models: LocalModel[];
  history: LocalAgentMessage[];
  userMessage: LocalAgentMessage;
  queryClient?: QueryClient;
  skillPrompt?: string;
  activeSkillSlug?: string | null;
  memory?: AgentMemory;
  onMessage: (msg: LocalAgentMessage) => void;
  onMemoryUpdate?: (memory: AgentMemory) => void;
}): Promise<void> {
  await runAgentRuntimeTurn(opts);
}
