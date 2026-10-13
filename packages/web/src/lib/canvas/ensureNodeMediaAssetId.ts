/**
 * 保证节点有可用的本机/项目素材 ID（项目内登记，写本机磁盘或 /api/assets）。
 * 场景：素材库锁定项 assetId 为空、仅有 videoUrl；或上传时未写回 URL 导致工具读不到 id。
 * 注意：这不是上游参考链路。交给模型时须经 prepareUpstreamMediaRefs /
 * generateFromMediaNode（OSS → 官方 /files/upload → base64），与节点带参考提交一致。
 */
import { uploadAsset, type AssetCategory } from "@/lib/api/assets";
import { useCanvasStore } from "@/stores/canvasStore";

export type NodeMediaUrlKey = "imageUrl" | "videoUrl" | "audioUrl";

function extForCategory(category: AssetCategory, mime: string, url: string): string {
  const fromMime = mime.split("/")[1]?.split(";")[0]?.trim();
  if (fromMime && /^[a-z0-9.+-]+$/i.test(fromMime)) {
    if (fromMime === "quicktime") return "mov";
    if (fromMime === "mpeg") return category === "audio" ? "mp3" : "mpg";
    return fromMime.replace("jpeg", "jpg");
  }
  const m = url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i);
  if (m?.[1]) return m[1].toLowerCase();
  if (category === "video") return "mp4";
  if (category === "audio") return "mp3";
  if (category === "image") return "jpg";
  return "bin";
}

/**
 * 若 params.assetId 已有则直接返回；否则用当前可播放 URL 上传登记并写回节点。
 */
export async function ensureNodeMediaAssetId(opts: {
  projectId: string;
  nodeId: string;
  category: Extract<AssetCategory, "image" | "video" | "audio">;
  urlParamKey: NodeMediaUrlKey;
  /** useNodeAssetMedia 解析出的可播放地址（优先） */
  mediaUrl?: string | null;
  params?: Record<string, unknown> | null;
  title?: string;
}): Promise<string> {
  const existing = String(opts.params?.assetId ?? "").trim();
  if (existing) return existing;

  const url = String(opts.mediaUrl || opts.params?.[opts.urlParamKey] || "").trim();
  if (!url) {
    throw new Error("当前媒体缺少素材，请先上传后再试");
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("无法读取当前媒体文件，请重新上传后再试");
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error("媒体文件为空，请重新上传后再试");
  }
  const mime = blob.type || res.headers.get("content-type") || "application/octet-stream";
  const ext = extForCategory(opts.category, mime, url);
  const file = new File([blob], `${opts.title || "media"}.${ext}`, { type: mime });
  const asset = await uploadAsset({
    file,
    projectId: opts.projectId,
    category: opts.category,
    subcategory: "素材",
    title: opts.title || "画布素材",
  });

  const store = useCanvasStore.getState();
  store.updateNodeParam(opts.nodeId, "assetId", asset.id);
  if (asset.fileUrl) {
    store.updateNodeParam(opts.nodeId, opts.urlParamKey, asset.fileUrl);
  }
  return asset.id;
}
