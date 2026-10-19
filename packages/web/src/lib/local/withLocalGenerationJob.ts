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
    /** POST 前落库提交 URL + body，失败时任务页可查「提交报文」 */
    noteSubmitBody: (note: { url: string; body: unknown }) => Promise<void>;
  }) => Promise<{
    result: T;
    resultUrlPreview?: string;
    resultAssetId?: string;
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

  const noteSubmitBody = async (note: { url: string; body: unknown }) => {
    if (!jobId) return;
    try {
      const url = String(note.url || "").trim();
      let preview = "";
      try {
        preview =
          typeof note.body === "string"
            ? note.body
            : JSON.stringify(note.body ?? null, null, 2);
      } catch {
        preview = String(note.body ?? "");
      }
      const patch: LocalGenerationJobPatch = {
        submitUrl: url.slice(0, 500) || undefined,
        // 控制体积：任务页只需排查字段，截断到约 8KB
        submitBodyPreview: preview.slice(0, 8000) || undefined,
      };
      await api.updateGenerationJob(jobId, patch);
    } catch {
      /* ignore */
    }
  };

  try {
    const out = await run({ noteProviderTaskId, noteSubmittedRefs, noteSubmitBody });
    if (jobId) {
      try {
        const patch: LocalGenerationJobPatch = {
          status: "succeeded",
          error: "",
          resultUrlPreview: out.resultUrlPreview
            ? String(out.resultUrlPreview).slice(0, 2000)
            : undefined,
          upstreamModel: out.upstreamModel || input.upstreamModel,
        };
        if (out.resultAssetId) patch.resultAssetId = out.resultAssetId;
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
        // 任务页「同步上游」可能已先标成功；勿被画布侧超时/失败覆盖
        const existing = (await api.listGenerationJobs()).find((j) => j.id === jobId);
        if (existing?.status !== "succeeded") {
          const patch: LocalGenerationJobPatch = {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          };
          if (err instanceof LocalUpstreamJobError && err.providerTaskId) {
            patch.providerTaskId = err.providerTaskId;
          }
          await api.updateGenerationJob(jobId, patch);
        }
      } catch {
        /* ignore patch failure */
      }
    }
    throw err;
  }
}
