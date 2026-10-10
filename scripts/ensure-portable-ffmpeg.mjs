/**
 * 下载 Windows 便携 ffmpeg 到 packages/desktop/resources/ffmpeg/
 * 供 electron-builder extraResources 打进安装包；也可给开发态复用。
 */
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "packages", "desktop", "resources", "ffmpeg");
const cacheDir = path.join(root, "packages", "desktop", ".cache", "ffmpeg");
const ZIP_URL =
  process.env.JUMENG_FFMPEG_DOWNLOAD_URL ||
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

function log(msg) {
  console.log(`[ensure-ffmpeg] ${msg}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;
    const req = get(url, { headers: { "User-Agent": "JumengCanvas/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
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

function findExe(dir, name, depth = 0) {
  if (depth > 6) return null;
  for (const ent of fs.readdirSync(dir)) {
    const full = path.join(dir, ent);
    const st = fs.statSync(full);
    if (st.isFile() && ent.toLowerCase() === name) return full;
    if (st.isDirectory()) {
      const hit = findExe(full, name, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

async function main() {
  if (process.platform !== "win32") {
    log("非 Windows，跳过便携 ffmpeg（请本机安装 ffmpeg）");
    return;
  }
  const destExe = path.join(outDir, "ffmpeg.exe");
  if (fs.existsSync(destExe)) {
    log(`already present: ${destExe}`);
    return;
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(cacheDir, "ffmpeg-release-essentials.zip");
  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 1_000_000) {
    log(`downloading ${ZIP_URL}`);
    await download(ZIP_URL, zipPath);
  } else {
    log(`using cache ${zipPath}`);
  }

  const extractDir = path.join(cacheDir, "extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  const ffmpeg = findExe(extractDir, "ffmpeg.exe");
  const ffprobe = findExe(extractDir, "ffprobe.exe");
  if (!ffmpeg) {
    console.error("解压后未找到 ffmpeg.exe");
    process.exit(1);
  }
  fs.copyFileSync(ffmpeg, destExe);
  if (ffprobe) fs.copyFileSync(ffprobe, path.join(outDir, "ffprobe.exe"));
  log(`wrote ${destExe}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
