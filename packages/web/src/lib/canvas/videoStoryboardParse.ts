/**
 * 视频 → 分镜表：切镜 + storyboard_from_video 拉片。
 * - 视频节点顶栏「解析」：新建分镜表再写入
 * - 分镜表「提取分镜」：写入已连接视频的当前分镜表
 * 算力按画布工具 storyboard_from_video 固定价预扣。
 */

import type { Edge } from "@xyflow/react";
import { toast } from "sonner";
import { extractViralRemakeShots, type ViralRemakeShotFrame } from "@/lib/api/viralRemake";
import { getCreditQuote } from "@/lib/api/credits";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import {
  alignRowsWithKeyframes,
  parseViralRemakeContent,
} from "@/lib/canvas/parseViralRemake";
import { toastCreditCharged } from "@/lib/canvas/generationCreditHelpers";
import { appendStoryboardVisualStyle } from "@/lib/canvas/storyboardVisualStyle";
import type { VisualStyleItem } from "@/lib/canvas/renderToolPrompt";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { useCanvasStore } from "@/stores/canvasStore";
import { reindexTableRows } from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";
import {
  STORYBOARD_FROM_VIDEO_KIND,
  STORYBOARD_FROM_VIDEO_MODEL,
  STORYBOARD_FROM_VIDEO_TOOL,
} from "@/lib/canvas/viralRemakePipeline";

/** 分镜表 viralRemakeMeta.source：画布视频解析（不自动弹出爆款向导） */
export const VIDEO_STORYBOARD_PARSE_SOURCE = "video_node_parse" as const;

function newestNodeId(beforeIds: Set<string>, type: string): string | null {
  return useCanvasStore.getState().nodes.find((n) => n.type === type && !beforeIds.has(n.id))?.id ?? null;
}

function patchGridParams(gridNodeId: string, patch: Record<string, unknown>) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const current = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  useCanvasStore.getState().updateNodeData(gridNodeId, {
    params: { ...current, ...patch },
  });
}

function resolveAspectClarity(params: Record<string, unknown>): {
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
} {
  const opts = (params.generationOptions as Record<string, unknown> | undefined) ?? {};
  const ratioRaw = String(opts.ratio ?? opts.aspectRatio ?? params.aspectRatio ?? "16:9").trim();
  const aspectRatio: ViralRemakeAspect =
    ratioRaw === "9:16" || ratioRaw === "1:1" || ratioRaw === "16:9" ? ratioRaw : "16:9";
  const clarityRaw = String(opts.resolution ?? opts.clarity ?? "1080p").trim().toLowerCase();
  const clarity: ViralRemakeClarity = clarityRaw.includes("720") ? "720p" : "1080p";
  return { aspectRatio, clarity };
}

function buildAnalyzePrompt(
  frames: ViralRemakeShotFrame[],
  aspectRatio: string,
  clarity: string
): string {
  const lines = [
    `目标画幅：${aspectRatio}`,
    `目标清晰度：${clarity}`,
    `系统已切出 ${frames.length} 个镜头关键帧（按镜头顺序附图），请据此拉片。`,
    "【用户替换说明】暂无，请提取原片主体供后续替换。",
  ];
  frames.forEach((f) => {
    lines.push(
      `镜头${f.index}：${f.startSec.toFixed(2)}s–${f.endSec.toFixed(2)}s（约 ${f.durationLabel}）`
    );
  });
  return lines.join("\n");
}

function buildKeyframeReferences(
  videoNodeId: string,
  videoFileUrl: string,
  frames: ViralRemakeShotFrame[]
): GenerationReference[] {
  const refs: GenerationReference[] = [];
  const totalDur = frames.length ? Number(frames[frames.length - 1]?.endSec ?? 0) : 0;
  const keyframeOnly = frames.length >= 6 || totalDur > 12.05;
  if (!keyframeOnly && videoFileUrl) {
    refs.push({
      nodeId: videoNodeId || "video-parse-ref",
      type: "video",
      label: "参考视频",
      url: videoFileUrl,
    });
  }
  const maxFrames = 12;
  const picked =
    frames.length <= maxFrames
      ? frames
      : Array.from({ length: maxFrames }, (_, i) => {
          const idx = Math.round((i * (frames.length - 1)) / (maxFrames - 1));
          return frames[idx]!;
        });
  for (const f of picked) {
    refs.push({
      nodeId: `video-parse-kf-${f.index}`,
      type: "image",
      label: `镜头${f.index}关键帧`,
      url: f.fileUrl || f.thumbnailUrl,
    });
  }
  return refs;
}

/**
 * 在源视频右侧新建分镜表并连线（video → reference）。
 * 返回新分镜表节点 id；失败返回 null。
 */
export function createStoryboardGridFromVideoNode(opts: {
  videoNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  edges: Edge[];
}): string | null {
  const store = useCanvasStore.getState();
  const beforeIds = new Set(store.nodes.map((n) => n.id));
  const { width } = resolveNodeSize(opts.sourceWidth, opts.sourceHeight);
  const siblingOffset =
    opts.edges.filter((e) => e.source === opts.videoNodeId && e.sourceHandle === "video").length *
    40;
  const pos = {
    x: opts.sourcePosition.x + width + 48,
    y: opts.sourcePosition.y + siblingOffset,
  };

  store.addNode("storyboard_grid", pos);
  const gridNodeId = newestNodeId(beforeIds, "storyboard_grid");
  if (!gridNodeId) return null;

  store.updateNodeData(gridNodeId, { label: "视频分镜" });
  store.updateNodeSize(gridNodeId, 920, 420);
  store.connectNodes({
    source: opts.videoNodeId,
    target: gridNodeId,
    sourceHandle: "video",
    targetHandle: REFERENCE_INPUT_ID,
  });
  store.selectNode(gridNodeId);
  return gridNodeId;
}

export type VideoStoryboardParseResult = {
  gridNodeId: string;
  shotCount: number;
  creditCost?: number;
};

/**
 * 将已连接的视频写入指定分镜表（切镜 + AI 拉片）。
 * 分镜表顶栏「提取分镜」在检测到上游视频时调用。
 */
export async function runVideoStoryboardParseIntoGrid(opts: {
  projectId: string;
  gridNodeId: string;
  videoNodeId: string;
  videoAssetId: string;
  videoFileUrl: string;
  videoParams?: Record<string, unknown>;
  onProgress?: (message: string) => void;
  /** 是否 toast 成功（分镜表按钮自行汇总时可关） */
  toastSuccess?: boolean;
  /** 提取分镜与主体时套用的视觉风格 */
  visualStyle?: VisualStyleItem | null;
}): Promise<VideoStoryboardParseResult> {
  const projectId = String(opts.projectId || "").trim();
  if (!projectId) throw new Error("项目未加载");
  const cur = String(useCanvasStore.getState().projectId || "").trim();
  if (cur && cur !== projectId) throw new Error("项目已切换，请重试");

  const gridNodeId = String(opts.gridNodeId || "").trim();
  if (!gridNodeId) throw new Error("分镜表不存在");
  const assetId = String(opts.videoAssetId || "").trim();
  if (!assetId) throw new Error("请先上传视频");

  const { aspectRatio, clarity } = resolveAspectClarity(opts.videoParams ?? {});

  opts.onProgress?.("正在切镜并提取关键帧…");
  let frames: ViralRemakeShotFrame[] = [];
  try {
    const extracted = await extractViralRemakeShots({
      projectId,
      videoAssetId: assetId,
      onProgress: (msg) => opts.onProgress?.(msg),
    });
    frames = extracted.shots ?? [];
    notifyAssetsUpdated();
  } catch (err) {
    throw err instanceof Error ? err : new Error("切镜失败");
  }
  if (!frames.length) {
    throw new Error("未切出镜头，请换一段有明显镜头切换的视频");
  }

  opts.onProgress?.(`已切出 ${frames.length} 镜，正在 AI 提取分镜…`);

  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: STORYBOARD_FROM_VIDEO_MODEL,
      category: "text",
      canvasTool: STORYBOARD_FROM_VIDEO_TOOL,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* 无报价仍尝试提交 */
  }

  const workflowId = useCanvasStore.getState().workflowId ?? undefined;
  const content = appendStoryboardVisualStyle(
    buildAnalyzePrompt(frames, aspectRatio, clarity),
    opts.visualStyle
  );
  const references = buildKeyframeReferences(
    opts.videoNodeId,
    opts.videoFileUrl,
    frames
  );

  let creditCost: number | undefined;
  let text = "";
  try {
    const result = await runStoryboardTextJob({
      projectId,
      nodeId: `${gridNodeId}::video-parse`,
      workflowId,
      content,
      model: STORYBOARD_FROM_VIDEO_MODEL,
      textPromptKind: STORYBOARD_FROM_VIDEO_KIND,
      canvasTool: STORYBOARD_FROM_VIDEO_TOOL,
      quoteToken,
      idempotencySuffix: "video-parse",
      references,
    });
    text = result.text;
    creditCost = result.creditCost;
    toastCreditCharged(result.creditCost, true);
  } catch (err) {
    throw err instanceof Error ? err : new Error("提取分镜失败");
  }

  const parsed = parseViralRemakeContent(text);
  const rows = alignRowsWithKeyframes(parsed.rows, frames);
  const indexed = reindexTableRows(rows);

  patchGridParams(gridNodeId, {
    shots: indexed,
    subjects: parsed.subjects,
    viewMode: "shots",
    selectedShotId: indexed[0]?.id ?? "",
    ...(opts.visualStyle?.id ? { visualStyleId: opts.visualStyle.id } : {}),
    viralRemakeMeta: {
      source: VIDEO_STORYBOARD_PARSE_SOURCE,
      styleSummary: parsed.styleSummary,
      replacePlan: parsed.replacePlan,
      aspectRatio,
      clarity,
      videoAssetId: assetId,
      videoNodeId: opts.videoNodeId,
      replaceImageAssetIds: [],
    },
  });

  if (parsed.warnings.length) {
    toast.message(parsed.warnings.slice(0, 2).join("；"));
  }

  if (opts.toastSuccess !== false) {
    toast.success(`解析完成：${indexed.length} 个镜头`);
  }
  return { gridNodeId, shotCount: indexed.length, creditCost };
}

/**
 * 视频节点「解析」主流程：建分镜表 → ffmpeg 切镜 → storyboard_from_video 拉片写回。
 */
export async function runVideoStoryboardParse(opts: {
  projectId: string;
  videoNodeId: string;
  videoAssetId: string;
  videoFileUrl: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  edges: Edge[];
  videoParams?: Record<string, unknown>;
  onProgress?: (message: string) => void;
}): Promise<VideoStoryboardParseResult> {
  const projectId = String(opts.projectId || "").trim();
  if (!projectId) throw new Error("项目未加载");

  const assetId = String(opts.videoAssetId || "").trim();
  if (!assetId) throw new Error("请先上传视频");

  opts.onProgress?.("正在创建分镜表…");
  const gridNodeId = createStoryboardGridFromVideoNode({
    videoNodeId: opts.videoNodeId,
    sourcePosition: opts.sourcePosition,
    sourceWidth: opts.sourceWidth,
    sourceHeight: opts.sourceHeight,
    edges: opts.edges,
  });
  if (!gridNodeId) throw new Error("创建分镜表失败");

  return runVideoStoryboardParseIntoGrid({
    projectId,
    gridNodeId,
    videoNodeId: opts.videoNodeId,
    videoAssetId: assetId,
    videoFileUrl: opts.videoFileUrl,
    videoParams: opts.videoParams,
    onProgress: opts.onProgress,
  });
}
