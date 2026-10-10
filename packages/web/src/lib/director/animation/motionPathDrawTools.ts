/** 对齐 LibTV：绘制轨迹工具（圆环 / 直线 / 矩形 / 铅笔 / 钢笔） */

export type MotionPathDrawTool = "circle" | "line" | "rect" | "pencil" | "pen";

export const MOTION_PATH_DRAW_TOOLS: {
  id: MotionPathDrawTool;
  label: string;
  hint: string;
}[] = [
  { id: "circle", label: "圆环路径", hint: "单击圆心，再点圆周完成" },
  { id: "line", label: "直线路径", hint: "单击起点，再点终点完成" },
  { id: "rect", label: "矩形路径", hint: "单击一角，再点对角完成" },
  { id: "pencil", label: "铅笔路径", hint: "按住拖拽自由绘制，松手完成" },
  { id: "pen", label: "钢笔路径", hint: "单击加点，双击/Enter 完成" },
];

export function motionPathDrawToolLabel(tool: MotionPathDrawTool): string {
  return MOTION_PATH_DRAW_TOOLS.find((t) => t.id === tool)?.label ?? "绘制轨迹";
}

export function motionPathDrawBanner(tool: MotionPathDrawTool): string {
  const orbitHint = "右键转视角";
  switch (tool) {
    case "circle":
      return `圆环 · 单击圆心 → 拖出半径再点确认（最小约 0.5m）· ${orbitHint} · Esc 取消`;
    case "line":
      return `直线 · 单击起点 → 再点终点 · ${orbitHint} · Esc 取消`;
    case "rect":
      return `矩形 · 单击一角 → 再点对角 · ${orbitHint} · Esc 取消`;
    case "pencil":
      return `铅笔 · 左键拖画，松手可续画 · Enter/双击完成 · ${orbitHint} · Esc 取消`;
    case "pen":
    default:
      return `钢笔 · 左键加点 · 双击/Enter 完成 · ${orbitHint} · Esc 取消`;
  }
}

/** 角色/道具脚底贴地点（XZ + 地面高度）；相机轨用当前机位 */
export function footPointOnGround(
  object: { kind?: string; transform: { position: [number, number, number] } } | null | undefined,
  groundHeight: number
): [number, number, number] {
  if (!object) return [0, groundHeight, 0];
  const [x, y, z] = object.transform.position;
  if (object.kind === "camera") return [x, y, z];
  return [x, groundHeight, z];
}

/** 工具是否产出闭合路径 */
export function motionPathToolClosed(tool: MotionPathDrawTool): boolean {
  return tool === "circle" || tool === "rect";
}

/** 圆环最小半径（米）；过小会退化并触发 Line boundingSphere NaN */
export const MIN_CIRCLE_RADIUS = 0.5;

/** 圆心 + 圆周一点 → 圆环折线（不重复闭合点；路径 closed 标志负责闭环） */
export function pointsForCircle(
  center: [number, number, number],
  edge: [number, number, number],
  segments = 16
): [number, number, number][] {
  const y = Number.isFinite(center[1]) ? center[1] : 0;
  const cx = center[0];
  const cz = center[2];
  if (![cx, y, cz, edge[0], edge[2]].every(Number.isFinite)) {
    return [];
  }
  // 强制下限，避免缩到圆心附近时折线崩坏
  const r = Math.max(
    MIN_CIRCLE_RADIUS,
    Math.hypot(edge[0] - cx, edge[2] - cz)
  );
  const n = Math.max(8, Math.floor(segments));
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
  }
  return pts;
}

/** 对角两点 → 矩形四角（闭合） */
export function pointsForRect(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number][] {
  const y = (a[1] + b[1]) / 2;
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[2], b[2]);
  const z1 = Math.max(a[2], b[2]);
  if (Math.hypot(x1 - x0, z1 - z0) < 0.05) return [a, b];
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ];
}

/** 两端点直线 */
export function pointsForLine(
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number][] {
  return [a, b];
}
