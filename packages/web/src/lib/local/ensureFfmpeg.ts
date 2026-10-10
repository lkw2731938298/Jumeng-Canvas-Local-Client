/**
 * 保证本机有可用 ffmpeg：
 * 1) FFMPEG_PATH / JUMENG_FFMPEG
 * 2) 安装包内 resources/ffmpeg
 * 3) 数据目录 tools/ffmpeg（首次自动下载便携版）
 * 4) 系统 PATH
 *
 * 视频切断优先走真实 ffmpeg，比浏览器 MediaRecorder 稳定得多。
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";

const execFileAsync = promisify(execFile);

const FFMPEG_EXE = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

/** 固定镜像：Win64 essentials（体积相对小，够切段用） */
const WIN_FFMPEG_ZIP =
  process.env.JUMENG_FFMPEG_DOWNLOAD_URL ||
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

let ensurePromise: Promise<string> | null = null;

function lookOnPath(bin: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where", [bin], {
        encoding: "utf8",
        windowsHide: true,
      });
      return (
        String(out)
          .split(/\r?\n/)
          .map((s) => s.trim())
          .find(Boolean) || null
      );
    }
    const out = execFileSync("which", [bin], { encoding: "utf8" });
    return String(out).trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function existingCandidates(): string[] {
  const list: string[] = [];
  for (const key of ["FFMPEG_PATH", "JUMENG_FFMPEG"]) {
    const v = (process.env[key] || "").trim();
    if (v) list.push(v);
  }
  // Electron extraResources → resources/ffmpeg/ffmpeg.exe
  const resPath = (process.env.JUMENG_RESOURCES_PATH || "").trim();
  if (resPath) {
    list.push(path.join(resPath, "ffmpeg", FFMPEG_EXE));
  }
  // 打包后常见相对位置（Next cwd 在 web 旁）
  list.push(
    path.join(process.cwd(), "..", "..", "..", "ffmpeg", FFMPEG_EXE),
    path.join(process.cwd(), "ffmpeg", FFMPEG_EXE)
  );
  try {
    const dataRoot = resolveActiveDataRoot();
    list.push(path.join(dataRoot, "tools", "ffmpeg", FFMPEG_EXE));
  } catch {
    /* data root 未就绪时跳过 */
  }
  if (process.platform === "win32") {
    list.push(
      path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"
    );
  } else {
    list.push("/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg");
  }
  const onPath = lookOnPath("ffmpeg");
  if (onPath) list.push(onPath);
  return list;
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;
    const req = get(url, { headers: { "User-Agent": "JumengCanvas/1.0" } }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        file.close();
        fs.unlink(dest, () => {});
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`下载 ffmpeg 失败 HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    req.on("error", (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function extractWinZip(zipPath: string, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true });
  // PowerShell Expand-Archive 最稳（不额外引 unzip 依赖）
  const ps = `
$ErrorActionPreference = 'Stop'
Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force
`;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { windowsHide: true, encoding: "utf8" }
  );
  if (r.status !== 0) {
    throw new Error(
      `解压 ffmpeg 失败：${(r.stderr || r.stdout || "").toString().slice(0, 300)}`
    );
  }
  // 在解压树里找 ffmpeg.exe
  const walk = (dir: string, depth = 0): string | null => {
    if (depth > 6) return null;
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return null;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && name.toLowerCase() === "ffmpeg.exe") return full;
      if (st.isDirectory()) {
        const hit = walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  const found = walk(destDir);
  if (!found) throw new Error("解压后未找到 ffmpeg.exe");
  return found;
}

async function downloadPortableFfmpeg(): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error(
      "当前系统请自行安装 ffmpeg（brew/apt）并加入 PATH，或设置 FFMPEG_PATH。"
    );
  }
  const dataRoot = resolveActiveDataRoot();
  const toolDir = path.join(dataRoot, "tools", "ffmpeg");
  const finalBin = path.join(toolDir, FFMPEG_EXE);
  if (fs.existsSync(finalBin)) return finalBin;

  fs.mkdirSync(toolDir, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jm-ffmpeg-"));
  const zipPath = path.join(tmpRoot, "ffmpeg.zip");
  const extractDir = path.join(tmpRoot, "out");
  try {
    await downloadFile(WIN_FFMPEG_ZIP, zipPath);
    const extracted = extractWinZip(zipPath, extractDir);
    fs.copyFileSync(extracted, finalBin);
    // 同目录拷贝 ffprobe（若有）便于以后探针
    const probeSrc = path.join(path.dirname(extracted), "ffprobe.exe");
    if (fs.existsSync(probeSrc)) {
      fs.copyFileSync(probeSrc, path.join(toolDir, "ffprobe.exe"));
    }
    return finalBin;
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function verifyFfmpeg(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["-version"], {
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析并确保 ffmpeg 可用（首次可能下载便携包，约数十 MB）。
 */
export async function ensureFfmpegBin(): Promise<string> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const hit = firstExisting(existingCandidates());
      if (hit && (await verifyFfmpeg(hit))) return hit;
      const downloaded = await downloadPortableFfmpeg();
      if (!(await verifyFfmpeg(downloaded))) {
        throw new Error("便携 ffmpeg 无法运行，请检查杀毒软件是否拦截");
      }
      return downloaded;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/** 同步探测（不下载），供快速失败路径 */
export function tryResolveFfmpegBinSync(): string | null {
  const hit = firstExisting(existingCandidates());
  return hit;
}
