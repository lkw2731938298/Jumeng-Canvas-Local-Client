/**
 * 官网 latest.json 检查版本 → 下载 Setup.exe → NSIS /S 静默覆盖安装。
 * 不走 Gitee 附件（单文件 100MB 限制，安装包约 250MB+）。
 * 同一 appId 覆盖安装，不删 AppData。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { spawn } = require("child_process");
const { app } = require("electron");

/** 版本清单（小 JSON）+ 安装包直链，均挂在官网 */
const UPDATE_MANIFEST_URL = "https://www.jumeng.vip/downloads/latest.json";
const DEFAULT_SETUP_URL = "https://www.jumeng.vip/downloads/JumengCanvas-Setup.exe";
const DEFAULT_SETUP_NAME = "JumengCanvas-Setup.exe";
const DOWNLOAD_PAGE = "https://www.jumeng.vip/canvas.html";

function normalizeVersion(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  if (m) return m[1].replace(/^v/i, "");
  return s.replace(/^v/i, "").split("-")[0];
}

function compareVersions(a, b) {
  const parse = (v) =>
    normalizeVersion(v)
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
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          "User-Agent": "JumengCanvasDesktop",
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
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
            reject(new Error(`更新检查失败 HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("连接更新服务器超时"));
    });
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (u, redirects = 0) => {
      const lib = u.startsWith("https") ? https : http;
      const req = lib.get(
        u,
        { timeout: 10 * 60_000, headers: { "User-Agent": "JumengCanvasDesktop" } },
        (res) => {
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
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("下载超时"));
      });
    };
    go(url);
  });
}

/**
 * 读取官网 latest.json：
 * { "version": "0.1.5", "setupUrl": "...", "setupName": "JumengCanvas-Setup.exe" }
 */
async function checkDesktopUpdate() {
  const localVersion = app.getVersion();
  const manifest = await fetchJson(UPDATE_MANIFEST_URL);
  const remoteVersion = normalizeVersion(manifest.version || manifest.tag || "");
  if (!remoteVersion) throw new Error("更新清单缺少版本号");
  const setupUrl = String(manifest.setupUrl || manifest.url || DEFAULT_SETUP_URL).trim() || DEFAULT_SETUP_URL;
  const setupName =
    String(manifest.setupName || path.basename(new URL(setupUrl).pathname) || DEFAULT_SETUP_NAME).trim() ||
    DEFAULT_SETUP_NAME;
  const hasUpdate = compareVersions(remoteVersion, localVersion) > 0;
  const canApply = Boolean(setupUrl) && hasUpdate;
  return {
    localVersion,
    remoteVersion,
    hasUpdate,
    canApply,
    blockedReason: !setupUrl ? "更新清单缺少安装包地址" : undefined,
    repoUrl: String(manifest.downloadPage || DOWNLOAD_PAGE),
    setupName,
    setupUrl,
    channel: "official-nsis",
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
  const dest = path.join(tmpDir, info.setupName || DEFAULT_SETUP_NAME);
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
  normalizeVersion,
  checkDesktopUpdate,
  applyDesktopUpdate,
  UPDATE_MANIFEST_URL,
  DOWNLOAD_PAGE,
};
