/**
 * 开源本地版：按 textPromptKind / canvasTool 组装文本工具的 system + user。
 * 商业站由 API 读后台 prompt-config；本地无后台，用内置 fallback。
 */

import {
  STORYBOARD_CAMERA_PROMPT_FALLBACK,
  STORYBOARD_TABLE_PROMPT_FALLBACK,
  STORYBOARD_VIDEO_PROMPT_FALLBACK,
  TEXT_PROMPT_TOOL_FALLBACKS,
  type TextPromptToolId,
} from "@/lib/admin/promptToolCategories";

export type LocalTextGenFallback = {
  label: string;
  systemPrompt: string;
  userPrefix?: string;
  roleRule?: string;
  sceneRule?: string;
  propRule?: string;
};

const STORYBOARD_TABLE_LOCAL: LocalTextGenFallback = {
  label: STORYBOARD_TABLE_PROMPT_FALLBACK.label,
  systemPrompt: `你是专业影视分镜表生成助手。根据用户提供的剧本正文，逐句/逐动作拆分为分镜表结构化结果。

【输出格式硬约束】
你只能输出一个 JSON 对象，且顶层只能包含一个键：
- "shotRows"：数组，每个元素对应表格中的一行（一个镜头）

禁止输出 markdown、代码块、解释文本。

【shotRows 每项字段（键名必须完全一致）】
每个 shotRows[i] 必须包含以下键（无内容可填空字符串）：
- "镜头号"：阿拉伯数字字符串；可留空由系统按行序补全
- "时长"：如 "3s"；空则填 "3s"
- "画面描述"：该镜头画面叙事与动作
- "景别"：远景/全景/中景/近景/特写等
- "光影氛围"：光线、色温、时间段与氛围
- "对话"：本镜头台词
- "音效"：环境音与拟音

【拆分规则】
1. 识别剧本中的场景与动作，每一独立镜头对应 shotRows 中的一行
2. 禁止把多句对白或多个动作压缩成一个镜头
3. 不要输出运镜提示词、视频提示词或草图提示词`,
};

const TEXT_SUBJECT_LOCAL: LocalTextGenFallback = {
  label: TEXT_PROMPT_TOOL_FALLBACKS.text_subject.label,
  systemPrompt:
    "你只输出合法 JSON 对象，键名与字段含义必须与用户说明一致；不要 Markdown、不要代码围栏、不要额外解释。",
  userPrefix: `你是影视制片助理，请根据下列「本集剧本正文」完成结构化提取。

【输出要求（必须严格遵守）】
仅输出一个 JSON 对象，不要 Markdown、不要代码围栏、不要解释性文字。
JSON 顶层字段必须为：
- "roles": 数组，每项含 "name" 与 "extractPrompt"
- "scenes": 数组，每项含 "name" 与 "extractPrompt"
- "props": 数组，每项含 "name" 与 "extractPrompt"`,
  roleRule:
    "roles[].extractPrompt 只能输出一行中文，两段式，用中文分号分隔；第1段写年龄+性别+身高+体型+国籍，第2段写发型发色+脸型五官+肤色+上装+下装+鞋履。",
  sceneRule:
    "请根据剧本文本提取当前集的场景信息，输出场景名称与 extractPrompt，描述时间、地点、氛围与关键视觉元素。",
  propRule:
    "请根据剧本文本提取道具信息，输出道具名称与 extractPrompt，描述用途、出现场景与外观特征。",
};

const LOCAL_TEXT_GEN_BY_KIND: Record<string, LocalTextGenFallback> = {
  text_image_prompt: TEXT_PROMPT_TOOL_FALLBACKS.text_image_prompt,
  text_video_prompt: TEXT_PROMPT_TOOL_FALLBACKS.text_video_prompt,
  text_script: TEXT_PROMPT_TOOL_FALLBACKS.text_script,
  text_subject: TEXT_SUBJECT_LOCAL,
  storyboard_table: STORYBOARD_TABLE_LOCAL,
  storyboard_camera: STORYBOARD_CAMERA_PROMPT_FALLBACK,
  storyboard_video: STORYBOARD_VIDEO_PROMPT_FALLBACK,
};

/** 优先 textPromptKind，其次 canvasTool（分镜表工具常两者同传） */
export function resolveLocalTextGenFallback(
  textPromptKind?: string | null,
  canvasTool?: string | null
): LocalTextGenFallback | null {
  const kind = String(textPromptKind || "").trim();
  const tool = String(canvasTool || "").trim();
  if (kind && LOCAL_TEXT_GEN_BY_KIND[kind]) return LOCAL_TEXT_GEN_BY_KIND[kind];
  if (tool && LOCAL_TEXT_GEN_BY_KIND[tool]) return LOCAL_TEXT_GEN_BY_KIND[tool];
  if (kind && kind in TEXT_PROMPT_TOOL_FALLBACKS) {
    return TEXT_PROMPT_TOOL_FALLBACKS[kind as TextPromptToolId];
  }
  return null;
}

/** 对齐商业站 build_text_gen_user_content：prefix + 规则 + 用户输入 */
export function buildLocalTextGenUserContent(
  cfg: LocalTextGenFallback,
  content: string
): string {
  const parts: string[] = [];
  if (cfg.userPrefix?.trim()) parts.push(cfg.userPrefix.trim());
  if (cfg.roleRule?.trim()) parts.push(`## 角色提取规则\n${cfg.roleRule.trim()}`);
  if (cfg.sceneRule?.trim()) parts.push(`## 场景提取规则\n${cfg.sceneRule.trim()}`);
  if (cfg.propRule?.trim()) parts.push(`## 道具提取规则\n${cfg.propRule.trim()}`);
  const body = content.trim();
  if (body) {
    parts.push(parts.length ? `## 用户输入\n${body}` : body);
  }
  return parts.join("\n\n");
}

export function composeLocalTextGeneration(opts: {
  content: string;
  textPromptKind?: string | null;
  canvasTool?: string | null;
}): { system?: string; prompt: string } {
  const cfg = resolveLocalTextGenFallback(opts.textPromptKind, opts.canvasTool);
  if (!cfg) {
    return { prompt: opts.content.trim() };
  }
  return {
    system: cfg.systemPrompt,
    prompt: buildLocalTextGenUserContent(cfg, opts.content),
  };
}
