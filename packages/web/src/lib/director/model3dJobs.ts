/**
 * 导演台 3D 生成后台任务（Tripo 等）：
 * - 先在场景放占位方块，后台提交上游并轮询（1~5 分钟），完成后下载 GLB 入本地素材库；
 * - 导演台开着时直接改实时场景；已关闭则读盘 → 替换占位 → 写回，下次打开即可看到；
 * - 每次生成都记入「生成任务」页，扣的是用户自己 API 密钥的上游额度。
 */

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { fetchDirectorScene, saveDirectorScene } from "@/lib/api/directorScene";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import { localGenerateModel3d, type Model3dQuality } from "@/lib/local/generate";
import { withLocalGenerationJob } from "@/lib/local/withLocalGenerationJob";
import { normalizeDirectorScene } from "@/lib/director/sceneNormalize";
import { markPlaceholderFailed, replacePlaceholderWithModel } from "@/lib/director/agent/sceneOps";
import type { DirectorSceneState } from "@/types/director-scene";

/** 正在打开的导演台实例（用于把完成结果直接写进实时场景） */
export type DirectorLiveHost = {
  getScene: () => DirectorSceneState;
  patchScene: (updater: (scene: DirectorSceneState) => DirectorSceneState) => void;
};

export type DirectorModel3dJob = {
  id: string;
  projectId: string;
  nodeId: string;
  placeholderId: string;
  name: string;
  status: "running" | "succeeded" | "failed";
  progress?: string;
  error?: string;
  startedAt: number;
};

const liveHosts = new Map<string, DirectorLiveHost>();
let jobs: DirectorModel3dJob[] = [];
const listeners = new Set<() => void>();

function hostKey(projectId: string, nodeId: string) {
  return `${projectId}::${nodeId}`;
}

function emit() {
  for (const fn of listeners) fn();
}

function patchJob(id: string, patch: Partial<DirectorModel3dJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
}

/** 导演台挂载时注册实时宿主，卸载时自动注销 */
export function registerDirectorLiveHost(projectId: string, nodeId: string, host: DirectorLiveHost): () => void {
  const key = hostKey(projectId, nodeId);
  liveHosts.set(key, host);
  return () => {
    if (liveHosts.get(key) === host) liveHosts.delete(key);
  };
}

/** 订阅某导演台的 3D 生成任务列表（面板展示进度） */
export function useDirectorModel3dJobs(projectId: string, nodeId: string): DirectorModel3dJob[] {
  const snapshot = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => jobs,
    () => jobs
  );
  return snapshot.filter((j) => j.projectId === projectId && j.nodeId === nodeId);
}

/** 清除已结束的任务记录（面板「清除」按钮） */
export function clearFinishedDirectorModel3dJobs(projectId: string, nodeId: string) {
  jobs = jobs.filter((j) => !(j.projectId === projectId && j.nodeId === nodeId && j.status !== "running"));
  emit();
}

/** 把场景变更写入：优先实时宿主，否则读盘改完写回 */
async function applyToScene(
  projectId: string,
  nodeId: string,
  transform: (scene: DirectorSceneState) => DirectorSceneState | null
): Promise<boolean> {
  const host = liveHosts.get(hostKey(projectId, nodeId));
  if (host) {
    const next = transform(host.getScene());
    if (!next) return false;
    host.patchScene((cur) => transform(cur) ?? cur);
    return true;
  }
  const record = await fetchDirectorScene(projectId, nodeId);
  if (!record?.scene) return false;
  const next = transform(normalizeDirectorScene(record.scene) as DirectorSceneState);
  if (!next) return false;
  await saveDirectorScene(projectId, nodeId, next);
  return true;
}

export type StartDirectorModel3dJobInput = {
  projectId: string;
  nodeId: string;
  modelId: string;
  modelLabel?: string;
  placeholderId: string;
  name: string;
  prompt: string;
  /** 参考图地址（有则图生 3D） */
  imageUrl?: string;
  /** 目标高度（米） */
  height: number;
  quality?: Model3dQuality;
};

/** 启动后台 3D 生成（不阻塞调用方；结果通过场景替换 + toast 反馈） */
export function startDirectorModel3dJob(input: StartDirectorModel3dJobInput): string {
  const id = `m3d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  jobs = [
    ...jobs,
    {
      id,
      projectId: input.projectId,
      nodeId: input.nodeId,
      placeholderId: input.placeholderId,
      name: input.name,
      status: "running",
      progress: "提交中",
      startedAt: Date.now(),
    },
  ];
  emit();

  void (async () => {
    try {
      const result = await withLocalGenerationJob(
        {
          category: "model3d",
          modelId: input.modelId,
          modelLabel: input.modelLabel,
          projectId: input.projectId,
          nodeId: input.nodeId,
          prompt: input.prompt || input.name,
          referenceCount: input.imageUrl ? 1 : 0,
        },
        async ({ noteProviderTaskId }) => {
          const r = await localGenerateModel3d({
            modelId: input.modelId,
            projectId: input.projectId,
            prompt: input.prompt,
            imageUrl: input.imageUrl,
            title: input.name,
            textureQuality: input.quality,
            geometryQuality: input.quality,
            onProviderTaskId: noteProviderTaskId,
            onProgress: (status) => patchJob(id, { progress: status }),
          });
          return {
            result: r,
            resultUrlPreview: r.fileUrl,
            upstreamModel: r.upstreamModel,
            providerTaskId: r.providerTaskId,
          };
        }
      );
      notifyAssetsUpdated();
      const placed = await applyToScene(input.projectId, input.nodeId, (scene) =>
        replacePlaceholderWithModel(scene, input.placeholderId, {
          assetId: result.assetId,
          name: input.name,
          height: input.height,
        })
      );
      patchJob(id, { status: "succeeded", progress: undefined });
      if (placed) toast.success(`3D 模型「${input.name}」已生成并放入导演台`);
      else toast.success(`3D 模型「${input.name}」已生成，占位物体已被删除，模型已存入素材库`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patchJob(id, { status: "failed", error: msg, progress: undefined });
      toast.error(`3D 模型「${input.name}」生成失败：${msg}`);
      await applyToScene(input.projectId, input.nodeId, (scene) =>
        markPlaceholderFailed(scene, input.placeholderId, input.name)
      ).catch(() => {});
    }
  })();

  return id;
}
