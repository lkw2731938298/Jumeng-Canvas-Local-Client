/**
 * 项目画板布局：卡片在画板上的世界坐标，按用户存 localStorage。
 * - 拖动后写入；新项目（无坐标）自动放到已有卡片右侧的空位并立即写入，避免后续新增时整体跳动
 * - 「进入创作」卡片使用固定 id NEW_CARD_ID，同样可拖动
 * - 可选 r：自定义旋转角（度）；未设置时用 tiltFor
 * - 可选 s：自定义缩放（相对 CARD_W/H）；未设置视为 1
 */

export type BoardPoint = {
  x: number;
  y: number;
  /** 自定义旋转角（度） */
  r?: number;
  /** 自定义缩放（相对默认卡片尺寸） */
  s?: number;
};
export type BoardLayout = Record<string, BoardPoint>;

export type ResizeCorner = "tl" | "tr" | "bl" | "br";

export const NEW_CARD_ID = "__new__";

/** 卡片尺寸（世界坐标，100% 缩放下即 CSS px） */
export const CARD_W = 340;
export const CARD_H = 262;
export const CARD_SCALE_MIN = 0.5;
export const CARD_SCALE_MAX = 2.5;
/** 自动排位网格：列宽 / 行高 / 行数 */
export const SLOT_W = 400;
export const SLOT_H = 330;
export const SLOT_ROWS = 2;
/** 网格吸附步长 */
export const SNAP_STEP = 20;

const STORAGE_PREFIX = "jm_board_layout_v1:";

export function loadBoardLayout(userId: string | undefined): BoardLayout {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: BoardLayout = {};
    for (const [id, p] of Object.entries(parsed as Record<string, unknown>)) {
      const pt = p as Partial<BoardPoint>;
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        const item: BoardPoint = { x: Number(pt.x), y: Number(pt.y) };
        if (typeof pt.r === "number" && Number.isFinite(pt.r)) item.r = Number(pt.r);
        if (typeof pt.s === "number" && Number.isFinite(pt.s) && pt.s > 0) item.s = Number(pt.s);
        out[id] = item;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBoardLayout(userId: string | undefined, layout: BoardLayout) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

/** 稳定哈希：由项目 id 派生倾斜角 / 占位渐变 / 排位抖动 */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 固定小倾斜角（-2.4° ~ 2.4°）——未手动旋转时的默认摆放 */
export function tiltFor(id: string): number {
  return ((hashId(id) % 49) - 24) / 10;
}

/** 卡片实际旋转角：优先用户自定义，否则默认 tilt */
export function rotationOf(id: string, layout: BoardLayout): number {
  const r = layout[id]?.r;
  if (typeof r === "number" && Number.isFinite(r)) return r;
  return tiltFor(id);
}

/** 归一化到约 -180~180，保留一位小数 */
export function normalizeRotation(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 10) / 10;
}

/** 卡片缩放系数（默认 1） */
export function scaleOf(p: BoardPoint | undefined): number {
  const s = p?.s;
  if (typeof s === "number" && Number.isFinite(s) && s > 0) {
    return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, s));
  }
  return 1;
}

export function clampScale(s: number): number {
  return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, Math.round(s * 100) / 100));
}

/** 卡片世界宽高（含自定义缩放） */
export function cardSize(p: BoardPoint | undefined): { w: number; h: number } {
  const s = scaleOf(p);
  return { w: CARD_W * s, h: CARD_H * s };
}

/** 缩放拖动时对角固定点（世界坐标） */
export function resizeAnchor(corner: ResizeCorner, x: number, y: number, w: number, h: number) {
  switch (corner) {
    case "br":
      return { ax: x, ay: y };
    case "bl":
      return { ax: x + w, ay: y };
    case "tr":
      return { ax: x, ay: y + h };
    case "tl":
      return { ax: x + w, ay: y + h };
  }
}

/** 由固定对角 + 缩放重建左上角位置 */
export function poseFromResizeAnchor(
  corner: ResizeCorner,
  ax: number,
  ay: number,
  s: number,
  extras?: Pick<BoardPoint, "r">
): BoardPoint {
  const w = CARD_W * s;
  const h = CARD_H * s;
  const base =
    corner === "br"
      ? { x: ax, y: ay }
      : corner === "bl"
        ? { x: ax - w, y: ay }
        : corner === "tr"
          ? { x: ax, y: ay - h }
          : { x: ax - w, y: ay - h };
  return {
    ...base,
    s,
    ...(typeof extras?.r === "number" ? { r: extras.r } : {}),
  };
}

export function snapPoint(p: BoardPoint): BoardPoint {
  return {
    x: Math.round(p.x / SNAP_STEP) * SNAP_STEP,
    y: Math.round(p.y / SNAP_STEP) * SNAP_STEP,
    ...(typeof p.r === "number" ? { r: p.r } : {}),
    ...(typeof p.s === "number" ? { s: p.s } : {}),
  };
}

function overlaps(a: BoardPoint, b: BoardPoint, gap = 24) {
  const as = cardSize(a);
  const bs = cardSize(b);
  return (
    a.x < b.x + bs.w + gap &&
    a.x + as.w + gap > b.x &&
    a.y < b.y + bs.h + gap &&
    a.y + as.h + gap > b.y
  );
}

/**
 * 给缺坐标的卡片分配位置：
 * 按列从左到右、列内从上到下扫描网格槽位，取第一个不与已有卡片重叠的位置，
 * 再叠加少量由 id 决定的抖动，形成设计稿里错落的排布。
 * 返回新增的坐标（不含已有的）。
 */
export function assignMissingPositions(layout: BoardLayout, ids: string[]): BoardLayout {
  const taken: BoardPoint[] = Object.values(layout);
  const added: BoardLayout = {};
  for (const id of ids) {
    if (layout[id]) continue;
    let placed: BoardPoint | null = null;
    for (let col = 0; col < 500 && !placed; col += 1) {
      for (let row = 0; row < SLOT_ROWS; row += 1) {
        const h = hashId(id);
        const cand = {
          x: col * SLOT_W + ((h % 41) - 20),
          y: row * SLOT_H + (((h >>> 8) % 41) - 20) + (col % 2 === 1 ? 30 : 0),
        };
        if (!taken.some((t) => overlaps(cand, t))) {
          placed = cand;
          break;
        }
      }
    }
    const p = placed ?? { x: taken.length * SLOT_W, y: 0 };
    added[id] = p;
    taken.push(p);
  }
  return added;
}
