import { apiFetch } from "./client";
import type {
  GenerationReference,
  TextGenerationRequest,
  TextGenerationResponse,
} from "./textGeneration.types";
import { isLocalDesktop } from "@/lib/localDesktop";
import { localGenerateText } from "@/lib/local/generate";
import { composeLocalTextGeneration } from "@/lib/local/localTextPrompt";

export type { TextGenerationRequest, TextGenerationResponse } from "./textGeneration.types";
export type { GenerationSubmitOptions } from "./mediaGeneration";

import type { GenerationSubmitOptions } from "./mediaGeneration";

/** 对齐云端 _reference_blocks：文本内联、图片标注「见附图」 */
function buildLocalReferenceBlocks(refs: GenerationReference[]): string[] {
  const blocks: string[] = [];
  for (const ref of refs) {
    const label = (ref.label || ref.nodeId || "").trim() || "参考";
    if (ref.type === "text" && (ref.content || "").trim()) {
      blocks.push(`[参考文本「${label}」]\n${ref.content!.trim()}`);
    } else if (ref.type === "image") {
      blocks.push(`[参考图片「${label}」] 见附图`);
    } else if (ref.type === "video") {
      // 本地文本链路暂不抽视频帧，仅保留文字提示，避免静默丢引用
      blocks.push(`[参考视频「${label}」] 本地文本生成暂不附视频，请改连图片节点或先截帧`);
    } else if ((ref.url || "").trim()) {
      blocks.push(`[参考${ref.type}「${label}」] ${ref.url!.trim()}`);
    }
  }
  return blocks;
}

/** 从 references 取出可看图 URL（本机素材 / data URL / https） */
function collectLocalTextImageUrls(refs: GenerationReference[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref.type !== "image") continue;
    const u = String(ref.url || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    urls.push(u);
  }
  return urls;
}

/**
 * 有参考时在 user prompt 前拼接说明块，并标明是否含附图。
 * 图片本身经 localGenerateText.images 以 vision parts 提交。
 */
function wrapLocalPromptWithReferences(
  prompt: string,
  refs: GenerationReference[],
  imageCount: number
): string {
  const blocks = buildLocalReferenceBlocks(refs);
  if (!blocks.length) return prompt;
  const suffix = imageCount
    ? "请根据以上参考（含附图）完成下列任务。"
    : "请根据以上参考完成下列任务。";
  const head = [...blocks, suffix].join("\n\n");
  const body = prompt.trim();
  return body ? `${head}\n\n${body}` : head;
}

/** 本地桌面：跳过云端 Worker，直连用户配置的上游文本模型；并套用 textPromptKind 内置提示词 */
async function generateFromTextNodeLocal(
  request: TextGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<TextGenerationResponse> {
  if (options?.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const refs = request.references ?? [];
  const imageUrls = collectLocalTextImageUrls(refs);
  // 开源本地无后台 prompt-config：必须按 kind 拼 system/user，否则分镜表只会得到散文而不是 JSON
  const composed = composeLocalTextGeneration({
    content: request.content,
    textPromptKind: request.textPromptKind,
    canvasTool: request.canvasTool,
  });
  const prompt = wrapLocalPromptWithReferences(composed.prompt, refs, imageUrls.length);
  const content = await localGenerateText({
    modelId: request.model,
    prompt,
    system: composed.system,
    // 带图：OpenAI 兼容 vision；自定义模板会由 localGenerateText 明确报错
    ...(imageUrls.length ? { images: imageUrls } : {}),
    signal: options?.signal,
  });
  return {
    jobId: Date.now(),
    status: "succeeded",
    content,
    model: request.model,
    message: "本地生成完成",
    creditCost: 0,
  };
}

export async function generateFromTextNode(
  request: TextGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<TextGenerationResponse> {
  if (isLocalDesktop) {
    return generateFromTextNodeLocal(request, options);
  }
  return apiFetch<TextGenerationResponse>("/api/v1/text/generate", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
    signal: options?.signal,
    body: JSON.stringify({
      projectId: request.projectId,
      nodeId: request.nodeId,
      workflowId: request.workflowId,
      content: request.content,
      model: request.model,
      ...(request.textPromptKind ? { textPromptKind: request.textPromptKind } : {}),
      references: request.references ?? [],
      ...(request.submitSource ? { submitSource: request.submitSource } : {}),
      ...(request.canvasTool ? { canvasTool: request.canvasTool } : {}),
      ...(options?.quoteToken ? { quoteToken: options.quoteToken } : {}),
      ...(options?.expectedPricingVersion != null
        ? { expectedPricingVersion: options.expectedPricingVersion }
        : {}),
    }),
  });
}
