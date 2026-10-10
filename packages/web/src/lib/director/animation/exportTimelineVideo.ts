/**
 * 时间轴导出预演视频：逐帧截图 → MediaRecorder（webm/vp9）→ Blob。
 * 仅面向 Chromium 桌面；失败时抛错由上层提示。
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
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "video/webm";
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("导出帧解码失败"));
    img.src = dataUrl;
  });
}

/**
 * 按 fps 逐帧截图并编码为 webm。
 */
export async function exportTimelineVideo(
  params: ExportTimelineVideoParams
): Promise<{ blob: Blob; mimeType: string; frameCount: number }> {
  const duration = Math.min(60, Math.max(0.5, params.durationSec));
  const fps = params.fps === 60 ? 60 : 30;
  const width = Math.max(320, Math.round(params.width));
  const height = Math.max(180, Math.round(params.height));
  const frameCount = Math.max(1, Math.round(duration * fps));

  if (typeof MediaRecorder === "undefined") {
    throw new Error("当前环境不支持 MediaRecorder，无法导出视频");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建导出画布");

  // captureStream(0)：由 requestFrame 手动推帧，避免定时与截图不同步
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const mimeType = pickMimeType();
  const chunks: BlobPart[] = [];

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: width >= 1280 ? 4_000_000 : 2_500_000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("录制失败"));
  });

  recorder.start(200);

  try {
    for (let i = 0; i < frameCount; i++) {
      if (params.signal?.aborted) {
        throw new DOMException("导出已取消", "AbortError");
      }
      const t = Math.min(duration, i / fps);
      await params.seekAndWait(t);
      const dataUrl = await params.captureFrameDataUrl(t);
      const img = await loadImage(dataUrl);
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, width, height);
      // 按画布比例居中 cover
      const scale = Math.min(width / img.width, height / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = (width - dw) / 2;
      const dy = (height - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      if (track && typeof track.requestFrame === "function") {
        track.requestFrame();
      }
      params.onProgress?.(i / frameCount, i + 1, frameCount);
      // 给编码器一点时间吞帧
      await new Promise((r) => setTimeout(r, Math.max(8, Math.floor(1000 / fps / 2))));
    }
    params.onProgress?.(1, frameCount, frameCount);
  } finally {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    stream.getTracks().forEach((tr) => tr.stop());
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
