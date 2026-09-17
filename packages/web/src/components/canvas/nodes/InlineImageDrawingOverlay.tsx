"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { drawStroke } from "@/lib/canvas/drawingBoard/renderStrokes";
import {
  isFreehandTool,
  isShapeTool,
  newStrokeId,
  type DrawStroke,
  type DrawingTool,
} from "@/lib/canvas/drawingBoard/types";
import { parseInlineImageDrawing } from "@/lib/canvas/inlineImageDrawing";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";
import { cn } from "@/lib/utils";

export const INLINE_IMAGE_DRAW_ACTION_EVENT = "canvas:inline-image-draw-action";

export type InlineImageDrawActionDetail = {
  nodeId: string;
  action: "undo" | "redo" | "clear";
};

interface InlineImageDrawingOverlayProps {
  nodeId: string;
  sourceAssetId: string;
  /** 原图 URL：擦除模式合成挖空预览时使用 */
  imageUrl: string;
  /** 节点内已渲染的 <img>，优先复用避免二次加载 CORS 失败 */
  imageRef?: RefObject<HTMLImageElement | null>;
  imageWidth: number;
  imageHeight: number;
  value: unknown;
  visible: boolean;
}

/** 拦截节点拖拽：仅 stopPropagation；勿 preventDefault，否则会打断 pointer 捕获与后续 move。 */
function blockNodeDrag(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function isInlineAnnotateTool(tool: string | null): tool is DrawingTool {
  return tool === "brush" || tool === "eraser" || tool === "rect" || tool === "text";
}

function strokeIsPunchOrRestore(stroke: DrawStroke): boolean {
  return Boolean(stroke.punch || stroke.restore);
}

/** 棋盘格透明底，挖空后可见 */
function fillCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const cell = Math.max(8, Math.round(Math.min(width, height) / 48));
  ctx.fillStyle = "#bdbdbd";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f0f0f0";
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      if (((x / cell) + (y / cell)) % 2 === 0) {
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

/** 沿笔迹把原图贴回（橡皮修正） */
function stampRestoreStroke(
  ctx: CanvasRenderingContext2D,
  stroke: DrawStroke,
  image: HTMLImageElement,
  width: number,
  height: number
) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskCtx = mask.getContext("2d");
  if (!maskCtx) return;
  // 不透明笔迹作蒙版
  drawStroke(maskCtx, {
    ...stroke,
    tool: "brush",
    punch: false,
    restore: false,
    color: "#ffffff",
    opacity: 1,
  });

  const piece = document.createElement("canvas");
  piece.width = width;
  piece.height = height;
  const pieceCtx = piece.getContext("2d");
  if (!pieceCtx) return;
  pieceCtx.drawImage(image, 0, 0, width, height);
  pieceCtx.globalCompositeOperation = "destination-in";
  pieceCtx.drawImage(mask, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(piece, 0, 0);
  ctx.restore();
}

/** 图片节点卡片内的透明笔迹层；画笔/框选/文字/擦除由标注工具条控制。 */
export function InlineImageDrawingOverlay({
  nodeId,
  sourceAssetId,
  imageUrl,
  imageRef,
  imageWidth,
  imageHeight,
  value,
  visible,
}: InlineImageDrawingOverlayProps) {
  const updateNodeParam = useCanvasStore((state) => state.updateNodeParam);
  const tool = useCanvasStore((state) => state.inlineImageDrawTool);
  const color = useCanvasStore((state) => state.inlineImageDrawColor);
  const size = useCanvasStore((state) => state.inlineImageDrawSize);
  const eraseMode = useCanvasStore((state) => state.inlineImageEraseMode);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 擦除离屏层：只在上面挖空，避免 destination-out 挖穿棋盘格 */
  const eraseLayerRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokesRef = useRef<DrawStroke[]>([]);
  const redoStackRef = useRef<DrawStroke[][]>([]);
  const activeStrokeRef = useRef<DrawStroke | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [activeStroke, setActiveStroke] = useState<DrawStroke | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [viewScale, setViewScale] = useState(1);
  /** 文字工具：点击图片后弹出输入框 */
  const [pendingText, setPendingText] = useState<{
    x: number;
    y: number;
    draft: string;
  } | null>(null);

  const drawActive = Boolean(visible && isInlineAnnotateTool(tool));
  // 尺寸未同步时回退到已解码原图，避免 1×1 画布导致笔迹不可见
  const canvasWidth = Math.max(
    1,
    imageWidth || sourceImage?.naturalWidth || sourceImageRef.current?.naturalWidth || 0
  );
  const canvasHeight = Math.max(
    1,
    imageHeight || sourceImage?.naturalHeight || sourceImageRef.current?.naturalHeight || 0
  );
  const textFontSize = Math.max(12, size * 3);
  const hasEraseStrokes =
    strokes.some(strokeIsPunchOrRestore) ||
    Boolean(activeStroke && strokeIsPunchOrRestore(activeStroke));
  // 擦除模式或已有挖空笔迹：合成原图+棋盘格，覆盖底层 <img>
  const compositeErase = eraseMode || hasEraseStrokes;

  const adoptSourceImage = useCallback((image: HTMLImageElement | null) => {
    sourceImageRef.current = image;
    setSourceImage(image);
  }, []);

  const syncActiveStroke = useCallback((stroke: DrawStroke | null) => {
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }, []);

  // 优先复用节点内已显示的 <img>；失败再用同源代理 URL 加载
  useEffect(() => {
    let cancelled = false;

    const tryAdoptDisplayed = () => {
      const el = imageRef?.current;
      if (el && el.complete && el.naturalWidth > 0) {
        adoptSourceImage(el);
        return true;
      }
      return false;
    };

    if (tryAdoptDisplayed()) {
      return () => {
        cancelled = true;
      };
    }

    const el = imageRef?.current;
    const onDisplayedLoad = () => {
      if (!cancelled) tryAdoptDisplayed();
    };
    el?.addEventListener("load", onDisplayedLoad);

    if (!imageUrl) {
      adoptSourceImage(null);
      return () => {
        cancelled = true;
        el?.removeEventListener("load", onDisplayedLoad);
      };
    }

    const loadUrl = canvasStreamUrlFromUrl(imageUrl) || imageUrl;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      adoptSourceImage(image);
    };
    image.onerror = () => {
      if (cancelled) return;
      if (!tryAdoptDisplayed()) adoptSourceImage(null);
    };
    image.src = loadUrl;

    return () => {
      cancelled = true;
      el?.removeEventListener("load", onDisplayedLoad);
    };
  }, [adoptSourceImage, imageRef, imageUrl, imageWidth, imageHeight, eraseMode]);

  useEffect(() => {
    const parsed = parseInlineImageDrawing(value);
    const next =
      parsed && (!parsed.sourceAssetId || parsed.sourceAssetId === sourceAssetId)
        ? parsed.strokes
        : [];
    // 同源更新（含本地面板撤销后回写）时跳过，避免冲掉 redo 栈、重复重置
    const same =
      next.length === strokesRef.current.length &&
      next.every((stroke, i) => stroke.id === strokesRef.current[i]?.id);
    if (same) return;
    // 绘制过程中勿被外部回写打断
    if (drawingRef.current) return;
    strokesRef.current = next;
    setStrokes(next);
    syncActiveStroke(null);
    drawingRef.current = false;
    redoStackRef.current = [];
    setPendingText(null);
  }, [sourceAssetId, syncActiveStroke, value]);

  // 切换工具时取消未提交的文字输入
  useEffect(() => {
    if (tool !== "text") setPendingText(null);
  }, [tool]);

  useEffect(() => {
    if (!pendingText) return;
    textInputRef.current?.focus();
  }, [pendingText]);

  // 同步显示缩放，使文字输入框字号与画布上的渲染一致
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => setViewScale(el.clientWidth / canvasWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasWidth]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const w = canvas.width;
    const h = canvas.height;
    context.clearRect(0, 0, w, h);

    const image = sourceImageRef.current;

    if (compositeErase) {
      // 棋盘格画在主画布；挖空只作用在离屏原图层，洞里露出棋盘格
      fillCheckerboard(context, w, h);

      let layer = eraseLayerRef.current;
      if (!layer) {
        layer = document.createElement("canvas");
        eraseLayerRef.current = layer;
      }
      if (layer.width !== w || layer.height !== h) {
        layer.width = w;
        layer.height = h;
      }
      const layerCtx = layer.getContext("2d");
      if (!layerCtx) return;

      layerCtx.clearRect(0, 0, w, h);
      if (image && image.naturalWidth > 0) {
        layerCtx.drawImage(image, 0, 0, w, h);
      }
      for (const stroke of strokes) {
        if (stroke.restore && image) {
          stampRestoreStroke(layerCtx, stroke, image, w, h);
        } else if (!stroke.restore) {
          drawStroke(layerCtx, stroke);
        }
      }
      if (activeStroke) {
        if (activeStroke.restore && image) {
          stampRestoreStroke(layerCtx, activeStroke, image, w, h);
        } else if (!activeStroke.restore) {
          drawStroke(layerCtx, activeStroke);
        }
      }

      context.save();
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.drawImage(layer, 0, 0);
      context.restore();
      return;
    }

    for (const stroke of strokes) drawStroke(context, stroke);
    if (activeStroke) drawStroke(context, activeStroke);
  }, [activeStroke, compositeErase, strokes]);

  useEffect(() => {
    redraw();
  }, [redraw, canvasWidth, canvasHeight, sourceImage]);

  const persist = useCallback(
    (next: DrawStroke[]) => {
      updateNodeParam(nodeId, "inlineImageDrawing", {
        sourceAssetId,
        imageWidth: canvasWidth,
        imageHeight: canvasHeight,
        strokes: next,
      });
    },
    [canvasHeight, canvasWidth, nodeId, sourceAssetId, updateNodeParam]
  );

  const pushStroke = useCallback(
    (stroke: DrawStroke) => {
      const next = [...strokesRef.current, stroke];
      strokesRef.current = next;
      setStrokes(next);
      redoStackRef.current = [];
      persist(next);
    },
    [persist]
  );

  const undo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    redoStackRef.current = [...redoStackRef.current, strokesRef.current];
    const next = strokesRef.current.slice(0, -1);
    strokesRef.current = next;
    setStrokes(next);
    persist(next);
  }, [persist]);

  const redo = useCallback(() => {
    const previous = redoStackRef.current[redoStackRef.current.length - 1];
    if (!previous) return;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    strokesRef.current = previous;
    setStrokes(previous);
    persist(previous);
  }, [persist]);

  const clear = useCallback(() => {
    if (strokesRef.current.length > 0) {
      redoStackRef.current = [...redoStackRef.current, strokesRef.current];
    }
    strokesRef.current = [];
    setStrokes([]);
    syncActiveStroke(null);
    setPendingText(null);
    persist([]);
  }, [persist, syncActiveStroke]);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<InlineImageDrawActionDetail>).detail;
      if (!detail || detail.nodeId !== nodeId) return;
      if (detail.action === "undo") undo();
      if (detail.action === "redo") redo();
      if (detail.action === "clear") clear();
    };
    window.addEventListener(INLINE_IMAGE_DRAW_ACTION_EVENT, onAction);
    return () => window.removeEventListener(INLINE_IMAGE_DRAW_ACTION_EVENT, onAction);
  }, [clear, nodeId, redo, undo]);

  const pointFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvasWidth,
        y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvasHeight,
      };
    },
    [canvasHeight, canvasWidth]
  );

  const commitPendingText = useCallback(() => {
    const anchor = pendingText;
    const draft = textInputRef.current?.value ?? anchor?.draft ?? "";
    setPendingText(null);
    if (!anchor) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    pushStroke({
      id: newStrokeId(),
      tool: "text",
      color,
      size,
      opacity: 1,
      points: [{ x: anchor.x, y: anchor.y }],
      text: trimmed,
      fontSize: Math.max(12, size * 3),
    });
  }, [color, pendingText, pushStroke, size]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isInlineAnnotateTool(tool)) return;
      blockNodeDrag(event);

      // 文字：点击落点后显示输入框
      if (tool === "text") {
        const point = pointFromEvent(event);
        setPendingText({ x: point.x, y: point.y, draft: "" });
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      const point = pointFromEvent(event);
      const inErase = useCanvasStore.getState().inlineImageEraseMode;

      if (isShapeTool(tool)) {
        syncActiveStroke({
          id: newStrokeId(),
          tool,
          color: inErase ? "#000000" : color,
          size,
          opacity: inErase ? 1 : 1,
          // 擦除：矩形框直接挖空；标注：仅描边
          filled: inErase,
          punch: inErase,
          points: [point, point],
        });
        return;
      }

      if (inErase && tool === "brush") {
        // 画笔：直接挖空原图
        syncActiveStroke({
          id: newStrokeId(),
          tool: "brush",
          color: "#000000",
          size,
          opacity: 1,
          punch: true,
          points: [point],
        });
        return;
      }

      if (inErase && tool === "eraser") {
        // 橡皮：沿笔迹贴回原图
        syncActiveStroke({
          id: newStrokeId(),
          tool: "brush",
          color: "#000000",
          size,
          opacity: 1,
          restore: true,
          points: [point],
        });
        return;
      }

      syncActiveStroke({
        id: newStrokeId(),
        tool,
        color,
        size,
        opacity: 1,
        points: [point],
      });
    },
    [color, pointFromEvent, size, syncActiveStroke, tool]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      blockNodeDrag(event);
      const point = pointFromEvent(event);
      const current = activeStrokeRef.current;
      if (!current) return;
      if (isShapeTool(current.tool)) {
        const start = current.points[0] ?? point;
        syncActiveStroke({ ...current, points: [start, point] });
        return;
      }
      if (isFreehandTool(current.tool) || current.punch || current.restore) {
        syncActiveStroke({ ...current, points: [...current.points, point] });
      }
    },
    [pointFromEvent, syncActiveStroke]
  );

  const finishStroke = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      blockNodeDrag(event);
      drawingRef.current = false;
      const current = activeStrokeRef.current;
      syncActiveStroke(null);
      if (!current) return;
      if (isShapeTool(current.tool)) {
        const start = current.points[0];
        const end = current.points[current.points.length - 1];
        if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
        pushStroke({ ...current, points: [start, end] });
        return;
      }
      if (current.points.length === 0) return;
      pushStroke(current);
    },
    [pushStroke, syncActiveStroke]
  );

  // 未选中时仍可预览笔迹；未激活工具时不拦截拖拽
  if (!visible) return null;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "absolute inset-0 z-30 h-full w-full",
        // 绘制时整层接管事件，避免点到下层或被 RF 框选抢走
        drawActive ? "nodrag nopan pointer-events-auto" : "pointer-events-none"
      )}
    >
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className={cn(
          "nodrag nopan nowheel absolute inset-0 h-full w-full touch-none",
          drawActive ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"
        )}
        onPointerDown={drawActive ? handlePointerDown : undefined}
        onPointerMove={drawActive ? handlePointerMove : undefined}
        onPointerUp={drawActive ? finishStroke : undefined}
        onPointerCancel={drawActive ? finishStroke : undefined}
      />
      {pendingText ? (
        <textarea
          ref={textInputRef}
          value={pendingText.draft}
          rows={2}
          placeholder="输入文字后回车确认"
          className="nodrag nopan pointer-events-auto absolute z-40 min-w-[120px] resize-none rounded-md border border-white/30 bg-black/70 px-2 py-1 text-white outline-none backdrop-blur-sm"
          style={{
            left: `${(pendingText.x / canvasWidth) * 100}%`,
            top: `${(pendingText.y / canvasHeight) * 100}%`,
            color,
            fontSize: Math.max(12, textFontSize * viewScale),
            lineHeight: 1.25,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            setPendingText((current) => (current ? { ...current, draft: e.target.value } : current))
          }
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitPendingText();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPendingText(null);
            }
          }}
          onBlur={() => commitPendingText()}
        />
      ) : null}
    </div>
  );
}
