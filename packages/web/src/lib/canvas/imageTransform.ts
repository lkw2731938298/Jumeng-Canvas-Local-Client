import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import { MIN_BODY_HEIGHT, NODE_TITLE_HEIGHT } from "@/lib/canvas/nodeSizing";

export interface InlineImageTransformState {
  /** 顺时针旋转角度（0–359） */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  /** 进入旋转时节点卡片宽度（用于旋转后 AABB 自适应放大） */
  baseWidth: number;
  /** 进入旋转时内容区高度（不含标题栏） */
  baseBodyHeight: number;
}

export const DEFAULT_INLINE_IMAGE_TRANSFORM: InlineImageTransformState = {
  rotation: 0,
  flipH: false,
  flipV: false,
  baseWidth: 320,
  baseBodyHeight: 240,
};

/** 规范化到 0–359 整数度 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** 是否相对原图有实际变换 */
export function hasImageTransform(t: InlineImageTransformState | null | undefined): boolean {
  if (!t) return false;
  return normalizeRotation(t.rotation) !== 0 || t.flipH || t.flipV;
}

/** 顺时针旋转 90° */
export function nextRotation90(rotation: number): number {
  return normalizeRotation(rotation + 90);
}

/** 旋转后包围盒尺寸（任意角度） */
export function rotatedBounds(srcW: number, srcH: number, rotationDeg: number): {
  width: number;
  height: number;
} {
  const rad = (normalizeRotation(rotationDeg) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.max(1, Math.ceil(srcW * cos + srcH * sin)),
    height: Math.max(1, Math.ceil(srcW * sin + srcH * cos)),
  };
}

/**
 * 旋转预览时节点卡片应有的宽高（含标题栏）。
 * 镜像不改变 AABB，仅旋转扩大卡片以完整展示图片。
 */
export function nodeSizeForImageTransform(
  t: Pick<InlineImageTransformState, "rotation" | "baseWidth" | "baseBodyHeight">
): { width: number; height: number } {
  const baseW = Math.max(1, Math.round(t.baseWidth || DEFAULT_INLINE_IMAGE_TRANSFORM.baseWidth));
  const baseH = Math.max(
    MIN_BODY_HEIGHT,
    Math.round(t.baseBodyHeight || DEFAULT_INLINE_IMAGE_TRANSFORM.baseBodyHeight)
  );
  const bounds = rotatedBounds(baseW, baseH, t.rotation);
  return {
    width: bounds.width,
    height: NODE_TITLE_HEIGHT + bounds.height,
  };
}

/** 节点预览用 CSS transform（与 bake 一致：先翻转再旋转） */
export function imageTransformCss(t: InlineImageTransformState): string {
  const sx = t.flipH ? -1 : 1;
  const sy = t.flipV ? -1 : 1;
  // CSS 函数从右到左作用：scale 先于 rotate，对齐 canvas 的 rotate→scale CTM
  return `rotate(${normalizeRotation(t.rotation)}deg) scale(${sx}, ${sy})`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("节点图片加载失败，无法旋转"));
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("旋转图片导出失败"))),
      "image/png"
    );
  });
}

/**
 * 将旋转/镜像烘焙进新图并上传为项目资产。
 * 无变换时返回 null。
 */
export async function bakeImageTransformToAsset(params: {
  projectId: string;
  nodeId: string;
  sourceUrl: string;
  transform: InlineImageTransformState;
  title?: string;
}): Promise<{ id: string; fileUrl: string; title: string } | null> {
  if (!hasImageTransform(params.transform)) return null;

  const image = await loadImage(params.sourceUrl);
  const srcW = Math.max(1, image.naturalWidth || image.width);
  const srcH = Math.max(1, image.naturalHeight || image.height);
  const rotation = normalizeRotation(params.transform.rotation);
  const { width: outW, height: outH } = rotatedBounds(srcW, srcH, rotation);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持图片旋转");

  // 中心变换：翻转 → 旋转，与预览 CSS 观感一致
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(params.transform.flipH ? -1 : 1, params.transform.flipV ? -1 : 1);
  ctx.drawImage(image, -srcW / 2, -srcH / 2, srcW, srcH);

  const blob = await canvasToPngBlob(canvas);
  const title = params.title?.trim() || "旋转图片";
  const file = new File([blob], `rotate-${params.nodeId}-${Date.now()}.png`, {
    type: "image/png",
  });
  const asset = await uploadAsset({
    file,
    projectId: params.projectId,
    category: "image",
    subcategory: NODE_IMAGE_SUBCATEGORY,
    title,
  });
  if (!asset.fileUrl) throw new Error("旋转图片上传后未返回地址");
  return { id: asset.id, fileUrl: asset.fileUrl, title };
}
