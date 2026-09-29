/**
 * 本地 Agent Runtime：Tool Calling 主循环。
 * 含瞬时错误重试、失败工具一次再试、轻量记忆注入。
 */

import type { QueryClient } from "@tanstack/react-query";

import { buildMessageWithNodeRefs, type AgentNodeRef } from "@/lib/canvas/agentNodeRefs";
import {
  beginAgentTurnControl,
  clearAgentCanvasBusy,
  endAgentTurnControl,
  getAgentCanvasStopToken,
  isAgentTurnAbortedError,
  setAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import {
  localGenerateChat,
  localGenerateChatStream,
  type LocalChatMessage,
  type LocalChatToolCall,
} from "@/lib/local/generate";
import type { LocalModel } from "@/lib/local/types";
import { resolveNodeImageUrlAsync } from "./tools/resolveCanvasMedia";
import {
  buildCanvasSnapshotText,
  buildLocalAgentSystemPrompt,
  buildLocalAgentToolsSystemPrompt,
  parseAgentReply,
} from "./protocol";
import {
  executeLocalAgentOps,
  formatOpResultsForModel,
  type LocalAgentOpResult,
} from "./executor";
import { buildCanvasAgentTools } from "./tools/definitions";
import { dispatchAgentToolCalls } from "./tools/dispatch";
import type { LocalAgentMessage } from "./session";
import {
  compactMessageSliceIntoNotes,
  extractNotesFromTurn,
  formatMemoryForPrompt,
  mergeMemory,
  type AgentMemory,
} from "./memory";
import { isRetryableToolFailure, withLlmRetries } from "./retry";

function newMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const MAX_TOOL_ROUNDS = 24;
/** 送进模型的近期消息条数；更早的压进记忆，避免与 notes 重复 */
const HISTORY_MESSAGES = 16;
const HISTORY_ITEM_MAX = 6000;
/** 超过此条数时把更早消息压进记忆（与 HISTORY_MESSAGES 对齐） */
const COMPACT_KEEP_RECENT = 16;
/** 助手对话默认输出上限（上游未设时容易中途截断） */
const AGENT_CHAT_MAX_TOKENS = 8192;

function clip(text: string): string {
  return text.length > HISTORY_ITEM_MAX ? `${text.slice(0, HISTORY_ITEM_MAX)}…` : text;
}

/** 停止时补齐尚未回写的 tool 结果，避免下一轮 OpenAI 历史缺 tool_call_id */
function emitToolResultsForCalls(opts: {
  onMessage: (msg: LocalAgentMessage) => void;
  messages: LocalChatMessage[];
  calls: LocalChatToolCall[];
  results: Array<LocalAgentOpResult & { toolCallId: string }>;
  alreadyEmitted: Set<string>;
  fallbackMessage: string;
  turnToolSummaries: string[];
}): void {
  const byId = resultsByCallId(opts.results);
  for (const call of opts.calls) {
    if (opts.alreadyEmitted.has(call.id)) continue;
    const list = byId.get(call.id)?.length
      ? byId.get(call.id)!
      : [{ op: call.name, ok: false, message: opts.fallbackMessage } as LocalAgentOpResult];
    const content = formatOpResultsForModel(list);
    for (const r of list) {
      opts.turnToolSummaries.push(`${r.op} ${r.ok ? "成功" : "失败"}：${r.message}`);
    }
    opts.onMessage({
      id: newMessageId(),
      role: "tool",
      content,
      toolCallId: call.id,
      results: list,
      createdAt: new Date().toISOString(),
    });
    opts.messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: clip(content),
    });
    opts.alreadyEmitted.add(call.id);
  }
}

/** 将会话历史转为 OpenAI messages（不含本轮最新 user，由调用方追加） */
function historyToChatMessages(messages: LocalAgentMessage[]): LocalChatMessage[] {
  const out: LocalChatMessage[] = [];
  const slice = messages.slice(-HISTORY_MESSAGES);
  for (const m of slice) {
    if (m.role === "assistant") {
      if (m.toolCalls?.length) {
        out.push({
          role: "assistant",
          content: clip(m.content || ""),
          tool_calls: m.toolCalls.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: t.arguments },
          })),
        });
      } else {
        out.push({ role: "assistant", content: clip(m.raw || m.content) });
      }
      continue;
    }
    if (m.role === "tool") {
      if (m.toolCallId) {
        out.push({
          role: "tool",
          tool_call_id: m.toolCallId,
          content: clip(
            m.content ||
              formatOpResultsForModel(m.results || []) ||
              JSON.stringify(m.results || [])
          ),
        });
      } else {
        out.push({
          role: "user",
          content: clip(`【画布操作执行结果】\n${formatOpResultsForModel(m.results || [])}`),
        });
      }
      continue;
    }
    out.push({
      role: "user",
      content: clip(buildMessageWithNodeRefs(m.content, m.refs || [])),
    });
  }
  return out;
}

async function collectRefImageUrls(
  projectId: string,
  refs: AgentNodeRef[] | undefined
): Promise<string[]> {
  if (!refs?.length) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  // 用户 @ / 上传的图全部进助手视觉上下文，助手层不设张数上限（由模型自行选用）
  for (const r of refs) {
    let u = (r.thumbUrl || "").trim();
    if (!u && r.nodeId && !r.nodeId.startsWith("upload:")) {
      u = await resolveNodeImageUrlAsync(projectId, r.nodeId);
    }
    if (!u || seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
  }
  return urls;
}

function resultsByCallId(
  results: Array<LocalAgentOpResult & { toolCallId: string }>
): Map<string, LocalAgentOpResult[]> {
  const byId = new Map<string, LocalAgentOpResult[]>();
  for (const r of results) {
    const list = byId.get(r.toolCallId) || [];
    list.push(r);
    byId.set(r.toolCallId, list);
  }
  return byId;
}

export type RuntimeTurnOptions = {
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
};

/**
 * 跑一轮用户消息：优先 Tool Calling；若模型无 tool_calls 且回复含 ```ops 则走旧执行器。
 */
export async function runAgentRuntimeTurn(opts: RuntimeTurnOptions): Promise<void> {
  const { projectId, modelId, models, queryClient, onMessage, skillPrompt, onMemoryUpdate } = opts;
  const focusIds = (opts.userMessage.refs || []).map((r) => r.nodeId);
  const { signal, stopAt } = beginAgentTurnControl();
  const tools = buildCanvasAgentTools();
  const stopped = () => signal.aborted || getAgentCanvasStopToken() !== stopAt;

  // 轻量记忆：只压缩尚未压过的前缀，避免每轮重复扫描
  let memory = opts.memory;
  const through = Math.max(0, opts.history.length - COMPACT_KEEP_RECENT);
  const prevThrough = memory?.compactedThrough || 0;
  if (through > prevThrough) {
    const sliceNotes = compactMessageSliceIntoNotes(opts.history.slice(prevThrough, through));
    if (sliceNotes.length) {
      memory = mergeMemory(memory, sliceNotes);
    }
    memory = {
      notes: memory?.notes || [],
      updatedAt: new Date().toISOString(),
      compactedThrough: through,
    };
    onMemoryUpdate?.(memory);
  }

  const memoryBlock = formatMemoryForPrompt(memory);
  const system =
    buildLocalAgentToolsSystemPrompt(models) +
    (memoryBlock ? `\n\n${memoryBlock}` : "") +
    (skillPrompt ? `\n\n## 当前启用的技能\n${skillPrompt}` : "") +
    `\n\n## 失败处理\n工具若返回失败：先根据错误修正参数再调用；瞬时超时/限流可再试一次。不要假装已成功。`;

  const baseHistory = historyToChatMessages(opts.history);
  const userText = `【当前画布】\n${buildCanvasSnapshotText(focusIds)}\n\n${buildMessageWithNodeRefs(
    opts.userMessage.content,
    opts.userMessage.refs || []
  )}`;
  const images = await collectRefImageUrls(projectId, opts.userMessage.refs);
  /** 本轮全部 @ 节点（无上限）；含文本/图/视频等，供提示与工具并入 */
  const allRefIds = (opts.userMessage.refs || []).map((r) => r.nodeId).filter(Boolean);
  /** 可作视觉/生成参考的素材 id（图、上传、视频缩略等） */
  const mediaRefIds = (opts.userMessage.refs || [])
    .filter((r) => r.hasMedia || r.thumbUrl || /image|upload|video/i.test(r.nodeType || ""))
    .map((r) => r.nodeId)
    .filter(Boolean);
  /** @ 素材的可取图 URL（尤其 upload: 无画布节点时） */
  const preferReferenceUrls = new Map<string, string>();
  for (const r of opts.userMessage.refs || []) {
    if (r.nodeId && r.thumbUrl) preferReferenceUrls.set(r.nodeId, r.thumbUrl);
  }
  /** 本用户回合内跨 tool 轮次共享 tempId → 真实 nodeId */
  const turnTempMap = new Map<string, string>();

  const extraHints: string[] = [];
  if (allRefIds.length > 0) {
    const refLines = (opts.userMessage.refs || [])
      .map((r) => {
        const bits = [`id=${r.nodeId}`, r.nodeType || "?", r.label || ""];
        if (r.hasMedia || r.thumbUrl) bits.push("有素材");
        return `- ${bits.filter(Boolean).join(" | ")}`;
      })
      .join("\n");
    extraHints.push(
      `【系统】用户本轮 @ 了 ${allRefIds.length} 个参考素材（全部已进入本对话，助手层无数量上限）。你须自行判断选用哪些；写文案、改提示词、做网页、生图、生视频时都要结合这些素材，勿无视。\n${refLines}`
    );
  }
  if (images.length > 0) {
    extraHints.push(
      `【系统】已附带全部 ${images.length} 张可视觉参考图；若需更细分析可再调 media_inspect_images（可传全部相关 nodeIds）。`
    );
  }
  if (mediaRefIds.length > 0) {
    extraHints.push(
      `【系统】可作图生图/图生视频/网页插图的节点 id：${mediaRefIds.join(", ")}。调用 media_generate_* / web_create_page 时按任务需要传入 referenceNodeIds / imageNodeIds；若你未传，系统才会把本轮 @ 媒体自动并入。勿编造外链。`
    );
  }

  const messages: LocalChatMessage[] = [
    { role: "system", content: system },
    ...baseHistory,
    {
      role: "user",
      content: extraHints.length ? `${userText}\n\n${extraHints.join("\n")}` : userText,
    },
  ];

  const turnToolSummaries: string[] = [];
  let lastAssistantText = "";
  /** 是否因最终文本回复正常 break（false 表示可能跑满轮次） */
  let finishedWithTextReply = false;

  setAgentCanvasBusy("orchestrating", "AI 助手思考中…");
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (stopped()) return;

      const assistantId = newMessageId();
      let streamed = "";
      // 先占位，便于流式刷新同一条气泡
      onMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      });

      let chat;
      try {
        chat = await withLlmRetries(
          () =>
            localGenerateChatStream({
              modelId,
              messages,
              tools,
              toolChoice: "auto",
              images: images.length ? images : undefined,
              maxTokens: AGENT_CHAT_MAX_TOKENS,
              signal,
              onDelta: (text) => {
                if (stopped()) return;
                streamed = text;
                onMessage({
                  id: assistantId,
                  role: "assistant",
                  content: text || "…",
                  createdAt: new Date().toISOString(),
                });
              },
            }),
          { maxAttempts: 2, baseDelayMs: 700 }
        );
        // 部分上游声称支持 stream 却返回空包：降级非流式
        if (!chat.content.trim() && !chat.toolCalls.length && !stopped()) {
          chat = await localGenerateChat({
            modelId,
            messages,
            tools,
            toolChoice: "auto",
            images: images.length ? images : undefined,
            maxTokens: AGENT_CHAT_MAX_TOKENS,
            signal,
          });
          if (chat.content) {
            onMessage({
              id: assistantId,
              role: "assistant",
              content: chat.content,
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        if (isAgentTurnAbortedError(err) || stopped()) {
          if (streamed.trim()) {
            onMessage({
              id: assistantId,
              role: "assistant",
              content: `${streamed.trim()}\n\n（已停止）`,
              createdAt: new Date().toISOString(),
            });
          }
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        try {
          if (stopped()) return;
          chat = await localGenerateChat({
            modelId,
            messages,
            tools,
            toolChoice: "auto",
            images: images.length ? images : undefined,
            maxTokens: AGENT_CHAT_MAX_TOKENS,
            signal,
          });
          if (chat.content) {
            onMessage({
              id: assistantId,
              role: "assistant",
              content: chat.content,
              createdAt: new Date().toISOString(),
            });
          }
        } catch (err2) {
          if (isAgentTurnAbortedError(err2) || stopped()) return;
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          // 部分网关不支持 tools：退回旧文本+ops 路径
          if (/tools|tool_choice|function/i.test(msg2) || /tools|tool_choice|function/i.test(msg)) {
            await runOpsFallbackTurn(opts);
            return;
          }
          throw err2;
        }
      }

      if (stopped()) return;

      if (!chat.toolCalls.length) {
        const parsed = parseAgentReply(chat.content);
        let body = parsed.text || chat.content.trim() || streamed || "（无回复）";
        if (parsed.parseError) {
          body = `${body}\n\n（注意：${parsed.parseError}）`.trim();
        }
        const assistant: LocalAgentMessage = {
          id: assistantId,
          role: "assistant",
          content: body,
          raw: chat.content,
          createdAt: new Date().toISOString(),
        };
        onMessage(assistant);
        lastAssistantText = assistant.content;
        if (parsed.ops.length) {
          const results = await executeLocalAgentOps({
            projectId,
            ops: parsed.ops,
            models,
            queryClient,
          });
          onMessage({
            id: newMessageId(),
            role: "tool",
            content: "",
            results,
            createdAt: new Date().toISOString(),
          });
          for (const r of results) {
            turnToolSummaries.push(`${r.op} ${r.ok ? "成功" : "失败"}：${r.message}`);
          }
        }
        finishedWithTextReply = true;
        break;
      }

      const assistant: LocalAgentMessage = {
        id: assistantId,
        role: "assistant",
        content: chat.content.trim() || streamed || "正在操作画布…",
        raw: chat.content,
        toolCalls: chat.toolCalls,
        createdAt: new Date().toISOString(),
      };
      onMessage(assistant);
      lastAssistantText = assistant.content;

      messages.push({
        role: "assistant",
        content: chat.content || "",
        tool_calls: chat.toolCalls.map((t) => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: t.arguments },
        })),
      });

      const emittedToolIds = new Set<string>();
      let results: Array<LocalAgentOpResult & { toolCallId: string }> = [];

      const finishToolsOrStop = (reason: string) => {
        emitToolResultsForCalls({
          onMessage,
          messages,
          calls: chat.toolCalls,
          results,
          alreadyEmitted: emittedToolIds,
          fallbackMessage: reason,
          turnToolSummaries,
        });
      };

      if (stopped()) {
        finishToolsOrStop("用户已停止");
        return;
      }
      setAgentCanvasBusy("projecting", "AI 正在执行画布操作…");
      try {
        results = await dispatchAgentToolCalls({
          projectId,
          calls: chat.toolCalls,
          models,
          textModelId: modelId,
          activeSkillSlug: opts.activeSkillSlug,
          queryClient,
          tempMap: turnTempMap,
          preferReferenceNodeIds: mediaRefIds,
          preferReferenceUrls,
          signal,
        });
      } catch (err) {
        if (isAgentTurnAbortedError(err) || stopped()) {
          finishToolsOrStop("用户已停止");
          return;
        }
        throw err;
      }
      if (stopped()) {
        finishToolsOrStop("用户已停止");
        return;
      }

      // 瞬时失败的工具：同一 tool_call 再执行一次
      const byId = resultsByCallId(results);
      const retryCalls: LocalChatToolCall[] = [];
      for (const call of chat.toolCalls) {
        const list = byId.get(call.id) || [];
        const failed = list.filter((r) => !r.ok);
        if (failed.length && failed.every((r) => isRetryableToolFailure(r.message))) {
          retryCalls.push(call);
        }
      }
      if (retryCalls.length && !stopped()) {
        setAgentCanvasBusy("projecting", "瞬时失败，正在重试工具…");
        await new Promise((r) => setTimeout(r, 600));
        if (stopped()) {
          finishToolsOrStop("用户已停止");
          return;
        }
        const retryResults = await dispatchAgentToolCalls({
          projectId,
          calls: retryCalls,
          models,
          textModelId: modelId,
          activeSkillSlug: opts.activeSkillSlug,
          queryClient,
          tempMap: turnTempMap,
          preferReferenceNodeIds: mediaRefIds,
          preferReferenceUrls,
          signal,
        });
        // 去掉旧的失败条目，换上重试结果
        const keep = results.filter((r) => !retryCalls.some((c) => c.id === r.toolCallId));
        results = [...keep, ...retryResults];
      }

      if (stopped()) {
        finishToolsOrStop("用户已停止");
        return;
      }

      emitToolResultsForCalls({
        onMessage,
        messages,
        calls: chat.toolCalls,
        results,
        alreadyEmitted: emittedToolIds,
        fallbackMessage: "未返回结果",
        turnToolSummaries,
      });

      // 若本轮有失败，给模型一句显式提示（下一轮）
      const anyFail = results.some((r) => !r.ok);
      if (anyFail) {
        messages.push({
          role: "user",
          content:
            "【系统】上一轮部分工具失败，请根据失败原因修正后重试或换一种做法；不要声称已成功。",
        });
      }

      if (stopped()) return;
      setAgentCanvasBusy("orchestrating", "AI 助手继续思考…");
    }

    // 跑满工具轮次仍无最终文字回复时，给用户明确收尾
    if (!stopped() && !finishedWithTextReply) {
      onMessage({
        id: newMessageId(),
        role: "assistant",
        content: `已达到本轮工具调用上限（${MAX_TOOL_ROUNDS} 次）。请根据上面的操作结果继续提问，或缩小任务后再试。`,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    if (isAgentTurnAbortedError(err) || stopped()) return;
    throw err;
  } finally {
    // 回合结束更新记忆
    const additions = extractNotesFromTurn(
      opts.userMessage.content,
      lastAssistantText,
      turnToolSummaries
    );
    if (additions.length) {
      const next = mergeMemory(memory, additions);
      onMemoryUpdate?.(next);
    }
    endAgentTurnControl();
    clearAgentCanvasBusy();
  }
}

/** 旧路径：localGenerateText 风格 + ```ops```（tools 不可用时） */
async function runOpsFallbackTurn(opts: RuntimeTurnOptions): Promise<void> {
  const { projectId, modelId, models, queryClient, onMessage } = opts;
  const { localGenerateText } = await import("@/lib/local/generate");
  const memoryBlock = formatMemoryForPrompt(opts.memory);
  const system =
    buildLocalAgentSystemPrompt(models) + (memoryBlock ? `\n\n${memoryBlock}` : "");
  const focusIds = (opts.userMessage.refs || []).map((r) => r.nodeId);
  const stopAt = getAgentCanvasStopToken();
  const prompt = `【当前画布】\n${buildCanvasSnapshotText(focusIds)}\n\n${buildMessageWithNodeRefs(
    opts.userMessage.content,
    opts.userMessage.refs || []
  )}`;
  setAgentCanvasBusy("orchestrating", "AI 助手思考中（兼容模式）…");
  try {
    const images = await collectRefImageUrls(opts.projectId, opts.userMessage.refs);
    const replyRaw = await withLlmRetries(
      () =>
        localGenerateText({
          modelId,
          system,
          prompt,
          images,
        }),
      { maxAttempts: 3, baseDelayMs: 900 }
    );
    if (getAgentCanvasStopToken() !== stopAt) return;
    const parsed = parseAgentReply(replyRaw);
    onMessage({
      id: newMessageId(),
      role: "assistant",
      content: parsed.text || (parsed.ops.length ? "好的，正在操作画布。" : replyRaw.trim()),
      raw: replyRaw,
      createdAt: new Date().toISOString(),
    });
    if (!parsed.ops.length) return;
    const results = await executeLocalAgentOps({
      projectId,
      ops: parsed.ops,
      models,
      queryClient,
    });
    onMessage({
      id: newMessageId(),
      role: "tool",
      content: "",
      results,
      createdAt: new Date().toISOString(),
    });
  } finally {
    clearAgentCanvasBusy();
  }
}

export type { LocalChatToolCall };
