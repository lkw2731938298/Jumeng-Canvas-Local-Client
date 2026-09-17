/**
 * 将 Agent Team / 续聊的 canvasOps 投影到画布：加节点、连线、触发生成。
 * 按 revision 去重；应用后 ack（可回写 shot→node 绑定）。
 */

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { AgentToolResultItem, CanvasOp } from "@/lib/api/agentSessions";
import {
  ackAgentCanvasOps,
  bindAgentSessionReferenceAssets,
  postAgentToolResults,
} from "@/lib/api/agentSessions";
import {
  collectNodeMediaItem,
  narrateAgentSession,
} from "@/lib/canvas/agentSessionNarrate";
import { saveNodeText } from "@/lib/api/nodeText";
import { withBasePath } from "@/lib/basePath";
import {
  clearAgentCanvasBusy,
  getAgentCanvasStopToken,
  setAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import {
  AGENT_DEFAULT_IMAGE_T2I,
  AGENT_DEFAULT_VIDEO_R2V,
  getAgentCanvasMediaModels,
} from "@/lib/canvas/agentCanvasMediaModels";
import { mergeAgentNodeParams } from "@/lib/canvas/agentGenerationOptions";
import { navigateToVideoEditor } from "@/lib/canvas/videoEditorNavigation";
import { getDurationRangeFromGroup, getModelGenerationPresets } from "@/lib/canvas/generationPresets";
import { listModels } from "@/lib/api/models";
import { takeFreshCanvasSnapshot } from "@/lib/canvas/buildCanvasSnapshot";
import { touchAgentNode } from "@/lib/canvas/agentNodeTouch";
import { resolveAgentNodePosition } from "@/lib/canvas/agentPlaceNode";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { runAgentCanvasTool } from "@/lib/canvas/runAgentCanvasTool";
import { runOneGeneratableNode } from "@/lib/canvas/runOneGeneratableNode";
import { useCanvasStore } from "@/stores/canvasStore";

export { AGENT_DEFAULT_IMAGE_T2I, AGENT_DEFAULT_VIDEO_R2V };

/** 节点还没有 model 时，才用画布选择器/系统默认；助手已写入的 id 必须保留 */
function fillDefaultModelIfEmpty(nodeId: string): void {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const current = String(
    ((node.data?.params as Record<string, unknown> | undefined)?.model || "") as string
  ).trim();
  if (current) return;
  const prefs = getAgentCanvasMediaModels();
  if (node.type === "image_input") {
    useCanvasStore.getState().updateNodeParam(
      nodeId,
      "model",
      prefs.imageModel || AGENT_DEFAULT_IMAGE_T2I
    );
  } else if (node.type === "video_input") {
    useCanvasStore.getState().updateNodeParam(
      nodeId,
      "model",
      prefs.videoModel || AGENT_DEFAULT_VIDEO_R2V
    );
  }
}

/** 将 Agent params 写入节点（generationOptions 与已有合并并归一时长等） */
function applyAgentParams(
  nodeId: string,
  incoming: Record<string, unknown>,
  durationByModel?: Map<string, { min: number; max: number }>
): void {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const prev = (node?.data?.params || {}) as Record<string, unknown>;
  let merged = mergeAgentNodeParams(prev, incoming);
  const modelId = String(
    (merged.model as string) || (prev.model as string) || ""
  ).trim();
  const range = modelId && durationByModel ? durationByModel.get(modelId) : undefined;
  const go = merged.generationOptions;
  if (range && go && typeof go === "object" && !Array.isArray(go)) {
    const rec = go as Record<string, unknown>;
    const raw = String(rec.duration ?? "").trim();
    const n = Number(raw);
    if (raw && Number.isFinite(n) && n > 0) {
      const clamped = Math.min(range.max, Math.max(range.min, Math.round(n)));
      if (String(clamped) !== raw) {
        merged = {
          ...merged,
          generationOptions: { ...rec, duration: String(clamped) },
        };
      }
    }
  }
  const liftKeys = new Set([
    "duration",
    "durationSec",
    "duration_sec",
    "seconds",
    "时长",
    "aspectRatio",
    "aspect_ratio",
    "ratio",
    "画幅",
    "resolution",
    "clarity",
    "清晰度",
    "realPerson",
    "真人",
  ]);
  const isMedia = node?.type === "image_input" || node?.type === "video_input";
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "generationOptions" || liftKeys.has(k)) continue;
    // 节点展示名在 data.label，不进 params
    if (k === "label" && typeof v === "string" && v.trim()) {
      setNodeLabel(nodeId, v.trim());
      continue;
    }
    useCanvasStore.getState().updateNodeParam(nodeId, k, v);
  }
  if (merged.generationOptions) {
    useCanvasStore.getState().updateNodeParam(nodeId, "generationOptions", merged.generationOptions);
  }
  // 助手没写 model 时才回落到用户选择器
  if (isMedia) {
    fillDefaultModelIfEmpty(nodeId);
  }
  // 通知节点编辑面板（若正打开着该节点）：参数被 Agent 外部改动，需强制重新从
  // store 灌入本地状态，避免尺寸/时长等 generationOptions 面板显示与提交仍是旧值
  touchAgentNode(nodeId);
}

const appliedKey = (projectId: string) => `jumeng:agent_graph_rev:${projectId}`;

function alreadyApplied(projectId: string, revision: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(appliedKey(projectId));
    return Number(raw || 0) >= revision;
  } catch {
    return false;
  }
}

function markApplied(projectId: string, revision: number): void {
  try {
    sessionStorage.setItem(appliedKey(projectId), String(revision));
  } catch {
    /* ignore */
  }
}

/**
 * 解析节点引用：依据 = 节点 ID + 节点名称。
 * - 有 ID：以 ID 为准；若同时给了名称且与画布不一致 → 拒绝（防连错）
 * - 仅名称：仅当全画布唯一精确匹配时可用
 * - 本轮新建 tempId 走 tempMap
 */
function resolveNodeRef(
  id: string | undefined,
  name: string | undefined,
  tempMap: Map<string, string>
): string | null {
  const rawId = (id || "").trim();
  const rawName = (name || "").trim();
  // 本轮新建 tempId：以映射 ID 为准（名称可能尚未同步）
  if (rawId && tempMap.has(rawId)) {
    return tempMap.get(rawId)!;
  }
  const nodes = useCanvasStore.getState().nodes;
  if (rawId) {
    const byId = nodes.find((n) => n.id === rawId);
    if (byId) {
      if (rawName) {
        const label = String(byId.data?.label || "").trim();
        if (label && label !== rawName) {
          // ID 与名称对不上：不解析，避免误操作「镜头1」连到错误节点
          return null;
        }
      }
      return byId.id;
    }
    // 稳定语义别名：script→剧本、sb_main→分镜表…
    const byAlias = findNodeByTempAlias(rawId);
    if (byAlias) {
      if (rawName) {
        const node = nodes.find((n) => n.id === byAlias);
        const label = String(node?.data?.label || "").trim();
        if (label && label !== rawName) return null;
      }
      tempMap.set(rawId, byAlias);
      return byAlias;
    }
  }
  // 仅名称：唯一精确匹配（同名多节点则不猜）
  if (rawName) {
    const hits = nodes.filter((n) => String(n.data?.label || "").trim() === rawName);
    if (hits.length === 1) {
      tempMap.set(hits[0].id, hits[0].id);
      return hits[0].id;
    }
    return null;
  }
  // 兼容：id 字段里误填了唯一名称
  if (rawId) {
    const hits = nodes.filter((n) => String(n.data?.label || "").trim() === rawId);
    if (hits.length === 1) {
      tempMap.set(rawId, hits[0].id);
      return hits[0].id;
    }
  }
  return null; // 不造幽灵边
}

/**
 * 稳定语义 tempId → 单例中文标签（可复用已有节点）。
 * 禁止把「镜头1」「主视觉」等可重复业务标签放进此表，否则 AI 编排会吞掉新建。
 */
const TEMP_LABEL_ALIASES: Record<string, string[]> = {
  script: ["剧本"],
  characters: ["角色"],
  scenes: ["场景"],
  audio_plan: ["音效计划", "音频计划"],
  bgm: ["BGM", "配乐"],
  sb_main: ["分镜表"],
};

/** 仅按 TEMP_LABEL_ALIASES 精确匹配标签；未知 tempId 不回退模糊匹配 */
function findNodeByTempAlias(tempId: string): string | null {
  const key = tempId.trim().toLowerCase();
  const hints = TEMP_LABEL_ALIASES[key];
  if (!hints?.length) return null;
  const nodes = useCanvasStore.getState().nodes;
  for (const hint of hints) {
    const hit = nodes.find((n) => {
      const label = String(n.data?.label || "");
      // 精确匹配：避免「角色」吞掉「角色1」、「镜头」类误伤
      return label === hint || n.id === hint;
    });
    if (hit) return hit.id;
  }
  return null;
}

function clearAppliedMark(projectId: string): void {
  try {
    sessionStorage.removeItem(appliedKey(projectId));
  } catch {
    /* ignore */
  }
}

function defaultSourceHandle(nodeId: string): string | undefined {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const t = node?.type || "";
  if (t === "text_input") return "text";
  if (t === "image_input") return "image";
  if (t === "video_input") return "video";
  if (t === "audio_input") return "audio";
  return undefined;
}

function setNodeLabel(nodeId: string, label: string): void {
  useCanvasStore.setState((state) => ({
    nodes: state.nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, label } } : n
    ),
  }));
}

function addTypedNode(
  type:
    | "text_input"
    | "image_input"
    | "video_input"
    | "audio_input"
    | "document_input"
    | "director_stage",
  op: CanvasOp,
  tempMap: Map<string, string>
): string | null {
  const tempId = (op.tempId || op.shotId || "").trim();
  // 已存在同 id：复用（重复投影 / 续聊），只更新参数
  if (tempId) {
    const existing = useCanvasStore.getState().nodes.find((n) => n.id === tempId);
    if (existing) {
      tempMap.set(tempId, tempId);
      if (op.shotId) tempMap.set(op.shotId, tempId);
      if (op.label) setNodeLabel(tempId, op.label);
      return tempId;
    }
    // 仅 script/sb_main 等稳定语义 tempId 可按别名复用。
    // 禁止按「镜头1」「主视觉」等 label 复用——否则 AI 再编排会连到旧镜头而不新建。
    const byAlias = findNodeByTempAlias(tempId);
    if (byAlias) {
      tempMap.set(tempId, byAlias);
      if (op.shotId) tempMap.set(op.shotId, byAlias);
      if (op.label) setNodeLabel(byAlias, op.label);
      return byAlias;
    }
  }
  // 缺省/叠点时自动避让（中文：避免 AI 全堆在 100,100）
  const { x, y } = resolveAgentNodePosition(
    { x: op.x, y: op.y },
    useCanvasStore.getState().nodes
  );
  const beforeIds = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
  useCanvasStore.getState().addNode(type, { x, y }, {
    id: tempId || undefined,
    label: op.label || undefined,
  });
  const after = useCanvasStore.getState().nodes;
  const created = after.find((n) => !beforeIds.has(n.id));
  const nodeId = created?.id ?? (tempId && after.some((n) => n.id === tempId) ? tempId : null);
  if (!nodeId) return null;
  if (tempId) tempMap.set(tempId, nodeId);
  if (op.shotId) tempMap.set(op.shotId, nodeId);
  if (op.label) setNodeLabel(nodeId, op.label);
  return nodeId;
}

/** 应用一轮 canvasOps；成功返回 true */
export async function projectAgentCanvasOps(opts: {
  projectId: string;
  revision: number;
  ops: CanvasOp[];
  /** 当前 Agent 会话：生成成功后把素材发到聊天框 */
  sessionId?: string;
  /** 图片菜单工具（故事板/多角度等）需要 QueryClient */
  queryClient?: QueryClient;
  creditsEnabled?: boolean;
}): Promise<boolean> {
  const { projectId, revision, ops, sessionId, queryClient, creditsEnabled } = opts;
  if (!projectId || !ops?.length) return false;

  const store = useCanvasStore.getState();
  // 画布尚未 init 完：不投影、不 mark；调用方应在 isLoading→false 后重试
  if (store.isLoading) return false;

  // 本地已投影过但服务端仍挂着 ops（ack 丢包/竞态）→ 补 ack 清队列，解除「请稍后再发」
  if (alreadyApplied(projectId, revision)) {
    try {
      await ackAgentCanvasOps(projectId, revision);
      // 若本轮含打开剪辑台，补跳转（上次可能 ack 后未完成导航）
      if (ops.some((o) => o.op === "open_video_editor")) {
        toast.message("正在打开剪辑台…");
        await navigateToVideoEditor(projectId, (href) => {
          if (typeof window !== "undefined") {
            window.location.assign(withBasePath(href));
          }
        });
      }
      return true;
    } catch {
      clearAppliedMark(projectId);
      // 清 mark 后继续完整投影
    }
  }

  setAgentCanvasBusy("projecting", "AI 正在操控画布：添加节点与连线…");
  const stopTokenAtStart = getAgentCanvasStopToken();
  const stopped = () => getAgentCanvasStopToken() !== stopTokenAtStart;
  const durationByModel = new Map<string, { min: number; max: number }>();
  try {
    const vids = await listModels({ category: "video" });
    for (const m of vids) {
      const presets = getModelGenerationPresets(m);
      const group = presets?.groups.find((g) => g.id === "duration");
      if (!group) continue;
      const range = getDurationRangeFromGroup(group);
      if (range) durationByModel.set(m.name, range);
    }
  } catch {
    /* 目录失败时仍投影，时长钳制以后端为准 */
  }
  try {
  const tempMap = new Map<string, string>();
  const bindings: Array<{ shotId: string; canvasNodeId: string }> = [];
  // identityLock：角色定妆图节点 → characterId 绑定（供 sync_character_sheet_asset 定位）
  const characterBindings: Array<{ characterId: string; canvasNodeId: string }> = [];
  // 单一产品电影级宣传片 Skill：产品多视角定妆图节点 → productId 绑定（供 sync_product_sheet_asset 定位）
  const productBindings: Array<{ productId: string; canvasNodeId: string }> = [];
  let created = 0;
  let connected = 0;
  let updated = 0;
  const generateJobs: Array<{ nodeId: string; op: CanvasOp }> = [];
  const toolOps: CanvasOp[] = [];
  // Agent 组装剪辑台后下发：ack 成功再跳转，避免未 ack 卡住续聊
  let openVideoEditor = false;
  const outcomes = new Map<string, AgentToolResultItem>();
  const record = (
    op: CanvasOp,
    ok: boolean,
    result: string,
    nodeId?: string
  ): void => {
    const cid = String(op.toolCallId || "").trim();
    if (!cid) return;
    outcomes.set(cid, { toolCallId: cid, ok, result, nodeId });
  };

  // 先加节点 / 改参数，再连线，再 ack，最后工具与生成
  for (const op of ops) {
    if (stopped()) {
      record(op, false, "用户已停止助手");
      continue;
    }
    // 打开项目剪辑台（assemble_timeline / 「组装剪辑台」早路径）
    if (op.op === "open_video_editor") {
      openVideoEditor = true;
      record(op, true, "即将打开剪辑台");
      continue;
    }
    if (op.op === "add_text_node") {
      const nodeId = addTypedNode("text_input", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建文本节点");
        continue;
      }
      const content = op.content || "";
      if (content) {
        useCanvasStore.getState().updateNodeParam(nodeId, "content", content.slice(0, 500));
        try {
          await saveNodeText(projectId, nodeId, content, "doubao_pro");
        } catch {
          /* 大文本落 OSS 失败时仍保留 params 摘要 */
        }
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      }
      created += 1;
      record(op, true, "已创建文本节点", nodeId);
      continue;
    }

    if (op.op === "add_image_node") {
      const nodeId = addTypedNode("image_input", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建图片节点");
        continue;
      }
      if (op.prompt) {
        useCanvasStore.getState().updateNodeParam(nodeId, "prompt", op.prompt);
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      } else {
        fillDefaultModelIfEmpty(nodeId);
      }
      if (op.shotId) {
        bindings.push({ shotId: op.shotId, canvasNodeId: nodeId });
      }
      if (op.characterId) {
        characterBindings.push({ characterId: op.characterId, canvasNodeId: nodeId });
      }
      if (op.productId) {
        productBindings.push({ productId: op.productId, canvasNodeId: nodeId });
      }
      created += 1;
      record(op, true, "已创建图片节点", nodeId);
      continue;
    }

    if (op.op === "add_video_node") {
      const nodeId = addTypedNode("video_input", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建视频节点");
        continue;
      }
      if (op.prompt) {
        useCanvasStore.getState().updateNodeParam(nodeId, "prompt", op.prompt);
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      } else {
        fillDefaultModelIfEmpty(nodeId);
      }
      // 与 add_image_node 对称：视频镜头也要回写 shotId → canvasNodeId，
      // 否则该镜头从一开始就进不了 Project Graph，后续单镜 reflow 无从谈起。
      if (op.shotId) {
        bindings.push({ shotId: op.shotId, canvasNodeId: nodeId });
      }
      created += 1;
      record(op, true, "已创建视频节点", nodeId);
      continue;
    }

    if (op.op === "add_audio_node") {
      const nodeId = addTypedNode("audio_input", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建音频节点");
        continue;
      }
      if (op.prompt) {
        useCanvasStore.getState().updateNodeParam(nodeId, "prompt", op.prompt);
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      }
      created += 1;
      record(op, true, "已创建音频节点", nodeId);
      continue;
    }

    if (op.op === "add_document_node") {
      const nodeId = addTypedNode("document_input", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建文档节点");
        continue;
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      }
      created += 1;
      record(op, true, "已创建文档节点", nodeId);
      continue;
    }

    if (op.op === "add_director_node") {
      const nodeId = addTypedNode("director_stage", op, tempMap);
      if (!nodeId) {
        record(op, false, "未能创建导演台节点");
        continue;
      }
      if (op.params) {
        applyAgentParams(nodeId, op.params as Record<string, unknown>, durationByModel);
      }
      created += 1;
      record(op, true, "已创建导演台节点", nodeId);
      continue;
    }

    if (op.op === "add_storyboard_node") {
      const tempId = (op.tempId || "").trim();
      if (tempId) {
        const existing = useCanvasStore.getState().nodes.find((n) => n.id === tempId);
        if (existing) {
          tempMap.set(tempId, tempId);
          if (op.label) setNodeLabel(tempId, op.label);
          created += 1;
          record(op, true, "已复用分镜表节点", tempId);
          continue;
        }
        const byLabel = findNodeByTempAlias(tempId);
        if (byLabel) {
          tempMap.set(tempId, byLabel);
          created += 1;
          record(op, true, "已复用分镜表节点", byLabel);
          continue;
        }
      }
      const { x, y } = resolveAgentNodePosition(
        { x: op.x, y: op.y },
        useCanvasStore.getState().nodes,
        { defaultY: 320 }
      );
      const beforeIds = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
      useCanvasStore.getState().addNode("storyboard_grid", { x, y }, {
        id: tempId || undefined,
        label: op.label || "分镜表",
      });
      const after = useCanvasStore.getState().nodes;
      const createdNode = after.find((n) => !beforeIds.has(n.id));
      const nodeId =
        createdNode?.id ?? (tempId && after.some((n) => n.id === tempId) ? tempId : null);
      if (nodeId) {
        if (tempId) tempMap.set(tempId, nodeId);
        if (op.label) setNodeLabel(nodeId, op.label);
        created += 1;
        record(op, true, "已创建分镜表节点", nodeId);
      } else {
        record(op, false, "未能创建分镜表节点");
      }
      continue;
    }

    if (op.op === "update_node_params") {
      const nid = resolveNodeRef(op.nodeId || op.tempId, op.nodeName || op.label, tempMap);
      if (!nid || !op.params) {
        record(op, false, nid ? "缺少 params" : `找不到节点 ${op.nodeId || op.nodeName || ""}`);
        continue;
      }
      applyAgentParams(nid, op.params as Record<string, unknown>, durationByModel);
      updated += 1;
      record(op, true, "已更新节点参数", nid);
      continue;
    }

    if (op.op === "connect_nodes") {
      // 连线依据：源/目标各自的 ID + 名称
      const source = resolveNodeRef(op.source, op.sourceName, tempMap);
      const target = resolveNodeRef(op.target, op.targetName || op.nodeName, tempMap);
      if (!source || !target) {
        record(
          op,
          false,
          `连线失败：找不到 ${!source ? `源 ${op.source || op.sourceName || ""}` : `目标 ${op.target || op.targetName || ""}`}`
        );
        continue;
      }
      // 目标节点尚不存在则跳过，避免幽灵边
      if (!useCanvasStore.getState().nodes.some((n) => n.id === target)) {
        record(op, false, `连线失败：目标节点 ${target} 不在画布上`);
        continue;
      }
      const sourceHandle = op.sourceHandle || defaultSourceHandle(source);
      const targetHandle = op.targetHandle || REFERENCE_INPUT_ID;
      useCanvasStore.getState().connectNodes({
        source,
        target,
        sourceHandle,
        targetHandle,
      });
      connected += 1;
      record(op, true, `已连线 ${source} → ${target}`, target);
      continue;
    }

    if (op.op === "disconnect_nodes") {
      const source = resolveNodeRef(op.source, op.sourceName, tempMap);
      const target = resolveNodeRef(op.target, op.targetName || op.nodeName, tempMap);
      if (source && target) {
        const edges = useCanvasStore.getState().edges.filter(
          (e) => !(e.source === source && e.target === target)
        );
        useCanvasStore.getState().setEdges(edges);
        connected += 1;
        record(op, true, `已断开 ${source} → ${target}`, target);
      } else {
        record(op, false, "断线失败：找不到端点");
      }
      continue;
    }

    if (op.op === "layout_hint") {
      const nid = resolveNodeRef(op.nodeId || op.tempId, op.nodeName || op.label, tempMap);
      const rawX = Number(op.x);
      const rawY = Number(op.y);
      if (nid && Number.isFinite(rawX) && Number.isFinite(rawY)) {
        const others = useCanvasStore.getState().nodes.filter((n) => n.id !== nid);
        const { x, y } = resolveAgentNodePosition({ x: rawX, y: rawY }, others);
        const nodes = useCanvasStore.getState().nodes.map((n) =>
          n.id === nid ? { ...n, position: { x, y } } : n
        );
        useCanvasStore.getState().setNodes(nodes);
        updated += 1;
        record(op, true, "已移动节点", nid);
      } else {
        record(op, false, "移动失败：节点或坐标无效");
      }
      continue;
    }

    if (op.op === "generate_node") {
      const nid = resolveNodeRef(op.nodeId || op.tempId, op.nodeName || op.label, tempMap);
      if (nid) {
        fillDefaultModelIfEmpty(nid);
        generateJobs.push({ nodeId: nid, op });
      } else {
        record(op, false, `找不到要生成的节点 ${op.nodeId || op.nodeName || ""}`);
      }
      continue;
    }

    if (op.op === "run_canvas_tool") {
      const nid = resolveNodeRef(op.nodeId || op.tempId, op.nodeName || op.label, tempMap);
      if (!nid) {
        record(op, false, `找不到工具目标节点 ${op.nodeId || op.nodeName || ""}`);
        continue;
      }
      toolOps.push({
        ...op,
        nodeId: nid,
        scriptFromNodeId: op.scriptFromNodeId
          ? resolveNodeRef(op.scriptFromNodeId, op.scriptFromNodeName, tempMap) ||
            op.scriptFromNodeId
          : undefined,
      });
      continue;
    }
  }

  // 先落节点/连线；ack 成功后再 markApplied，避免 ack 失败导致永久跳过
  if (created > 0 || connected > 0 || updated > 0) {
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} 个节点`);
    if (updated > 0) parts.push(`改参数 ${updated}`);
    if (connected > 0) parts.push(`${connected} 条连线`);
    toast.success(`Agent 已投影 ${parts.join("、")}`);
    useCanvasStore.getState().scheduleAutoSave();
  }

  // 轨 G：走现有 quote → 预扣 → submit（与手点同价）
  // 注意：生成放在 ack 之前执行完结构投影即可；ack 仍在生成前，避免重复投影节点
  // 但 markApplied 必须等 ack 成功
  let ackOk = false;
  try {
    await ackAgentCanvasOps(
      projectId,
      revision,
      bindings.length ? bindings : undefined,
      characterBindings.length ? characterBindings : undefined,
      productBindings.length ? productBindings : undefined
    );
    markApplied(projectId, revision);
    ackOk = true;
  } catch {
    clearAppliedMark(projectId);
    toast.error("画布投影确认失败，将自动重试");
  }

  if (!ackOk) {
    clearAgentCanvasBusy();
    return false;
  }

  // 仅导航类 ops：ack 后立刻进剪辑台（组装剪辑台早路径）
  if (openVideoEditor && generateJobs.length === 0 && toolOps.length === 0) {
    toast.message("正在打开剪辑台…");
    clearAgentCanvasBusy();
    await navigateToVideoEditor(projectId, (href) => {
      if (typeof window !== "undefined") {
        window.location.assign(withBasePath(href));
      }
    });
    return true;
  }

  // 分镜 / 图片工具串行，再跑节点 generate
  const boardResultNodeIds: string[] = [];
  for (const top of toolOps) {
    if (stopped()) {
      record(top, false, "用户已停止助手");
      continue;
    }
    const toolName = String(top.tool || "");
    setAgentCanvasBusy("tool", `AI 正在操控画布：执行工具「${toolName}」…`);
    try {
      const toolResult = await runAgentCanvasTool(
        projectId,
        {
          tool: toolName,
          nodeId: String(top.nodeId || ""),
          scriptFromNodeId: top.scriptFromNodeId,
          params: top.params,
        },
        {
          queryClient,
          creditsEnabled,
          workflowId: useCanvasStore.getState().workflowId,
          openInlineVideoTrim: (nid, dur) => {
            useCanvasStore.getState().openInlineVideoTrim(nid, dur);
          },
        }
      );
      if (toolResult.ok) {
        const mapped = String(top.nodeId || "");
        const extra = toolResult.resultNodeIds?.length
          ? `；结果节点 ${toolResult.resultNodeIds.join(",")}`
          : "";
        record(top, true, `工具 ${toolName} 已执行${extra}`, mapped);
      } else {
        record(
          top,
          false,
          `工具 ${toolName} 失败：${String(toolResult.error || "未知原因").trim()}`,
          String(top.nodeId || "") || undefined
        );
      }
      // 故事板 / 调度故事板：收集结果节点，稍后旁白 + 踢续聊读板分镜
      if (
        toolResult.ok &&
        (toolName === "storyboard" || toolName === "blocking_storyboard") &&
        toolResult.resultNodeIds?.length
      ) {
        boardResultNodeIds.push(...toolResult.resultNodeIds);
      } else if (
        !toolResult.ok &&
        (toolName === "storyboard" || toolName === "blocking_storyboard") &&
        sessionId
      ) {
        // 故事板失败时明确旁白，带上真实原因（算力不足 / 上游失败等）
        const reason = String(toolResult.error || "").trim();
        await narrateAgentSession(
          sessionId,
          reason
            ? `故事板工具未能完成：${reason}`
            : "故事板工具未能完成（可能是算力不足、模型未配置或上游失败）。请检查算力后再说一次「生成故事板」，或点选锚点后在顶部菜单手动点「故事板」。"
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "画布工具执行失败";
      toast.error(msg);
      record(top, false, `工具 ${toolName} 失败：${msg}`, String(top.nodeId || "") || undefined);
    }
  }

  // 故事板结果：回传聊天 + 绑入会话参考 + 自动续聊「读板分配视频镜头」
  if (sessionId && boardResultNodeIds.length > 0) {
    const uniqueBoardIds = [...new Set(boardResultNodeIds)];
    // 生成刚结束时偶发 params 尚未刷入 store：短轮询等 assetId
    let items = uniqueBoardIds
      .map((id) => collectNodeMediaItem(id))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));
    for (let i = 0; i < 8 && items.every((it) => !it.assetId); i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      items = uniqueBoardIds
        .map((id) => collectNodeMediaItem(id))
        .filter((it): it is NonNullable<typeof it> => Boolean(it));
      if (items.some((it) => it.assetId)) break;
    }
    const assetIds = items
      .map((it) => String(it.assetId || "").trim())
      .filter(Boolean);
    const boardLabel =
      items[0]?.title ||
      String(
        useCanvasStore.getState().nodes.find((n) => n.id === uniqueBoardIds[0])
          ?.data?.label || ""
      ).trim() ||
      "故事板";
    const idHints =
      items.length > 0
        ? items
            .map((it) => {
              const aid = it.assetId ? `assetId=${it.assetId}` : "";
              const nid = it.nodeId ? `nodeId=${it.nodeId}` : "";
              return `[附件:${it.title || "故事板"}|${[aid, nid].filter(Boolean).join("|")}]`;
            })
            .join(" ")
        : uniqueBoardIds.map((id) => `[节点:故事板|nodeId=${id}|type=image_input]`).join(" ");
    await narrateAgentSession(
      sessionId,
      `已生成${boardLabel}：${idHints}`,
      { mediaItems: items.length > 0 ? items : undefined }
    );
    if (assetIds.length > 0) {
      try {
        await bindAgentSessionReferenceAssets(sessionId, assetIds);
      } catch {
        /* 绑定失败不阻断 */
      }
    }
    // 不再硬编码踢续聊：由 runtime 根据 tool-results + 新快照继续思考
  }

  if (generateJobs.length > 0) {
    setAgentCanvasBusy("generating", `AI 正在操控画布：触发生成 ${generateJobs.length} 个节点…`);
    toast.message(`开始生成 ${generateJobs.length} 个节点（将扣算力）…`);
    const batchId = `agent-gen-${revision}-${Date.now()}`;
    let okCount = 0;
    let failMsg: string | null = null;
    const mediaNodeIds: string[] = [];
    for (const job of generateJobs) {
      if (stopped()) {
        record(job.op, false, "用户已停止助手", job.nodeId);
        continue;
      }
      const nodeId = job.nodeId;
      // 目标节点必须存在
      if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) {
        record(job.op, false, `生成失败：节点 ${nodeId} 不在画布上`, nodeId);
        continue;
      }
      // 仅当节点还没有 model 时才填选择器默认，不覆盖助手已选
      fillDefaultModelIfEmpty(nodeId);
      const outcome = await runOneGeneratableNode({
        projectId,
        nodeId,
        batchId,
      });
      if (outcome.ok) {
        okCount += 1;
        const mid = outcome.mediaNodeId || nodeId;
        if (mid) mediaNodeIds.push(mid);
        record(job.op, true, "已提交生成", mid);
        continue;
      }
      failMsg = outcome.error || "生成失败";
      record(job.op, false, failMsg, nodeId);
      if (
        outcome.abortBatch ||
        outcome.code === "INSUFFICIENT_CREDITS" ||
        outcome.code === "5501"
      ) {
        toast.error(failMsg.includes("算力") ? failMsg : `算力不足或无法继续：${failMsg}`);
        const rest = generateJobs.slice(generateJobs.indexOf(job) + 1);
        for (const skipped of rest) {
          record(skipped.op, false, `未执行：因「${failMsg}」中止批次`, skipped.nodeId);
        }
        break;
      }
      toast.error(failMsg);
    }
    if (okCount > 0) {
      toast.success(`已提交 ${okCount} 个生成任务`);
      useCanvasStore.getState().scheduleAutoSave();
      // 生成素材回传到 AI 聊天框（名称 + 预览）
      if (sessionId) {
        const items = mediaNodeIds
          .map((id) => collectNodeMediaItem(id))
          .filter((it): it is NonNullable<typeof it> => Boolean(it));
        if (items.length > 0) {
          await narrateAgentSession(sessionId, `已生成 ${items.length} 个素材：`, {
            mediaItems: items,
          });
        }
      }
    }
  }

  const toolResults: AgentToolResultItem[] = [];
  for (const op of ops) {
    const cid = String(op.toolCallId || "").trim();
    if (!cid) continue;
    const recorded = outcomes.get(cid);
    if (recorded) {
      toolResults.push(recorded);
      continue;
    }
    const rawId = String(op.nodeId || op.tempId || "").trim();
    const mapped = rawId ? tempMap.get(rawId) || rawId : undefined;
    toolResults.push({
      toolCallId: cid,
      ok: true,
      result: `已执行 ${op.op}`,
      nodeId: mapped,
    });
  }
  if (sessionId && toolResults.length > 0 && !stopped()) {
    try {
      await postAgentToolResults(sessionId, {
        results: toolResults,
        canvasSnapshot: takeFreshCanvasSnapshot(),
      });
    } catch {
      /* 回传失败时用户可再发一句 */
    }
  }

  // 与生成/工具同批时：全部完成后再进剪辑台
  if (openVideoEditor && !stopped()) {
    toast.message("正在打开剪辑台…");
    await navigateToVideoEditor(projectId, (href) => {
      if (typeof window !== "undefined") {
        window.location.assign(withBasePath(href));
      }
    });
  }

  return (
    ackOk &&
    (created > 0 ||
      connected > 0 ||
      updated > 0 ||
      generateJobs.length > 0 ||
      toolOps.length > 0 ||
      openVideoEditor)
  );
  } finally {
    clearAgentCanvasBusy();
  }
}
