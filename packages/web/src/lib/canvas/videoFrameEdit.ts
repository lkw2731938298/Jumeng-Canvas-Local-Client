/**
 * 视频画面编辑：时长门禁 + 本地智能抠像 + 上游主体消除/修改/替换。
 * 强制源片 ≤ MAX_VIDEO_FRAME_EDIT_SEC，超出须先剪辑。
 */

import type { Edge } from "@xyflow/react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import { notifyAssetsUpdated, type Asset } from "@/lib/api/assets";
import { getCreditQuote } from "@/lib/api/credits";
import { consumeLocalCanvasTool, resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import { getNodeWorldPosition } from "@/lib/canvas/canvasOverlayTransform";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { REFERENCE_INPUT_ID, isReferenceTargetHandle } from "@/lib/canvas/referencePort";
import { resolveMediaGenerationAssetId } from "@/lib/canvas/canvasToolGeneratedImage";
import {
  canvasVideoToolBillingOptions,
  resolveCanvasVideoBillSeconds,
} from "@/lib/canvas/canvasVideoToolBilling";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  maybeToastCreditCharged,
  newIdempotencyKey,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasStore } from "@/stores/canvasStore";
import type { AppNode } from "@/lib/canvas/nodeGroup";
import type { GenerationOptions } from "@/types/generationPresets";
import type { WorkflowNodeData } from "@/types/workflow";

/** 与后端 MAX_VIDEO_FRAME_EDIT_SEC 对齐 */
export const MAX_VIDEO_FRAME_EDIT_SEC = 12;

/** 上游画面编辑执行结果：失败必须带原因，供助手回传，禁止只返回 false */
export type VideoFrameEditRunResult = { ok: true } | { ok: false; error: string };

export type VideoFrameEditMode =
  | "smart_matting"
  | "subject_remove"
  | "subject_edit"
  | "subject_replace";

export const VIDEO_FRAME_EDIT_TOOLS: Record<
  VideoFrameEditMode,
  { canvasTool: string; label: string; local: boolean }
> = {
  smart_matting: {
    canvasTool: "video_smart_matting",
    label: "智能抠像",
    local: true,
  },
  subject_remove: {
    canvasTool: "video_subject_remove",
    label: "主体消除",
    local: false,
  },
  subject_edit: {
    canvasTool: "video_subject_edit",
    label: "主体修改",
    local: false,
  },
  subject_replace: {
    canvasTool: "video_subject_replace",
    label: "主体替换",
    local: false,
  },
};

function normalizeAsset(raw: Record<string, unknown>): Asset {
  const fileUrl = ensureHttpsOssUrl(String(raw.fileUrl ?? raw.file_url ?? ""));
  const thumbnailUrl = ensureHttpsOssUrl(
    String(raw.thumbnailUrl ?? raw.thumbnail_url ?? fileUrl)
  );
  return {
    id: String(raw.id ?? ""),
    projectId: String(raw.projectId ?? raw.project_id ?? ""),
    title: String(raw.title ?? ""),
    category: "video",
    subcategory: (raw.subcategory as string | null) ?? null,
    ossKey: String(raw.ossKey ?? raw.oss_key ?? ""),
    fileUrl,
    thumbnailUrl: thumbnailUrl || fileUrl,
    fileType: String(raw.fileType ?? raw.file_type ?? "video/webm"),
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    createdAt: String(raw.createdAt ?? raw.created_at ?? ""),
  };
}

/** 读取视频时长（秒）；失败返回 null */
export async function probeVideoDurationSec(videoUrl: string): Promise<number | null> {
  if (!videoUrl) return null;
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.ondurationchange = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(v);
    };
    const readDur = (): number | null => {
      const d = Number(video.duration);
      if (Number.isFinite(d) && d > 0 && d < 600) return d;
      try {
        if (video.seekable && video.seekable.length > 0) {
          const end = video.seekable.end(video.seekable.length - 1);
          if (Number.isFinite(end) && end > 0 && end < 600) return end;
        }
      } catch {
        /* ignore */
      }
      return null;
    };
    video.onloadedmetadata = () => {
      const d = readDur();
      if (d != null) done(d);
    };
    video.ondurationchange = () => {
      const d = readDur();
      if (d != null) done(d);
    };
    video.onerror = () => done(null);
    const timer = window.setTimeout(() => done(readDur()), 4000);
    video.src = videoUrl;
  });
}

/**
 * 时长门禁：超限则提示并打开剪辑；返回 true 表示可继续。
 * 优先用画布上已加载的 video 元素时长（与用户所见一致），避免另建 video 误读。
 */
export async function ensureVideoFrameEditDuration(opts: {
  nodeId: string;
  videoUrl: string;
  /** 画布节点已挂载 video 的 duration（秒） */
  knownDurationSec?: number | null;
  openTrim: (nodeId: string) => void;
}): Promise<boolean> {
  let dur: number | null = null;
  const known = opts.knownDurationSec;
  if (typeof known === "number" && Number.isFinite(known) && known > 0 && known < 600) {
    dur = known;
  } else {
    dur = await probeVideoDurationSec(opts.videoUrl);
  }
  if (dur == null) {
    toast.message("浏览器暂未读到时长，将由服务端校验（须 ≤12 秒）");
    return true;
  }
  if (dur > MAX_VIDEO_FRAME_EDIT_SEC + 0.05) {
    toast.error(
      `画面编辑仅支持 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒，当前约 ${dur.toFixed(1)} 秒。请先剪辑后再试`
    );
    opts.openTrim(opts.nodeId);
    return false;
  }
  return true;
}

async function resolveToolModel(canvasTool: string, fallback: string): Promise<string> {
  // 兼容 apiFetch 把 video_subject_edit 转成 videoSubjectEdit；缺配置回退 fallback
  return resolveCanvasToolPrimaryModel(canvasTool, fallback);
}

/** 读取后台「主体修改 / 替换」追加提示词 */
async function loadFrameEditAdminPrompt(canvasTool: string): Promise<string> {
  const fallback =
    PROMPT_SUFFIX_FALLBACKS[canvasTool as keyof typeof PROMPT_SUFFIX_FALLBACKS]?.content ?? "";
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.[canvasTool] as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append" && tool.appendText?.trim()) {
      return tool.appendText.trim();
    }
  } catch {
    /* 回退默认 */
  }
  return fallback;
}

/**
 * 从连入本视频「参考」口的图片节点解析可访问 URL。
 * 须走 assetId→签名 URL，不能只读 params.imageUrl（多数节点仅存 assetId）。
 */
export async function findConnectedReferenceImageUrl(
  projectId: string,
  videoNodeId: string
): Promise<string | null> {
  const { nodes, edges } = useCanvasStore.getState();
  for (const e of edges) {
    if (e.target !== videoNodeId) continue;
    if (!isReferenceTargetHandle(e.targetHandle)) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src || src.type !== "image_input") continue;
    const params = ((src.data as WorkflowNodeData | undefined)?.params ?? {}) as Record<
      string,
      unknown
    >;
    try {
      const resolved = await resolveNodeMediaUrl(projectId, params, "imageUrl");
      const url = ensureHttpsOssUrl(resolved.trim());
      if (url) return url;
    } catch {
      /* 试下一条连线 */
    }
  }
  return null;
}

function imageUrlFromNodeParams(
  projectId: string,
  nodeId: string
): Promise<string | null> {
  const src = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!src || src.type !== "image_input") return Promise.resolve(null);
  const params = ((src.data as WorkflowNodeData | undefined)?.params ?? {}) as Record<
    string,
    unknown
  >;
  return resolveNodeMediaUrl(projectId, params, "imageUrl")
    .then((raw) => {
      const url = ensureHttpsOssUrl(raw.trim());
      return url || null;
    })
    .catch(() => null);
}

/** 把图片接到视频参考口（已有连线则跳过） */
function ensureImageRefEdge(imageNodeId: string, videoNodeId: string): void {
  const store = useCanvasStore.getState();
  const exists = store.edges.some(
    (e) =>
      e.source === imageNodeId &&
      e.target === videoNodeId &&
      isReferenceTargetHandle(e.targetHandle)
  );
  if (exists) return;
  store.connectNodes({
    source: imageNodeId,
    target: videoNodeId,
    sourceHandle: "image",
    targetHandle: REFERENCE_INPUT_ID,
  });
}

/**
 * 助手路径解析主体替换参考图：params 指定 → 已连参考口 → 选中/画布上最近一张有图的 image_input。
 * 找到后自动接到视频 ref_in，与人手点顶栏行为对齐。
 */
export async function resolveAgentSubjectReplaceImageUrl(
  projectId: string,
  videoNodeId: string,
  params?: Record<string, unknown>
): Promise<string | null> {
  const direct = String(params?.refImageUrl || "").trim();
  if (direct) return ensureHttpsOssUrl(direct) || null;

  const extraIds: string[] = [];
  const one = String(params?.refImageNodeId || params?.referenceNodeId || "").trim();
  if (one) extraIds.push(one);
  const many = params?.referenceNodeIds;
  if (Array.isArray(many)) {
    for (const item of many) {
      const id = String(item || "").trim();
      if (id) extraIds.push(id);
    }
  }
  for (const id of extraIds) {
    const url = await imageUrlFromNodeParams(projectId, id);
    if (url) {
      ensureImageRefEdge(id, videoNodeId);
      return url;
    }
  }

  const connected = await findConnectedReferenceImageUrl(projectId, videoNodeId);
  if (connected) return connected;

  // 仅用当前选中的图片，避免误把画布上其它图当替换主体
  const store = useCanvasStore.getState();
  const selected = store.nodes.filter((n) => n.type === "image_input" && Boolean(n.selected));
  for (const src of selected) {
    const url = await imageUrlFromNodeParams(projectId, src.id);
    if (!url) continue;
    ensureImageRefEdge(src.id, videoNodeId);
    return url;
  }
  return null;
}

/** 用户说明优先，再拼后台后缀，避免用户输入被模板盖住 */
function buildUpstreamFrameEditPrompt(userPrompt: string, adminSuffix: string): string {
  const parts = [userPrompt.trim()];
  const suffix = adminSuffix.trim();
  if (suffix && suffix !== userPrompt.trim()) parts.push(suffix);
  return parts.filter(Boolean).join("。");
}

function placeResultNode(
  sourceNode: AppNode,
  edges: Edge[],
  asset: { id: string; fileUrl: string; title: string },
  meta: { mode: VideoFrameEditMode; sourceAssetId: string }
): string | null {
  const store = useCanvasStore.getState();
  const { width } = resolveNodeSize(sourceNode.width, sourceNode.height);
  const worldPos = getNodeWorldPosition(sourceNode, store.nodes);
  const siblingOffset =
    edges.filter((e) => e.source === sourceNode.id && e.sourceHandle === "video").length * 32;

  const fileUrl = ensureHttpsOssUrl(asset.fileUrl);
  store.addNodeFromAsset(
    {
      id: asset.id,
      category: "video",
      fileUrl,
      title: asset.title,
    },
    { x: worldPos.x + width + 48, y: worldPos.y + siblingOffset }
  );
  // addNodeFromAsset 后重新取 state，避免 snapshot.selectedNodeId 仍为旧值
  const after = useCanvasStore.getState();
  const newId = after.selectedNodeId;
  if (!newId) return null;
  after.connectNodes({
    source: sourceNode.id,
    target: newId,
    sourceHandle: "video",
    targetHandle: REFERENCE_INPUT_ID,
  });
  // 强制写入 URL：addNodeFromAsset 对非签名链可能跳过 videoUrl
  if (fileUrl) after.updateNodeParam(newId, "videoUrl", fileUrl);
  after.updateNodeParam(newId, "assetId", asset.id);
  after.updateNodeParam(newId, "toolMode", "video_frame_edit");
  after.updateNodeParam(newId, "frameEditMeta", {
    mode: meta.mode,
    sourceAssetId: meta.sourceAssetId,
  });
  after.updateNodeData(newId, { label: asset.title });
  return newId;
}

/** 本地智能抠像（主体消除已改为上游视频模型） */
export async function runLocalVideoFrameEdit(opts: {
  projectId: string;
  sourceNodeId: string;
  videoAssetId: string;
  mode: "smart_matting";
  queryClient: QueryClient;
}): Promise<boolean> {
  const meta = VIDEO_FRAME_EDIT_TOOLS[opts.mode];
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!node) {
    toast.error("视频节点不存在");
    return false;
  }

  // 主模型名用于模型专用算力匹配；计费按 (输入秒+输出秒)×每秒算力
  const modelName = await resolveToolModel(meta.canvasTool, "rh_seedance_20_r2v");
  const adminPrompt = await loadFrameEditAdminPrompt(meta.canvasTool);
  const billSec = resolveCanvasVideoBillSeconds(node);
  const billingOptions = canvasVideoToolBillingOptions(billSec);
  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: modelName,
      category: "video",
      canvasTool: meta.canvasTool,
      generationOptions: billingOptions,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* 仍尝试扣费 */
  }

  toast.message("正在本地按帧抠像（非图生图），请稍候…");

  try {
    const consume = await consumeLocalCanvasTool({
      projectId: opts.projectId,
      nodeId: opts.sourceNodeId,
      workflowId: store.workflowId ?? undefined,
      model: modelName,
      canvasTool: meta.canvasTool,
      quoteToken,
      submitSource: "manual",
      durationSec: billSec,
      inputVideoSeconds: billSec,
      outputVideoSeconds: billSec,
    });
    maybeToastCreditCharged(consume, true);

    const content = await apiFetch<{
      asset: Record<string, unknown>;
      mode: string;
    }>("/api/v1/assets/video-frame-edit", {
      method: "POST",
      body: JSON.stringify({
        projectId: opts.projectId,
        videoAssetId: opts.videoAssetId,
        mode: opts.mode,
        title: meta.label,
      }),
    });

    const asset = normalizeAsset(content.asset ?? {});
    if (!asset.id || !asset.fileUrl) throw new Error("画面编辑未返回有效素材");

    const newId = placeResultNode(node, store.edges, asset, {
      mode: opts.mode,
      sourceAssetId: opts.videoAssetId,
    });
    if (newId && adminPrompt) {
      // 后台 Prompt 模板文案写入结果节点，便于追溯
      useCanvasStore.getState().updateNodeParam(newId, "prompt", adminPrompt);
    }
    notifyAssetsUpdated();
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
    toast.success("智能抠像完成（主体已抠出并铺深色底，便于预览）");
    return true;
  } catch (err) {
    if (handleCollaboratorSpendCapError(err)) return false;
    if (isPricingChangedError(err)) {
      toastPricingChanged();
      return false;
    }
    toast.error(err instanceof Error ? err.message : `${meta.label}失败`);
    return false;
  }
}

/** 主体消除 / 修改 / 替换：走上游视频模型（后台可切换） */
export async function runUpstreamVideoFrameEdit(opts: {
  projectId: string;
  sourceNodeId: string;
  videoAssetId: string;
  videoUrl: string;
  mode: "subject_remove" | "subject_edit" | "subject_replace";
  prompt: string;
  refImageUrl?: string;
  modelName: string;
  generationOptions: GenerationOptions;
  queryClient: QueryClient;
}): Promise<VideoFrameEditRunResult> {
  const meta = VIDEO_FRAME_EDIT_TOOLS[opts.mode];
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!node) {
    toast.error("视频节点不存在");
    return { ok: false, error: "视频节点不存在" };
  }

  const userPrompt = opts.prompt.trim();
  if (!userPrompt) {
    const error =
      opts.mode === "subject_remove" ? "请先在视频节点填写提示词" : "请填写修改说明";
    toast.error(error);
    return { ok: false, error };
  }
  if (opts.mode === "subject_replace" && !String(opts.refImageUrl || "").trim()) {
    const error = "主体替换需要参考图：请将图片节点连到本视频左侧「参考」口，或传入 params.refImageNodeId";
    toast.error(error);
    return { ok: false, error };
  }

  const modelName = await resolveToolModel(meta.canvasTool, opts.modelName);
  const adminSuffix = await loadFrameEditAdminPrompt(meta.canvasTool);
  // 用户说明放最前，确保按用户意图提交上游
  const finalPrompt = buildUpstreamFrameEditPrompt(userPrompt, adminSuffix);
  const billSec = resolveCanvasVideoBillSeconds(node);
  const generationOptions = {
    ...opts.generationOptions,
    ...canvasVideoToolBillingOptions(billSec),
  };

  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: modelName,
      category: "video",
      canvasTool: meta.canvasTool,
      generationOptions,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* ignore */
  }

  // 先建空结果节点占位（勿预填源片，避免误以为「已生成原片」）
  const before = new Set(store.nodes.map((n) => n.id));
  store.addNode("video_input", {
    x: (node.position?.x ?? 0) + (node.width ?? 320) + 48,
    y: node.position?.y ?? 0,
  });
  const after = useCanvasStore.getState();
  const newId =
    after.nodes.find((n) => n.type === "video_input" && !before.has(n.id))?.id ?? null;
  if (!newId) {
    toast.error("创建结果节点失败");
    return { ok: false, error: "创建结果节点失败" };
  }
  after.connectNodes({
    source: opts.sourceNodeId,
    target: newId,
    sourceHandle: "video",
    targetHandle: REFERENCE_INPUT_ID,
  });
  after.updateNodeData(newId, { label: meta.label });
  after.updateNodeParam(newId, "toolMode", "video_frame_edit");
  after.updateNodeParam(newId, "frameEditMeta", {
    mode: opts.mode,
    sourceAssetId: opts.videoAssetId,
  });
  after.updateNodeParam(newId, "prompt", finalPrompt);
  after.updateNodeParam(newId, "model", modelName);
  after.setNodeStatus(newId, "running");

  try {
    const references: Array<{
      nodeId: string;
      type: "video" | "image";
      label: string;
      url: string;
    }> = [
      {
        nodeId: opts.sourceNodeId,
        type: "video",
        label: "源视频",
        url: opts.videoUrl,
      },
    ];
    if (opts.mode === "subject_replace" && opts.refImageUrl) {
      references.push({
        nodeId: `${opts.sourceNodeId}-ref`,
        type: "image",
        label: "替换主体",
        url: opts.refImageUrl,
      });
    }

    const live = useCanvasStore.getState();
    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: newId,
        workflowId: live.workflowId ?? undefined,
        model: modelName,
        category: "video",
        prompt: finalPrompt,
        generationOptions,
        canvasTool: meta.canvasTool,
        references,
        sourceUrl: opts.videoUrl,
        sourceAssetId: opts.videoAssetId,
        submitSource: "manual",
        assetTitle: meta.label,
      },
      {
        quoteToken,
        idempotencyKey: newIdempotencyKey(`${newId}-${opts.mode}`),
      }
    );

    const resolved = await resolveMediaGenerationAssetId(result);
    if (resolved.errorMessage) throw new Error(resolved.errorMessage);
    const assetId = resolved.assetId?.trim();
    if (!assetId) throw new Error("生成未返回素材");
    const { fetchAssetById } = await import("@/lib/api/assets");
    const asset = await fetchAssetById(opts.projectId, assetId);
    if (!asset?.fileUrl) throw new Error("结果素材无效");

    const done = useCanvasStore.getState();
    done.updateNodeParam(newId, "assetId", asset.id);
    done.updateNodeParam(newId, "videoUrl", ensureHttpsOssUrl(asset.fileUrl));
    done.updateNodeData(newId, { label: meta.label });
    done.setNodeStatus(newId, "success");
    maybeToastCreditCharged(result, true);
    notifyAssetsUpdated();
    void invalidateCanvasCreditQueries(opts.queryClient, opts.projectId);
    toast.success(`${meta.label}完成`);
    return { ok: true };
  } catch (err) {
    useCanvasStore.getState().setNodeStatus(newId, "error");
    const errMsg = err instanceof Error ? err.message : `${meta.label}失败`;
    useCanvasStore.getState().updateNodeParam(newId, "lastError", errMsg.slice(0, 500));
    if (handleCollaboratorSpendCapError(err)) {
      return { ok: false, error: errMsg };
    }
    if (isPricingChangedError(err)) {
      toastPricingChanged();
      return { ok: false, error: "定价已变更，请确认后重试" };
    }
    toast.error(errMsg);
    return { ok: false, error: errMsg };
  }
}

/** 读取节点 params（供调用方） */
export function readNodeParams(nodeId: string): Record<string, unknown> {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  return ((node?.data as WorkflowNodeData | undefined)?.params ?? {}) as Record<
    string,
    unknown
  >;
}
