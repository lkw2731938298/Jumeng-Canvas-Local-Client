/**
 * Local browser harness: free stale Next lock -> start WebUI -> open default browser.
 * No Electron.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "packages", "web");
const port = Number(process.env.JUMENG_DESKTOP_PORT || 3456);
const host = "127.0.0.1";
const url = `http://${host}:${port}`;
const entry = `${url}/projects`;
const lockPath = path.join(webDir, ".next", "dev", "lock");

function log(msg) {
  console.log(`[Jumeng] ${msg}`);
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

function killPid(pid) {
  if (!processAlive(pid)) return;
  log(`kill pid=${pid}`);
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* ignore */
  }
}

function readLock() {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function clearLock() {
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

function probe(target, timeoutMs = 2000) {
  return new Promise((resolve) => {
    try {
      const req = http.get(target, { timeout: timeoutMs }, (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 500));
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

/**
 * Only reuse if HTTP actually answers. Hung listeners (CLOSE_WAIT piles) get killed.
 * 无窗口启动时强制重启，避免沿用仍带旧 JUMENG_LOCAL_DATA_DIR 的 Next 进程。
 */
async function ensurePortFreeOrHealthy() {
  const forceFresh =
    process.env.JUMENG_DESKTOP_SILENT === "1" ||
    process.env.JUMENG_FORCE_RESTART === "1";

  if (!forceFresh && (await probe(url))) {
    log(`healthy server already on ${url}`);
    return { reuse: true };
  }

  if (forceFresh && (await probe(url))) {
    log("force restart (clear stale env / pick up launcher changes)");
  }

  const info = readLock();
  const pid = Number(info?.pid);
  if (processAlive(pid)) {
    log(`stale/hung Next pid=${pid} not responding — restarting`);
    killPid(pid);
  }

  // Also kill whoever is listening on our port (Windows)
  if (process.platform === "win32") {
    try {
      const out = execSync(`netstat -ano | findstr ":${port}"`, {
        encoding: "utf8",
      });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const m = line.trim().match(/(\d+)\s*$/);
        if (m) pids.add(Number(m[1]));
      }
      for (const p of pids) {
        if (p && p !== process.pid) killPid(p);
      }
    } catch {
      /* no listeners */
    }
  }

  clearLock();
  await new Promise((r) => setTimeout(r, 1000));
  return { reuse: false };
}

async function waitReady(child, tries = 120) {
  for (let i = 0; i < tries; i++) {
    if (child && child.exitCode != null) {
      throw new Error(`Next exited early code=${child.exitCode}`);
    }
    if (await probe(url)) return;
    if (i > 0 && i % 10 === 0) log(`waiting... ${(i * 0.5).toFixed(0)}s`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`WebUI not ready: ${url}`);
}

function openBrowser(target) {
  log(`open browser: ${target}`);
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
  }
}

/** 解析 monorepo 根或 web 包下的 next CLI（避免 npm.cmd + 空格路径在 shell:true 下被拆坏） */
function resolveNextCli() {
  const candidates = [
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
    path.join(webDir, "node_modules", "next", "dist", "bin", "next"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `next CLI not found. Run npm install in ${root} (expected node_modules/next).`
  );
}

/** 清掉损坏的 .next 缓存（并发启动 / 中途杀掉常导致 turbopack SST / manifest 丢失） */
function clearNextCache() {
  const nextDir = path.join(webDir, ".next");
  if (!fs.existsSync(nextDir)) return;
  log(`clear broken cache: ${nextDir}`);
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
  } catch (err) {
    log(`warn: clear .next failed: ${err instanceof Error ? err.message : err}`);
  }
}

function startNextDev() {
  const nextCli = resolveNextCli();
  log(`starting Next via ${process.execPath} ${nextCli}`);
  // 不用 npm.cmd：C:\Program Files\... 在 shell:true 时会被拆成 'C:\Program'
  const child = spawn(
    process.execPath,
    [nextCli, "dev", "--hostname", host, "--port", String(port)],
    {
      cwd: webDir,
      env: {
        ...process.env,
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
      },
      stdio: "inherit",
      shell: false,
    }
  );
  child.on("exit", (code) => {
    log(`Next exited code=${code ?? "?"}`);
    if (code) process.exitCode = code;
  });
  return child;
}

async function main() {
  process.env.NEXT_PUBLIC_LOCAL_DESKTOP = "1";
  process.env.NEXT_PUBLIC_ADMIN_AUTH_DISABLED = "true";
  process.env.PORT = String(port);
  // 不强制注入 JUMENG_LOCAL_DATA_DIR，否则设置页无法改保存位置（env 会锁死）。
  // 未设 env 时由 Next /api/local → resolveActiveDataRoot（引导文件或默认 data/JumengCanvas）。
  const dataParent = path.join(root, "data");
  fs.mkdirSync(dataParent, { recursive: true });

  const silent = process.env.JUMENG_DESKTOP_SILENT === "1";
  log(`url ${url}${silent ? " (silent / no console)" : " (keep this window open)"}`);
  log(`node ${process.execPath}`);
  log(
    process.env.JUMENG_LOCAL_DATA_DIR?.trim()
      ? `data env override ${process.env.JUMENG_LOCAL_DATA_DIR}`
      : `data default under ${dataParent}\\JumengCanvas (editable in settings)`
  );

  const { reuse } = await ensurePortFreeOrHealthy();
  let child = null;

  if (reuse) {
    log("reuse healthy server");
  } else {
    clearNextCache();
    child = startNextDev();
    await waitReady(child);
  }

  openBrowser(entry);
  if (silent) {
    log("browser opened. stop with stop bat (or kill the Node process).");
  } else {
    log("browser opened. close this window to stop the server.");
  }

  if (!child) {
    if (process.stdin && typeof process.stdin.resume === "function") {
      process.stdin.resume();
    }
    await new Promise((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const timer = setInterval(() => {}, 60_000);
      process.once("beforeExit", () => clearInterval(timer));
    });
    return;
  }

  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

main().catch((err) => {
  console.error(err);
  // 无窗口启动时不能 pause（会永远卡住），由 bat 弹 MsgBox
  if (process.platform === "win32" && process.env.JUMENG_DESKTOP_SILENT !== "1") {
    console.log("\nStart failed. Press any key to exit...");
    try {
      execSync("pause", { stdio: "inherit", shell: true });
    } catch {
      /* ignore */
    }
  }
  process.exit(1);
});
