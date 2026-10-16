/**
 * 本机技能目录扫描：dataRoot/agent-skills + ~/.codex/skills。
 * 仅在 Node（/api/local）侧使用。
 *
 * 兼容常见解压结构：
 * - agent-skills/{slug}/SKILL.md
 * - agent-skills/{slug}/{slug}/SKILL.md（zip 多套一层）
 * - skill.md / Skill.md（大小写不敏感）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { pickDirectoryDialog } from "@/lib/local/dataLocation";
import { parseSkillMarkdown } from "./parse";

export type DiskSkillMeta = {
  slug: string;
  name: string;
  description: string;
  source: "disk" | "codex";
  /** 技能包根目录绝对路径（含 SKILL.md 的那一层） */
  dir: string;
};

export type DiskSkillDetail = DiskSkillMeta & {
  body: string;
  references: Record<string, string>;
};

/** 嵌套解压最多再往下找几层 */
const MAX_SKILL_NEST_DEPTH = 3;

function safeSlug(name: string): string {
  const base = path.basename(name);
  return base.replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || "skill";
}

/** 画布数据根下的技能目录 */
export function agentSkillsDir(dataRoot: string): string {
  return path.join(dataRoot, "agent-skills");
}

/** Codex 默认安装目录（若存在则只读合并） */
export function codexSkillsDir(): string {
  return path.join(os.homedir(), ".codex", "skills");
}

/** 判断是否为目录（Dirent 在部分 Windows 场景不可靠时回退 stat） */
function isDirEntry(root: string, ent: fs.Dirent): boolean {
  if (ent.isDirectory()) return true;
  if (ent.isFile() || ent.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(root, ent.name)).isDirectory();
    } catch {
      return false;
    }
  }
  try {
    return fs.statSync(path.join(root, ent.name)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 在目录内找 SKILL.md（大小写不敏感）。
 * 返回绝对路径；没有则 null。
 */
export function findSkillMarkdownFile(dir: string): string | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const direct = path.join(dir, "SKILL.md");
  if (fs.existsSync(direct)) return direct;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.toLowerCase() === "skill.md") {
        return path.join(dir, name);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 从候选根目录起，BFS 找第一个含 SKILL.md 的包根（含自身）。
 * 用于 zip 解压多套一层：outer/inner/SKILL.md。
 */
export function resolveSkillPackageDir(candidateRoot: string): string | null {
  if (!candidateRoot || !fs.existsSync(candidateRoot)) return null;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: candidateRoot, depth: 0 }];
  const seen = new Set<string>();
  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    const key = path.resolve(dir).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (findSkillMarkdownFile(dir)) return dir;
    if (depth >= MAX_SKILL_NEST_DEPTH) continue;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      if (!isDirEntry(dir, ent)) continue;
      // 跳过常见非技能子目录，减少误扫
      if (/^(node_modules|\.git|\.codex|assets|references|scripts)$/i.test(ent.name)) {
        continue;
      }
      queue.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
    }
  }
  return null;
}

function readReferences(dir: string): Record<string, string> {
  const references: Record<string, string> = {};
  const refDir = path.join(dir, "references");
  if (!fs.existsSync(refDir)) return references;
  for (const ent of fs.readdirSync(refDir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (!/\.(md|txt|markdown)$/i.test(ent.name)) continue;
    try {
      references[ent.name] = fs.readFileSync(path.join(refDir, ent.name), "utf8");
    } catch {
      /* skip */
    }
  }
  return references;
}

function metaFromPackage(
  slug: string,
  packageDir: string,
  source: "disk" | "codex"
): DiskSkillMeta {
  const skillFile = findSkillMarkdownFile(packageDir);
  if (!skillFile) {
    return { slug, name: slug, description: "", source, dir: packageDir };
  }
  try {
    const raw = fs.readFileSync(skillFile, "utf8");
    const parsed = parseSkillMarkdown(raw, slug);
    return {
      slug,
      name: parsed.name || slug,
      description: parsed.description || "",
      source,
      dir: packageDir,
    };
  } catch {
    return { slug, name: slug, description: "", source, dir: packageDir };
  }
}

function scanSkillsRoot(
  root: string,
  source: "disk" | "codex"
): DiskSkillMeta[] {
  if (!fs.existsSync(root)) return [];
  const out: DiskSkillMeta[] = [];
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const ent of ents) {
    if (!isDirEntry(root, ent)) continue;
    const slug = safeSlug(ent.name);
    const topDir = path.join(root, ent.name);
    const packageDir = resolveSkillPackageDir(topDir);
    if (!packageDir) continue;
    out.push(metaFromPackage(slug, packageDir, source));
  }
  return out;
}

/**
 * 合并列表：默认只扫 dataRoot/agent-skills。
 * ~/.codex/skills 含大量编码 Agent 技能，不自动进画布助手下拉；
 * 需要时把包拷到 agent-skills，或 includeCodex=true。
 */
export function listDiskAgentSkills(
  dataRoot: string,
  opts?: { includeCodex?: boolean }
): DiskSkillMeta[] {
  const map = new Map<string, DiskSkillMeta>();
  if (opts?.includeCodex) {
    for (const s of scanSkillsRoot(codexSkillsDir(), "codex")) {
      map.set(s.slug, s);
    }
  }
  for (const s of scanSkillsRoot(agentSkillsDir(dataRoot), "disk")) {
    map.set(s.slug, s);
  }
  return [...map.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * 按 slug 定位技能包目录：先 agent-skills/{slug}，再扫一遍匹配 safeSlug。
 */
function findPackageBySlug(
  root: string,
  slug: string
): { packageDir: string } | null {
  const key = safeSlug(String(slug || "").trim());
  if (!key) return null;
  const direct = path.join(root, key);
  const resolved = resolveSkillPackageDir(direct);
  if (resolved) return { packageDir: resolved };
  // 目录名与 safeSlug 不完全一致时再扫
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!isDirEntry(root, ent)) continue;
      if (safeSlug(ent.name) !== key) continue;
      const pkg = resolveSkillPackageDir(path.join(root, ent.name));
      if (pkg) return { packageDir: pkg };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function readDiskAgentSkill(
  dataRoot: string,
  slug: string
): DiskSkillDetail | null {
  const key = safeSlug(String(slug || "").trim());
  if (!key) return null;
  const candidates: Array<{ root: string; source: "disk" | "codex" }> = [
    { root: agentSkillsDir(dataRoot), source: "disk" },
    { root: codexSkillsDir(), source: "codex" },
  ];
  for (const c of candidates) {
    const hit = findPackageBySlug(c.root, key);
    if (!hit) continue;
    const skillFile = findSkillMarkdownFile(hit.packageDir);
    if (!skillFile) continue;
    const raw = fs.readFileSync(skillFile, "utf8");
    const parsed = parseSkillMarkdown(raw, key);
    return {
      slug: key,
      name: parsed.name || key,
      description: parsed.description || "",
      source: c.source,
      dir: hit.packageDir,
      body: parsed.body,
      references: readReferences(hit.packageDir),
    };
  }
  return null;
}

/** 确保画布技能目录存在，并写入简短 README */
export function ensureAgentSkillsDir(dataRoot: string): string {
  const dir = agentSkillsDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.txt");
  const text = [
    "把 Codex 式技能包放到本目录：",
    "  agent-skills/{技能名}/SKILL.md",
    "  agent-skills/{技能名}/references/*.md（可选）",
    "",
    "解压 zip 后请保证「本目录下第一层文件夹」内能找到 SKILL.md。",
    "若解压成 agent-skills/foo/foo/SKILL.md，画布也会自动识别（最多再往下 3 层）。",
    "",
    "放入或改完后，请到设置页点「刷新技能列表」。",
    "",
    "画布内置了 photo-relic-editorial，无需拷贝即可在助手顶栏选用。",
    "若已在 ~/.codex/skills 安装技能，请把对应文件夹复制到本目录后才会出现在助手列表。",
    "",
  ].join("\n");
  try {
    fs.writeFileSync(readme, text, "utf8");
  } catch {
    /* ignore */
  }
  return dir;
}

export function openDirectoryInOs(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const platform = process.platform;
  if (platform === "win32") {
    exec(`explorer "${dir.replace(/"/g, "")}"`);
  } else if (platform === "darwin") {
    exec(`open "${dir}"`);
  } else {
    exec(`xdg-open "${dir}"`);
  }
}

/** 仅列出 ~/.codex/skills（供设置页勾选导入） */
export function listCodexSkillsOnly(): DiskSkillMeta[] {
  return scanSkillsRoot(codexSkillsDir(), "codex").sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (ent.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * 从本机任选文件夹导入技能包到 dataRoot/agent-skills。
 * 弹出系统目录对话框；取消返回 cancelled。
 */
export function importLocalSkillFolderToLocal(dataRoot: string): {
  cancelled: boolean;
  slug?: string;
  name?: string;
  destDir?: string;
  error?: string;
} {
  const localRoot = ensureAgentSkillsDir(dataRoot);
  let picked: string | null;
  try {
    picked = pickDirectoryDialog(localRoot, {
      description: "选择要导入的技能包文件夹（目录内需含 SKILL.md）",
    });
  } catch (err) {
    return {
      cancelled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!picked) return { cancelled: true };

  const pickedAbs = path.resolve(picked);
  const localAbs = path.resolve(localRoot);
  if (
    pickedAbs.toLowerCase() === localAbs.toLowerCase() ||
    pickedAbs.toLowerCase().startsWith(localAbs.toLowerCase() + path.sep)
  ) {
    return {
      cancelled: false,
      error: "请选择本机技能目录以外的文件夹（勿选 agent-skills 自身或其子目录）",
    };
  }

  const packageDir = resolveSkillPackageDir(pickedAbs);
  if (!packageDir) {
    return {
      cancelled: false,
      error: "所选文件夹内未找到 SKILL.md（请选技能包根目录或解压后的外层文件夹）",
    };
  }

  const slug = safeSlug(path.basename(pickedAbs));
  const dest = path.join(localRoot, slug);
  try {
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDirRecursive(packageDir, dest);
    if (!findSkillMarkdownFile(dest) && !resolveSkillPackageDir(dest)) {
      return { cancelled: false, error: "复制后缺少 SKILL.md", slug };
    }
    const meta = metaFromPackage(slug, dest, "disk");
    return {
      cancelled: false,
      slug,
      name: meta.name,
      destDir: dest,
    };
  } catch (err) {
    return {
      cancelled: false,
      slug,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 把选中的 Codex 技能包复制到 dataRoot/agent-skills。
 * 已存在同名目录时默认覆盖（先删后拷）。
 */
export function importCodexSkillsToLocal(
  dataRoot: string,
  slugs: string[]
): { imported: string[]; skipped: string[]; errors: Array<{ slug: string; error: string }> } {
  const localRoot = ensureAgentSkillsDir(dataRoot);
  const codexRoot = codexSkillsDir();
  const imported: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const raw of slugs) {
    const slug = safeSlug(String(raw || "").trim());
    if (!slug) {
      skipped.push(String(raw));
      continue;
    }
    const srcHit = findPackageBySlug(codexRoot, slug);
    if (!srcHit) {
      errors.push({ slug, error: "Codex 目录中找不到该技能" });
      continue;
    }
    const srcDir = srcHit.packageDir;
    const dest = path.join(localRoot, slug);
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDirRecursive(srcDir, dest);
      if (!findSkillMarkdownFile(dest) && !resolveSkillPackageDir(dest)) {
        errors.push({ slug, error: "复制后缺少 SKILL.md" });
        continue;
      }
      imported.push(slug);
    } catch (err) {
      errors.push({
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { imported, skipped, errors };
}
