/**
 * 画布节点模型收藏：按用户本机持久化，收藏项在下拉中优先排列。
 */

const STORAGE_KEY = "jm_canvas_favorite_models_v1";

function readAll(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeAll(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore quota */
  }
}

export function loadFavoriteModelIds(): string[] {
  return readAll();
}

export function isFavoriteModel(modelId: string, favorites = readAll()): boolean {
  return favorites.includes(modelId);
}

/** 切换收藏；返回最新列表 */
export function toggleFavoriteModel(modelId: string): string[] {
  const id = String(modelId || "").trim();
  if (!id) return readAll();
  const cur = readAll();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  writeAll(next);
  return next;
}
