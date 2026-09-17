/**
 * 本机开源画布：用户数据 / 素材保存位置。
 * 引导文件固定在 monorepo data/ 下，指向实际 JumengCanvas 根目录。
 *
 * 优先级：引导文件 jumeng-data-location.json > 环境变量 > 默认 data/JumengCanvas
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type JumengDataLocationBootstrap = {
  version: 1;
  /** 实际数据根（含 projects、assets、providers.json 等） */
  dataRoot: string;
  updatedAt: string;
};

export type JumengDataLocationInfo = {
  dataRoot: string;
  defaultDataRoot: string;
  bootstrapPath: string;
  isCustom: boolean;
  /** 环境变量（若有）；仅作提示，不阻止设置页修改 */
  envOverride: string | null;
};

export type SetDataLocationOpts = {
  /**
   * 迁移完成后删除旧数据根。默认 true。
   * 仅删除规范化后的 JumengCanvas 目录，不会删引导文件所在 data/ 父目录。
   */
  deleteOld?: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

/** monorepo 的 data 目录（引导文件固定写在这里，不随用户数据根搬家） */
export function resolveDataParentDir(): string {
  const cwd = process.cwd();
  if (/packages[\\/]web$/i.test(cwd)) {
    return path.resolve(cwd, "../../data");
  }
  const asRoot = path.resolve(cwd, "data");
  if (fs.existsSync(path.join(cwd, "packages", "web")) || fs.existsSync(asRoot)) {
    return asRoot;
  }
  return path.resolve(cwd, "data");
}

export function defaultJumengDataRoot(): string {
  return path.join(resolveDataParentDir(), "JumengCanvas");
}

export function bootstrapFilePath(): string {
  return path.join(resolveDataParentDir(), "jumeng-data-location.json");
}

/** 规范化用户输入：绝对路径，并以 JumengCanvas 结尾 */
export function normalizeUserDataRootInput(raw: string): string {
  const t = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!t) throw new Error("请先选择保存文件夹");
  if (!path.isAbsolute(t)) {
    throw new Error("请选择绝对路径文件夹");
  }
  let resolved = path.resolve(t);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error("不能把磁盘根目录设为数据目录，请选一个子文件夹");
  }
  if (!/JumengCanvas$/i.test(resolved)) {
    resolved = path.join(resolved, "JumengCanvas");
  }
  return resolved;
}

function readBootstrap(): JumengDataLocationBootstrap | null {
  const fp = bootstrapFilePath();
  try {
    if (!fs.existsSync(fp)) return null;
    const raw = JSON.parse(fs.readFileSync(fp, "utf8")) as Partial<JumengDataLocationBootstrap>;
    const dataRoot = String(raw.dataRoot || "").trim();
    if (!dataRoot || !path.isAbsolute(dataRoot)) return null;
    return {
      version: 1,
      dataRoot: path.resolve(dataRoot),
      updatedAt: String(raw.updatedAt || nowIso()),
    };
  } catch {
    return null;
  }
}

export function writeBootstrap(dataRoot: string): JumengDataLocationBootstrap {
  const parent = resolveDataParentDir();
  fs.mkdirSync(parent, { recursive: true });
  const payload: JumengDataLocationBootstrap = {
    version: 1,
    dataRoot: path.resolve(dataRoot),
    updatedAt: nowIso(),
  };
  fs.writeFileSync(bootstrapFilePath(), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function dataRootFromEnv(): string | null {
  const env = process.env.JUMENG_LOCAL_DATA_DIR?.trim();
  if (!env) return null;
  let resolved = path.resolve(env);
  if (!/JumengCanvas$/i.test(resolved)) {
    resolved = path.join(resolved, "JumengCanvas");
  }
  return resolved;
}

/** 解析当前生效的数据根：引导文件 > 环境变量 > 默认 */
export function resolveActiveDataRoot(): string {
  const boot = readBootstrap();
  if (boot?.dataRoot) {
    fs.mkdirSync(path.join(boot.dataRoot, "projects"), { recursive: true });
    return boot.dataRoot;
  }
  const fromEnv = dataRootFromEnv();
  if (fromEnv) {
    fs.mkdirSync(path.join(fromEnv, "projects"), { recursive: true });
    return fromEnv;
  }
  const def = defaultJumengDataRoot();
  fs.mkdirSync(path.join(def, "projects"), { recursive: true });
  return def;
}

export function getDataLocationInfo(): JumengDataLocationInfo {
  const defaultDataRoot = defaultJumengDataRoot();
  const dataRoot = resolveActiveDataRoot();
  const envRaw = process.env.JUMENG_LOCAL_DATA_DIR?.trim() || null;
  const isCustom =
    path.resolve(dataRoot).toLowerCase() !== path.resolve(defaultDataRoot).toLowerCase();
  return {
    dataRoot,
    defaultDataRoot,
    bootstrapPath: bootstrapFilePath(),
    isCustom,
    envOverride: envRaw ? path.resolve(envRaw) : null,
  };
}

export function ensureDataRootLayout(dataRoot: string): void {
  fs.mkdirSync(path.join(dataRoot, "projects"), { recursive: true });
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isJumengCanvasDir(dir: string): boolean {
  return /JumengCanvas$/i.test(path.resolve(dir));
}

/**
 * 安全删除旧数据根：只允许删名为 JumengCanvas 的目录，且不得误删引导父目录 / 新根 / 盘符根。
 */
export function safeRemoveOldDataRoot(oldRoot: string, nextRoot: string): void {
  const oldResolved = path.resolve(oldRoot);
  const nextResolved = path.resolve(nextRoot);
  if (samePath(oldResolved, nextResolved)) return;

  const parsed = path.parse(oldResolved);
  if (oldResolved === parsed.root) {
    throw new Error("拒绝删除磁盘根目录");
  }
  if (!isJumengCanvasDir(oldResolved)) {
    throw new Error(`拒绝删除非 JumengCanvas 目录：${oldResolved}`);
  }
  // 禁止删引导文件所在的 data 父目录本身
  if (samePath(oldResolved, resolveDataParentDir())) {
    throw new Error("拒绝删除引导文件所在目录");
  }
  // 禁止删包含新目录的祖先（避免把新位置一起删掉）
  const rel = path.relative(oldResolved, nextResolved);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error("新目录位于旧目录内部，拒绝删除旧目录");
  }
  if (!fs.existsSync(oldResolved)) return;
  fs.rmSync(oldResolved, { recursive: true, force: true });
}

function migrateDataRoot(current: string, nextRoot: string): void {
  if (samePath(current, nextRoot)) return;
  if (!fs.existsSync(current)) {
    ensureDataRootLayout(nextRoot);
    return;
  }
  ensureDataRootLayout(nextRoot);
  // 完整覆盖复制，保证迁移后内容一致，再删旧目录
  fs.cpSync(current, nextRoot, { recursive: true, force: true });
}

/**
 * 弹出系统文件夹选择框，返回用户选中的绝对路径；取消则 null。
 * Windows: FolderBrowserDialog；macOS: choose folder；其它：不支持。
 */
export function pickDirectoryDialog(initialDir?: string): string | null {
  const initial =
    initialDir && path.isAbsolute(initialDir)
      ? path.resolve(initialDir)
      : resolveDataParentDir();

  if (process.platform === "win32") {
    const escaped = initial.replace(/'/g, "''");
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$d.Description = '选择开源画布数据保存文件夹（将在其下使用 JumengCanvas）'",
      "$d.ShowNewFolderButton = $true",
      `if (Test-Path -LiteralPath '${escaped}') { $d.SelectedPath = '${escaped}' }`,
      "$r = $d.ShowDialog()",
      "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    ].join("; ");
    try {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps],
        {
          encoding: "utf8",
          windowsHide: false,
          timeout: 600_000,
          maxBuffer: 1024 * 1024,
        }
      );
      const picked = String(out || "").trim();
      return picked && path.isAbsolute(picked) ? path.resolve(picked) : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`打开文件夹选择框失败：${msg}`);
    }
  }

  if (process.platform === "darwin") {
    try {
      const out = execFileSync(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "选择开源画布数据保存文件夹")'],
        { encoding: "utf8", timeout: 600_000 }
      );
      const picked = String(out || "").trim().replace(/\/$/, "");
      return picked && path.isAbsolute(picked) ? path.resolve(picked) : null;
    } catch {
      return null;
    }
  }

  throw new Error("当前系统不支持文件夹选择框，请在 Windows / macOS 本机 Harness 中使用");
}

/**
 * 切换数据根：迁移数据 → 写引导文件 → 默认删除旧目录。
 */
export function setActiveDataRoot(
  rawPath: string,
  opts?: SetDataLocationOpts
): JumengDataLocationInfo {
  const deleteOld = opts?.deleteOld !== false;
  const nextRoot = normalizeUserDataRootInput(rawPath);
  const current = resolveActiveDataRoot();

  if (samePath(current, nextRoot)) {
    writeBootstrap(nextRoot);
    ensureDataRootLayout(nextRoot);
    return getDataLocationInfo();
  }

  migrateDataRoot(current, nextRoot);
  writeBootstrap(nextRoot);
  ensureDataRootLayout(nextRoot);

  if (deleteOld) {
    safeRemoveOldDataRoot(current, nextRoot);
  }
  return getDataLocationInfo();
}

/**
 * 恢复默认位置：把当前数据迁回默认目录，删除旧自定义目录，并去掉引导文件。
 */
export function resetDataRootToDefault(opts?: SetDataLocationOpts): JumengDataLocationInfo {
  const deleteOld = opts?.deleteOld !== false;
  const current = resolveActiveDataRoot();
  const def = defaultJumengDataRoot();

  if (!samePath(current, def)) {
    migrateDataRoot(current, def);
    if (deleteOld) {
      safeRemoveOldDataRoot(current, def);
    }
  }

  const fp = bootstrapFilePath();
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  ensureDataRootLayout(def);
  return getDataLocationInfo();
}
