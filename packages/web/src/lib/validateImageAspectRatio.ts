/**
 * 浏览器端图片宽高比校验工具。
 * 在上传前用 FileReader + Image 加载图片，检测其宽高比是否在允许范围内。
 */

/** 允许的比例偏差范围（±tolerancePct%） */
const DEFAULT_TOLERANCE = 0.05;

/**
 * 将 File 加载为图片并返回 { width, height }。
 * 依赖浏览器 Image 对象，不可在 Node/Worker 中调用。
 */
export function loadImageDimensions(
  file: File
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

/**
 * 检查图片是否满足目标宽高比（targetW : targetH）。
 *
 * @param file       待上传的图片文件
 * @param targetW    目标宽比，例如 9
 * @param targetH    目标高比，例如 16
 * @param tolerance  允许偏差，默认 5%
 * @returns          符合比例返回 true，否则 false
 */
export async function validateImageAspectRatio(
  file: File,
  targetW: number,
  targetH: number,
  tolerance = DEFAULT_TOLERANCE
): Promise<boolean> {
  const { width, height } = await loadImageDimensions(file);
  if (height === 0) return false;
  const actual = width / height;
  const expected = targetW / targetH;
  return Math.abs(actual - expected) / expected <= tolerance;
}
