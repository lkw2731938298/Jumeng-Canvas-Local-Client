/**
 * 开源本地版：云端 Skill API 已移除。
 * 保留空模块以免历史动态 import 报错；请使用本地设置中的模型 + LocalAgentPanel。
 */

export type SkillItem = {
  id: string;
  slug: string;
  title: string;
  description?: string;
};

export async function listSkills(): Promise<{ items: SkillItem[]; categories: string[] }> {
  return { items: [], categories: [] };
}

export async function listMySkills(): Promise<SkillItem[]> {
  return [];
}

export async function listFavoriteSkills(): Promise<SkillItem[]> {
  return [];
}
