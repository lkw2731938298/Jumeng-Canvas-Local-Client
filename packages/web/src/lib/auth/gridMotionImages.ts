export const AUTH_GRID_ITEM_COUNT = 28;

/**
 * 用外部图片 URL 铺满 4×7 网格。
 * 无配置时返回空数组（仓库不附带登录页静态图）。
 */
export function buildAuthGridItems(sourceUrls: string[]): string[] {
  const cleaned = sourceUrls.map((url) => url.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  return Array.from(
    { length: AUTH_GRID_ITEM_COUNT },
    (_, index) => cleaned[index % cleaned.length],
  );
}
