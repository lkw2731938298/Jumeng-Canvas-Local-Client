"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdgeLabelRenderer } from "@xyflow/react";
import { Clapperboard, Copy, ImageIcon, Loader2, Plus, RefreshCw, Sparkles, Trash2, Video, Zap } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSelectedCanvasNode } from "@/lib/canvas/useSelectedCanvasNode";
import { listModels } from "@/lib/api/models";
import { resolveNodeSizeUnbounded } from "@/lib/canvas/nodeSizing";
import {
  buildCanvasOverlayStyle,
  CANVAS_STORYBOARD_TOP_MENU_MAX_WIDTH,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import {
  mergeTableRowsPreservingIds,
  parseStoryboardTableContent,
} from "@/lib/canvas/parseStoryboardTable";
import {
  mergeSubjectsPreservingIds,
  parseStoryboardSubjectsContent,
} from "@/lib/canvas/parseStoryboardSubjects";
import {
  detectStoryboardUpstreamKind,
  resolveStoryboardUpstream,
} from "@/lib/canvas/resolveUpstreamStoryboard";
import {
  describePromptGenerationSkip,
  filterRowsForPromptGeneration,
} from "@/lib/canvas/storyboardPromptBatch";
import {
  runStoryboardOneClickGeneration,
  runStoryboardRowPromptGeneration,
  readStoryboardGridContext,
} from "@/lib/canvas/storyboardGridActions";
import {
  collectSubjectImageTargets,
  runStoryboardSubjectImageBatch,
} from "@/lib/canvas/storyboardSubjectImageBatch";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import { mediaVisualStyleId } from "@/lib/canvas/storyboardVisualStyle";
import { runVideoStoryboardParseIntoGrid } from "@/lib/canvas/videoStoryboardParse";
import {
  runImageStoryboardParseIntoGrid,
} from "@/lib/canvas/storyboardImageParse";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { formatCreditLabel, getCreditQuote } from "@/lib/api/credits";
import { invalidateCanvasCreditQueries, useCanvasStoreCreditBalance, useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import {
  handleCollaboratorSpendCapError,
  isPricingChangedError,
  toastCreditCharged,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import {
  STORYBOARD_SKETCH_MODEL,
  STORYBOARD_TABLE_MODEL,
  STORYBOARD_TABLE_PROMPT_KIND,
  createEmptyTableRow,
  newTableRowId,
  parseTableRowsParam,
  reindexTableRows,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import {
  STORYBOARD_SUBJECT_PROMPT_KIND,
  computeSubjectImageSourceHash,
  countSubjects,
  createEmptySubject,
  parseSubjectsParam,
  subjectKindToKey,
  type StoryboardSubjectItem,
  type StoryboardSubjectKind,
  type StoryboardSubjectsBundle,
  type StoryboardViewMode,
} from "@/types/storyboard-subjects";
import type { WorkflowNodeData } from "@/types/workflow";

const OVERLAY_STYLE = {
  background: "rgba(18, 18, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(139, 92, 246, 0.35)",
} as const;

function resolveSubjectKind(params: Record<string, unknown>): StoryboardSubjectKind {
  const raw = params.subjectKind;
  return raw === "scene" || raw === "prop" ? raw : "role";
}

function resolveViewMode(params: Record<string, unknown>): StoryboardViewMode {
  return params.viewMode === "assets" ? "assets" : "shots";
}

/** 顶栏算力：闪电图标 + 数字（与节点底栏一致）；完整文案放 title */
function StoryboardCreditCost({
  cost,
  loading,
  creditsEnabled,
  className,
}: {
  cost: number;
  loading?: boolean;
  creditsEnabled: boolean;
  className?: string;
}) {
  const label = loading ? "…" : formatCreditLabel(cost, creditsEnabled);
  const display = loading ? "…" : cost > 0 ? String(cost) : "—";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums text-white/40 ${className ?? ""}`}
      title={label}
    >
      {/* 算力闪电图标用主题紫，与节点底栏一致；数字仍跟父级灰白 */}
      <Zap className="size-3 fill-current text-primary" aria-hidden />
      <span>{display}</span>
    </span>
  );
}

export function StoryboardGridTopMenuOverlay() {
  const queryClient = useQueryClient();
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const isCanvasDragging = useCanvasStore((s) => s.isCanvasDragging);
  const multiAngleNodeId = useCanvasStore((s) => s.multiAngleNodeId);
  const drawingBoardNodeId = useCanvasStore((s) => s.drawingBoardNodeId);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const viewportZoom = useCanvasStore((s) => s.viewport.zoom);
  const allNodes = useCanvasStore((s) => s.nodes);
  const node = useSelectedCanvasNode();
  const [parsing, setParsing] = useState(false);
  const [batchBusy, setBatchBusy] = useState<
    "camera" | "video" | "subject" | "all" | null
  >(null);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [allStage, setAllStage] = useState<"camera" | "video" | null>(null);
  const batchRef = useRef(0);

  const isGridNode = node?.type === "storyboard_grid";
  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  const viewMode = resolveViewMode(params);
  const rows = parseTableRowsParam(params.shots);
  const subjects = parseSubjectsParam(params.subjects);
  const subjectKind = resolveSubjectKind(params);
  const selectedSubjectId = String(params.selectedSubjectId ?? "");
  const selectedRowId = String(params.selectedShotId ?? "");

  // 提取分镜：按上游类型切换报价（文本 / 图片 / 视频）
  const upstreamKind = useMemo(() => {
    if (!selectedNodeId || !isGridNode) return "none" as const;
    return detectStoryboardUpstreamKind(selectedNodeId, edges, allNodes);
  }, [selectedNodeId, isGridNode, edges, allNodes]);

  const storyboardQuoteEnabled = Boolean(selectedNodeId && projectId && isGridNode);
  // 准备资产 · 主体生图：走设置页「画布工具」配置，不再写死 doubao_image
  const subjectImageTool = useCanvasToolConfiguredModel(
    "storyboard_subject_image",
    storyboardQuoteEnabled,
    "image",
    { size: "1x1" }
  );
  const subjectImageModel = subjectImageTool.modelName;
  const subjectImageModelMeta = subjectImageTool.selectedModel;
  // 预扣价跟随「功能模型切换」主模型，不再写死 doubao_pro
  const parseTableQuote = useCanvasToolConfiguredModel(
    "storyboard_table",
    storyboardQuoteEnabled,
    "text"
  );
  const parseVideoQuote = useCanvasToolConfiguredModel(
    "storyboard_from_video",
    storyboardQuoteEnabled && upstreamKind === "video",
    "text"
  );
  const parseImageQuote = useCanvasToolConfiguredModel(
    "storyboard_from_image",
    storyboardQuoteEnabled && upstreamKind === "image",
    "text"
  );
  const subjectExtractQuote = useCanvasToolConfiguredModel(
    "text_subject",
    storyboardQuoteEnabled && upstreamKind === "text",
    "text"
  );
  const cameraQuote = useCanvasToolConfiguredModel(
    "storyboard_camera",
    storyboardQuoteEnabled,
    "text"
  );
  const videoPromptQuote = useCanvasToolConfiguredModel(
    "storyboard_video",
    storyboardQuoteEnabled,
    "text"
  );
  const parseQuote =
    upstreamKind === "video"
      ? parseVideoQuote
      : upstreamKind === "image"
        ? parseImageQuote
        : parseTableQuote;
  const quoteToken = parseQuote.quoteToken;
  const creditTotal = parseQuote.total;
  const creditsEnabled = parseQuote.creditsEnabled;
  const quoteLoading = parseQuote.isLoading;
  const refetchQuote = parseQuote.refetch;
  const subjectExtractCost = subjectExtractQuote.total;
  const subjectExtractLoading = subjectExtractQuote.isLoading;
  const cameraUnitCost = cameraQuote.total;
  const cameraQuoteLoading = cameraQuote.isLoading;
  const videoUnitCost = videoPromptQuote.total;
  const videoQuoteLoading = videoPromptQuote.isLoading;

  const subjectImageUnitCost = subjectImageTool.total;
  const subjectImageQuoteLoading = subjectImageTool.isLoading;

  const { data: creditBalanceData } = useCanvasStoreCreditBalance();
  // 文本路径：分镜表 + 主体提取；图/视频路径：单工具价
  const parseEstimate =
    upstreamKind === "text" ? creditTotal + subjectExtractCost : creditTotal;
  const insufficientParseCredits =
    creditsEnabled &&
    parseEstimate > 0 &&
    creditBalanceData?.balance != null &&
    creditBalanceData.balance < parseEstimate;

  const parseCreditLabel =
    quoteLoading || (upstreamKind === "text" && subjectExtractLoading)
      ? "…"
      : formatCreditLabel(parseEstimate, creditsEnabled);

  const parseTitleHint =
    upstreamKind === "video"
      ? "从上游视频切镜并提取分镜"
      : upstreamKind === "image"
        ? "从上游图片提取分镜"
        : upstreamKind === "text"
          ? "从上游剧本提取分镜"
          : "连接文本 / 图片 / 视频节点后提取分镜";

  // 一键生成始终全表，不跟选中行走（草图已移出一键流程，仅统计运镜/视频词）
  const oneClickCameraCount = useMemo(
    () => filterRowsForPromptGeneration(rows, "cameraPrompt").length,
    [rows]
  );
  // 一键会先跑运镜，视频词按「即将具备运镜」的行数预估
  const oneClickVideoCount = useMemo(() => {
    const ready = filterRowsForPromptGeneration(rows, "videoPrompt").length;
    const afterCamera = filterRowsForPromptGeneration(rows, "cameraPrompt").length;
    return Math.max(ready, afterCamera);
  }, [rows]);

  const cameraBatchCount = useMemo(
    () =>
      filterRowsForPromptGeneration(
        rows,
        "cameraPrompt",
        selectedRowId ? [selectedRowId] : undefined
      ).length,
    [rows, selectedRowId]
  );

  const videoBatchCount = useMemo(
    () =>
      filterRowsForPromptGeneration(
        rows,
        "videoPrompt",
        selectedRowId ? [selectedRowId] : undefined
      ).length,
    [rows, selectedRowId]
  );

  const subjectBatchCount = useMemo(() => {
    if (selectedSubjectId) return 1;
    return collectSubjectImageTargets(subjects).length;
  }, [subjects, selectedSubjectId]);

  const cameraBatchCost =
    cameraBatchCount === 0 ? cameraUnitCost : cameraUnitCost * cameraBatchCount;
  const videoBatchCost =
    videoBatchCount === 0 ? videoUnitCost : videoUnitCost * videoBatchCount;
  const subjectImageBatchCost =
    subjectBatchCount === 0 ? subjectImageUnitCost : subjectImageUnitCost * subjectBatchCount;

  // 一键生成预估：运镜+视频词全表待提交量之和（草图不再计入）
  const oneClickEstimate =
    cameraUnitCost * oneClickCameraCount + videoUnitCost * oneClickVideoCount;
  const oneClickHasWork = oneClickCameraCount + oneClickVideoCount > 0;

  const patchNodeParams = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === selectedNodeId);
      const currentParams = (currentNode?.data as WorkflowNodeData | undefined)?.params ?? {};
      useCanvasStore.getState().updateNodeData(selectedNodeId, {
        params: { ...currentParams, ...patch },
      });
    },
    [selectedNodeId]
  );

  const applyRows = useCallback(
    (nextRows: StoryboardTableRow[], sourceNodeId?: string | null) => {
      if (!selectedNodeId) return;
      const indexed = reindexTableRows(nextRows);
      const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === selectedNodeId);
      const currentParams = (currentNode?.data as WorkflowNodeData | undefined)?.params ?? {};
      const nextParams: Record<string, unknown> = { ...currentParams, shots: indexed };
      if (sourceNodeId) nextParams.sourceNodeId = sourceNodeId;
      if (indexed.length > 0 && !indexed.some((r) => r.id === selectedRowId)) {
        nextParams.selectedShotId = indexed[0].id;
      }
      useCanvasStore.getState().updateNodeData(selectedNodeId, { params: nextParams });
    },
    [selectedNodeId, selectedRowId]
  );

  const applySubjects = useCallback(
    (nextSubjects: StoryboardSubjectsBundle) => {
      patchNodeParams({ subjects: nextSubjects });
    },
    [patchNodeParams]
  );

  const patchSubjectById = useCallback(
    (subjectId: string, patch: Partial<StoryboardSubjectItem>) => {
      if (!selectedNodeId) return;
      const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === selectedNodeId);
      const current = parseSubjectsParam(
        (currentNode?.data as WorkflowNodeData | undefined)?.params?.subjects
      );
      const keys: (keyof StoryboardSubjectsBundle)[] = ["roles", "scenes", "props"];
      for (const key of keys) {
        if (!current[key].some((item) => item.id === subjectId)) continue;
        applySubjects({
          ...current,
          [key]: current[key].map((item) => (item.id === subjectId ? { ...item, ...patch } : item)),
        });
        return;
      }
    },
    [selectedNodeId, applySubjects]
  );

  const targetRowIds = useCallback((): string[] | undefined => {
    if (selectedRowId) return [selectedRowId];
    return undefined;
  }, [selectedRowId]);

  const runPromptBatch = useCallback(
    async (field: "cameraPrompt" | "videoPrompt", rowIds?: string[]) => {
      if (!selectedNodeId || batchBusy) return;
      const targets = filterRowsForPromptGeneration(rows, field, rowIds);
      if (targets.length === 0) {
        if (rowIds?.length === 1) {
          const row = rows.find((item) => item.id === rowIds[0]);
          toast.error(
            row ? describePromptGenerationSkip(row, field) ?? "无法生成" : "未找到对应分镜行"
          );
        } else {
          toast.message(
            field === "videoPrompt"
              ? "没有可生成的视频词（需先有画面描述；批量生成需已有运镜词）"
              : "没有可生成的运镜词（请先填写画面描述）"
          );
        }
        return;
      }

      const batchId = (batchRef.current += 1);
      setBatchBusy(field === "cameraPrompt" ? "camera" : "video");
      setBatchProgress({ done: 0, total: targets.length });

      try {
        await runStoryboardRowPromptGeneration({
          gridNodeId: selectedNodeId,
          field,
          rowIds,
          queryClient,
          onProgress: (done, total) => {
            if (batchRef.current === batchId) setBatchProgress({ done, total });
          },
        });
      } finally {
        if (batchRef.current === batchId) {
          setBatchBusy(null);
          setBatchProgress({ done: 0, total: 0 });
        }
      }
    },
    [selectedNodeId, batchBusy, rows, queryClient]
  );

  /** 一键生成：全表草图 → 运镜 → 视频词，不受当前选中行限制 */
  const runOneClickAll = useCallback(async () => {
    if (!selectedNodeId || batchBusy) return;
    if (!oneClickHasWork) {
      toast.message("没有可提交的任务（请先填写画面描述）");
      return;
    }
    const batchId = (batchRef.current += 1);
    setBatchBusy("all");
    setAllStage("camera");
    setBatchProgress({ done: 0, total: 0 });
    try {
      await runStoryboardOneClickGeneration({
        gridNodeId: selectedNodeId,
        queryClient,
        onStage: (stage, done, total) => {
          if (batchRef.current !== batchId) return;
          // 一键流程只剩运镜词 / 视频词两段，草图阶段已移除
          if (stage === "camera" || stage === "video") setAllStage(stage);
          setBatchProgress({ done, total });
        },
      });
    } finally {
      if (batchRef.current === batchId) {
        setBatchBusy(null);
        setAllStage(null);
        setBatchProgress({ done: 0, total: 0 });
      }
    }
  }, [selectedNodeId, batchBusy, oneClickHasWork, queryClient]);

  const runSubjectImages = useCallback(
    async (
      bundle: StoryboardSubjectsBundle,
      kind: StoryboardSubjectKind | undefined,
      subjectIds?: string[],
      force = false
    ) => {
      if (!selectedNodeId || !projectId || batchBusy) return;
      const forceIds = force && subjectIds?.length ? new Set(subjectIds) : undefined;
      const targets = collectSubjectImageTargets(bundle, kind, subjectIds, forceIds);
      if (targets.length === 0) {
        toast.message("没有需要生成的主体图");
        return;
      }

      const batchId = (batchRef.current += 1);
      setBatchBusy("subject");
      setBatchProgress({ done: 0, total: targets.length });
      const sequential = !subjectIds?.length;
      let failed = 0;

      try {
        await runStoryboardSubjectImageBatch({
          projectId,
          gridNodeId: selectedNodeId,
          workflowId: workflowId ?? undefined,
          subjects: bundle,
          kind,
          targetSubjectIds: subjectIds,
          model: subjectImageModel,
          imageModel: subjectImageModelMeta ?? undefined,
          visualStyleId: mediaVisualStyleId(String(params.visualStyleId ?? "")),
          concurrency: sequential ? 1 : 3,
          onItemStart: (subjectId) => {
            patchSubjectById(subjectId, { imageStatus: "running", imageError: undefined });
          },
          onItemDone: (subjectId, assetId, itemKind) => {
            const key = subjectKindToKey(itemKind);
            const item = bundle[key].find((entry) => entry.id === subjectId);
            if (!item) {
              patchSubjectById(subjectId, {
                imageAssetId: assetId,
                imageStatus: "succeeded",
                imageError: undefined,
              });
              return;
            }
            patchSubjectById(subjectId, {
              imageAssetId: assetId,
              imageStatus: "succeeded",
              imageError: undefined,
              imageSourceHash: computeSubjectImageSourceHash(item, itemKind),
            });
          },
          onItemFail: (subjectId, error) => {
            patchSubjectById(subjectId, { imageStatus: "failed", imageError: error });
            // 失败原因原来只挂在重试按钮的 title 上，用户看不到；直接弹出来
            const target = targets.find((t) => t.item.id === subjectId);
            const name = target?.item.name.trim() || "主体";
            toast.error(`「${name}」主体图未提交：${error}`, { duration: 10_000 });
            failed += 1;
          },
          onProgress: (done, total) => {
            if (batchRef.current === batchId) setBatchProgress({ done, total });
          },
        });
        if (batchRef.current === batchId && failed === 0) toast.success("主体图生成完成");
        if (batchRef.current === batchId && failed > 0) {
          toast.error(`主体图 ${failed}/${targets.length} 个未生成，点缩略图上的「重试」可重来`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "主体图生成失败");
      } finally {
        if (batchRef.current === batchId) {
          setBatchBusy(null);
          setBatchProgress({ done: 0, total: 0 });
          void invalidateCanvasCreditQueries(queryClient, projectId);
        }
      }
    },
    [
      selectedNodeId,
      projectId,
      batchBusy,
      workflowId,
      subjectImageModel,
      subjectImageModelMeta,
      patchSubjectById,
      queryClient,
      params.visualStyleId,
    ]
  );

  // 开源本地版：提取分镜不再弹「选择视觉风格」，直接跑解析
  const handleParse = useCallback(async () => {
    if (!selectedNodeId || !projectId || parsing) return;
    if (insufficientParseCredits) {
      toast.error("算力不足，无法提取分镜");
      return;
    }

    setParsing(true);
    try {
      const nodes = useCanvasStore.getState().nodes;
      const upstream = await resolveStoryboardUpstream(
        projectId,
        selectedNodeId,
        edges,
        nodes
      );

      // —— 视频：切镜 + storyboard_from_video ——
      if (upstream.kind === "video") {
        const video = upstream.videos[0]!;
        const videoNode = nodes.find((n) => n.id === video.nodeId);
        const videoParams =
          (videoNode?.data as WorkflowNodeData | undefined)?.params ?? {};
        let videoFileUrl = video.fileUrl;
        try {
          videoFileUrl =
            (await resolveNodeMediaUrl(projectId, videoParams, "videoUrl")) || videoFileUrl;
        } catch {
          /* 用节点内 URL */
        }
        const result = await runVideoStoryboardParseIntoGrid({
          projectId,
          gridNodeId: selectedNodeId,
          videoNodeId: video.nodeId,
          videoAssetId: video.assetId,
          videoFileUrl,
          videoParams,
          toastSuccess: false,
        });
        toast.success(`已从视频解析 ${result.shotCount} 行分镜`);
        return;
      }

      // —— 图片：多模态 storyboard_from_image ——
      if (upstream.kind === "image") {
        const result = await runImageStoryboardParseIntoGrid({
          projectId,
          gridNodeId: selectedNodeId,
          images: upstream.images,
        });
        toast.success(`已从图片解析 ${result.shotCount} 行分镜`);
        return;
      }

      // —— 文本：storyboard_table + text_subject ——
      if (upstream.kind !== "text" || !upstream.textContent.trim()) {
        toast.error("请先将文本、图片或视频节点连接到本分镜表");
        return;
      }

      const script = upstream.textContent.trim();
      const tableResult = await runStoryboardTextJob({
        projectId,
        nodeId: `${selectedNodeId}::parse-table`,
        workflowId: workflowId ?? undefined,
        content: script,
        model: parseTableQuote.modelName || STORYBOARD_TABLE_MODEL,
        textPromptKind: STORYBOARD_TABLE_PROMPT_KIND,
        canvasTool: "storyboard_table",
        quoteToken: quoteToken ?? undefined,
        idempotencySuffix: "parse-table",
      });
      toastCreditCharged(tableResult.creditCost, creditsEnabled);

      const parsed = parseStoryboardTableContent(tableResult.text);
      if (parsed.rows.length === 0) {
        toast.error(parsed.warnings[0] ?? "分镜表解析失败");
        return;
      }

      const merged = mergeTableRowsPreservingIds(rows, parsed.rows);
      applyRows(merged, upstream.textSourceNodeId);

      let subjectQuoteToken: string | undefined;
      try {
        const subjectQuote = await getCreditQuote({
          model: subjectExtractQuote.modelName || STORYBOARD_TABLE_MODEL,
          category: "text",
          canvasTool: "text_subject",
        });
        subjectQuoteToken = subjectQuote.quoteToken;
      } catch {
        /* optional */
      }

      const subjectResult = await runStoryboardTextJob({
        projectId,
        nodeId: `${selectedNodeId}::parse-subjects`,
        workflowId: workflowId ?? undefined,
        content: script,
        model: subjectExtractQuote.modelName || STORYBOARD_TABLE_MODEL,
        textPromptKind: STORYBOARD_SUBJECT_PROMPT_KIND,
        canvasTool: "text_subject",
        quoteToken: subjectQuoteToken,
        idempotencySuffix: "parse-subjects",
      });
      toastCreditCharged(subjectResult.creditCost, creditsEnabled);

      const subjectParsed = parseStoryboardSubjectsContent(subjectResult.text);
      const mergedSubjects = mergeSubjectsPreservingIds(subjects, subjectParsed.subjects);
      applySubjects(mergedSubjects);

      const counts = countSubjects(mergedSubjects);
      toast.success(
        `已解析 ${merged.length} 行分镜；主体 角色${counts.roles} / 场景${counts.scenes} / 道具${counts.props}`
      );
      if (parsed.warnings.length) toast.message(parsed.warnings.join("；"));
      if (subjectParsed.warnings.length) toast.message(subjectParsed.warnings.join("；"));

      patchNodeParams({ viewMode: "shots" });
    } catch (err) {
      if (isPricingChangedError(err)) {
        toastPricingChanged(() => void refetchQuote());
        return;
      }
      if (handleCollaboratorSpendCapError(err)) return;
      toast.error(err instanceof Error ? err.message : "提取分镜失败");
    } finally {
      setParsing(false);
      void invalidateCanvasCreditQueries(queryClient, projectId);
    }
  }, [
    selectedNodeId,
    projectId,
    parsing,
    edges,
    workflowId,
    rows,
    subjects,
    applyRows,
    applySubjects,
    patchNodeParams,
    insufficientParseCredits,
    quoteToken,
    creditsEnabled,
    refetchQuote,
    queryClient,
  ]);

  const handleAddRow = useCallback(() => {
    if (!selectedNodeId) return;
    applyRows([...rows, createEmptyTableRow(rows.length + 1)]);
  }, [selectedNodeId, rows, applyRows]);

  const handleDuplicateRow = useCallback(() => {
    if (!selectedNodeId || !selectedRowId) {
      toast.message("请先选中一行");
      return;
    }
    const source = rows.find((r) => r.id === selectedRowId);
    if (!source) return;
    const copy: StoryboardTableRow = {
      ...source,
      id: newTableRowId(),
      index: rows.length + 1,
      shotNo: String(rows.length + 1),
      sketchAssetId: undefined,
      sketchStatus: "idle",
      sketchError: undefined,
    };
    const idx = rows.findIndex((r) => r.id === selectedRowId);
    applyRows([...rows.slice(0, idx + 1), copy, ...rows.slice(idx + 1)]);
  }, [selectedNodeId, selectedRowId, rows, applyRows]);

  const handleDeleteRow = useCallback(() => {
    if (!selectedNodeId || rows.length === 0) return;
    if (!selectedRowId) {
      applyRows(rows.slice(0, -1));
      return;
    }
    applyRows(rows.filter((r) => r.id !== selectedRowId));
  }, [selectedNodeId, selectedRowId, rows, applyRows]);

  const subjectImageRetryId = String(params.subjectImageRetryId ?? "");

  useEffect(() => {
    if (!subjectImageRetryId || !selectedNodeId || batchBusy) return;
    updateNodeParam(selectedNodeId, "subjectImageRetryId", "");
    void runSubjectImages(
      subjects,
      selectedSubjectId ? subjectKind : undefined,
      selectedSubjectId ? [selectedSubjectId] : undefined,
      Boolean(selectedSubjectId)
    );
  }, [
    subjectImageRetryId,
    selectedNodeId,
    batchBusy,
    subjects,
    subjectKind,
    selectedSubjectId,
    updateNodeParam,
    runSubjectImages,
  ]);

  if (!selectedNodeId || !isGridNode || !node) return null;
  // 节点拖动中隐藏分镜表顶栏，与图片/视频节点一致
  if (isCanvasDragging) return null;
  if (multiAngleNodeId && multiAngleNodeId === selectedNodeId) return null;
  if (drawingBoardNodeId) return null;

  // 分镜表可超宽，须用无界尺寸取中心，避免限宽 640 导致顶栏偏左
  const { width } = resolveNodeSizeUnbounded(node.width, node.height);
  const world = getNodeWorldPosition(node, allNodes);
  const anchorX = world.x + width / 2;
  const anchorY = world.y - 10;
  const overlayStyle = buildCanvasOverlayStyle(anchorX, anchorY, viewportZoom, "above", {
    maxWidth: CANVAS_STORYBOARD_TOP_MENU_MAX_WIDTH,
    width: "max-content",
    ...OVERLAY_STYLE,
  });

  const busy = parsing || Boolean(batchBusy);
  const parseButtonLabel = parsing
    ? "提取中…"
    : batchBusy === "all"
      ? `${allStage === "video" ? "视频词" : "运镜"} ${batchProgress.done}/${batchProgress.total || "…"}…`
      : batchBusy === "camera"
          ? `运镜 ${batchProgress.done}/${batchProgress.total}…`
          : batchBusy === "video"
            ? `视频词 ${batchProgress.done}/${batchProgress.total}…`
            : batchBusy === "subject"
              ? `主体图 ${batchProgress.done}/${batchProgress.total}…`
              : "提取分镜";

  return (
    <>
    <EdgeLabelRenderer>
      <div
        className="nodrag nopan pointer-events-auto flex flex-nowrap items-center gap-0.5 rounded-xl px-1.5 py-1 shadow-2xl whitespace-nowrap"
        style={overlayStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          disabled={busy || insufficientParseCredits}
          onClick={() => void handleParse()}
          title={busy ? parseButtonLabel : `${parseTitleHint} · ${parseCreditLabel}`}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <RefreshCw className="h-3 w-3 shrink-0" />}
          {parseButtonLabel}
          {!busy ? (
            <StoryboardCreditCost
              cost={parseEstimate}
              loading={quoteLoading || subjectExtractLoading}
              creditsEnabled={creditsEnabled}
            />
          ) : null}
        </button>

        {viewMode === "shots" ? (
          <>
            <button
              type="button"
              disabled={busy || rows.length === 0 || !oneClickHasWork}
              onClick={() => void runOneClickAll()}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-violet-200/90 transition-colors hover:bg-violet-500/20 hover:text-violet-100 disabled:opacity-50"
              title={`按序提交：运镜词 → 视频词 · ${formatCreditLabel(oneClickEstimate, creditsEnabled)}`}
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              批量生成
              <StoryboardCreditCost
                cost={oneClickEstimate}
                loading={cameraQuoteLoading || videoQuoteLoading}
                creditsEnabled={creditsEnabled}
              />
            </button>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              onClick={() => void runPromptBatch("cameraPrompt", targetRowIds())}
              title={formatCreditLabel(cameraBatchCost, creditsEnabled)}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <Clapperboard className="h-3 w-3 shrink-0" />
              {selectedRowId ? "生成运镜" : "全部运镜"}
              <StoryboardCreditCost
                cost={cameraBatchCost}
                loading={cameraQuoteLoading}
                creditsEnabled={creditsEnabled}
              />
            </button>
            <button
              type="button"
              disabled={busy || rows.length === 0}
              onClick={() => void runPromptBatch("videoPrompt", targetRowIds())}
              title={formatCreditLabel(videoBatchCost, creditsEnabled)}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <Video className="h-3 w-3 shrink-0" />
              {selectedRowId ? "生成视频词" : "全部视频词"}
              <StoryboardCreditCost
                cost={videoBatchCost}
                loading={videoQuoteLoading}
                creditsEnabled={creditsEnabled}
              />
            </button>
            <button type="button" onClick={handleAddRow} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
              <Plus className="h-3 w-3 shrink-0" />
              添加行
            </button>
            <button type="button" onClick={handleDuplicateRow} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
              <Copy className="h-3 w-3 shrink-0" />
              复制行
            </button>
            <button type="button" onClick={handleDeleteRow} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
              <Trash2 className="h-3 w-3 shrink-0" />
              删除行
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || collectSubjectImageTargets(subjects).length === 0}
              onClick={() =>
                void runSubjectImages(
                  subjects,
                  selectedSubjectId ? subjectKind : undefined,
                  selectedSubjectId ? [selectedSubjectId] : undefined,
                  Boolean(selectedSubjectId)
                )
              }
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <ImageIcon className="h-3 w-3 shrink-0" />
              {selectedSubjectId ? "生成主体图" : "全部主体图（按序）"}
              <StoryboardCreditCost
                cost={subjectImageBatchCost}
                loading={subjectImageQuoteLoading}
                creditsEnabled={creditsEnabled}
              />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const kind =
                  params.subjectKind === "scene" ? "scene" : params.subjectKind === "prop" ? "prop" : "role";
                const key = kind === "role" ? "roles" : kind === "scene" ? "scenes" : "props";
                const item = createEmptySubject(
                  `${kind === "role" ? "角色" : kind === "scene" ? "场景" : "道具"}${subjects[key].length + 1}`
                );
                applySubjects({ ...subjects, [key]: [...subjects[key], item] });
                patchNodeParams({ selectedSubjectId: item.id, subjectKind: kind });
              }}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <Plus className="h-3 w-3 shrink-0" />
              添加主体
            </button>
          </>
        )}
      </div>
    </EdgeLabelRenderer>
    </>
  );
}
