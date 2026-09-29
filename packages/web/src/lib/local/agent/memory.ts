/**
 * 本地 Agent 轻量记忆：滚动摘要，不额外调模型。
 * 长对话时把较早轮次压成要点，注入 system，避免只靠截断丢上下文。
 */

import type { LocalAgentMessage } from "./session";

/** 写入会话的记忆结构 */
export type AgentMemory = {
  /** 要点列表（中文短句） */
  notes: string[];
  /** 最近更新时间 */
  updatedAt: string;
  /** 已从会话头部压进记忆的消息条数，避免每轮重复扫描同一前缀 */
  compactedThrough?: number;
};

const MAX_NOTES = 64;
const NOTE_MAX_LEN = 160;

function clipNote(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > NOTE_MAX_LEN ? `${t.slice(0, NOTE_MAX_LEN)}…` : t;
}

function pushUnique(notes: string[], item: string): void {
  const n = clipNote(item);
  if (!n) return;
  if (notes.some((x) => x === n || x.includes(n) || n.includes(x))) return;
  notes.push(n);
  while (notes.length > MAX_NOTES) notes.shift();
}

/** 从一轮对话粗提取可复用事实（用户偏好 / 任务目标 / 关键节点） */
export function extractNotesFromTurn(
  userText: string,
  assistantText: string,
  toolSummaries: string[]
): string[] {
  const out: string[] = [];
  const u = clipNote(userText);
  if (u && u.length >= 8) {
    // 用户本轮意图（截短）
    pushUnique(out, `用户：${u}`);
  }
  // 工具成功结果里带 nodeId 的摘要
  for (const t of toolSummaries.slice(0, 6)) {
    if (/成功/.test(t) && t.length >= 6) pushUnique(out, `操作：${t}`);
  }
  const a = clipNote(assistantText);
  if (a && a.length >= 12 && !/正在操作|思考中/.test(a)) {
    // 助手结论性短句
    const first = a.split(/[。！？\n]/)[0] || a;
    if (first.length >= 8) pushUnique(out, `助手：${first}`);
  }
  return out;
}

export function mergeMemory(prev: AgentMemory | undefined, additions: string[]): AgentMemory {
  const notes = [...(prev?.notes || [])];
  for (const a of additions) pushUnique(notes, a);
  return {
    notes,
    updatedAt: new Date().toISOString(),
    ...(prev?.compactedThrough != null ? { compactedThrough: prev.compactedThrough } : {}),
  };
}

/** 当历史过长时，把更早消息压成 memory notes（启发式） */
export function compactOlderMessagesIntoNotes(
  messages: LocalAgentMessage[],
  keepRecent: number
): string[] {
  if (messages.length <= keepRecent) return [];
  const older = messages.slice(0, messages.length - keepRecent);
  return compactMessageSliceIntoNotes(older);
}

/** 只压缩 [from, to) 区间，供增量记忆更新 */
export function compactMessageSliceIntoNotes(messages: LocalAgentMessage[]): string[] {
  const notes: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && m.content.trim()) {
      pushUnique(notes, `早先用户：${m.content}`);
    } else if (m.role === "assistant" && m.content.trim() && !m.toolCalls?.length) {
      const first = m.content.split(/[。！？\n]/)[0] || m.content;
      pushUnique(notes, `早先助手：${first}`);
    } else if (m.role === "tool" && m.results?.length) {
      for (const r of m.results) {
        if (r.ok) pushUnique(notes, `早先操作成功：${r.op}${r.nodeId ? ` → ${r.nodeId}` : ""}`);
      }
    }
  }
  return notes;
}

/** 注入 system 的记忆段落 */
export function formatMemoryForPrompt(memory: AgentMemory | undefined): string {
  const notes = memory?.notes?.filter(Boolean) || [];
  if (!notes.length) return "";
  return `## 会话记忆（轻量，可能不完整）\n${notes.map((n, i) => `${i + 1}. ${n}`).join("\n")}`;
}
