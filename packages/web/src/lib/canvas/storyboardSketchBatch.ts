import { notifyAssetsUpdated } from "@/lib/api/assets";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import type { CanvasModel } from "@/lib/api/models";
import { getJobStatus, pollGenerationJob } from "@/lib/api/workflows";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import { resolveStoryboardSketchStyle } from "@/lib/canvas/storyboardSketchStyle";
import {
  buildSketchPrompt,
  computeSketchSourceHash,
  needsSketchGeneration,
  sketchNodeId,
  STORYBOARD_SKETCH_MODEL,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import { STORYBOARD_SKETCH_ASSET_SUBCATEGORY } from "@/types/storyboard-subjects";

const SKETCH_SIZE_OPTION = { size: "16x9" } as const;
const DEFAULT_CONCURRENCY = 3;

export interface SketchBatchCallbacks {
  onRowStart: (rowId: string) => void;
  onRowDone: (rowId: string, assetId: string) => void;
  onRowFail: (rowId: string, error: string) => void;
  onProgress?: (done: number, total: number) => void;
}

async function resolveJobAssetId(jobId: number | string): Promise<string | undefined> {
  const raw = (await getJobStatus(jobId)) as Record<string, unknown>;
  const direct = String(raw.assetId ?? raw.asset_id ?? "").trim();
  if (direct) return direct;

  const outputs = (raw.outputAssets ?? raw.output_assets ?? []) as Array<Record<string, unknown>>;
  for (const item of outputs) {
    const id = String(item?.assetId ?? item?.id ?? "").trim();
    if (id) return id;
  }
  return undefined;
}

async function pollMediaJobResult(
  jobId: number | string
): Promise<{ assetId?: string; errorMessage?: string }> {
  const polled = await pollGenerationJob(jobId, { maxWaitMs: 600_000 });
  if (polled.status !== "succeeded") {
    return { errorMessage: polled.errorMessage || "草图生成失败" };
  }
  const assetId = await resolveJobAssetId(jobId);
  if (assetId) {
    notifyAssetsUpdated();
    return { assetId };
  }
  return { errorMessage: "未返回草图资产" };
}

async function generateOneSketch(opts: {
  projectId: string;
  gridNodeId: string;
  workflowId?: string;
  row: StoryboardTableRow;
  model: string;
  generationOptions: Record<string, string>;
  styleAnchor: string;
  /** 分镜表所选视觉风格，后端生图时拼进 prompt */
  visualStyleId?: string;
}): Promise<{ assetId?: string; errorMessage?: string }> {
  const virtualNodeId = sketchNodeId(opts.gridNodeId, opts.row.id);
  const prompt = buildSketchPrompt(opts.row, opts.styleAnchor);
  const idempotencyKey = `storyboard-sketch-${opts.gridNodeId}-${opts.row.id}-${computeSketchSourceHash(opts.row)}`;

  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: opts.model,
      category: "image",
      generationOptions: opts.generationOptions,
      canvasTool: "storyboard_sketch",
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* submit with pricing version fallback if quote unavailable */
  }

  const result = await generateFromMediaNode(
    {
      projectId: opts.projectId,
      nodeId: virtualNodeId,
      workflowId: opts.workflowId,
      category: "image",
      prompt,
      model: opts.model,
      references: [],
      generationOptions: opts.generationOptions,
      assetSubcategory: STORYBOARD_SKETCH_ASSET_SUBCATEGORY,
      assetTitle: opts.row.shotNo ? `分镜 ${opts.row.shotNo}` : undefined,
      submitSource: "auto",
      canvasTool: "storyboard_sketch",
      ...(opts.visualStyleId ? { visualStyleId: opts.visualStyleId } : {}),
    },
    { idempotencyKey, quoteToken }
  );

  if (result.status === "succeeded") {
    if (result.assetId) {
      notifyAssetsUpdated();
      return { assetId: result.assetId };
    }
    if (result.jobId) {
      return pollMediaJobResult(result.jobId);
    }
    return { errorMessage: result.message || "草图生成失败" };
  }

  if (result.status === "pending" && result.jobId) {
    return pollMediaJobResult(result.jobId);
  }

  if (result.status === "awaiting_approval") {
    return { errorMessage: result.message || "已提交审批，等待项目创建者确认" };
  }

  return { errorMessage: result.message || "草图生成失败" };
}

async function mapConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/** 筛出需要生成草图的行；传入 rowIds 时仅保留指定行（单行「生成草图」必须带上）。 */
export function filterRowsNeedingSketch(
  rows: StoryboardTableRow[],
  rowIds?: string[]
): StoryboardTableRow[] {
  const idSet = rowIds?.length ? new Set(rowIds) : null;
  return rows.filter((row) => {
    if (idSet && !idSet.has(row.id)) return false;
    return needsSketchGeneration(row);
  });
}

export async function runStoryboardSketchBatch(opts: {
  projectId: string;
  gridNodeId: string;
  workflowId?: string;
  rows: StoryboardTableRow[];
  /** 仅生成这些行；不传则处理全部待生成行 */
  targetRowIds?: string[];
  model?: string;
  imageModel?: CanvasModel;
  concurrency?: number;
  styleAnchor?: string;
  /** 分镜表所选视觉风格 */
  visualStyleId?: string;
} & SketchBatchCallbacks): Promise<void> {
  const targets = filterRowsNeedingSketch(opts.rows, opts.targetRowIds);
  const total = targets.length;
  if (total === 0) {
    opts.onProgress?.(0, 0);
    return;
  }

  const model = opts.model ?? STORYBOARD_SKETCH_MODEL;
  const presets = getModelGenerationPresets(opts.imageModel);
  const generationOptions = normalizeGenerationOptions(presets, {
    ...defaultGenerationOptions(presets),
    ...SKETCH_SIZE_OPTION,
  });
  const styleAnchor = opts.styleAnchor ?? (await resolveStoryboardSketchStyle());

  let done = 0;
  opts.onProgress?.(done, total);

  await mapConcurrent(targets, opts.concurrency ?? DEFAULT_CONCURRENCY, async (row) => {
    opts.onRowStart(row.id);
    try {
      const result = await generateOneSketch({
        projectId: opts.projectId,
        gridNodeId: opts.gridNodeId,
        workflowId: opts.workflowId,
        row,
        model,
        generationOptions,
        styleAnchor,
        visualStyleId: opts.visualStyleId,
      });
      if (result.assetId) {
        opts.onRowDone(row.id, result.assetId);
      } else {
        opts.onRowFail(row.id, result.errorMessage || "草图生成失败");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "草图生成失败";
      opts.onRowFail(row.id, message);
    } finally {
      done += 1;
      opts.onProgress?.(done, total);
    }
  });
}
