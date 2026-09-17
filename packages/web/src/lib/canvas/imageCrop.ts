import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";

/** 裁剪比例（含自由框选，不锁宽高比） */
export const CROP_ASPECT_RATIOS = [
  { value: "free", label: "自由" },
  { value: "original", label: "原图比例" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
] as const;

export type CropAspectRatio = (typeof CROP_ASPECT_RATIOS)[number]["value"];

/** 相对图片本体的归一化裁剪框（0–1） */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InlineImageCropState {
  aspectRatio: CropAspectRatio;
  rect: CropRect;
}

export const DEFAULT_CROP_RECT: CropRect = { x: 0.08, y: 0.08, w: 0.84, h: 0.84 };

export const DEFAULT_INLINE_IMAGE_CROP: InlineImageCropState = {
  aspectRatio: "original",
  rect: { ...DEFAULT_CROP_RECT },
};

const MIN_NORM = 0.08;

/**
 * 解析锁定宽高比。
 * `free` → null（拖动手柄可自由改宽高）；其余返回目标宽/高比。
 */
export function resolveCropAspect(
  aspect: CropAspectRatio,
  imageAspect: number
): number | null {
  if (aspect === "free") return null;
  if (aspect === "original") return Math.max(0.01, imageAspect);
  const [a, b] = aspect.split(":").map(Number);
  if (!a || !b) return Math.max(0.01, imageAspect);
  return a / b;
}

/** 在 0–1 画幅内居中放入指定宽高比的最大矩形 */
export function fitCenteredRect(aspect: number): CropRect {
  const a = Math.max(0.01, aspect);
  if (a >= 1) {
    const h = Math.min(1, 1 / a);
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = Math.min(1, a);
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** 约束裁剪框在画幅内，并保证最小尺寸 */
export function clampCropRect(rect: CropRect): CropRect {
  let w = Math.max(MIN_NORM, Math.min(1, rect.w));
  let h = Math.max(MIN_NORM, Math.min(1, rect.h));
  let x = Math.max(0, Math.min(1 - w, rect.x));
  let y = Math.max(0, Math.min(1 - h, rect.y));
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { x, y, w, h };
}

/**
 * 按锁定宽高比调整矩形（以对边为锚点时由调用方传入锚点逻辑）。
 * 这里做最终校正：若偏离目标比例，优先保宽调高，再 clamp。
 */
export function enforceCropAspect(rect: CropRect, aspect: number): CropRect {
  const a = Math.max(0.01, aspect);
  let { x, y, w, h } = clampCropRect(rect);
  const current = w / Math.max(0.0001, h);
  if (Math.abs(current - a) < 0.001) return { x, y, w, h };

  // 以中心为基准重算
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (w / a <= 1 && w / a >= MIN_NORM) {
    h = w / a;
  } else {
    h = Math.min(1, Math.max(MIN_NORM, h));
    w = h * a;
    if (w > 1) {
      w = 1;
      h = w / a;
    }
  }
  x = cx - w / 2;
  y = cy - h / 2;
  return clampCropRect({ x, y, w, h });
}

/** object-cover 显示区域映射到原图像素裁剪框 */
export function cropRectToNaturalPixels(
  rect: CropRect,
  displayW: number,
  displayH: number,
  naturalW: number,
  naturalH: number
): { x: number; y: number; w: number; h: number } {
  const dw = Math.max(1, displayW);
  const dh = Math.max(1, displayH);
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const scale = Math.max(dw / nw, dh / nh);
  const shownW = dw / scale;
  const shownH = dh / scale;
  const ox = (nw - shownW) / 2;
  const oy = (nh - shownH) / 2;
  const x = Math.round(ox + rect.x * shownW);
  const y = Math.round(oy + rect.y * shownH);
  const w = Math.max(1, Math.round(rect.w * shownW));
  const h = Math.max(1, Math.round(rect.h * shownH));
  return {
    x: Math.max(0, Math.min(nw - 1, x)),
    y: Math.max(0, Math.min(nh - 1, y)),
    w: Math.max(1, Math.min(nw - x, w)),
    h: Math.max(1, Math.min(nh - y, h)),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("节点图片加载失败，无法裁剪"));
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("裁剪导出失败"))),
      "image/png"
    );
  });
}

/**
 * 按裁剪框烘焙新图并上传。
 * displayW/H 为节点图片本体显示尺寸（与覆盖层一致）。
 */
export async function bakeImageCropToAsset(params: {
  projectId: string;
  nodeId: string;
  sourceUrl: string;
  rect: CropRect;
  displayWidth: number;
  displayHeight: number;
  title?: string;
}): Promise<{ id: string; fileUrl: string; title: string }> {
  const loadUrl = canvasStreamUrlFromUrl(params.sourceUrl) || params.sourceUrl;
  const image = await loadImage(loadUrl);
  const nw = image.naturalWidth || image.width;
  const nh = image.naturalHeight || image.height;
  const pixel = cropRectToNaturalPixels(
    params.rect,
    params.displayWidth,
    params.displayHeight,
    nw,
    nh
  );

  const canvas = document.createElement("canvas");
  canvas.width = pixel.w;
  canvas.height = pixel.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片裁剪");
  ctx.drawImage(image, pixel.x, pixel.y, pixel.w, pixel.h, 0, 0, pixel.w, pixel.h);

  const blob = await canvasToPngBlob(canvas);
  const title = params.title?.trim() || "裁剪";
  const file = new File([blob], `crop-${params.nodeId}-${Date.now()}.png`, {
    type: "image/png",
  });
  const asset = await uploadAsset({
    file,
    projectId: params.projectId,
    category: "image",
    subcategory: NODE_IMAGE_SUBCATEGORY,
    title,
  });
  if (!asset.fileUrl) throw new Error("裁剪上传后未返回地址");
  return { id: asset.id, fileUrl: asset.fileUrl, title: asset.title || title };
}
