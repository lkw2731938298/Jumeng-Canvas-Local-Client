import { getCreditQuote } from "@/lib/api/credits";
import { resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import {
  STORYBOARD_CAMERA_PROMPT_KIND,
  STORYBOARD_TABLE_MODEL,
  STORYBOARD_VIDEO_PROMPT_KIND,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";

const DEFAULT_CONCURRENCY = 3;

export type RowPromptField = "cameraPrompt" | "videoPrompt";

function buildRowContext(row: StoryboardTableRow, extraContext?: string): string {
  return [
    extraContext?.trim() ? `【全局约束】\n${extraContext.trim()}` : "",
    `镜头号：${row.shotNo || row.index}`,
    row.description ? `画面描述：${row.description}` : "",
    row.shotSize ? `景别：${row.shotSize}` : "",
    row.lighting ? `光影氛围：${row.lighting}` : "",
    row.dialogue ? `对话：${row.dialogue}` : "",
    row.sfx ? `音效：${row.sfx}` : "",
    row.cameraPrompt ? `已有运镜提示词：${row.cameraPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function promptKindForField(field: RowPromptField): string {
  return field === "cameraPrompt" ? STORYBOARD_CAMERA_PROMPT_KIND : STORYBOARD_VIDEO_PROMPT_KIND;
}

function virtualNodeId(gridNodeId: string, rowId: string, field: RowPromptField): string {
  const tag = field === "cameraPrompt" ? "camera" : "video";
  return `${gridNodeId}::${tag}::${rowId}`;
}

function stripFences(text: string): string {
  return text.replace(/^```[\s\S]*?```$/m, "").trim();
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
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

function rowHasShotContext(row: StoryboardTableRow): boolean {
  return Boolean(
    row.description.trim() ||
      row.shotSize.trim() ||
      row.lighting.trim() ||
      row.dialogue.trim() ||
      row.sfx.trim()
  );
}

export function describePromptGenerationSkip(
  row: StoryboardTableRow,
  field: RowPromptField
): string | null {
  if (!rowHasShotContext(row)) {
    return "请先填写画面描述或景别等内容";
  }
  if (field === "videoPrompt" && !row.cameraPrompt.trim()) {
    return "将先生成运镜提示词，再生成视频提示词";
  }
  return null;
}

export function filterRowsForPromptGeneration(
  rows: StoryboardTableRow[],
  field: RowPromptField,
  rowIds?: string[],
  /** 仅填充空字段（爆款复刻补全，避免覆盖拉片已写好的替换主体文案） */
  onlyEmpty?: boolean
): StoryboardTableRow[] {
  const idSet = rowIds?.length ? new Set(rowIds) : null;
  return rows.filter((row) => {
    if (idSet && !idSet.has(row.id)) return false;
    if (!rowHasShotContext(row)) return false;
    if (onlyEmpty && String(row[field] ?? "").trim()) return false;
    if (field === "videoPrompt" && !row.cameraPrompt.trim() && !idSet) return false;
    return true;
  });
}

async function generatePromptForRow(opts: {
  projectId: string;
  gridNodeId: string;
  workflowId?: string;
  row: StoryboardTableRow;
  field: RowPromptField;
  extraContext?: string;
}): Promise<string> {
  const kind = promptKindForField(opts.field);
  const model = await resolveCanvasToolPrimaryModel(kind, STORYBOARD_TABLE_MODEL);
  let quoteToken: string | undefined;
  try {
    const quote = await getCreditQuote({
      model,
      category: "text",
      canvasTool: kind,
    });
    quoteToken = quote.quoteToken;
  } catch {
    /* optional */
  }

  const context = buildRowContext(opts.row, opts.extraContext);
  const userContent =
    opts.field === "cameraPrompt"
      ? `请根据以下分镜镜头信息，生成可直接用于 AI 视频的运镜提示词（推拉摇移、景别变化、节奏）。若有全局约束（如替换主体），须遵守。只输出提示词正文，不要解释。\n\n${context}`
      : `请根据以下分镜镜头信息生成完整视频提示词，包含画面、运镜与节奏感。若有全局约束（如替换主体），须在提示词中体现替换后主体。只输出提示词正文，不要解释。\n\n${context}`;

  const { text } = await runStoryboardTextJob({
    projectId: opts.projectId,
    nodeId: virtualNodeId(opts.gridNodeId, opts.row.id, opts.field),
    workflowId: opts.workflowId,
    content: userContent,
    model,
    textPromptKind: kind,
    canvasTool: kind,
    quoteToken,
    idempotencySuffix: `${opts.field}-${opts.row.id}`,
  });

  return stripFences(text);
}

export async function runStoryboardPromptBatch(opts: {
  projectId: string;
  gridNodeId: string;
  workflowId?: string;
  rows: StoryboardTableRow[];
  field: RowPromptField;
  targetRowIds?: string[];
  onlyEmpty?: boolean;
  extraContext?: string;
  onRowStart: (rowId: string) => void;
  onRowDone: (rowId: string, text: string) => void;
  onRowFail: (rowId: string, error: string) => void;
  onRowPatch?: (rowId: string, patch: Partial<StoryboardTableRow>) => void;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ succeeded: number; failed: number }> {
  const targets = filterRowsForPromptGeneration(
    opts.rows,
    opts.field,
    opts.targetRowIds,
    opts.onlyEmpty
  );
  const total = targets.length;
  opts.onProgress?.(0, total);
  if (total === 0) {
    if (opts.targetRowIds?.length === 1) {
      const row = opts.rows.find((item) => item.id === opts.targetRowIds![0]);
      if (row) {
        const reason = describePromptGenerationSkip(row, opts.field);
        if (reason) throw new Error(reason);
      }
    }
    return { succeeded: 0, failed: 0 };
  }

  let done = 0;
  let succeeded = 0;
  let failed = 0;

  await mapConcurrent(targets, DEFAULT_CONCURRENCY, async (row) => {
    opts.onRowStart(row.id);
    let cameraAutoStarted = false;
    try {
      let workingRow = row;
      if (opts.field === "videoPrompt" && !workingRow.cameraPrompt.trim()) {
        cameraAutoStarted = true;
        opts.onRowPatch?.(row.id, {
          cameraPromptStatus: "running",
          cameraPromptError: undefined,
        });
        const cameraText = await generatePromptForRow({
          projectId: opts.projectId,
          gridNodeId: opts.gridNodeId,
          workflowId: opts.workflowId,
          row: workingRow,
          field: "cameraPrompt",
          extraContext: opts.extraContext,
        });
        workingRow = { ...workingRow, cameraPrompt: cameraText };
        opts.onRowPatch?.(row.id, {
          cameraPrompt: cameraText,
          cameraPromptStatus: "succeeded",
          cameraPromptError: undefined,
        });
      }

      const text = await generatePromptForRow({
        projectId: opts.projectId,
        gridNodeId: opts.gridNodeId,
        workflowId: opts.workflowId,
        row: workingRow,
        field: opts.field,
        extraContext: opts.extraContext,
      });

      opts.onRowDone(row.id, text);
      succeeded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "生成失败";
      if (cameraAutoStarted) {
        opts.onRowPatch?.(row.id, {
          cameraPromptStatus: "failed",
          cameraPromptError: message,
        });
      }
      opts.onRowFail(row.id, message);
      failed += 1;
    } finally {
      done += 1;
      opts.onProgress?.(done, total);
    }
  });

  return { succeeded, failed };
}
