/** 扩图工具参数（节点顶栏截图同款浮条） */

export const OUTPAINT_TOOL_MODE = "outpaint";

export const OUTPAINT_MODELS = [
  { value: "pro", label: "PRO" },
  { value: "standard", label: "标准" },
] as const;

export const OUTPAINT_ASPECT_RATIOS = [
  { value: "original", label: "原图比例" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
] as const;

export const OUTPAINT_RESOLUTIONS = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
] as const;

export const OUTPAINT_COUNTS = [1, 2, 4] as const;

/** 四边扩展量（画布节点坐标系像素，相对原图外扩） */
export interface OutpaintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type OutpaintModel = (typeof OUTPAINT_MODELS)[number]["value"];
export type OutpaintAspectRatio = (typeof OUTPAINT_ASPECT_RATIOS)[number]["value"];
export type OutpaintResolution = (typeof OUTPAINT_RESOLUTIONS)[number]["value"];
export type OutpaintCount = (typeof OUTPAINT_COUNTS)[number];

export interface InlineImageOutpaintState {
  model: OutpaintModel;
  aspectRatio: OutpaintAspectRatio;
  resolution: OutpaintResolution;
  count: OutpaintCount;
  margins: OutpaintMargins;
}

export const DEFAULT_OUTPAINT_MARGINS: OutpaintMargins = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

export const DEFAULT_INLINE_IMAGE_OUTPAINT: InlineImageOutpaintState = {
  model: "pro",
  aspectRatio: "original",
  resolution: "2k",
  count: 1,
  margins: { ...DEFAULT_OUTPAINT_MARGINS },
};

/** 单击「+」一次外扩的节点像素 */
export const OUTPAINT_EXPAND_STEP = 48;

/** 单边最大外扩（相对节点宽/高） */
export const OUTPAINT_MAX_MARGIN_RATIO = 2;

export function clampOutpaintMargins(
  margins: OutpaintMargins,
  nodeWidth: number,
  nodeHeight: number
): OutpaintMargins {
  const maxX = Math.max(40, nodeWidth * OUTPAINT_MAX_MARGIN_RATIO);
  const maxY = Math.max(40, nodeHeight * OUTPAINT_MAX_MARGIN_RATIO);
  return {
    top: Math.max(0, Math.min(maxY, Math.round(margins.top))),
    right: Math.max(0, Math.min(maxX, Math.round(margins.right))),
    bottom: Math.max(0, Math.min(maxY, Math.round(margins.bottom))),
    left: Math.max(0, Math.min(maxX, Math.round(margins.left))),
  };
}

/** 扩图后输出像素尺寸（按原图像素比例换算） */
export function outpaintOutputSize(opts: {
  nodeWidth: number;
  nodeHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  margins: OutpaintMargins;
}): { width: number; height: number } {
  const nw = Math.max(1, opts.naturalWidth);
  const nh = Math.max(1, opts.naturalHeight);
  const dw = Math.max(1, opts.nodeWidth);
  const dh = Math.max(1, opts.nodeHeight);
  const totalW = dw + opts.margins.left + opts.margins.right;
  const totalH = dh + opts.margins.top + opts.margins.bottom;
  return {
    width: Math.max(1, Math.round((totalW / dw) * nw)),
    height: Math.max(1, Math.round((totalH / dh) * nh)),
  };
}

/** 扩图算力预估（前端展示；实际上游接入后改走 quote） */
export function estimateOutpaintCreditCost(state: InlineImageOutpaintState): number {
  const resBase = state.resolution === "4k" ? 28 : state.resolution === "2k" ? 14 : 8;
  const modelMul = state.model === "pro" ? 1 : 0.75;
  return Math.max(1, Math.round(resBase * modelMul * state.count));
}

export function isOutpaintToolMode(toolMode: unknown): boolean {
  return toolMode === OUTPAINT_TOOL_MODE;
}
