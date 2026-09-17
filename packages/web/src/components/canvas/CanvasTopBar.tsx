"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Loader2 } from "lucide-react";
import {
  countLikelyRunnableSelection,
  runSelectionBatch,
} from "@/lib/canvas/selectionBatchRun";

export function CanvasTopBar() {
  const router = useRouter();
  const {
    projectName,
    isRunning,
    saveWorkflow,
    nodes,
    selectedFlowIds,
    selectedNodeId,
    batchRunProgress,
    requestCancelBatchRun,
  } = useCanvasStore();

  const selectionIds = useMemo(() => {
    if (selectedFlowIds.length > 0) return selectedFlowIds;
    if (selectedNodeId) return [selectedNodeId];
    return [];
  }, [selectedFlowIds, selectedNodeId]);

  const runnableHint = useMemo(
    () => countLikelyRunnableSelection(selectionIds, nodes),
    [selectionIds, nodes]
  );

  const runLabel = useMemo(() => {
    if (isRunning && batchRunProgress) {
      const done =
        batchRunProgress.succeeded + batchRunProgress.failed + batchRunProgress.skipped;
      return `运行中 ${done}/${batchRunProgress.total}`;
    }
    if (isRunning) return "运行中...";
    if (runnableHint > 1) return `运行 (${runnableHint})`;
    return "运行";
  }, [isRunning, batchRunProgress, runnableHint]);

  return (
    <div className="glass-panel absolute left-0 right-0 top-0 z-20 flex h-14 items-center justify-between px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { saveWorkflow(); router.push("/projects"); }} title="返回项目列表">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-medium text-foreground">{projectName || "未命名项目"}</h1>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => {
            if (isRunning) {
              requestCancelBatchRun();
              return;
            }
            void runSelectionBatch({ selectedFlowIds: selectionIds });
          }}
          className="gap-2"
          size="sm"
          title={isRunning ? "点击取消尚未提交的节点" : "按选中批量生成"}
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {runLabel}
        </Button>
      </div>
    </div>
  );
}
