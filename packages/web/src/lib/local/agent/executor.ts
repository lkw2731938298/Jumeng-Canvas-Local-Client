/**
 * 本地 Agent 执行器：把模型下发的 ops 投影到画布（无云端 ack / 会话回传）。
 * 节点解析、摆放、参数合并复用 projectAgentCanvasOps 的辅助函数，与云端行为一致。
 * 执行顺序：结构类（加节点/改参/连线/移动/删除/读取）→ 画布工具 → 生成。
 */

import type { QueryClient } from "@tanstack/react-query";

import type { CanvasOp } from "@/lib/api/agentSessions";
import { fetchNodeText, saveNodeText } from "@/lib/api/nodeText";
import {
  clearAgentCanvasBusy,
  getAgentCanvasStopToken,
  getAgentTurnAbortSignal,
  setAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import {
  addTypedNode,
  applyAgentParams,
  defaultSourceHandle,
  resolveNodeRef,
  setNodeLabel,
} from "@/lib/canvas/projectAgentCanvasOps";
import { resolveAgentNodePosition } from "@/lib/canvas/agentPlaceNode";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { runAgentCanvasTool } from "@/lib/canvas/runAgentCanvasTool";
import { runOneGeneratableNode } from "@/lib/canvas/runOneGeneratableNode";
import type { LocalModel } from "@/lib/local/types";
import { useCanvasStore } from "@/stores/canvasStore";

/** 单条操作执行结果（回显聊天 + 回传模型） */
export type LocalAgentOpResult = {
  op: string;
  ok: boolean;
  message: string;
  nodeId?: string;
  /** read_node 读回的正文，仅回传模型 */
  detail?: string;
};

/** read_node 回传正文上限 */
const READ_NODE_MAX = 4000;

const MEDIA_CATEGORY: Record<string, "image" | "video" | "audio"> = {
  image_input: "image",
  video_input: "video",
  audio_input: "audio",
};

function findNode(id: string) {
  return useCanvasStore.getState().nodes.find((n) => n.id === id);
}

/** 节点展示名（结果文案用），无名称时回退 id */
function labelOf(id: string): string {
  return String(findNode(id)?.data?.label || id);
}

function nodeParams(id: string): Record<string, unknown> {
  return ((findNode(id)?.data as { params?: Record<string, unknown> } | undefined)?.params ||
    {}) as Record<string, unknown>;
}

/** 媒体节点没有模型时，填本地第一个启用的同类模型（本地版无云端默认模型） */
function ensureLocalModel(nodeId: string, models: LocalModel[]): void {
  const node = findNode(nodeId);
  const cat = node ? MEDIA_CATEGORY[String(node.type)] : undefined;
  if (!cat) return;
  if (String(nodeParams(nodeId).model || "").trim()) return;
  const first = models.find((m) => m.enabled !== false && m.category === cat);
  if (first) useCanvasStore.getState().updateNodeParam(nodeId, "model", first.name);
}

/** 文本节点正文：画布参数 + 节点文本存储同时写入 */
async function writeTextContent(projectId: string, nodeId: string, content: string): Promise<void> {
  useCanvasStore.getState().updateNodeParam(nodeId, "content", content);
  try {
    await saveNodeText(projectId, nodeId, content, String(nodeParams(nodeId).model || ""));
  } catch {
    /* 文本存储失败时仍保留画布参数 */
  }
}

/**
 * 新建节点：tempId 只作本批 ops 内的别名，节点本身用系统生成的真实 id。
 * （云端投影会把 tempId 当节点 id；本地多轮对话中模型会复用 t1 等别名，若当 id 会误复用旧节点）
 */
function createTypedNode(
  type: Parameters<typeof addTypedNode>[0],
  op: CanvasOp,
  tempMap: Map<string, string>
): string | null {
  const alias = String(op.tempId || "").trim();
  const id = addTypedNode(type, { ...op, tempId: undefined, shotId: undefined }, tempMap);
  if (id && alias) tempMap.set(alias, id);
  return id;
}

function refOf(op: CanvasOp): string {
  return String(op.nodeId || op.tempId || op.nodeName || "").trim();
}

export async function executeLocalAgentOps(opts: {
  projectId: string;
  ops: CanvasOp[];
  models: LocalModel[];
  queryClient?: QueryClient;
  /** 跨工具调用共享的 tempId → 真实 nodeId（同一轮对话内） */
  tempMap?: Map<string, string>;
}): Promise<LocalAgentOpResult[]> {
  const { projectId, ops, models, queryClient } = opts;
  const results: LocalAgentOpResult[] = [];
  if (!ops.length) return results;
  if (useCanvasStore.getState().isLoading) {
    return ops.map((o) => ({ op: o.op, ok: false, message: "画布仍在加载，请稍后再试" }));
  }

  const stopAt = getAgentCanvasStopToken();
  const stopped = () => getAgentCanvasStopToken() !== stopAt;
  const tempMap = opts.tempMap || new Map<string, string>();
  const toolOps: CanvasOp[] = [];
  const genOps: Array<{ op: CanvasOp; nodeId: string }> = [];
  let structural = 0;

  const push = (op: CanvasOp, ok: boolean, message: string, nodeId?: string, detail?: string) => {
    results.push({ op: op.op, ok, message, nodeId, detail });
  };
  const resolve = (id?: string, name?: string) => resolveNodeRef(id, name, tempMap);

  setAgentCanvasBusy("projecting", "AI 正在操控画布…");
  try {
    for (const op of ops) {
      if (stopped()) {
        push(op, false, "用户已停止");
        continue;
      }
      try {
        switch (op.op) {
          case "add_text_node": {
            const id = createTypedNode("text_input", op, tempMap);
            if (!id) {
              push(op, false, "未能创建文本节点");
              break;
            }
            if (op.content) await writeTextContent(projectId, id, op.content);
            if (op.params) applyAgentParams(id, op.params);
            structural += 1;
            push(op, true, `已创建文本节点「${op.label || id}」`, id);
            break;
          }
          case "add_image_node":
          case "add_video_node":
          case "add_audio_node": {
            const type =
              op.op === "add_image_node"
                ? "image_input"
                : op.op === "add_video_node"
                  ? "video_input"
                  : "audio_input";
            const id = createTypedNode(type, op, tempMap);
            if (!id) {
              push(op, false, "未能创建节点");
              break;
            }
            if (op.prompt) useCanvasStore.getState().updateNodeParam(id, "prompt", op.prompt);
            if (op.params) applyAgentParams(id, op.params);
            ensureLocalModel(id, models);
            structural += 1;
            push(op, true, `已创建${type === "image_input" ? "图片" : type === "video_input" ? "视频" : "音频"}节点「${op.label || id}」`, id);
            break;
          }
          case "add_storyboard_node": {
            const tempId = (op.tempId || "").trim();
            const { x, y } = resolveAgentNodePosition(
              { x: op.x, y: op.y },
              useCanvasStore.getState().nodes,
              { defaultY: 320 }
            );
            const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
            useCanvasStore.getState().addNode("storyboard_grid", { x, y }, {
              label: op.label || "分镜表",
            });
            const created = useCanvasStore.getState().nodes.find((n) => !before.has(n.id));
            if (!created) {
              push(op, false, "未能创建分镜表节点");
              break;
            }
            if (tempId) tempMap.set(tempId, created.id);
            if (op.label) setNodeLabel(created.id, op.label);
            structural += 1;
            push(op, true, `已创建分镜表「${op.label || "分镜表"}」`, created.id);
            break;
          }
          case "update_node_params": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            if (!id) {
              push(op, false, `找不到节点 ${refOf(op)}`);
              break;
            }
            const params = { ...(op.params || {}) } as Record<string, unknown>;
            if (op.prompt && params.prompt == null) params.prompt = op.prompt;
            if (op.content && params.content == null) params.content = op.content;
            if (!Object.keys(params).length) {
              push(op, false, "缺少 params", id);
              break;
            }
            // 文本节点正文需同步写节点文本存储
            if (findNode(id)?.type === "text_input" && typeof params.content === "string") {
              await writeTextContent(projectId, id, params.content);
              delete params.content;
            }
            if (Object.keys(params).length) applyAgentParams(id, params);
            structural += 1;
            push(op, true, "已更新节点参数", id);
            break;
          }
          case "connect_nodes": {
            const source = resolve(op.source, op.sourceName);
            const target = resolve(op.target, op.targetName);
            if (!source || !target) {
              push(op, false, `连线失败：找不到${!source ? `源 ${op.source || op.sourceName || ""}` : `目标 ${op.target || op.targetName || ""}`}`);
              break;
            }
            useCanvasStore.getState().connectNodes({
              source,
              target,
              sourceHandle: op.sourceHandle || defaultSourceHandle(source),
              targetHandle: op.targetHandle || REFERENCE_INPUT_ID,
            });
            structural += 1;
            push(op, true, `已连线 ${labelOf(source)} → ${labelOf(target)}`, target);
            break;
          }
          case "disconnect_nodes": {
            const source = resolve(op.source, op.sourceName);
            const target = resolve(op.target, op.targetName);
            if (!source || !target) {
              push(op, false, "断线失败：找不到端点");
              break;
            }
            const edges = useCanvasStore.getState().edges;
            const next = edges.filter((e) => !(e.source === source && e.target === target));
            if (next.length === edges.length) {
              push(op, false, "两节点之间没有连线", target);
              break;
            }
            useCanvasStore.getState().setEdges(next);
            structural += 1;
            push(op, true, `已断开 ${labelOf(source)} → ${labelOf(target)}`, target);
            break;
          }
          case "layout_hint": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            const x = Number(op.x);
            const y = Number(op.y);
            if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
              push(op, false, "移动失败：节点或坐标无效");
              break;
            }
            const others = useCanvasStore.getState().nodes.filter((n) => n.id !== id);
            const pos = resolveAgentNodePosition({ x, y }, others);
            useCanvasStore
              .getState()
              .setNodes(
                useCanvasStore.getState().nodes.map((n) => (n.id === id ? { ...n, position: pos } : n))
              );
            structural += 1;
            push(op, true, "已移动节点", id);
            break;
          }
          case "delete_node": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            if (!id) {
              push(op, false, `找不到节点 ${refOf(op)}`);
              break;
            }
            const label = labelOf(id);
            // 复用节点列表面板的删除路径（含撤销栈与连线清理）
            useCanvasStore.getState().selectNode(id);
            useCanvasStore.getState().removeSelectedNodes();
            structural += 1;
            push(op, true, `已删除节点「${label}」`);
            break;
          }
          case "read_node": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            const node = id ? findNode(id) : undefined;
            if (!id || !node) {
              push(op, false, `找不到节点 ${refOf(op)}`);
              break;
            }
            const p = nodeParams(id);
            let text = String(p.prompt || p.content || "");
            // 文档节点：优先 HTML / 外链（web_create_page 写在 htmlContent）
            if (node.type === "document_input") {
              const kind = String(p.resourceKind || "file");
              const html = String(p.htmlContent || "").trim();
              const link = String(p.linkUrl || "").trim();
              if (kind === "html" && html) {
                text = html;
              } else if ((kind === "link" || link) && link) {
                text = link;
              } else if (html) {
                text = html;
              }
            }
            if (node.type === "text_input" || (node.type === "document_input" && !text)) {
              try {
                const rec = await fetchNodeText(projectId, id);
                if (rec?.content) text = rec.content;
              } catch {
                /* 读文本存储失败时用画布参数 */
              }
            }
            const clipped = text.length > READ_NODE_MAX ? `${text.slice(0, READ_NODE_MAX)}…（已截断）` : text;
            push(op, true, `已读取节点「${String(node.data?.label || id)}」`, id, clipped || "（无正文）");
            break;
          }
          case "generate_node": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            if (!id) {
              push(op, false, `找不到要生成的节点 ${refOf(op)}`);
              break;
            }
            genOps.push({ op, nodeId: id });
            break;
          }
          case "run_canvas_tool": {
            const id = resolve(op.nodeId || op.tempId, op.nodeName);
            if (!id) {
              push(op, false, `找不到工具目标节点 ${refOf(op)}`);
              break;
            }
            toolOps.push({
              ...op,
              nodeId: id,
              scriptFromNodeId: op.scriptFromNodeId
                ? resolve(op.scriptFromNodeId, op.scriptFromNodeName) || op.scriptFromNodeId
                : undefined,
            });
            break;
          }
          default:
            push(op, false, `不支持的操作 ${op.op}`);
        }
      } catch (err) {
        push(op, false, err instanceof Error ? err.message : "执行失败");
      }
    }

    if (structural > 0) useCanvasStore.getState().scheduleAutoSave();

    // 画布工具串行执行（本地版无算力，creditsEnabled=false）
    for (const top of toolOps) {
      if (stopped()) {
        push(top, false, "用户已停止");
        continue;
      }
      const tool = String(top.tool || "");
      setAgentCanvasBusy("tool", `AI 正在执行工具「${tool}」…`);
      try {
        const r = await runAgentCanvasTool(
          projectId,
          { tool, nodeId: String(top.nodeId || ""), scriptFromNodeId: top.scriptFromNodeId, params: top.params },
          {
            queryClient,
            creditsEnabled: false,
            workflowId: useCanvasStore.getState().workflowId,
            openInlineVideoTrim: (nid, dur) => useCanvasStore.getState().openInlineVideoTrim(nid, dur),
          }
        );
        push(
          top,
          r.ok,
          r.ok
            ? `工具 ${tool} 已执行${r.resultNodeIds?.length ? `，结果节点 ${r.resultNodeIds.join(", ")}` : ""}`
            : `工具 ${tool} 失败：${r.error || "未知原因"}`,
          r.resultNodeIds?.[0] || String(top.nodeId || "")
        );
      } catch (err) {
        push(top, false, `工具 ${tool} 失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 生成：逐个提交并等待结果（与手动点生成同一路径）
    if (genOps.length) {
      const batchId = `local-agent-${Date.now()}`;
      for (let i = 0; i < genOps.length; i += 1) {
        const { op, nodeId } = genOps[i];
        if (stopped()) {
          push(op, false, "用户已停止", nodeId);
          continue;
        }
        if (!findNode(nodeId)) {
          push(op, false, `节点 ${nodeId} 不在画布上`, nodeId);
          continue;
        }
        ensureLocalModel(nodeId, models);
        setAgentCanvasBusy("generating", `AI 正在生成（${i + 1}/${genOps.length}）…`);
        const outcome = await runOneGeneratableNode({
          projectId,
          nodeId,
          batchId,
          signal: getAgentTurnAbortSignal() ?? undefined,
        });
        if (outcome.ok) {
          push(op, true, "生成完成", outcome.mediaNodeId || nodeId);
        } else if (outcome.error === "用户已停止" || stopped()) {
          push(op, false, "用户已停止", nodeId);
        } else {
          push(op, false, `生成失败：${outcome.error}`, nodeId);
          if (outcome.abortBatch) {
            for (const rest of genOps.slice(i + 1)) {
              push(rest.op, false, "未执行：批次已中止", rest.nodeId);
            }
            break;
          }
        }
      }
      useCanvasStore.getState().scheduleAutoSave();
    }
  } finally {
    // 助手回合仍在进行时由 runtime 收尾清忙碌态，避免工具轮之间横幅闪烁
    if (!getAgentTurnAbortSignal()) {
      clearAgentCanvasBusy();
    }
  }
  return results;
}

/** 执行结果转成回传模型的文本 */
export function formatOpResultsForModel(results: LocalAgentOpResult[]): string {
  return results
    .map((r, i) => {
      const head = `${i + 1}. ${r.op} ${r.ok ? "成功" : "失败"}：${r.message}${r.nodeId ? `（nodeId=${r.nodeId}）` : ""}`;
      return r.detail ? `${head}\n正文：\n${r.detail}` : head;
    })
    .join("\n");
}
