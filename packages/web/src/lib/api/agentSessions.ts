/** Agent Session / Project Graph API 扩展 */

import { isLocalDesktop } from "@/lib/localDesktop";
import { ApiError } from "./client";

/** 开源本地版：禁止云端请求 */
async function apiFetch<T = unknown>(_path: string, _options?: unknown): Promise<T> {
  void isLocalDesktop;
  throw new ApiError(501, "开源本地版不支持云端 Agent/Skill", undefined, "OPENSOURCE_DISABLED");
}


export type AskChoiceOption = { id: string; label: string };

export type AskChoicesArtifact = {
  kind: "ask_choices";
  prompt?: string;
  proposal?: string;
  options?: AskChoiceOption[];
  status?: "pending" | "answered" | "ignored";
};

export type AskedSummaryArtifact = {
  kind: "asked_summary";
  items?: Array<{ q: string; a: string }>;
};

/** AI 操控生成结果回传到聊天框的素材条目 */
export type MediaAssetItem = {
  assetId?: string;
  url?: string;
  category?: "image" | "video" | "audio";
  title?: string;
  nodeId?: string;
  nodeName?: string;
};

export type MediaAssetsArtifact = {
  kind: "media_assets";
  items: MediaAssetItem[];
};

export type AgentMessageArtifact =
  | AskChoicesArtifact
  | AskedSummaryArtifact
  | MediaAssetsArtifact
  | Record<string, unknown>;

export type AgentMessage = {
  id: string;
  seq: number;
  role: string;
  agentRole?: string | null;
  content: string;
  skillId?: string | null;
  jobIds?: string[];
  artifacts?: AgentMessageArtifact[];
  graphPatch?: unknown;
  createdAt?: string | null;
};

export type CanvasOp = {
  op: string;
  toolCallId?: string;
  tempId?: string;
  nodeId?: string;
  /** 节点名称（与 nodeId 成对：AI 操控依据 = ID + 名称） */
  nodeName?: string;
  label?: string;
  content?: string;
  prompt?: string;
  x?: number;
  y?: number;
  shotId?: string;
  /** identityLock：角色定妆图节点绑定的角色 id（add_image_node 专用） */
  characterId?: string;
  /** 单一产品电影级宣传片 Skill：产品多视角定妆图节点绑定的产品 id（add_image_node 专用） */
  productId?: string;
  source?: string;
  /** 连线源节点名称（与 source 成对） */
  sourceName?: string;
  target?: string;
  /** 连线目标节点名称（与 target 成对） */
  targetName?: string;
  sourceHandle?: string;
  targetHandle?: string;
  params?: Record<string, unknown>;
  /** run_canvas_tool */
  tool?: string;
  scriptFromNodeId?: string;
  scriptFromNodeName?: string;
};

/** 焦点节点（选中 / @）短正文，供本轮直接改当前图；其余节点走 inspect */
export type CanvasSnapshotFocusedContent = {
  id: string;
  label?: string;
  type?: string;
  /** 图/视频/音频提示词（截断） */
  prompt?: string;
  /** 文本节点正文（截断；更长内容在 OSS） */
  content?: string;
  /** 文档节点 HTML 摘要（截断） */
  htmlContent?: string;
  /** 文档外链 */
  linkUrl?: string;
  /** 文档资源类型 file | link | html */
  resourceKind?: string;
  /** 分镜表行数 */
  shotCount?: number;
  /** 分镜表前几行摘要 */
  shotsPreview?: Array<{
    shotNo?: string;
    duration?: string;
    description?: string;
    dialogue?: string;
  }>;
  generationOptions?: Record<string, string>;
};

export type CanvasSnapshot = {
  /** 画布实际节点总数（可能大于 nodes.length，因快照有截断） */
  nodeCount?: number;
  /** 画布实际边总数 */
  edgeCount?: number;
  /** 节点或边因上限被截断；模型勿以为画布只有 listed 这些 */
  truncated?: boolean;
  /** 因截断未列入目录的节点数 */
  omittedNodeCount?: number;
  /** 因截断未列入目录的边数 */
  omittedEdgeCount?: number;
  nodes: Array<{
    id: string;
    type: string;
    label?: string;
    /** 粗位置（像素，原点左上） */
    x?: number;
    y?: number;
    hasMedia?: boolean;
    /** 节点已挂载的项目素材 id，供 AI 替换/连线时引用 */
    assetId?: string;
    /** 节点当前 params.model，供 AI 换模型 */
    model?: string;
    /** 当前生成参数（画幅/清晰度/时长等），供 AI 改「16:9 · 720P · 5s」类选项 */
    generationOptions?: Record<string, string>;
    /** 故事板/调度板结果等语义角色，供续聊视觉读板 */
    role?: "storyboard_sheet" | string;
    /** 分镜表行数（目录字段，不含镜头正文） */
    shotCount?: number;
    /** 画布选中或对话准星引用等焦点节点 */
    focused?: boolean;
    /** 生成失败等状态 */
    status?: string;
    /** 最近一次失败原因（截断） */
    lastError?: string;
  }>;
  /** 仅焦点节点带短正文；目录 nodes 不含 prompt/content */
  focusedContent?: CanvasSnapshotFocusedContent[];
  /**
   * 目录节点的现场 prompt/content（截断），供后端 inspect 读未保存改动。
   * 不注入 LLM 目录正文。
   */
  liveParams?: Record<string, CanvasSnapshotFocusedContent>;
  edges: Array<{
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  /** 画布操控：用户选定的生图模型 id */
  preferredImageModel?: string;
  /** 画布操控：用户选定的生视频模型 id */
  preferredVideoModel?: string;
  /** 诊断：失败节点 */
  failedNodes?: Array<{ id: string; label?: string; reason?: string }>;
  /** 诊断：指向缺失节点的边 */
  brokenEdges?: Array<{
    source: string;
    target: string;
    reason: "missing_source" | "missing_target";
  }>;
  /** 诊断：缺媒体 / 缺上游参考 */
  missingAssetHints?: Array<{
    id: string;
    label?: string;
    kind: "no_media" | "no_upstream_ref";
  }>;
};

export type ProjectGraphPayload = {
  projectId: string;
  revision: number;
  graph: Record<string, unknown>;
  canvasOps?: CanvasOp[];
  updatedAt?: string | null;
};

export type ControllerModelOption = {
  id: string;
  label: string;
  supportsFiles?: boolean;
  configured?: boolean;
  provider?: string;
};

export type AgentSessionSummary = {
  sessionId: string;
  projectId: string;
  title: string;
  status: string;
  skillSlug?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
};

/** 后端识别到参考视频后，前端据此跑 viralRemakePipeline */
export type RunViralRemakePayload = {
  videoAssetId: string;
  videoFileUrl?: string;
  videoTitle?: string;
  replaceImageAssetIds?: string[];
  replaceImageUrls?: string[];
  replaceNotes?: string;
  aspectRatio?: string;
  clarity?: string;
  /** 一键出海：目标市场 ID（US / JP / …） */
  targetMarketId?: string;
  targetMarketLabel?: string;
  entryKind?: string;
};

export type AgentSessionResult = {
  sessionId: string;
  projectId: string;
  skillId?: string | null;
  skillSlug?: string | null;
  status: string;
  title?: string | null;
  controllerModel?: string | null;
  controllerModels?: ControllerModelOption[];
  projectUrl: string;
  messages: AgentMessage[];
  graph?: ProjectGraphPayload | null;
  /** 创作框/对话已绑定的参考素材（图/视频），供 Composer 芯片回显 */
  referenceAssetIds?: string[];
  runViralRemake?: RunViralRemakePayload | null;
  runViralRemakeBatch?: boolean;
  /** 电影级宣传片：用户确认生成，批量出视频镜头 */
  runCinematicBatch?: boolean;
  /** 爆款复刻：一键生成主体图 */
  runViralRemakeSubjects?: boolean;
  /** 我的 Skill 配方（确认后一键铺节点） */
  mySkillDefaults?: {
    idea?: string;
    mediaKind?: string;
    nodeRecipe?: {
      nodes?: Array<{ key?: string; kind?: string; label?: string; hint?: string }>;
      edges?: Array<{ from?: string; to?: string }>;
      orderNotes?: string;
    };
  } | null;
  recipePending?: boolean;
  recipeApplied?: boolean;
  needsCanvasKick?: boolean;
  /** update_plan 可见进度（仅展示，非状态机） */
  runtimePlan?: {
    steps?: Array<{ step?: string; status?: string }>;
    explanation?: string;
  } | null;
  /** runtime 事件（轮询/SSE） */
  runtimeEvents?: Array<{
    id?: number;
    kind?: string;
    message?: string;
    at?: string;
  }>;
};

export type AgentSessionPollResult = {
  sessionId: string;
  projectId: string;
  skillSlug?: string | null;
  status: string;
  title?: string | null;
  controllerModel?: string | null;
  controllerModels?: ControllerModelOption[];
  projectUrl: string;
  messages: AgentMessage[];
  graph?: ProjectGraphPayload | null;
  /** 创作框/对话已绑定的参考素材（图/视频），供 Composer 芯片回显 */
  referenceAssetIds?: string[];
  /** 爆款复刻：本轮消息含参考视频，需前端执行拉片 */
  runViralRemake?: RunViralRemakePayload | null;
  /** 爆款复刻：用户确认成片，需前端按分镜表批量生成 */
  runViralRemakeBatch?: boolean;
  /** 电影级宣传片：用户确认生成，批量出视频镜头 */
  runCinematicBatch?: boolean;
  /** 爆款复刻：一键生成主体图 */
  runViralRemakeSubjects?: boolean;
  mySkillDefaults?: AgentSessionResult["mySkillDefaults"];
  recipePending?: boolean;
  recipeApplied?: boolean;
  needsCanvasKick?: boolean;
  runtimePlan?: AgentSessionResult["runtimePlan"];
  runtimeEvents?: AgentSessionResult["runtimeEvents"];
};

export async function createAgentSession(input: {
  message?: string;
  skillSlug?: string;
  projectId?: string;
  projectTitle?: string;
  styleId?: string;
  controllerModel?: string;
  genMode?: "smart" | "canvas" | "chat";
  /** 爆款对话：视频比例，默认后端 9:16 */
  aspectRatio?: string;
  /** 爆款对话：清晰度，默认后端 1080p */
  clarity?: string;
  /** 一键出海：目标市场版本 */
  targetMarketId?: string;
  canvasSnapshot?: CanvasSnapshot;
}): Promise<AgentSessionResult> {
  return apiFetch<AgentSessionResult>("/api/v1/agent/sessions", {
    method: "POST",
    body: JSON.stringify({
      message: input.message ?? "",
      skillSlug: input.skillSlug,
      projectId: input.projectId,
      projectTitle: input.projectTitle,
      styleId: input.styleId,
      controllerModel: input.controllerModel,
      genMode: input.genMode,
      aspectRatio: input.aspectRatio,
      clarity: input.clarity,
      targetMarketId: input.targetMarketId,
      canvasSnapshot: input.canvasSnapshot,
    }),
  });
}

/** 把参考图写入会话 brief + Graph identityLock */
export async function bindAgentSessionReferenceAssets(
  sessionId: string,
  assetIds: string[]
): Promise<{ sessionId: string; projectId: string; referenceAssetIds: string[] }> {
  return apiFetch(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/reference-assets`,
    {
      method: "POST",
      body: JSON.stringify({ assetIds }),
    }
  );
}

export async function attachAgentSession(input: {
  projectId: string;
  skillSlug: string;
  message?: string;
}): Promise<AgentSessionResult> {
  return apiFetch<AgentSessionResult>("/api/v1/agent/sessions/attach", {
    method: "POST",
    body: JSON.stringify({
      projectId: input.projectId,
      skillSlug: input.skillSlug,
      message: input.message,
    }),
  });
}

export async function getAgentSession(
  sessionId: string,
  afterSeq = 0
): Promise<AgentSessionPollResult> {
  const q = afterSeq > 0 ? `?afterSeq=${afterSeq}` : "";
  return apiFetch<AgentSessionPollResult>(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}${q}`
  );
}

export async function postAgentSessionMessage(
  sessionId: string,
  input: {
    message?: string;
    choiceId?: string;
    action?: "submit" | "ignore" | "skill_progress" | "skill_done" | "resume";
    controllerModel?: string;
    genMode?: "smart" | "canvas" | "chat";
    canvasSnapshot?: CanvasSnapshot;
    aspectRatio?: string;
    clarity?: string;
    /** 一键出海：目标市场版本 */
    targetMarketId?: string;
    /** 进度旁白可附带 media_assets 等 artifact */
    artifacts?: AgentMessageArtifact[];
  }
): Promise<AgentSessionPollResult> {
  return apiFetch<AgentSessionPollResult>(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.message ?? "",
        choiceId: input.choiceId,
        action: input.action,
        controllerModel: input.controllerModel,
        genMode: input.genMode,
        canvasSnapshot: input.canvasSnapshot,
        aspectRatio: input.aspectRatio,
        clarity: input.clarity,
        targetMarketId: input.targetMarketId,
        artifacts: input.artifacts,
      }),
    }
  );
}

export type AgentToolResultItem = {
  toolCallId: string;
  ok: boolean;
  result?: string;
  nodeId?: string;
};

/** 前端投影完客户端工具后回传结果 + 最新快照，继续思考 */
export async function postAgentToolResults(
  sessionId: string,
  input: {
    results: AgentToolResultItem[];
    canvasSnapshot?: CanvasSnapshot;
  }
): Promise<AgentSessionPollResult> {
  return apiFetch<AgentSessionPollResult>(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/tool-results`,
    {
      method: "POST",
      body: JSON.stringify({
        results: input.results,
        canvasSnapshot: input.canvasSnapshot,
      }),
    }
  );
}

/** 停止本轮思考与画布投影，会话回到可继续发话 */
export async function stopAgentSession(sessionId: string): Promise<AgentSessionPollResult> {
  return apiFetch<AgentSessionPollResult>(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/stop`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

/** 飞行中追加指令（turn/steer），下一拍思考并入 */
export async function steerAgentSession(
  sessionId: string,
  message: string
): Promise<AgentSessionPollResult> {
  return apiFetch<AgentSessionPollResult>(
    `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/steer`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    }
  );
}

export type AgentRuntimeSseEvent = {
  id?: number;
  kind?: string;
  message?: string;
  at?: string;
  data?: Record<string, unknown>;
};

/**
 * 订阅会话 runtimeEvents（SSE）。
 * 经 BFF proxy + Bearer；勿用原生 EventSource（无法带 Authorization）。
 * 返回取消函数。
 */
export function subscribeAgentSessionEvents(
  sessionId: string,
  handlers: {
    onEvent?: (ev: AgentRuntimeSseEvent) => void;
    onDone?: (status: string) => void;
    onError?: (err: unknown) => void;
  },
  options?: { afterId?: number; signal?: AbortSignal }
): () => void {
  const afterId = Math.max(0, Number(options?.afterId || 0));
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  const path = `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/events?afterId=${afterId}`;

  void (async () => {
    try {
      const { withBasePath } = await import("@/lib/basePath");
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("jm_canvas_session_token")
          : null;
      const fetchUrl = `${process.env.NEXT_PUBLIC_API_URL || withBasePath("/api/proxy")}${path}`;
      const res = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        handlers.onError?.(new Error(`SSE HTTP ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() || "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith(":") || !line.trim()) continue;
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
              continue;
            }
            if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (!dataLines.length) continue;
          const raw = dataLines.join("\n");
          try {
            const parsed = JSON.parse(raw) as AgentRuntimeSseEvent & { status?: string };
            if (eventName === "done") {
              handlers.onDone?.(String(parsed.status || "done"));
              return;
            }
            handlers.onEvent?.(parsed);
          } catch {
            // 非 JSON 忽略
          }
        }
      }
      handlers.onDone?.("eof");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      handlers.onError?.(err);
    } finally {
      options?.signal?.removeEventListener("abort", onAbort);
    }
  })();

  return () => {
    controller.abort();
    options?.signal?.removeEventListener("abort", onAbort);
  };
}

export async function listProjectAgentSessions(
  projectId: string,
  limit = 30
): Promise<{ projectId: string; items: AgentSessionSummary[] }> {
  return apiFetch(
    `/api/v1/agent/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}`
  );
}

/** 控制器模型列表（无会话时也可拉，含 GPT / Gemini 等） */
export async function listControllerModels(): Promise<{
  items: ControllerModelOption[];
}> {
  return apiFetch("/api/v1/agent/controller-models");
}

export async function ackAgentCanvasOps(
  projectId: string,
  revision: number,
  nodeBindings?: Array<{ shotId: string; canvasNodeId: string }>,
  characterBindings?: Array<{ characterId: string; canvasNodeId: string }>,
  productBindings?: Array<{ productId: string; canvasNodeId: string }>
): Promise<{ projectId: string; revision: number }> {
  return apiFetch(`/api/v1/agent/projects/${encodeURIComponent(projectId)}/graph/ack-ops`, {
    method: "POST",
    body: JSON.stringify({
      projectId,
      revision,
      ...(nodeBindings?.length ? { nodeBindings } : {}),
      ...(characterBindings?.length ? { characterBindings } : {}),
      ...(productBindings?.length ? { productBindings } : {}),
    }),
  });
}

/**
 * 自由创作 Agent Team 路径：单镜生成成功后把 outputAssetId / status 同步回
 * Project Graph（对齐分镜表路径已有的「改单镜后自动 reflow 整条时间线」）。
 */
export async function syncShotProgress(
  projectId: string,
  _updates: Array<{ shotId: string; outputAssetId?: string | null; status?: string | null }>
): Promise<ProjectGraphPayload> {
  return { projectId } as ProjectGraphPayload;
}

/**
 * identityLock 三视图闭环：角色定妆图节点生成成功后，把产物 sheetAssetId 同步回
 * Project Graph 的 characters[].identityLock.sheetAssetIds。
 */
export async function syncCharacterSheetAsset(
  projectId: string,
  _updates: Array<{ characterId: string; sheetAssetId: string }>
): Promise<ProjectGraphPayload> {
  return { projectId } as ProjectGraphPayload;
}

/**
 * 单一产品电影级宣传片 Skill：产品多视角定妆图节点生成成功后，把产物
 * sheetAssetId 同步回 Project Graph 的 products[].identityLock.sheetAssetIds。
 */
export async function syncProductSheetAsset(
  projectId: string,
  _updates: Array<{ productId: string; sheetAssetId: string }>
): Promise<ProjectGraphPayload> {
  return { projectId } as ProjectGraphPayload;
}
