import type { DrawingDocument, DrawingLayer } from "./documentModel";
import type { DrawStroke, DrawingBackground } from "./types";
import { isLayerFillTransparent } from "./types";
import type { DrawingReferenceLayer } from "./draftStorage";
import { isImageBearingLayer } from "./documentModel";
import { isFreehandTool, isShapeTool } from "./types";

function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.size;

  // 橡皮 / 擦除挖空：destination-out
  if (stroke.tool === "eraser" || stroke.punch) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.globalAlpha = 1;
    return;
  }

  ctx.globalCompositeOperation = "source-over";
  const alpha = Math.max(0.05, Math.min(1, stroke.opacity));
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
}

function drawFreehandStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  const { points } = stroke;
  if (points.length === 0) return;

  ctx.save();
  applyStrokeStyle(ctx, stroke);

  if (points.length === 1) {
    const p = points[0]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i]!;
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

function normalizedRect(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return { x, y, w, h };
}

function drawShapeStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  if (stroke.points.length < 2) return;
  const start = stroke.points[0]!;
  const end = stroke.points[stroke.points.length - 1]!;

  ctx.save();
  applyStrokeStyle(ctx, stroke);

  if (stroke.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const { x, y, w, h } = normalizedRect(start, end);
  if (w < 0.5 && h < 0.5) {
    ctx.restore();
    return;
  }

  if (stroke.tool === "rect") {
    // 未填充矩形用虚线描边，贴近截图「框选」观感（画板填充矩形仍为实线）
    if (!stroke.filled && !stroke.punch) {
      const dash = Math.max(4, stroke.size * 2);
      ctx.setLineDash([dash, dash * 0.75]);
    }
    if (stroke.filled || stroke.punch) ctx.fillRect(x, y, w, h);
    else ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }

  if (stroke.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
    if (stroke.filled) ctx.fill();
    else ctx.stroke();
    ctx.restore();
  }
}

function drawTextStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  const text = stroke.text?.trim();
  const point = stroke.points[0];
  if (!text || !point) return;

  ctx.save();
  applyStrokeStyle(ctx, stroke);
  const fontSize = stroke.fontSize ?? Math.max(12, stroke.size * 3);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(text, point.x, point.y);
  ctx.restore();
}

/** 在画布上下文上绘制单条记录 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawStroke) {
  if (stroke.tool === "text") {
    drawTextStroke(ctx, stroke);
    return;
  }
  if (isFreehandTool(stroke.tool)) {
    drawFreehandStroke(ctx, stroke);
    return;
  }
  if (isShapeTool(stroke.tool)) {
    drawShapeStroke(ctx, stroke);
  }
}

function fillBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: DrawingBackground
) {
  ctx.clearRect(0, 0, width, height);
  if (background === "transparent") return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** 参考图 contain 居中绘制 */
export function drawReferenceImage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  image: HTMLImageElement,
  opacity: number
) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (iw <= 0 || ih <= 0) return;

  const scale = Math.min(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.max(0.05, Math.min(1, opacity));
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.restore();
}

function renderVectorLayerToContext(
  ctx: CanvasRenderingContext2D,
  layer: DrawingLayer,
  width: number,
  height: number,
  previewStroke?: DrawStroke | null
) {
  if (typeof document === "undefined") return;
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;

  const fill = layer.fillColor ?? "transparent";
  if (!isLayerFillTransparent(fill)) {
    offCtx.save();
    offCtx.globalCompositeOperation = "source-over";
    offCtx.globalAlpha = 1;
    offCtx.fillStyle = fill;
    offCtx.fillRect(0, 0, width, height);
    offCtx.restore();
  }

  for (const stroke of layer.strokes) {
    drawStroke(offCtx, stroke);
  }
  if (previewStroke) {
    drawStroke(offCtx, previewStroke);
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.max(0.05, Math.min(1, layer.opacity));
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

export type DrawingExportMode = "all" | "active-layer";

export interface RenderDocumentOptions {
  document: DrawingDocument;
  referenceImages: Map<string, HTMLImageElement>;
  previewStroke?: DrawStroke | null;
  previewLayerId?: string | null;
  exportMode?: DrawingExportMode;
  /** 导出 PNG 时尊重参考层 includeInExport */
  forExport?: boolean;
}

/** 按图层顺序渲染画板文档 */
export function renderDocument(
  ctx: CanvasRenderingContext2D,
  options: RenderDocumentOptions
) {
  const {
    document: doc,
    referenceImages,
    previewStroke = null,
    previewLayerId = null,
    exportMode = "all",
    forExport = false,
  } = options;

  fillBackground(ctx, doc.canvasWidth, doc.canvasHeight, doc.background);

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (exportMode === "active-layer" && layer.id !== doc.activeLayerId) continue;

    // 参考层与 AI 图片层：按图层不透明度贴图
    if (isImageBearingLayer(layer)) {
      const ref = layer.reference as DrawingReferenceLayer | null | undefined;
      if (!ref) continue;
      if (forExport && !ref.includeInExport) continue;
      const image = referenceImages.get(layer.id);
      if (image) {
        drawReferenceImage(ctx, doc.canvasWidth, doc.canvasHeight, image, layer.opacity);
      }
      continue;
    }

    if (layer.type === "vector") {
      const preview = previewLayerId === layer.id ? previewStroke : null;
      renderVectorLayerToContext(
        ctx,
        layer,
        doc.canvasWidth,
        doc.canvasHeight,
        preview
      );
    }
  }
}

/** @deprecated 兼容旧扁平渲染 */
export interface RenderBoardOptions {
  background: DrawingBackground;
  strokes: DrawStroke[];
  previewStroke?: DrawStroke | null;
  referenceImage?: HTMLImageElement | null;
  referenceOpacity?: number;
  showReference?: boolean;
}

export function renderBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: RenderBoardOptions
) {
  const {
    background,
    strokes,
    previewStroke = null,
    referenceImage = null,
    referenceOpacity = 0.5,
    showReference = true,
  } = options;

  fillBackground(ctx, width, height, background);

  if (showReference && referenceImage) {
    drawReferenceImage(ctx, width, height, referenceImage, referenceOpacity);
  }

  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
  if (previewStroke) {
    drawStroke(ctx, previewStroke);
  }
}
