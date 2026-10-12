/**
 * 本机音频切段：优先流复制，失败则转 AAC/m4a。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ensureFfmpegBin } from "@/lib/local/ensureFfmpeg";

const execFileAsync = promisify(execFile);

const MIN_TRIM_SEC = 0.3;
const MAX_TRIM_SEC = 600;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

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
    return { ok: false, stderr: String(e.stderr || e.message || "") };
  }
}

function outputOk(outPath: string): boolean {
  try {
    return fs.existsSync(outPath) && fs.statSync(outPath).size >= 64;
  } catch {
    return false;
  }
}

export function pickAudioOutExt(inputPath: string): { ext: string; fileType: string } {
  const lower = path.extname(inputPath).toLowerCase();
  if (lower === ".mp3") return { ext: ".mp3", fileType: "audio/mpeg" };
  if (lower === ".wav") return { ext: ".wav", fileType: "audio/wav" };
  if (lower === ".ogg") return { ext: ".ogg", fileType: "audio/ogg" };
  if (lower === ".flac") return { ext: ".flac", fileType: "audio/flac" };
  if (lower === ".aac") return { ext: ".aac", fileType: "audio/aac" };
  return { ext: ".m4a", fileType: "audio/mp4" };
}

/** 切段写到 outputPath；返回时长与字节数。 */
export async function trimAudioFileToPath(params: {
  inputPath: string;
  outputPath: string;
  inSec: number;
  outSec: number;
}): Promise<{ durationSec: number; bytes: number; fileType: string; mode: "copy" | "reencode" }> {
  const inSec = Math.max(0, Number(params.inSec) || 0);
  const outSec = Number(params.outSec);
  if (!(outSec > inSec)) throw new Error("出点必须大于入点");
  const durationSec = outSec - inSec;
  if (durationSec < MIN_TRIM_SEC) {
    throw new Error(`片段至少 ${MIN_TRIM_SEC} 秒`);
  }
  if (durationSec > MAX_TRIM_SEC + 0.05) {
    throw new Error(`片段最长 ${MAX_TRIM_SEC} 秒`);
  }
  if (!fs.existsSync(params.inputPath)) {
    throw new Error("源音频文件不存在");
  }
  const st = fs.statSync(params.inputPath);
  if (st.size > MAX_AUDIO_BYTES) {
    throw new Error("源音频超过 200MB，无法切段");
  }

  const ffmpeg = await ensureFfmpegBin();
  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  if (fs.existsSync(params.outputPath)) {
    try {
      fs.unlinkSync(params.outputPath);
    } catch {
      /* ignore */
    }
  }

  const src = pickAudioOutExt(params.inputPath);
  const outExt = path.extname(params.outputPath).toLowerCase() || src.ext;
  const canCopy = outExt === src.ext;
  const ss = inSec.toFixed(3);
  const t = durationSec.toFixed(3);
  const copyTimeoutMs = 60_000;
  const reencodeTimeoutMs = Math.max(60_000, Math.round(durationSec * 1500) + 15_000);

  if (canCopy) {
    const copy = await runFfmpeg(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        ss,
        "-i",
        params.inputPath,
        "-t",
        t,
        "-vn",
        "-c:a",
        "copy",
        params.outputPath,
      ],
      copyTimeoutMs
    );
    if (copy.ok && outputOk(params.outputPath)) {
      return {
        durationSec,
        bytes: fs.statSync(params.outputPath).size,
        fileType: src.fileType,
        mode: "copy",
      };
    }
    try {
      if (fs.existsSync(params.outputPath)) fs.unlinkSync(params.outputPath);
    } catch {
      /* ignore */
    }
  }

  // 重编码统一 m4a/AAC（若目标不是 .m4a/.mp3，写临时 m4a 再改名由上层处理）
  const reOut =
    outExt === ".m4a" || outExt === ".mp3" || outExt === ".aac"
      ? params.outputPath
      : path.join(
          path.dirname(params.outputPath),
          `${path.basename(params.outputPath, outExt)}.m4a`
        );
  const re = await runFfmpeg(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      ss,
      "-i",
      params.inputPath,
      "-t",
      t,
      "-vn",
      "-acodec",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      reOut,
    ],
    reencodeTimeoutMs
  );
  if (!re.ok || !outputOk(reOut)) {
    throw new Error(`音频切段失败：${(re.stderr || "ffmpeg error").slice(0, 280)}`);
  }
  if (reOut !== params.outputPath) {
    try {
      if (fs.existsSync(params.outputPath)) fs.unlinkSync(params.outputPath);
    } catch {
      /* ignore */
    }
    fs.renameSync(reOut, params.outputPath);
  }
  return {
    durationSec,
    bytes: fs.statSync(params.outputPath).size,
    fileType: "audio/mp4",
    mode: "reencode",
  };
}

export { MIN_TRIM_SEC as MIN_AUDIO_TRIM_SEC, MAX_TRIM_SEC as MAX_AUDIO_TRIM_SEC };
