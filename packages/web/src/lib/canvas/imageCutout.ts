import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";

/** 将相对/代理地址转为当前站点绝对 URL，避免被第三方库解析到外域 */
function toAbsoluteSameOriginUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (typeof window === "undefined") return trimmed;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }
  return new URL(trimmed, window.location.origin).href;
}

/** 本域拉取原图为 Blob，供抠图库使用（禁止把相对路径交给 imgly） */
async function fetchSourceImageBlob(sourceUrl: string): Promise<Blob> {
  const proxyOrRaw = canvasStreamUrlFromUrl(sourceUrl) || sourceUrl;
  const absoluteUrl = toAbsoluteSameOriginUrl(proxyOrRaw);
  const response = await fetch(absoluteUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`读取原图失败（${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("原图内容为空");
  return blob;
}

/**
 * 浏览器端抠图：去掉背景，只保留主体（人物/前景），上传为项目图片资产。
 * 首次会下载本地 ONNX 模型，之后走浏览器缓存。
 */
export async function cutoutImageToAsset(params: {
  projectId: string;
  nodeId: string;
  sourceUrl: string;
  title?: string;
}): Promise<{ id: string; fileUrl: string; title: string }> {
  // 先本域拉成 Blob，避免相对 /api/storage 被解析到 staticimgly.com
  const sourceBlob = await fetchSourceImageBlob(params.sourceUrl);
  const { removeBackground } = await import("@imgly/background-removal");

  const blob = await removeBackground(sourceBlob, {
    // 更高质量模型，尽量保留完整人物轮廓；默认输出前景抠图
    model: "isnet",
    output: {
      format: "image/png",
    },
  });

  const title = params.title?.trim() || "抠图";
  const file = new File([blob], `cutout-${params.nodeId}-${Date.now()}.png`, {
    type: "image/png",
  });
  const asset = await uploadAsset({
    file,
    projectId: params.projectId,
    category: "image",
    subcategory: NODE_IMAGE_SUBCATEGORY,
    title,
  });
  if (!asset.fileUrl) throw new Error("抠图上传后未返回地址");

  return {
    id: asset.id,
    fileUrl: asset.fileUrl,
    title: asset.title || title,
  };
}
