/**
 * 本机音视频分离：抽出 AAC 音轨 + 无声视频（优先流复制）。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ensureFfmpegBin } from "@/lib/local/ensureFfmpeg";

const execFileAsync = promisify(execFile);

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

async function runFfmpeg(
  ffmpeg: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: boolean; stderr: string }> {
  try {
    const r = await execFileAsync(ffmpeg, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, stderr: String(r.stderr || "") };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stderr: String(e.stderr || e.message || ""),
    };
  }
}

function outputOk(outPath: string, minBytes = 64): boolean {
  try {
    return fs.existsSync(outPath) && fs.statSync(outPath).size >= minBytes;
  } catch {
    return false;
  }
}

/** 旁路查找同目录 ffprobe；没有则用 ffmpeg -i 扫 stderr。 */
async function probeHasAudio(ffmpeg: string, inputPath: string): Promise<boolean> {
  const dir = path.dirname(ffmpeg);
  const probeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const probeBin = path.join(dir, probeName);
  if (fs.existsSync(probeBin)) {
    try {
      const r = await execFileAsync(
        probeBin,
        [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          inputPath,
        ],
        { timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      return Boolean(String(r.stdout || "").trim());
    } catch {
      /* fall through */
    }
  }
  const probe = await runFfmpeg(ffmpeg, ["-hide_banner", "-i", inputPath], 60_000);
  // ffmpeg -i 无输出文件时通常非 0，音轨信息在 stderr
  return /Audio:\s/i.test(probe.stderr);
}

/**
 * 从本地视频文件分离：写 audioPath（.m4a）与 silentVideoPath（.mp4）。
 */
export async function splitVideoAvToPaths(params: {
  inputPath: string;
  audioPath: string;
  silentVideoPath: string;
}): Promise<{ audioBytes: number; videoBytes: number; silentMode: "copy" | "reencode" }> {
  if (!fs.existsSync(params.inputPath)) {
    throw new Error("源视频文件不存在");
  }
  const st = fs.statSync(params.inputPath);
  if (st.size > MAX_VIDEO_BYTES) {
    throw new Error("源视频超过 200MB，无法分离");
  }

  const ffmpeg = await ensureFfmpegBin();
  const hasAudio = await probeHasAudio(ffmpeg, params.inputPath);
  if (!hasAudio) {
    throw new Error("该视频没有音轨，无法分离音频");
  }

  for (const p of [params.audioPath, params.silentVideoPath]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }

  const audio = await runFfmpeg(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      params.inputPath,
      "-vn",
      "-acodec",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      params.audioPath,
    ],
    600_000
  );
  if (!audio.ok || !outputOk(params.audioPath)) {
    throw new Error(`抽取音频失败：${(audio.stderr || "ffmpeg error").slice(0, 280)}`);
  }

  // 无声视频：优先流复制
  const copy = await runFfmpeg(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      params.inputPath,
      "-an",
      "-c:v",
      "copy",
      "-movflags",
      "+faststart",
      params.silentVideoPath,
    ],
    600_000
  );
  let silentMode: "copy" | "reencode" = "copy";
  if (!copy.ok || !outputOk(params.silentVideoPath, 256)) {
    try {
      if (fs.existsSync(params.silentVideoPath)) fs.unlinkSync(params.silentVideoPath);
    } catch {
      /* ignore */
    }
    const re = await runFfmpeg(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        params.inputPath,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        params.silentVideoPath,
      ],
      600_000
    );
    if (!re.ok || !outputOk(params.silentVideoPath, 256)) {
      throw new Error(`导出无声视频失败：${(re.stderr || "ffmpeg error").slice(0, 280)}`);
    }
    silentMode = "reencode";
  }

  return {
    audioBytes: fs.statSync(params.audioPath).size,
    videoBytes: fs.statSync(params.silentVideoPath).size,
    silentMode,
  };
}
