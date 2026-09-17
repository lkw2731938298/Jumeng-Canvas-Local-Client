import { apiFetch } from "./client";

/** 切镜结果：关键帧 + 分段参考视频（单段≤12s，供 SD2.0 r2v） */
export type ViralRemakeShotFrame = {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  durationLabel: string;
  /** 关键帧图片 assetId */
  assetId: string;
  fileUrl: string;
  thumbnailUrl: string;
  title: string;
  /** 本镜参考视频片段 assetId（成片优先接此，而非整段原片） */
  clipAssetId?: string;
  clipFileUrl?: string;
};

export type ViralRemakeExtractResult = {
  videoAssetId: string;
  shotCount: number;
  shots: ViralRemakeShotFrame[];
};

export type ViralRemakeExtractTask = {
  taskId: string;
  status: "pending" | "running" | "succeeded" | "failed" | string;
  mode?: string;
  message?: string;
  error?: string;
  result?: ViralRemakeExtractResult;
  shotCount?: number;
  shots?: ViralRemakeShotFrame[];
  videoAssetId?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeResult(task: ViralRemakeExtractTask): ViralRemakeExtractResult {
  if (task.result?.shots) {
    return {
      videoAssetId: task.result.videoAssetId || String(task.videoAssetId || ""),
      shotCount: task.result.shotCount ?? task.result.shots.length,
      shots: task.result.shots,
    };
  }
  if (Array.isArray(task.shots)) {
    return {
      videoAssetId: String(task.videoAssetId || ""),
      shotCount: task.shotCount ?? task.shots.length,
      shots: task.shots,
    };
  }
  throw new Error(task.error || task.message || "切镜结果为空");
}

/** 启动切镜（异步优先） */
export async function startViralRemakeExtract(params: {
  projectId: string;
  videoAssetId: string;
  /** 出海：运镜参考去音轨，避免原片对白污染成片语音 */
  stripAudio?: boolean;
}): Promise<ViralRemakeExtractTask> {
  return apiFetch<ViralRemakeExtractTask>("/api/v1/viral-remake/extract-shots", {
    method: "POST",
    body: JSON.stringify({
      projectId: params.projectId,
      videoAssetId: params.videoAssetId,
      ...(params.stripAudio ? { stripAudio: true } : {}),
    }),
  });
}

/** 轮询切镜任务 */
export async function getViralRemakeExtractStatus(taskId: string): Promise<ViralRemakeExtractTask> {
  return apiFetch<ViralRemakeExtractTask>(`/api/v1/viral-remake/extract-shots/${taskId}`);
}

/**
 * 爆款复刻 / 出海：切镜并等待完成（异步轮询；同步降级时一次返回）。
 */
export async function extractViralRemakeShots(params: {
  projectId: string;
  videoAssetId: string;
  /** 出海本地化传 true */
  stripAudio?: boolean;
  onProgress?: (message: string) => void;
  maxWaitMs?: number;
}): Promise<ViralRemakeExtractResult> {
  const started = await startViralRemakeExtract({
    projectId: params.projectId,
    videoAssetId: params.videoAssetId,
    stripAudio: params.stripAudio,
  });
  if (started.status === "succeeded") {
    return normalizeResult(started);
  }
  if (started.status === "failed") {
    throw new Error(started.error || started.message || "切镜失败");
  }

  const taskId = (started.taskId || "").trim();
  if (!taskId) {
    // 无 taskId 却非 succeeded：异常响应
    throw new Error(started.message || "切镜任务启动失败");
  }

  const maxWait = params.maxWaitMs ?? 600_000;
  const startedAt = Date.now();
  let delay = 800;
  while (Date.now() - startedAt < maxWait) {
    await sleep(delay);
    const st = await getViralRemakeExtractStatus(taskId);
    params.onProgress?.(st.message || `切镜中（${st.status}）…`);
    if (st.status === "succeeded") return normalizeResult(st);
    if (st.status === "failed") {
      throw new Error(st.error || st.message || "切镜失败");
    }
    delay = Math.min(delay + 200, 2500);
  }
  throw new Error("切镜超时，请稍后重试");
}
