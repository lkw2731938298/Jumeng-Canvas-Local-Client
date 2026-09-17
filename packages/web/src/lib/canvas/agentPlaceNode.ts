/**
 * Agent 投影加节点时的避让落点：缺省坐标贴到现有节点右侧；与已有节点重叠则右移/下移。
 */

import type { Node } from "@xyflow/react";

import {
  DEFAULT_NODE_WIDTH,
  totalHeightFromWidth,
} from "@/lib/canvas/nodeSizing";

/** 与规则手册「间距约 220」一致的水平步进（宽 + 间隙） */
const GAP = 40;
const STEP_X = DEFAULT_NODE_WIDTH + GAP;
const STEP_Y = 220;
const PAD = 24;
const MAX_TRIES = 48;

type Rect = { x: number; y: number; w: number; h: number };

function nodeRect(n: Node): Rect {
  const w =
    typeof n.width === "number" && n.width > 0
      ? n.width
      : DEFAULT_NODE_WIDTH;
  const h =
    typeof n.height === "number" && n.height > 0
      ? n.height
      : totalHeightFromWidth(w);
  return {
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    w,
    h,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.w + PAD <= b.x ||
    b.x + b.w + PAD <= a.x ||
    a.y + a.h + PAD <= b.y ||
    b.y + b.h + PAD <= a.y
  );
}

function collides(x: number, y: number, w: number, h: number, nodes: Node[]): boolean {
  const cand = { x, y, w, h };
  return nodes.some((n) => overlaps(cand, nodeRect(n)));
}

/** 从起点按右→下扫描，找到不与现有节点重叠的位置。 */
export function nudgeClearOfNodes(
  startX: number,
  startY: number,
  nodes: Node[],
  size?: { width?: number; height?: number }
): { x: number; y: number } {
  const w = size?.width && size.width > 0 ? size.width : DEFAULT_NODE_WIDTH;
  const h =
    size?.height && size.height > 0
      ? size.height
      : totalHeightFromWidth(w);
  let x = Math.round(startX);
  let y = Math.round(startY);
  if (!nodes.length) return { x, y };

  for (let i = 0; i < MAX_TRIES; i += 1) {
    if (!collides(x, y, w, h, nodes)) return { x, y };
    // 同行右移；越界感强时换下一行
    if (i > 0 && i % 6 === 0) {
      x = Math.round(startX);
      y += STEP_Y;
    } else {
      x += STEP_X;
    }
  }
  return { x, y };
}

/**
 * 解析 Agent 加节点坐标：
 * - 未给 x/y（或缺省 100）且画布非空 → 从最右侧节点右边起排
 * - 与已有节点重叠 → 自动 nudge
 */
export function resolveAgentNodePosition(
  preferred: { x?: number | null; y?: number | null },
  nodes: Node[],
  options?: { defaultY?: number }
): { x: number; y: number } {
  const rawX = preferred.x;
  const rawY = preferred.y;
  const hasX = rawX != null && Number.isFinite(Number(rawX));
  const hasY = rawY != null && Number.isFinite(Number(rawY));
  let x = hasX ? Number(rawX) : 100;
  let y = hasY ? Number(rawY) : options?.defaultY ?? 100;

  // 模型常写死 100,100；视为「未指定」走自动落点
  const looksDefault =
    (!hasX || x === 100) && (!hasY || y === 100 || y === (options?.defaultY ?? 100));

  if (nodes.length && (!hasX || !hasY || looksDefault)) {
    let maxRight = 0;
    let anchorY = y;
    for (const n of nodes) {
      const r = nodeRect(n);
      const right = r.x + r.w;
      if (right >= maxRight) {
        maxRight = right;
        anchorY = r.y;
      }
    }
    if (!hasX || x === 100) x = maxRight + GAP;
    if (!hasY || looksDefault) y = anchorY;
  }

  return nudgeClearOfNodes(x, y, nodes);
}
