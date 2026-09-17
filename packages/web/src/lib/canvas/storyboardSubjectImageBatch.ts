import { notifyAssetsUpdated } from "@/lib/api/assets";
import { resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import { getCreditQuote } from "@/lib/api/credits";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { listModels, type CanvasModel } from "@/lib/api/models";
import { getJobStatus, pollGenerationJob } from "@/lib/api/workflows";
import { isLocalDesktop } from "@/lib/localDesktop";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import {
  STORYBOARD_SUBJECT_IMAGE_MODEL,
  SUBJECT_KIND_ASSET_SUBCATEGORY,
  buildSubjectImagePrompt,
  computeSubjectImageSourceHash,
  needsSubjectImageGeneration,
  subjectImageNodeId,
  subjectKindToKey,
  type StoryboardSubjectItem,
  type StoryboardSubjectKind,
  type StoryboardSubjectsBundle,
} from "@/types/storyboard-subjects";

// 画幅统一用 16:9 / 1:1 这种画布比例写法（旧写法 16x9 会被当像素尺寸，画幅退回方图）
const SUBJECT_SIZE_OPTION = { ratio: "1:1", aspect_ratio: "1:1", aspectRatio: "1:1" } as const;
// 角色主体图为「面部特写 + 全身三视图」的横向四联排布局，使用横版尺寸以容纳四个视图
const ROLE_SIZE_OPTION = { ratio: "16:9", aspect_ratio: "16:9", aspectRatio: "16:9" } as const;
const DEFAULT_CONCURRENCY = 3;

export interface SubjectImageTarget {
  kind: StoryboardSubjectKind;
  item: StoryboardSubjectItem;
}

export interface SubjectImageBatchCallbacks {
  onItemStart: (subjectId: string) => void;
  onItemDone: (subjectId: string, assetId: string, kind: StoryboardSubjectKind) => void;
  onItemFail: (subjectId: string, error: string) => void;
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
    return { errorMessage: polled.errorMessage || "主体图生成失败" };
  }
  const assetId = await resolveJobAssetId(jobId);
  if (assetId) {
    notifyAssetsUpdated();
    return { assetId };
  }
  return { errorMessage: "未返回主体图资产" };
}

async function generateOneSubjectImage(opts: {
  projectId: string;
  gridNodeId: string;
  workflowId?: string;
  kind: StoryboardSubjectKind;
  item: StoryboardSubjectItem;
  model: string;
  generationOptions: Record<string, string>;
  /** 分镜表所选视觉风格，后端生图时拼进 prompt */
  visualStyleId?: string;
}): Promise<{ assetId?: string; errorMessage?: string }> {
  const virtualNodeId = subjectImageNodeId(opts.gridNodeId, opts.item.id);
  const prompt = buildSubjectImagePrompt(opts.item, opts.kind);
  const idempotencyKey = `storyboard-subject-image-${opts.gridNodeId}-${opts.item.id}-${computeSubjectImageSourceHash(opts.item, opts.kind)}`;

  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model: opts.model,
      category: "image",
      generationOptions: opts.generationOptions,
      canvasTool: "storyboard_subject_image",
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* optional */
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
      assetSubcategory: SUBJECT_KIND_ASSET_SUBCATEGORY[opts.kind],
      assetTitle: opts.item.name.trim() || undefined,
      canvasTool: "storyboard_subject_image",
      ...(opts.visualStyleId ? { visualStyleId: opts.visualStyleId } : {}),
    },
    { idempotencyKey, quoteToken }
  );

  if (result.status === "succeeded") {
    if (result.assetId) {
      notifyAssetsUpdated();
      return { assetId: result.assetId };
    }
    // 本地版常直接带回 resultUrl；切勿用假 jobId 去轮询 SaaS（会一直卡在生成中）
    const outUrl = String(result.resultUrl || result.outputAssets?.[0]?.url || "").trim();
    const outAsset =
      String(result.outputAssets?.[0]?.assetId || result.outputAssets?.[0]?.id || "").trim();
    if (outAsset) {
      notifyAssetsUpdated();
      return { assetId: outAsset };
    }
    if (outUrl && isLocalDesktop) {
      try {
        const { persistLocalImageResult } = await import("@/lib/local/generate");
        const saved = await persistLocalImageResult({
          projectId: opts.projectId,
          nodeId: virtualNodeId,
          url: outUrl,
          assetTitle: opts.item.name.trim() || undefined,
          assetSubcategory: SUBJECT_KIND_ASSET_SUBCATEGORY[opts.kind],
        });
        notifyAssetsUpdated();
        return { assetId: saved.assetId };
      } catch (err) {
        return {
          errorMessage:
            err instanceof Error ? err.message : "主体图已出但登记素材失败，请重试",
        };
      }
    }
    if (result.jobId != null && !isLocalDesktop) {
      return pollMediaJobResult(result.jobId);
    }
    return { errorMessage: result.message || "主体图生成失败（无资产 id）" };
  }

  if (result.status === "pending" && result.jobId != null) {
    if (isLocalDesktop) {
      return {
        errorMessage:
          "本地生成仍返回 pending。请到「生成任务」查看；若上游已成功，可点该主体重试一次",
      };
    }
    return pollMediaJobResult(result.jobId);
  }

  if (result.status === "awaiting_approval") {
    return { errorMessage: result.message || "已提交审批，等待项目创建者确认" };
  }

  return { errorMessage: result.message || "主体图生成失败" };
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

export function collectSubjectImageTargets(
  subjects: StoryboardSubjectsBundle,
  kind?: StoryboardSubjectKind,
  subjectIds?: string[],
  forceIds?: Set<string>
): SubjectImageTarget[] {
  const idSet = subjectIds?.length ? new Set(subjectIds) : null;
  const kinds: StoryboardSubjectKind[] = kind ? [kind] : ["role", "scene", "prop"];
  const targets: SubjectImageTarget[] = [];

  for (const k of kinds) {
    const key = subjectKindToKey(k);
    for (const item of subjects[key]) {
      if (idSet && !idSet.has(item.id)) continue;
      if (!forceIds?.has(item.id) && !needsSubjectImageGeneration(item, k)) continue;
      if (!item.extractPrompt.trim() && !item.name.trim()) continue;
      targets.push({ kind: k, item });
    }
  }

  return targets;
}

export async function runStoryboardSubjectImageBatch(
  opts: {
    projectId: string;
    gridNodeId: string;
    workflowId?: string;
    subjects: StoryboardSubjectsBundle;
    kind?: StoryboardSubjectKind;
    targetSubjectIds?: string[];
    model?: string;
    imageModel?: CanvasModel;
    concurrency?: number;
    /** 分镜表所选视觉风格 */
    visualStyleId?: string;
  } & SubjectImageBatchCallbacks
): Promise<void> {
  const targets = collectSubjectImageTargets(opts.subjects, opts.kind, opts.targetSubjectIds);
  const total = targets.length;
  if (total === 0) {
    opts.onProgress?.(0, 0);
    return;
  }

  const model =
    opts.model?.trim() ||
    (await resolveCanvasToolPrimaryModel(
      "storyboard_subject_image",
      STORYBOARD_SUBJECT_IMAGE_MODEL
    ));
  let imageModel = opts.imageModel;
  if (!imageModel && model) {
    try {
      const catalog = await listModels({ category: "image" });
      imageModel = catalog.find((m) => m.name === model);
    } catch {
      /* catalog optional */
    }
  }
  const presets = getModelGenerationPresets(imageModel);
  const baseOptions = defaultGenerationOptions(presets);
  // 角色使用横版（容纳面部特写 + 全身三视图四联排），场景/道具沿用方形
  const buildOptionsForKind = (kind: StoryboardSubjectKind): Record<string, string> =>
    normalizeGenerationOptions(presets, {
      ...baseOptions,
      ...(kind === "role" ? ROLE_SIZE_OPTION : SUBJECT_SIZE_OPTION),
    });

  let done = 0;
  opts.onProgress?.(done, total);

  await mapConcurrent(targets, opts.concurrency ?? DEFAULT_CONCURRENCY, async ({ kind, item }) => {
    opts.onItemStart(item.id);
    try {
      const result = await generateOneSubjectImage({
        projectId: opts.projectId,
        gridNodeId: opts.gridNodeId,
        workflowId: opts.workflowId,
        kind,
        item,
        model,
        generationOptions: buildOptionsForKind(kind),
        visualStyleId: opts.visualStyleId,
      });
      if (result.assetId) {
        opts.onItemDone(item.id, result.assetId, kind);
      } else {
        opts.onItemFail(item.id, result.errorMessage || "主体图生成失败");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "主体图生成失败";
      opts.onItemFail(item.id, message);
    } finally {
      done += 1;
      opts.onProgress?.(done, total);
    }
  });
}
