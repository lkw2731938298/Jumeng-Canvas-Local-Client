/**
 * 开源本地版：生成前后写入本机任务列表（失败也记，便于排查）。
 */
import { localStore } from "@/lib/local/store";
import {
  LocalUpstreamJobError,
  type LocalGenerationJobCreate,
  type LocalGenerationJobPatch,
} from "@/lib/local/generationJobs";

/** 上游请求发出前就知道的参考素材信息 */
export type SubmittedRefsNote = {
  count: number;
  hostPreview?: string;
  urls?: string[];
};

export async function withLocalGenerationJob<T>(
  input: LocalGenerationJobCreate,
  run: (ctx: {
    /** 拿到上游 task_id 后立刻落库，失败后仍可同步 */
    noteProviderTaskId: (taskId: string) => Promise<void>;
    /** 参考素材在 POST 前就落库：超时/报错时任务页仍能看出到底带了什么 */
    noteSubmittedRefs: (note: SubmittedRefsNote) => Promise<void>;
  }) => Promise<{
    result: T;
    resultUrlPreview?: string;
    upstreamModel?: string;
    providerTaskId?: string;
    submittedReferenceCount?: number;
    submittedRefHostPreview?: string;
    submittedRefUrls?: string[];
  }>
): Promise<T> {
  const api = localStore();
  let jobId = "";
  try {
    const job = await api.appendGenerationJob(input);
    jobId = job.id;
  } catch {
    // 记任务失败不影响生成本身
  }

  const noteProviderTaskId = async (taskId: string) => {
    const id = String(taskId || "").trim();
    if (!jobId || !id) return;
    try {
      await api.updateGenerationJob(jobId, { providerTaskId: id });
    } catch {
      /* ignore */
    }
  };

  const noteSubmittedRefs = async (note: SubmittedRefsNote) => {
    if (!jobId) return;
    try {
      const patch: LocalGenerationJobPatch = {
        submittedReferenceCount: note.count,
      };
      if (note.hostPreview) patch.submittedRefHostPreview = note.hostPreview;
      if (note.urls?.length) patch.submittedRefUrls = note.urls;
      await api.updateGenerationJob(jobId, patch);
    } catch {
      /* ignore */
    }
  };

  try {
    const out = await run({ noteProviderTaskId, noteSubmittedRefs });
    if (jobId) {
      try {
        const patch: LocalGenerationJobPatch = {
          status: "succeeded",
          error: "",
          resultUrlPreview: out.resultUrlPreview
            ? String(out.resultUrlPreview).slice(0, 200)
            : undefined,
          upstreamModel: out.upstreamModel || input.upstreamModel,
        };
        if (out.providerTaskId) patch.providerTaskId = out.providerTaskId;
        if (typeof out.submittedReferenceCount === "number") {
          patch.submittedReferenceCount = out.submittedReferenceCount;
        }
        if (out.submittedRefHostPreview) {
          patch.submittedRefHostPreview = out.submittedRefHostPreview;
        }
        if (out.submittedRefUrls?.length) {
          patch.submittedRefUrls = out.submittedRefUrls;
        }
        await api.updateGenerationJob(jobId, patch);
      } catch {
        /* ignore */
      }
    }
    return out.result;
  } catch (err) {
    if (jobId) {
      try {
        const patch: LocalGenerationJobPatch = {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
        if (err instanceof LocalUpstreamJobError && err.providerTaskId) {
          patch.providerTaskId = err.providerTaskId;
        }
        await api.updateGenerationJob(jobId, patch);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
