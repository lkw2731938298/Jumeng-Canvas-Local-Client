/**
 * 媒体节点提示词：把连接的文本节点内容一并打进上游 prompt。
 * - 展开 @文本标签 → 正文
 * - 已连线但未 @ 的上游文本也合并进去（避免「只连线不传」）
 * - 保留 @图片/@视频 等媒体提及，供后续 [Image N] 改写
 */
import type { GenerationReference } from "@/lib/canvas/nodeMaterialSlots";
import { resolveMentionsInPrompt } from "@/lib/canvas/nodeMaterialSlots";

/** 去掉 @标签后是否还有实质正文 */
export function hasMeaningfulGenerationPrompt(raw: string): boolean {
  const t = String(raw || "")
    .replace(/@[^\s@，,。；;！!？?\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 2;
}

function normalizeForCompare(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 上游文本参考（连线），含正文 */
function collectUpstreamTextContents(references: GenerationReference[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of references) {
    if (r.type !== "text") continue;
    if (r.source === "local") continue;
    const c = String(r.content || "").trim();
    if (c.length < 2) continue;
    const key = normalizeForCompare(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * 解析图片/视频提交用提示词。
 * 1) 展开草稿里的 @文本 → 内容
 * 2) 合并所有已连接上游文本（若尚未包含）
 * 3) 保留媒体 @ 提及
 */
export async function resolveMediaPromptForGeneration(opts: {
  draft: string;
  /** resolveAllReferences 结果，须含上游 text 的 content */
  references: GenerationReference[];
}): Promise<{ prompt: string; fromUpstreamText: boolean; mergedTextCount: number }> {
  const draft = String(opts.draft || "").trim();
  const refs = opts.references ?? [];

  // 仅展开 text 类型的 @；图片/视频 @ 留给 rewriteJumeng*
  const { resolvedPrompt } = resolveMentionsInPrompt(draft, refs);
  let prompt = resolvedPrompt.trim();

  const upstreamTexts = collectUpstreamTextContents(refs);
  const missing: string[] = [];
  for (const text of upstreamTexts) {
    const needle = normalizeForCompare(text);
    if (!needle) continue;
    // 已展开或草稿里已有整段，不再重复拼接
    if (normalizeForCompare(prompt).includes(needle)) continue;
    missing.push(text);
  }

  if (missing.length > 0) {
    const block = missing.join("\n\n");
    if (!hasMeaningfulGenerationPrompt(prompt)) {
      // 草稿只有 @图/@视频 或为空：文本作正文，媒体提及跟在后面
      const mediaMentions = prompt.match(/@[^\s@，,。；;！!？?\n\r]+/g) || [];
      const mentionPart = mediaMentions.length ? ` ${mediaMentions.join(" ")}` : "";
      prompt = `${block}${mentionPart}`.trim();
    } else {
      // 本节点已有描述：把连接文本前置，保证上游一定收到
      prompt = `${block}\n${prompt}`.trim();
    }
  }

  return {
    prompt: prompt.slice(0, 20000),
    fromUpstreamText: missing.length > 0 || (upstreamTexts.length > 0 && !hasMeaningfulGenerationPrompt(draft)),
    mergedTextCount: missing.length,
  };
}
