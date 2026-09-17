/**
 * 图片 → 分镜表：多模态 storyboard_from_image，根据参考图拆分镜行与主体。
 */

import { toast } from "sonner";
import { getCreditQuote } from "@/lib/api/credits";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { parseViralRemakeContent } from "@/lib/canvas/parseViralRemake";
import { toastCreditCharged } from "@/lib/canvas/generationCreditHelpers";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import type { StoryboardUpstreamMedia } from "@/lib/canvas/resolveUpstreamStoryboard";
import { useCanvasStore } from "@/stores/canvasStore";
import { appendStoryboardVisualStyle } from "@/lib/canvas/storyboardVisualStyle";
import type { VisualStyleItem } from "@/lib/canvas/renderToolPrompt";
import { reindexTableRows } from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";

export const STORYBOARD_FROM_IMAGE_TOOL = "storyboard_from_image" as const;
export const STORYBOARD_FROM_IMAGE_KIND = "storyboard_from_image" as const;
export const STORYBOARD_FROM_IMAGE_MODEL = "" as const;
export const IMAGE_STORYBOARD_PARSE_SOURCE = "image_node_parse" as const;

function patchGridParams(gridNodeId: string, patch: Record<string, unknown>) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const current = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  useCanvasStore.getState().updateNodeData(gridNodeId, {
    params: { ...current, ...patch },
  });
}

async function resolveImageReferences(
  projectId: string,
  images: StoryboardUpstreamMedia[]
): Promise<GenerationReference[]> {
  const refs: GenerationReference[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;
    const node = useCanvasStore.getState().nodes.find((n) => n.id === img.nodeId);
    const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
    let url = "";
    try {
      url = await resolveNodeMediaUrl(projectId, params, "imageUrl");
    } catch {
      url = img.fileUrl;
    }
    if (!url && img.fileUrl) url = img.fileUrl;
    if (!url) continue;
    refs.push({
      nodeId: img.nodeId,
      type: "image",
      label: img.label || `参考图${i + 1}`,
      url,
    });
  }
  return refs;
}

/**
 * 将上游图片解析写入分镜表（shots + subjects）。
 */
export async function runImageStoryboardParseIntoGrid(opts: {
  projectId: string;
  gridNodeId: string;
  images: StoryboardUpstreamMedia[];
  onProgress?: (message: string) => void;
  /** 提取分镜与主体时套用的视觉风格 */
  visualStyle?: VisualStyleItem | null;
}): Promise<{ shotCount: number; creditCost?: number }> {
  const projectId = String(opts.projectId || "").trim();
  if (!projectId) throw new Error("项目未加载");
  const gridNodeId = String(opts.gridNodeId || "").trim();
  if (!gridNodeId) throw new Error("分镜表不存在");
  if (!opts.images.length) throw new Error("请先连接图片节点");

  opts.onProgress?.("正在解析参考图…");
  const references = await resolveImageReferences(projectId, opts.images);
  if (!references.length) {
    throw new Error("无法读取参考图，请确认图片已上传");
  }

  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: STORYBOARD_FROM_IMAGE_MODEL,
      category: "text",
      canvasTool: STORYBOARD_FROM_IMAGE_TOOL,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* optional */
  }

  const content = appendStoryboardVisualStyle(
    [
      `已附带 ${references.length} 张参考图（按连接顺序）。`,
      "请根据画面内容拆分为分镜表：单图可拆成多镜头叙事；多图按顺序各对应一镜或连贯剧情。",
      "同时提取可复用的角色/场景/道具主体。",
    ].join("\n"),
    opts.visualStyle
  );

  opts.onProgress?.("正在 AI 提取分镜…");
  const workflowId = useCanvasStore.getState().workflowId ?? undefined;
  const result = await runStoryboardTextJob({
    projectId,
    nodeId: `${gridNodeId}::image-parse`,
    workflowId,
    content,
    model: STORYBOARD_FROM_IMAGE_MODEL,
    textPromptKind: STORYBOARD_FROM_IMAGE_KIND,
    canvasTool: STORYBOARD_FROM_IMAGE_TOOL,
    quoteToken,
    idempotencySuffix: "image-parse",
    references,
  });
  toastCreditCharged(result.creditCost, true);

  const parsed = parseViralRemakeContent(result.text);
  const indexed = reindexTableRows(parsed.rows);
  if (indexed.length === 0) {
    throw new Error(parsed.warnings[0] ?? "图片分镜解析失败");
  }

  // 首图可作第一镜草图参考（有 assetId 时）
  const firstAsset = String(opts.images[0]?.assetId ?? "").trim();
  const withSketch =
    firstAsset && indexed[0]
      ? indexed.map((row, i) =>
          i === 0
            ? { ...row, sketchAssetId: firstAsset, sketchStatus: "succeeded" as const }
            : row
        )
      : indexed;

  patchGridParams(gridNodeId, {
    shots: withSketch,
    subjects: parsed.subjects,
    viewMode: "shots",
    selectedShotId: withSketch[0]?.id ?? "",
    ...(opts.visualStyle?.id ? { visualStyleId: opts.visualStyle.id } : {}),
    viralRemakeMeta: {
      source: IMAGE_STORYBOARD_PARSE_SOURCE,
      styleSummary: parsed.styleSummary,
      replacePlan: parsed.replacePlan,
      imageNodeIds: opts.images.map((i) => i.nodeId),
      imageAssetIds: opts.images.map((i) => i.assetId).filter(Boolean),
    },
  });

  if (parsed.warnings.length) {
    toast.message(parsed.warnings.slice(0, 2).join("；"));
  }

  return { shotCount: withSketch.length, creditCost: result.creditCost };
}
