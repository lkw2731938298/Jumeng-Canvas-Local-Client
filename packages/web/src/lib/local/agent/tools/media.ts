/**
 * Agent 媒体工具：看图（vision）、列模型、生图、生视频。
 * 对齐 jumeng-media 的 list_models / generate_image / generate_video 能力，
 * 复用 localGenerate*，结果落到画布节点。
 */

import { defaultSourceHandle, resolveNodeRef } from "@/lib/canvas/projectAgentCanvasOps";
import { resolveAgentNodePosition } from "@/lib/canvas/agentPlaceNode";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import type { LocalChatToolCall } from "@/lib/local/generate";
import type { LocalModel } from "@/lib/local/types";
import { useCanvasStore } from "@/stores/canvasStore";
import type { LocalAgentOpResult } from "../executor";
import {
  resolveNodeImageUrlAsync,
  resolveNodeImageUrlSync,
} from "./resolveCanvasMedia";
import { parseToolArgs } from "./parseToolArgs";
import { isAgentTurnAbortedError } from "@/lib/canvas/agentCanvasBusy";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  // 模型有时把数组写成 JSON 字符串
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) return parsed.map((x) => str(x)).filter(Boolean);
    } catch {
      /* 继续按逗号拆 */
    }
  }
  if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}

/** @deprecated 请用 resolveNodeImageUrlAsync；同步仅读 params */
export function resolveNodeImageUrl(nodeId: string): string {
  return resolveNodeImageUrlSync(nodeId);
}

function resolveIds(
  ids: string[],
  names: string[],
  tempMap: Map<string, string>
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const nid = resolveNodeRef(id || undefined, undefined, tempMap);
    if (nid) out.push(nid);
  }
  for (const name of names) {
    const nid = resolveNodeRef(undefined, name || undefined, tempMap);
    if (nid) out.push(nid);
  }
  return [...new Set(out)];
}

/** 合并工具参数里的参考 + 用户本轮 @：模型已点名则尊重其选择，未点名才并入全部 @ */
function mergeReferenceIds(fromArgs: string[], extraIds: string[] | undefined): string[] {
  const args = [...new Set(fromArgs.map(str).filter(Boolean))];
  if (args.length) return args;
  return [...new Set((extraIds || []).map(str).filter(Boolean))];
}

async function resolveRefUrls(
  projectId: string,
  nodeIds: string[],
  extraUrls?: Map<string, string>
): Promise<{ urls: string[]; missing: string[] }> {
  const urls: string[] = [];
  const missing: string[] = [];
  for (const id of nodeIds) {
    let u = await resolveNodeImageUrlAsync(projectId, id);
    if (!u && extraUrls?.has(id)) u = extraUrls.get(id) || "";
    if (u) urls.push(u);
    else missing.push(id);
  }
  return { urls, missing };
}

/** media_inspect_images：把节点图交给文模看 */
export async function applyMediaInspect(
  call: LocalChatToolCall,
  opts: { projectId: string; textModelId: string; tempMap?: Map<string, string>; signal?: AbortSignal }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const tempMap = opts.tempMap || new Map<string, string>();
  const nodeIds = resolveIds(
    asStringList(a.nodeIds ?? a.nodeId),
    asStringList(a.nodeNames ?? a.nodeName),
    tempMap
  );
  if (!nodeIds.length) {
    return { op: call.name, ok: false, message: "缺少 nodeId / nodeIds" };
  }
  const urls: string[] = [];
  const missing: string[] = [];
  for (const id of nodeIds) {
    const u = await resolveNodeImageUrlAsync(opts.projectId, id);
    if (u) urls.push(u);
    else missing.push(id);
  }
  if (!urls.length) {
    return {
      op: call.name,
      ok: false,
      message: `节点没有可用图片：${nodeIds.join(", ")}。请确认图片节点已有图（或 @ 引用后再问）`,
      nodeId: nodeIds[0],
    };
  }
  const question =
    str(a.question) ||
    str(a.prompt) ||
    "请仔细观察这些图片，用中文简洁描述主体、构图、光影、色调与可用于创作的关键线索。";

  const { localGenerateText } = await import("@/lib/local/generate");
  try {
    const answer = await localGenerateText({
      modelId: opts.textModelId,
      system:
        "你是画布助手的看图模块。根据用户提供的图片如实描述与分析，不要编造看不见的细节。回复用中文。",
      prompt: question,
      images: urls,
      signal: opts.signal,
    });
    const note = missing.length ? `\n（未读到图的节点：${missing.join(", ")}）` : "";
    return {
      op: call.name,
      ok: true,
      message: `已看图（${urls.length} 张）`,
      detail: `${answer.trim()}${note}`,
      nodeId: nodeIds[0],
    };
  } catch (err) {
    if (isAgentTurnAbortedError(err) || opts.signal?.aborted) {
      return { op: call.name, ok: false, message: "用户已停止", nodeId: nodeIds[0] };
    }
    return {
      op: call.name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      nodeId: nodeIds[0],
    };
  }
}

/** media_list_models：列出本机已启用的图/视频模型（对齐 jumeng-media list_models） */
export async function applyMediaListModels(
  call: LocalChatToolCall,
  opts: { models: LocalModel[] }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const want = str(a.category || a.type || "all").toLowerCase();
  const rows = opts.models
    .filter((m) => m.enabled !== false)
    .filter((m) => {
      if (want === "image" || want === "video") return m.category === want;
      return m.category === "image" || m.category === "video";
    })
    .map((m) => ({
      name: m.name,
      displayName: m.displayName || m.name,
      category: m.category,
      id: m.id,
    }));
  return {
    op: call.name,
    ok: true,
    message: `可用模型 ${rows.length} 个`,
    detail: JSON.stringify(rows, null, 2),
  };
}

/** media_generate_image：参考生 / 文生图并落到图片节点 */
export async function applyMediaGenerateImage(
  call: LocalChatToolCall,
  opts: {
    projectId: string;
    models: LocalModel[];
    tempMap?: Map<string, string>;
    /** 用户本轮 @ 的图片节点，强制并入参考（防止模型只传一张） */
    preferReferenceNodeIds?: string[];
    preferReferenceUrls?: Map<string, string>;
    signal?: AbortSignal;
  }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const tempMap = opts.tempMap || new Map<string, string>();
  const prompt = str(a.prompt);
  if (!prompt) {
    return { op: call.name, ok: false, message: "缺少 prompt" };
  }

  const imageModels = opts.models.filter((m) => m.enabled !== false && m.category === "image");
  let modelName = str(a.model);
  if (!modelName && imageModels[0]) modelName = imageModels[0].name;
  if (!modelName) {
    return { op: call.name, ok: false, message: "未配置图片模型，请到「设置」添加" };
  }
  const model =
    imageModels.find((m) => m.name === modelName || m.id === modelName) ||
    opts.models.find((m) => m.name === modelName || m.id === modelName);
  if (!model || model.category !== "image") {
    return { op: call.name, ok: false, message: `找不到图片模型：${modelName}` };
  }

  const fromArgs = resolveIds(
    asStringList(a.referenceNodeIds ?? a.referenceNodeId ?? a.imageNodeIds),
    asStringList(a.referenceNodeNames),
    tempMap
  );
  const refIds = mergeReferenceIds(fromArgs, opts.preferReferenceNodeIds);
  const { urls: rawRefs, missing } = await resolveRefUrls(
    opts.projectId,
    refIds,
    opts.preferReferenceUrls
  );

  let targetId =
    resolveIds(
      asStringList(a.targetNodeId || a.nodeId || a.tempId),
      asStringList(a.targetNodeName || a.nodeName),
      tempMap
    )[0] || "";
  const label = str(a.label) || "生成图";
  const createIfMissing = a.createIfMissing !== false;
  const alias = str(a.tempId);

  if (!targetId && createIfMissing) {
    const { x, y } = resolveAgentNodePosition({}, useCanvasStore.getState().nodes);
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNode("image_input", { x, y }, { label });
    const created = useCanvasStore.getState().nodes.find((n) => !before.has(n.id));
    targetId = created?.id || "";
    if (targetId) {
      useCanvasStore.getState().updateNodeParam(targetId, "model", model.name);
      useCanvasStore.getState().updateNodeParam(targetId, "prompt", prompt);
      if (alias) tempMap.set(alias, targetId);
    }
  }
  if (!targetId) {
    return { op: call.name, ok: false, message: "找不到目标图片节点且未创建" };
  }

  // 把参考节点连到目标（便于用户后续再生成）；上传附件无画布节点，跳过连线
  for (const src of refIds) {
    if (src === targetId || src.startsWith("upload:")) continue;
    try {
      useCanvasStore.getState().connectNodes({
        source: src,
        target: targetId,
        sourceHandle: defaultSourceHandle(src),
        targetHandle: REFERENCE_INPUT_ID,
      });
    } catch {
      /* 已有连线等可忽略 */
    }
  }

  const {
    localGenerateImage,
    persistLocalImageResult,
    resolveLocalImageUrlsForUpstream,
    resolveJumengUploadCreds,
  } = await import("@/lib/local/generate");

  try {
    const jumengCreds = await resolveJumengUploadCreds(model.id || model.name);
    const jumengOfficial = jumengCreds !== null;
    const imageUrls = rawRefs.length
      ? await resolveLocalImageUrlsForUpstream(rawRefs, {
          preferPublicHttps: jumengOfficial,
          requirePublicHttps: !jumengOfficial,
          jumengUpload: jumengCreds,
        })
      : [];

    const aspectRatio = str(a.aspectRatio) || str(a.size) || "1:1";
    const resolution = str(a.resolution) || "2K";

    const raw = await localGenerateImage({
      modelId: model.id || model.name,
      prompt,
      aspectRatio: /:/.test(aspectRatio) ? aspectRatio : undefined,
      size: /:/.test(aspectRatio) ? aspectRatio : aspectRatio || undefined,
      resolution: resolution || undefined,
      imageUrls,
      signal: opts.signal,
    });

    const persisted = await persistLocalImageResult({
      projectId: opts.projectId,
      nodeId: targetId,
      url: raw.url,
      b64: raw.b64,
      assetTitle: label,
    });

    useCanvasStore.getState().applyNodeGeneratedMedia(targetId, "imageUrl", persisted.url, persisted.assetId);
    useCanvasStore.getState().updateNodeParam(targetId, "prompt", prompt);
    useCanvasStore.getState().updateNodeParam(targetId, "model", model.name);
    useCanvasStore.getState().scheduleAutoSave();

    return {
      op: call.name,
      ok: true,
      message: `已生成并写入节点（参考 ${imageUrls.length} 张${missing.length ? `，未读到 ${missing.length}` : ""}）`,
      nodeId: targetId,
      detail: `assetId=${persisted.assetId}; refs=${refIds.join(",")}`,
    };
  } catch (err) {
    if (isAgentTurnAbortedError(err) || opts.signal?.aborted) {
      return { op: call.name, ok: false, message: "用户已停止", nodeId: targetId };
    }
    return {
      op: call.name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      nodeId: targetId,
    };
  }
}

/** media_generate_video：文生/图生视频并落到视频节点（对齐 jumeng-media generate_video） */
export async function applyMediaGenerateVideo(
  call: LocalChatToolCall,
  opts: {
    projectId: string;
    models: LocalModel[];
    tempMap?: Map<string, string>;
    preferReferenceNodeIds?: string[];
    preferReferenceUrls?: Map<string, string>;
    signal?: AbortSignal;
  }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const tempMap = opts.tempMap || new Map<string, string>();
  const prompt = str(a.prompt);
  if (!prompt) {
    return { op: call.name, ok: false, message: "缺少 prompt" };
  }

  const videoModels = opts.models.filter((m) => m.enabled !== false && m.category === "video");
  let modelName = str(a.model);
  if (!modelName && videoModels[0]) modelName = videoModels[0].name;
  if (!modelName) {
    return { op: call.name, ok: false, message: "未配置视频模型，请到「设置」添加" };
  }
  const model =
    videoModels.find((m) => m.name === modelName || m.id === modelName) ||
    opts.models.find((m) => m.name === modelName || m.id === modelName);
  if (!model || model.category !== "video") {
    return { op: call.name, ok: false, message: `找不到视频模型：${modelName}` };
  }

  const fromArgs = resolveIds(
    asStringList(a.referenceNodeIds ?? a.referenceNodeId ?? a.imageNodeIds),
    asStringList(a.referenceNodeNames),
    tempMap
  );
  const refIds = mergeReferenceIds(fromArgs, opts.preferReferenceNodeIds);
  const { urls: rawRefs, missing } = await resolveRefUrls(
    opts.projectId,
    refIds,
    opts.preferReferenceUrls
  );

  let targetId =
    resolveIds(
      asStringList(a.targetNodeId || a.nodeId || a.tempId),
      asStringList(a.targetNodeName || a.nodeName),
      tempMap
    )[0] || "";
  const label = str(a.label) || "生成视频";
  const createIfMissing = a.createIfMissing !== false;
  const alias = str(a.tempId);

  if (!targetId && createIfMissing) {
    const { x, y } = resolveAgentNodePosition({}, useCanvasStore.getState().nodes);
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNode("video_input", { x, y }, { label });
    const created = useCanvasStore.getState().nodes.find((n) => !before.has(n.id));
    targetId = created?.id || "";
    if (targetId) {
      useCanvasStore.getState().updateNodeParam(targetId, "model", model.name);
      useCanvasStore.getState().updateNodeParam(targetId, "prompt", prompt);
      if (alias) tempMap.set(alias, targetId);
    }
  }
  if (!targetId) {
    return { op: call.name, ok: false, message: "找不到目标视频节点且未创建" };
  }

  for (const src of refIds) {
    if (src === targetId || src.startsWith("upload:")) continue;
    try {
      useCanvasStore.getState().connectNodes({
        source: src,
        target: targetId,
        sourceHandle: defaultSourceHandle(src),
        targetHandle: REFERENCE_INPUT_ID,
      });
    } catch {
      /* 已有连线等可忽略 */
    }
  }

  const {
    localGenerateVideo,
    persistLocalVideoResult,
    resolveLocalImageUrlsForUpstream,
    resolveJumengUploadCreds,
  } = await import("@/lib/local/generate");

  try {
    const jumengCreds = await resolveJumengUploadCreds(model.id || model.name);
    const jumengOfficial = jumengCreds !== null;
    const imageUrls = rawRefs.length
      ? await resolveLocalImageUrlsForUpstream(rawRefs, {
          preferPublicHttps: jumengOfficial,
          requirePublicHttps: !jumengOfficial,
          jumengUpload: jumengCreds,
        })
      : [];

    const durationSec = Number(a.durationSec || a.duration || 5) || 5;
    const resolution = str(a.resolution) || "768p";
    const ratio = str(a.ratio || a.aspectRatio || a.size) || "16:9";

    const raw = await localGenerateVideo({
      modelId: model.id || model.name,
      prompt,
      durationSec,
      resolution,
      ratio: /:/.test(ratio) ? ratio : "16:9",
      imageUrls,
      signal: opts.signal,
    });

    const preview = await persistLocalVideoResult({
      projectId: opts.projectId,
      nodeId: targetId,
      url: raw.url,
    });

    useCanvasStore.getState().applyNodeGeneratedMedia(targetId, "videoUrl", preview);
    useCanvasStore.getState().updateNodeParam(targetId, "prompt", prompt);
    useCanvasStore.getState().updateNodeParam(targetId, "model", model.name);
    useCanvasStore.getState().scheduleAutoSave();

    return {
      op: call.name,
      ok: true,
      message: `已生成视频并写入节点（参考图 ${imageUrls.length} 张${missing.length ? `，未读到 ${missing.length}` : ""}）`,
      nodeId: targetId,
      detail: raw.providerTaskId
        ? `providerTaskId=${raw.providerTaskId}; refs=${refIds.join(",")}`
        : `refs=${refIds.join(",")}; ${preview.slice(0, 80)}`,
    };
  } catch (err) {
    if (isAgentTurnAbortedError(err) || opts.signal?.aborted) {
      return { op: call.name, ok: false, message: "用户已停止", nodeId: targetId };
    }
    return {
      op: call.name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      nodeId: targetId,
    };
  }
}
