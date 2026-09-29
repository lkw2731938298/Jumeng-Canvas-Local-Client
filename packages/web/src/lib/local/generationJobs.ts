/**
 * 开源本地版：本机生成任务记录（对齐商业「生成任务」列表的只读查看能力）。
 * 不进云端队列；仅落盘便于排查模型名、参考图、上游错误。
 */

export type LocalGenerationJobStatus =
  | "running"
  | "succeeded"
  | "failed";

export type LocalGenerationJobCategory = "image" | "video" | "audio" | "text" | "tool" | "model3d";

export type LocalGenerationJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: LocalGenerationJobStatus;
  category: LocalGenerationJobCategory;
  /** 画布选用的本地模型 id / name */
  modelId: string;
  /** 展示名 */
  modelLabel?: string;
  /** 实际上游 model 字段 */
  upstreamModel?: string;
  /** 上游异步任务 id（同步上游用） */
  providerTaskId?: string;
  projectId?: string;
  nodeId?: string;
  promptPreview?: string;
  /** 参考数量（便于判断是否走了 OSS） */
  referenceCount?: number;
  /** 实际上游 image_urls 条数（与 referenceCount 不一致说明参考被丢掉） */
  submittedReferenceCount?: number;
  /** 实际上游参考 host 预览（不含签名参数） */
  submittedRefHostPreview?: string;
  /** 实际上游 image_urls 全文（本机任务页预览用） */
  submittedRefUrls?: string[];
  error?: string;
  resultUrlPreview?: string;
};

export type LocalGenerationJobCreate = {
  category: LocalGenerationJobCategory;
  modelId: string;
  modelLabel?: string;
  upstreamModel?: string;
  projectId?: string;
  nodeId?: string;
  prompt?: string;
  referenceCount?: number;
};

export type LocalGenerationJobPatch = Partial<
  Pick<
    LocalGenerationJob,
    | "status"
    | "error"
    | "resultUrlPreview"
    | "upstreamModel"
    | "modelLabel"
    | "referenceCount"
    | "providerTaskId"
    | "submittedReferenceCount"
    | "submittedRefHostPreview"
    | "submittedRefUrls"
  >
>;

const MAX_JOBS = 200;

export function promptPreview(prompt: string | undefined, max = 120): string {
  const t = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function trimJobs(list: LocalGenerationJob[]): LocalGenerationJob[] {
  return list
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, MAX_JOBS);
}

/** 带上游 task_id 的错误，便于失败后仍能「同步上游」 */
export class LocalUpstreamJobError extends Error {
  providerTaskId?: string;
  constructor(message: string, providerTaskId?: string) {
    super(message);
    this.name = "LocalUpstreamJobError";
    this.providerTaskId = providerTaskId;
  }
}
