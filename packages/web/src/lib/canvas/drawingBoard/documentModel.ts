import type { DrawStroke, DrawingBackground, DrawingLayerFillColor } from "./types";
import { isLayerFillTransparent } from "./types";
import type { DrawingReferenceLayer } from "./draftStorage";

export type DrawingLayerType = "reference" | "vector" | "image";

/** 画板图层 */
export interface DrawingLayer {
  id: string;
  name: string;
  type: DrawingLayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** 矢量图层底色（透明 / 任意 hex 色） */
  fillColor?: DrawingLayerFillColor;
  strokes: DrawStroke[];
  /** 参考层 / AI 图片层共用图片指针 */
  reference?: DrawingReferenceLayer | null;
}

/** 画板文档（v2，含多图层） */
export interface DrawingDocument {
  version: 2;
  canvasWidth: number;
  canvasHeight: number;
  background: DrawingBackground;
  layers: DrawingLayer[];
  activeLayerId: string;
}

export function newLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultDocument(
  width = 1024,
  height = 1024
): DrawingDocument {
  const referenceId = newLayerId();
  const lineartId = newLayerId();
  const colorId = newLayerId();
  return {
    version: 2,
    canvasWidth: width,
    canvasHeight: height,
    background: "transparent",
    activeLayerId: lineartId,
    layers: [
      {
        id: referenceId,
        name: "参考",
        type: "reference",
        visible: true,
        locked: true,
        opacity: 0.45,
        strokes: [],
        reference: null,
      },
      {
        id: lineartId,
        name: "线稿",
        type: "vector",
        visible: true,
        locked: false,
        opacity: 1,
        fillColor: "transparent",
        strokes: [],
      },
      {
        id: colorId,
        name: "上色",
        type: "vector",
        visible: true,
        locked: false,
        opacity: 1,
        fillColor: "transparent",
        strokes: [],
      },
    ],
  };
}

export function cloneDocument(doc: DrawingDocument): DrawingDocument {
  return JSON.parse(JSON.stringify(doc)) as DrawingDocument;
}

export function getActiveLayer(doc: DrawingDocument): DrawingLayer | null {
  return doc.layers.find((l) => l.id === doc.activeLayerId) ?? null;
}

export function getActiveVectorLayer(doc: DrawingDocument): DrawingLayer | null {
  const layer = getActiveLayer(doc);
  if (!layer || layer.type !== "vector" || layer.locked) return null;
  return layer;
}

export function findLayer(doc: DrawingDocument, layerId: string): DrawingLayer | undefined {
  return doc.layers.find((l) => l.id === layerId);
}

/** v1 扁平快照迁移为 v2 文档 */
export function migrateFlatSnapshotToDocument(input: {
  canvasWidth: number;
  canvasHeight: number;
  background: DrawingBackground;
  strokes: DrawStroke[];
  reference: DrawingReferenceLayer | null;
}): DrawingDocument {
  const doc = createDefaultDocument(input.canvasWidth, input.canvasHeight);
  doc.background = input.background;
  const refLayer = doc.layers.find((l) => l.type === "reference");
  const lineart = doc.layers.find((l) => l.name === "线稿");
  if (refLayer && input.reference) {
    refLayer.reference = input.reference;
    refLayer.opacity = input.reference.opacity;
  }
  if (lineart) {
    lineart.strokes = [...input.strokes];
    doc.activeLayerId = lineart.id;
  }
  return doc;
}

export function documentHasContent(doc: DrawingDocument): boolean {
  if (doc.background !== "transparent") return true;
  return doc.layers.some(
    (layer) =>
      layer.reference != null ||
      layer.strokes.length > 0 ||
      (layer.type === "vector" && !isLayerFillTransparent(layer.fillColor)) ||
      (layer.type === "image" && layer.reference != null)
  );
}

/** 图片层（参考 / AI 结果）是否可渲染 */
export function isImageBearingLayer(layer: DrawingLayer): boolean {
  return layer.type === "reference" || layer.type === "image";
}

export function layerCanDraw(layer: DrawingLayer | null | undefined): boolean {
  return Boolean(layer && layer.type === "vector" && layer.visible && !layer.locked);
}
