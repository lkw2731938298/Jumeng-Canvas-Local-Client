/**
 * 画布参考素材 → 上游可用地址（与节点带参考提交同一链路）。
 * 优先级：干净公网 https → 参考图 OSS → 聚梦官方 /files/upload → base64 兜底。
 * 顶栏工具（去字幕 / HD / 画面编辑等）与节点生成须共用此路径，禁止只登记本机 assetId 就当已交给上游。
 */
import {
  resolveJumengUploadCreds,
  resolveLocalImageUrlsForUpstream,
  resolveLocalMediaUrlForUpstream,
  type JumengUploadCreds,
} from "@/lib/local/generate";

export type UpstreamMediaKind = "image" | "video" | "audio";

/** 本机 /api/local/asset 常无扩展名，须结合 category / ref.type / canvasTool 判断 */
export function isLikelyVideoMediaUrl(
  url: string,
  hint?: { type?: string; category?: string; canvasTool?: string; forceVideo?: boolean }
): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  if (hint?.forceVideo || hint?.type === "video" || hint?.category === "video") return true;
  if (u.startsWith("data:video")) return true;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return true;
  if (/file=[^&]*\.(mp4|webm|mov)/i.test(u)) return true;
  const tool = String(hint?.canvasTool || "").toLowerCase();
  if (
    /\/api\/local\//i.test(u) &&
    (tool.includes("video") ||
      tool.includes("subtitle") ||
      tool.includes("hd_upscale_video") ||
      tool.includes("vocal") ||
      tool.includes("frame"))
  ) {
    return true;
  }
  return false;
}

export function isLikelyAudioMediaUrl(
  url: string,
  hint?: { type?: string; category?: string }
): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  if (hint?.type === "audio" || hint?.category === "audio") return true;
  if (u.startsWith("data:audio")) return true;
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(u)) return true;
  if (/file=[^&]*\.(mp3|wav|m4a|aac|ogg|flac)/i.test(u)) return true;
  return false;
}

export type PreparedUpstreamMediaRefs = {
  jumengOfficial: boolean;
  jumengCreds: JumengUploadCreds | null;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
};

/**
 * 把本机/blob/项目素材 URL 转成上游可拉的地址（节点参考与顶栏工具共用）。
 */
export async function prepareUpstreamMediaRefs(opts: {
  modelId: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
}): Promise<PreparedUpstreamMediaRefs> {
  const jumengCreds = await resolveJumengUploadCreds(opts.modelId);
  const jumengOfficial = jumengCreds !== null;

  const imageUrls = await resolveLocalImageUrlsForUpstream(
    (opts.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean),
    {
      preferPublicHttps: jumengOfficial,
      requirePublicHttps: !jumengOfficial,
      jumengUpload: jumengCreds,
    }
  );

  const videoUrls: string[] = [];
  for (const raw of (opts.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean)) {
    const resolved = await resolveLocalMediaUrlForUpstream(raw, {
      requirePublicHttps: !jumengOfficial,
      jumengUpload: jumengCreds,
    });
    if (!resolved) {
      throw new Error(
        `参考视频未能提交（${raw.slice(0, 80)}）。聚梦官方上传上限 100MB；更大请压缩或启用「参考图 OSS」`
      );
    }
    videoUrls.push(resolved);
  }

  const audioUrls: string[] = [];
  for (const raw of (opts.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean)) {
    const resolved = await resolveLocalMediaUrlForUpstream(raw, {
      requirePublicHttps: !jumengOfficial,
      jumengUpload: jumengCreds,
    });
    if (!resolved) {
      throw new Error(
        `参考音频未能提交（${raw.slice(0, 80)}）。请确认可播放；未配 OSS 时官方上传上限约 20MB，更大请启用「参考图 OSS」`
      );
    }
    audioUrls.push(resolved);
  }

  return { jumengOfficial, jumengCreds, imageUrls, videoUrls, audioUrls };
}
