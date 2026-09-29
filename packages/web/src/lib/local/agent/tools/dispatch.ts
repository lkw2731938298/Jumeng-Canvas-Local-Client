/**
 * 把模型 tool_call 转成 CanvasOp，交给 executeLocalAgentOps。
 */

import type { QueryClient } from "@tanstack/react-query";
import type { CanvasOp } from "@/lib/api/agentSessions";
import type { LocalChatToolCall } from "@/lib/local/generate";
import type { LocalModel } from "@/lib/local/types";
import {
  executeLocalAgentOps,
  type LocalAgentOpResult,
} from "@/lib/local/agent/executor";
import { setDocumentLinkPreviewNodeId } from "@/lib/canvas/documentLinkPreview";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveAgentNodePosition } from "@/lib/canvas/agentPlaceNode";
import { defaultSourceHandle, resolveNodeRef } from "@/lib/canvas/projectAgentCanvasOps";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { applyMediaGenerateImage, applyMediaGenerateVideo, applyMediaInspect, applyMediaListModels } from "./media";
import { applyWebCreatePage, applyWebOpenPreview } from "./web";
import { applySkillReadReference } from "./skill";
import { parseToolArgs } from "./parseToolArgs";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 单条 tool_call → 0..n 个 CanvasOp（多数为 1） */
export function toolCallToOps(call: LocalChatToolCall): { ops: CanvasOp[]; error?: string } {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { ops: [], error: parsed.error };
  const a = parsed.args;
  const toolCallId = call.id;

  const baseRef = {
    toolCallId,
    nodeId: str(a.nodeId) || undefined,
    nodeName: str(a.nodeName) || undefined,
    tempId: str(a.tempId) || undefined,
    label: str(a.label) || undefined,
  };

  switch (call.name) {
    case "canvas_add_text_node":
      return {
        ops: [
          {
            op: "add_text_node",
            ...baseRef,
            content: str(a.content),
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    case "canvas_add_image_node": {
      const params: Record<string, unknown> = {
        ...((a.params as Record<string, unknown>) || {}),
      };
      if (str(a.model)) params.model = str(a.model);
      if (a.generationOptions && typeof a.generationOptions === "object") {
        params.generationOptions = a.generationOptions;
      }
      return {
        ops: [
          {
            op: "add_image_node",
            ...baseRef,
            prompt: str(a.prompt),
            params: Object.keys(params).length ? params : undefined,
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    }
    case "canvas_add_video_node": {
      const params: Record<string, unknown> = {
        ...((a.params as Record<string, unknown>) || {}),
      };
      if (str(a.model)) params.model = str(a.model);
      if (a.generationOptions && typeof a.generationOptions === "object") {
        params.generationOptions = a.generationOptions;
      }
      return {
        ops: [
          {
            op: "add_video_node",
            ...baseRef,
            prompt: str(a.prompt),
            params: Object.keys(params).length ? params : undefined,
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    }
    case "canvas_add_audio_node":
      return {
        ops: [
          {
            op: "add_audio_node",
            ...baseRef,
            prompt: str(a.prompt),
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    case "canvas_add_storyboard_node":
      return {
        ops: [
          {
            op: "add_storyboard_node",
            ...baseRef,
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    case "canvas_update_node": {
      const params: Record<string, unknown> = {
        ...((a.params as Record<string, unknown>) || {}),
      };
      if (str(a.prompt)) params.prompt = str(a.prompt);
      if (str(a.content)) params.content = str(a.content);
      if (str(a.label)) params.label = str(a.label);
      if (str(a.model)) params.model = str(a.model);
      return {
        ops: [
          {
            op: "update_node_params",
            ...baseRef,
            prompt: str(a.prompt) || undefined,
            content: str(a.content) || undefined,
            params,
          },
        ],
      };
    }
    case "canvas_connect":
      return {
        ops: [
          {
            op: "connect_nodes",
            toolCallId,
            source: str(a.source),
            sourceName: str(a.sourceName) || undefined,
            target: str(a.target),
            targetName: str(a.targetName) || undefined,
          },
        ],
      };
    case "canvas_disconnect":
      return {
        ops: [
          {
            op: "disconnect_nodes",
            toolCallId,
            source: str(a.source),
            target: str(a.target),
          },
        ],
      };
    case "canvas_move_node":
      return {
        ops: [
          {
            op: "layout_hint",
            ...baseRef,
            x: num(a.x),
            y: num(a.y),
          },
        ],
      };
    case "canvas_delete_node":
      return { ops: [{ op: "delete_node", ...baseRef }] };
    case "canvas_read_node":
      return { ops: [{ op: "read_node", ...baseRef }] };
    case "canvas_generate_node":
      return { ops: [{ op: "generate_node", ...baseRef }] };
    case "canvas_run_tool":
      return {
        ops: [
          {
            op: "run_canvas_tool",
            ...baseRef,
            tool: str(a.tool),
            scriptFromNodeId: str(a.scriptFromNodeId) || undefined,
            params: (a.params as Record<string, unknown>) || undefined,
          },
        ],
      };
    case "canvas_set_document_link":
    case "media_inspect_images":
    case "media_list_models":
    case "media_generate_image":
    case "media_generate_video":
    case "skill_read_reference":
    case "web_create_page":
    case "web_open_preview":
      // 复杂/异步逻辑在 dispatch 里处理
      return { ops: [] };
    default:
      return { ops: [], error: `未知工具：${call.name}` };
  }
}

async function applyDocumentLink(
  call: LocalChatToolCall,
  tempMap: Map<string, string>
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const linkUrl = str(a.linkUrl);
  if (!linkUrl) {
    return { op: call.name, ok: false, message: "缺少 linkUrl" };
  }
  let nodeId =
    resolveNodeRef(str(a.nodeId) || str(a.tempId) || undefined, str(a.nodeName) || undefined, tempMap) ||
    str(a.nodeId);
  const label = str(a.label) || "网页链接";
  const createIfMissing = a.createIfMissing !== false;
  const alias = str(a.tempId);

  if (!nodeId && createIfMissing) {
    const { x, y } = resolveAgentNodePosition({}, useCanvasStore.getState().nodes);
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNode("document_input", { x, y }, { label });
    const created = useCanvasStore.getState().nodes.find((n) => !before.has(n.id));
    nodeId = created?.id || "";
    if (nodeId && alias) tempMap.set(alias, nodeId);
  }

  if (!nodeId) {
    return { op: call.name, ok: false, message: "找不到文档节点且未创建" };
  }

  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) {
    return { op: call.name, ok: false, message: `节点 ${nodeId} 不存在` };
  }
  // 若不是 document_input，仍写入 params（兼容）；理想情况是 document
  useCanvasStore.getState().updateNodeData(nodeId, {
    label: label || String(node.data?.label || ""),
    params: {
      ...((node.data?.params as Record<string, unknown>) || {}),
      resourceKind: "link",
      linkUrl,
      fileUrl: "",
      fileName: "",
      assetId: "",
    },
  });
  useCanvasStore.getState().scheduleAutoSave();
  // 自动打开内嵌预览（用户可关）
  setDocumentLinkPreviewNodeId(nodeId);
  return {
    op: call.name,
    ok: true,
    message: `已设置网址并打开预览：${linkUrl}`,
    nodeId,
  };
}

/** 执行一批 tool_calls，返回与调用顺序对齐的结果（含 toolCallId） */
export async function dispatchAgentToolCalls(opts: {
  projectId: string;
  calls: LocalChatToolCall[];
  models: LocalModel[];
  /** 当前对话文本模型（看图用） */
  textModelId?: string;
  /** 面板启用的技能 slug */
  activeSkillSlug?: string | null;
  queryClient?: QueryClient;
  /** 同一用户回合内跨 tool 轮次共享 tempId */
  tempMap?: Map<string, string>;
  /**
   * 用户本轮 @ 的图片节点 id（含 upload:…）。
   * 生图/生视频时强制并入参考，避免模型只传一张。
   */
  preferReferenceNodeIds?: string[];
  /** upload: 等节点的可取图 URL */
  preferReferenceUrls?: Map<string, string>;
  /** 用户停止时中断媒体生成/轮询 */
  signal?: AbortSignal;
}): Promise<Array<LocalAgentOpResult & { toolCallId: string }>> {
  const {
    projectId,
    calls,
    models,
    queryClient,
    textModelId,
    activeSkillSlug,
    preferReferenceNodeIds,
    preferReferenceUrls,
    signal,
  } = opts;
  const tempMap = opts.tempMap || new Map<string, string>();
  const out: Array<LocalAgentOpResult & { toolCallId: string }> = [];
  const preferIds = (preferReferenceNodeIds || []).map(String).filter(Boolean);

  // 先收集可批量投影的 ops（保持相对顺序：按 call 分组执行）
  for (const call of calls) {
    if (signal?.aborted) {
      out.push({
        op: call.name,
        ok: false,
        message: "用户已停止",
        toolCallId: call.id,
      });
      continue;
    }
    if (call.name === "canvas_set_document_link") {
      const r = await applyDocumentLink(call, tempMap);
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "media_inspect_images") {
      if (!textModelId) {
        out.push({
          op: call.name,
          ok: false,
          message: "未指定文本模型，无法看图",
          toolCallId: call.id,
        });
        continue;
      }
      const r = await applyMediaInspect(call, { projectId, textModelId, tempMap, signal });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "media_list_models") {
      const r = await applyMediaListModels(call, { models });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "media_generate_image") {
      const r = await applyMediaGenerateImage(call, {
        projectId,
        models,
        tempMap,
        preferReferenceNodeIds: preferIds,
        preferReferenceUrls,
        signal,
      });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "media_generate_video") {
      const r = await applyMediaGenerateVideo(call, {
        projectId,
        models,
        tempMap,
        preferReferenceNodeIds: preferIds,
        preferReferenceUrls,
        signal,
      });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "skill_read_reference") {
      const r = await applySkillReadReference(call, { activeSkillSlug });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "web_create_page") {
      const r = await applyWebCreatePage(call, {
        projectId,
        tempMap,
        preferReferenceNodeIds: preferIds,
      });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }
    if (call.name === "web_open_preview") {
      const r = await applyWebOpenPreview(call, { tempMap });
      out.push({ ...r, toolCallId: call.id });
      continue;
    }

    // 触发生成前：把用户 @ 的参考图全部连到目标节点（避免只连一张）
    if (call.name === "canvas_generate_node" && preferIds.length) {
      const parsed = parseToolArgs(call.arguments);
      const a = parsed.error ? {} : parsed.args;
      const targetId =
        resolveNodeRef(
          str(a.nodeId) || str(a.tempId) || undefined,
          str(a.nodeName) || undefined,
          tempMap
        ) || "";
      if (targetId) {
        const target = useCanvasStore.getState().nodes.find((n) => n.id === targetId);
        const t = String(target?.type || "");
        if (t === "image_input" || t === "video_input") {
          for (const src of preferIds) {
            if (!src || src === targetId || src.startsWith("upload:")) continue;
            try {
              useCanvasStore.getState().connectNodes({
                source: src,
                target: targetId,
                sourceHandle: defaultSourceHandle(src),
                targetHandle: REFERENCE_INPUT_ID,
              });
            } catch {
              /* 已有连线 */
            }
          }
        }
      }
    }

    const mapped = toolCallToOps(call);
    if (mapped.error) {
      out.push({
        op: call.name,
        ok: false,
        message: mapped.error,
        toolCallId: call.id,
      });
      continue;
    }
    if (!mapped.ops.length) {
      out.push({
        op: call.name,
        ok: false,
        message: "无有效操作",
        toolCallId: call.id,
      });
      continue;
    }
    const results = await executeLocalAgentOps({
      projectId,
      ops: mapped.ops,
      models,
      queryClient,
      tempMap,
    });
    if (!results.length) {
      out.push({
        op: call.name,
        ok: true,
        message: "已执行",
        toolCallId: call.id,
      });
      continue;
    }
    for (const r of results) {
      out.push({ ...r, toolCallId: call.id });
    }
  }
  return out;
}
