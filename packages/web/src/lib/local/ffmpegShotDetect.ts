/**
 * 本机镜头切分：对齐商业站 shot_detection.py（scene 检测 + 等距回退 + ≤12s 分段）。
 * 产出每镜 JPEG 关键帧路径 + mp4 参考片段路径（写到调用方指定目录）。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureFfmpegBin } from "@/lib/local/ensureFfmpeg";
import { trimVideoFileToPath } from "@/lib/local/ffmpegTrim";

const execFileAsync = promisify(execFile);

export const MAX_SHOTS = 24;
export const MIN_SHOT_GAP_SEC = 1.0;
export const MIN_SHOT_DURATION_SEC = 4.0;
export const FALLBACK_INTERVAL_SEC = 4.0;
export const SCENE_THRESHOLD = 0.26;
export const MAX_REF_VIDEO_CLIP_SEC = 12.0;
export const MAX_VIRAL_REMAKE_SOURCE_DURATION_SEC = 180.0;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export type ShotBoundary = {
  index: number;
  startSec: number;
  endSec: number;
};

export type ShotSegmentFiles = {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  jpegPath: string;
  clipPath: string;
  jpegBytes: number;
  clipBytes: number;
};

async function runFfmpeg(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const r = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(r.stdout || ""),
      stderr: String(r.stderr || ""),
    };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stdout: String(e.stdout || ""),
      stderr: String(e.stderr || e.message || ""),
    };
  }
}

/** 同目录旁路找 ffprobe；没有则用 ffmpeg -i 解析时长兜底 */
function resolveFfprobe(ffmpeg: string): string | null {
  const dir = path.dirname(ffmpeg);
  const name = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const candidate = path.join(dir, name);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

export async function probeDurationSec(videoPath: string, ffmpeg: string): Promise<number> {
  const ffprobe = resolveFfprobe(ffmpeg);
  if (ffprobe) {
    const r = await runFfmpeg(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath,
      ],
      60_000
    );
    if (r.ok) {
      const raw = r.stdout.trim();
      const duration = Number(raw);
      if (Number.isFinite(duration) && duration > 0) return duration;
    }
  }
  // 兜底：ffmpeg -i 扫 stderr
  const probe = await runFfmpeg(ffmpeg, ["-hide_banner", "-i", videoPath], 60_000);
  const m = probe.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error("无法读取视频时长");
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const duration = h * 3600 + min * 60 + sec;
  if (!(duration > 0)) throw new Error("视频时长无效");
  return duration;
}

export async function detectSceneCuts(
  videoPath: string,
  ffmpeg: string,
  threshold = SCENE_THRESHOLD
): Promise<number[]> {
  const r = await runFfmpeg(
    ffmpeg,
    [
      "-hide_banner",
      "-i",
      videoPath,
      "-filter:v",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-",
    ],
    300_000
  );
  const text = r.stderr || "";
  const times: number[] = [];
  for (const match of text.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const t = Number(match[1]);
    if (Number.isFinite(t) && t > 0.05) times.push(t);
  }
  times.sort((a, b) => a - b);
  return times;
}

function fallbackInterval(duration: number): number {
  if (duration <= 12) return 2.0;
  if (duration <= 45) return FALLBACK_INTERVAL_SEC;
  return 4.0;
}

export function buildShotBoundaries(duration: number, cutTimes: number[]): ShotBoundary[] {
  const starts = [0.0];
  for (const t of cutTimes) {
    if (t >= duration - 0.05) continue;
    if (t - starts[starts.length - 1]! >= MIN_SHOT_GAP_SEC) starts.push(t);
  }

  if (starts.length < 2) {
    starts.length = 0;
    starts.push(0.0);
    const interval = fallbackInterval(duration);
    let t = interval;
    while (t < duration - 0.4 && starts.length < MAX_SHOTS) {
      starts.push(t);
      t += interval;
    }
  }

  let trimmed = starts;
  if (trimmed.length > MAX_SHOTS) {
    const idxs = Array.from({ length: MAX_SHOTS }, (_, i) =>
      Math.round((i * (trimmed.length - 1)) / (MAX_SHOTS - 1))
    );
    trimmed = idxs.map((i) => starts[i]!);
    trimmed[0] = 0.0;
  }

  const raw: Array<[number, number]> = [];
  for (let i = 0; i < trimmed.length; i += 1) {
    const start = trimmed[i]!;
    const end = i + 1 < trimmed.length ? trimmed[i + 1]! : duration;
    if (end - start < 0.2) continue;
    raw.push([start, end]);
  }

  const merged: Array<[number, number]> = [];
  for (const [start, end] of raw) {
    if (merged.length && end - start < MIN_SHOT_DURATION_SEC) {
      const prev = merged[merged.length - 1]!;
      merged[merged.length - 1] = [prev[0], end];
    } else {
      merged.push([start, end]);
    }
  }

  if (!merged.length) {
    return [{ index: 1, startSec: 0, endSec: Math.max(duration, 1) }];
  }
  return merged.map(([s, e], i) => ({
    index: i + 1,
    startSec: s,
    endSec: e,
  }));
}

export function splitBoundariesForRefLimit(
  boundaries: ShotBoundary[],
  maxClipSec = MAX_REF_VIDEO_CLIP_SEC,
  maxShots = MAX_SHOTS
): ShotBoundary[] {
  const pieces: Array<[number, number]> = [];
  for (const b of boundaries) {
    const start = b.startSec;
    const end = b.endSec;
    if (end - start <= maxClipSec + 0.05) {
      pieces.push([start, end]);
      continue;
    }
    let t = start;
    while (t < end - 0.15) {
      const chunkEnd = Math.min(t + maxClipSec, end);
      if (chunkEnd - t >= 0.3) pieces.push([t, chunkEnd]);
      t = chunkEnd;
    }
  }

  let picked = pieces;
  if (picked.length > maxShots) {
    const idxs = Array.from({ length: maxShots }, (_, i) =>
      Math.round((i * (picked.length - 1)) / (maxShots - 1))
    );
    picked = idxs.map((i) => pieces[i]!);
  }

  const merged: Array<[number, number]> = [];
  for (const [start, end] of picked) {
    if (merged.length && end - start < MIN_SHOT_DURATION_SEC) {
      const prev = merged[merged.length - 1]!;
      if (end - prev[0] <= maxClipSec + 0.05) {
        merged[merged.length - 1] = [prev[0], end];
      } else {
        merged.push([start, end]);
      }
    } else {
      merged.push([start, end]);
    }
  }

  return merged.map(([s, e], i) => ({
    index: i + 1,
    startSec: s,
    endSec: e,
  }));
}

async function extractFrameAt(
  videoPath: string,
  ffmpeg: string,
  atSec: number,
  outPath: string
): Promise<number> {
  const r = await runFfmpeg(
    ffmpeg,
    [
      "-y",
      "-ss",
      Math.max(0, atSec).toFixed(3),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      outPath,
    ],
    90_000
  );
  if (!r.ok || !fs.existsSync(outPath) || fs.statSync(outPath).size < 64) {
    throw new Error(`关键帧提取失败@${atSec.toFixed(2)}s：${(r.stderr || "ffmpeg error").slice(0, 280)}`);
  }
  return fs.statSync(outPath).size;
}

/**
 * 对本地视频文件切镜，关键帧/片段写到 workDir（调用方负责注册素材后可删临时目录）。
 */
export async function splitVideoToShotSegments(params: {
  videoPath: string;
  workDir: string;
  stripAudio?: boolean;
  onProgress?: (message: string) => void;
}): Promise<ShotSegmentFiles[]> {
  if (!fs.existsSync(params.videoPath)) {
    throw new Error("源视频文件不存在");
  }
  const st = fs.statSync(params.videoPath);
  if (st.size > MAX_VIDEO_BYTES) {
    throw new Error("源视频超过 200MB，无法切镜");
  }

  const ffmpeg = await ensureFfmpegBin();
  params.onProgress?.("正在读取视频时长…");
  const duration = await probeDurationSec(params.videoPath, ffmpeg);
  if (duration > MAX_VIRAL_REMAKE_SOURCE_DURATION_SEC + 0.5) {
    throw new Error(`参考视频最长 ${MAX_VIRAL_REMAKE_SOURCE_DURATION_SEC} 秒`);
  }

  params.onProgress?.("正在检测镜头切换…");
  let cuts = await detectSceneCuts(params.videoPath, ffmpeg, SCENE_THRESHOLD);
  let boundaries = buildShotBoundaries(duration, cuts);
  // 切点过少再试稍严阈值
  if (boundaries.length < 2 && duration > 8) {
    cuts = await detectSceneCuts(params.videoPath, ffmpeg, 0.18);
    boundaries = buildShotBoundaries(duration, cuts);
  }
  boundaries = splitBoundariesForRefLimit(boundaries);

  fs.mkdirSync(params.workDir, { recursive: true });
  const out: ShotSegmentFiles[] = [];

  for (const b of boundaries) {
    params.onProgress?.(`正在导出镜头 ${b.index}/${boundaries.length}…`);
    const mid = (b.startSec + b.endSec) / 2;
    const jpegPath = path.join(params.workDir, `shot_${b.index}.jpg`);
    const clipPath = path.join(params.workDir, `shot_${b.index}.mp4`);

    const jpegBytes = await extractFrameAt(params.videoPath, ffmpeg, mid, jpegPath);

    // 片段上限 12s；出海可去音
    const clipEnd = Math.min(b.endSec, b.startSec + MAX_REF_VIDEO_CLIP_SEC);
    await trimVideoFileToPath({
      inputPath: params.videoPath,
      outputPath: clipPath,
      inSec: b.startSec,
      outSec: clipEnd,
    });

    // stripAudio：对已切片段再压一遍去音（可选）
    if (params.stripAudio) {
      const silentPath = path.join(params.workDir, `shot_${b.index}_silent.mp4`);
      const silent = await runFfmpeg(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          clipPath,
          "-an",
          "-c:v",
          "copy",
          "-movflags",
          "+faststart",
          silentPath,
        ],
        120_000
      );
      if (silent.ok && fs.existsSync(silentPath) && fs.statSync(silentPath).size >= 256) {
        try {
          fs.unlinkSync(clipPath);
        } catch {
          /* ignore */
        }
        fs.renameSync(silentPath, clipPath);
      }
    }

    const clipBytes = fs.statSync(clipPath).size;
    const durationSec = Math.max(0.3, Math.min(clipEnd - b.startSec, MAX_REF_VIDEO_CLIP_SEC));
    out.push({
      index: b.index,
      startSec: b.startSec,
      endSec: clipEnd,
      durationSec,
      jpegPath,
      clipPath,
      jpegBytes,
      clipBytes,
    });
  }

  if (!out.length) {
    throw new Error("未切出镜头，请换一段有明显镜头切换的视频");
  }
  return out;
}

/** 供路由生成临时目录名 */
export function makeShotWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jm-viral-shots-"));
}
