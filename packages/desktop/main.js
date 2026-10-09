/**
 * Electron 主进程：
 * - 开发：拉起 next dev
 * - 已安装：用资源目录内便携 Node 跑 Next standalone
 * 配置/项目默认落在 userData（打包态通过环境变量交给 Next）。
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const { checkDesktopUpdate, applyDesktopUpdate } = require("./updater");

const isDev = !app.isPackaged;
let mainWindow = null;
let nextProc = null;
/** 开源桌面版固定本机端口，避开常见 3000 占用导致「闪退」 */
const DESKTOP_PORT = Number(process.env.JUMENG_DESKTOP_PORT || 3456);
const DESKTOP_HOST = "127.0.0.1";

function appendLog(line) {
  try {
    const fp = path.join(app.getPath("userData"), "desktop-start.log");
    fs.appendFileSync(fp, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    /* ignore */
  }
  console.log(line);
}

function dataRoot() {
  const root = path.join(app.getPath("userData"), "JumengCanvas");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  return root;
}

/** Next 侧引导文件父目录（可写） */
function dataParentForNext() {
  const parent = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(parent, { recursive: true });
  return parent;
}

function filePath(...parts) {
  return path.join(dataRoot(), ...parts);
}

function readJson(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(fp, value) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig() {
  const t = nowIso();
  return { version: 1, lastProjectId: null, createdAt: t, updatedAt: t };
}

function registerIpc() {
  ipcMain.handle("desktop:getDataRoot", async () => dataRoot());
  ipcMain.handle("desktop:isPackaged", async () => app.isPackaged);
  ipcMain.handle("desktop:getAppVersion", async () => app.getVersion());

  ipcMain.handle("desktop:checkDesktopUpdate", async () => checkDesktopUpdate());
  ipcMain.handle("desktop:applyDesktopUpdate", async () => {
    const result = await applyDesktopUpdate();
    if (result.updated && result.restarting) {
      setTimeout(() => {
        app.quit();
      }, 400);
    }
    return result;
  });

  ipcMain.handle("desktop:readConfig", async () =>
    readJson(filePath("config.json"), defaultConfig())
  );
  ipcMain.handle("desktop:writeConfig", async (_e, cfg) => {
    writeJson(filePath("config.json"), { ...cfg, updatedAt: nowIso() });
  });

  ipcMain.handle("desktop:listProviders", async () =>
    readJson(filePath("providers.json"), [])
  );
  ipcMain.handle("desktop:saveProviders", async (_e, items) => {
    writeJson(filePath("providers.json"), items || []);
  });

  ipcMain.handle("desktop:listModels", async () => readJson(filePath("models.json"), []));
  ipcMain.handle("desktop:saveModels", async (_e, items) => {
    writeJson(filePath("models.json"), items || []);
  });

  ipcMain.handle("desktop:listProjects", async () => {
    const root = path.join(dataRoot(), "projects");
    if (!fs.existsSync(root)) return [];
    const out = [];
    for (const name of fs.readdirSync(root)) {
      const meta = readJson(path.join(root, name, "project.json"), null);
      if (meta && !meta.deletedAt) out.push(meta);
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  });

  ipcMain.handle("desktop:createProject", async (_e, title) => {
    const { randomUUID } = require("crypto");
    const id = randomUUID();
    const t = nowIso();
    const meta = {
      id,
      title: title || "未命名项目",
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    };
    const dir = path.join(dataRoot(), "projects", id);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    writeJson(path.join(dir, "project.json"), meta);
    writeJson(path.join(dir, "workflow.json"), {
      id: randomUUID(),
      projectId: id,
      revision: 1,
      flowJson: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });
    const cfg = readJson(filePath("config.json"), defaultConfig());
    writeJson(filePath("config.json"), { ...cfg, lastProjectId: id, updatedAt: t });
    return meta;
  });

  ipcMain.handle("desktop:getProject", async (_e, id) =>
    readJson(path.join(dataRoot(), "projects", id, "project.json"), null)
  );

  ipcMain.handle("desktop:updateProject", async (_e, id, patch) => {
    const fp = path.join(dataRoot(), "projects", id, "project.json");
    const cur = readJson(fp, null);
    if (!cur) throw new Error("项目不存在");
    const next = { ...cur, ...patch, updatedAt: nowIso() };
    writeJson(fp, next);
    return next;
  });

  ipcMain.handle("desktop:deleteProject", async (_e, id) => {
    const fp = path.join(dataRoot(), "projects", id, "project.json");
    const cur = readJson(fp, null);
    if (!cur) return;
    writeJson(fp, { ...cur, deletedAt: nowIso(), updatedAt: nowIso() });
  });

  ipcMain.handle("desktop:readWorkflow", async (_e, projectId) =>
    readJson(path.join(dataRoot(), "projects", projectId, "workflow.json"), null)
  );

  ipcMain.handle("desktop:writeWorkflow", async (_e, projectId, flow) => {
    writeJson(path.join(dataRoot(), "projects", projectId, "workflow.json"), flow);
    const fp = path.join(dataRoot(), "projects", projectId, "project.json");
    const cur = readJson(fp, null);
    if (cur) writeJson(fp, { ...cur, updatedAt: nowIso() });
  });

  ipcMain.handle("desktop:writeAsset", async (_e, projectId, fileName, base64) => {
    const dir = path.join(dataRoot(), "projects", projectId, "assets");
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, fileName);
    fs.writeFileSync(fp, Buffer.from(base64, "base64"));
    return { path: fp, fileUrl: `file://${fp.replace(/\\/g, "/")}` };
  });

  ipcMain.handle("desktop:readAssetAsDataUrl", async (_e, projectId, fileName) => {
    const fp = path.join(dataRoot(), "projects", projectId, "assets", fileName);
    if (!fs.existsSync(fp)) return null;
    const buf = fs.readFileSync(fp);
    return `data:application/octet-stream;base64,${buf.toString("base64")}`;
  });

  ipcMain.handle("desktop:listAssets", async (_e, projectId) => {
    const dir = path.join(dataRoot(), "projects", projectId, "assets");
    const indexFp = path.join(dir, "index.json");
    const indexed = readJson(indexFp, []);
    const byFile = new Map(indexed.map((a) => [a.fileName, a]));
    if (!fs.existsSync(dir)) return indexed;
    const out = [];
    const seen = new Set();
    for (const name of fs.readdirSync(dir)) {
      if (name === "index.json" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      seen.add(name);
      const existing = byFile.get(name);
      if (existing) {
        out.push({ ...existing, fileSize: existing.fileSize || st.size });
        continue;
      }
      const stem = name.replace(/\.[^.]+$/, "") || name;
      const lower = name.toLowerCase();
      let category = "document";
      if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lower)) category = "image";
      else if (/\.(mp4|webm|mov|mkv)$/.test(lower)) category = "video";
      else if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) category = "audio";
      else if (/\.(glb|gltf)$/.test(lower)) category = "model";
      out.push({
        id: stem,
        fileName: name,
        title: stem,
        category,
        subcategory: null,
        fileType: "application/octet-stream",
        fileSize: st.size,
        createdAt: st.mtime.toISOString(),
      });
    }
    for (const meta of indexed) {
      if (!seen.has(meta.fileName)) out.push(meta);
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  });

  ipcMain.handle("desktop:registerAssetMeta", async (_e, projectId, meta) => {
    const dir = path.join(dataRoot(), "projects", projectId, "assets");
    fs.mkdirSync(dir, { recursive: true });
    const indexFp = path.join(dir, "index.json");
    const list = readJson(indexFp, []);
    const idx = list.findIndex((a) => a.id === meta.id || a.fileName === meta.fileName);
    if (idx >= 0) list[idx] = { ...list[idx], ...meta };
    else list.unshift(meta);
    writeJson(indexFp, list);
  });

  ipcMain.handle("desktop:deleteAsset", async (_e, projectId, assetId) => {
    const dir = path.join(dataRoot(), "projects", projectId, "assets");
    const indexFp = path.join(dir, "index.json");
    const list = readJson(indexFp, []);
    const hit = list.find((a) => a.id === assetId || a.fileName === assetId);
    const fileName = (hit && hit.fileName) || assetId;
    const fp = path.join(dir, fileName);
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch {
        /* ignore */
      }
    }
    writeJson(
      indexFp,
      list.filter((a) => a.id !== assetId && a.fileName !== fileName)
    );
  });

  ipcMain.handle("desktop:readNodeText", async (_e, projectId, nodeId) => {
    const fp = path.join(dataRoot(), "projects", projectId, "text", `${nodeId}.json`);
    const raw = readJson(fp, null);
    if (!raw) return null;
    return typeof raw.content === "string" ? raw.content : null;
  });

  ipcMain.handle("desktop:writeNodeText", async (_e, projectId, nodeId, content, model) => {
    const dir = path.join(dataRoot(), "projects", projectId, "text");
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, `${nodeId}.json`), {
      content: String(content ?? ""),
      model: String(model ?? ""),
      updatedAt: nowIso(),
    });
  });
}

function webUrl() {
  return process.env.JUMENG_DESKTOP_URL || `http://${DESKTOP_HOST}:${DESKTOP_PORT}`;
}

function probeUrl(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function waitForUrl(url, tries = 180, opts = {}) {
  for (let i = 0; i < tries; i++) {
    if (opts.isDead && opts.isDead()) {
      throw new Error(
        `WebUI 进程已退出，未能监听 ${url}\n` +
          `日志：${path.join(app.getPath("userData"), "desktop-start.log")}`
      );
    }
    if (await probeUrl(url)) return;
    if (i > 0 && i % 10 === 0) {
      appendLog(`[desktop] 等待 WebUI… (${i * 0.5}s) ${url}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `WebUI 未在预期时间内启动：${url}\n` +
      `请关闭占用端口 ${DESKTOP_PORT} 的进程后重试。\n` +
      `日志：${path.join(app.getPath("userData"), "desktop-start.log")}`
  );
}

function processAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseStaleNextLock(webDir) {
  const lockPath = path.join(webDir, ".next", "dev", "lock");
  if (!fs.existsSync(lockPath)) return;
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    return;
  }
  const pid = Number(info && info.pid);
  const port = Number(info && info.port);
  if (port === DESKTOP_PORT && processAlive(pid)) {
    appendLog(`[desktop] 检测到本端口 Next 已在运行 pid=${pid}，将尝试复用`);
    return;
  }
  if (processAlive(pid)) {
    appendLog(`[desktop] 结束旧 Next pid=${pid} port=${port}`);
    try {
      const { execSync } = require("child_process");
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch (e) {
      appendLog(`[desktop] 结束旧进程失败: ${e && e.message ? e.message : e}`);
    }
  }
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

function nextEnvBase() {
  const dataParent = dataParentForNext();
  const jumengRoot = path.join(dataParent, "JumengCanvas");
  return {
    ...process.env,
    NEXT_PUBLIC_LOCAL_DESKTOP: "1",
    NEXT_PUBLIC_ADMIN_AUTH_DISABLED: "true",
    NEXT_PUBLIC_STORAGE_URL_MODE: "proxy",
    PORT: String(DESKTOP_PORT),
    HOSTNAME: DESKTOP_HOST,
    JUMENG_DATA_PARENT: dataParent,
    JUMENG_LOCAL_DATA_DIR: jumengRoot,
  };
}

function wrapChild(child) {
  let exited = false;
  let exitCode = null;
  child.stdout?.on("data", (buf) => {
    const s = String(buf);
    process.stdout.write(s);
    if (/Ready|started server|Local:/i.test(s)) appendLog(`[next] ${s.trim()}`);
  });
  child.stderr?.on("data", (buf) => {
    const s = String(buf);
    process.stderr.write(s);
    appendLog(`[next:err] ${s.trim()}`);
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
    appendLog(`[desktop] Next 进程退出 code=${code}`);
  });
  child.isDead = () => exited && !(exitCode === 0);
  return child;
}

/** 已安装：resources/web + resources/node */
async function startPackagedNext() {
  if (process.env.JUMENG_DESKTOP_URL) return null;
  const url = webUrl();
  if (await probeUrl(url)) {
    appendLog(`[desktop] 复用已在运行的 WebUI：${url}`);
    return null;
  }

  const resRoot = process.resourcesPath;
  const webRoot = path.join(resRoot, "web");
  const metaPath = path.join(webRoot, "jumeng-desktop-meta.json");
  const meta = readJson(metaPath, null);
  const serverRel = (meta && meta.serverRel) || "packages/web/server.js";
  const serverJs = path.join(webRoot, ...serverRel.split("/"));
  if (!fs.existsSync(serverJs)) {
    throw new Error(`安装包缺少 Web 服务：${serverJs}`);
  }

  const nodeExe = process.platform === "win32"
    ? path.join(resRoot, "node", "node.exe")
    : path.join(resRoot, "node", "bin", "node");
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`安装包缺少便携 Node：${nodeExe}`);
  }

  const cwd = path.dirname(serverJs);
  appendLog(`[desktop] 启动 standalone：${nodeExe} ${serverJs}`);
  const child = spawn(nodeExe, [serverJs], {
    cwd,
    env: nextEnvBase(),
    stdio: "pipe",
    windowsHide: true,
  });
  return wrapChild(child);
}

/** 开发：源码树 next dev */
async function startNextDevIfNeeded() {
  if (process.env.JUMENG_DESKTOP_URL) return null;
  const url = webUrl();
  if (await probeUrl(url)) {
    appendLog(`[desktop] 复用已在运行的 WebUI：${url}`);
    return null;
  }
  const root = path.resolve(__dirname, "../..");
  const webDir = path.join(root, "packages", "web");
  releaseStaleNextLock(webDir);
  await new Promise((r) => setTimeout(r, 800));
  releaseStaleNextLock(webDir);

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  appendLog(`[desktop] 启动 Next dev：${DESKTOP_HOST}:${DESKTOP_PORT}`);
  const child = spawn(
    npmCmd,
    [
      "exec",
      "--",
      "next",
      "dev",
      "--hostname",
      DESKTOP_HOST,
      "--port",
      String(DESKTOP_PORT),
    ],
    {
      cwd: webDir,
      env: nextEnvBase(),
      stdio: "pipe",
      shell: true,
    }
  );
  return wrapChild(child);
}

function resolveAppIconPath() {
  // 打包态：extraResources 的 icon.ico；开发态：本地 build/icon.ico
  const candidates = [
    path.join(process.resourcesPath || "", "icon.ico"),
    path.join(__dirname, "build", "icon.ico"),
    path.join(__dirname, "icon.ico"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function showBootWindow() {
  const icon = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: true,
    title: "聚梦无限画布",
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  const hint = app.isPackaged
    ? "正在启动本机界面…"
    : `正在启动本机界面（${DESKTOP_HOST}:${DESKTOP_PORT}）…`;
  const sub = app.isPackaged
    ? "请稍候"
    : "开发模式首次编译可能需要 1～2 分钟，请勿关闭";
  void mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;font-family:system-ui;background:#0f1115;color:#e8eaed;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center;line-height:1.6">
          <div style="font-size:22px;font-weight:600">聚梦无限画布</div>
          <div style="opacity:.75;margin-top:12px">${hint}</div>
          <div style="opacity:.5;margin-top:8px;font-size:13px">${sub}</div>
        </div></body></html>`
      )
  );
}

async function createWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) showBootWindow();

  const url = webUrl();
  await waitForUrl(url, app.isPackaged ? 120 : 180, {
    isDead: () => Boolean(nextProc && typeof nextProc.isDead === "function" && nextProc.isDead()),
  });
  const cfg = readJson(filePath("config.json"), defaultConfig());
  const lastId = cfg && cfg.lastProjectId ? String(cfg.lastProjectId) : "";
  const entry =
    lastId && fs.existsSync(path.join(dataRoot(), "projects", lastId, "project.json"))
      ? `${url.replace(/\/$/, "")}/${lastId}`
      : `${url.replace(/\/$/, "")}/projects`;
  appendLog(`[desktop] 打开 ${entry}`);
  await mainWindow.loadURL(entry);
}

function killNext() {
  if (nextProc && !nextProc.killed) {
    try {
      if (process.platform === "win32" && nextProc.pid) {
        const { execSync } = require("child_process");
        execSync(`taskkill /PID ${nextProc.pid} /T /F`, { stdio: "ignore" });
      } else {
        nextProc.kill();
      }
    } catch {
      /* ignore */
    }
  }
  nextProc = null;
}

app.whenReady().then(async () => {
  try {
    appendLog(`[desktop] whenReady packaged=${app.isPackaged} v=${app.getVersion()}`);
    dataRoot();
    registerIpc();
    showBootWindow();
    nextProc = app.isPackaged ? await startPackagedNext() : await startNextDevIfNeeded();
    await createWindow();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    appendLog(`[desktop] 启动失败: ${msg}`);
    dialog.showErrorBox("聚梦无限画布启动失败", msg);
    killNext();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killNext();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killNext();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
