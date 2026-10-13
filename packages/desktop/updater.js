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

/**
 * 下载文件；onProgress({ phase, percent, received, total })
 * percent 为 0～1；无 Content-Length 时 percent 为 null。
 * 有 Content-Length 时校验落盘大小，避免残缺包被静默安装器秒退。
 */
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
          let lastEmit = 0;
          let lastPercentBucket = -1;
          const emit = (force = false) => {
            if (!onProgress) return;
            const now = Date.now();
            const pct = total > 0 ? received / total : null;
            const bucket = pct == null ? -1 : Math.floor(pct * 100);
            // 节流：约每 200ms 或每涨 1% 推一次，结束时强制推
            if (!force && now - lastEmit < 200 && bucket === lastPercentBucket) return;
            lastEmit = now;
            lastPercentBucket = bucket;
            onProgress({
              phase: "download",
              percent: pct,
              received,
              total: total > 0 ? total : null,
            });
          };
          try {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          const file = fs.createWriteStream(dest);
          res.on("data", (chunk) => {
            received += chunk.length;
            emit(false);
          });
          res.pipe(file);
          file.on("finish", () =>
            file.close(() => {
              emit(true);
              try {
                const st = fs.statSync(dest);
                if (st.size < 1024 * 1024) {
                  reject(new Error("下载文件过小，可能不是完整安装包，请重试"));
                  return;
                }
                if (total > 0 && st.size !== total) {
                  reject(
                    new Error(
                      `下载不完整（${st.size}/${total} 字节），请检查网络后重试`,
                    ),
                  );
                  return;
                }
                const fd = fs.openSync(dest, "r");
                const mag = Buffer.alloc(2);
                fs.readSync(fd, mag, 0, 2, 0);
                fs.closeSync(fd);
                if (mag[0] !== 0x4d || mag[1] !== 0x5a) {
                  reject(new Error("下载文件不是有效的 Windows 安装包，请重试"));
                  return;
                }
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
              }
              resolve({ received, total: total > 0 ? total : received });
            }),
          );
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
 * 下载安装包 → 拉起「更新助手」→ 退出应用 → 助手等待进程结束再打开安装向导。
 * 注意：界面上的「正在安装」是画布进度窗；应用退出后该窗会消失，这不是安装失败。
 * 真正安装进度在随后的 NSIS 向导窗口里。
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

  onProgress?.({
    phase: "download",
    percent: 0,
    received: 0,
    total: null,
    message: "正在连接官网…",
  });
  await downloadFile(info.setupUrl, dest, onProgress);

  onProgress?.({
    phase: "install",
    percent: null,
    received: null,
    total: null,
    message:
      "下载完成。应用将关闭；请留意随后弹出的黑色「更新助手」窗口和安装向导（有进度条）。",
  });

  // 复制到「下载」目录再装，减少 Temp 目录被 SmartScreen 秒拦的概率
  const downloadsDir = app.getPath("downloads") || path.join(app.getPath("home"), "Downloads");
  try {
    fs.mkdirSync(downloadsDir, { recursive: true });
  } catch {
    /* ignore */
  }
  const setupInDownloads = path.join(downloadsDir, info.setupName || DEFAULT_SETUP_NAME);
  try {
    fs.copyFileSync(dest, setupInDownloads);
  } catch {
    // 复制失败则仍用 temp 路径
  }
  const setupPath = fs.existsSync(setupInDownloads) ? setupInDownloads : dest;

  const ps1 = path.join(tmpDir, "run-update.ps1");
  const logPath = path.join(tmpDir, "update-install.log");
  const esc = (s) => String(s || "").replace(/'/g, "''");
  const exePath = process.execPath;
  const shortcutName = "聚梦无限画布.lnk";
  const processName = "聚梦无限画布";
  const psBody = [
    "$ErrorActionPreference = 'Continue'",
    "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}",
    `$log = '${esc(logPath)}'`,
    "function Write-Log([string]$m) {",
    "  $line = \"$(Get-Date -Format o) $m\"",
    "  Add-Content -LiteralPath $log -Value $line -Encoding UTF8",
    "  Write-Host $line",
    "}",
    "Write-Host ''",
    "Write-Host '========================================'",
    "Write-Host '  聚梦无限画布 · 更新助手'",
    "Write-Host '  请勿关闭本窗口，正在等待应用退出…'",
    "Write-Host '========================================'",
    "Write-Host ''",
    `$setup = '${esc(setupPath)}'`,
    `$app = '${esc(exePath)}'`,
    `$procName = '${esc(processName)}'`,
    "Write-Log \"setup=$setup\"",
    "if (-not (Test-Path -LiteralPath $setup)) {",
    "  Write-Log 'setup missing'",
    "  Add-Type -AssemblyName PresentationFramework",
    "  [System.Windows.MessageBox]::Show('安装包不存在，请重新检查更新或到官网下载。','聚梦无限画布') | Out-Null",
    "  exit 1",
    "}",
    // 等待画布进程退出（最多 90 秒），再开安装器，避免文件占用导致秒退
    "$deadline = (Get-Date).AddSeconds(90)",
    "while ($true) {",
    "  $alive = Get-Process -Name $procName -ErrorAction SilentlyContinue",
    "  if (-not $alive) { Write-Log 'app exited'; break }",
    "  if ((Get-Date) -gt $deadline) { Write-Log 'wait app exit timeout'; break }",
    "  Start-Sleep -Seconds 1",
    "}",
    "Start-Sleep -Seconds 1",
    "try {",
    "  Write-Host ''",
    "  Write-Host '正在打开安装向导（可见进度条）…'",
    "  Write-Log 'starting installer (visible)'",
    "  $p = Start-Process -FilePath $setup -WorkingDirectory (Split-Path -Parent $setup) -PassThru -Wait",
    "  $code = if ($null -eq $p) { -1 } else { $p.ExitCode }",
    "  Write-Log \"installer exit=$code\"",
    "  if ($code -ne 0 -and $null -ne $code) {",
    "    Add-Type -AssemblyName PresentationFramework",
    "    [System.Windows.MessageBox]::Show(\"安装未完成（退出码 $code）。可到官网重新下载安装包。\",'聚梦无限画布') | Out-Null",
    "    exit 1",
    "  }",
    "} catch {",
    "  Write-Log $_.Exception.Message",
    "  Add-Type -AssemblyName PresentationFramework",
    "  [System.Windows.MessageBox]::Show(('安装启动失败：' + $_.Exception.Message),'聚梦无限画布') | Out-Null",
    "  exit 1",
    "}",
    "Start-Sleep -Seconds 2",
    `$running = Get-Process -Name $procName -ErrorAction SilentlyContinue`,
    "if ($running) { Write-Log 'app already running'; exit 0 }",
    "if (Test-Path -LiteralPath $app) { Write-Log 'launch execPath'; Start-Process -FilePath $app; exit 0 }",
    `$lnkUser = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\${esc(shortcutName)}'`,
    `$lnkMachine = Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs\\${esc(shortcutName)}'`,
    "foreach ($lnk in @($lnkUser, $lnkMachine)) {",
    "  if (Test-Path -LiteralPath $lnk) { Write-Log \"launch $lnk\"; Start-Process -FilePath $lnk; exit 0 }",
    "}",
    "Write-Log 'done without relaunch'",
    "Write-Host '安装流程结束。可关闭本窗口。'",
    "Start-Sleep -Seconds 4",
    "exit 0",
    "",
  ].join("\r\n");
  fs.writeFileSync(ps1, `\uFEFF${psBody}`, "utf8");

  // 助手窗口必须可见，否则用户会以为「正在安装」闪退后什么都没了
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    {
      detached: true,
      stdio: "ignore",
      // 必须可见：否则画布退出后进度窗消失，用户会以为闪退失败
      windowsHide: false,
    },
  );
  child.unref();

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
