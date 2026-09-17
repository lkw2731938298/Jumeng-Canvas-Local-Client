/** 全局模型水印开关（localStorage，与用户下拉菜单联动） */
export const DEFAULT_GLOBAL_WATERMARK_ENABLED = false;

const STORAGE_KEY = "jm_global_watermark_v1";

let cached: boolean | null = null;

/** 读取当前用户全局水印偏好（SSR 返回默认关闭） */
export function readGlobalWatermarkEnabled(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return DEFAULT_GLOBAL_WATERMARK_ENABLED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1" || raw === "true") {
      cached = true;
      return true;
    }
    if (raw === "0" || raw === "false") {
      cached = false;
      return false;
    }
  } catch {
    /* ignore */
  }
  cached = DEFAULT_GLOBAL_WATERMARK_ENABLED;
  return cached;
}

/** 写入全局水印偏好并同步内存缓存 */
export function writeGlobalWatermarkEnabled(enabled: boolean): void {
  cached = enabled;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
