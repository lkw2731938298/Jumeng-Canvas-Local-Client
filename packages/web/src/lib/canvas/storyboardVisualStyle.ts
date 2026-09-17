import {
  DEFAULT_VISUAL_STYLE_ID,
  findVisualStyle,
  type VisualStyleItem,
  type VisualStylesPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";

/** 把视觉风格约束写进分镜/主体提取的用户内容，供 LLM 按风格撰写描述。 */
export function appendStoryboardVisualStyle(
  content: string,
  style: VisualStyleItem | null | undefined
): string {
  const body = content.trim();
  if (!style || style.id === DEFAULT_VISUAL_STYLE_ID) return body;
  const label = style.label?.trim() || style.id;
  const prompt = style.prompt?.trim() || "";
  const hint = prompt || label;
  return `${body}\n\n【视觉风格：${label}】分镜的画面描述、光影氛围、运镜提示词，以及角色/场景/道具主体提取，均按此风格撰写：${hint}`;
}

export function resolveStoryboardVisualStyle(
  config: VisualStylesPromptToolConfig | null | undefined,
  styleId: string | null | undefined
): VisualStyleItem | undefined {
  const id = String(styleId ?? "").trim() || DEFAULT_VISUAL_STYLE_ID;
  return findVisualStyle(config, id);
}

/** 生图接口：选「无」时不传 visualStyleId，避免后端当有效风格拼接。 */
export function mediaVisualStyleId(styleId: string | null | undefined): string | undefined {
  const id = String(styleId ?? "").trim();
  if (!id || id === DEFAULT_VISUAL_STYLE_ID) return undefined;
  return id;
}
