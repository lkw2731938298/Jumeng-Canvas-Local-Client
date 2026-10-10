/**
 * 时间轴导出预演视频：先离线采帧（JPEG）→ 再按固定 fps 实时灌入 MediaRecorder。
 * 避免 captureStream(0)+慢截图导致墙钟时间戳不均、成片卡顿。
 * 仅面向 Chromium 桌面。
 */

export type ExportTimelineVideoParams = {
  durationSec: number;
  fps: 30 | 60;
  width: number;
  height: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number, frame: number, total: number) => void;
  /** 跳到时间并等待场景渲染完成 */
  seekAndWait: (timeSec: number) => Promise<void>;
  /** 返回当前帧 data URL（image/png 或 jpeg） */
  captureFrameDataUrl: (timeSec: number) => string | Promise<string>;
};

function pickMimeType(): string {
  // VP8 对实时灌帧更稳；VP9 在短 GOP + 不规则推帧时更容易糊/顿
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dataUrlToImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

/** 缩放到导出尺寸并压成 JPEG，避免阶段 1 常驻巨量位图 */
async function captureToJpegBlob(
  dataUrl: string,
  width: number,
  height: number,
  scratch: HTMLCanvasElement,
  quality = 0.92
): Promise<Blob> {
  const bmp = await dataUrlToImageBitmap(dataUrl);
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { alpha: false });
  if (!ctx) {
    bmp.close();
    throw new Error("无法创建导出画布");
  }
  ctx.fillStyle = "#0a0a12";
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / bmp.width, height / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp, (width - dw) / 2, (height - dh) / 2, dw, dh);
  bmp.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    scratch.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) throw new Error("帧压缩失败");
  return blob;
}

/**
 * 按 fps 导出 webm。
 * 两阶段：① 按内容时间采满帧（可慢）② 按 1/fps 墙钟均匀推入录制器（保证播放流畅）。
 */
export async function exportTimelineVideo(
  params: ExportTimelineVideoParams
): Promise<{ blob: Blob; mimeType: string; frameCount: number }> {
  const duration = Math.min(60, Math.max(0.5, params.durationSec));
  const fps = params.fps === 60 ? 60 : 30;
  const width = Math.max(320, Math.round(params.width));
  const height = Math.max(180, Math.round(params.height));
  const frameCount = Math.max(1, Math.round(duration * fps));
  const frameMs = 1000 / fps;

  if (typeof MediaRecorder === "undefined") {
    throw new Error("当前环境不支持 MediaRecorder，无法导出视频");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("当前环境不支持 createImageBitmap，无法导出视频");
  }

  const scratch = document.createElement("canvas");
  const frameBlobs: Blob[] = [];

  // ── 阶段 1：离线采帧并压成 JPEG ──
  try {
    for (let i = 0; i < frameCount; i++) {
      if (params.signal?.aborted) {
        throw new DOMException("导出已取消", "AbortError");
      }
      const t = Math.min(duration, i / fps);
      await params.seekAndWait(t);
      const dataUrl = await params.captureFrameDataUrl(t);
      frameBlobs.push(await captureToJpegBlob(dataUrl, width, height, scratch));
      params.onProgress?.(((i + 1) / frameCount) * 0.75, i + 1, frameCount);
    }
  } catch (err) {
    frameBlobs.length = 0;
    throw err;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("无法创建导出画布");
  }

  // 固定 fps 的 captureStream：由墙钟驱动时间戳，配合下方匀速推帧
  const stream = canvas.captureStream(fps);
  const mimeType = pickMimeType();
  const chunks: BlobPart[] = [];
  const bitrate = width >= 1280 ? 6_000_000 : width >= 720 ? 4_000_000 : 2_500_000;

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("录制失败"));
  });

  // ── 阶段 2：匀速灌帧编码 ──
  recorder.start(100);
  const encodeStart = performance.now();

  try {
    for (let i = 0; i < frameBlobs.length; i++) {
      if (params.signal?.aborted) {
        throw new DOMException("导出已取消", "AbortError");
      }
      const bmp = await createImageBitmap(frameBlobs[i]!);
      // 释放已用 JPEG，压低峰值内存
      frameBlobs[i] = null as unknown as Blob;
      ctx.drawImage(bmp, 0, 0, width, height);
      bmp.close();

      const targetAt = encodeStart + i * frameMs;
      const wait = targetAt - performance.now();
      if (wait > 1) await sleep(wait);

      params.onProgress?.(0.75 + ((i + 1) / frameCount) * 0.25, i + 1, frameCount);
    }
    // 末帧多留一拍，避免录制器截断最后一帧
    await sleep(frameMs + 40);
    params.onProgress?.(1, frameCount, frameCount);
  } finally {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    stream.getTracks().forEach((tr) => tr.stop());
    frameBlobs.length = 0;
  }

  await stopped;
  const blob = new Blob(chunks, { type: mimeType });
  if (!blob.size) {
    throw new Error("导出结果为空，请换用 Chromium 桌面客户端重试");
  }
  return { blob, mimeType, frameCount };
}

/** 按画幅算导出尺寸（短边 720） */
export function resolveExportSize(
  aspect: number,
  longEdge = 1280
): { width: number; height: number } {
  const a = aspect > 0 ? aspect : 16 / 9;
  if (a >= 1) {
    const width = longEdge;
    const height = Math.round(width / a);
    return { width, height: Math.max(2, height - (height % 2)) };
  }
  const height = longEdge;
  const width = Math.round(height * a);
  return { width: Math.max(2, width - (width % 2)), height };
}
