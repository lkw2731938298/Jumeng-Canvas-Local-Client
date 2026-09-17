import type { DrawStroke } from "./types";

/** 计算笔触包围盒（含线宽余量） */
export function strokeBounds(stroke: DrawStroke): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  if (stroke.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of stroke.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (stroke.tool === "text") {
    const fontSize = stroke.fontSize ?? Math.max(12, stroke.size * 3);
    const textW = Math.max(40, (stroke.text?.length ?? 1) * fontSize * 0.6);
    return { x: minX, y: minY, w: textW, h: fontSize * 1.2 };
  }
  const pad = Math.max(4, stroke.size);
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(1, maxX - minX) + pad * 2,
    h: Math.max(1, maxY - minY) + pad * 2,
  };
}

function pointInBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number },
  pad = 0
): boolean {
  return (
    point.x >= bounds.x - pad &&
    point.x <= bounds.x + bounds.w + pad &&
    point.y >= bounds.y - pad &&
    point.y <= bounds.y + bounds.h + pad
  );
}

/** 从后往前命中检测（顶层优先） */
export function hitTestStroke(
  strokes: DrawStroke[],
  point: { x: number; y: number }
): DrawStroke | null {
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i]!;
    if (stroke.tool === "eraser") continue;
    const bounds = strokeBounds(stroke);
    if (!bounds) continue;
    if (pointInBounds(point, bounds, 6)) return stroke;
  }
  return null;
}

export function translateStroke(stroke: DrawStroke, dx: number, dy: number): DrawStroke {
  return {
    ...stroke,
    points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}
