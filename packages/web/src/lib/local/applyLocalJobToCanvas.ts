/**
 * 本机生成任务完成后回写画布节点。
 * 「生成任务」页同步上游 / 补填 task_id 成功时调用；画布侧也会轮询已成功任务做兜底。
 */
import type { LocalGenerationJob, LocalGenerationJobCategory } from "@/lib/local/generationJobs";
import { localStore } from "@/lib/local/store";
import { useCanvasStore } from "@/stores/canvasStore";
import type { Workflow } from "@/types";

function urlParamKeyForCategory(
  category: LocalGenerationJobCategory
): "imageUrl" | "videoUrl" | "audioUrl" | null {
  if (category === "image" || category === "tool") return "imageUrl";
  if (category === "video") return "videoUrl";
  if (category === "audio") return "audioUrl";
  return null;
}

/** 从本机素材索引还原可预览 URL */
async function resolveAssetUrl(
  projectId: string,
  assetId: string | undefined,
  fallbackUrl: string
): Promise<{ url: string; assetId?: string }> {
  const id = String(assetId || "").trim();
  const fallback = String(fallbackUrl || "").trim();
  if (id && projectId) {
    try {
      const list = await localStore().listAssets(projectId);
      const hit = list.find((a) => a.id === id || a.fileName === id);
      if (hit) {
        const fileUrl = `/api/local/asset?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(hit.fileName)}`;
        return { url: fileUrl, assetId: hit.id };
      }
    } catch {
      /* fall through */
    }
  }
  if (!fallback || fallback === "(b64)") return { url: "" };
  return { url: fallback, assetId: id || undefined };
}

/**
 * 画布未打开当前项目时，直接改工作流 JSON，避免回来仍是转圈。
 */
async function patchWorkflowNodeOnDisk(
  projectId: string,
  nodeId: string,
  urlParamKey: string,
  mediaUrl: string,
  assetId?: string
): Promise<boolean> {
  try {
    const raw = (await localStore().readWorkflow(projectId)) as Workflow | null;
    if (!raw) return false;
    let flow: { nodes?: Array<Record<string, unknown>>; edges?: unknown[] };
    try {
      flow =
        typeof raw.flowJson === "string"
          ? (JSON.parse(raw.flowJson) as typeof flow)
          : ((raw.flowJson as typeof flow) ?? { nodes: [] });
    } catch {
      return false;
    }
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    let changed = false;
    const nextNodes = nodes.map((n) => {
      if (String(n.id) !== nodeId) return n;
      const data = { ...((n.data as Record<string, unknown>) || {}) };
      const params = { ...((data.params as Record<string, unknown>) || {}) };
      if (assetId) params.assetId = assetId;
      if (mediaUrl) params[urlParamKey] = mediaUrl;
      delete params.generationJobId;
      data.params = params;
      data.status = "success";
      changed = true;
      return { ...n, data };
    });
    if (!changed) return false;
    const next: Workflow = {
      ...raw,
      flowJson: JSON.stringify({ ...flow, nodes: nextNodes }),
      updatedAt: new Date().toISOString(),
    };
    await localStore().writeWorkflow(projectId, next);
    return true;
  } catch {
    return false;
  }
}

export type ApplyLocalJobMedia = {
  url: string;
  assetId?: string;
};

/**
 * 将已成功的本机任务结果写回对应画布节点，并结束转圈状态。
 * @returns 是否已写到节点（内存或磁盘）
 */
export async function applyLocalGenerationJobResultToCanvas(
  job: LocalGenerationJob,
  media?: ApplyLocalJobMedia
): Promise<boolean> {
  const projectId = String(job.projectId || "").trim();
  const nodeId = String(job.nodeId || "").trim();
  if (!projectId || !nodeId) return false;

  const urlKey = urlParamKeyForCategory(job.category);
  if (!urlKey) return false;

  const resolved = await resolveAssetUrl(
    projectId,
    media?.assetId || job.resultAssetId,
    media?.url || job.resultUrlPreview || ""
  );
  if (!resolved.url) return false;

  const store = useCanvasStore.getState();
  const liveOpen =
    store.projectId === projectId && store.nodes.some((n) => n.id === nodeId);

  if (liveOpen) {
    store.applyNodeGeneratedMedia(nodeId, urlKey, resolved.url, resolved.assetId);
    store.endNodeGeneration(nodeId);
    const params =
      (store.nodes.find((n) => n.id === nodeId)?.data.params as Record<string, unknown> | undefined) ??
      {};
    if (String(params.generationJobId ?? "").trim()) {
      store.updateNodeParam(nodeId, "generationJobId", "");
    }
    return true;
  }

  return patchWorkflowNodeOnDisk(
    projectId,
    nodeId,
    urlKey,
    resolved.url,
    resolved.assetId
  );
}
