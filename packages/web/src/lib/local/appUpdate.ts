/**
 * 开源本地版「检查更新」（bat / 源码便携包）：
 * 以 Gitee main 分支根 package.json 的 version 为准，
 * 有更新时下载源码 zip → 临时目录解压校验 → 覆盖程序文件（不动 data / runtime / node_modules 等）。
 * 依赖有变化时（Windows）拉起独立隐藏脚本：停服 → npm install → 重启。
 * Electron 安装版走 packages/desktop/updater.js（官网 latest.json + Setup.exe）。
 */
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveDataParentDir } from "./dataLocation";

const execFileAsync = promisify(execFile);

/** Gitee 开源仓库（与落地页、exe 发版一致） */
export const UPDATE_GITEE_OWNER = "liukewen0112";
export const UPDATE_GITEE_REPO = "Jumeng-Canvas-Local-Client";
export const UPDATE_BRANCH = "main";
export const UPDATE_REPO = `${UPDATE_GITEE_OWNER}/${UPDATE_GITEE_REPO}`;
export const UPDATE_REPO_URL = `https://gitee.com/${UPDATE_REPO}`;
const REMOTE_PACKAGE_URL = `https://gitee.com/${UPDATE_REPO}/raw/${UPDATE_BRANCH}/package.json`;
const REMOTE_ZIP_URL = `https://gitee.com/${UPDATE_REPO}/repository/archive/${UPDATE_BRANCH}.zip`;

const CHECK_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** 覆盖时跳过的顶层目录：用户数据、便携 Node、依赖与版本库 */
const SKIP_TOP_DIRS = new Set(["data", "runtime", "node_modules", ".git"]);
/** 任意层级跳过的目录名 */
const SKIP_ANY_DIRS = new Set(["node_modules", ".next", ".git"]);

export interface UpdateCheckResult {
  localVersion: string;
  remoteVersion: string;
  hasUpdate: boolean;
  /** 是否允许自动覆盖（位于 git 仓库内时禁止） */
  canApply: boolean;
  blockedReason?: string;
  repoUrl: string;
}

export interface UpdateApplyResult {
  updated: boolean;
  fromVersion: string;
  toVersion: string;
  filesCopied: number;
  depsChanged: boolean;
  /** 已拉起后台脚本：停服 → npm install → 重启 */
  restarting: boolean;
  /** 依赖有变化但当前平台无法自动重启，需用户手动重装并重启 */
  manualRestart: boolean;
}

/** 画布程序根目录（monorepo 根，含 packages/、scripts/） */
export function appRootDir(): string {
  return path.dirname(resolveDataParentDir());
}

function readVersion(pkgPath: string): string {
  const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
  const v = String(raw.version ?? "").trim();
  if (!v) throw new Error(`${pkgPath} 缺少 version`);
  return v;
}

/** 比较 x.y.z 版本号（忽略 v 前缀与 -预发布 后缀）；a>b 返回正数 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
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

/** 向上查找 .git：画布位于任一 git 仓库内即视为开发目录 */
function findGitAncestor(start: string): string | null {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Gitee 返回 HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error("连接 Gitee 超时，请检查网络后重试");
    throw new Error(`无法连接 Gitee：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const root = appRootDir();
  const localVersion = readVersion(path.join(root, "package.json"));
  const res = await fetchWithTimeout(`${REMOTE_PACKAGE_URL}?t=${Date.now()}`, CHECK_TIMEOUT_MS);
  const remote = (await res.json()) as { version?: unknown };
  const remoteVersion = String(remote.version ?? "").trim();
  if (!remoteVersion) throw new Error("远端 package.json 缺少 version");
  const gitRoot = findGitAncestor(root);
  return {
    localVersion,
    remoteVersion,
    hasUpdate: compareVersions(remoteVersion, localVersion) > 0,
    canApply: !gitRoot,
    blockedReason: gitRoot
      ? `画布目录位于 git 仓库（${gitRoot}）内，为避免覆盖本地修改已禁止自动更新，请用 git 手动拉取`
      : undefined,
    repoUrl: UPDATE_REPO_URL,
  };
}

/** 解压 zip：优先系统 tar（Win10+ 自带 bsdtar，支持 zip 与中文文件名），失败再回退 */
async function extractZip(zipPath: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    await execFileAsync("tar", ["-xf", zipPath, "-C", dest], { windowsHide: true });
    return;
  } catch {
    /* 回退 */
  }
  if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true }
    );
  } else {
    await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", dest]);
  }
}

/** 解压目录下定位源码根（Gitee zip 外层多为 仓库名-分支/） */
function locateSourceRoot(extractDir: string): string {
  if (fs.existsSync(path.join(extractDir, "package.json"))) return extractDir;
  const dirs = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(extractDir, d.name));
  const hit = dirs.find((d) => fs.existsSync(path.join(d, "package.json")));
  if (!hit) throw new Error("更新包结构异常：找不到 package.json");
  return hit;
}

/**
 * 依赖指纹：只取各 package.json 的依赖字段与 lock 中第三方包的版本/完整性，
 * 仅改 version 号不算依赖变化，避免每次更新都重装依赖。
 */
function depsFingerprint(root: string): string {
  const parts: unknown[] = [];
  const pkgFiles = [path.join(root, "package.json")];
  const pkgsDir = path.join(root, "packages");
  if (fs.existsSync(pkgsDir)) {
    for (const name of fs.readdirSync(pkgsDir).sort()) {
      const fp = path.join(pkgsDir, name, "package.json");
      if (fs.existsSync(fp)) pkgFiles.push(fp);
    }
  }
  for (const fp of pkgFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(fp, "utf8")) as Record<string, unknown>;
      parts.push([
        path.relative(root, fp).replace(/\\/g, "/"),
        j.dependencies ?? null,
        j.devDependencies ?? null,
        j.optionalDependencies ?? null,
        j.peerDependencies ?? null,
        j.workspaces ?? null,
      ]);
    } catch {
      parts.push([fp, "unreadable"]);
    }
  }
  const lockPath = path.join(root, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
        packages?: Record<string, { version?: string; integrity?: string }>;
      };
      const entries = Object.entries(lock.packages ?? {})
        .filter(([k]) => k.includes("node_modules/"))
        .map(([k, v]) => [k, v.version ?? "", v.integrity ?? ""])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      parts.push(entries);
    } catch {
      parts.push("lock-unreadable");
    }
  }
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** 是否跳过该相对路径（posix 分隔） */
function shouldSkip(rel: string, isDir: boolean): boolean {
  const segs = rel.split("/");
  if (SKIP_TOP_DIRS.has(segs[0])) return true;
  if (segs.some((s, i) => (isDir || i < segs.length - 1) && SKIP_ANY_DIRS.has(s))) return true;
  const base = segs[segs.length - 1];
  if (!isDir && /^\.env/i.test(base)) return true;
  if (rel === "config/lan.env") return true;
  return false;
}

/** 覆盖复制（只新增/覆盖，不删除本地多出的文件） */
function copyTree(srcRoot: string, destRoot: string): number {
  let count = 0;
  const walk = (relDir: string) => {
    const abs = path.join(srcRoot, relDir);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (shouldSkip(rel, ent.isDirectory())) continue;
      if (ent.isDirectory()) {
        walk(rel);
      } else if (ent.isFile()) {
        const dest = path.join(destRoot, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(srcRoot, rel), dest);
        count += 1;
      }
    }
  };
  walk("");
  return count;
}

/**
 * Windows：经 wscript 隐藏运行 scripts/update-restart.bat。
 * wscript 启动后即退出，bat 不再属于当前 Next 进程树，停服时不会被一起结束。
 */
function scheduleRestart(root: string): boolean {
  if (process.platform !== "win32") return false;
  const vbs = path.join(root, "scripts", "start-desktop-hidden.vbs");
  const bat = path.join(root, "scripts", "update-restart.bat");
  if (!fs.existsSync(vbs) || !fs.existsSync(bat)) return false;
  const child = spawn("wscript.exe", ["//nologo", vbs, bat], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return true;
}

let applying = false;

export async function applyUpdate(): Promise<UpdateApplyResult> {
  if (applying) throw new Error("更新正在进行中，请稍候");
  applying = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jumeng-update-"));
  try {
    const check = await checkForUpdate();
    const noop: UpdateApplyResult = {
      updated: false,
      fromVersion: check.localVersion,
      toVersion: check.localVersion,
      filesCopied: 0,
      depsChanged: false,
      restarting: false,
      manualRestart: false,
    };
    if (!check.hasUpdate) return noop;
    if (!check.canApply) throw new Error(check.blockedReason || "当前目录不允许自动更新");

    // 1. 下载并完整解压到临时目录，校验通过后才动程序目录，避免半途失败留下残缺文件
    const zipPath = path.join(tmp, "update.zip");
    const res = await fetchWithTimeout(REMOTE_ZIP_URL, DOWNLOAD_TIMEOUT_MS);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    const extractDir = path.join(tmp, "src");
    await extractZip(zipPath, extractDir);
    const srcRoot = locateSourceRoot(extractDir);
    if (!fs.existsSync(path.join(srcRoot, "packages", "web", "package.json"))) {
      throw new Error("更新包结构异常：缺少 packages/web");
    }
    const toVersion = readVersion(path.join(srcRoot, "package.json"));
    if (compareVersions(toVersion, check.localVersion) <= 0) return noop;

    // 2. 覆盖程序文件
    const root = appRootDir();
    const depsChanged = depsFingerprint(root) !== depsFingerprint(srcRoot);
    const filesCopied = copyTree(srcRoot, root);

    // 3. 依赖变化：拉起后台重装 + 重启；仅代码变化由 Next 热更新，前端刷新即可
    let restarting = false;
    let manualRestart = false;
    if (depsChanged) {
      restarting = scheduleRestart(root);
      manualRestart = !restarting;
    }
    return {
      updated: true,
      fromVersion: check.localVersion,
      toVersion,
      filesCopied,
      depsChanged,
      restarting,
      manualRestart,
    };
  } finally {
    applying = false;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
