/** 登录网格：对唯一 URL 降采样一次，多格共享 blob，降低解码内存。 */

const AUTH_GRID_DECODE_MAX_EDGE = 360;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 跨域 OSS 需 CORS；失败时上层回退原 URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

async function downscaleToBlobUrl(url: string, maxEdge: number): Promise<string> {
  const img = await loadImage(url);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return url;

  const edge = Math.max(w, h);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  // 已足够小则仍导出一次轻量 JPEG blob，避免多格重复持有大解码缓冲
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return url;
  ctx.drawImage(img, 0, 0, tw, th);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72);
  });
  if (!blob) return url;
  return URL.createObjectURL(blob);
}

/**
 * 将网格 URL 列表映射为降采样后的 blob URL（同原图共享同一 blob）。
 * 返回 { urls, revoke }；卸载时务必 revoke。
 */
export async function prepareAuthGridDisplayUrls(sourceUrls: string[]): Promise<{
  urls: string[];
  revoke: () => void;
}> {
  const cleaned = sourceUrls.map((u) => u.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { urls: [], revoke: () => undefined };
  }

  const unique = Array.from(new Set(cleaned));
  const map = new Map<string, string>();
  const created: string[] = [];

  await Promise.all(
    unique.map(async (url) => {
      try {
        const blobUrl = await downscaleToBlobUrl(url, AUTH_GRID_DECODE_MAX_EDGE);
        map.set(url, blobUrl);
        if (blobUrl.startsWith("blob:")) created.push(blobUrl);
      } catch {
        map.set(url, url);
      }
    }),
  );

  return {
    urls: cleaned.map((url) => map.get(url) || url),
    revoke: () => {
      for (const blobUrl of created) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          /* ignore */
        }
      }
    },
  };
}
