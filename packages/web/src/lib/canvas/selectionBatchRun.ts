/**
 * 框选 / 选组 → 批量生成编排：
 * 拓扑分层 → 层内串行提交（避开用户 generation_submit_lock）→ 层内并行轮询 → 层屏障。
 */
import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import {
  getCreditBalance,
  postCreditQuotesBatch,
  type CreditQuote,
} from "@/lib/api/credits";
import { getProjectBillingBalance } from "@/lib/api/projects";
import {
  clearBatchModelCache,
  completePendingGeneratableNode,
  previewNodeRunnable,
  runOneGeneratableNode,
} from "@/lib/canvas/runOneGeneratableNode";
import {
  collectGroupSubtree,
  isGroupNode,
  type AppNode,
} from "@/lib/canvas/nodeGroup";
import { isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import { useCanvasStore, type BatchRunProgress } from "@/stores/canvasStore";
import type { Edge } from "@xyflow/react";

const SUBMIT_9201_RETRIES = 3;
const SUBMIT_RETRY_BACKOFF_MS = [100, 200, 400];

type PendingSlot = {
  nodeId: string;
  jobId: number | string;
  kind: "text" | "media";
  model: string;
  nodeType: string;
};

export interface ResolveRunTargetsResult {
  targetIds: string[];
  cycle: boolean;
  layers: string[][];
}

/** 展开选中：组 → 子树成员；去重；去掉组框本身 */
export function expandSelectionToMemberIds(
  selectedFlowIds: string[],
  nodes: AppNode[]
): string[] {
  const out = new Set<string>();
  for (const id of selectedFlowIds) {
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    if (isGroupNode(node)) {
      for (const m of collectGroupSubtree(id, nodes)) {
        if (!isGroupNode(m)) out.add(m.id);
      }
      continue;
    }
    out.add(id);
  }
  return [...out];
}

/** Kahn 分层；仅使用两端都在目标集内的边 */
export function buildTopoLayers(
  targetIds: string[],
  edges: Edge[]
): { layers: string[][]; cycle: boolean } {
  const idSet = new Set(targetIds);
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of targetIds) {
    indeg.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (e.source === e.target) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const layers: string[][] = [];
  let frontier = targetIds.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  let seen = 0;
  while (frontier.length > 0) {
    layers.push(frontier);
    seen += frontier.length;
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        const d = (indeg.get(v) ?? 0) - 1;
        indeg.set(v, d);
        if (d === 0) next.push(v);
      }
    }
    frontier = next.sort();
  }
  return { layers, cycle: seen !== targetIds.length };
}

export function resolveRunTargets(
  selectedFlowIds: string[],
  nodes: AppNode[],
  edges: Edge[]
): ResolveRunTargetsResult {
  const expanded = expandSelectionToMemberIds(selectedFlowIds, nodes);
  const targetIds = expanded.filter((id) => {
    const n = nodes.find((x) => x.id === id);
    return isEditorNodeType(n?.type);
  });
  if (targetIds.length === 0) {
    return { targetIds: [], cycle: false, layers: [] };
  }
  const { layers, cycle } = buildTopoLayers(targetIds, edges);
  return { targetIds, cycle, layers };
}

/** 快速统计选中里大致可跑的编辑器节点数（不含模型/提示词预检） */
export function countLikelyRunnableSelection(
  selectedFlowIds: string[],
  nodes: AppNode[]
): number {
  return expandSelectionToMemberIds(selectedFlowIds, nodes).filter((id) =>
    isEditorNodeType(nodes.find((n) => n.id === id)?.type)
  ).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function emptyProgress(total: number): BatchRunProgress {
  return {
    total,
    submitted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    currentSubmitNodeId: null,
  };
}

function patchProgress(partial: Partial<BatchRunProgress>): void {
  const cur = useCanvasStore.getState().batchRunProgress;
  if (!cur) return;
  useCanvasStore.getState().setBatchRunProgress({ ...cur, ...partial });
}

function bump(
  field: "submitted" | "succeeded" | "failed" | "skipped",
  extra?: Partial<BatchRunProgress>
): void {
  const cur = useCanvasStore.getState().batchRunProgress;
  if (!cur) return;
  useCanvasStore.getState().setBatchRunProgress({
    ...cur,
    [field]: cur[field] + 1,
    ...extra,
  });
}

async function resolveAvailableCredits(projectId: string): Promise<number | null> {
  const role = useCanvasStore.getState().projectRole;
  try {
    if (role === "editor") {
      const bal = await getProjectBillingBalance(projectId);
      if (bal.creditsEnabled === false) return null;
      return bal.balance ?? 0;
    }
    const bal = await getCreditBalance();
    if (bal.creditsEnabled === false) return null;
    return bal.balance ?? 0;
  } catch {
    return null;
  }
}

async function submitWithRetry(
  projectId: string,
  nodeId: string,
  batchId: string,
  quoteToken?: string
): Promise<
  | { ok: true; pending?: PendingSlot }
  | { ok: false; error: string; abortBatch?: boolean }
> {
  for (let attempt = 0; attempt < SUBMIT_9201_RETRIES; attempt++) {
    if (useCanvasStore.getState().batchRunCancelRequested) {
      return { ok: false, error: "已取消" };
    }
    const result = await runOneGeneratableNode({
      projectId,
      nodeId,
      batchId,
      quoteToken,
      deferPoll: true,
    });
    if (result.ok) {
      if (result.pending) {
        return {
          ok: true,
          pending: { nodeId, ...result.pending },
        };
      }
      return { ok: true };
    }
    if (result.abortBatch) return result;
    const isBusy =
      result.code === "RATE_LIMITED" ||
      (typeof result.error === "string" && result.error.includes("生成提交处理中"));
    if (isBusy && attempt < SUBMIT_9201_RETRIES - 1) {
      await sleep(SUBMIT_RETRY_BACKOFF_MS[attempt] ?? 400);
      continue;
    }
    return result;
  }
  return { ok: false, error: "提交过于频繁" };
}

/**
 * 右上角「运行」入口：框选多节点或选中组后批量生成。
 * 提交串行、依赖分层；预检合计算力不足则整批拦截。
 */
export async function runSelectionBatch(options?: {
  selectedFlowIds?: string[];
  skipConfirm?: boolean;
}): Promise<void> {
  const store = useCanvasStore.getState();
  if (store.isRunning) {
    toast.message("批量生成进行中…");
    return;
  }

  const projectId = store.projectId;
  if (!projectId) {
    toast.error("项目未加载");
    return;
  }

  const selectedFlowIds =
    options?.selectedFlowIds ??
    (store.selectedFlowIds.length > 0
      ? store.selectedFlowIds
      : store.selectedNodeId
        ? [store.selectedNodeId]
        : []);

  if (selectedFlowIds.length === 0) {
    toast.error("请先框选节点或选中一个组");
    return;
  }

  const resolved = resolveRunTargets(selectedFlowIds, store.nodes, store.edges);
  if (resolved.cycle) {
    toast.error("选中节点之间存在环状连线，无法批量运行");
    return;
  }
  if (resolved.targetIds.length === 0) {
    toast.error("选中范围内没有可生成的文本/图片/视频/音频节点");
    return;
  }

  clearBatchModelCache();

  // 预检：可跑列表 + 批量报价
  const runnable: Array<{
    nodeId: string;
    model: string;
    category: string;
    generationOptions: Record<string, string>;
    quoteToken?: string;
  }> = [];
  const skipReasons: string[] = [];

  for (const nodeId of resolved.targetIds) {
    const preview = await previewNodeRunnable(projectId, nodeId);
    if (!preview.runnable || !preview.model || !preview.category) {
      skipReasons.push(
        `${store.nodes.find((n) => n.id === nodeId)?.data.label || nodeId}: ${preview.reason || "跳过"}`
      );
      continue;
    }
    runnable.push({
      nodeId,
      model: preview.model,
      category: preview.category,
      generationOptions: preview.generationOptions ?? {},
    });
  }

  if (runnable.length === 0) {
    toast.error(
      skipReasons.length > 0
        ? `没有可运行节点（${skipReasons.slice(0, 2).join("；")}）`
        : "没有可运行节点"
    );
    return;
  }

  let quotes: CreditQuote[] = [];
  let sumTotal = 0;
  try {
    const batch = await postCreditQuotesBatch(
      runnable.map((r) => ({
        model: r.model,
        category: r.category,
        generationOptions: r.generationOptions,
      }))
    );
    quotes = batch.items ?? [];
    sumTotal = quotes.reduce((s, q) => s + (Number(q.total) || 0), 0);
    runnable.forEach((r, i) => {
      r.quoteToken = quotes[i]?.quoteToken;
    });
  } catch (err) {
    // 报价失败仍允许继续（单节点会再报价）；仅无合计提示
    if (err instanceof ApiError) {
      toast.message(err.message || "批量报价失败，将按单节点计价");
    }
  }

  const available = await resolveAvailableCredits(projectId);
  if (available != null && sumTotal > 0 && available < sumTotal) {
    toast.error(`算力不足：需要约 ${sumTotal}，当前可用 ${available}`);
    return;
  }

  if (!options?.skipConfirm) {
    const creditPart =
      sumTotal > 0 ? `，预计约 ${sumTotal} 算力` : available === null ? "（算力未启用）" : "";
    const skipPart =
      skipReasons.length > 0 ? `\n将跳过 ${skipReasons.length} 个节点` : "";
    const ok = window.confirm(
      `将对 ${runnable.length} 个节点按连线顺序批量生成${creditPart}。\n提交串行入队，生成可并行。${skipPart}\n\n开始运行？`
    );
    if (!ok) return;
  }

  void store.saveWorkflow(true).catch(() => {});

  const batchId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `batch-${Date.now()}`;

  const runnableSet = new Set(runnable.map((r) => r.nodeId));
  const quoteByNode = new Map(runnable.map((r) => [r.nodeId, r.quoteToken]));
  const statusByNode = new Map<string, "pending" | "success" | "failed" | "skipped">();
  for (const id of resolved.targetIds) {
    statusByNode.set(id, runnableSet.has(id) ? "pending" : "skipped");
  }

  store.setBatchRunCancelRequested(false);
  store.setRunning(true);
  store.setBatchRunProgress(emptyProgress(runnable.length));

  let abortRemaining = false;

  try {
    for (const layer of resolved.layers) {
      if (abortRemaining || useCanvasStore.getState().batchRunCancelRequested) break;

      const layerRunnable = layer.filter((id) => {
        if (!runnableSet.has(id)) return false;
        // 上游在目标集内且失败 → 跳过下游
        const deps = store.edges
          .filter((e) => e.target === id && resolved.targetIds.includes(e.source))
          .map((e) => e.source);
        for (const dep of deps) {
          const st = statusByNode.get(dep);
          if (st === "failed" || st === "skipped") {
            statusByNode.set(id, "skipped");
            bump("skipped");
            return false;
          }
        }
        return statusByNode.get(id) === "pending";
      });

      // 层内：串行提交（避开用户锁），收集 pending 后并行轮询
      const layerPendings: PendingSlot[] = [];

      for (const nodeId of layerRunnable) {
        if (abortRemaining || useCanvasStore.getState().batchRunCancelRequested) {
          statusByNode.set(nodeId, "skipped");
          bump("skipped");
          continue;
        }

        patchProgress({ currentSubmitNodeId: nodeId });
        bump("submitted", { currentSubmitNodeId: nodeId });

        const result = await submitWithRetry(
          projectId,
          nodeId,
          batchId,
          quoteByNode.get(nodeId)
        );

        if (!result.ok) {
          statusByNode.set(nodeId, "failed");
          bump("failed", { currentSubmitNodeId: null });
          useCanvasStore.getState().setNodeStatus(nodeId, "error");
          if (result.abortBatch) {
            abortRemaining = true;
            toast.error(result.error || "算力不足，已停止后续提交");
          }
          continue;
        }

        if (result.pending) {
          layerPendings.push(result.pending);
        } else {
          statusByNode.set(nodeId, "success");
          bump("succeeded", { currentSubmitNodeId: null });
        }
      }

      patchProgress({ currentSubmitNodeId: null });

      if (layerPendings.length > 0) {
        await Promise.all(
          layerPendings.map(async (p) => {
            const done = await completePendingGeneratableNode({
              projectId,
              nodeId: p.nodeId,
              jobId: p.jobId,
              kind: p.kind,
              model: p.model,
              nodeType: p.nodeType,
            });
            if (done.ok) {
              statusByNode.set(p.nodeId, "success");
              bump("succeeded");
            } else {
              statusByNode.set(p.nodeId, "failed");
              bump("failed");
            }
          })
        );
      }
    }

    // 取消后未跑完的标 skip
    for (const [id, st] of statusByNode) {
      if (st === "pending") {
        statusByNode.set(id, "skipped");
        if (runnableSet.has(id)) bump("skipped");
      }
    }

    const prog = useCanvasStore.getState().batchRunProgress;
    const succeeded = prog?.succeeded ?? 0;
    const failed = prog?.failed ?? 0;
    const skipped = prog?.skipped ?? 0;
    if (failed === 0 && succeeded > 0) {
      toast.success(`批量生成完成：成功 ${succeeded}`);
    } else if (succeeded > 0) {
      toast.message(`批量生成结束：成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`);
    } else if (useCanvasStore.getState().batchRunCancelRequested) {
      toast.message("已取消批量生成");
    } else {
      toast.error(`批量生成失败：失败 ${failed}，跳过 ${skipped}`);
    }
  } finally {
    useCanvasStore.getState().setRunning(false);
    useCanvasStore.getState().setBatchRunProgress(null);
    useCanvasStore.getState().setBatchRunCancelRequested(false);
    clearBatchModelCache();
  }
}
