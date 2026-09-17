import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import { drawStroke } from "@/lib/canvas/drawingBoard/renderStrokes";
import type { DrawStroke } from "@/lib/canvas/drawingBoard/types";

/** 图片节点卡片内的轻量涂鸦；坐标始终使用原图像素，避免节点缩放后失真。 */
export interface InlineImageDrawing {
  sourceAssetId: string;
  imageWidth: number;
  imageHeight: number;
  strokes: DrawStroke[];
}

function isFinitePoint(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { x?: unknown; y?: unknown };
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** 读取并收紧工作流中的节点涂鸦数据，避免脏 JSON 进入 Canvas。 */
export function parseInlineImageDrawing(value: unknown): InlineImageDrawing | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<InlineImageDrawing>;
  if (!Array.isArray(record.strokes)) return null;
  const strokes = record.strokes.filter((stroke): stroke is DrawStroke => {
    if (!stroke || !Array.isArray(stroke.points) || !stroke.points.every(isFinitePoint)) {
      return false;
    }
    // 标注层支持画笔/擦除/矩形框/文字
    if (stroke.tool === "brush" || stroke.tool === "eraser" || stroke.tool === "rect") {
      return true;
    }
    if (stroke.tool === "text") {
      return typeof stroke.text === "string" && stroke.text.trim().length > 0;
    }
    return false;
  });
  return {
    sourceAssetId: String(record.sourceAssetId ?? ""),
    imageWidth: Math.max(1, Math.round(Number(record.imageWidth) || 1)),
    imageHeight: Math.max(1, Math.round(Number(record.imageHeight) || 1)),
    strokes,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("节点图片加载失败，无法合并绘制内容"));
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("绘制内容合并失败"))),
      "image/png"
    );
  });
}

/**
 * 将节点标注笔迹与原图合成并上传为新项目资产。
 * 无有效笔迹时返回 null（不上传）。
 */
export async function bakeInlineDrawingToAsset(params: {
  projectId: string;
  nodeId: string;
  nodeParams: Record<string, unknown>;
  sourceUrl: string;
  title?: string;
}): Promise<{ id: string; fileUrl: string; title: string } | null> {
  const drawing = parseInlineImageDrawing(params.nodeParams.inlineImageDrawing);
  const currentAssetId =
    String(params.nodeParams.assetId ?? "") || String(params.nodeParams.imageUrl ?? "");
  if (
    !drawing ||
    drawing.strokes.length === 0 ||
    (drawing.sourceAssetId && drawing.sourceAssetId !== currentAssetId)
  ) {
    return null;
  }

  const image = await loadImage(params.sourceUrl);
  const width = Math.max(1, image.naturalWidth || drawing.imageWidth);
  const height = Math.max(1, image.naturalHeight || drawing.imageHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持图片绘制合并");

  context.drawImage(image, 0, 0, width, height);
  // 笔迹先画在独立透明层，确保 eraser 只擦除笔迹，不会挖空原图。
  const overlay = document.createElement("canvas");
  overlay.width = width;
  overlay.height = height;
  const overlayContext = overlay.getContext("2d");
  if (!overlayContext) throw new Error("浏览器不支持图片绘制合并");
  const scaleX = width / Math.max(1, drawing.imageWidth);
  const scaleY = height / Math.max(1, drawing.imageHeight);
  overlayContext.save();
  overlayContext.scale(scaleX, scaleY);
  for (const stroke of drawing.strokes) drawStroke(overlayContext, stroke);
  overlayContext.restore();
  context.drawImage(overlay, 0, 0);

  const blob = await canvasToPngBlob(canvas);
  const title = params.title?.trim() || "标注图片";
  const file = new File([blob], `annotate-${params.nodeId}-${Date.now()}.png`, {
    type: "image/png",
  });
  const asset = await uploadAsset({
    file,
    projectId: params.projectId,
    category: "image",
    subcategory: NODE_IMAGE_SUBCATEGORY,
    title,
  });
  if (!asset.fileUrl) throw new Error("标注合成图上传后未返回地址");
  return { id: asset.id, fileUrl: asset.fileUrl, title };
}

/**
 * 若节点存在有效涂鸦，将原图与透明笔迹层合成为项目资产并返回其 URL；
 * 无涂鸦时保持原 sourceUrl，不改变原始上传资产。
 */
export async function mergeInlineDrawingForGeneration(params: {
  projectId: string;
  nodeId: string;
  nodeParams: Record<string, unknown>;
  sourceUrl: string;
}): Promise<string> {
  const baked = await bakeInlineDrawingToAsset({
    ...params,
    title: "节点绘制合成图",
  });
  return baked?.fileUrl ?? params.sourceUrl;
}
