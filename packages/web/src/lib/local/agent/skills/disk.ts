/**
 * 本机技能目录扫描：dataRoot/agent-skills + ~/.codex/skills。
 * 仅在 Node（/api/local）侧使用。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { parseSkillMarkdown } from "./parse";

export type DiskSkillMeta = {
  slug: string;
  name: string;
  description: string;
  source: "disk" | "codex";
  /** 技能包根目录绝对路径 */
  dir: string;
};

export type DiskSkillDetail = DiskSkillMeta & {
  body: string;
  references: Record<string, string>;
};

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
    if (!ent.isDirectory()) continue;
    const slug = safeSlug(ent.name);
    const dir = path.join(root, ent.name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const raw = fs.readFileSync(skillFile, "utf8");
      const parsed = parseSkillMarkdown(raw, slug);
      out.push({
        slug,
        name: parsed.name || slug,
        description: parsed.description || "",
        source,
        dir,
      });
    } catch {
      out.push({ slug, name: slug, description: "", source, dir });
    }
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

export function readDiskAgentSkill(
  dataRoot: string,
  slug: string
): DiskSkillDetail | null {
  const key = safeSlug(String(slug || "").trim());
  if (!key) return null;
  const candidates = [
    { dir: path.join(agentSkillsDir(dataRoot), key), source: "disk" as const },
    { dir: path.join(codexSkillsDir(), key), source: "codex" as const },
  ];
  for (const c of candidates) {
    const skillFile = path.join(c.dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    const raw = fs.readFileSync(skillFile, "utf8");
    const parsed = parseSkillMarkdown(raw, key);
    return {
      slug: key,
      name: parsed.name || key,
      description: parsed.description || "",
      source: c.source,
      dir: c.dir,
      body: parsed.body,
      references: readReferences(c.dir),
    };
  }
  return null;
}

/** 确保画布技能目录存在，并写入简短 README */
export function ensureAgentSkillsDir(dataRoot: string): string {
  const dir = agentSkillsDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        "把 Codex 式技能包放到本目录：",
        "  agent-skills/{技能名}/SKILL.md",
        "  agent-skills/{技能名}/references/*.md（可选）",
        "",
        "画布内置了 photo-relic-editorial，无需拷贝即可在助手顶栏选用。",
        "若已在 ~/.codex/skills 安装技能，请把对应文件夹复制到本目录后才会出现在助手列表。",
        "",
      ].join("\n"),
      "utf8"
    );
  }
  return dir;
}

export function openDirectoryInOs(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const platform = process.platform;
  if (platform === "win32") {
    exec(`explorer "${dir.replace(/"/g, "")}"`);
  } else if (platform === "darwin") {
    exec(`open "${dir.replace(/"/g, "")}"`);
  } else {
    exec(`xdg-open "${dir.replace(/"/g, "")}"`);
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
    const src = path.join(codexRoot, slug);
    // Codex 目录名可能与 safeSlug 不完全一致：再扫一遍匹配
    let srcDir = src;
    if (!fs.existsSync(path.join(srcDir, "SKILL.md"))) {
      const hit = scanSkillsRoot(codexRoot, "codex").find((s) => s.slug === slug);
      if (!hit) {
        errors.push({ slug, error: "Codex 目录中找不到该技能" });
        continue;
      }
      srcDir = hit.dir;
    }
    const dest = path.join(localRoot, slug);
    try {
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      copyDirRecursive(srcDir, dest);
      if (!fs.existsSync(path.join(dest, "SKILL.md"))) {
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
