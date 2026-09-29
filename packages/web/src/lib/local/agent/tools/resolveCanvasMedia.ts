/**
 * 从画布节点解析可供模型看图 / 参考的本地图片 URL。
 * 开源版素材常只存 assetId（持久化时会清掉 imageUrl），须经 listAssets 还原 /api/local/asset。
 */

import {
  resolveLocalMediaUrl,
  urlParamKeyForNodeType,
} from "@/lib/canvas/resolveNodeMedia";
import { localStore } from "@/lib/local/store";
import type { LocalAssetMeta } from "@/lib/local/types";
import { useCanvasStore } from "@/stores/canvasStore";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** 本机素材 → 浏览器可 fetch 的地址 */
export function localAssetFileUrl(projectId: string, meta: LocalAssetMeta): string {
  const file = str(meta.fileName);
  if (!file || !projectId) return "";
  return `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(file)}`;
}

/** 按 assetId / fileName 查本机索引 */
export async function lookupLocalAsset(
  projectId: string,
  assetId: string
): Promise<LocalAssetMeta | null> {
  const id = str(assetId);
  if (!projectId || !id) return null;
  try {
    const list = await localStore().listAssets(projectId);
    return list.find((a) => a.id === id || a.fileName === id) || null;
  } catch {
    return null;
  }
}

/**
 * 解析节点上的图片地址（含仅有 assetId 的情况）。
 * 上传附件（nodeId 以 upload: 开头）应直接用 ref.thumbUrl，不走此函数。
 */
export async function resolveNodeImageUrlAsync(
  projectId: string,
  nodeId: string
): Promise<string> {
  const id = str(nodeId);
  if (!id || id.startsWith("upload:")) return "";

  const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
  if (!node) return "";

  const params = ((node.data as { params?: Record<string, unknown> } | undefined)?.params ||
    {}) as Record<string, unknown>;
  const key = urlParamKeyForNodeType(String(node.type || "")) || "imageUrl";

  // 1) 参数里已有直链 / 本机 proxy
  const direct = resolveLocalMediaUrl(params, key);
  if (direct) return direct;
  for (const k of ["imageUrl", "fileUrl", "url", "thumbUrl", "videoUrl"]) {
    const u = str(params[k]);
    if (u) return u;
  }

  // 2) 仅有 assetId：从本机素材索引还原
  const assetId = str(params.assetId);
  if (assetId && projectId) {
    const meta = await lookupLocalAsset(projectId, assetId);
    if (meta) {
      const url = localAssetFileUrl(projectId, meta);
      if (url) return url;
    }
  }

  return "";
}

/** 同步兜底：仅读 params（无 listAssets）；给 UI chip 用 */
export function resolveNodeImageUrlSync(nodeId: string): string {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return "";
  const params = ((node.data as { params?: Record<string, unknown> } | undefined)?.params ||
    {}) as Record<string, unknown>;
  const key = urlParamKeyForNodeType(String(node.type || "")) || "imageUrl";
  const local = resolveLocalMediaUrl(params, key);
  if (local) return local;
  for (const k of ["imageUrl", "fileUrl", "url", "thumbUrl"]) {
    const u = str(params[k]);
    if (u) return u;
  }
  return "";
}
