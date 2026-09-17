/** 文本节点卡片生成隐性字数上限（不展示计数器，超长静默截断） */
export const TEXT_NODE_GENERATION_MAX_CHARS = 5000;

/** 将生成正文裁到卡片上限；用户手输不走此函数。 */
export function clipTextNodeGeneratedContent(text: string): string {
  if (text.length <= TEXT_NODE_GENERATION_MAX_CHARS) return text;
  return text.slice(0, TEXT_NODE_GENERATION_MAX_CHARS);
}
