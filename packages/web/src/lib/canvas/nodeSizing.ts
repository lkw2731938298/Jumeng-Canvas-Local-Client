export const NODE_TITLE_HEIGHT = 34;
export const DEFAULT_NODE_WIDTH = 320;
export const MIN_NODE_WIDTH = 160;
export const MAX_NODE_WIDTH = 640;
export const MIN_BODY_HEIGHT = 120;
export const MAX_BODY_HEIGHT = 480;
export const ASPECT_RATIO = 4 / 3;

export function bodyHeightFromWidth(width: number): number {
  return Math.round(width * (3 / 4));
}

export function totalHeightFromWidth(width: number): number {
  return NODE_TITLE_HEIGHT + bodyHeightFromWidth(width);
}

export function clampNodeWidth(width: number): number {
  return Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, Math.round(width)));
}

export function clampBodyHeight(height: number): number {
  return Math.max(MIN_BODY_HEIGHT, Math.min(MAX_BODY_HEIGHT, Math.round(height)));
}

/** 分镜表等节点：仅保底最小尺寸，不限制最大宽高 */
export function resolveNodeSizeUnbounded(width?: number | null, height?: number | null) {
  const w = width && width > 0 ? Math.max(MIN_NODE_WIDTH, Math.round(width)) : DEFAULT_NODE_WIDTH;
  const minTotalHeight = NODE_TITLE_HEIGHT + MIN_BODY_HEIGHT;
  const h = height && height > 0 ? Math.max(minTotalHeight, Math.round(height)) : totalHeightFromWidth(w);
  return { width: w, height: h };
}

export function defaultNodeSize() {
  const width = DEFAULT_NODE_WIDTH;
  return { width, height: totalHeightFromWidth(width) };
}

/** Fit media into node bounds while preserving media aspect ratio. */
export function sizeFromMedia(naturalWidth: number, naturalHeight: number) {
  if (!naturalWidth || !naturalHeight) return defaultNodeSize();

  const scale = Math.min(1, MAX_NODE_WIDTH / naturalWidth, MAX_BODY_HEIGHT / naturalHeight);
  const width = clampNodeWidth(naturalWidth * scale);
  const bodyHeight = clampBodyHeight(Math.round(width * (naturalHeight / naturalWidth)));

  return { width, height: NODE_TITLE_HEIGHT + bodyHeight };
}

export function resolveNodeSize(width?: number | null, height?: number | null) {
  const w = width && width > 0 ? clampNodeWidth(width) : DEFAULT_NODE_WIDTH;
  const h = height && height > 0 ? height : totalHeightFromWidth(w);
  return { width: w, height: h };
}
