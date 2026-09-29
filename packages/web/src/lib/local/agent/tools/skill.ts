/**
 * skill_read_reference：读取当前/指定技能的 references 文件。
 */

import type { LocalChatToolCall } from "@/lib/local/generate";
import type { LocalAgentOpResult } from "../executor";
import { loadAgentSkill } from "../skills";
import { parseToolArgs } from "./parseToolArgs";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function applySkillReadReference(
  call: LocalChatToolCall,
  opts: { activeSkillSlug?: string | null }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const slug = str(a.skillSlug) || str(opts.activeSkillSlug) || "";
  const path = str(a.path) || str(a.file) || "";
  if (!slug) {
    return { op: call.name, ok: false, message: "未指定技能；请在面板选择技能或传入 skillSlug" };
  }
  const skill = await loadAgentSkill(slug);
  if (!skill) {
    return { op: call.name, ok: false, message: `找不到技能：${slug}` };
  }
  const keys = Object.keys(skill.references || {});
  if (!keys.length) {
    return {
      op: call.name,
      ok: true,
      message: `技能 ${slug} 无 references`,
      detail: "(empty)",
    };
  }
  // 未指定 path：列出可用参考，避免误读无关默认文件
  if (!path) {
    return {
      op: call.name,
      ok: true,
      message: `技能「${skill.name || slug}」references（${keys.length}）`,
      detail: keys.map((k) => `- ${k}`).join("\n"),
    };
  }
  // 允许只写文件名
  const hit =
    skill.references[path] ||
    skill.references[path.replace(/^references\//, "")] ||
    keys.map((k) => [k, skill.references[k]] as const).find(([k]) => k.endsWith(path) || path.endsWith(k))?.[1];
  if (!hit) {
    return {
      op: call.name,
      ok: false,
      message: `找不到 reference「${path}」。可用：${keys.join(", ")}`,
    };
  }
  return {
    op: call.name,
    ok: true,
    message: `已读取 references/${path}`,
    detail: hit,
  };
}
