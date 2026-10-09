/**
 * Gitee Releases 检查 / 下载 / 静默覆盖安装（NSIS /S）。
 * 同一 appId 覆盖安装，不删 AppData。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");
const { app } = require("electron");

const GITEE_OWNER = "liukewen0112";
const GITEE_REPO = "Jumeng-Canvas-Local-Client";
const RELEASES_API = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/latest`;
const RELEASES_PAGE = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases`;
/** 发版时上传的固定附件名，便于落地页直链 */
const PREFERRED_SETUP_NAMES = ["JumengCanvas-Setup.exe", "JumengCanvas-Setup-win.exe"];

function compareVersions(a, b) {
  const parse = (v) =>
    String(v || "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function fetchJson(url, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs, headers: { "User-Agent": "JumengCanvasDesktop" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Gitee HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("连接 Gitee 超时"));
    });
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (u, redirects = 0) => {
      const lib = u.startsWith("https") ? https : http;
      const req = lib.get(u, { timeout: 10 * 60_000, headers: { "User-Agent": "JumengCanvasDesktop" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
          res.resume();
          go(res.headers.location, redirects + 1);
          return;
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const total = Number(res.headers["content-length"] || 0);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (onProgress && total > 0) onProgress(received / total);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("下载超时"));
      });
    };
    go(url);
  });
}

function pickSetupAsset(release) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const byName = (want) =>
    assets.find((a) => String(a.name || "").toLowerCase() === want.toLowerCase());
  for (const name of PREFERRED_SETUP_NAMES) {
    const hit = byName(name);
    if (hit) return hit;
  }
  const exe = assets.find((a) => /\.exe$/i.test(String(a.name || "")));
  return exe || null;
}

function assetDownloadUrl(release, asset) {
  if (asset.browser_download_url) return asset.browser_download_url;
  const tag = release.tag_name || release.name;
  return `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`;
}

async function checkDesktopUpdate() {
  const localVersion = app.getVersion();
  const release = await fetchJson(RELEASES_API);
  const remoteVersion = String(release.tag_name || release.name || "")
    .trim()
    .replace(/^v/i, "");
  if (!remoteVersion) throw new Error("Gitee Release 缺少版本号");
  const asset = pickSetupAsset(release);
  const hasUpdate = compareVersions(remoteVersion, localVersion) > 0;
  return {
    localVersion,
    remoteVersion,
    hasUpdate,
    canApply: Boolean(asset) && hasUpdate,
    blockedReason: !asset
      ? "最新 Release 未附带 Setup.exe，请到发布页手动下载"
      : undefined,
    repoUrl: RELEASES_PAGE,
    setupName: asset ? asset.name : null,
    setupUrl: asset ? assetDownloadUrl(release, asset) : null,
    channel: "gitee-nsis",
  };
}

/**
 * 下载安装包后退出应用并静默安装（NSIS /S）。
 * 调用方应在返回后尽快结束主进程。
 */
async function applyDesktopUpdate({ onProgress } = {}) {
  const info = await checkDesktopUpdate();
  if (!info.hasUpdate) {
    return { updated: false, ...info };
  }
  if (!info.canApply || !info.setupUrl) {
    throw new Error(info.blockedReason || "无法自动更新");
  }
  const tmpDir = path.join(app.getPath("temp"), "jumeng-canvas-update");
  fs.mkdirSync(tmpDir, { recursive: true });
  const dest = path.join(tmpDir, info.setupName || "JumengCanvas-Setup.exe");
  await downloadFile(info.setupUrl, dest, onProgress);

  // 延迟启动安装器，给 Electron 退出留时间；/S 静默覆盖
  const bat = path.join(tmpDir, "run-update.bat");
  const batBody = [
    "@echo off",
    "ping 127.0.0.1 -n 3 >nul",
    `"${dest}" /S`,
    `start "" "${process.execPath}"`,
  ].join("\r\n");
  fs.writeFileSync(bat, batBody, "utf8");

  spawn("cmd.exe", ["/c", bat], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

  return {
    updated: true,
    fromVersion: info.localVersion,
    toVersion: info.remoteVersion,
    restarting: true,
  };
}

module.exports = {
  compareVersions,
  checkDesktopUpdate,
  applyDesktopUpdate,
  RELEASES_PAGE,
  GITEE_OWNER,
  GITEE_REPO,
};
