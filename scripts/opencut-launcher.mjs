/**
 * 剪辑台（OpenCut classic）解析与启动，供 start-browser / opencut-dev 共用。
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const OPENCUT_DEFAULT_PORT = 3100;

export function resolveOpenCutWork(root) {
  const envWork = process.env.OPENCUT_WORK_DIR?.trim();
  if (envWork && fs.existsSync(path.join(envWork, "apps", "web", "package.json"))) {
    return envWork;
  }
  if (fs.existsSync("C:\\oc\\apps\\web\\package.json")) {
    return "C:\\oc";
  }
  const vendor = path.join(root, "vendor", "opencut-classic");
  if (fs.existsSync(path.join(vendor, "apps", "web", "package.json"))) {
    return vendor;
  }
  return null;
}

export function findBunBin() {
  const fromEnv = process.env.BUN_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const win = path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe");
  if (fs.existsSync(win)) return win;
  const unix = path.join(process.env.HOME || "", ".bun", "bin", "bun");
  if (fs.existsSync(unix)) return unix;
  return "bun";
}

/** 写入聚梦嵌入所需的 .env.local（已存在则不覆盖） */
export function ensureOpenCutEnvLocal(webDir, canvasOrigin = "http://127.0.0.1:3456") {
  const envLocal = path.join(webDir, ".env.local");
  if (fs.existsSync(envLocal)) return false;
  fs.writeFileSync(
    envLocal,
    [
      "NODE_ENV=development",
      "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100",
      "NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com",
      "NEXT_PUBLIC_JUMENG_MODE=1",
      `NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN=${canvasOrigin}`,
      "DATABASE_URL=postgresql://opencut:opencut@127.0.0.1:5432/opencut",
      "BETTER_AUTH_SECRET=jumeng-local-opencut-dev-secret",
      "UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079",
      "UPSTASH_REDIS_REST_TOKEN=example_token",
      "MARBLE_WORKSPACE_KEY=local-dev",
      "FREESOUND_CLIENT_ID=local-dev",
      "FREESOUND_API_KEY=local-dev",
      "",
    ].join("\n"),
    "utf8",
  );
  return true;
}

export function probeHttp(target, timeoutMs = 2000) {
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

export function killPortListeners(port, log = console.log) {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(`netstat -ano | findstr ":${port}"`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
    for (const p of pids) {
      if (!p || p === process.pid) continue;
      try {
        execSync(`taskkill /PID ${p} /T /F`, { stdio: "ignore" });
        log(`[OpenCut] killed pid=${p} on :${port}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no listeners */
  }
}

/**
 * 启动剪辑台 dev。未安装依赖时返回 { ok:false, reason }。
 */
export function spawnOpenCutDev({
  root,
  port = OPENCUT_DEFAULT_PORT,
  canvasOrigin = "http://127.0.0.1:3456",
  stdio = "inherit",
  log = console.log,
}) {
  const work = resolveOpenCutWork(root);
  if (!work) {
    return {
      ok: false,
      reason:
        "未找到剪辑台源码（C:\\oc 或 vendor/opencut-classic）。请先执行: npm run editor:install",
    };
  }
  const webDir = path.join(work, "apps", "web");
  const bunBin = findBunBin();
  // 粗检：工作副本根目录需有 node_modules（bun install 后）
  if (!fs.existsSync(path.join(work, "node_modules"))) {
    return {
      ok: false,
      reason: `剪辑台依赖未安装（${work}）。请先执行: npm run editor:install`,
    };
  }

  if (ensureOpenCutEnvLocal(webDir, canvasOrigin)) {
    log(`[OpenCut] wrote ${path.join(webDir, ".env.local")}`);
  }

  log(`[OpenCut] starting → http://127.0.0.1:${port} cwd=${webDir}`);
  const child = spawn(
    bunBin,
    ["run", "dev", "--", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: webDir,
      stdio,
      shell: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_JUMENG_MODE: "1",
        NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN: canvasOrigin,
      },
    },
  );
  return { ok: true, child, work, webDir, port };
}
