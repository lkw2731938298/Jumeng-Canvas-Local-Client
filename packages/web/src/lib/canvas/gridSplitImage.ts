import {
  NODE_IMAGE_SUBCATEGORY,
  uploadAsset,
  type Asset,
} from "@/lib/api/assets";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";

export const GRID_SPLIT_MIN = 1;
export const GRID_SPLIT_MAX = 5;

export interface GridSplitTile {
  row: number;
  col: number;
  asset: Asset;
}

function clampGridDim(n: number): number {
  return Math.max(GRID_SPLIT_MIN, Math.min(GRID_SPLIT_MAX, Math.round(n)));
}

/** 校验行列：各 1～5，且至少 2 块以便成组。 */
export function normalizeGridSplitDims(rows: number, cols: number): { rows: number; cols: number } {
  const r = clampGridDim(rows);
  const c = clampGridDim(cols);
  if (r * c < 2) {
    throw new Error("请至少切成 2 块（例如 1×2 或 2×2）");
  }
  return { rows: r, cols: c };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败，请确认已上传素材"));
    img.src = src;
  });
}

/** 优先同源 stream，避免 OSS CORS；失败再试原 URL。 */
async function loadSourceImage(mediaUrl: string): Promise<HTMLImageElement> {
  const streamUrl = canvasStreamUrlFromUrl(mediaUrl);
  try {
    return await loadImageElement(streamUrl);
  } catch {
    if (streamUrl !== mediaUrl) {
      return loadImageElement(mediaUrl);
    }
    throw new Error("图片加载失败，请确认已上传素材");
  }
}

function tileBlobFromCanvas(
  source: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  usePng: boolean
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, sw);
  canvas.height = Math.max(1, sh);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("无法创建画布上下文"));
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("切分导出失败"));
          return;
        }
        resolve(blob);
      },
      usePng ? "image/png" : "image/jpeg",
      usePng ? undefined : 0.92
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUploadRateLimitedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.includes("上传过于频繁");
}

/** 宫格切分逐块上传：遇限流短暂退避重试，避免 5×5 中途失败。 */
async function uploadTileWithRetry(params: {
  file: File;
  projectId: string;
  title: string;
}): Promise<Asset> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await uploadAsset({
        file: params.file,
        projectId: params.projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: params.title,
      });
    } catch (err) {
      lastError = err;
      if (!isUploadRateLimitedError(err) || attempt >= maxAttempts) throw err;
      // 窗口约 60s，短退避后再试；后端限流已放宽到 60 次/分钟
      await sleep(1500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("上传失败");
}

/**
 * 将源图均匀切成 rows×cols，逐块上传为项目素材。
 * onProgress(done, total) 供 UI 展示进度。
 */
export async function splitImageIntoGridTiles(opts: {
  projectId: string;
  mediaUrl: string;
  rows: number;
  cols: number;
  titlePrefix?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<GridSplitTile[]> {
  const { rows, cols } = normalizeGridSplitDims(opts.rows, opts.cols);
  const img = await loadSourceImage(opts.mediaUrl);
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  if (!imgW || !imgH) throw new Error("无法读取图片尺寸");

  const usePng = /\.png(\?|$)/i.test(opts.mediaUrl.split("?")[0] ?? "");
  const total = rows * cols;
  const prefix = (opts.titlePrefix || "切分").trim() || "切分";
  const tiles: GridSplitTile[] = [];
  let done = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = Math.floor((c * imgW) / cols);
      const sy = Math.floor((r * imgH) / rows);
      const sw = Math.floor(((c + 1) * imgW) / cols) - sx;
      const sh = Math.floor(((r + 1) * imgH) / rows) - sy;
      const blob = await tileBlobFromCanvas(img, sx, sy, sw, sh, usePng);
      const ext = usePng ? "png" : "jpg";
      const title = `${prefix} ${r + 1}-${c + 1}`;
      const file = new File([blob], `${title}.${ext}`, {
        type: usePng ? "image/png" : "image/jpeg",
      });
      const asset = await uploadTileWithRetry({
        file,
        projectId: opts.projectId,
        title,
      });
      tiles.push({ row: r, col: c, asset });
      done += 1;
      opts.onProgress?.(done, total);
    }
  }

  return tiles;
}
