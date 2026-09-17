"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cloneDocument,
  createDefaultDocument,
  documentHasContent,
  findLayer,
  getActiveVectorLayer,
  isImageBearingLayer,
  layerCanDraw,
  migrateFlatSnapshotToDocument,
  newLayerId,
  type DrawingDocument,
  type DrawingLayer,
} from "./documentModel";
import type { DrawingReferenceLayer } from "./draftStorage";
import type { DrawingBoardSnapshot } from "./draftStorage";
import {
  DRAWING_BOARD_HEIGHT,
  DRAWING_BOARD_WIDTH,
  type DrawStroke,
  type DrawingBackground,
  type DrawingTool,
  isFreehandTool,
  isShapeTool,
  newStrokeId,
} from "./types";
import { renderDocument, type DrawingExportMode } from "./renderStrokes";
import { hitTestStroke, strokeBounds, translateStroke } from "./strokeHitTest";

const MAX_HISTORY = 50;

function clientToCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
  return { x, y };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function resolvePressureSize(baseSize: number, pressure: number, enabled: boolean): number {
  if (!enabled) return baseSize;
  const p = pressure > 0 ? pressure : 1;
  return Math.max(1, baseSize * Math.max(0.15, Math.min(1, p)));
}

function mirrorX(x: number, w: number): number {
  return w - x;
}

function mirrorY(y: number, h: number): number {
  return h - y;
}

function mirrorStroke(
  stroke: DrawStroke,
  canvasWidth: number,
  canvasHeight: number,
  mode: "vertical" | "horizontal"
): DrawStroke {
  return {
    ...stroke,
    points: stroke.points.map((p) => ({
      x: mode === "vertical" ? mirrorX(p.x, canvasWidth) : p.x,
      y: mode === "horizontal" ? mirrorY(p.y, canvasHeight) : p.y,
    })),
  };
}

export function useDrawingBoardCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<DrawingDocument>(createDefaultDocument());
  const historyRef = useRef<DrawingDocument[]>([]);
  const redoRef = useRef<DrawingDocument[]>([]);
  const activeStrokeRef = useRef<DrawStroke | null>(null);
  const drawingRef = useRef(false);
  const referenceImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const [docTick, setDocTick] = useState(0);
  const bumpDoc = useCallback(() => setDocTick((n) => n + 1), []);

  const [tool, setTool] = useState<DrawingTool>("brush");
  const [color, setColor] = useState("#000000");
  const [brushSize, setBrushSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(32);
  const [shapeFilled, setShapeFilled] = useState(false);
  const [pressureEnabled, setPressureEnabled] = useState(true);
  const [symmetryVertical, setSymmetryVertical] = useState(false);
  const [symmetryHorizontal, setSymmetryHorizontal] = useState(false);
  const [exportMode, setExportMode] = useState<DrawingExportMode>("all");
  const [cloudRevision, setCloudRevision] = useState(0);
  const [viewScale, setViewScale] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [spacePanning, setSpacePanning] = useState(false);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const panDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const selectDragRef = useRef<{
    strokeId: string;
    startX: number;
    startY: number;
    origin: DrawStroke;
  } | null>(null);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingTextPoint, setPendingTextPoint] = useState<{ x: number; y: number } | null>(null);

  const document = documentRef.current;

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(redoRef.current.length > 0);
    // dirty = 打开/载入后用户有编辑（可撤销或可重做），不是「画布上有没有内容」
    setDirty(historyRef.current.length > 0 || redoRef.current.length > 0);
  }, []);

  /** 程序化载入参考图/草稿后清掉历史，避免误判为已编辑 */
  const markClean = useCallback(() => {
    historyRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setDirty(false);
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const doc = documentRef.current;
    renderDocument(ctx, {
      document: doc,
      referenceImages: referenceImagesRef.current,
      previewStroke: activeStrokeRef.current,
      previewLayerId: doc.activeLayerId,
      exportMode: "all",
    });
  }, []);

  const loadReferenceForLayer = useCallback(
    (layerId: string, url: string) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        referenceImagesRef.current.set(layerId, img);
        redraw();
        bumpDoc();
      };
      img.onerror = () => {
        referenceImagesRef.current.delete(layerId);
      };
      img.src = url;
    },
    [bumpDoc, redraw]
  );

  const reloadAllReferenceImages = useCallback(
    (doc: DrawingDocument) => {
      referenceImagesRef.current.clear();
      for (const layer of doc.layers) {
        if (isImageBearingLayer(layer) && layer.reference?.url) {
          loadReferenceForLayer(layer.id, layer.reference.url);
        }
      }
    },
    [loadReferenceForLayer]
  );

  const pushDocHistory = useCallback(() => {
    historyRef.current.push(cloneDocument(documentRef.current));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const resetBoard = useCallback(() => {
    documentRef.current = createDefaultDocument();
    historyRef.current = [];
    redoRef.current = [];
    activeStrokeRef.current = null;
    drawingRef.current = false;
    referenceImagesRef.current.clear();
    setPendingTextPoint(null);
    setTool("brush");
    setColor("#000000");
    setBrushSize(8);
    setOpacity(1);
    setFontSize(32);
    setShapeFilled(false);
    setPressureEnabled(true);
    setSymmetryVertical(false);
    setSymmetryHorizontal(false);
    setExportMode("all");
    setCloudRevision(0);
    setViewScale(1);
    setViewPan({ x: 0, y: 0 });
    setSelectedStrokeId(null);
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, redraw, syncHistoryFlags]);

  const loadSnapshot = useCallback(
    (snapshot: DrawingBoardSnapshot) => {
      const doc = cloneDocument(snapshot.document);
      // 兼容旧草稿：补齐缺失的 stroke.id
      for (const layer of doc.layers) {
        layer.strokes = layer.strokes.map((s) =>
          s.id ? s : { ...s, id: newStrokeId() }
        );
      }
      documentRef.current = doc;
      historyRef.current = [];
      redoRef.current = [];
      activeStrokeRef.current = null;
      setColor(snapshot.color);
      setBrushSize(snapshot.brushSize);
      setOpacity(snapshot.strokeOpacity);
      setFontSize(snapshot.fontSize);
      setPressureEnabled(snapshot.pressureEnabled);
      setSymmetryVertical(snapshot.symmetryVertical);
      setSymmetryHorizontal(snapshot.symmetryHorizontal);
      setCloudRevision(snapshot.cloudRevision);
      setPendingTextPoint(null);
      setSelectedStrokeId(null);
      reloadAllReferenceImages(documentRef.current);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, redraw, reloadAllReferenceImages, syncHistoryFlags]
  );

  const getSnapshot = useCallback((): DrawingBoardSnapshot => {
    return {
      document: cloneDocument(documentRef.current),
      color,
      brushSize,
      strokeOpacity: opacity,
      fontSize,
      pressureEnabled,
      symmetryVertical,
      symmetryHorizontal,
      cloudRevision,
    };
  }, [
    brushSize,
    cloudRevision,
    color,
    fontSize,
    opacity,
    pressureEnabled,
    symmetryHorizontal,
    symmetryVertical,
  ]);

  const getReferenceLayer = useCallback((): DrawingLayer | undefined => {
    return documentRef.current.layers.find((l) => l.type === "reference");
  }, []);

  const reference = getReferenceLayer()?.reference ?? null;

  const setReferenceLayer = useCallback(
    (layerData: DrawingReferenceLayer | null) => {
      pushDocHistory();
      const refLayer = documentRef.current.layers.find((l) => l.type === "reference");
      if (!refLayer) return;
      refLayer.reference = layerData;
      if (layerData) {
        refLayer.opacity = layerData.opacity;
        loadReferenceForLayer(refLayer.id, layerData.url);
      } else {
        referenceImagesRef.current.delete(refLayer.id);
      }
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, loadReferenceForLayer, pushDocHistory, redraw, syncHistoryFlags]
  );

  /**
   * 从资产导入参考图：空参考槽则填入，已有参考图则追加新层。
   * 不覆盖线稿/上色等绘制层，也不替换已有参考图层内容。
   */
  const importReferenceLayer = useCallback(
    (layerData: DrawingReferenceLayer) => {
      pushDocHistory();
      const layers = documentRef.current.layers;
      const emptyRef = layers.find((l) => l.type === "reference" && !l.reference);
      if (emptyRef) {
        emptyRef.reference = layerData;
        emptyRef.opacity = layerData.opacity;
        emptyRef.visible = true;
        emptyRef.locked = true;
        loadReferenceForLayer(emptyRef.id, layerData.url);
        // 选中以便在图层面板调透明度；不可绘制
        documentRef.current.activeLayerId = emptyRef.id;
      } else {
        const id = newLayerId();
        const refCount = layers.filter((l) => l.type === "reference").length;
        const layer: DrawingLayer = {
          id,
          name: `参考 ${refCount + 1}`,
          type: "reference",
          visible: true,
          locked: true,
          opacity: layerData.opacity,
          strokes: [],
          reference: layerData,
        };
        let lastRefIdx = -1;
        for (let i = 0; i < layers.length; i++) {
          if (layers[i]?.type === "reference") lastRefIdx = i;
        }
        if (lastRefIdx >= 0) {
          layers.splice(lastRefIdx + 1, 0, layer);
        } else {
          layers.unshift(layer);
        }
        loadReferenceForLayer(id, layerData.url);
        documentRef.current.activeLayerId = id;
      }
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, loadReferenceForLayer, pushDocHistory, redraw, syncHistoryFlags]
  );

  const updateReference = useCallback(
    (patch: Partial<DrawingReferenceLayer>) => {
      const refLayer = documentRef.current.layers.find((l) => l.type === "reference");
      if (!refLayer?.reference) return;
      refLayer.reference = { ...refLayer.reference, ...patch };
      if (patch.opacity != null) refLayer.opacity = patch.opacity;
      if (patch.url) loadReferenceForLayer(refLayer.id, patch.url);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, loadReferenceForLayer, redraw, syncHistoryFlags]
  );

  /** 按图层 id 更新参考图属性（多参考层时用） */
  const updateReferenceLayer = useCallback(
    (layerId: string, patch: Partial<DrawingReferenceLayer>) => {
      const layer = findLayer(documentRef.current, layerId);
      if (!layer || layer.type !== "reference" || !layer.reference) return;
      layer.reference = { ...layer.reference, ...patch };
      if (patch.opacity != null) layer.opacity = patch.opacity;
      if (patch.url) loadReferenceForLayer(layerId, patch.url);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, loadReferenceForLayer, redraw, syncHistoryFlags]
  );

  const setActiveLayerId = useCallback(
    (layerId: string) => {
      const layer = findLayer(documentRef.current, layerId);
      if (!layer) return;
      // 空参考占位不可选；有图的参考层 / AI 层可选中调透明度（仍不可绘制）
      if (layer.type === "reference" && !layer.reference) return;
      documentRef.current.activeLayerId = layerId;
      bumpDoc();
      redraw();
    },
    [bumpDoc, redraw]
  );

  const updateLayer = useCallback(
    (layerId: string, patch: Partial<DrawingLayer>) => {
      pushDocHistory();
      const layer = findLayer(documentRef.current, layerId);
      if (!layer) return;
      Object.assign(layer, patch);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]
  );

  const addVectorLayer = useCallback(() => {
    pushDocHistory();
    const id = newLayerId();
    documentRef.current.layers.push({
      id,
      name: `图层 ${documentRef.current.layers.filter((l) => l.type === "vector").length + 1}`,
      type: "vector",
      visible: true,
      locked: false,
      opacity: 1,
      fillColor: "transparent",
      strokes: [],
    });
    documentRef.current.activeLayerId = id;
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]);

  /** AI 生成结果：新增图片图层并加载贴图 */
  const addImageLayer = useCallback(
    (input: {
      name?: string;
      assetId: string;
      url: string;
      opacity?: number;
    }) => {
      pushDocHistory();
      const id = newLayerId();
      const aiCount = documentRef.current.layers.filter((l) => l.type === "image").length + 1;
      documentRef.current.layers.push({
        id,
        name: input.name?.trim() || `AI ${aiCount}`,
        type: "image",
        visible: true,
        locked: false,
        opacity: input.opacity ?? 1,
        strokes: [],
        reference: {
          assetId: input.assetId,
          url: input.url,
          opacity: input.opacity ?? 1,
          includeInExport: true,
        },
      });
      documentRef.current.activeLayerId = id;
      loadReferenceForLayer(id, input.url);
      syncHistoryFlags();
      bumpDoc();
      redraw();
      return id;
    },
    [bumpDoc, loadReferenceForLayer, pushDocHistory, redraw, syncHistoryFlags]
  );

  const removeLayer = useCallback(
    (layerId: string) => {
      const layer = findLayer(documentRef.current, layerId);
      if (!layer) return;
      // 空参考占位保留；已导入图片的参考层可删；矢量层至少保留一层；AI 层可删
      if (layer.type === "reference") {
        if (!layer.reference) return;
        const refs = documentRef.current.layers.filter((l) => l.type === "reference");
        // 仅一层参考时清空图片，保留占位槽，避免文档结构丢失
        if (refs.length <= 1) {
          pushDocHistory();
          layer.reference = null;
          referenceImagesRef.current.delete(layerId);
          const next =
            documentRef.current.layers.find((l) => l.type === "vector") ??
            documentRef.current.layers.find((l) => l.type === "image");
          if (next) documentRef.current.activeLayerId = next.id;
          syncHistoryFlags();
          bumpDoc();
          redraw();
          return;
        }
      }
      if (layer.type === "vector") {
        const vectors = documentRef.current.layers.filter((l) => l.type === "vector");
        if (vectors.length <= 1) return;
      }
      pushDocHistory();
      documentRef.current.layers = documentRef.current.layers.filter((l) => l.id !== layerId);
      referenceImagesRef.current.delete(layerId);
      if (documentRef.current.activeLayerId === layerId) {
        const next =
          documentRef.current.layers.find((l) => l.type === "vector") ??
          documentRef.current.layers.find((l) => l.type === "image") ??
          documentRef.current.layers.find((l) => l.type === "reference" && l.reference);
        if (next) documentRef.current.activeLayerId = next.id;
      }
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]
  );

  const moveLayer = useCallback(
    (layerId: string, direction: "up" | "down") => {
      const layers = documentRef.current.layers;
      const idx = layers.findIndex((l) => l.id === layerId);
      if (idx < 0) return;
      const target = direction === "up" ? idx + 1 : idx - 1;
      if (target < 0 || target >= layers.length) return;
      pushDocHistory();
      const [item] = layers.splice(idx, 1);
      layers.splice(target, 0, item!);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]
  );

  const setBackground = useCallback(
    (bg: DrawingBackground) => {
      pushDocHistory();
      documentRef.current.background = bg;
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]
  );

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push(cloneDocument(documentRef.current));
    documentRef.current = prev;
    reloadAllReferenceImages(documentRef.current);
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, redraw, reloadAllReferenceImages, syncHistoryFlags]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(cloneDocument(documentRef.current));
    documentRef.current = next;
    reloadAllReferenceImages(documentRef.current);
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, redraw, reloadAllReferenceImages, syncHistoryFlags]);

  const clearCanvas = useCallback(() => {
    pushDocHistory();
    documentRef.current = createDefaultDocument(
      documentRef.current.canvasWidth,
      documentRef.current.canvasHeight
    );
    referenceImagesRef.current.clear();
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]);

  const appendStrokesToActiveLayer = useCallback(
    (strokes: DrawStroke[]) => {
      const layer = getActiveVectorLayer(documentRef.current);
      if (!layer) return;
      pushDocHistory();
      layer.strokes.push(...strokes);
      syncHistoryFlags();
      bumpDoc();
      redraw();
    },
    [bumpDoc, pushDocHistory, redraw, syncHistoryFlags]
  );

  const buildSymmetryStrokes = useCallback(
    (stroke: DrawStroke): DrawStroke[] => {
      const doc = documentRef.current;
      const withIds = (s: DrawStroke): DrawStroke => ({
        ...s,
        id: s.id || newStrokeId(),
      });
      const base = withIds(stroke);
      const list = [base];
      if (symmetryVertical) {
        list.push(withIds(mirrorStroke(base, doc.canvasWidth, doc.canvasHeight, "vertical")));
      }
      if (symmetryHorizontal) {
        list.push(withIds(mirrorStroke(base, doc.canvasWidth, doc.canvasHeight, "horizontal")));
      }
      if (symmetryVertical && symmetryHorizontal) {
        list.push(
          withIds(
            mirrorStroke(
              mirrorStroke(base, doc.canvasWidth, doc.canvasHeight, "vertical"),
              doc.canvasWidth,
              doc.canvasHeight,
              "horizontal"
            )
          )
        );
      }
      return list;
    },
    [symmetryHorizontal, symmetryVertical]
  );

  const addTextStroke = useCallback(
    (text: string, point: { x: number; y: number }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const stroke: DrawStroke = {
        id: newStrokeId(),
        tool: "text",
        color,
        size: brushSize,
        opacity,
        fontSize,
        text: trimmed,
        points: [point],
      };
      appendStrokesToActiveLayer(buildSymmetryStrokes(stroke));
      setPendingTextPoint(null);
    },
    [appendStrokesToActiveLayer, brushSize, buildSymmetryStrokes, color, fontSize, opacity]
  );

  const exportPngBlob = useCallback(async (): Promise<Blob> => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error("画板未就绪");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画板未就绪");

    renderDocument(ctx, {
      document: documentRef.current,
      referenceImages: referenceImagesRef.current,
      exportMode,
      forExport: true,
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
    redraw();
    if (!blob) throw new Error("导出失败");
    return blob;
  }, [exportMode, redraw]);

  const resizeCanvas = useCallback(
    (width: number, height: number, clearContent: boolean) => {
      if (clearContent) {
        documentRef.current = createDefaultDocument(width, height);
        referenceImagesRef.current.clear();
        historyRef.current = [];
        redoRef.current = [];
      } else {
        documentRef.current.canvasWidth = width;
        documentRef.current.canvasHeight = height;
      }
      syncHistoryFlags();
      bumpDoc();
    },
    [bumpDoc, syncHistoryFlags]
  );

  const beginStroke = useCallback(
    (point: { x: number; y: number }, pressure: number) => {
      const layer = getActiveVectorLayer(documentRef.current);
      if (!layerCanDraw(layer)) return;
      const size = resolvePressureSize(brushSize, pressure, pressureEnabled && tool === "brush");
      activeStrokeRef.current = {
        id: newStrokeId(),
        tool,
        color,
        size,
        opacity,
        filled: isShapeTool(tool) ? shapeFilled : undefined,
        points: isShapeTool(tool) ? [point, point] : [point],
      };
      drawingRef.current = true;
    },
    [brushSize, color, opacity, pressureEnabled, shapeFilled, tool]
  );

  const updateShapeEnd = useCallback(
    (point: { x: number; y: number }) => {
      const stroke = activeStrokeRef.current;
      if (!stroke || !isShapeTool(stroke.tool)) return;
      if (stroke.points.length === 1) stroke.points.push(point);
      else stroke.points[1] = point;
      redraw();
    },
    [redraw]
  );

  const appendPoint = useCallback(
    (point: { x: number; y: number }, pressure: number) => {
      const stroke = activeStrokeRef.current;
      if (!stroke || !isFreehandTool(stroke.tool)) return;
      if (stroke.tool === "brush" && pressureEnabled) {
        stroke.size = resolvePressureSize(brushSize, pressure, true);
      }
      const last = stroke.points[stroke.points.length - 1];
      if (last && last.x === point.x && last.y === point.y) return;
      stroke.points.push(point);
      redraw();
    },
    [brushSize, pressureEnabled, redraw]
  );

  const endStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (!stroke || stroke.points.length === 0) return;

    if (isShapeTool(stroke.tool)) {
      if (stroke.points.length < 2) return;
      const start = stroke.points[0]!;
      const end = stroke.points[stroke.points.length - 1]!;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
      appendStrokesToActiveLayer(buildSymmetryStrokes({ ...stroke, points: [start, end] }));
      return;
    }

    if (isFreehandTool(stroke.tool)) {
      if (stroke.tool === "brush" && (symmetryVertical || symmetryHorizontal)) {
        appendStrokesToActiveLayer(buildSymmetryStrokes(stroke));
      } else {
        appendStrokesToActiveLayer([stroke]);
      }
    }
  }, [appendStrokesToActiveLayer, buildSymmetryStrokes, symmetryHorizontal, symmetryVertical]);

  const sampleColorAt = useCallback((point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(point.x)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(point.y)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    if (data[3] === 0) return;
    setColor(rgbToHex(data[0]!, data[1]!, data[2]!));
    setTool("brush");
  }, []);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const doc = documentRef.current;
    if (canvas.width !== doc.canvasWidth || canvas.height !== doc.canvasHeight) {
      canvas.width = doc.canvasWidth;
      canvas.height = doc.canvasHeight;
    }
    redraw();
  }, [redraw]);

  const activeDrawLayer = getActiveVectorLayer(documentRef.current);
  const canDrawOnActiveLayer = layerCanDraw(activeDrawLayer);
  const isPanningTool = tool === "hand" || spacePanning;

  const selectedStrokeBounds = (() => {
    if (!selectedStrokeId || !activeDrawLayer) return null;
    const stroke = activeDrawLayer.strokes.find((s) => s.id === selectedStrokeId);
    return stroke ? strokeBounds(stroke) : null;
  })();

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = clientToCanvas(canvas, e.clientX, e.clientY);
      if (!point) return;

      if (tool === "hand" || spacePanning) {
        panDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewPan.x,
          panY: viewPan.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      const drawLayer = getActiveVectorLayer(documentRef.current);
      if (!layerCanDraw(drawLayer)) return;

      if (tool === "select") {
        const hit = hitTestStroke(drawLayer!.strokes, point);
        setSelectedStrokeId(hit?.id ?? null);
        if (hit) {
          selectDragRef.current = {
            strokeId: hit.id,
            startX: point.x,
            startY: point.y,
            origin: JSON.parse(JSON.stringify(hit)) as DrawStroke,
          };
          pushDocHistory();
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        bumpDoc();
        return;
      }

      if (tool === "fill") {
        pushDocHistory();
        drawLayer!.fillColor = color;
        syncHistoryFlags();
        bumpDoc();
        redraw();
        return;
      }

      if (tool === "text") {
        setPendingTextPoint(point);
        return;
      }
      if (tool === "eyedropper") {
        sampleColorAt(point);
        return;
      }

      setSelectedStrokeId(null);
      e.currentTarget.setPointerCapture(e.pointerId);
      beginStroke(point, e.pressure);
    },
    [
      beginStroke,
      bumpDoc,
      color,
      pushDocHistory,
      redraw,
      sampleColorAt,
      spacePanning,
      syncHistoryFlags,
      tool,
      viewPan.x,
      viewPan.y,
    ]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.stopPropagation();

      if (panDragRef.current && (tool === "hand" || spacePanning)) {
        const drag = panDragRef.current;
        setViewPan({
          x: drag.panX + (e.clientX - drag.x),
          y: drag.panY + (e.clientY - drag.y),
        });
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = clientToCanvas(canvas, e.clientX, e.clientY);
      if (!point) return;

      if (selectDragRef.current && tool === "select") {
        const drag = selectDragRef.current;
        const layer = getActiveVectorLayer(documentRef.current);
        if (!layer) return;
        const idx = layer.strokes.findIndex((s) => s.id === drag.strokeId);
        if (idx < 0) return;
        const dx = point.x - drag.startX;
        const dy = point.y - drag.startY;
        layer.strokes[idx] = translateStroke(drag.origin, dx, dy);
        bumpDoc();
        redraw();
        return;
      }

      if (!drawingRef.current) return;
      const stroke = activeStrokeRef.current;
      if (!stroke) return;
      if (isShapeTool(stroke.tool)) updateShapeEnd(point);
      else appendPoint(point, e.pressure);
    },
    [appendPoint, bumpDoc, redraw, spacePanning, tool, updateShapeEnd]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.stopPropagation();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      panDragRef.current = null;
      if (selectDragRef.current) {
        selectDragRef.current = null;
        syncHistoryFlags();
      }
      endStroke();
    },
    [endStroke, syncHistoryFlags]
  );

  const onPointerLeave = useCallback(() => {
    if (selectDragRef.current) {
      selectDragRef.current = null;
      syncHistoryFlags();
    }
    endStroke();
  }, [endStroke, syncHistoryFlags]);

  const onViewportWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setViewScale((s) => Math.max(0.25, Math.min(4, s + delta)));
  }, []);

  const onViewportPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!(tool === "hand" || spacePanning)) return;
      panDragRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewPan.x,
        panY: viewPan.y,
      };
    },
    [spacePanning, tool, viewPan.x, viewPan.y]
  );

  const onViewportPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = panDragRef.current;
    if (!drag) return;
    setViewPan({
      x: drag.panX + (e.clientX - drag.x),
      y: drag.panY + (e.clientY - drag.y),
    });
  }, []);

  const onViewportPointerUp = useCallback(() => {
    panDragRef.current = null;
  }, []);

  const resetViewport = useCallback(() => {
    setViewScale(1);
    setViewPan({ x: 0, y: 0 });
  }, []);

  const deleteSelectedStroke = useCallback(() => {
    if (!selectedStrokeId) return;
    const layer = getActiveVectorLayer(documentRef.current);
    if (!layer) return;
    pushDocHistory();
    layer.strokes = layer.strokes.filter((s) => s.id !== selectedStrokeId);
    setSelectedStrokeId(null);
    syncHistoryFlags();
    bumpDoc();
    redraw();
  }, [bumpDoc, pushDocHistory, redraw, selectedStrokeId, syncHistoryFlags]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePanning(true);
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStrokeId) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        deleteSelectedStroke();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePanning(false);
        panDragRef.current = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [deleteSelectedStroke, selectedStrokeId]);

  useLayoutEffect(() => {
    syncCanvasSize();
  }, [docTick, syncCanvasSize, document.canvasWidth, document.canvasHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      syncCanvasSize();
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [docTick, syncCanvasSize]);

  useEffect(() => {
    syncHistoryFlags();
    redraw();
  }, [docTick, redraw, syncHistoryFlags]);

  return {
    canvasRef,
    document,
    docTick,
    canDrawOnActiveLayer,
    activeDrawLayer,
    tool,
    setTool,
    color,
    setColor,
    brushSize,
    setBrushSize,
    opacity,
    setOpacity,
    fontSize,
    setFontSize,
    shapeFilled,
    setShapeFilled,
    background: document.background,
    setBackground,
    canvasWidth: document.canvasWidth,
    canvasHeight: document.canvasHeight,
    reference,
    setReferenceLayer,
    /** 导入参考：空槽填入 / 已有则追加新层，不覆盖绘制层与已有参考 */
    importReferenceLayer,
    updateReference,
    updateReferenceLayer,
    pressureEnabled,
    setPressureEnabled,
    symmetryVertical,
    setSymmetryVertical,
    symmetryHorizontal,
    setSymmetryHorizontal,
    exportMode,
    setExportMode,
    cloudRevision,
    setCloudRevision,
    viewScale,
    viewPan,
    spacePanning,
    isPanningTool,
    selectedStrokeId,
    selectedStrokeBounds,
    deleteSelectedStroke,
    onViewportWheel,
    onViewportPointerDown,
    onViewportPointerMove,
    onViewportPointerUp,
    resetViewport,
    setActiveLayerId,
    updateLayer,
    addVectorLayer,
    addImageLayer,
    removeLayer,
    moveLayer,
    resizeCanvas,
    canUndo,
    canRedo,
    dirty,
    /** 当前画板是否有可导出内容（与 dirty「是否改过」分离） */
    hasContent: documentHasContent(document),
    markClean,
    pendingTextPoint,
    setPendingTextPoint,
    addTextStroke,
    loadSnapshot,
    getSnapshot,
    migrateFromFlat: migrateFlatSnapshotToDocument,
    undo,
    redo,
    clearCanvas,
    resetBoard,
    exportPngBlob,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}
