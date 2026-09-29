/**
 * Agent Skill 读写：内置包 + 数据目录 agent-skills/。
 */

import { localStore } from "@/lib/local/store";
import { BUNDLED_SKILLS } from "./bundled";
import {
  formatSkillPromptForRuntime,
  parseSkillMarkdown,
  type AgentSkillDetail,
  type AgentSkillMeta,
} from "./parse";

export type { AgentSkillDetail, AgentSkillMeta };
export { formatSkillPromptForRuntime, parseSkillMarkdown };

function metaOf(s: AgentSkillDetail): AgentSkillMeta {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    source: s.source,
  };
}

/** 列出可用技能（磁盘优先覆盖同 slug 内置） */
export async function listAgentSkills(): Promise<AgentSkillMeta[]> {
  const map = new Map<string, AgentSkillMeta>();
  for (const s of BUNDLED_SKILLS) map.set(s.slug, metaOf(s));
  const api = localStore();
  if (typeof api.listAgentSkills === "function") {
    try {
      const disk = await api.listAgentSkills();
      for (const m of disk || []) {
        if (!m?.slug) continue;
        const source: AgentSkillMeta["source"] =
          m.source === "codex" ? "codex" : m.source === "bundled" ? "bundled" : "disk";
        map.set(m.slug, {
          slug: m.slug,
          name: m.name || m.slug,
          description: m.description || "",
          source,
        });
      }
    } catch {
      /* 无磁盘技能时忽略 */
    }
  }
  return [...map.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** 读取技能全文（含 references） */
export async function loadAgentSkill(slug: string): Promise<AgentSkillDetail | null> {
  const key = String(slug || "").trim();
  if (!key) return null;
  const api = localStore();
  if (typeof api.readAgentSkill === "function") {
    try {
      const disk = await api.readAgentSkill(key);
      if (disk?.body) {
        const src = disk.source === "codex" ? "codex" : "disk";
        return {
          slug: disk.slug || key,
          name: disk.name || key,
          description: disk.description || "",
          source: src,
          body: disk.body,
          references: disk.references || {},
        };
      }
    } catch {
      /* fallthrough bundled */
    }
  }
  return BUNDLED_SKILLS.find((s) => s.slug === key) || null;
}

/** 技能目录信息（设置页展示） */
export async function getAgentSkillsDirInfo(): Promise<{
  localDir: string;
  codexDir: string;
  codexExists: boolean;
} | null> {
  const api = localStore();
  if (typeof api.getAgentSkillsInfo !== "function") return null;
  try {
    return await api.getAgentSkillsInfo();
  } catch {
    return null;
  }
}

export async function openLocalAgentSkillsDir(): Promise<string | null> {
  const api = localStore();
  if (typeof api.openAgentSkillsDir !== "function") return null;
  const r = await api.openAgentSkillsDir();
  return r?.dir || null;
}

/** 列出 Codex 技能（设置页勾选导入） */
export async function listCodexSkillsForImport(): Promise<AgentSkillMeta[]> {
  const api = localStore();
  if (typeof api.listCodexSkills !== "function") return [];
  try {
    const list = await api.listCodexSkills();
    return (list || []).map((m) => ({
      slug: m.slug,
      name: m.name || m.slug,
      description: m.description || "",
      source: "codex" as const,
    }));
  } catch {
    return [];
  }
}

export async function importCodexSkills(slugs: string[]): Promise<{
  imported: string[];
  skipped: string[];
  errors: Array<{ slug: string; error: string }>;
}> {
  const api = localStore();
  if (typeof api.importCodexSkills !== "function") {
    throw new Error("当前环境不支持从 Codex 导入技能");
  }
  return api.importCodexSkills(slugs);
}

/** 供 Runtime 注入；失败返回空串 */
export async function loadSkillPrompt(slug: string | null | undefined): Promise<string> {
  const key = String(slug || "").trim();
  if (!key) return "";
  const skill = await loadAgentSkill(key);
  if (!skill) return "";
  return formatSkillPromptForRuntime(skill);
}
