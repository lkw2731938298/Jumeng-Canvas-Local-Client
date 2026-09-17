/**
 * 分镜表行级生成（草图 / 运镜词 / 视频词）统一入口。
 * 从 canvasStore 读取最新行数据并提交后台 generation_jobs，避免 overlay effect 与闭包陈旧数据导致未发请求。
 */

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CanvasModel } from "@/lib/api/models";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  computeSketchSourceHash,
  parseTableRowsParam,
  reindexTableRows,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";
import { invalidateCanvasCreditQueries } from "@/lib/canvas/useGenerationCreditQuote";
import {
  describePromptGenerationSkip,
  filterRowsForPromptGeneration,
  runStoryboardPromptBatch,
  type RowPromptField,
} from "@/lib/canvas/storyboardPromptBatch";
import {
  filterRowsNeedingSketch,
  runStoryboardSketchBatch,
} from "@/lib/canvas/storyboardSketchBatch";
import { mediaVisualStyleId } from "@/lib/canvas/storyboardVisualStyle";

export type StoryboardGridBatchKind = "sketch" | "camera" | "video";

export interface StoryboardGridBatchContext {
  projectId: string;
  workflowId?: string;
  rows: StoryboardTableRow[];
  visualStyleId?: string;
}

/** 从 store 拉取分镜表最新行（提交前必须调用，禁止用组件闭包里的 rows）。 */
export function readStoryboardGridContext(gridNodeId: string): StoryboardGridBatchContext | null {
  const state = useCanvasStore.getState();
  if (!state.projectId) return null;
  const node = state.nodes.find((n) => n.id === gridNodeId);
  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  return {
    projectId: state.projectId,
    workflowId: state.workflowId ?? undefined,
    rows: parseTableRowsParam(params.shots),
    visualStyleId: mediaVisualStyleId(String(params.visualStyleId ?? "")),
  };
}

function patchStoryboardRows(
  gridNodeId: string,
  patcher: (rows: StoryboardTableRow[]) => StoryboardTableRow[]
): void {
  const ctx = readStoryboardGridContext(gridNodeId);
  if (!ctx) return;
  useCanvasStore.getState().updateNodeParam(gridNodeId, "shots", reindexTableRows(patcher(ctx.rows)));
}

export async function runStoryboardSketchGeneration(opts: {
  gridNodeId: string;
  rowIds?: string[];
  sketchModel: string;
  imageModel?: CanvasModel;
  queryClient?: QueryClient;
  onProgress?: (done: number, total: number) => void;
  /** 链式批量时静默成功提示，避免连弹 toast */
  silent?: boolean;
}): Promise<boolean> {
  const ctx = readStoryboardGridContext(opts.gridNodeId);
  if (!ctx) {
    toast.error("项目未加载，无法生成草图");
    return false;
  }

  // 必须把 rowIds 传进 filter，否则单行点击会误提交全部待生成行
  const needs = filterRowsNeedingSketch(ctx.rows, opts.rowIds);
  if (needs.length === 0) {
    if (opts.rowIds?.length) {
      const idSet = new Set(opts.rowIds);
      patchStoryboardRows(opts.gridNodeId, (rows) =>
        rows.map((row) =>
          idSet.has(row.id) && row.sketchStatus === "running"
            ? { ...row, sketchStatus: row.sketchAssetId ? "succeeded" : "idle" }
            : row
        )
      );
    }
    if (!opts.silent) toast.message("没有需要生成的草图（请先填写画面描述）");
    return false;
  }

  const needIds = new Set(needs.map((n) => n.id));
  patchStoryboardRows(opts.gridNodeId, (rows) =>
    rows.map((row) =>
      needIds.has(row.id)
        ? { ...row, sketchStatus: "running", sketchError: undefined }
        : row
    )
  );

  try {
    await runStoryboardSketchBatch({
      projectId: ctx.projectId,
      gridNodeId: opts.gridNodeId,
      workflowId: ctx.workflowId,
      rows: ctx.rows,
      targetRowIds: opts.rowIds,
      model: opts.sketchModel,
      imageModel: opts.imageModel,
      visualStyleId: ctx.visualStyleId,
      onRowStart: (rowId) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) =>
            row.id === rowId ? { ...row, sketchStatus: "running", sketchError: undefined } : row
          )
        );
      },
      onRowDone: (rowId, assetId) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) => {
            if (row.id !== rowId) return row;
            return {
              ...row,
              sketchAssetId: assetId,
              sketchStatus: "succeeded",
              sketchError: undefined,
              sketchSourceHash: computeSketchSourceHash(row),
            };
          })
        );
      },
      onRowFail: (rowId, error) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) =>
            row.id === rowId ? { ...row, sketchStatus: "failed", sketchError: error } : row
          )
        );
      },
      onProgress: opts.onProgress,
    });
    if (!opts.silent) toast.success("草图生成完成");
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "草图生成失败");
    return false;
  } finally {
    if (opts.queryClient) {
      void invalidateCanvasCreditQueries(opts.queryClient, ctx.projectId);
    }
  }
}

export async function runStoryboardRowPromptGeneration(opts: {
  gridNodeId: string;
  field: RowPromptField;
  rowIds?: string[];
  queryClient?: QueryClient;
  onProgress?: (done: number, total: number) => void;
  /** 链式批量时静默成功提示，避免连弹 toast */
  silent?: boolean;
  /** 仅填充空字段，不覆盖已有文案 */
  onlyEmpty?: boolean;
  /** 拼入 LLM 用户消息的全局约束（如爆款替换方案） */
  extraContext?: string;
}): Promise<boolean> {
  const ctx = readStoryboardGridContext(opts.gridNodeId);
  if (!ctx) {
    toast.error("项目未加载，无法生成提示词");
    return false;
  }

  const targets = filterRowsForPromptGeneration(
    ctx.rows,
    opts.field,
    opts.rowIds,
    opts.onlyEmpty
  );
  if (targets.length === 0) {
    if (opts.rowIds?.length === 1) {
      const row = ctx.rows.find((item) => item.id === opts.rowIds![0]);
      toast.error(
        row ? describePromptGenerationSkip(row, opts.field) ?? "无法生成" : "未找到对应分镜行"
      );
    } else if (!opts.silent) {
      toast.message(
        opts.field === "videoPrompt"
          ? "没有可生成的视频词（需先有画面描述；批量生成需已有运镜词）"
          : "没有可生成的运镜词（请先填写画面描述）"
      );
    }
    return false;
  }

  const statusKey = opts.field === "cameraPrompt" ? "cameraPromptStatus" : "videoPromptStatus";
  const errorKey = opts.field === "cameraPrompt" ? "cameraPromptError" : "videoPromptError";

  patchStoryboardRows(opts.gridNodeId, (rows) =>
    rows.map((row) =>
      targets.some((t) => t.id === row.id)
        ? { ...row, [statusKey]: "running", [errorKey]: undefined }
        : row
    )
  );

  try {
    const result = await runStoryboardPromptBatch({
      projectId: ctx.projectId,
      gridNodeId: opts.gridNodeId,
      workflowId: ctx.workflowId,
      rows: ctx.rows,
      field: opts.field,
      targetRowIds: opts.rowIds,
      onlyEmpty: opts.onlyEmpty,
      extraContext: opts.extraContext,
      onRowStart: (rowId) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) =>
            row.id === rowId ? { ...row, [statusKey]: "running", [errorKey]: undefined } : row
          )
        );
      },
      onRowDone: (rowId, text) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) =>
            row.id === rowId
              ? { ...row, [opts.field]: text, [statusKey]: "succeeded", [errorKey]: undefined }
              : row
          )
        );
      },
      onRowFail: (rowId, error) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) =>
            row.id === rowId ? { ...row, [statusKey]: "failed", [errorKey]: error } : row
          )
        );
      },
      onRowPatch: (rowId, patch) => {
        patchStoryboardRows(opts.gridNodeId, (rows) =>
          rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
        );
      },
      onProgress: opts.onProgress,
    });
    if (result.succeeded > 0) {
      if (!opts.silent) {
        toast.success(opts.field === "cameraPrompt" ? "运镜提示词生成完成" : "视频提示词生成完成");
      }
      return true;
    }
    if (result.failed > 0) {
      toast.error("提示词生成失败，请查看单元格重试");
    }
    return false;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "生成失败");
    return false;
  } finally {
    if (opts.queryClient) {
      void invalidateCanvasCreditQueries(opts.queryClient, ctx.projectId);
    }
  }
}

/** 一键生成：按序提交分镜表全部运镜词 → 视频词（忽略选中行，始终全表；草图已从一键流程移除，改由「生成草图」单独触发）。 */
export async function runStoryboardOneClickGeneration(opts: {
  gridNodeId: string;
  queryClient?: QueryClient;
  onStage?: (stage: StoryboardGridBatchKind, done: number, total: number) => void;
  /** 爆款复刻：仅填空 + 带入替换方案 */
  onlyEmpty?: boolean;
  extraContext?: string;
}): Promise<void> {
  const ctx = readStoryboardGridContext(opts.gridNodeId);
  if (!ctx) {
    toast.error("项目未加载，无法一键生成");
    return;
  }
  if (ctx.rows.length === 0) {
    toast.message("分镜表为空，请先解析或添加镜头");
    return;
  }

  const stages: Array<{
    kind: StoryboardGridBatchKind;
    run: () => Promise<boolean>;
  }> = [
    {
      kind: "camera",
      run: () =>
        runStoryboardRowPromptGeneration({
          gridNodeId: opts.gridNodeId,
          field: "cameraPrompt",
          queryClient: opts.queryClient,
          silent: true,
          onlyEmpty: opts.onlyEmpty,
          extraContext: opts.extraContext,
          onProgress: (done, total) => opts.onStage?.("camera", done, total),
        }),
    },
    {
      kind: "video",
      run: () =>
        runStoryboardRowPromptGeneration({
          gridNodeId: opts.gridNodeId,
          field: "videoPrompt",
          queryClient: opts.queryClient,
          silent: true,
          onlyEmpty: opts.onlyEmpty,
          extraContext: opts.extraContext,
          onProgress: (done, total) => opts.onStage?.("video", done, total),
        }),
    },
  ];

  let anyOk = false;
  for (const stage of stages) {
    opts.onStage?.(stage.kind, 0, 0);
    const ok = await stage.run();
    if (ok) anyOk = true;
  }

  if (anyOk) {
    toast.success("一键生成完成");
  } else {
    toast.message("没有可提交的任务（请先填写画面描述）");
  }
}
