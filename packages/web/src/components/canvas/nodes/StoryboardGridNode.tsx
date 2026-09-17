"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { BaseNode } from "./BaseNode";
import { StoryboardSubjectsView } from "./StoryboardSubjectsView";
import type { WorkflowNodeData } from "@/types/workflow";
import type { StoryboardViewMode } from "@/types/storyboard-subjects";
import { useCanvasStore } from "@/stores/canvasStore";
import { formatCreditLabel } from "@/lib/api/credits";
import { NODE_TITLE_HEIGHT } from "@/lib/canvas/nodeSizing";
import { useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import { runStoryboardRowPromptGeneration } from "@/lib/canvas/storyboardGridActions";
import {
  isStoryboardGenActive,
  isStoryboardRowGenerating,
  STORYBOARD_CELL_GENERATING_OVERLAY_CLASS,
  STORYBOARD_ROW_GENERATING_CLASS,
} from "@/lib/canvas/storyboardGeneratingUi";
import {
  STORYBOARD_CAMERA_PROMPT_KIND,
  STORYBOARD_TABLE_COLUMNS,
  STORYBOARD_TABLE_MODEL,
  STORYBOARD_VIDEO_PROMPT_KIND,
  type StoryboardTableColumnKey,
  type StoryboardTableRow,
  computeShotsTimeline,
  formatTimelineDuration,
  parseTableRowsParam,
  reindexTableRows,
} from "@/types/storyboard-table";

const CELL_FIELD =
  "block w-full resize-none overflow-hidden border-0 bg-transparent px-1.5 py-1 text-[10px] leading-relaxed text-white/80 shadow-none outline-none ring-0 placeholder:text-white/25 focus:bg-white/[0.04]";

const EMPTY_BODY_HEIGHT = 120;
const TAB_BAR_HEIGHT = 28;
const MIN_TABLE_SCROLL_HEIGHT = 160;

const TABLE_MIN_WIDTH = STORYBOARD_TABLE_COLUMNS.reduce((sum, col) => sum + col.width, 0);

/** 单元格内紧凑算力提示（闪电图标 + 数字，完整文案放 title） */
function CellCreditHint({
  cost,
  loading,
  creditsEnabled,
}: {
  cost: number;
  loading?: boolean;
  creditsEnabled: boolean;
}) {
  const label = loading ? "…" : formatCreditLabel(cost, creditsEnabled);
  const display = loading ? "…" : cost > 0 ? String(cost) : "—";
  return (
    <span
      className="inline-flex items-center gap-0.5 leading-none tabular-nums text-white/40"
      title={label}
    >
      {/* 单元格算力闪电用主题紫，避免跟父级 text-white/40 继承成白色 */}
      <Zap className="size-2 fill-current text-primary" aria-hidden />
      <span>{display}</span>
    </span>
  );
}

function AutoHeightTextarea({
  value,
  draft,
  onDraftChange,
  onCommit,
  label,
}: {
  value: string;
  draft: string;
  onDraftChange: (next: string) => void;
  onCommit: () => void;
  label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fitHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    fitHeight();
  }, [draft, value, fitHeight]);

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={1}
      onChange={(e) => {
        onDraftChange(e.target.value);
        requestAnimationFrame(fitHeight);
      }}
      onBlur={onCommit}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={CELL_FIELD}
      aria-label={label}
    />
  );
}

function TableCell({
  rowId,
  field,
  value,
  readOnly,
  onPatch,
}: {
  rowId: string;
  field: StoryboardTableColumnKey;
  value: string;
  readOnly?: boolean;
  onPatch: (rowId: string, field: StoryboardTableColumnKey, value: string) => void;
}) {
  const col = STORYBOARD_TABLE_COLUMNS.find((c) => c.key === field);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (!col) return null;

  // 只渲染单元格内容，<td> 由调用处提供；
  // 否则运镜/视频词那一列外层已有 <td>，会套出非法的 td 嵌套
  if (readOnly) {
    return (
      <span className="block px-1.5 py-1 text-[10px] tabular-nums text-white/45">{value}</span>
    );
  }

  return (
    <AutoHeightTextarea
      value={value}
      draft={draft}
      onDraftChange={setDraft}
      onCommit={() => {
        if (draft !== value) onPatch(rowId, field, draft);
      }}
      label={col.label}
    />
  );
}

function PromptGenCell({
  row,
  field,
  onRetry,
  creditCost,
  creditLoading,
  creditsEnabled,
}: {
  row: StoryboardTableRow;
  field: "cameraPrompt" | "videoPrompt";
  onRetry: (rowId: string, field: "cameraPrompt" | "videoPrompt") => void;
  creditCost: number;
  creditLoading?: boolean;
  creditsEnabled: boolean;
}) {
  if (field !== "cameraPrompt" && field !== "videoPrompt") return null;
  const status = field === "cameraPrompt" ? row.cameraPromptStatus : row.videoPromptStatus;
  const error = field === "cameraPrompt" ? row.cameraPromptError : row.videoPromptError;
  const value = field === "cameraPrompt" ? row.cameraPrompt : row.videoPrompt;
  const generating = isStoryboardGenActive(status);
  const label = field === "cameraPrompt" ? "运镜" : "视频词";

  if (generating) {
    return (
      <div className="relative min-h-[28px]">
        <div className="flex items-center gap-1 rounded border border-purple-400/50 bg-purple-500/15 px-1.5 py-1 text-[9px] font-medium text-purple-100">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          {label}生成中…
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <button
        type="button"
        className="flex items-center gap-1 px-1 py-0.5 text-[9px] text-red-300/80"
        title={`${error || "生成失败"} · ${formatCreditLabel(creditCost, creditsEnabled)}`}
        onClick={(e) => {
          e.stopPropagation();
          onRetry(row.id, field);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <RefreshCw className="h-3 w-3" />
        重试
        <CellCreditHint
          cost={creditCost}
          loading={creditLoading}
          creditsEnabled={creditsEnabled}
        />
      </button>
    );
  }

  if (!value.trim()) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] text-white/28 hover:text-white/55"
        title={`点击生成${label} · ${formatCreditLabel(creditCost, creditsEnabled)}`}
        onClick={(e) => {
          e.stopPropagation();
          onRetry(row.id, field);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        点击生成
        <CellCreditHint
          cost={creditCost}
          loading={creditLoading}
          creditsEnabled={creditsEnabled}
        />
      </button>
    );
  }

  return null;
}

export const StoryboardGridNode = memo(function StoryboardGridNode(props: NodeProps) {
  const nodeId = props.id;
  const data = props.data as WorkflowNodeData;
  const queryClient = useQueryClient();
  const projectId = useCanvasStore((s) => s.projectId);
  const nodeParams = useCanvasStore(
    useShallow((s) => s.nodes.find((n) => n.id === nodeId)?.data?.params ?? {})
  );
  const shotsParam = nodeParams.shots;
  const viewMode = (nodeParams.viewMode === "assets" ? "assets" : "shots") as StoryboardViewMode;
  const selectedRowId = String(nodeParams.selectedShotId ?? "");
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const rows = useMemo(() => parseTableRowsParam(shotsParam), [shotsParam]);
  // 整条时间线自动 reflow：任意一镜时长/生成状态变化后重新计算总时长，供表头展示
  const timeline = useMemo(() => computeShotsTimeline(rows), [rows]);
  const quoteEnabled = Boolean(projectId);
  // 单行运镜词 / 视频词与顶栏批量按钮共用同一报价缓存
  const {
    total: cameraUnitCost,
    isLoading: cameraQuoteLoading,
    creditsEnabled: cameraCreditsEnabled,
  } = useGenerationCreditQuote({
    model: STORYBOARD_TABLE_MODEL,
    category: "text",
    canvasTool: STORYBOARD_CAMERA_PROMPT_KIND,
    enabled: quoteEnabled,
  });
  const {
    total: videoUnitCost,
    isLoading: videoQuoteLoading,
    creditsEnabled: videoCreditsEnabled,
  } = useGenerationCreditQuote({
    model: STORYBOARD_TABLE_MODEL,
    category: "text",
    canvasTool: STORYBOARD_VIDEO_PROMPT_KIND,
    enabled: quoteEnabled,
  });
  const rowGenBusyRef = useRef(false);

  const tableScrollHeight = useMemo(() => {
    const nodeHeight = props.height && props.height > 0 ? props.height : 360;
    return Math.max(MIN_TABLE_SCROLL_HEIGHT, nodeHeight - NODE_TITLE_HEIGHT - TAB_BAR_HEIGHT);
  }, [props.height]);

  const persistRows = useCallback(
    (next: StoryboardTableRow[]) => {
      updateNodeParam(nodeId, "shots", reindexTableRows(next));
    },
    [nodeId, updateNodeParam]
  );

  const handleSelectRow = useCallback(
    (rowId: string) => {
      updateNodeParam(nodeId, "selectedShotId", rowId);
    },
    [nodeId, updateNodeParam]
  );

  const handlePatchCell = useCallback(
    (rowId: string, field: StoryboardTableColumnKey, value: string) => {
      const next = rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
      persistRows(next);
    },
    [rows, persistRows]
  );

  const handleRetryPrompt = useCallback(
    (rowId: string, field: "cameraPrompt" | "videoPrompt") => {
      if (rowGenBusyRef.current) return;
      rowGenBusyRef.current = true;
      void runStoryboardRowPromptGeneration({
        gridNodeId: nodeId,
        field,
        rowIds: [rowId],
        queryClient,
      }).finally(() => {
        rowGenBusyRef.current = false;
      });
    },
    [nodeId, queryClient]
  );

  const status = (data.status ?? "idle") as WorkflowNodeData["status"];

  return (
    <BaseNode
      {...props}
      data={data}
      icon="LayoutGrid"
      color="#a855f7"
      status={status}
      bodyFlush
      unboundedResize
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              updateNodeParam(nodeId, "viewMode", "shots");
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`rounded px-2 py-0.5 text-[10px] ${
              viewMode === "shots" ? "bg-purple-500/20 text-purple-200" : "text-white/40 hover:text-white/70"
            }`}
          >
            分镜表
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              updateNodeParam(nodeId, "viewMode", "assets");
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`rounded px-2 py-0.5 text-[10px] ${
              viewMode === "assets" ? "bg-purple-500/20 text-purple-200" : "text-white/40 hover:text-white/70"
            }`}
          >
            准备资产
          </button>
          <span className="ml-auto text-[10px] text-white/30">
            {viewMode === "shots"
              ? rows.length > 0
                ? `${rows.length} 行 · 总时长约 ${formatTimelineDuration(timeline.totalSec)}`
                : "添加行或提取分镜"
              : "角色 / 场景 / 道具"}
          </span>
        </div>
        {viewMode === "assets" ? (
          <StoryboardSubjectsView nodeId={nodeId} />
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-center text-[11px] leading-relaxed text-white/28">
            连接文本 / 图片 / 视频后点「提取分镜」
            <br />
            或点「添加行」手动建表
          </div>
        ) : (
          <div
            /* nowheel：滚轮滚动分镜表格，不被 React Flow 拦去缩放画布 */
            className="nowheel overflow-auto"
            style={{ maxHeight: tableScrollHeight, minHeight: EMPTY_BODY_HEIGHT }}
          >
            <table
              className="border-collapse text-left"
              style={{ minWidth: Math.max(TABLE_MIN_WIDTH, (props.width ?? 880) - 16) }}
            >
              <colgroup>
                <col style={{ width: STORYBOARD_TABLE_COLUMNS[0].width }} />
                {STORYBOARD_TABLE_COLUMNS.slice(1).map((col) => (
                  <col key={col.key} style={{ width: col.width }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-[1] bg-[rgba(18,18,28,0.98)]">
                <tr className="border-b border-white/10">
                  <th
                    scope="col"
                    className="px-1.5 py-1.5 text-left text-[9px] font-medium tracking-wide text-white/40"
                  >
                    {STORYBOARD_TABLE_COLUMNS[0].label}
                  </th>
                  {STORYBOARD_TABLE_COLUMNS.slice(1).map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className="px-1.5 py-1.5 text-left text-[9px] font-medium tracking-wide text-white/40"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selected = selectedRowId === row.id;
                  const generating = isStoryboardRowGenerating(row);
                  return (
                    <tr
                      key={row.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectRow(row.id);
                      }}
                      className={`border-b border-white/[0.05] transition-colors last:border-b-0 ${
                        generating
                          ? STORYBOARD_ROW_GENERATING_CLASS
                          : selected
                            ? "bg-purple-500/[0.08]"
                            : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <td className="align-top p-0">
                        <TableCell
                          rowId={row.id}
                          field="shotNo"
                          onPatch={handlePatchCell}
                          value={String(row.shotNo ?? "")}
                          readOnly
                        />
                      </td>
                      {STORYBOARD_TABLE_COLUMNS.slice(1).map((col) => {
                        const isPromptCol =
                          col.key === "cameraPrompt" || col.key === "videoPrompt";
                        const promptStatus =
                          col.key === "cameraPrompt"
                            ? row.cameraPromptStatus
                            : col.key === "videoPrompt"
                              ? row.videoPromptStatus
                              : undefined;
                        const promptGenerating =
                          isPromptCol && isStoryboardGenActive(promptStatus);
                        return (
                          <td key={col.key} className="align-top p-0">
                            {isPromptCol && (
                              <PromptGenCell
                                row={row}
                                field={col.key}
                                onRetry={handleRetryPrompt}
                                creditCost={
                                  col.key === "cameraPrompt" ? cameraUnitCost : videoUnitCost
                                }
                                creditLoading={
                                  col.key === "cameraPrompt"
                                    ? cameraQuoteLoading
                                    : videoQuoteLoading
                                }
                                creditsEnabled={
                                  col.key === "cameraPrompt"
                                    ? cameraCreditsEnabled
                                    : videoCreditsEnabled
                                }
                              />
                            )}
                            {!promptGenerating && (
                              <TableCell
                                rowId={row.id}
                                field={col.key}
                                onPatch={handlePatchCell}
                                value={String(row[col.key] ?? "")}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </BaseNode>
  );
});
