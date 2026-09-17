"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import {
  applyMediaJobResultToNode,
  applyTextJobResultToNode,
  jobErrorMessage,
  type PolledGenerationJob,
} from "@/lib/canvas/applyMediaJobResult";
import { isEditorNodeType, getEditorConfig } from "@/lib/canvas/nodeEditorConfig";
import { markNodeGenerationError } from "@/lib/canvas/markNodeGenerationError";
import { getJobStatus } from "@/lib/api/workflows";
import { saveNodeText } from "@/lib/api/nodeText";
import { clipTextNodeGeneratedContent } from "@/lib/canvas/textNodeGenerationLimit";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

const POLL_INTERVAL_MS = 3000;

function nodeNeedsJobPoll(
  node: { id: string; type?: string; data: WorkflowNodeData },
  activeGenerationNodeIds: Record<string, true>
): string | null {
  const params = (node.data.params ?? {}) as Record<string, unknown>;
  const jobId = String(params.generationJobId ?? "").trim();
  if (!jobId) return null;

  const status = node.data.status ?? "idle";
  if (status === "running" || activeGenerationNodeIds[node.id]) {
    return jobId;
  }

  // Recover jobs that finished while the node was deselected (overlay polling stopped).
  if (isEditorNodeType(node.type) && node.type !== "text_input") {
    const config = getEditorConfig(node.type);
    const urlKey = config?.urlParamKey;
    const hasAsset = Boolean(String(params.assetId ?? "").trim());
    const hasUrl = urlKey ? Boolean(String(params[urlKey] ?? "").trim()) : false;
    if (!hasAsset && !hasUrl) {
      return jobId;
    }
  }

  if (node.type === "text_input") {
    const hasContent = Boolean(String(params.content ?? "").trim());
    if (!hasContent) {
      return jobId;
    }
  }

  return null;
}

async function pollNodeJob(
  projectId: string,
  nodeId: string,
  nodeType: string | undefined,
  jobId: string
): Promise<void> {
  const job = (await getJobStatus(jobId)) as PolledGenerationJob;
  const status = String(job.status ?? "");

  if (
    status === "pending" ||
    status === "running" ||
    status === "polling" ||
    status === "awaiting_approval"
  ) {
    return;
  }

  if (status === "succeeded") {
    if (nodeType === "text_input") {
      const params =
        (useCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.data.params as
          | Record<string, unknown>
          | undefined) ?? {};
      const model = String(params.model ?? "");
      const applied = applyTextJobResultToNode(nodeId, nodeType, job, jobId, model);
      if (applied && projectId) {
        const text = clipTextNodeGeneratedContent(
          String(job.resultText ?? job.result_text ?? "")
        );
        void saveNodeText(projectId, nodeId, text, model).catch(() => {});
      }
      return;
    }

    if (isEditorNodeType(nodeType) && nodeType !== "text_input") {
      await applyMediaJobResultToNode(projectId, nodeId, nodeType, job, jobId);
    }
    return;
  }

  useCanvasStore.getState().endNodeGeneration(nodeId);
  const errMsg = jobErrorMessage(job);
  markNodeGenerationError(nodeId, String(errMsg || "").slice(0, 500));
  const params =
    (useCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.data.params as
      | Record<string, unknown>
      | undefined) ?? {};
  if (String(params.generationJobId ?? "").trim()) {
    useCanvasStore.getState().updateNodeParam(nodeId, "generationJobId", "");
  }
  toast.error(errMsg);
}

/**
 * Poll pending generation jobs for all canvas nodes — survives node deselect / overlay unmount.
 */
export function usePendingGenerationJobPolling() {
  const projectId = useCanvasStore((s) => s.projectId);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const inFlight = new Set<string>();

    const tick = async () => {
      if (cancelled) return;

      const { nodes, activeGenerationNodeIds } = useCanvasStore.getState();
      const targets: Array<{ nodeId: string; nodeType: string | undefined; jobId: string }> = [];

      for (const node of nodes) {
        const jobId = nodeNeedsJobPoll(node, activeGenerationNodeIds);
        if (!jobId) continue;
        const key = `${node.id}:${jobId}`;
        if (inFlight.has(key)) continue;
        targets.push({ nodeId: node.id, nodeType: node.type, jobId });
      }

      await Promise.all(
        targets.map(async ({ nodeId, nodeType, jobId }) => {
          const key = `${nodeId}:${jobId}`;
          inFlight.add(key);
          try {
            await pollNodeJob(projectId, nodeId, nodeType, jobId);
          } catch {
            /* keep polling on transient errors */
          } finally {
            inFlight.delete(key);
          }
        })
      );
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId]);
}
