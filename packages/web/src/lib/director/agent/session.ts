/**
 * 导演台 AI 会话：多轮对话 + 自动执行 ops + 每轮撤销快照。
 * 会话按「项目 + 导演台节点」存浏览器 localStorage（本地版单机使用，场景本身仍存本地磁盘）。
 */

import { localGenerateText } from "@/lib/local/generate";
import { startDirectorModel3dJob } from "@/lib/director/model3dJobs";
import type { DirectorSceneState } from "@/types/director-scene";
import {
  buildDirectorSceneSnapshot,
  buildDirectorSystemPrompt,
  describeLinkedShot,
  parseDirectorReply,
  type DirectorAssetBrief,
} from "./protocol";
import { applyDirectorOps, type DirectorOpResult } from "./sceneOps";

export type DirectorChatImage = { assetId: string; url: string; title: string };

export type DirectorChatMessage = {
  id: string;
  role: "user" | "assistant" | "result";
  /** 展示文本（assistant 为去掉 ops 代码块后的正文） */
  content: string;
  /** assistant 原始回复（含 ops，回传给模型作为历史） */
  raw?: string;
  images?: DirectorChatImage[];
  results?: DirectorOpResult[];
  /** 本轮执行前的场景快照，用于「撤销本轮」 */
  undoSnapshot?: DirectorSceneState;
  undone?: boolean;
  error?: boolean;
  createdAt: number;
};

export type DirectorAgentSession = {
  chatModelId: string;
  model3dModelId: string;
  messages: DirectorChatMessage[];
};

const STORAGE_PREFIX = "jumeng-director-agent:";
/** 持久化时仅保留最近几轮的撤销快照，避免 localStorage 过大 */
const KEEP_UNDO_SNAPSHOTS = 8;
const MAX_MESSAGES = 120;
const MAX_ROUNDS = 4;
const HISTORY_LIMIT = 16;

function storageKey(projectId: string, nodeId: string) {
  return `${STORAGE_PREFIX}${projectId}:${nodeId}`;
}

export function emptyDirectorSession(): DirectorAgentSession {
  return { chatModelId: "", model3dModelId: "", messages: [] };
}

export function loadDirectorSession(projectId: string, nodeId: string): DirectorAgentSession {
  if (typeof window === "undefined") return emptyDirectorSession();
  try {
    const raw = window.localStorage.getItem(storageKey(projectId, nodeId));
    if (!raw) return emptyDirectorSession();
    const parsed = JSON.parse(raw) as Partial<DirectorAgentSession>;
    return {
      chatModelId: String(parsed.chatModelId ?? ""),
      model3dModelId: String(parsed.model3dModelId ?? ""),
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return emptyDirectorSession();
  }
}

export function saveDirectorSession(projectId: string, nodeId: string, session: DirectorAgentSession) {
  if (typeof window === "undefined") return;
  const messages = session.messages.slice(-MAX_MESSAGES);
  let kept = 0;
  const trimmed = [...messages]
    .reverse()
    .map((m) => {
      if (!m.undoSnapshot) return m;
      kept += 1;
      return kept <= KEEP_UNDO_SNAPSHOTS ? m : { ...m, undoSnapshot: undefined };
    })
    .reverse();
  try {
    window.localStorage.setItem(storageKey(projectId, nodeId), JSON.stringify({ ...session, messages: trimmed }));
  } catch {
    // 配额不足时丢弃全部撤销快照再试
    try {
      window.localStorage.setItem(
        storageKey(projectId, nodeId),
        JSON.stringify({ ...session, messages: trimmed.map((m) => ({ ...m, undoSnapshot: undefined })) })
      );
    } catch {
      /* 忽略 */
    }
  }
}

export function newMessageId() {
  return `dm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 执行结果文本（回传模型） */
function formatResults(results: DirectorOpResult[]): string {
  return [
    "【导演台操作执行结果】",
    ...results.map(
      (r, i) =>
        `${i + 1}. ${r.op} ${r.ok ? "成功" : "失败"}：${r.message}${r.objectId ? `（id=${r.objectId}）` : ""}${r.detail ? `\n${r.detail}` : ""}`
    ),
  ].join("\n");
}

/** 导演台对 AI 暴露的宿主能力 */
export type DirectorAgentHost = {
  projectId: string;
  nodeId: string;
  getScene: () => DirectorSceneState;
  replaceScene: (scene: DirectorSceneState) => void;
  /** 用摄像机截图 → 存素材 → 写回关联分镜；返回说明文本 */
  capture: (cameraId: string) => Promise<string>;
  imageAssets: (DirectorAssetBrief & { url: string })[];
  modelAssets: DirectorAssetBrief[];
  pendingModel3d: () => { name: string; placeholderId: string; progress?: string }[];
};

export type RunDirectorTurnInput = {
  host: DirectorAgentHost;
  session: DirectorAgentSession;
  userText: string;
  images: DirectorChatImage[];
  model3dLabel?: string;
  /** 每次消息列表变化时回调（UI 实时刷新 + 持久化） */
  onMessages: (messages: DirectorChatMessage[]) => void;
  shouldStop: () => boolean;
};

/** 把会话消息转成模型历史（不含快照，节省 token） */
function toHistory(messages: DirectorChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => !m.error)
    .slice(-HISTORY_LIMIT)
    .map((m) => {
      if (m.role === "assistant") return { role: "assistant" as const, content: m.raw || m.content };
      if (m.role === "result") return { role: "user" as const, content: formatResults(m.results ?? []) };
      const imgs = m.images?.length ? `\n[附图：${m.images.map((i) => `${i.title}(${i.assetId})`).join("、")}]` : "";
      return { role: "user" as const, content: `${m.content}${imgs}` };
    });
}

/** 跑一轮导演台 AI（可能自动续多轮直到操作全部成功） */
export async function runDirectorAgentTurn(input: RunDirectorTurnInput): Promise<DirectorChatMessage[]> {
  const { host, session } = input;
  let messages: DirectorChatMessage[] = [...session.messages];
  const push = (m: DirectorChatMessage) => {
    messages = [...messages, m];
    input.onMessages(messages);
  };
  const update = (id: string, patch: Partial<DirectorChatMessage>) => {
    messages = messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
    input.onMessages(messages);
  };

  const history = toHistory(messages);
  push({
    id: newMessageId(),
    role: "user",
    content: input.userText,
    images: input.images.length ? input.images : undefined,
    createdAt: Date.now(),
  });

  const system = buildDirectorSystemPrompt({ model3dAvailable: Boolean(session.model3dModelId) });
  let pendingInput = input.userText;
  if (input.images.length) {
    pendingInput += `\n\n【本轮附图】（已随消息发送，可作参考图；图生3D 用 imageAssetId）\n${input.images
      .map((i) => `- ${i.assetId} ${i.title}`)
      .join("\n")}`;
  }
  let roundHistory = history;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (input.shouldStop()) break;
    const snapshot = buildDirectorSceneSnapshot({
      scene: host.getScene(),
      linkedShotText: describeLinkedShot(host.nodeId),
      imageAssets: host.imageAssets,
      modelAssets: host.modelAssets,
      pendingModel3d: host.pendingModel3d(),
    });
    let raw: string;
    try {
      raw = await localGenerateText({
        modelId: session.chatModelId,
        system,
        history: roundHistory,
        prompt: `${snapshot}\n\n${pendingInput}`,
        images: round === 0 ? input.images.map((i) => i.url) : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const visionHint =
        round === 0 && input.images.length && /image|vision|multimodal|多模态|看图|content/i.test(msg)
          ? "\n（带了参考图：请确认所选对话模型支持看图，如 GPT-4o / Gemini / Claude / Qwen-VL 等）"
          : "";
      push({ id: newMessageId(), role: "assistant", content: `请求失败：${msg}${visionHint}`, error: true, createdAt: Date.now() });
      break;
    }
    if (input.shouldStop()) break;

    const parsed = parseDirectorReply(raw);
    const assistantId = newMessageId();
    push({
      id: assistantId,
      role: "assistant",
      content: parsed.text || (parsed.ops.length ? "（执行场景操作）" : raw.trim()),
      raw,
      createdAt: Date.now(),
    });
    roundHistory = [...roundHistory, { role: "user", content: pendingInput }, { role: "assistant", content: raw }];

    if (!parsed.ops.length) {
      if (parsed.parseError) {
        const results: DirectorOpResult[] = [{ op: "parse", ok: false, message: parsed.parseError }];
        push({ id: newMessageId(), role: "result", content: "", results, createdAt: Date.now() });
        pendingInput = formatResults(results);
        continue;
      }
      break;
    }

    // 无 3D 模型时拦下 generate_model，避免放了占位却无法生成
    const ops = parsed.ops.slice(0, 20);
    const blocked: DirectorOpResult[] = [];
    const runnable = ops.filter((op) => {
      if (op.op === "generate_model" && !session.model3dModelId) {
        blocked.push({ op: op.op, ok: false, message: "未选择 3D 生成模型，请在面板顶部选择后再试" });
        return false;
      }
      return true;
    });

    const before = structuredClone(host.getScene());
    const out = applyDirectorOps(before, runnable, {
      imageAssetIds: new Set(host.imageAssets.map((a) => a.id)),
      modelAssetIds: new Set(host.modelAssets.map((a) => a.id)),
    });
    if (out.changed) {
      host.replaceScene(out.scene);
      update(assistantId, { undoSnapshot: before });
    }
    const results = [...out.results, ...blocked];

    for (const g of out.generations) {
      const imageUrl = g.imageAssetId ? host.imageAssets.find((a) => a.id === g.imageAssetId)?.url : undefined;
      startDirectorModel3dJob({
        projectId: host.projectId,
        nodeId: host.nodeId,
        modelId: session.model3dModelId,
        modelLabel: input.model3dLabel,
        placeholderId: g.placeholderId,
        name: g.name,
        prompt: g.prompt,
        imageUrl,
        height: g.height,
      });
    }

    for (const c of out.captures) {
      if (input.shouldStop()) break;
      try {
        const note = await host.capture(c.cameraId);
        results.push({ op: "capture", ok: true, message: `「${c.cameraName}」${note}`, objectId: c.cameraId });
      } catch (err) {
        results.push({
          op: "capture",
          ok: false,
          message: `「${c.cameraName}」截图失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    push({ id: newMessageId(), role: "result", content: "", results, createdAt: Date.now() });
    const needFollowUp = results.some((r) => !r.ok || r.op === "read_object");
    if (!needFollowUp) break;
    pendingInput = formatResults(results);
  }

  return messages;
}
