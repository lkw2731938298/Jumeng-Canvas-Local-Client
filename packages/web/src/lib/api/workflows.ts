import { isLocalDesktop } from "@/lib/localDesktop";
import { localStore } from "@/lib/local/store";
import { apiFetch, ApiError } from "./client";
import type { Workflow } from "@/types";

export async function getLatestWorkflow(projectId: string): Promise<Workflow | null> {
  if (isLocalDesktop) {
    const raw = (await localStore().readWorkflow(projectId)) as Workflow | null;
    return raw;
  }
  try {
    return await apiFetch<Workflow>(`/api/v1/workflows/projects/${projectId}/workflows/latest`);
  } catch (err) {
    // Fallback when /latest is unavailable (older API) or no workflow yet
    if (err instanceof ApiError && err.status === 404) {
      const list = await listWorkflows(projectId).catch(() => [] as Workflow[]);
      return list[0] ?? null;
    }
    return null;
  }
}

export async function listWorkflows(projectId: string): Promise<Workflow[]> {
  if (isLocalDesktop) {
    const w = await getLatestWorkflow(projectId);
    return w ? [w] : [];
  }
  return apiFetch<Workflow[]>(`/api/v1/workflows/projects/${projectId}/workflows`);
}

export async function getWorkflow(id: string): Promise<Workflow> {
  if (isLocalDesktop) {
    throw new ApiError(404, "本地模式请使用 getLatestWorkflow");
  }
  return apiFetch<Workflow>(`/api/v1/workflows/${id}`);
}

export async function saveWorkflow(data: {
  projectId: string;
  title: string;
  flowJson: string;
  workflowId?: string;
  expectedRevision?: number;
}): Promise<Workflow> {
  if (isLocalDesktop) {
    const prev = ((await localStore().readWorkflow(data.projectId)) || {}) as Record<
      string,
      unknown
    >;
    const revision = Number(prev.revision || 0) + 1;
    let flowJson: unknown = data.flowJson;
    try {
      flowJson = typeof data.flowJson === "string" ? JSON.parse(data.flowJson) : data.flowJson;
    } catch {
      flowJson = data.flowJson;
    }
    const next = {
      id: String(data.workflowId || prev.id || crypto.randomUUID()),
      projectId: data.projectId,
      title: data.title,
      description: "",
      flowJson:
        typeof flowJson === "string" ? flowJson : JSON.stringify(flowJson ?? {}),
      version: 1,
      revision,
      nodeCount: 0,
      status: "draft" as const,
      createdAt: String(prev.createdAt || new Date().toISOString()),
      updatedAt: new Date().toISOString(),
    } satisfies Workflow;
    await localStore().writeWorkflow(data.projectId, next);
    return next;
  }
  const body: Record<string, unknown> = {
    project_id: data.projectId,
    title: data.title,
    flow_json: data.flowJson,
  };
  if (data.workflowId) body.workflow_id = data.workflowId;
  if (data.expectedRevision != null) body.expected_revision = data.expectedRevision;

  if (data.workflowId) {
    return apiFetch<Workflow>(`/api/v1/workflows/${data.workflowId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
  return apiFetch<Workflow>(`/api/v1/workflows/projects/${data.projectId}/workflows`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function executeWorkflow(workflowId: string): Promise<{ jobIds: Array<number | string> }> {
  return apiFetch<{ jobIds: Array<number | string> }>(`/api/v1/workflows/${workflowId}/execute`, {
    method: "POST",
  });
}

export async function getJobStatus(jobId: number | string): Promise<unknown> {
  return apiFetch(`/api/v1/generations/${jobId}`);
}

export interface PolledJobResult {
  status: string;
  resultText?: string;
  errorMessage?: string;
}

/** Poll until a queued generation job finishes (text or media). */
export async function pollGenerationJob(
  jobId: number | string,
  options?: { intervalMs?: number; maxWaitMs?: number }
): Promise<PolledJobResult> {
  const intervalMs = options?.intervalMs ?? 3000;
  const maxWaitMs = options?.maxWaitMs ?? 600_000;
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > maxWaitMs) {
      throw new Error("生成超时，请稍后在任务列表查看");
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    const raw = (await getJobStatus(jobId)) as Record<string, unknown>;
    const status = String(raw.status ?? "");
    if (status === "pending" || status === "running" || status === "polling") continue;

    let resultText = String(raw.resultText ?? raw.result_text ?? "");
    if (!resultText) {
      const outputs = (raw.outputAssets ?? raw.output_assets ?? []) as Array<Record<string, unknown>>;
      for (const item of outputs) {
        const content = String(item.content ?? item.text ?? item.contentPreview ?? "").trim();
        if (content) {
          resultText = content;
          break;
        }
      }
    }

    return {
      status,
      resultText,
      errorMessage: String(raw.errorMessage ?? raw.error_message ?? ""),
    };
  }
}
