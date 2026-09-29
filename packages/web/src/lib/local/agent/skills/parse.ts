/**
 * Codex 式 Skill：解析 SKILL.md 头 + 正文。
 */

export type AgentSkillMeta = {
  slug: string;
  name: string;
  description: string;
  /** disk = 用户数据目录；codex = ~/.codex/skills；bundled = 内置 */
  source: "disk" | "codex" | "bundled";
};

export type AgentSkillDetail = AgentSkillMeta & {
  /** SKILL.md 正文（不含 frontmatter） */
  body: string;
  /** references 相对路径 → 文本 */
  references: Record<string, string>;
};

/** 解析 YAML frontmatter（仅支持简单 key: value / key: "quoted"） */
export function parseSkillMarkdown(
  raw: string,
  slugHint: string
): { name: string; description: string; body: string } {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) {
    return {
      name: slugHint,
      description: "",
      body: text.trim(),
    };
  }
  const fm = m[1] || "";
  const body = (m[2] || "").trim();
  let name = slugHint;
  let description = "";
  for (const line of fm.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "name") name = val || name;
    if (key === "description") description = val;
  }
  return { name, description, body };
}

/** 注入 Runtime 的技能提示（含可选 reference） */
export function formatSkillPromptForRuntime(skill: AgentSkillDetail, maxChars = 28000): string {
  const refs = Object.entries(skill.references || {})
    .map(([path, content]) => `\n\n### references/${path}\n${content}`)
    .join("");
  let full = `# Skill: ${skill.name} (${skill.slug})\n\n${skill.description ? `> ${skill.description}\n\n` : ""}${skill.body}${refs}`;
  if (full.length > maxChars) {
    full = `${full.slice(0, maxChars)}\n\n…（技能正文已截断）`;
  }
  return full;
}
