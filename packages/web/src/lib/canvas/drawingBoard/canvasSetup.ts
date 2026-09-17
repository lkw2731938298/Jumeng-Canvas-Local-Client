/** 画板逻辑尺寸（导出像素） */
export const DRAWING_BOARD_WIDTH = 1024;
export const DRAWING_BOARD_HEIGHT = 1024;

export type DrawingTool = "brush" | "eraser";

/** 初始化画布：按 DPR 缩放，绘制坐标使用逻辑像素 */
export function setupDrawingCanvas(
  canvas: HTMLCanvasElement,
  width = DRAWING_BOARD_WIDTH,
  height = DRAWING_BOARD_HEIGHT
): CanvasRenderingContext2D {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** 指针事件 → 画布逻辑坐标 */
export function pointerToCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  logicalWidth = DRAWING_BOARD_WIDTH,
  logicalHeight = DRAWING_BOARD_HEIGHT
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * logicalWidth;
  const y = ((clientY - rect.top) / rect.height) * logicalHeight;
  return {
    x: Math.max(0, Math.min(logicalWidth, x)),
    y: Math.max(0, Math.min(logicalHeight, y)),
  };
}

/** 保存当前画布快照（用于撤销/重做） */
export function snapshotCanvas(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/** 从快照恢复画布 */
export function restoreCanvasSnapshot(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  width = DRAWING_BOARD_WIDTH,
  height = DRAWING_BOARD_HEIGHT
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ctx = setupDrawingCanvas(canvas, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve();
    };
    img.onerror = () => reject(new Error("恢复快照失败"));
    img.src = dataUrl;
  });
}

/** 导出为 PNG Blob（保留透明通道） */
export function exportCanvasToPngBlob(
  canvas: HTMLCanvasElement,
  width = DRAWING_BOARD_WIDTH,
  height = DRAWING_BOARD_HEIGHT
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) {
      reject(new Error("无法导出画布"));
      return;
    }
    ctx.drawImage(canvas, 0, 0, width, height);
    exportCanvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("导出失败"));
      },
      "image/png",
      1
    );
  });
}
