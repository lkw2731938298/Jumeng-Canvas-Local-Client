/** 画板工具 */
export type DrawingTool =
  | "select"
  | "hand"
  | "brush"
  | "eraser"
  | "fill"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "eyedropper";

/** 画布背景模式（整幅画布） */
export type DrawingBackground = "transparent" | "#ffffff" | "#000000";

/** 图层底色：透明或任意 hex 色 */
export type DrawingLayerFillColor = "transparent" | (string & {});

export function isLayerFillTransparent(fill: DrawingLayerFillColor | undefined): boolean {
  return !fill || fill === "transparent";
}

export function normalizeLayerFillColor(value: string): DrawingLayerFillColor {
  if (value === "transparent") return "transparent";
  return value;
}

/** 画布尺寸预设 */
export interface DrawingCanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DRAWING_CANVAS_PRESETS: DrawingCanvasPreset[] = [
  { id: "1x1", label: "1:1", width: 1024, height: 1024 },
  { id: "16x9", label: "16:9", width: 1024, height: 576 },
  { id: "9x16", label: "9:16", width: 576, height: 1024 },
];

/** 画布单边最小 / 最大像素（手动改尺寸与边缘拖拽共用） */
export const DRAWING_CANVAS_MIN_EDGE = 64;
/** 参考图驱动画布时的单边最大像素，避免超大图撑爆内存 */
export const DRAWING_CANVAS_MAX_EDGE = 4096;

/** 规范化用户指定的画布宽高（独立钳制每边，不强制等比） */
export function normalizeDrawingCanvasSize(
  width: number,
  height: number,
  minEdge = DRAWING_CANVAS_MIN_EDGE,
  maxEdge = DRAWING_CANVAS_MAX_EDGE
): { width: number; height: number } {
  const clampEdge = (n: number) =>
    Math.min(maxEdge, Math.max(minEdge, Math.round(Number.isFinite(n) ? n : minEdge)));
  return { width: clampEdge(width), height: clampEdge(height) };
}

/** 按图片尺寸得到画布宽高（等比限制最大边） */
export function clampDrawingCanvasSize(
  imageWidth: number,
  imageHeight: number,
  maxEdge = DRAWING_CANVAS_MAX_EDGE
): { width: number; height: number } {
  const iw = Math.max(1, Math.round(imageWidth));
  const ih = Math.max(1, Math.round(imageHeight));
  const longest = Math.max(iw, ih);
  if (longest <= maxEdge) {
    return { width: iw, height: ih };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(iw * scale)),
    height: Math.max(1, Math.round(ih * scale)),
  };
}

/** 加载图片并读取自然宽高（用于导入参考图后适配画布） */
export function loadImageNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (width <= 0 || height <= 0) {
        reject(new Error("无效图片尺寸"));
        return;
      }
      resolve({ width, height });
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

/** 单条绘制记录，用于撤销重做与重绘 */
export interface DrawStroke {
  id: string;
  tool: DrawingTool;
  color: string;
  size: number;
  opacity: number;
  points: { x: number; y: number }[];
  /** 矩形/椭圆是否填充 */
  filled?: boolean;
  /** 擦除挖空：destination-out，露出下方棋盘格背景 */
  punch?: boolean;
  /** 擦除模式下橡皮：沿笔迹把原图贴回（修正挖空） */
  restore?: boolean;
  /** 文字工具专用 */
  text?: string;
  fontSize?: number;
}

export const DRAWING_BOARD_WIDTH = 1024;
export const DRAWING_BOARD_HEIGHT = 1024;

export const DRAWING_COLOR_PRESETS = [
  "#ffffff",
  "#000000",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
] as const;

export function newStrokeId(): string {
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function isFreehandTool(tool: DrawingTool): boolean {
  return tool === "brush" || tool === "eraser";
}

export function isShapeTool(tool: DrawingTool): boolean {
  return tool === "line" || tool === "rect" || tool === "ellipse";
}

export function isDrawTool(tool: DrawingTool): boolean {
  return isFreehandTool(tool) || isShapeTool(tool) || tool === "text" || tool === "fill";
}
