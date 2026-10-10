/**
 * 本机视频切段：默认流复制（秒级），失败才超快重编码。
 * 输出直接写目标路径，避免整文件进内存 / base64。
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureFfmpegBin } from "@/lib/local/ensureFfmpeg";

const execFileAsync = promisify(execFile);

const MIN_TRIM_SEC = 0.3;
const MAX_TRIM_SEC = 180;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function pickOutExt(inputPath: string): { ext: string; fileType: string } {
  const lower = path.extname(inputPath).toLowerCase();
  if (lower === ".webm") return { ext: ".webm", fileType: "video/webm" };
  if (lower === ".mov") return { ext: ".mov", fileType: "video/quicktime" };
  if (lower === ".mkv") return { ext: ".mkv", fileType: "video/x-matroska" };
  return { ext: ".mp4", fileType: "video/mp4" };
}

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

function outputOk(outPath: string): boolean {
  try {
    return fs.existsSync(outPath) && fs.statSync(outPath).size >= 256;
  } catch {
    return false;
  }
}

/**
 * 切段写到 outputPath（由调用方指定最终素材路径或临时路径）。
 * 返回时长、字节数与建议 MIME。
 */
export async function trimVideoFileToPath(params: {
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
    throw new Error("源视频文件不存在");
  }
  const st = fs.statSync(params.inputPath);
  if (st.size > MAX_VIDEO_BYTES) {
    throw new Error("源视频超过 200MB，无法剪辑");
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

  const src = pickOutExt(params.inputPath);
  const outExt = path.extname(params.outputPath).toLowerCase() || ".mp4";
  // 同容器才尝试流复制（mp4→mp4 / webm→webm）；跨容器必重编码
  const canCopy = outExt === src.ext || (outExt === ".mp4" && (src.ext === ".mp4" || src.ext === ".mov"));
  const copyTimeoutMs = 60_000;
  const reencodeTimeoutMs = Math.max(90_000, Math.round(durationSec * 2000) + 20_000);
  const ss = inSec.toFixed(3);
  const t = durationSec.toFixed(3);

  // 1) 流复制：-ss 在 -i 前，关键帧快进，通常 1–3 秒
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
        "-map",
        "0",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
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

  // 2) 超快重编码兜底（切点不在关键帧 / 容器不兼容）
  // 重编码统一写 mp4；若目标不是 .mp4，先写临时再让上层改名
  const reOut =
    outExt === ".mp4"
      ? params.outputPath
      : path.join(path.dirname(params.outputPath), `${path.basename(params.outputPath, outExt)}.mp4`);
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
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-threads",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      reOut,
    ],
    reencodeTimeoutMs
  );
  if (!re.ok || !outputOk(reOut)) {
    throw new Error(`切段失败：${(re.stderr || "ffmpeg error").slice(0, 280)}`);
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
    fileType: "video/mp4",
    mode: "reencode",
  };
}

/** @deprecated 兼容旧调用：仍可用，但大文件会占内存 */
export async function trimVideoFileToBuffer(params: {
  inputPath: string;
  inSec: number;
  outSec: number;
}): Promise<{ buffer: Buffer; durationSec: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jm-trim-"));
  const { ext } = pickOutExt(params.inputPath);
  const outPath = path.join(tmpDir, `clip${ext}`);
  try {
    const r = await trimVideoFileToPath({ ...params, outputPath: outPath });
    return { buffer: fs.readFileSync(outPath), durationSec: r.durationSec };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export { MIN_TRIM_SEC, MAX_TRIM_SEC, pickOutExt };
