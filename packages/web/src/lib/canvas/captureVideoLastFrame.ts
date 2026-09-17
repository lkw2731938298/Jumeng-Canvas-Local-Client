import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";

const DEFAULT_SEEK_TIMEOUT_MS = 15_000;
/** 大视频 / 切同源 stream 后首帧解码较慢，800ms 易误报超时 */
const FRAME_READY_TIMEOUT_MS = 2_500;
/** 贴片尾 seek：过近 duration 时部分浏览器定格首帧/黑帧，留一帧量级余量 */
const LAST_FRAME_EPSILON_SEC = 0.08;
/** 目标时刻与落地时刻允许偏差（关键帧对齐） */
const SEEK_LANDING_TOLERANCE_SEC = 0.35;

function clampSeekTime(video: HTMLVideoElement, timeSec: number): number {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    // duration 未知时禁止把 MAX_SAFE_INTEGER 写进 currentTime（Chrome 会落回 0）
    if (!Number.isFinite(timeSec) || timeSec === Number.MAX_SAFE_INTEGER) {
      return 0;
    }
    return Math.max(0, timeSec);
  }
  const endCap = Math.max(0, duration - LAST_FRAME_EPSILON_SEC);
  return Math.max(0, Math.min(timeSec, endCap));
}

/** seek 完成后校验是否真的落到目标附近，避免无 Range 时静默停在首帧 */
function assertSeekLanded(video: HTMLVideoElement, targetSec: number): void {
  const landed = video.currentTime;
  if (!Number.isFinite(landed)) {
    throw new Error("定位画面失败");
  }
  const duration = video.duration;
  const aimingNearEnd =
    Number.isFinite(duration) &&
    duration > 0 &&
    targetSec >= Math.max(0, duration - 1);
  if (aimingNearEnd && landed < Math.max(0.2, duration * 0.5)) {
    throw new Error("无法定位到视频尾帧，请稍后重试或检查视频是否可拖动进度");
  }
  if (Math.abs(landed - targetSec) > SEEK_LANDING_TOLERANCE_SEC) {
    // 尾帧目标允许落到 endCap；中间帧仍要求接近目标
    if (!(aimingNearEnd && landed >= Math.max(0, duration - 1))) {
      throw new Error("定位画面未生效，请稍后重试");
    }
  }
}

function isFrameDecodable(video: HTMLVideoElement): boolean {
  return (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

/** Wait briefly for decoded pixels after seek. Never uses rVFC — it does not fire on paused video. */
function ensureFrameDecodable(
  video: HTMLVideoElement,
  timeoutMs = FRAME_READY_TIMEOUT_MS
): Promise<void> {
  if (isFrameDecodable(video)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      if (isFrameDecodable(video)) resolve();
      else reject(new Error("定位画面超时"));
    }, timeoutMs);

    const done = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", done);
      video.removeEventListener("loadeddata", done);
    };

    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("loadeddata", done, { once: true });
  });
}

/** Seek a mounted video element and wait until the target frame is decodable. */
export async function seekVideoToTime(
  video: HTMLVideoElement,
  timeSec: number,
  timeoutMs = DEFAULT_SEEK_TIMEOUT_MS
): Promise<void> {
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("视频元数据加载超时"));
      }, timeoutMs);
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("视频加载失败"));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onMeta, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }

  const target = clampSeekTime(video, timeSec);
  if (Math.abs(video.currentTime - target) < 0.001) {
    await ensureFrameDecodable(video);
    assertSeekLanded(video, target);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("定位画面超时"));
    }, timeoutMs);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("定位画面失败"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = target;
  });

  await ensureFrameDecodable(video);
  assertSeekLanded(video, target);
}

/** Capture a video frame as JPEG (browser canvas). */

function blobFromVideoElement(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return Promise.reject(new Error("无法读取视频画面尺寸"));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("无法创建画布"));
  }

  try {
    ctx.drawImage(video, 0, 0, width, height);
  } catch (err) {
    return Promise.reject(new Error("绘制视频画面失败，请检查视频源是否支持跨域访问"));
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画面导出失败：Canvas可能被跨域资源污染，请确保视频服务器支持CORS"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92
    );
  });
}

/** Capture the frame currently displayed on a mounted video element. */
export async function captureVideoFrameFromElement(video: HTMLVideoElement): Promise<Blob> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("视频未就绪"));
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }
  return blobFromVideoElement(video);
}

/** Seek a video URL to `timeSec` and capture that frame. */
export async function captureVideoFrameAtTime(
  videoUrl: string,
  timeSec: number
): Promise<Blob> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const cleanup = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const loadTimeout = window.setTimeout(() => reject(new Error("视频加载超时")), 60_000);
      const onLoaded = () => {
        window.clearTimeout(loadTimeout);
        resolve();
      };
      const onError = () => {
        window.clearTimeout(loadTimeout);
        reject(new Error("视频加载失败"));
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = canvasStreamUrlFromUrl(videoUrl);
    });

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("无法读取视频时长");
    }

    await seekVideoToTime(video, timeSec);
    return await blobFromVideoElement(video);
  } catch (err) {
    throw err instanceof Error ? err : new Error("画面截取失败");
  } finally {
    cleanup();
  }
}

/** Capture a frame at `timeSec` from a mounted element, with off-DOM fallback. */
export async function captureVideoFrameAtTimePreferElement(
  video: HTMLVideoElement | undefined,
  videoUrl: string,
  timeSec: number
): Promise<Blob> {
  if (video && document.body.contains(video)) {
    try {
      // 始终对准目标时刻再截，避免 store 时间与画面微小偏差导致空帧/错帧
      await seekVideoToTime(video, timeSec);
      return await captureVideoFrameFromElement(video);
    } catch {
      // 回退：独立 video + 同源 stream，避免 OSS CORS 污染 canvas
    }
  }
  return captureVideoFrameAtTime(videoUrl, timeSec);
}

/**
 * 截取「当前画面」：直接抓节点上已显示的帧，不重新 seek。
 * 再 seek 会落到关键帧/邻帧，与用户看到的暂停画面不一致。
 */
export async function captureDisplayedVideoFramePreferElement(
  video: HTMLVideoElement | undefined,
  videoUrl: string
): Promise<Blob> {
  if (video && document.body.contains(video)) {
    try {
      const wasPlaying = !video.paused && !video.ended;
      // 播放中先暂停，定格当前解码帧再导出
      if (wasPlaying) {
        video.pause();
        // 等一帧绘制周期，避免 pause 瞬间仍是上一帧缓冲
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }
      await ensureFrameDecodable(video);
      const blob = await captureVideoFrameFromElement(video);
      if (wasPlaying) {
        void video.play().catch(() => {
          /* 截完可续播；失败则保持暂停 */
        });
      }
      return blob;
    } catch {
      // 回退：用元素上的 currentTime 独立解码
      const t =
        Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
      return captureVideoFrameAtTime(videoUrl, t);
    }
  }
  return captureVideoFrameAtTime(videoUrl, 0);
}

/** @deprecated Use captureVideoFrameAtTime with duration - epsilon */
export async function captureVideoLastFrame(videoUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };

    const timeout = window.setTimeout(() => fail("视频加载超时"), 60_000);

    video.addEventListener("error", () => {
      window.clearTimeout(timeout);
      fail("视频加载失败");
    });

    video.addEventListener(
      "loadedmetadata",
      () => {
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          window.clearTimeout(timeout);
          fail("无法读取视频时长");
          return;
        }

        const onSeeked = () => {
          window.clearTimeout(timeout);
          blobFromVideoElement(video)
            .then((blob) => {
              cleanup();
              resolve(blob);
            })
            .catch((err) => {
              fail(err instanceof Error ? err.message : "尾帧导出失败");
            });
        };

        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = Math.max(0, duration - LAST_FRAME_EPSILON_SEC);
      },
      { once: true }
    );

    video.src = canvasStreamUrlFromUrl(videoUrl);
  });
}

export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (ms > 0 && s < 60) {
    return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function frameFileName(nodeId: string, timeSec: number): string {
  const stamp = Math.round(timeSec * 1000);
  return `frame-${nodeId.slice(0, 8)}-${stamp}.jpg`;
}

export function lastFrameFileName(nodeId: string): string {
  return `last-frame-${nodeId.slice(0, 8)}.jpg`;
}
