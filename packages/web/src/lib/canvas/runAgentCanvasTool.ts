/**
 * Agent `runCanvasTools` 执行器：分镜流水线 + 本批图片菜单工具（轨 G 真扣费）。
 */

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getCreditQuote } from "@/lib/api/credits";
import { fetchNodeText } from "@/lib/api/nodeText";
import { getPromptConfig, getPromptToolConfig } from "@/lib/api/promptConfig";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import { CANVAS_TOOL_I2I_MODEL } from "@/lib/canvas/canvasToolImageModel";
import { createHdUpscaleNode } from "@/lib/canvas/createHdUpscaleNode";
import { isCreativeGridChildTool } from "@/lib/canvas/imageCreativeToolsCatalog";
import { parseStoryboardSubjectsContent, mergeSubjectsPreservingIds } from "@/lib/canvas/parseStoryboardSubjects";
import { parseStoryboardTableContent, mergeTableRowsPreservingIds } from "@/lib/canvas/parseStoryboardTable";
import {
  buildCreativeToolSubmitPrompt,
  CREATIVE_TOOLS_CANVAS_TOOL,
  runCreativeToolDirectGenerate,
} from "@/lib/canvas/runCreativeToolDirectGenerate";
import { runCutoutGenerate } from "@/lib/canvas/runCutoutGenerate";
import { runGridSplitOnNode } from "@/lib/canvas/runGridSplit";
import { runHdUpscaleGenerate } from "@/lib/canvas/runHdUpscaleGenerate";
import { runLightingGenerate } from "@/lib/canvas/runLightingGenerate";
import { runMultiAngleGenerate } from "@/lib/canvas/runMultiAngleGenerate";
import {
  runPortraitAdjustGenerate,
  type PortraitAdjustKind,
} from "@/lib/canvas/runPortraitAdjustGenerate";
import {
  runStoryboardSheetGenerate,
  type StoryboardSheetKind,
} from "@/lib/canvas/runStoryboardSheetGenerate";
import { resolveCreativeGridToolModel } from "@/lib/canvas/resolveCreativeGridToolModel";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import {
  applyVisualStyleToPrompt,
  findCreativeToolPrompt,
  type AppendPromptToolConfig,
  type CreativeToolsPromptToolConfig,
  type VisualStylesPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";
import { runStoryboardBatchVideos } from "@/lib/canvas/storyboardBatchVideos";
import {
  runStoryboardOneClickGeneration,
  runStoryboardSketchGeneration,
} from "@/lib/canvas/storyboardGridActions";
import { runImageStoryboardParseIntoGrid } from "@/lib/canvas/storyboardImageParse";
import { runStoryboardSubjectImageBatch } from "@/lib/canvas/storyboardSubjectImageBatch";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import { resolveStoryboardUpstream } from "@/lib/canvas/resolveUpstreamStoryboard";
import {
  runVideoStoryboardParse,
  runVideoStoryboardParseIntoGrid,
} from "@/lib/canvas/videoStoryboardParse";
import { runOverseasLocalizeForAgent } from "@/lib/canvas/overseasPipeline";
import { runOutpaintGenerate } from "@/lib/canvas/runOutpaintGenerate";
import {
  DEFAULT_INLINE_IMAGE_OUTPAINT,
  type OutpaintMargins,
} from "@/lib/canvas/imageOutpaint";
import {
  canvasVideoToolBillingOptions,
  resolveCanvasVideoBillSeconds,
} from "@/lib/canvas/canvasVideoToolBilling";
import {
  MAX_VIDEO_FRAME_EDIT_SEC,
  probeVideoDurationSec,
  resolveAgentSubjectReplaceImageUrl,
  runUpstreamVideoFrameEdit,
  runLocalVideoFrameEdit,
} from "@/lib/canvas/videoFrameEdit";
import { getVideoNodeRef } from "@/lib/canvas/videoNodeRegistry";
import { trimVideoAsset } from "@/lib/canvas/videoTrim";
import { runVideoSubtitleErase } from "@/lib/canvas/videoSubtitleErase";
import { runVideoVocalSeparate } from "@/lib/canvas/videoVocalSeparate";
import {
  canvasToolModelPrimary,
  getCanvasToolModels,
  resolveCanvasToolPrimaryModel,
} from "@/lib/api/canvasTools";
import { defaultGenerationOptions, getModelGenerationPresets } from "@/lib/canvas/generationPresets";
import { listModels } from "@/lib/api/models";
import type { GenerationOptions } from "@/types/generationPresets";
import type { ShotScale } from "@/lib/canvas/multiAnglePresets";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  STORYBOARD_SUBJECT_IMAGE_MODEL,
  STORYBOARD_SUBJECT_PROMPT_KIND,
  emptySubjectsBundle,
  parseSubjectsParam,
  type StoryboardSubjectsBundle,
} from "@/types/storyboard-subjects";
import {
  STORYBOARD_SKETCH_MODEL,
  STORYBOARD_TABLE_MODEL,
  STORYBOARD_TABLE_PROMPT_KIND,
  parseTableRowsParam,
} from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";

export type AgentCanvasToolOp = {
  tool: string;
  nodeId: string;
  scriptFromNodeId?: string;
  params?: Record<string, unknown>;
};

/** 前端执行上下文：QueryClient 等由会话面板注入 */
export type AgentCanvasToolCtx = {
  queryClient?: QueryClient;
  creditsEnabled?: boolean;
  workflowId?: string | null;
  /** 超长视频须剪辑时打开内联裁剪（主体消除等 ≤12s） */
  openInlineVideoTrim?: (nodeId: string, knownDurationSec?: number) => void;
};

function paramStr(params: Record<string, unknown> | undefined, key: string): string {
  const v = params?.[key];
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function paramNum(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = params?.[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 去掉准星/附件标记，得到可当提示词的用户原话 */
function intentPromptFromUserText(raw: string): string {
  return raw
    .replace(/\[(?:节点|附件):[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

/** 仅工具名、不能当修改说明的占位词 */
const BARE_FRAME_EDIT_PROMPTS = new Set([
  "主体修改",
  "主体替换",
  "主体消除",
  "修改主体",
  "替换主体",
  "消除主体",
]);

/** 助手调用画面编辑：params → 节点 prompt → 本轮用户原话 */
function resolveFrameEditUserPrompt(
  params: Record<string, unknown> | undefined,
  nodeParams: Record<string, unknown>
): string {
  const fromParams = intentPromptFromUserText(
    paramStr(params, "userPrompt") ||
      paramStr(params, "prompt") ||
      paramStr(params, "instruction") ||
      paramStr(params, "description")
  );
  const fromNode = intentPromptFromUserText(String(nodeParams.prompt ?? ""));
  const picked = fromParams || fromNode;
  if (picked && !BARE_FRAME_EDIT_PROMPTS.has(picked)) return picked;
  return "";
}

/** 优先画布已挂载 video 的真实时长，避免误用生成档位 duration */
function readKnownVideoDurationSec(
  nodeId: string,
  nodeParams: Record<string, unknown>
): number | null {
  const mounted = getVideoNodeRef(nodeId);
  const md = mounted?.duration;
  if (typeof md === "number" && Number.isFinite(md) && md > 0 && md < 600) return md;
  const raw = nodeParams.durationSec ?? nodeParams.duration_sec;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0 && n < 600) return n;
  return null;
}

function requireQueryClient(ctx?: AgentCanvasToolCtx): QueryClient | null {
  if (!ctx?.queryClient) {
    toast.error("画布工具执行失败：缺少 QueryClient");
    return null;
  }
  return ctx.queryClient;
}

async function resolveScriptContent(
  projectId: string,
  gridNodeId: string,
  scriptFromNodeId?: string
): Promise<{ text: string; sourceNodeId: string | null }> {
  if (scriptFromNodeId) {
    const rec = await fetchNodeText(projectId, scriptFromNodeId);
    const text = String(rec?.content || "").trim();
    if (text) return { text, sourceNodeId: scriptFromNodeId };
    const node = useCanvasStore.getState().nodes.find((n) => n.id === scriptFromNodeId);
    const fallback = String((node?.data as WorkflowNodeData | undefined)?.params?.content || "").trim();
    if (fallback) return { text: fallback, sourceNodeId: scriptFromNodeId };
  }
  const edges = useCanvasStore.getState().edges;
  const nodes = useCanvasStore.getState().nodes;
  for (const e of edges) {
    if (e.target !== gridNodeId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src || src.type !== "text_input") continue;
    const rec = await fetchNodeText(projectId, src.id);
    const text = String(rec?.content || "").trim();
    if (text) return { text, sourceNodeId: src.id };
    const fallback = String((src.data as WorkflowNodeData | undefined)?.params?.content || "").trim();
    if (fallback) return { text: fallback, sourceNodeId: src.id };
  }
  return { text: "", sourceNodeId: null };
}

function readGridParams(gridNodeId: string): Record<string, unknown> {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  return ((node?.data as WorkflowNodeData | undefined)?.params ?? {}) as Record<string, unknown>;
}

/** 从节点 id 列表解析图片参考（故事板等） */
async function resolveImageRefsFromNodeIds(
  projectId: string,
  nodeIds: unknown
): Promise<GenerationReference[]> {
  const ids = Array.isArray(nodeIds)
    ? nodeIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!ids.length) return [];
  const store = useCanvasStore.getState();
  const refs: GenerationReference[] = [];
  for (const id of ids) {
    const node = store.nodes.find((n) => n.id === id);
    if (!node) continue;
    const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
    const url = await resolveNodeMediaUrl(projectId, params, "imageUrl");
    if (!url) continue;
    refs.push({
      nodeId: id,
      type: "image",
      url,
      label: String(node.data?.label || "").trim() || undefined,
    });
  }
  return refs;
}

async function loadAppendPrompt(canvasTool: string): Promise<{ label: string; content: string }> {
  const fallback =
    PROMPT_SUFFIX_FALLBACKS[canvasTool as keyof typeof PROMPT_SUFFIX_FALLBACKS] ?? {
      label: canvasTool,
      content: "",
    };
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.[canvasTool] as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append") {
      return {
        label: tool.menuLabel?.trim() || fallback.label,
        content: tool.appendText?.trim() || fallback.content,
      };
    }
  } catch {
    /* 回退 */
  }
  return { label: fallback.label, content: fallback.content };
}

/** 执行单个 Agent 画布工具；成功时 ok=true，创作图工具可带回结果节点 id */
export type AgentCanvasToolResult = {
  ok: boolean;
  /** 新生成的结果节点（故事板/抠图/创作工具等） */
  resultNodeIds?: string[];
  /** 失败原因（给聊天旁白，避免只显示笼统文案） */
  error?: string;
};

function okResult(resultNodeIds?: string[]): AgentCanvasToolResult {
  return resultNodeIds?.length ? { ok: true, resultNodeIds } : { ok: true };
}

function failResult(error?: string): AgentCanvasToolResult {
  return error ? { ok: false, error } : { ok: false };
}

/** 执行单个 Agent 画布工具 */
export async function runAgentCanvasTool(
  projectId: string,
  op: AgentCanvasToolOp,
  ctx?: AgentCanvasToolCtx
): Promise<AgentCanvasToolResult> {
  const tool = (op.tool || "").trim();
  const nodeId = (op.nodeId || "").trim();
  if (!tool || !nodeId || !projectId) return failResult("缺少 tool / nodeId / projectId");

  const params = (op.params ?? {}) as Record<string, unknown>;
  const store = useCanvasStore.getState();
  const workflowId = ctx?.workflowId ?? store.workflowId;
  const creditsEnabled = ctx?.creditsEnabled !== false;

  // —— 分镜表：文本解析行 ——
  if (tool === "storyboard_table") {
    const { text, sourceNodeId } = await resolveScriptContent(
      projectId,
      nodeId,
      op.scriptFromNodeId
    );
    if (!text) {
      toast.error("分镜解析失败：找不到剧本文本");
      return failResult("分镜解析失败：找不到剧本文本");
    }
    let quoteToken: string | undefined;
    try {
      const q = await getCreditQuote({
        model: STORYBOARD_TABLE_MODEL,
        category: "text",
        canvasTool: "storyboard_table",
      });
      quoteToken = q.quoteToken;
    } catch {
      /* 无 quote 仍尝试提交 */
    }
    const tableResult = await runStoryboardTextJob({
      projectId,
      nodeId: `${nodeId}::agent-parse-table`,
      content: text,
      model: STORYBOARD_TABLE_MODEL,
      textPromptKind: STORYBOARD_TABLE_PROMPT_KIND,
      canvasTool: "storyboard_table",
      quoteToken,
      idempotencySuffix: "agent-parse-table",
    });
    const parsed = parseStoryboardTableContent(tableResult.text);
    if (!parsed.rows.length) {
      toast.error(parsed.warnings[0] ?? "分镜表解析失败");
      return failResult(parsed.warnings[0] ?? "分镜表解析失败");
    }
    const prev = parseTableRowsParam(readGridParams(nodeId).shots);
    const merged = mergeTableRowsPreservingIds(prev, parsed.rows);
    useCanvasStore.getState().updateNodeParam(nodeId, "shots", merged);
    if (sourceNodeId) {
      useCanvasStore.getState().updateNodeParam(nodeId, "sourceTextNodeId", sourceNodeId);
    }
    useCanvasStore.getState().scheduleAutoSave();
    toast.success(`Agent 已解析 ${merged.length} 行分镜`);
    return okResult();
  }

  // —— 出海本地化：改写已有分镜，或空表时从参考视频拉片 ——
  if (tool === "storyboard_overseas_localize") {
    const grid = store.nodes.find((n) => n.id === nodeId);
    if (!grid || grid.type !== "storyboard_grid") {
      toast.error("请选择分镜表节点");
      return failResult("请选择分镜表节点");
    }
    const marketId =
      paramStr(params, "targetMarketId") ||
      paramStr(params, "marketId") ||
      String(
        (
          ((grid.data as WorkflowNodeData | undefined)?.params ?? {})
            .viralRemakeMeta as Record<string, unknown> | undefined
        )?.targetMarketId || ""
      ).trim();
    if (!marketId) {
      toast.error("出海本地化需要 params.targetMarketId（如 US / JP / KR）");
      return failResult("缺少目标市场 targetMarketId");
    }
    try {
      const upstream = await resolveStoryboardUpstream(
        projectId,
        nodeId,
        store.edges,
        store.nodes
      );
      const video = upstream.videos[0];
      const result = await runOverseasLocalizeForAgent({
        projectId,
        gridNodeId: nodeId,
        targetMarketId: marketId,
        localeNotes:
          paramStr(params, "localeNotes") ||
          paramStr(params, "notes") ||
          paramStr(params, "prompt"),
        aspectRatio: paramStr(params, "aspectRatio"),
        clarity: paramStr(params, "clarity"),
        video: video
          ? {
              nodeId: video.nodeId,
              assetId: video.assetId,
              fileUrl: video.fileUrl,
              title: video.label,
            }
          : undefined,
      });
      toast.success(
        `出海本地化完成：${result.shotCount} 镜 · ${result.marketLabel}`
      );
      return okResult();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "出海本地化失败";
      toast.error(msg);
      return failResult(msg);
    }
  }

  // —— 主体提取 ——
  if (tool === "text_subject") {
    const { text } = await resolveScriptContent(projectId, nodeId, op.scriptFromNodeId);
    if (!text) {
      toast.error("主体提取失败：找不到剧本文本");
      return failResult("主体提取失败：找不到剧本文本");
    }
    let quoteToken: string | undefined;
    try {
      const q = await getCreditQuote({
        model: STORYBOARD_TABLE_MODEL,
        category: "text",
        canvasTool: "text_subject",
      });
      quoteToken = q.quoteToken;
    } catch {
      /* optional */
    }
    const subjectResult = await runStoryboardTextJob({
      projectId,
      nodeId: `${nodeId}::agent-parse-subjects`,
      content: text,
      model: STORYBOARD_TABLE_MODEL,
      textPromptKind: STORYBOARD_SUBJECT_PROMPT_KIND,
      canvasTool: "text_subject",
      quoteToken,
      idempotencySuffix: "agent-parse-subjects",
    });
    const subjectParsed = parseStoryboardSubjectsContent(subjectResult.text);
    const prevRaw = readGridParams(nodeId).subjects;
    const prev = prevRaw ? parseSubjectsParam(prevRaw) : emptySubjectsBundle();
    const merged = mergeSubjectsPreservingIds(prev, subjectParsed.subjects);
    useCanvasStore.getState().updateNodeParam(nodeId, "subjects", merged);
    useCanvasStore.getState().scheduleAutoSave();
    toast.success("Agent 已提取分镜主体");
    return okResult();
  }

  // —— 主体生图 ——
  if (tool === "storyboard_subject_image") {
    const subjects = parseSubjectsParam(readGridParams(nodeId).subjects) as StoryboardSubjectsBundle;
    const subjectModel = await resolveCanvasToolPrimaryModel(
      "storyboard_subject_image",
      STORYBOARD_SUBJECT_IMAGE_MODEL
    );
    await runStoryboardSubjectImageBatch({
      projectId,
      gridNodeId: nodeId,
      subjects,
      model: subjectModel,
      onItemStart: () => {},
      onItemDone: (id, assetId, kind) => {
        const cur = parseSubjectsParam(readGridParams(nodeId).subjects) as StoryboardSubjectsBundle;
        const listKey = kind === "role" ? "roles" : kind === "scene" ? "scenes" : "props";
        const next = {
          ...cur,
          [listKey]: (cur[listKey] || []).map((it) =>
            it.id === id
              ? { ...it, imageAssetId: assetId, imageStatus: "succeeded" as const, imageError: undefined }
              : it
          ),
        };
        useCanvasStore.getState().updateNodeParam(nodeId, "subjects", next);
      },
      onItemFail: (id, message) => {
        const cur = parseSubjectsParam(readGridParams(nodeId).subjects) as StoryboardSubjectsBundle;
        for (const listKey of ["roles", "scenes", "props"] as const) {
          if (!(cur[listKey] || []).some((it) => it.id === id)) continue;
          const next = {
            ...cur,
            [listKey]: cur[listKey].map((it) =>
              it.id === id ? { ...it, imageStatus: "failed" as const, imageError: message } : it
            ),
          };
          useCanvasStore.getState().updateNodeParam(nodeId, "subjects", next);
        }
      },
    });
    useCanvasStore.getState().scheduleAutoSave();
    toast.success("Agent 主体生图完成");
    return okResult();
  }

  // —— 运镜 / 视频提示词 ——
  if (tool === "storyboard_camera" || tool === "storyboard_video") {
    await runStoryboardOneClickGeneration({
      gridNodeId: nodeId,
      onlyEmpty: true,
    });
    useCanvasStore.getState().scheduleAutoSave();
    toast.success(tool === "storyboard_camera" ? "Agent 已补全运镜提示词" : "Agent 已补全视频提示词");
    return okResult();
  }

  // —— 批量出视频 ——
  if (tool === "storyboard_batch_videos") {
    const ids = await runStoryboardBatchVideos({
      projectId,
      gridNodeId: nodeId,
      fillPromptsIfNeeded: true,
    });
    toast.success(`Agent 已批量创建/生成 ${ids.length} 个视频节点`);
    return okResult();
  }

  // —— 以下图片菜单工具需要 QueryClient ——
  const queryClient = requireQueryClient(ctx);
  if (!queryClient) return failResult("缺少 QueryClient");

  const sourceNode = store.nodes.find((n) => n.id === nodeId);
  if (!sourceNode) {
    toast.error("源节点不存在");
    return failResult("源节点不存在");
  }

  // —— 故事板 / 调度故事板 ——
  if (tool === "storyboard" || tool === "blocking_storyboard") {
    const userPrompt =
      paramStr(params, "userPrompt") ||
      paramStr(params, "prompt") ||
      String(((sourceNode.data as WorkflowNodeData | undefined)?.params ?? {}).prompt ?? "").trim();
    if (!userPrompt) {
      toast.error("故事板需要 params.userPrompt（剧情描述）");
      return failResult("故事板需要剧情描述");
    }
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel(tool);
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.error("无法读取故事板模型配置");
      return failResult("无法读取故事板模型配置");
    }
    const references = await resolveImageRefsFromNodeIds(projectId, params.referenceNodeIds);
    let lastError = "";
    const resultId = await runStoryboardSheetGenerate({
      kind: tool as StoryboardSheetKind,
      projectId,
      sourceNodeId: nodeId,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      userPrompt,
      references,
      onError: (message) => {
        lastError = message;
      },
    });
    return resultId ? okResult([resultId]) : failResult(lastError || "故事板未能生成");
  }

  // —— 多角度 ——
  if (tool === "multi_angle") {
    const shotRaw = paramStr(params, "shot");
    const shot = (["close", "medium", "wide"].includes(shotRaw)
      ? shotRaw
      : "medium") as ShotScale;
    const angleOk = await runMultiAngleGenerate({
      projectId,
      sourceNodeId: nodeId,
      workflowId,
      creditsEnabled,
      queryClient,
      azimuth: paramNum(params, "azimuth", 0),
      elevation: paramNum(params, "elevation", 0),
      shot,
      extraPrompt: paramStr(params, "extraPrompt"),
    });
    return angleOk ? okResult() : failResult("多角度执行失败");
  }

  // —— 打光 ——
  if (tool === "lighting") {
    const lightingOptions: Record<string, unknown> = {};
    if (params.direction != null) lightingOptions.direction = params.direction;
    if (params.brightness != null) lightingOptions.brightness = params.brightness;
    if (params.color != null) lightingOptions.color = params.color;
    if (params.rimLight != null) lightingOptions.rimLight = Boolean(params.rimLight);
    if (params.smartMode != null) lightingOptions.smartMode = Boolean(params.smartMode);
    if (params.lightingOptions && typeof params.lightingOptions === "object") {
      Object.assign(lightingOptions, params.lightingOptions as Record<string, unknown>);
    }
    const lightOk = await runLightingGenerate({
      projectId,
      sourceNodeId: nodeId,
      workflowId,
      creditsEnabled,
      queryClient,
      lightingOptions,
      extraPrompt: paramStr(params, "extraPrompt"),
      persistOptions: true,
    });
    return lightOk ? okResult() : failResult("打光执行失败");
  }

  // —— 抠图 ——
  if (tool === "cutout") {
    if (sourceNode.type !== "image_input") {
      toast.error("抠图仅支持图片节点");
      return failResult("抠图仅支持图片节点");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const sourceUrl = await resolveNodeMediaUrl(projectId, nodeParams, "imageUrl");
    if (!sourceUrl) {
      toast.error("请先上传参考图片");
      return failResult("请先上传参考图片");
    }
    const cutOk = await runCutoutGenerate({
      projectId,
      sourceNodeId: nodeId,
      sourceUrl,
      workflowId,
      creditsEnabled,
      queryClient,
      fallbackModelName: CANVAS_TOOL_I2I_MODEL,
    });
    return cutOk ? okResult() : failResult("抠图执行失败");
  }

  // —— 宫格切分 ——
  if (tool === "grid_split") {
    const rows = Math.max(1, Math.min(8, Math.floor(paramNum(params, "rows", 3))));
    const cols = Math.max(1, Math.min(8, Math.floor(paramNum(params, "cols", 3))));
    let modelName = CANVAS_TOOL_I2I_MODEL;
    try {
      const resolved = await resolveCreativeGridToolModel("grid_split");
      if (resolved.modelName) modelName = resolved.modelName;
    } catch {
      /* 用默认 */
    }
    const splitOk = await runGridSplitOnNode({
      projectId,
      nodeId,
      workflowId,
      modelName,
      rows,
      cols,
      creditsEnabled,
      queryClient,
    });
    return splitOk ? okResult() : failResult("宫格切分失败");
  }

  // —— 人像 / 情绪调节 ——
  if (tool === "portrait_adjust" || tool === "emotion_adjust") {
    const kind: PortraitAdjustKind = tool === "emotion_adjust" ? "emotion" : "portrait";
    const userPrompt =
      paramStr(params, "userPrompt") ||
      paramStr(params, "prompt") ||
      String(((sourceNode.data as WorkflowNodeData | undefined)?.params ?? {}).prompt ?? "").trim();
    if (!userPrompt) {
      toast.error(`${kind === "emotion" ? "情绪" : "人像"}调节需要 params.userPrompt`);
      return failResult(`${kind === "emotion" ? "情绪" : "人像"}调节需要 params.userPrompt`);
    }
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel(tool);
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.error("无法读取人像工具模型配置");
      return failResult("无法读取人像工具模型配置");
    }
    const portraitOk = await runPortraitAdjustGenerate({
      kind,
      projectId,
      sourceNodeId: nodeId,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      userPrompt,
    });
    return portraitOk ? okResult() : failResult("人像/情绪调节失败");
  }

  // —— 高清放大（图 / 视频） ——
  if (tool === "hd_upscale" || tool === "hd_upscale_video") {
    const wantVideo = tool === "hd_upscale_video";
    if (wantVideo && sourceNode.type !== "video_input") {
      toast.error("视频高清请选择视频节点");
      return failResult("视频高清请选择视频节点");
    }
    if (!wantVideo && sourceNode.type !== "image_input") {
      toast.error("图片高清请选择图片节点");
      return failResult("图片高清请选择图片节点");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const urlKey = wantVideo ? "videoUrl" : "imageUrl";
    const sourceUrl = await resolveNodeMediaUrl(projectId, nodeParams, urlKey);
    const assetId = String(nodeParams.assetId || "").trim();
    const hdNodeId = createHdUpscaleNode({
      sourceNodeId: nodeId,
      sourcePosition: sourceNode.position,
      sourceWidth: sourceNode.width,
      sourceHeight: sourceNode.height,
      sourceAsset:
        assetId && sourceUrl
          ? { id: assetId, fileUrl: sourceUrl, title: String(sourceNode.data?.label || "") }
          : undefined,
      edges: store.edges,
      mediaKind: wantVideo ? "video" : "image",
    });
    if (!hdNodeId) {
      toast.error("创建高清节点失败");
      return failResult("创建高清节点失败");
    }
    const hdModel = paramStr(params, "hdModel") || "general";
    const hdScale = paramNum(params, "hdScale", 2);
    let modelName = "";
    let generationOptions;
    try {
      if (wantVideo) {
        const data = await getCanvasToolModels();
        modelName =
          canvasToolModelPrimary(data.tools, "hd_upscale_video") ||
          canvasToolModelPrimary(data.tools, "hd_upscale") ||
          "rh_seedance_20_r2v";
        generationOptions = {};
      } else {
        const resolved = await resolveCreativeGridToolModel("hd_upscale");
        modelName = resolved.modelName;
        generationOptions = resolved.generationOptions;
      }
    } catch {
      toast.error("无法读取高清模型配置");
      return failResult("无法读取高清模型配置");
    }
    useCanvasStore.getState().updateNodeParam(hdNodeId, "hdModel", hdModel);
    useCanvasStore.getState().updateNodeParam(hdNodeId, "hdScale", hdScale);
    const hdOk = await runHdUpscaleGenerate({
      projectId,
      nodeId: hdNodeId,
      hdModel,
      hdScale,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      mediaKind: wantVideo ? "video" : "image",
    });
    return hdOk ? okResult([hdNodeId]) : failResult("高清放大失败");
  }

  // —— 分镜草图 ——
  if (tool === "storyboard_sketch") {
    if (sourceNode.type !== "storyboard_grid") {
      toast.error("分镜草图请选择分镜表节点");
      return failResult("分镜草图请选择分镜表节点");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const sketchModel =
      paramStr(params, "sketchModel") ||
      String(nodeParams.sketchModel || "").trim() ||
      STORYBOARD_SKETCH_MODEL;
    const ok = await runStoryboardSketchGeneration({
      gridNodeId: nodeId,
      sketchModel,
      queryClient,
    });
    return ok ? okResult() : failResult("分镜草图失败");
  }

  // —— 图/视频解析写入分镜表（视频节点上调用则与顶栏「解析」一致，自动建表） ——
  if (tool === "storyboard_from_image" || tool === "storyboard_from_video") {
    if (tool === "storyboard_from_video" && sourceNode.type === "video_input") {
      const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
        {}) as Record<string, unknown>;
      const assetId = String(nodeParams.assetId || "").trim();
      const videoFileUrl = await resolveNodeMediaUrl(projectId, nodeParams, "videoUrl");
      if (!assetId || !videoFileUrl) {
        toast.error("请先上传视频");
        return failResult("请先上传视频");
      }
      try {
        const result = await runVideoStoryboardParse({
          projectId,
          videoNodeId: nodeId,
          videoAssetId: assetId,
          videoFileUrl,
          sourcePosition: sourceNode.position,
          sourceWidth: sourceNode.width,
          sourceHeight: sourceNode.height,
          edges: store.edges,
          videoParams: nodeParams,
        });
        toast.success(`已从视频解析 ${result.shotCount} 行分镜`);
        return okResult([result.gridNodeId]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "视频解析失败";
        toast.error(msg);
        return failResult(msg);
      }
    }
    if (sourceNode.type !== "storyboard_grid") {
      toast.error("请选择分镜表节点（上游须已连接参考图/视频），或对视频节点直接调用 storyboard_from_video");
      return failResult("请选择分镜表节点，或对视频节点直接调用 storyboard_from_video");
    }
    try {
      const upstream = await resolveStoryboardUpstream(
        projectId,
        nodeId,
        store.edges,
        store.nodes
      );
      if (tool === "storyboard_from_video") {
        if (upstream.kind !== "video" || !upstream.videos[0]) {
          toast.error("请先将参考视频连接到分镜表 ref_in");
          return failResult("请先将参考视频连接到分镜表 ref_in");
        }
        const video = upstream.videos[0];
        const videoNode = store.nodes.find((n) => n.id === video.nodeId);
        const videoParams =
          ((videoNode?.data as WorkflowNodeData | undefined)?.params ??
            {}) as Record<string, unknown>;
        let videoFileUrl = video.fileUrl;
        try {
          videoFileUrl =
            (await resolveNodeMediaUrl(projectId, videoParams, "videoUrl")) ||
            videoFileUrl;
        } catch {
          /* 用节点内 URL */
        }
        const result = await runVideoStoryboardParseIntoGrid({
          projectId,
          gridNodeId: nodeId,
          videoNodeId: video.nodeId,
          videoAssetId: video.assetId,
          videoFileUrl,
          videoParams,
          toastSuccess: false,
        });
        toast.success(`已从视频解析 ${result.shotCount} 行分镜`);
        return okResult([result.gridNodeId]);
      }
      if (upstream.kind !== "image" || !upstream.images.length) {
        toast.error("请先将参考图连接到分镜表 ref_in");
        return failResult("请先将参考图连接到分镜表 ref_in");
      }
      const result = await runImageStoryboardParseIntoGrid({
        projectId,
        gridNodeId: nodeId,
        images: upstream.images,
      });
      toast.success(`已从图片解析 ${result.shotCount} 行分镜`);
      return okResult();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "分镜解析失败";
      toast.error(msg);
      return failResult(msg);
    }
  }

  // —— 人声分离 / 消除：视频或音频节点 ——
  if (tool === "vocal_separate" || tool === "vocal_remove") {
    if (sourceNode.type !== "video_input" && sourceNode.type !== "audio_input") {
      toast.error("请选择视频或音频节点");
      return failResult("请选择视频或音频节点");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const assetId = String(nodeParams.assetId || "").trim();
    if (!assetId) {
      toast.error("当前节点缺少素材 ID，请重新上传后再试");
      return failResult("缺少素材 ID");
    }
    const mediaKey = sourceNode.type === "audio_input" ? "audioUrl" : "videoUrl";
    const mediaUrl = await resolveNodeMediaUrl(projectId, nodeParams, mediaKey);
    if (!mediaUrl) {
      toast.error(sourceNode.type === "audio_input" ? "请先上传音频" : "请先上传视频");
      return failResult("缺少媒体");
    }
    const ok = await runVideoVocalSeparate({
      projectId,
      sourceNodeId: nodeId,
      videoAssetId: assetId,
      videoUrl: mediaUrl,
      mode: tool === "vocal_remove" ? "other" : "vocals",
      queryClient,
    });
    return ok ? okResult() : failResult(tool === "vocal_remove" ? "消除人声失败" : "人声分离失败");
  }

  // —— 视频：智能擦字幕 / 智能抠像 / 主体消除 / 主体修改 / 主体替换 ——
  if (
    tool === "video_subtitle_smart_erase" ||
    tool === "video_subtitle_box_erase" ||
    tool === "video_smart_matting" ||
    tool === "video_subject_remove" ||
    tool === "video_subject_edit" ||
    tool === "video_subject_replace"
  ) {
    if (sourceNode.type !== "video_input") {
      toast.error("请选择视频节点");
      return failResult("请选择视频节点");
    }
    if (!queryClient) {
      toast.error("缺少 QueryClient，无法执行视频工具");
      return failResult("缺少 QueryClient，无法执行视频工具");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const assetId = String(nodeParams.assetId || "").trim();
    if (!assetId) {
      toast.error("当前视频缺少素材 ID，请重新上传后再试");
      return failResult("当前视频缺少素材 ID");
    }
    const videoUrl = await resolveNodeMediaUrl(projectId, nodeParams, "videoUrl");
    if (!videoUrl && tool !== "video_smart_matting") {
      toast.error("请先上传视频");
      return failResult("请先上传视频");
    }
    try {
      if (tool === "video_subtitle_smart_erase" || tool === "video_subtitle_box_erase") {
        if (tool === "video_subtitle_box_erase") {
          return failResult("框选擦除需要在节点上划框，请用户在顶栏「智能去字幕·框选擦除」操作；智能擦除可用 video_subtitle_smart_erase");
        }
        const ok = await runVideoSubtitleErase({
          projectId,
          sourceNodeId: nodeId,
          videoAssetId: assetId,
          videoUrl: videoUrl || "",
          mode: "smart",
          queryClient,
        });
        return ok ? okResult() : failResult("智能去字幕失败");
      }
      if (
        tool === "video_subject_remove" ||
        tool === "video_subject_edit" ||
        tool === "video_subject_replace"
      ) {
        const userPrompt = resolveFrameEditUserPrompt(params, nodeParams);
        if (!userPrompt) {
          const error = "该视频工具需要修改说明：请在 params.userPrompt 写清改成什么样（例如把西装男改成动漫角色）";
          toast.error(error);
          return failResult(error);
        }
        if (!videoUrl) {
          toast.error("请先上传视频");
          return failResult("请先上传视频");
        }

        let refImageUrl: string | undefined;
        if (tool === "video_subject_replace") {
          const found = await resolveAgentSubjectReplaceImageUrl(projectId, nodeId, params);
          if (!found) {
            const error =
              "主体替换需要参考图：请先把图片节点连到本视频左侧「参考」口，或传入 params.refImageNodeId，或在对话上传参考图";
            toast.error(error);
            return failResult(error);
          }
          refImageUrl = found;
        }

        // 真实片长：挂载 video → durationSec → 探测 URL
        let knownDur = readKnownVideoDurationSec(nodeId, nodeParams);
        if (knownDur == null) {
          knownDur = await probeVideoDurationSec(videoUrl);
        }
        let editAssetId = assetId;
        let editVideoUrl = videoUrl;
        if (knownDur != null && knownDur > MAX_VIDEO_FRAME_EDIT_SEC + 0.05) {
          const inSec = Math.max(0, paramNum(params, "inSec", 0));
          const wantOut = paramNum(params, "outSec", inSec + MAX_VIDEO_FRAME_EDIT_SEC);
          const outSec = Math.min(
            knownDur,
            Math.max(inSec + 1, Math.min(wantOut, inSec + MAX_VIDEO_FRAME_EDIT_SEC))
          );
          try {
            toast.message(
              `源片约 ${knownDur.toFixed(1)} 秒，画面编辑仅支持 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒，已自动截取 ${inSec.toFixed(0)}–${outSec.toFixed(0)} 秒`
            );
            const trimmed = await trimVideoAsset({
              projectId,
              videoAssetId: assetId,
              inSec,
              outSec,
              title: "画面编辑·截取",
            });
            editAssetId = trimmed.asset.id;
            editVideoUrl = trimmed.asset.fileUrl;
            knownDur = trimmed.durationSec || outSec - inSec;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "自动剪辑失败";
            const error = `画面编辑仅支持 ≤${MAX_VIDEO_FRAME_EDIT_SEC} 秒，当前约 ${knownDur.toFixed(1)} 秒。自动截取失败：${msg}。请先在节点顶栏点「剪辑」。`;
            toast.error(error);
            return failResult(error);
          }
        }

        // 与人手顶栏一致：读后台主模型（兼容驼峰 key），缺省回退 Seedance R2V
        const modelName = await resolveCanvasToolPrimaryModel(
          tool,
          "rh_seedance_20_r2v"
        );
        if (!modelName) {
          toast.error("后台未配置该视频工具模型，请联系管理员");
          return failResult("后台未配置该视频工具模型，请联系管理员");
        }
        let generationOptions: GenerationOptions = {
          ...defaultGenerationOptions(null),
          realPerson: "on",
        };
        try {
          const catalog = await listModels({ category: "video" });
          const selected = catalog.find((m) => m.name === modelName);
          const presets = getModelGenerationPresets(selected);
          generationOptions = {
            ...defaultGenerationOptions(presets),
            realPerson: "on",
          };
        } catch {
          /* 用默认档兜底 */
        }
        const billSec = resolveCanvasVideoBillSeconds(sourceNode);
        const durationSec =
          typeof knownDur === "number" && knownDur > 0
            ? Math.max(4, Math.min(MAX_VIDEO_FRAME_EDIT_SEC, Math.ceil(knownDur)))
            : billSec;
        generationOptions = {
          ...generationOptions,
          ...canvasVideoToolBillingOptions(durationSec),
          duration: String(durationSec),
          realPerson: "on",
        };
        const mode =
          tool === "video_subject_edit"
            ? "subject_edit"
            : tool === "video_subject_replace"
              ? "subject_replace"
              : "subject_remove";
        const ran = await runUpstreamVideoFrameEdit({
          projectId,
          sourceNodeId: nodeId,
          videoAssetId: editAssetId,
          videoUrl: editVideoUrl,
          mode,
          prompt: userPrompt,
          refImageUrl,
          modelName,
          generationOptions,
          queryClient,
        });
        return ran.ok ? okResult() : failResult(ran.error || "视频主体编辑失败");
      }
      const ok = await runLocalVideoFrameEdit({
        projectId,
        sourceNodeId: nodeId,
        videoAssetId: assetId,
        mode: "smart_matting",
        queryClient,
      });
      return ok ? okResult() : failResult("智能抠像失败");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "视频工具失败";
      toast.error(msg);
      return failResult(msg);
    }
  }

  // —— 扩图：params 可给四边像素，缺省四周各扩 96 ——
  if (tool === "outpaint") {
    if (sourceNode.type !== "image_input") {
      toast.error("扩图请选择图片节点");
      return failResult("扩图请选择图片节点");
    }
    const defaultPx = 96;
    const margins: OutpaintMargins = {
      top: Math.max(0, paramNum(params, "top", defaultPx)),
      right: Math.max(0, paramNum(params, "right", defaultPx)),
      bottom: Math.max(0, paramNum(params, "bottom", defaultPx)),
      left: Math.max(0, paramNum(params, "left", defaultPx)),
    };
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel("outpaint");
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.error("无法读取扩图模型配置");
      return failResult("无法读取扩图模型配置");
    }
    const ok = await runOutpaintGenerate({
      projectId,
      sourceNodeId: nodeId,
      outpaint: {
        ...DEFAULT_INLINE_IMAGE_OUTPAINT,
        aspectRatio: (paramStr(params, "aspectRatio") || "original") as typeof DEFAULT_INLINE_IMAGE_OUTPAINT.aspectRatio,
        resolution: (paramStr(params, "resolution") || "2k") as typeof DEFAULT_INLINE_IMAGE_OUTPAINT.resolution,
        margins,
      },
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
    });
    return ok ? okResult() : failResult("扩图失败");
  }

  // —— 画板 AI：对图片节点按提示词图生图（不打开画板弹层） ——
  if (tool === "drawing_board_ai") {
    if (sourceNode.type !== "image_input") {
      toast.error("画板 AI 请选择图片节点");
      return failResult("画板 AI 请选择图片节点");
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const userPrompt =
      paramStr(params, "userPrompt") ||
      paramStr(params, "prompt") ||
      String(nodeParams.prompt ?? "").trim();
    if (!userPrompt) {
      toast.error("画板 AI 需要 params.prompt");
      return failResult("画板 AI 需要提示词");
    }
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel("drawing_board_ai");
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.error("无法读取画板 AI 模型配置");
      return failResult("无法读取画板 AI 模型配置");
    }
    const resultId = await runCreativeToolDirectGenerate({
      projectId,
      sourceNodeId: nodeId,
      label: "画板 AI",
      prompt: userPrompt,
      nodePrompt: userPrompt,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      canvasTool: "drawing_board_ai",
    });
    return resultId ? okResult([resultId]) : failResult("画板 AI 未能生成");
  }

  // —— 画风：把 styleId 拼进提示词并生成 ——
  if (tool === "visual_style") {
    if (sourceNode.type !== "image_input") {
      toast.error("画风请选择图片节点");
      return failResult("画风请选择图片节点");
    }
    const styleId = paramStr(params, "styleId") || paramStr(params, "visualStyleId");
    if (!styleId) {
      toast.error("画风需要 params.styleId");
      return failResult("缺少 styleId");
    }
    let styleConfig: VisualStylesPromptToolConfig | null = null;
    try {
      const res = await getPromptToolConfig("visual_style");
      if (res.config?.kind === "visual_styles") {
        styleConfig = res.config;
      }
    } catch {
      /* 无配置则只写 styleId */
    }
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const userPrompt =
      paramStr(params, "userPrompt") ||
      paramStr(params, "prompt") ||
      String(nodeParams.prompt ?? "").trim();
    const styled = applyVisualStyleToPrompt(userPrompt, styleConfig, styleId);
    useCanvasStore.getState().updateNodeParam(nodeId, "prompt", styled);
    useCanvasStore.getState().updateNodeParam(nodeId, "visualStyleId", styleId);
    useCanvasStore.getState().scheduleAutoSave();
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel("visual_style");
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.message("已写入画风提示词；请再 generate_node 出图");
      return okResult();
    }
    const resultId = await runCreativeToolDirectGenerate({
      projectId,
      sourceNodeId: nodeId,
      label: "画风",
      prompt: styled,
      nodePrompt: styled,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      canvasTool: "visual_style",
    });
    return resultId ? okResult([resultId]) : failResult("画风未能生成");
  }

  // —— 全景 / 九宫格 / 九宫格子工具 ——
  if (tool === "panorama" || tool === "panorama_720" || tool === "grid_9" || isCreativeGridChildTool(tool)) {
    if (sourceNode.type !== "image_input" && tool !== "grid_9" && !isCreativeGridChildTool(tool)) {
      toast.error("请选择图片节点");
      return failResult("请选择图片节点");
    }
    const canvasTool = isCreativeGridChildTool(tool) ? tool : tool;
    const nodeParams = ((sourceNode.data as WorkflowNodeData | undefined)?.params ??
      {}) as Record<string, unknown>;
    const userFromParams =
      paramStr(params, "userPrompt") || paramStr(params, "prompt");
    const userPrompt =
      userFromParams || String(nodeParams.prompt ?? "").trim();

    let label = tool;
    let adminPrompt = "";
    if (tool === "panorama" || tool === "panorama_720") {
      const append = await loadAppendPrompt(
        tool === "panorama_720" ? "panorama_720" : "panorama"
      );
      label = append.label || (tool === "panorama_720" ? "720° 全景" : "全景");
      adminPrompt = append.content;
      if (!adminPrompt && tool === "panorama_720") {
        const fallback = await loadAppendPrompt("panorama");
        adminPrompt = fallback.content;
        if (!append.label) label = fallback.label || label;
      }
    } else if (tool === "grid_9") {
      const append = await loadAppendPrompt("grid_9");
      label = append.label;
      adminPrompt = append.content;
    } else {
      try {
        const cfg = await getPromptConfig();
        const creative = cfg.tools?.grid_9 as CreativeToolsPromptToolConfig | undefined;
        const item = findCreativeToolPrompt(
          creative?.kind === "creative_tools" ? creative : null,
          tool
        );
        label = item?.label?.trim() || tool;
        adminPrompt = item?.prompt?.trim() || "";
      } catch {
        /* ignore */
      }
    }
    if (!adminPrompt && !userPrompt) {
      toast.error(`请在后台配置「${label}」的提示词，或传入 params.userPrompt`);
      return failResult(`请在后台配置「${label}」的提示词，或传入 params.userPrompt`);
    }
    const prompt = buildCreativeToolSubmitPrompt(userPrompt, adminPrompt);
    const billedTool =
      canvasTool === "panorama_720"
        ? "panorama"
        : canvasTool === "grid_9"
          ? CREATIVE_TOOLS_CANVAS_TOOL
          : canvasTool;
    let modelName = "";
    let generationOptions;
    try {
      const resolved = await resolveCreativeGridToolModel(billedTool);
      modelName = resolved.modelName;
      generationOptions = resolved.generationOptions;
    } catch {
      toast.error("无法读取该功能的模型配置");
      return failResult("无法读取该功能的模型配置");
    }
    const resultId = await runCreativeToolDirectGenerate({
      projectId,
      sourceNodeId: nodeId,
      label,
      prompt,
      nodePrompt: userPrompt || prompt,
      modelName,
      generationOptions,
      workflowId,
      creditsEnabled,
      queryClient,
      canvasTool: billedTool,
      allowMissingSourceImage: isCreativeGridChildTool(tool),
    });
    return resultId ? okResult([resultId]) : failResult(`${label}未能生成`);
  }

  toast.message(`画布工具「${tool}」暂需在节点菜单手动使用`);
  return failResult(`画布工具「${tool}」暂未接入 Agent 执行`);
}
