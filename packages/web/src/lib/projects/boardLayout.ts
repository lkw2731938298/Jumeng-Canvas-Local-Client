/**
 * 项目画板布局：卡片在画板上的世界坐标，按用户存 localStorage。
 * - 拖动后写入；新项目（无坐标）自动放到已有卡片右侧的空位并立即写入，避免后续新增时整体跳动
 * - 「进入创作」卡片使用固定 id NEW_CARD_ID，同样可拖动
 */

export type BoardPoint = { x: number; y: number };
export type BoardLayout = Record<string, BoardPoint>;

export const NEW_CARD_ID = "__new__";

/** 卡片尺寸（世界坐标，100% 缩放下即 CSS px） */
export const CARD_W = 340;
export const CARD_H = 262;
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
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) out[id] = { x: Number(pt.x), y: Number(pt.y) };
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

/** 固定小倾斜角（-2.4° ~ 2.4°） */
export function tiltFor(id: string): number {
  return ((hashId(id) % 49) - 24) / 10;
}

export function snapPoint(p: BoardPoint): BoardPoint {
  return { x: Math.round(p.x / SNAP_STEP) * SNAP_STEP, y: Math.round(p.y / SNAP_STEP) * SNAP_STEP };
}

function overlaps(a: BoardPoint, b: BoardPoint, gap = 24) {
  return (
    a.x < b.x + CARD_W + gap &&
    a.x + CARD_W + gap > b.x &&
    a.y < b.y + CARD_H + gap &&
    a.y + CARD_H + gap > b.y
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
